import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { prescribedByWhere, responsiblePrescriberOf } from '../../common/responsible-prescriber';

// ── Types ──

export const INTERVENTION_TYPES = ['DOSE', 'INTERACTION', 'DUPLICATE', 'ROUTE', 'OTHER'] as const;
export type InterventionType = (typeof INTERVENTION_TYPES)[number];

/** 중재 상태 — PENDING 은 "아직 회신을 못 받았다"는 사실이지 실패가 아니다. */
export const INTERVENTION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export const TDM_STATUSES = ['REQUESTED', 'SAMPLED', 'RESULTED', 'REVIEWED'] as const;
export type TdmStatus = (typeof TDM_STATUSES)[number];

/** 목록 상한 — 잘랐으면 잘랐다고 말한다(meta.truncated). */
export const LIST_LIMIT = 200;

export interface Intervention {
  id: string;
  pharmacistId: string;
  /** 사용자 원장에서 조회 — 알 수 없으면 null(빈 문자열로 지어내지 않는다) */
  pharmacistName: string | null;
  patientId: string;
  patientName: string | null;
  prescriptionId: string | null;
  /**
   * 책임 처방의(회신할 사람) — 연결 처방에서 **읽을 때 도출**한다(정본 `responsiblePrescriberOf`).
   * 처방 연결이 없거나 처방을 찾지 못하면 null — "회신할 의사를 모른다"는 사실이다(지어내지 않는다).
   */
  prescriberId: string | null;
  prescriberName: string | null;
  /** 중재 대상 약물 표기(처방 삭제 후에도 남는 기록) — 미기재면 null */
  prescriptionDrug: string | null;
  type: InterventionType;
  reason: string;
  suggestion: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  doctorResponse: string | null;
  respondedBy: string | null;
  /** 실제 응답이 있을 때만 채워진다 — 모르는 시각을 지어내지 않는다 */
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TdmRequest {
  id: string;
  patientId: string;
  patientName: string | null;
  drugName: string;
  indication: string | null;
  /** 목표범위 — 입력이 없으면 null(0 으로 채우지 않는다) */
  targetRangeMin: number | null;
  targetRangeMax: number | null;
  targetUnit: string | null;
  status: TdmStatus;
  /** 실측 농도 — 결과 입력 전에는 null */
  resultLevel: number | null;
  resultInterpretation: string | null;
  doseRecommendation: string | null;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  sampledAt: string | null;
  resultedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AdrReport {
  id: string;
  patientId: string;
  patientName: string;
  suspectedDrug: string;
  reaction: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'FATAL';
  onsetDate: string;
  outcome: string;
  causalityAssessment: string;
  /**
   * Naranjo 총점 — 계산하지 않았으면 null. 🔴 0 으로 채우지 않는다:
   * Naranjo 0 은 "의심(UNLIKELY)"이라는 임상 판정이지 "평가하지 않았다"가 아니다.
   */
  naranjoScore: number | null;
  kaersReportId?: string;
  reportedBy: string;
  reportedAt: string;
}

export interface AspRequest {
  id: string;
  patientId: string;
  patientName: string;
  antimicrobialName: string;
  indication: string;
  duration: number;
  durationUnit: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
}

/**
 * 처방의 통지 결과 — 대외 발신 결과와 같은 모양(`{attempted, sent, reason}`).
 * 🔴 "보냈습니다"≠도달 — 여기서 말하는 sent 는 **원내 알림 원장에 한 줄 생겼다**는 뜻까지다.
 */
export interface PrescriberNotice {
  attempted: boolean;
  sent: boolean;
  /** NO_PRESCRIPTION(연결 처방 없음 → 받을 사람을 모름) · NO_NOTIFIER(알림 서비스 미주입) · FAILED */
  reason: 'NO_PRESCRIPTION' | 'NO_NOTIFIER' | 'FAILED' | null;
}

type InterventionRow = {
  id: string; pharmacistId: string; patientId: string; prescriptionId: string | null;
  drugText: string | null; type: string; reason: string; suggestion: string; status: string;
  doctorResponse: string | null; respondedBy: string | null; respondedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

export interface ListPage<T> {
  items: T[];
  /** 상한(LIST_LIMIT)에서 잘렸는가 */
  truncated: boolean;
  limit: number;
}

// ── Helpers ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | undefined | null, label: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestException(`${label}는 UUID 여야 합니다`);
  }
  return value;
}

/** 공백만 있는 입력은 값이 아니다 → null */
function nullableText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function requiredText(v: unknown, label: string): string {
  const t = nullableText(v);
  if (!t) throw new BadRequestException(`${label}은(는) 필수입니다`);
  return t;
}

/** 실측값이 없으면 null — 빈 입력을 0 으로 채우지 않는다 */
function nullableNumber(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new BadRequestException(`${label}은(는) 숫자여야 합니다`);
  return n;
}

function requiredNumber(v: unknown, label: string): number {
  const n = nullableNumber(v, label);
  if (n === null) throw new BadRequestException(`${label}은(는) 필수입니다`);
  return n;
}

/** Prisma Decimal | null → number | null (없는 값은 0 이 아니다) */
function decimalToNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v as never);
  return Number.isFinite(n) ? n : null;
}

