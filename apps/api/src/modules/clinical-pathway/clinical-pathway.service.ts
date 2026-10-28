import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StandardGovernanceService } from '../gld/standard-governance.service';

/** 진행률·완료 판정에 쓰는 마일스톤 최소 형태 */
/**
 * 마일스톤 ↔ 약속처방 세트 연결(2026-10-07) — `detail.orderSetId`.
 * 🔴 경로 항목 제목("기본 검사 오더 (CBC, BMP, 심전도)")을 오더로 **풀어 쓰지 않는다**(지어내기) — 사람이 연결한 세트만 담기 대상.
 * 읽을 때 세트 이름·상태를 붙인다: 사용 중지·삭제된 세트는 `status` 로 말한다(담기 버튼을 그리지 않게).
 */
export type MilestoneOrderSet = { id: string; name: string | null; status: string | 'MISSING' };
export function milestoneOrderSetId(detail: unknown): string | null {
  const v = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>).orderSetId : null;
  return typeof v === 'string' && v ? v : null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GateMilestone {
  id: string;
  isRequired: boolean;
}

/**
 * 완료·진행률 **정본 산식** — 목록·상세·자동 완료판정이 모두 이 함수를 쓴다.
 *
 * 🔴 종전엔 산식이 두 벌이었다(W7 ⑩ · P12):
 *    - 목록 진행률 = `_count.outcomes` (상태 무관) → 6개를 전부 '건너뜀'으로 기록해도 100%·초록 막대
 *    - 자동 완료판정 = 필수 마일스톤이 전부 DONE 일 때만
 *    건너뜀·지연·이탈은 **완료가 아니다**. 분모는 완료판정 게이트(필수; 없으면 전체)와 같게 둔다.
 *    이로써 "진행률 100%"와 "자동 완료"가 항상 같은 순간을 가리킨다.
 */
export function computePathwayProgress(
  milestones: GateMilestone[],
  doneMilestoneIds: Set<string>,
) {
  const required = milestones.filter((m) => m.isRequired);
  const gate = required.length > 0 ? required : milestones;
  const completedMilestones = gate.filter((m) => doneMilestoneIds.has(m.id)).length;
  return {
    /** 경로 전체 마일스톤 수(참고 표시용) */
    totalMilestones: milestones.length,
    /** 진행률 분모 = 완료판정 게이트 수 */
    requiredMilestones: gate.length,
    /** 게이트 중 DONE 으로 기록된 수 — SKIPPED/DELAYED/DEVIATED 는 세지 않는다 */
    completedMilestones,
    // 마일스톤이 하나도 없으면 진행률은 0%가 아니라 산출 불가(null)다 — 표본 부재를 0으로 말하지 않는다
    progressRate: gate.length > 0 ? Math.round((completedMilestones / gate.length) * 100) : null,
  };
}

/** 완료판정 게이트 id — 필수 마일스톤, 없으면 전체(정본 규칙 1곳) */
export function gateMilestoneIds(milestones: GateMilestone[]): string[] {
  const required = milestones.filter((m) => m.isRequired);
  return (required.length > 0 ? required : milestones).map((m) => m.id);
}

@Injectable()
export class ClinicalPathwayService {
  constructor(
    private readonly prisma: PrismaService,
    /** 🔴 선택 주입 — 거버넌스 모듈이 없어도 발행은 되어야 한다(막는 것이 목적이 아니다) */
    @Optional() private readonly governance?: StandardGovernanceService,
  ) {}

