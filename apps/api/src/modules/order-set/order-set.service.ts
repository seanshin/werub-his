import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { catalogEditMode, catalogRootId, catalogTransitionAllowed, CATALOG_STATUSES } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildMedicationSearchWhere, MEDICATION_SEARCH_ORDER } from '../../common/medication-search';

// 상태·전이 정본 = shared `catalog-lifecycle`(치료일정 템플릿과 같은 표 · 2026-10-21 P2)
const VALID_STATUSES = CATALOG_STATUSES;

// 코드 해석이 필수인 항목 유형 → 요구 코드 필드.
// 미해석 항목은 CPOE 적용 시 실 처방으로 생성될 수 없어(유령) ACTIVE 승격을 차단한다.
const CODE_REQUIRED_FIELD: Record<string, 'medicationCodeId' | 'procedureCodeId'> = {
  MEDICATION: 'medicationCodeId',
  LAB: 'procedureCodeId',
  IMAGING: 'procedureCodeId',
  THERAPY: 'procedureCodeId',
};

interface OrderSetItemShape {
  type?: string;
  name?: string;
  medicationCodeId?: string;
  procedureCodeId?: string;
}

@Injectable()
export class OrderSetService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  // ── Auto-generate CP code ──
  private async generateCode(category: string): Promise<string> {
    const prefix = category === 'DISEASE' ? 'CP-DS'
      : category === 'SURGERY_PRE' ? 'CP-SP'
      : category === 'PROCEDURE' ? 'CP-PR'
      : category === 'ADMISSION' ? 'CP-AD'
      : 'CP-CS';
    const count = await this.prisma.orderSet.count({
      where: { code: { startsWith: prefix } },
    });
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  async create(
    data: {
      name: string; code?: string; department?: string; category: string;
      diagnosisCode?: string; description?: string; applicableTo?: string;
      ageGroup?: string; contraindications?: unknown;
      evidenceLevel?: string; guidelineRef?: string; items: unknown; isShared?: boolean;
    },
    userId: string,
  ) {
    const code = data.code || await this.generateCode(data.category);
    const { contraindications, ...rest } = data;
    return this.prisma.orderSet.create({
      data: {
        ...rest,
        code,
        items: data.items as Prisma.InputJsonValue,
        ...(contraindications !== undefined ? { contraindications: contraindications as Prisma.InputJsonValue } : {}),
        createdBy: userId,
        status: 'DRAFT',
      },
    });
  }

  async findAll(filters: { category?: string; department?: string; diagnosisCode?: string; status?: string }) {
    const where: Prisma.OrderSetWhereInput = { isActive: true };
    if (filters.category) where.category = filters.category;
    if (filters.department) where.department = filters.department;
    if (filters.diagnosisCode) where.diagnosisCode = filters.diagnosisCode;
    if (filters.status) where.status = filters.status;
    return this.prisma.orderSet.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async findById(id: string) {
    const os = await this.prisma.orderSet.findUnique({ where: { id } });
    if (!os) throw new NotFoundException('Order set not found');
    return os;
  }

  /**
   * 🔴 수정(2026-10-21 P2) — 종전엔 사용 중 세트도 제자리에서 바뀌었다(판·재승인·미해석 검사 없음).
   *  · 사용 중 → 내용을 담은 **새 판 초안**을 만든다(사용 중 판은 그대로 쓰인다 · 같은 계보의 열린 초안이 있으면 409 — 그 초안을 고친다)
   *  · 승인 대기·승인됨 → 초안으로 되돌리고 승인 기록을 지운다(승인은 다른 내용에 대한 것이었다)
   *  · 사용 여부(isActive)만 바꾸는 것은 제자리
   */
  async update(id: string, data: Record<string, unknown>, userId?: string) {
    const os = await this.findById(id);
    const updateData: Record<string, unknown> = { ...data };
    if (updateData.items) {
      updateData.items = updateData.items as unknown as Prisma.InputJsonValue;
    }
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const mode = keys.length && keys.every((k) => k === 'isActive') ? 'IN_PLACE' : catalogEditMode(os.status);
    if (mode === 'NEW_VERSION') {
      const draft = await this.createVersion(os, userId, updateData);
      return { ...draft, editMode: mode, newVersionOf: os.id };
    }
    if (mode === 'RESET_APPROVAL') Object.assign(updateData, { status: 'DRAFT', approvedBy: null, approvedAt: null });
    // 🔴 상태는 DB 가 대조한다 — 그 사이 다른 사람이 상태를 바꿨으면 덮어쓰지 않는다(쓰기 한 번)
    const r = await this.prisma.orderSet.updateMany({ where: { id, status: os.status }, data: updateData as Prisma.OrderSetUpdateManyMutationInput });
    if (r.count !== 1) throw new ConflictException({ code: 'CATALOG_STATUS_RACE', message: '다른 사람이 상태를 먼저 바꿨습니다 — 새로 불러온 뒤 다시 하세요' });
    return { ...(await this.findById(id)), editMode: mode };
  }

  /**
   * 새 판 — 같은 계보(원본 + 판)의 다음 번호 · 진단 연결·연령군·금기까지 그대로 옮긴다(종전 복제는 진단 연결·연령군·금기를 빠뜨렸다).
   * 이름은 고유값이라 판 번호를 붙인다(덮어쓸 이름이 오면 그것).
   */
  private async createVersion(
    os: Awaited<ReturnType<OrderSetService['findById']>>,
    userId: string | undefined,
    overrides: Record<string, unknown>,
  ) {
    const root = catalogRootId(os);
    const lineage = await this.prisma.orderSet.findMany({ where: { OR: [{ id: root }, { parentId: root }] }, select: { id: true, version: true, status: true } });
    // 계보에 열린 초안은 하나 — 수정·복제 모두(재시도가 판을 하나 더 만들지 않는다)
    const open = lineage.find((l) => l.id !== os.id && l.status === 'DRAFT');
    if (open) {
      throw new ConflictException({ code: 'ORDER_SET_DRAFT_EXISTS', message: '이 세트의 새 판 초안이 이미 있습니다 — 그 초안을 고치세요.', details: { draftId: open.id } });
    }
    const version = Math.max(...lineage.map((l) => l.version), os.version) + 1;
    const baseName = os.name.replace(/ \(v\d+\)$/, '');
    const name = typeof overrides.name === 'string' && overrides.name.trim() && overrides.name !== os.name ? overrides.name.trim() : `${baseName} (v${version})`;
    const dx = await this.prisma.orderSetDiagnosis.findMany({ where: { orderSetId: os.id } });
    const pick = <K extends string>(k: K) => (k in overrides ? overrides[k] : (os as unknown as Record<string, unknown>)[k]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.orderSet.create({
          data: {
            name,
            code: pick('code') as string | null,
            department: pick('department') as string | null,
            category: pick('category') as string,
            diagnosisCode: pick('diagnosisCode') as string | null,
            description: pick('description') as string | null,
            applicableTo: pick('applicableTo') as string | null,
            ageGroup: pick('ageGroup') as string | null,
            contraindications: (pick('contraindications') ?? undefined) as Prisma.InputJsonValue | undefined,
            evidenceLevel: pick('evidenceLevel') as string | null,
            guidelineRef: pick('guidelineRef') as string | null,
            items: pick('items') as Prisma.InputJsonValue,
            isShared: pick('isShared') as boolean,
            version,
            status: 'DRAFT',
            parentId: root,
            createdBy: userId ?? null,
          },
        });
        if (dx.length) {
          await tx.orderSetDiagnosis.createMany({ data: dx.map(({ id: _i, orderSetId: _o, ...d }) => ({ ...d, orderSetId: created.id })) as never });
        }
        return created;
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new ConflictException({ code: 'ORDER_SET_NAME_TAKEN', message: '같은 이름의 세트가 이미 있습니다 — 이름을 바꿔 주세요.' });
      throw e;
    }
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.orderSet.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * 추천 엔진 v2 — 주상병 가중(×1.5)·EXACT 가중(×1.2)·prefix 매칭·useCount 부스팅.
   * 매핑 소스는 OrderSetDiagnosis(다대다)와 레거시 OrderSet.diagnosisCode(단일) 병합.
   * @param primaryCode 주상병 코드(미전달 시 전 코드 동일 가중 — 하위호환)
   * @param age 환자 나이(전달 시 ageGroup 부적합 세트 제외)
   * @param patientId 환자 ID(전달 시 활성 알레르기 원장으로 ALLERGY형 금기 대조)
   */
  async recommend(diagnosisCodes: string[], primaryCode?: string, age?: number, patientId?: string) {
    if (!diagnosisCodes.length) return [];

    // 후보 수집: ① 레거시 단일 diagnosisCode EXACT ② 매핑 EXACT ③ 매핑 PREFIX(앱 필터)
    const [legacySets, exactMaps, prefixMaps] = await Promise.all([
      this.prisma.orderSet.findMany({
        where: { isActive: true, status: 'ACTIVE', diagnosisCode: { in: diagnosisCodes } },
      }),
      this.prisma.orderSetDiagnosis.findMany({
        where: { diagnosisCode: { in: diagnosisCodes }, matchType: 'EXACT', orderSet: { isActive: true, status: 'ACTIVE' } },
        include: { orderSet: true },
      }),
      this.prisma.orderSetDiagnosis.findMany({
        where: { matchType: 'PREFIX', orderSet: { isActive: true, status: 'ACTIVE' } },
        include: { orderSet: true },
      }),
    ]);

    type Candidate = { os: (typeof legacySets)[number]; score: number; matchedBy: string; matchedCode: string };
    const best = new Map<string, Candidate>();
    const isPrimary = (code: string) => !!primaryCode && code === primaryCode;

    const consider = (os: (typeof legacySets)[number], matchedCode: string, exact: boolean, role: string, weight: number, source: string) => {
      if (role === 'PRIMARY_ONLY' && !isPrimary(matchedCode)) return; // 주상병 한정 매핑
      // ageGroup 필터 — 나이 전달 시 부적합 제외
      if (age != null && os.ageGroup && os.ageGroup !== 'ALL') {
        const fit = os.ageGroup === 'ADULT' ? age >= 19 : os.ageGroup === 'PEDIATRIC' ? age < 19 : os.ageGroup === 'GERIATRIC' ? age >= 65 : true;
        if (!fit) return;
      }
      const score = weight * (isPrimary(matchedCode) ? 1.5 : 1.0) * (exact ? 1.2 : 1.0) + Math.log((os.useCount ?? 0) + 1) * 10;
      const prev = best.get(os.id);
      if (!prev || score > prev.score) {
        best.set(os.id, { os, score, matchedBy: source, matchedCode });
      }
    };

    for (const os of legacySets) consider(os, os.diagnosisCode!, true, 'ANY', 100, 'LEGACY_EXACT');
    for (const m of exactMaps) consider(m.orderSet, m.diagnosisCode, true, m.role, m.weight, 'EXACT');
    for (const m of prefixMaps) {
      const hit = diagnosisCodes.find((c) => c.startsWith(m.diagnosisCode));
      if (hit) consider(m.orderSet, hit, false, m.role, m.weight, 'PREFIX');
    }

    /**
     * 금기(contraindications) 대조 — DIAGNOSIS형은 전달된 진단코드(prefix), ALLERGY형은 활성 알레르기 원장과 대조.
     *
     * 🔴 (2026-09-03 재검증) 관리 화면은 금기를 `{note}` 로만 저장한다 — `{type,value}` 를 기대하는
     *    이 대조는 그런 세트에서 **평가 가능한 항목이 0건**이라 항상 통과했다(자동 제외 사망).
     *    note 자유 텍스트를 코드가 해석하는 척하지 않는다(어휘를 지어내 판정하면 더 위험) —
     *    대신 "자동 대조 불가"를 응답(contraUnevaluated)과 감시자 원장에 드러내 사람이 note 를 읽게 한다.
     */
    const allergies = patientId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(patientId)
      ? await this.prisma.allergy.findMany({ where: { patientId, isActive: true }, select: { allergen: true } })
      : [];
    const contraOf = (os: (typeof legacySets)[number]): { blocked: boolean; unevaluated: boolean } => {
      const list = Array.isArray(os.contraindications) ? (os.contraindications as { type?: string; value?: string }[]) : [];
      const evaluable = list
        .map((c) => ({ type: String(c?.type ?? '').toUpperCase(), value: String(c?.value ?? '').trim() }))
        .filter((c) => c.value);
      const blocked = evaluable.some((c) => {
        if (c.type === 'DIAGNOSIS') return diagnosisCodes.some((code) => code.toUpperCase().startsWith(c.value.toUpperCase()));
        if (c.type === 'ALLERGY') {
          return allergies.some((a) =>
            a.allergen.toLowerCase().includes(c.value.toLowerCase()) || c.value.toLowerCase().includes(a.allergen.toLowerCase()),
          );
        }
        return false; // 알 수 없는 type 은 무시(보수적 확장 여지)
      });
      const unevaluated = list.length > 0 && evaluable.length === 0;
      if (unevaluated) {
        this.drift?.record({
          kind: 'KEY_MISSING',
          producer: 'admin.order-set.contraindications',
          consumer: 'order-set.isContraindicated',
          detail: `세트 '${os.name}' 금기 ${list.length}건이 전부 note 형 — type/value 가 없어 자동 대조가 한 건도 평가되지 않음`,
        });
      }
      return { blocked, unevaluated };
    };

    return [...best.values()]
      .map((c) => ({ c, contra: contraOf(c.os) }))
      .filter(({ contra }) => !contra.blocked)
      .sort((a, b) => b.c.score - a.c.score)
      .slice(0, 5)
      .map(({ c, contra }) => ({
        ...c.os, matchScore: Math.round(c.score), matchedBy: c.matchedBy, matchedCode: c.matchedCode,
        // 🔴 금기가 저장돼 있는데 자동 대조가 불가한 세트 — 화면이 "메모를 사람이 확인하라"를 그릴 근거
        contraUnevaluated: contra.unevaluated,
      }));
  }

  // ── 진단 매핑 관리 (replace-all) ──
  async replaceDiagnoses(
    orderSetId: string,
    diagnoses: { diagnosisCode: string; matchType?: string; role?: string; weight?: number }[],
  ) {
    await this.findById(orderSetId);
    const seen = new Set<string>();
    const rows = diagnoses
      .filter((d) => d.diagnosisCode?.trim())
      .filter((d) => (seen.has(d.diagnosisCode.trim()) ? false : (seen.add(d.diagnosisCode.trim()), true)))
      .map((d) => ({
        orderSetId,
        diagnosisCode: d.diagnosisCode.trim(),
        matchType: d.matchType === 'PREFIX' ? 'PREFIX' : 'EXACT',
        role: d.role === 'PRIMARY_ONLY' ? 'PRIMARY_ONLY' : 'ANY',
        weight: Math.max(1, Math.min(1000, d.weight ?? 100)),
      }));
    await this.prisma.$transaction([
      this.prisma.orderSetDiagnosis.deleteMany({ where: { orderSetId } }),
      ...(rows.length ? [this.prisma.orderSetDiagnosis.createMany({ data: rows })] : []),
    ]);
    return this.prisma.orderSetDiagnosis.findMany({ where: { orderSetId }, orderBy: { diagnosisCode: 'asc' } });
  }

  async getDiagnoses(orderSetId: string) {
    return this.prisma.orderSetDiagnosis.findMany({ where: { orderSetId }, orderBy: { diagnosisCode: 'asc' } });
  }

  // ── Clone (duplicate with new version) ──
  async cloneOrderSet(id: string, userId: string) {
    const original = await this.findById(id);
    return this.createVersion(original, userId, {});
  }

  // ── 미해석 항목 판정 ──
  listUnresolvedItems(items: unknown): { index: number; type: string; name: string }[] {
    if (!Array.isArray(items)) return [];
    const out: { index: number; type: string; name: string }[] = [];
    items.forEach((raw, index) => {
      const it = raw as OrderSetItemShape;
      const field = CODE_REQUIRED_FIELD[it?.type ?? ''];
      if (field && !it?.[field]) out.push({ index, type: it.type ?? '', name: it.name ?? '' });
    });
    return out;
  }

  // ── 해석 후보 매칭 — 이름 기반 자동 후보 조회(확정은 사람이) ──
  async resolveItems(id: string) {
    const os = await this.findById(id);
    const unresolved = this.listUnresolvedItems(os.items);
    const items = [];
    for (const u of unresolved) {
      items.push({ ...u, candidates: await this.searchCodeCandidates(u.type, u.name) });
    }
    return { orderSetId: id, name: os.name, unresolvedCount: unresolved.length, items };
  }

  private async searchCodeCandidates(type: string, name: string) {
    const q = (name ?? '').trim();
    if (!q) return [];
    // 전체명 → 실패 시 규격/용량 접미 제거한 기본명("아모크라정 375mg" → "아모크라정")으로 재시도
    const baseName = q.split(/\s+/)[0];
    const queries = baseName !== q ? [q, baseName] : [q];
    if (type === 'MEDICATION') {
      for (const term of queries) {
        // 한/영 병용 P1(D2): 공용 빌더 — AI 초안의 영문 약물명도 매칭
        const rows = await this.prisma.medicationCode.findMany({
          where: buildMedicationSearchWhere(term),
          take: 5,
          select: { id: true, code: true, nameKo: true, dosageForm: true, unitPrice: true },
          orderBy: MEDICATION_SEARCH_ORDER,
        });
        if (rows.length) return rows.map((r) => ({ ...r, codeField: 'medicationCodeId' as const }));
      }
      return [];
    }
    // LAB / IMAGING / THERAPY → 수가(행위) 코드
    for (const term of queries) {
      const rows = await this.prisma.procedureCode.findMany({
        where: { nameKo: { contains: term, mode: 'insensitive' } },
        take: 5,
        select: { id: true, code: true, nameKo: true, unitPrice: true },
        orderBy: { nameKo: 'asc' },
      });
      if (rows.length) return rows.map((r) => ({ ...r, codeField: 'procedureCodeId' as const }));
    }
    return [];
  }

  // ── Status transition ──
  async changeStatus(id: string, newStatus: string, approvedBy?: string) {
    if (!VALID_STATUSES.includes(newStatus as typeof VALID_STATUSES[number])) {
      throw new BadRequestException(`Invalid status: ${newStatus}`);
    }
    const os = await this.findById(id);
    if (!catalogTransitionAllowed(os.status, newStatus)) {
      throw new BadRequestException(`Cannot transition from ${os.status} to ${newStatus}`);
    }
    // ACTIVE 승격 게이트: 미해석 항목(유령 처방 원인)이 있으면 활성화 거부
    if (newStatus === 'ACTIVE') {
      const unresolved = this.listUnresolvedItems(os.items);
      if (unresolved.length) {
        throw new BadRequestException(
          `미해석 항목 ${unresolved.length}건 — 코드 해석 후 활성화할 수 있습니다: ${unresolved.map((u) => u.name || `#${u.index + 1}`).slice(0, 5).join(', ')}${unresolved.length > 5 ? ' 외' : ''}`,
        );
      }
    }
    const updateData: Prisma.OrderSetUpdateInput = { status: newStatus };
    if (newStatus === 'APPROVED' && approvedBy) {
      updateData.approvedBy = approvedBy;
      updateData.approvedAt = new Date();
    }
    // 🔴 (2026-10-21 P2) 초안 → 사용 중 직행이 승인자를 남기지 않았다 — 사용 중으로 바꾼 사람이 승인 기록이 된다(이미 승인됐으면 그 기록 그대로)
    if (newStatus === 'ACTIVE' && !os.approvedBy && approvedBy) {
      updateData.approvedBy = approvedBy;
      updateData.approvedAt = new Date();
    }
    // 초안으로 돌아가면 승인은 다시 받는다
    if (newStatus === 'DRAFT') { updateData.approvedBy = null; updateData.approvedAt = null; }

    // 같은 계보에서 사용 중은 하나 — 이전 판은 폐기로 · 🔴 상태는 DB 가 대조한다(동시에 두 판을 사용 중으로 만들지 못하게) · 한 트랜잭션
    const root = catalogRootId(os);
    const supersededIds = newStatus === 'ACTIVE'
      ? (await this.prisma.orderSet.findMany({ where: { OR: [{ id: root }, { parentId: root }], status: 'ACTIVE', id: { not: id } }, select: { id: true } })).map((o) => o.id)
      : [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.orderSet.updateMany({ where: { id, status: os.status }, data: updateData as Prisma.OrderSetUpdateManyMutationInput });
      if (r.count !== 1) throw new ConflictException({ code: 'CATALOG_STATUS_RACE', message: '다른 사람이 상태를 먼저 바꿨습니다 — 새로 불러온 뒤 다시 하세요' });
      if (supersededIds.length) await tx.orderSet.updateMany({ where: { id: { in: supersededIds }, status: 'ACTIVE' }, data: { status: 'DEPRECATED' } });
      return tx.orderSet.findUniqueOrThrow({ where: { id } });
    });
    if (newStatus !== 'ACTIVE') return updated;
    // 이전 판을 가리키는 임상경로 마일스톤 — 자동으로 옮기지 않는다(경로 편집 몫) · 수만 알린다 · 조회 실패 null
    let pathwayLinksToSuperseded: number | null = 0;
    if (supersededIds.length) {
      pathwayLinksToSuperseded = await this.prisma.pathwayMilestone
        .count({ where: { OR: supersededIds.map((sid) => ({ detail: { path: ['orderSetId'], equals: sid } })) } })
        .catch(() => null);
    }
    return { ...updated, supersededIds, pathwayLinksToSuperseded };
  }

  /**
   * 승인 기록 남기기(2026-10-21 P2) — 승인 절차 없이 사용 중이 된 세트(운영 26/26)에 사람이 승인을 기록한다.
   * 데이터를 승인된 것으로 바꾸지 않는다 — 기록하는 사람이 승인자로 남고 근거는 감사 기록에 남는다.
   */
  async recordApproval(id: string, userId: string) {
    const os = await this.findById(id);
    if (os.status !== 'ACTIVE') throw new ConflictException({ code: 'ORDER_SET_NOT_ACTIVE', message: '사용 중인 세트만 승인 기록을 남깁니다' });
    if (os.approvedBy) throw new ConflictException({ code: 'ORDER_SET_ALREADY_APPROVED', message: '이미 승인 기록이 있습니다' });
    return this.prisma.orderSet.update({ where: { id }, data: { approvedBy: userId, approvedAt: new Date() } });
  }

  // ── Deprecate ──
  async deprecateOrderSet(id: string) {
    const os = await this.findById(id);
    if (os.status === 'DEPRECATED') {
      throw new BadRequestException('Already deprecated');
    }
    return this.prisma.orderSet.update({
      where: { id },
      data: { status: 'DEPRECATED' },
    });
  }

  // ── Search by drug name or diagnosis code in items JSON ──
  async searchOrderSets(query: string) {
    // Search in name, diagnosisCode, and within items JSON
    const results = await this.prisma.orderSet.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { diagnosisCode: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
          // Search within items JSON using raw query
          {
            items: {
              path: [],
              string_contains: query,
            },
          },
        ],
      },
      orderBy: [{ useCount: 'desc' }, { name: 'asc' }],
    });
    return results;
  }

  // ── Record usage ──
  async recordUsage(
    orderSetId: string,
    data: { encounterId: string; patientId: string; itemsApplied: number; itemsModified: number },
    userId: string,
  ) {
    await this.findById(orderSetId);
    const [usage] = await this.prisma.$transaction([
      this.prisma.orderSetUsage.create({
        data: {
          orderSetId,
          encounterId: data.encounterId,
          patientId: data.patientId,
          usedBy: userId,
          itemsApplied: data.itemsApplied,
          itemsModified: data.itemsModified,
        },
      }),
      this.prisma.orderSet.update({
        where: { id: orderSetId },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      }),
    ]);
    return usage;
  }

  // ── Usage statistics ──
  async getUsageStats() {
    const [topUsed, byDepartment, totalUsages, modifiedUsages] = await Promise.all([
      // Top 10 by useCount
      this.prisma.orderSet.findMany({
        where: { isActive: true },
        orderBy: { useCount: 'desc' },
        take: 10,
        select: { id: true, name: true, code: true, department: true, useCount: true, category: true },
      }),
      // Group by department
      this.prisma.orderSet.groupBy({
        by: ['department'],
        where: { isActive: true, useCount: { gt: 0 } },
        _sum: { useCount: true },
        orderBy: { _sum: { useCount: 'desc' } },
      }),
      // Total usage count
      this.prisma.orderSetUsage.count(),
      // Modified usages (itemsModified > 0)
      this.prisma.orderSetUsage.count({ where: { itemsModified: { gt: 0 } } }),
    ]);
    // 🔴 (2026-09-17 L4) 사용 0 회면 '수정률 0%'(=아무도 손대지 않은 좋은 세트)가 아니라 산출 불가.
    const modificationRate = totalUsages > 0 ? Math.round((modifiedUsages / totalUsages) * 100) : null;
    return {
      topUsed,
      byDepartment: byDepartment.map(d => ({
        department: d.department ?? '미지정',
        totalUseCount: d._sum.useCount ?? 0,
      })),
      totalUsages,
      modificationRate,
    };
  }

  // ── Version history ──
  async getHistory(id: string) {
    const os = await this.findById(id);
    const rootId = os.parentId ?? os.id;
    return this.prisma.orderSet.findMany({
      where: {
        OR: [
          { id: rootId },
          { parentId: rootId },
        ],
      },
      orderBy: { version: 'desc' },
      select: {
        id: true, name: true, code: true, version: true, status: true,
        createdBy: true, approvedBy: true, approvedAt: true,
        createdAt: true, updatedAt: true,
      },
    });
  }

  // ── Favorite Orders ──

  async createFavorite(data: { name: string; items: unknown }, userId: string) {
    return this.prisma.favoriteOrder.create({
      data: { userId, name: data.name, items: data.items as Prisma.InputJsonValue },
    });
  }

  async getFavorites(userId: string) {
    return this.prisma.favoriteOrder.findMany({
      where: { userId },
      orderBy: { useCount: 'desc' },
    });
  }

  async useFavorite(id: string) {
    const fav = await this.prisma.favoriteOrder.findUnique({ where: { id } });
    if (!fav) throw new NotFoundException('Favorite not found');
    await this.prisma.favoriteOrder.update({ where: { id }, data: { useCount: { increment: 1 } } });
    return fav;
  }

  async removeFavorite(id: string) {
    return this.prisma.favoriteOrder.delete({ where: { id } });
  }
}