function iso(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
}

function fullName(p: { familyName?: string | null; givenName?: string | null } | undefined | null): string | null {
  if (!p) return null;
  const name = `${p.familyName ?? ''}${p.givenName ?? ''}`.trim();
  return name.length ? name : null;
}

@Injectable()
export class PharmacistActivityService {
  private readonly logger = new Logger(PharmacistActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 중재 등록 → 책임 처방의 인앱 알림(원내만 · 대외 발신 아님). 미주입이면 그렇다고 응답에 밝힌다.
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  // ── 이름 조회(관계 필드가 없는 모델 — ASP 와 동일 패턴) ──

  private async patientNameMap(ids: string[]): Promise<Map<string, string | null>> {
    const uniq = [...new Set(ids)].filter((id) => UUID_RE.test(id));
    if (!uniq.length) return new Map();
    const rows = await this.prisma.patient.findMany({
      where: { id: { in: uniq } },
      select: { id: true, familyName: true, givenName: true },
    });
    return new Map(rows.map((p) => [p.id, fullName(p)]));
  }

  private async userNameMap(ids: (string | null)[]): Promise<Map<string, string | null>> {
    const uniq = [...new Set(ids.filter((v): v is string => !!v && UUID_RE.test(v)))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, familyName: true, givenName: true },
    });
    return new Map(rows.map((u) => [u.id, fullName(u)]));
  }

  /** 환자 실재 확인 — 없는 환자에 임상 기록을 붙이지 않는다 */
  private async assertPatientExists(patientId: string): Promise<void> {
    const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!p) throw new NotFoundException('환자를 찾을 수 없습니다');
  }

  // ── Interventions (처방 중재) ──

  async getInterventions(filter?: {
    pharmacistId?: string; type?: string; status?: string; patientId?: string;
  }): Promise<ListPage<Intervention>> {
    const { pharmacistId, type, status, patientId } = filter ?? {};
    const where: Record<string, unknown> = {};
    if (pharmacistId) where.pharmacistId = assertUuid(pharmacistId, '약사 ID');
    if (patientId) where.patientId = assertUuid(patientId, '환자 ID');
    if (type) {
      if (!(INTERVENTION_TYPES as readonly string[]).includes(type)) {
        throw new BadRequestException(`중재 유형은 ${INTERVENTION_TYPES.join('|')} 중 하나여야 합니다`);
      }
      where.type = type;
    }
    // 🔴 절단(LIST_LIMIT) 이후의 미회신 건은 목록에서 사라진다 — 서버에서 걸러야
    //    "회신 대기 N건"이 화면 상한과 무관하게 사실이 된다.
    if (status) {
      if (!(INTERVENTION_STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestException(`중재 상태는 ${INTERVENTION_STATUSES.join('|')} 중 하나여야 합니다`);
      }
      where.status = status;
    }

    const rows = await this.prisma.pharmacistIntervention.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT + 1,
    });
    const truncated = rows.length > LIST_LIMIT;
    const page = truncated ? rows.slice(0, LIST_LIMIT) : rows;

    return { items: await this.decorateInterventions(page), truncated, limit: LIST_LIMIT };
  }

  /** 연결 처방 → 책임 처방의 맵(읽을 때 도출 — 스키마에 처방의 컬럼을 두지 않는다) */
  private async prescriberMap(prescriptionIds: (string | null)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(prescriptionIds.filter((v): v is string => !!v && UUID_RE.test(v)))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.prescription.findMany({
      where: { id: { in: uniq } },
      select: { id: true, prescriberId: true, createdBy: true },
    });
    return new Map(rows.map((rx) => [rx.id, responsiblePrescriberOf(rx)]));
  }

  /** 이름·책임 처방의를 붙인다(목록·단건 공통) */
  private async decorateInterventions(page: InterventionRow[]): Promise<Intervention[]> {
    const rxmap = await this.prescriberMap(page.map((r) => r.prescriptionId));
    const [pmap, umap] = await Promise.all([
      this.patientNameMap(page.map((r) => r.patientId)),
      this.userNameMap([
        ...page.map((r) => r.pharmacistId),
        ...page.map((r) => r.respondedBy),
        ...rxmap.values(),
      ]),
    ]);
    return page.map((r) => this.mapIntervention(r, pmap, umap, rxmap));
  }

  /**
   * 🔴 의사의 회신 워크리스트 — "내 처방에 달린 중재".
   *
   * 종전엔 목록 EP 가 약사·관리자 전용이고 화면도 약사 메뉴뿐이라, 회신 EP 가 의사에게 열려 있어도
   * **의사가 자기 앞으로 온 중재를 볼 길이 없었다**(워크리스트가 없으면 직원은 기억으로 일한다).
   * 책임 처방의는 연결 처방에서 도출한다 — 처방 연결이 없는 중재는 받을 사람을 모르므로 여기 나오지 않는다
   * (약사 화면에는 "처방의 미상"으로 보인다).
   */
  async getMyInterventions(userId: string, status?: string): Promise<ListPage<Intervention>> {
    const me = assertUuid(userId, '사용자 ID');
    const st = status || 'PENDING';
    if (!(INTERVENTION_STATUSES as readonly string[]).includes(st)) {
      // 문장에 값을 녹이지 않는다(서버 조립 한국어 가드) — 허용 어휘는 details 로 싣는다
      throw new BadRequestException({ code: 'INVALID_INTERVENTION_STATUS', message: '중재 상태 값이 올바르지 않습니다', details: { allowed: INTERVENTION_STATUSES } });
    }
    // ① 그 상태의 중재가 가리키는 처방 id → ② 그중 내가 책임 처방의인 것 → ③ 그 처방들의 중재
    //    (중재↔처방 관계 필드가 없는 모델 — 스키마를 바꾸지 않고 두 번 좁힌다)
    const refs = await this.prisma.pharmacistIntervention.findMany({
      where: { status: st, prescriptionId: { not: null } },
      select: { prescriptionId: true },
      distinct: ['prescriptionId'],
    });
    const ids = refs.map((r) => r.prescriptionId).filter((v): v is string => !!v);
    if (!ids.length) return { items: [], truncated: false, limit: LIST_LIMIT };
    const mine = await this.prisma.prescription.findMany({
      where: { id: { in: ids }, ...prescribedByWhere(me) },
      select: { id: true },
    });
    if (!mine.length) return { items: [], truncated: false, limit: LIST_LIMIT };

    const rows = await this.prisma.pharmacistIntervention.findMany({
      where: { status: st, prescriptionId: { in: mine.map((m) => m.id) } },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT + 1,
    });
    const truncated = rows.length > LIST_LIMIT;
    const page = truncated ? rows.slice(0, LIST_LIMIT) : rows;
    return { items: await this.decorateInterventions(page), truncated, limit: LIST_LIMIT };
  }

  /**
   * 🔴 회신 권한 — 의사는 **자기 처방에 달린 중재에만** 회신한다(관리자·약사 대리 기록은 종전 그대로).
   *
   * 종전엔 PATCH 가 DOCTOR 를 받기만 하고 누구의 처방인지 보지 않아, **아무 의사나 아무 중재에**
   * 수락/거절을 기록할 수 있었다(회신 주체가 처방 책임과 어긋난다).
   * 쓰기(`updateIntervention`)와 분리해 둔다 — 멱등 스캐너가 생성/전이 메서드 안의 조회를 사전 확인으로 읽는다.
   */
  async assertCanRespond(id: string, actor: { id: string; role: UserRole | string }): Promise<void> {
    if (actor.role !== UserRole.DOCTOR) return; // ADMIN·PHARMACIST — 종전 규약(역할은 컨트롤러 @Roles 가 정한다)
    assertUuid(id, '중재 ID');
    const intv = await this.prisma.pharmacistIntervention.findUnique({ where: { id }, select: { prescriptionId: true } });
    if (!intv) throw new NotFoundException('중재 기록을 찾을 수 없습니다');
    if (!intv.prescriptionId) {
      // 처방 연결이 없으면 책임 처방의를 알 수 없다 — 모르면 안전측(의사 직접 회신 불가 · 약사가 기록)
      throw new ForbiddenException({ code: 'INTERVENTION_NO_PRESCRIPTION', message: '처방이 연결되지 않은 중재는 책임 처방의를 알 수 없어 의사가 직접 회신할 수 없습니다' });
    }
    const rx = await this.prisma.prescription.findUnique({
      where: { id: intv.prescriptionId },
      select: { prescriberId: true, createdBy: true },
    });
    if (!rx || responsiblePrescriberOf(rx) !== actor.id) {
      throw new ForbiddenException({ code: 'NOT_RESPONSIBLE_PRESCRIBER', message: '본인이 책임 처방의인 처방의 중재에만 회신할 수 있습니다' });
    }
  }

  private mapIntervention(
    r: InterventionRow,
    pmap: Map<string, string | null>,
    umap: Map<string, string | null>,
    rxmap: Map<string, string> = new Map(),
  ): Intervention {
    const prescriberId = r.prescriptionId ? rxmap.get(r.prescriptionId) ?? null : null;
    return {
      id: r.id,
      pharmacistId: r.pharmacistId,
      pharmacistName: umap.get(r.pharmacistId) ?? null,
      patientId: r.patientId,
      patientName: pmap.get(r.patientId) ?? null,
      prescriptionId: r.prescriptionId,
      prescriberId,
      prescriberName: prescriberId ? umap.get(prescriberId) ?? null : null,
      prescriptionDrug: r.drugText,
      type: r.type as InterventionType,
      reason: r.reason,
      suggestion: r.suggestion,
      status: r.status as Intervention['status'],
      doctorResponse: r.doctorResponse,
      respondedBy: r.respondedBy,
      respondedAt: iso(r.respondedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async createIntervention(data: {
    pharmacistId: string;
    patientId: string;
    prescriptionId?: string | null;
    prescriptionDrug?: string | null;
    type: string;
    reason: string;
    suggestion: string;
  }): Promise<Intervention & { prescriberNotice: PrescriberNotice }> {
    const pharmacistId = assertUuid(data.pharmacistId, '약사 ID');
    const patientId = assertUuid(data.patientId, '환자 ID');
    if (!(INTERVENTION_TYPES as readonly string[]).includes(data.type)) {
      throw new BadRequestException(`중재 유형은 ${INTERVENTION_TYPES.join('|')} 중 하나여야 합니다`);
    }
    const reason = requiredText(data.reason, '중재 사유');
    const suggestion = requiredText(data.suggestion, '중재 제안');
    const drugText = nullableText(data.prescriptionDrug);

    await this.assertPatientExists(patientId);

    // 처방 연결은 선택 — 넣었다면 실재하고 그 환자의 처방이어야 한다(잘못 연결된 중재 방지)
    let prescriptionId: string | null = null;
    let prescriberId: string | null = null;
    const rawRx = nullableText(data.prescriptionId);
    if (rawRx) {
      prescriptionId = assertUuid(rawRx, '처방 ID');
      const rx = await this.prisma.prescription.findUnique({
        where: { id: prescriptionId },
        select: { id: true, prescriberId: true, createdBy: true, encounter: { select: { patientId: true } } },
      });
      if (!rx) throw new NotFoundException('처방을 찾을 수 없습니다');
      if (rx.encounter?.patientId !== patientId) {
        throw new BadRequestException('해당 환자의 처방이 아닙니다');
      }
      prescriberId = responsiblePrescriberOf(rx);
    }

    const row = await this.prisma.pharmacistIntervention.create({
      data: {
        pharmacistId, patientId, prescriptionId: prescriptionId ?? undefined,
        drugText: drugText ?? undefined,
        type: data.type, reason, suggestion,
        // status/createdAt 은 스키마 기본값(PENDING·now) — 시각을 코드에서 지어내지 않는다
      },
    });

    const [pmap, umap] = await Promise.all([
      this.patientNameMap([row.patientId]),
      this.userNameMap([row.pharmacistId, prescriberId]),
    ]);
    const rxmap = new Map<string, string>(prescriptionId && prescriberId ? [[prescriptionId, prescriberId]] : []);
    const out = this.mapIntervention(row, pmap, umap, rxmap);
    const prescriberNotice = await this.noticePrescriber(out);
    return { ...out, prescriberNotice };
  }

  /**
   * 🔴 중재 등록 → 책임 처방의에게 **원내 인앱 알림**(대외 발신 아님). 종전엔 등록만 하고 아무에게도 알리지 않아,
   *    의사는 약사가 전화하지 않는 한 중재가 있는지조차 몰랐다. 알림 실패는 중재 기록을 되돌리지 않는다(비차단) —
   *    다만 실패를 성공으로 말하지 않고 응답에 그대로 싣는다.
   *    문장은 조립하지 않는다(서버 조립 한국어 가드) — 제목은 고정 문구, 본문은 환자·약물 값만.
   */
  private async noticePrescriber(intv: Intervention): Promise<PrescriberNotice> {
    if (!intv.prescriberId) return { attempted: false, sent: false, reason: 'NO_PRESCRIPTION' };
    if (!this.notifications) return { attempted: false, sent: false, reason: 'NO_NOTIFIER' };
    const parts = [intv.patientName, intv.prescriptionDrug].filter((v): v is string => !!v);
    try {
      await this.notifications.notify(intv.prescriberId, {
        type: 'PHARMACIST_INTERVENTION',
        title: '💊 약사 중재 — 회신 요청',
        message: parts.length ? parts.join(' · ') : intv.suggestion.slice(0, 120),
        severity: 'WARNING',
        refType: 'PHARMACIST_INTERVENTION',
        refId: intv.id,
      });
      return { attempted: true, sent: true, reason: null };
    } catch (e) {
      this.logger.warn(`중재 처방의 알림 실패(비차단) intervention=${intv.id}: ${(e as Error).message}`);
      return { attempted: true, sent: false, reason: 'FAILED' };
    }
  }

  async updateIntervention(id: string, data: {
    status: 'ACCEPTED' | 'REJECTED';
    doctorResponse?: string | null;
    respondedBy: string;
  }): Promise<Intervention> {
    assertUuid(id, '중재 ID');
    const respondedBy = assertUuid(data.respondedBy, '응답자 ID');
    if (data.status !== 'ACCEPTED' && data.status !== 'REJECTED') {
      throw new BadRequestException('처리 상태는 ACCEPTED|REJECTED 여야 합니다');
    }

    // 원자 처리 — PENDING 만 전이(동시 이중 처리 차단·ASP 와 동일 규약)
    const claimed = await this.prisma.pharmacistIntervention.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: data.status,
        doctorResponse: nullableText(data.doctorResponse),
        respondedBy,
        respondedAt: new Date(), // 지금 실제로 일어난 응답 — 이 경로에서만 기록
      },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.pharmacistIntervention.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('중재 기록을 찾을 수 없습니다');
      throw new BadRequestException('이미 처리된 중재 기록입니다');
    }

    const row = await this.prisma.pharmacistIntervention.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('중재 기록을 찾을 수 없습니다');
    const [out] = await this.decorateInterventions([row]);
    return out;
  }

  // ── TDM (약물농도모니터링) ──

  async getTdmRequests(status?: string): Promise<ListPage<TdmRequest>> {
    const where: Record<string, unknown> = {};
    if (status) {
      if (!(TDM_STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestException(`TDM 상태는 ${TDM_STATUSES.join('|')} 중 하나여야 합니다`);
      }
      where.status = status;
    }

    const rows = await this.prisma.tdmRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: LIST_LIMIT + 1,
    });
    const truncated = rows.length > LIST_LIMIT;
    const page = truncated ? rows.slice(0, LIST_LIMIT) : rows;

    const [pmap, umap] = await Promise.all([
      this.patientNameMap(page.map((r) => r.patientId)),
      this.userNameMap([...page.map((r) => r.requestedBy), ...page.map((r) => r.reviewedBy)]),
    ]);

    return {
      items: page.map((r) => this.mapTdm(r, pmap, umap)),
      truncated,
      limit: LIST_LIMIT,
    };
  }

  private mapTdm(
    r: {
      id: string; patientId: string; drugName: string; indication: string | null;
      targetRangeMin: unknown; targetRangeMax: unknown; targetUnit: string | null;
      status: string; resultLevel: unknown; resultInterpretation: string | null;
      doseRecommendation: string | null; requestedBy: string; requestedAt: Date;
      sampledAt: Date | null; resultedAt: Date | null; reviewedBy: string | null; reviewedAt: Date | null;
    },
    pmap: Map<string, string | null>,
    umap: Map<string, string | null>,
  ): TdmRequest {
    return {
      id: r.id,
      patientId: r.patientId,
      patientName: pmap.get(r.patientId) ?? null,
      drugName: r.drugName,
      indication: r.indication,
      targetRangeMin: decimalToNumber(r.targetRangeMin),
      targetRangeMax: decimalToNumber(r.targetRangeMax),
      targetUnit: r.targetUnit,
      status: r.status as TdmStatus,
      resultLevel: decimalToNumber(r.resultLevel),
      resultInterpretation: r.resultInterpretation,
      doseRecommendation: r.doseRecommendation,
      requestedBy: r.requestedBy,
      requestedByName: umap.get(r.requestedBy) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      sampledAt: iso(r.sampledAt),
      resultedAt: iso(r.resultedAt),
      reviewedBy: r.reviewedBy,
      reviewedAt: iso(r.reviewedAt),
    };
  }

  async createTdmRequest(data: {
    patientId: string;
    drugName: string;
    indication?: string | null;
    targetRangeMin?: number | string | null;
    targetRangeMax?: number | string | null;
    targetUnit?: string | null;
    requestedBy: string;
  }): Promise<TdmRequest> {
    const patientId = assertUuid(data.patientId, '환자 ID');
    const requestedBy = assertUuid(data.requestedBy, '요청자 ID');
    const drugName = requiredText(data.drugName, '약물명');
    const min = nullableNumber(data.targetRangeMin, '목표범위 하한');
    const max = nullableNumber(data.targetRangeMax, '목표범위 상한');
    if (min !== null && max !== null && min > max) {
      throw new BadRequestException('목표범위 하한이 상한보다 큽니다');
    }

    await this.assertPatientExists(patientId);

    const row = await this.prisma.tdmRequest.create({
      data: {
        patientId,
        drugName,
        indication: nullableText(data.indication) ?? undefined,
        targetRangeMin: min ?? undefined,
        targetRangeMax: max ?? undefined,
        targetUnit: nullableText(data.targetUnit) ?? undefined,
        requestedBy,
        // status=REQUESTED·requestedAt=now 는 스키마 기본값.
        // sampledAt/resultedAt 은 실제 행위 전까지 null 로 남긴다.
      },
    });

    const [pmap, umap] = await Promise.all([
      this.patientNameMap([row.patientId]),
      this.userNameMap([row.requestedBy]),
    ]);
    return this.mapTdm(row, pmap, umap);
  }

  async recordTdmResult(id: string, data: {
    resultLevel: number | string;
    resultInterpretation: string;
    doseRecommendation?: string | null;
  }): Promise<TdmRequest> {
    assertUuid(id, 'TDM 요청 ID');
    // 실측 농도가 없으면 결과가 아니다 — 0 으로 대신 채우지 않는다
    const resultLevel = requiredNumber(data.resultLevel, '실측 농도');
    const resultInterpretation = requiredText(data.resultInterpretation, '결과 해석');

    const claimed = await this.prisma.tdmRequest.updateMany({
      where: { id, status: { in: ['REQUESTED', 'SAMPLED'] } },
      data: {
        status: 'RESULTED',
        resultLevel,
        resultInterpretation,
        doseRecommendation: nullableText(data.doseRecommendation),
        resultedAt: new Date(), // 결과를 실제로 입력한 지금
        // sampledAt 은 건드리지 않는다 — 채혈 시각을 모르면 지어내지 않는다
      },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.tdmRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('TDM 요청을 찾을 수 없습니다');
      throw new BadRequestException('이미 결과가 입력된 TDM 요청입니다');
    }

    const row = await this.prisma.tdmRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('TDM 요청을 찾을 수 없습니다');
    const [pmap, umap] = await Promise.all([
      this.patientNameMap([row.patientId]),
      this.userNameMap([row.requestedBy, row.reviewedBy]),
    ]);
    return this.mapTdm(row, pmap, umap);
  }

  // ── ADR ──

  /** 영속 ADR(AdverseReactionReport)에서 조회 — 인메모리 mock 제거·pharmacy 경로와 단일 소스. */
  async getAdrReports(): Promise<AdrReport[]> {
    const rows = await this.prisma.adverseReactionReport.findMany({
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { patient: { select: { familyName: true, givenName: true } } },
    });
    return rows.map((r) => ({
      id: r.id, patientId: r.patientId,
      patientName: `${r.patient?.familyName ?? ''}${r.patient?.givenName ?? ''}`,
      suspectedDrug: r.suspectedDrugName, reaction: r.reactionDescription,
      severity: r.severity as AdrReport['severity'], onsetDate: r.onsetDate.toISOString().slice(0, 10),
      outcome: r.outcome, causalityAssessment: r.causalityAssessment ?? '',
      naranjoScore: r.naranjoScore ?? null,
      kaersReportId: r.kidsReportNumber ?? undefined, reportedBy: r.reporterId,
      reportedAt: r.createdAt.toISOString(),
    }));
  }

  async createAdrReport(data: {
    patientId: string; patientName: string;
    suspectedDrug: string; reaction: string;
    severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'FATAL';
    onsetDate: string; outcome: string;
    causalityAssessment: string; naranjoScore?: number | null; kaersReportId?: string;
    reportedBy: string;
  }): Promise<AdrReport> {
    // 영속 저장(AdverseReactionReport) — reportedBy는 유효 사용자 UUID여야 함(컨트롤러가 CurrentUser 주입)
    const isSerious = data.severity === 'FATAL' || data.outcome === 'FATAL';
    const r = await this.prisma.adverseReactionReport.create({
      data: {
        patientId: data.patientId, reporterId: data.reportedBy,
        suspectedDrugName: data.suspectedDrug, reactionDescription: data.reaction,
        severity: data.severity, onsetDate: new Date(data.onsetDate), outcome: data.outcome,
        causalityAssessment: data.causalityAssessment, kidsReportNumber: data.kaersReportId,
        // 🔴 계산하지 않았으면 컬럼도 비운다(`undefined`) — 0 을 넣으면 "Naranjo 0 = 의심"이
        //    평가한 적 없는 보고에 붙는다. E2B 로 나가면 수신 기관이 그대로 읽는다.
        naranjoScore: data.naranjoScore ?? undefined,
        isSerious,
      },
    });
    return {
      id: r.id, patientId: r.patientId, patientName: data.patientName,
      suspectedDrug: r.suspectedDrugName, reaction: r.reactionDescription,
      severity: r.severity as AdrReport['severity'], onsetDate: r.onsetDate.toISOString().slice(0, 10),
      outcome: r.outcome, causalityAssessment: r.causalityAssessment ?? '',
      naranjoScore: r.naranjoScore ?? null,
      kaersReportId: r.kidsReportNumber ?? undefined, reportedBy: r.reporterId, reportedAt: r.createdAt.toISOString(),
    };
  }

  // ── ASP (Antimicrobial Stewardship Program) ──

  // ASP 영속화(P2-F) — 종전 인메모리 mock(재시작 소실) → asp_requests 테이블.
  async getAspRequests(status?: string) {
    const reqs = await this.prisma.aspRequest.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' }, take: 200,
    });
    const pids = [...new Set(reqs.map((r) => r.patientId))];
    const pats = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const pmap = new Map(pats.map((p) => [p.id, `${p.familyName ?? ''}${p.givenName ?? ''}`.trim()]));
    return reqs.map((r) => ({ ...r, patientName: pmap.get(r.patientId) ?? null }));
  }

  async createAspRequest(data: {
    patientId: string; patientName?: string;
    antimicrobialName: string; indication: string;
    duration?: number; durationUnit?: string;
    requestedBy: string; prescriptionId?: string; encounterId?: string; restrictedLevel?: string;
  }) {
    return this.prisma.aspRequest.create({
      data: {
        patientId: data.patientId,
        prescriptionId: data.prescriptionId ?? undefined,
        encounterId: data.encounterId ?? undefined,
        antimicrobialName: data.antimicrobialName,
        restrictedLevel: data.restrictedLevel ?? undefined,
        indication: data.indication,
        duration: data.duration != null ? Number(data.duration) : undefined,
        durationUnit: data.durationUnit ?? undefined,
        requestedBy: data.requestedBy,
      },
    });
  }

  async handleAspRequest(id: string, approve: boolean, data?: { reviewedBy: string; reviewComment?: string }) {
    // 원자 처리 — PENDING만 전이(이중 처리 차단)
    const claimed = await this.prisma.aspRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedBy: data?.reviewedBy, reviewedAt: new Date(), reviewComment: data?.reviewComment },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.aspRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('ASP 요청을 찾을 수 없습니다');
      throw new BadRequestException('이미 처리된 ASP 요청입니다');
    }
    return this.prisma.aspRequest.findUnique({ where: { id } });
  }

  // ── Stats ──

  /** 집계 기간 — 화면이 말하는 period 와 실제 집계 창을 일치시킨다 */
  private static readonly PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

  private periodCutoff(period?: string): { period: string; since: Date | null } {
    const p = period ?? 'all';
    if (p === 'all') return { period: 'all', since: null };
    const days = PharmacistActivityService.PERIOD_DAYS[p];
    if (!days) {
      throw new BadRequestException(
        `period 는 all|${Object.keys(PharmacistActivityService.PERIOD_DAYS).join('|')} 중 하나여야 합니다`,
      );
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return { period: p, since };
  }

  /** YYYY-MM (서버 로컬 시간 = 운영 pm2 TZ) */
  private static monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async getStats(pharmacistId?: string, period?: string): Promise<Record<string, unknown>> {
    const { period: resolvedPeriod, since } = this.periodCutoff(period);
    const phId = pharmacistId ? assertUuid(pharmacistId, '약사 ID') : undefined;

    const intvWhere: Record<string, unknown> = {};
    if (phId) intvWhere.pharmacistId = phId;
    if (since) intvWhere.createdAt = { gte: since };
    const tdmWhere: Record<string, unknown> = since ? { requestedAt: { gte: since } } : {};
    const adrWhere: Record<string, unknown> = since ? { createdAt: { gte: since } } : {};
    const aspWhere: Record<string, unknown> = since ? { requestedAt: { gte: since } } : {};

    const [byStatusRows, byTypeRows, tdmStatusRows, adrTotal, aspTotal, aspApproved] = await Promise.all([
      this.prisma.pharmacistIntervention.groupBy({ by: ['status'], where: intvWhere, _count: { _all: true } }),
      this.prisma.pharmacistIntervention.groupBy({ by: ['type'], where: intvWhere, _count: { _all: true } }),
      this.prisma.tdmRequest.groupBy({ by: ['status'], where: tdmWhere, _count: { _all: true } }),
      this.prisma.adverseReactionReport.count({ where: adrWhere }),
      this.prisma.aspRequest.count({ where: aspWhere }),
      this.prisma.aspRequest.count({ where: { ...aspWhere, status: 'APPROVED' } }),
    ]);

    const countOf = (rows: Array<Record<string, unknown>>, key: string, value: string): number => {
      const row = rows.find((r) => r[key] === value);
      const c = row?._count as { _all?: number } | undefined;
      return c?._all ?? 0;
    };

    // 행 수는 세면 사실이다 — 0 행은 진짜 0 이다(표본 부재가 아니다)
    const accepted = countOf(byStatusRows as never, 'status', 'ACCEPTED');
    const rejected = countOf(byStatusRows as never, 'status', 'REJECTED');
    const pending = countOf(byStatusRows as never, 'status', 'PENDING');
    const totalInterventions = (byStatusRows as Array<{ _count?: { _all?: number } }>)
      .reduce((s, r) => s + (r._count?._all ?? 0), 0);

    // 🔴 수락률의 분모는 '처리된 중재'다. 전부 대기 중이면 분모가 없으므로 0% 가 아니라 산출 불가.
    const decided = accepted + rejected;
    const acceptanceRate = decided > 0 ? Math.round((accepted / decided) * 100) : null;

    const byType: Record<string, number> = {};
    for (const t of INTERVENTION_TYPES) byType[t] = countOf(byTypeRows as never, 'type', t);

    const tdmTotal = (tdmStatusRows as Array<{ _count?: { _all?: number } }>)
      .reduce((s, r) => s + (r._count?._all ?? 0), 0);
    const tdmResulted = countOf(tdmStatusRows as never, 'status', 'RESULTED')
      + countOf(tdmStatusRows as never, 'status', 'REVIEWED');

    const trend = await this.getMonthlyTrend(phId);

    return {
      period: resolvedPeriod,
      interventions: {
        total: totalInterventions, accepted, rejected, pending,
        // decided/사유는 화면이 "0%" 와 "산출 불가"를 구분할 수 있게 하는 근거다
        decided,
        acceptanceRate,
        acceptanceRateNote: acceptanceRate === null ? '처리된 중재가 없어 수락률을 산출할 수 없습니다' : null,
        byType,
      },
      tdm: { total: tdmTotal, resulted: tdmResulted },
      adr: { total: adrTotal },
      asp: { total: aspTotal, approved: aspApproved },
      trend,
      trendMonths: 6,
    };
  }

  /**
   * 월별 추이 — 실제 행을 세어 만든다.
   * (종전에는 2026-01~04 가 하드코딩 상수였다: 데이터가 없어도 "중재 42건"을 말했다.)
   */
  private async getMonthlyTrend(pharmacistId?: string): Promise<Array<{ month: string; interventions: number; tdm: number; adr: number; asp: number }>> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
    const months: string[] = [];
    for (let i = 0; i < 6; i++) {
      months.push(PharmacistActivityService.monthKey(new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)));
    }

    const intvWhere: Record<string, unknown> = { createdAt: { gte: start } };
    if (pharmacistId) intvWhere.pharmacistId = pharmacistId;

    const [intvRows, tdmRows, adrRows, aspRows] = await Promise.all([
      this.prisma.pharmacistIntervention.findMany({ where: intvWhere, select: { createdAt: true } }),
      this.prisma.tdmRequest.findMany({ where: { requestedAt: { gte: start } }, select: { requestedAt: true } }),
      this.prisma.adverseReactionReport.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
      this.prisma.aspRequest.findMany({ where: { requestedAt: { gte: start } }, select: { requestedAt: true } }),
    ]);

    const bucket = (rows: Array<Record<string, unknown>>, field: string): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const d = r[field] as Date | undefined;
        if (!(d instanceof Date)) continue;
        const k = PharmacistActivityService.monthKey(d);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };

    const bi = bucket(intvRows as never, 'createdAt');
    const bt = bucket(tdmRows as never, 'requestedAt');
    const ba = bucket(adrRows as never, 'createdAt');
    const bs = bucket(aspRows as never, 'requestedAt');

    return months.map((month) => ({
      month,
      interventions: bi.get(month) ?? 0,
      tdm: bt.get(month) ?? 0,
      adr: ba.get(month) ?? 0,
      asp: bs.get(month) ?? 0,
    }));
  }
}