  /** 경로 목록 조회 (마일스톤 수 포함) */
  async findAll(dept?: string, status?: string) {
    const where: Record<string, unknown> = {};
    if (dept) where.department = dept;
    if (status) where.status = status;

    const pathways = await this.prisma.clinicalPathway.findMany({
      where,
      include: { _count: { select: { milestones: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return pathways.map((p) => ({
      ...p,
      milestoneCount: p._count.milestones,
      _count: undefined,
    }));
  }

  /** 경로 상세 (마일스톤 포함) */
  async findOne(id: string) {
    const pathway = await this.prisma.clinicalPathway.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: [{ day: 'asc' }, { sortOrder: 'asc' }] },
        _count: { select: { assignments: true } },
      },
    });
    if (!pathway) throw new NotFoundException('경로를 찾을 수 없습니다.');
    return { ...pathway, milestones: await this.attachOrderSets(pathway.milestones), assignmentCount: pathway._count.assignments, _count: undefined };
  }

  /** 경로 생성 */
  async create(
    data: Record<string, unknown>,
    userId: string,
  ) {
    return this.prisma.clinicalPathway.create({
      data: {
        code: data.code as string,
        name: data.name as string,
        department: data.department as string,
        targetDrg: (data.targetDrg as string) ?? null,
        version: 1,
        status: 'DRAFT',
        totalDays: data.totalDays as number,
        description: (data.description as string) ?? null,
        createdBy: userId,
      },
    });
  }

  /** 경로 수정 */
  async update(id: string, data: Record<string, unknown>) {
    await this.ensurePathwayExists(id);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.targetDrg !== undefined) updateData.targetDrg = data.targetDrg;
    if (data.totalDays !== undefined) updateData.totalDays = data.totalDays;
    if (data.description !== undefined) updateData.description = data.description;

    return this.prisma.clinicalPathway.update({ where: { id }, data: updateData });
  }

  /**
   * DRAFT → ACTIVE 발행.
   *
   * 🔴 2026-08-27 — 종전에는 **관리자 한 명의 클릭**이 전부였다. 상태만 보고 `ACTIVE` 로 바꿨고,
   *    누가 눌렀는지도 남지 않았다(`ClinicalPathway` 에 발행자 컬럼 자체가 없었다).
   *    운영 실측: 급성심근경색·뇌경색·폐렴·CABG·인공관절 표준경로 5건이 그렇게 발효돼 있었다.
   *
   * 🔴 **권한을 좁히는 것이 아니라 근거를 요구한다.** 관리자는 그대로 누를 수 있고,
   *    요건 미충족이어도 기본값(WARN)에서는 막지 않는다 — 다만 **근거 없이 눌렀다는 사실이 남는다.**
   *    (막으면 환자에게 적용 중인 표준이 멈춘다 — 그건 안전측이 아니라 진료 중단이다.)
   */
  async publish(id: string, opts?: { userId?: string; decisionNo?: string | null }) {
    const pathway = await this.ensurePathwayExists(id);
    if (pathway.status !== 'DRAFT') {
      throw new BadRequestException('DRAFT 상태의 경로만 발행할 수 있습니다.');
    }
    const verdict = this.governance
      ? await this.governance.evaluate({ kind: 'PATHWAY', code: pathway.code, action: 'ENACT', decisionNo: opts?.decisionNo })
      : null;
    if (verdict) this.governance!.assertOrWarn(verdict);

    const updated = await this.prisma.clinicalPathway.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: opts?.userId ?? null,
        governanceRef: opts?.decisionNo ?? null,
      },
    });
    // 🔴 판정을 응답에 담는다 — 화면이 "근거 없이 발효했다"를 그 자리에서 말할 수 있어야 한다
    return { ...updated, governance: verdict };
  }

  /** ACTIVE -> RETIRED 폐기 */
  async retire(id: string) {
    const pathway = await this.ensurePathwayExists(id);
    if (pathway.status !== 'ACTIVE') {
      throw new BadRequestException('ACTIVE 상태의 경로만 폐기할 수 있습니다.');
    }
    return this.prisma.clinicalPathway.update({
      where: { id },
      data: { status: 'RETIRED' },
    });
  }

  /** 경로 복제 (새 버전) */
  async clone(id: string, userId: string) {
    const source = await this.prisma.clinicalPathway.findUnique({
      where: { id },
      include: { milestones: true },
    });
    if (!source) throw new NotFoundException('원본 경로를 찾을 수 없습니다.');

    const maxVersion = await this.prisma.clinicalPathway.aggregate({
      where: { code: source.code },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const cloned = await tx.clinicalPathway.create({
        data: {
          code: `${source.code}_v${nextVersion}`,
          name: source.name,
          department: source.department,
          targetDrg: source.targetDrg,
          version: nextVersion,
          status: 'DRAFT',
          totalDays: source.totalDays,
          description: source.description,
          createdBy: userId,
        },
      });

      if (source.milestones.length > 0) {
        await tx.pathwayMilestone.createMany({
          data: source.milestones.map((m) => ({
            pathwayId: cloned.id,
            day: m.day,
            category: m.category,
            title: m.title,
            detail: m.detail ?? undefined,
            isRequired: m.isRequired,
            sortOrder: m.sortOrder,
          })),
        });
      }

      return tx.clinicalPathway.findUnique({
        where: { id: cloned.id },
        include: { milestones: true },
      });
    });
  }

  /**
   * `detail.orderSetId` 검증 — 문자열이면 UUID 이고 **사용 중인 세트**여야 한다(없는 세트를 연결해 두지 않는다).
   * `null` 은 연결 해제(키 제거). 그 밖의 detail 키는 그대로 둔다(미지 키 보존).
   */
  private async normalizeMilestoneDetail(detail: unknown, base?: unknown): Promise<object | undefined> {
    if (detail === undefined) return undefined;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new BadRequestException('detail 은 객체여야 합니다.');
    const merged: Record<string, unknown> = {
      ...(base && typeof base === 'object' && !Array.isArray(base) ? (base as Record<string, unknown>) : {}),
      ...(detail as Record<string, unknown>),
    };
    if ('orderSetId' in (detail as Record<string, unknown>)) {
      const v = (detail as Record<string, unknown>).orderSetId;
      if (v === null || v === '') delete merged.orderSetId;
      else {
        if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadRequestException('orderSetId 는 UUID 여야 합니다.');
        const set = await this.prisma.orderSet.findUnique({ where: { id: v }, select: { status: true, isActive: true } });
        // 목록(`order-sets`)이 isActive=false 를 지운 세트로 숨긴다 — 같은 기준으로 없는 것으로 본다
        if (!set || set.isActive === false) throw new BadRequestException('연결할 약속처방 세트를 찾을 수 없습니다.');
        if (set.status !== 'ACTIVE') throw new BadRequestException('사용 중이 아닌 약속처방 세트는 연결할 수 없습니다.');
      }
    }
    return merged;
  }

  /** 마일스톤에 연결된 세트의 이름·상태를 붙인다(읽기 전용 · 원 detail 은 그대로) */
  private async attachOrderSets<T extends { detail: unknown }>(milestones: T[]): Promise<(T & { orderSet: MilestoneOrderSet | null })[]> {
    const ids = [...new Set(milestones.map((m) => milestoneOrderSetId(m.detail)).filter((x): x is string => !!x && UUID_RE.test(x)))];
    const sets = ids.length
      ? await this.prisma.orderSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true, isActive: true } })
      : [];
    const byId = new Map(sets.map((x) => [x.id, x]));
    return milestones.map((m) => {
      const id = milestoneOrderSetId(m.detail);
      if (!id) return { ...m, orderSet: null };
      const found = byId.get(id);
      if (!found) return { ...m, orderSet: { id, name: null, status: 'MISSING' } };
      // 지워진(isActive=false) 세트는 이름은 말하되 담기 대상이 아니다
      return { ...m, orderSet: { id, name: found.name, status: found.isActive === false ? 'DELETED' : found.status } };
    });
  }

  /** 마일스톤 추가 */
  async addMilestone(pathwayId: string, data: Record<string, unknown>) {
    await this.ensurePathwayExists(pathwayId);
    const detail = await this.normalizeMilestoneDetail(data.detail);
    return this.prisma.pathwayMilestone.create({
      data: {
        pathwayId,
        day: data.day as number,
        category: data.category as string,
        title: data.title as string,
        detail,
        isRequired: (data.isRequired as boolean) ?? true,
        sortOrder: (data.sortOrder as number) ?? 0,
      },
    });
  }

  /** 마일스톤 수정 */
  async updateMilestone(id: string, data: Record<string, unknown>) {
    const exists = await this.prisma.pathwayMilestone.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('마일스톤을 찾을 수 없습니다.');

    const updateData: Record<string, unknown> = {};
    if (data.day !== undefined) updateData.day = data.day;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.detail !== undefined) updateData.detail = await this.normalizeMilestoneDetail(data.detail, exists.detail);
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

    return this.prisma.pathwayMilestone.update({ where: { id }, data: updateData });
  }

  /** 마일스톤 삭제 */
  async deleteMilestone(id: string) {
    const exists = await this.prisma.pathwayMilestone.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('마일스톤을 찾을 수 없습니다.');
    await this.prisma.pathwayMilestone.delete({ where: { id } });
    return { deleted: true };
  }

  /** 환자에게 경로 배정 */
  async assign(
    pathwayId: string,
    data: Record<string, unknown>,
    userId: string,
  ) {
    const pathway = await this.ensurePathwayExists(pathwayId);
    if (pathway.status !== 'ACTIVE') {
      throw new BadRequestException('ACTIVE 상태의 경로만 배정할 수 있습니다.');
    }

    // 중복 배정 가드 — 동일 환자에게 동일 경로의 활성 배정이 이미 있으면 거부(진행률·이탈 카운트 이원화 방지)
    const existing = await this.prisma.pathwayAssignment.findFirst({
      where: { pathwayId, patientId: data.patientId as string, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('이미 이 환자에게 동일 경로의 활성 배정이 존재합니다. 기존 배정을 완료/취소 후 재배정하세요.');
    }

    // 🔴 종전엔 startDate 없이 오면 `new Date(undefined)`=Invalid Date 로 Prisma 단계에서 터졌다.
    //    화면은 "경로 적용에 실패했습니다"만 띄우고 이유를 말하지 못했다(배정 0행의 한 원인).
    //    시작일은 경과일·진행률·재원일 계산의 기준이라 **추정하지 않고** 명시를 요구한다.
    const startDate = data.startDate ? new Date(String(data.startDate)) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      throw new BadRequestException('경로 시작일(startDate)이 필요합니다.');
    }

    return this.prisma.pathwayAssignment.create({
      data: {
        pathwayId,
        patientId: data.patientId as string,
        encounterId: data.encounterId as string,
        startDate,
        status: 'ACTIVE',
        deviations: 0,
        note: (data.note as string) ?? null,
        assignedBy: userId,
      },
      include: { pathway: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
  }

  /**
   * 배정 목록 조회 (진행률 포함)
   *
   * `deviatedOnly` — 이탈이 1건 이상 기록된 배정만.
   * 🔴 배정 상태에 'DEVIATED' 를 쓰는 코드는 어디에도 없다(이탈은 `deviations` 카운트로만 남는다).
   *    그래서 화면의 '이탈' 상태 필터는 영구 0건이었고, 이탈 5건인 배정도 배지는 "진행중"이었다(W7 ⑫).
   *    상태를 조작하는 대신(그러면 recordOutcome 이 ACTIVE 가 아니라며 이후 기록을 거부한다)
   *    사실 그대로 '이탈 발생' 조건으로 거른다.
   */
  async getAssignments(status?: string, patientId?: string, deviatedOnly?: boolean) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    if (deviatedOnly) where.deviations = { gt: 0 };

    const assignments = await this.prisma.pathwayAssignment.findMany({
      where,
      include: {
        pathway: { select: { name: true, code: true, totalDays: true, department: true } },
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (assignments.length === 0) return [];

    // 배정마다 count 를 돌리던 N+1 을 두 번의 배치 조회로 대체
    const [milestones, doneOutcomes] = await Promise.all([
      this.prisma.pathwayMilestone.findMany({
        where: { pathwayId: { in: [...new Set(assignments.map((a) => a.pathwayId))] } },
        select: { id: true, pathwayId: true, isRequired: true },
      }),
      this.prisma.milestoneOutcome.findMany({
        where: { assignmentId: { in: assignments.map((a) => a.id) }, status: 'DONE' },
        select: { assignmentId: true, milestoneId: true },
      }),
    ]);

    const byPathway = new Map<string, GateMilestone[]>();
    for (const m of milestones) {
      const list = byPathway.get(m.pathwayId) ?? [];
      list.push({ id: m.id, isRequired: m.isRequired });
      byPathway.set(m.pathwayId, list);
    }
    const doneByAssignment = new Map<string, Set<string>>();
    for (const o of doneOutcomes) {
      const set = doneByAssignment.get(o.assignmentId) ?? new Set<string>();
      set.add(o.milestoneId);
      doneByAssignment.set(o.assignmentId, set);
    }

    return assignments.map((a) => ({
      ...a,
      // 진행률은 상세·완료판정과 같은 정본 산식(computePathwayProgress) 하나로만 낸다
      ...computePathwayProgress(
        byPathway.get(a.pathwayId) ?? [],
        doneByAssignment.get(a.id) ?? new Set<string>(),
      ),
    }));
  }

  /** 배정 상세 (결과 포함) — 목록과 같은 진행률 필드를 함께 내려준다 */
  async getAssignment(id: string) {
    const assignment = await this.prisma.pathwayAssignment.findUnique({
      where: { id },
      include: {
        pathway: { include: { milestones: { orderBy: [{ day: 'asc' }, { sortOrder: 'asc' }] } } },
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        outcomes: { include: { milestone: true }, orderBy: { performedAt: 'asc' } },
      },
    });
    if (!assignment) throw new NotFoundException('배정 정보를 찾을 수 없습니다.');

    // 🔴 종전엔 상세에 totalMilestones/completedMilestones 가 없어서(목록 EP 에만 있었다)
    //    화면 진행률이 `undefined > 0` → false → **항상 0%** 였다(W7 ⑪ · P11).
    const done = new Set(
      assignment.outcomes.filter((o) => o.status === 'DONE').map((o) => o.milestoneId),
    );
    return {
      ...assignment,
      pathway: { ...assignment.pathway, milestones: await this.attachOrderSets(assignment.pathway.milestones) },
      ...computePathwayProgress(
        assignment.pathway.milestones.map((m) => ({ id: m.id, isRequired: m.isRequired })),
        done,
      ),
    };
  }

  /** 마일스톤 결과 기록 (DONE / SKIPPED / DELAYED / DEVIATED) */
  async recordOutcome(assignmentId: string, data: Record<string, unknown>, performedBy?: string) {
    const assignment = await this.prisma.pathwayAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('배정 정보를 찾을 수 없습니다.');
    if (assignment.status !== 'ACTIVE') {
      throw new BadRequestException('ACTIVE 상태의 배정만 결과를 기록할 수 있습니다.');
    }

    // FE 호환: status(정식) 또는 outcome(별칭) 허용
    const outcomeStatus = (data.status ?? data.outcome) as string;
    const validStatuses = ['DONE', 'SKIPPED', 'DELAYED', 'DEVIATED'];
    if (!validStatuses.includes(outcomeStatus)) {
      throw new BadRequestException(`상태는 ${validStatuses.join(', ')} 중 하나여야 합니다.`);
    }
    // actualDay 미전달 시 배정 시작일 기준 자동 계산(1일 이상)
    const actualDay = (data.actualDay as number) ??
      Math.max(1, Math.ceil((Date.now() - new Date(assignment.startDate).getTime()) / (1000 * 60 * 60 * 24)));

    // 마일스톤 소속 검증 — 타 경로의 마일스톤 id로 기록하면 완료판정·진행률이 오염됨
    const milestoneId = data.milestoneId as string;
    const milestone = await this.prisma.pathwayMilestone.findUnique({
      where: { id: milestoneId },
      select: { pathwayId: true },
    });
    if (!milestone) throw new NotFoundException('마일스톤을 찾을 수 없습니다.');
    if (milestone.pathwayId !== assignment.pathwayId) {
      throw new BadRequestException('이 배정의 경로에 속하지 않는 마일스톤입니다.');
    }

    // 동일 (배정, 마일스톤) 재기록은 갱신 — DB unique와 함께 중복 레코드로 인한 조기완료를 근절
    const prev = await this.prisma.milestoneOutcome.findUnique({
      where: { assignmentId_milestoneId: { assignmentId, milestoneId } },
      select: { status: true },
    });
    // 게이트 판정에 쓸 마일스톤 목록은 트랜잭션 **밖**에서 먼저 읽는다(조회를 트랜잭션에 넣지 않는다).
    // 자동 완료 판정 — 필수(isRequired) 마일스톤이 전부 DONE일 때만(필수 없으면 전체 기준).
    // 과거 outcome 총 개수 비교는 중복/SKIPPED도 완료로 세어 조기완료를 유발했음.
    // 게이트 규칙은 진행률(computePathwayProgress)과 **같은 함수**에서 나온다 — 두 벌이면 또 갈라진다.
    const pathwayMilestones = await this.prisma.pathwayMilestone.findMany({
      where: { pathwayId: assignment.pathwayId },
      select: { id: true, isRequired: true },
    });
    const gateIds = gateMilestoneIds(pathwayMilestones);

    /**
     * 🔴 (2026-09-16 I2) 결과 기록·이탈 카운트·완료 판정을 한 트랜잭션에서 쓴다.
     *    종전엔 결과만 커밋되고 이탈 증가가 따로 나가, 중간 실패 시 이탈이 누락된다. 재기록하면
     *    `prev.status` 가 이미 DEVIATED 라 증감이 0 이 되어 **그 이탈은 영원히 집계되지 않는다**
     *    (경로 이탈률이 조용히 좋아진다).
     */
    const outcome = await this.prisma.$transaction(async (tx) => {
    const created = await tx.milestoneOutcome.upsert({
      where: { assignmentId_milestoneId: { assignmentId, milestoneId } },
      create: {
        assignmentId,
        milestoneId,
        actualDay,
        status: outcomeStatus,
        // FE 호환: variance(정식) 또는 note(별칭)
        variance: ((data.variance ?? data.note) as string) ?? null,
        // 🔴 (2026-09-15 B9) 시행자는 로그인 사용자 — 종전엔 본문 `performedBy` 를 그대로 적었다(요청자가 남의 이름으로 기록)
        performedBy: performedBy ?? null,
      },
      update: {
        actualDay,
        status: outcomeStatus,
        variance: ((data.variance ?? data.note) as string) ?? null,
        performedBy: performedBy ?? null,
        performedAt: new Date(),
      },
    });

    // 이탈(DEVIATED) 카운트 — 상태 전이 기준으로만 증감(재기록 중복 증가 방지)
    const deviationDelta = (outcomeStatus === 'DEVIATED' ? 1 : 0) - (prev?.status === 'DEVIATED' ? 1 : 0);
    if (deviationDelta !== 0) {
      await tx.pathwayAssignment.update({
        where: { id: assignmentId },
        data: { deviations: { increment: deviationDelta } },
      });
    }

    if (gateIds.length > 0) {
      const doneCount = await tx.milestoneOutcome.count({
        where: { assignmentId, status: 'DONE', milestoneId: { in: gateIds } },
      });
      if (doneCount >= gateIds.length) {
        const diffMs = new Date().getTime() - new Date(assignment.startDate).getTime();
        const actualDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        await tx.pathwayAssignment.update({
          where: { id: assignmentId },
          data: { status: 'COMPLETED', completedAt: new Date(), actualDays },
        });
      }
    }

    return created;
    });

    return outcome;
  }

  /** 배정 취소 */
  async cancelAssignment(id: string) {
    const assignment = await this.prisma.pathwayAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundException('배정 정보를 찾을 수 없습니다.');
    if (assignment.status !== 'ACTIVE') {
      throw new BadRequestException('ACTIVE 상태의 배정만 취소할 수 있습니다.');
    }

    return this.prisma.pathwayAssignment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * 경로 분석 (완료율, 이탈율, 평균 재원일수) — **경로별 배열**을 돌려준다.
   *
   * 🔴 표본이 0인데 `completionRate: 0`·`deviationRate: 0` 을 돌려주면
   *    화면이 "완료율 0% · 이탈률 0%(=이탈 없음, 양호)"로 읽힌다(W7 ⑭ · P1).
   *    적용된 배정이 없으면 비율은 0이 아니라 **산출 불가(null)** 다.
   */
  async getAnalytics(dept?: string) {
    const pathwayWhere: Record<string, unknown> = {};
    if (dept) pathwayWhere.department = dept;

    const pathways = await this.prisma.clinicalPathway.findMany({
      where: pathwayWhere,
      select: { id: true, name: true, code: true, department: true, totalDays: true },
    });

    const pathwayIds = pathways.map((p) => p.id);
    if (pathwayIds.length === 0) return [];

    const analytics = await Promise.all(
      pathways.map(async (pathway) => {
        const assignments = await this.prisma.pathwayAssignment.findMany({
          where: { pathwayId: pathway.id },
          select: { status: true, deviations: true, actualDays: true },
        });

        const total = assignments.length;
        const completed = assignments.filter((a) => a.status === 'COMPLETED').length;
        const completedWithDeviations = assignments.filter(
          (a) => a.status === 'COMPLETED' && a.deviations > 0,
        ).length;
        const completedDays = assignments
          .filter((a) => a.status === 'COMPLETED' && a.actualDays !== null)
          .map((a) => a.actualDays as number);
        const avgDays =
          completedDays.length > 0
            ? Math.round(completedDays.reduce((sum, d) => sum + d, 0) / completedDays.length)
            : null;

        return {
          pathwayId: pathway.id,
          pathwayName: pathway.name,
          pathwayCode: pathway.code,
          department: pathway.department,
          expectedDays: pathway.totalDays,
          totalAssignments: total,
          completedCount: completed,
          // 분모가 없으면 null — 0% 로 말하면 "완료가 하나도 안 됐다"는 다른 사실이 된다
          completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
          completionNumerator: completed,
          completionDenominator: total,
          // 이탈률의 분모는 '완료된 배정' — 완료 표본이 없으면 이탈률도 산출 불가
          deviationRate:
            completed > 0 ? Math.round((completedWithDeviations / completed) * 100) : null,
          /**
           * 🔴 이탈률의 **분자**(이탈이 있는 완료 배정 수)와 **분모**(완료 배정 수).
           *    비율만 보내면 화면은 `completionRate` 의 분모(전체 배정)와 혼동한다 —
           *    두 비율의 분모가 서로 다르다는 사실이 응답에 드러나야 한다.
           */
          deviationNumerator: completedWithDeviations,
          deviationDenominator: completed,
          avgActualDays: avgDays,
          activeCount: assignments.filter((a) => a.status === 'ACTIVE').length,
          cancelledCount: assignments.filter((a) => a.status === 'CANCELLED').length,
        };
      }),
    );

    return analytics;
  }

  // ── 내부 헬퍼 ──

  private async ensurePathwayExists(id: string) {
    const pathway = await this.prisma.clinicalPathway.findUnique({ where: { id } });
    if (!pathway) throw new NotFoundException('경로를 찾을 수 없습니다.');
    return pathway;
  }
}
