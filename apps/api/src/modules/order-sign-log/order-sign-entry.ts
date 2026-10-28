/**
 * 오더 서명 로그 — 순수 로직(항목 구성 · PHI 차단 · 스탬프 복원).
 *
 * 왜 순수 함수로 떼어내나: 봉인은 외부(sign) 왕복이라 테스트가 어렵지만, **무엇을 봉인하는가**는
 * 전적으로 규칙이다. "빠진 전이를 어떻게 찾아내는가"와 "PHI 가 새지 않는가"는 골든으로 고정한다.
 *
 * 커버리지 원칙 — 등재가 아니라 **데이터에서 복원**:
 *   오더 상태 변경 지점이 13개 모듈 34곳에 흩어져 있어 호출부 등재로는 언젠가 반드시 새어나간다.
 *   그래서 실시간 배선(생성·상태변경 정본·취소)에 더해, orders 의 전이 스탬프
 *   (receivedAt/startedAt/completedAt/cancelledAt)에서 누락분을 **소급 복원**한다.
 *   스탬프가 곧 사실이므로 어느 경로가 바꿨든 로그는 남는다.
 */

export type OrderSignAction =
  | 'ORDER_CREATED'
  | 'ORDER_RECEIVED'
  | 'ORDER_IN_PROGRESS'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED';

/** 상태 → 행위명(정본). 새 상태가 생기면 여기만 늘린다. */
export const ACTION_BY_STATUS: Record<string, OrderSignAction> = {
  ORDERED: 'ORDER_CREATED',
  RECEIVED: 'ORDER_RECEIVED',
  IN_PROGRESS: 'ORDER_IN_PROGRESS',
  COMPLETED: 'ORDER_COMPLETED',
  CANCELLED: 'ORDER_CANCELLED',
};

export const ACTION_LABEL: Record<OrderSignAction, string> = {
  ORDER_CREATED: '오더 발행',
  ORDER_RECEIVED: '오더 접수',
  ORDER_IN_PROGRESS: '시행 시작',
  ORDER_COMPLETED: '오더 완료',
  ORDER_CANCELLED: '오더 취소',
};

/** 오더 1건에서 전이 이력을 재구성하기 위해 필요한 최소 필드 */
export interface OrderStampSnapshot {
  id: string;
  status: string;
  createdAt: Date;
  receivedAt?: Date | null;
  receivedById?: string | null;
  startedAt?: Date | null;
  startedById?: string | null;
  completedAt?: Date | null;
  completedById?: string | null;
  cancelledAt?: Date | null;
  cancelledById?: string | null;
  /** 발행 행위자 — 처방 작성자(책임 처방의 지정 시 그쪽) */
  prescribedById?: string | null;
}

export interface DerivedEntry {
  action: OrderSignAction;
  toStatus: string;
  occurredAt: Date;
  actorId: string | null;
}

/**
 * 스탬프에서 있어야 할 로그 항목 전량을 재구성한다.
 *
 * 취소는 `cancelledAt` 이 있을 때만 만든다 — 시각을 모르는 취소를 `updatedAt` 같은 값으로 추정해
 * 봉인하면 **틀린 시각이 원장에 영구히 박힌다**. 모르면 만들지 않고 미봉인으로 남겨 드러낸다.
 */
export function deriveEntries(o: OrderStampSnapshot): DerivedEntry[] {
  const out: DerivedEntry[] = [
    { action: 'ORDER_CREATED', toStatus: 'ORDERED', occurredAt: o.createdAt, actorId: o.prescribedById ?? null },
  ];
  if (o.receivedAt) out.push({ action: 'ORDER_RECEIVED', toStatus: 'RECEIVED', occurredAt: o.receivedAt, actorId: o.receivedById ?? null });
  if (o.startedAt) out.push({ action: 'ORDER_IN_PROGRESS', toStatus: 'IN_PROGRESS', occurredAt: o.startedAt, actorId: o.startedById ?? null });
  if (o.completedAt) out.push({ action: 'ORDER_COMPLETED', toStatus: 'COMPLETED', occurredAt: o.completedAt, actorId: o.completedById ?? null });
  if (o.cancelledAt) out.push({ action: 'ORDER_CANCELLED', toStatus: 'CANCELLED', occurredAt: o.cancelledAt, actorId: o.cancelledById ?? null });
  return out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/**
 * 소급 복원 대상 — 이미 로그가 있는 **행위는 다시 만들지 않는다**.
 *
 * 🔴 대조 키가 (action, occurredAt) 이면 안 된다: 스탬프가 나중에 바뀌면(데모 리프레시가
 *    orders.createdAt 을 갱신하듯, 또는 재접수로 receivedAt 이 덮이듯) 소급 복원이 **같은 행위를
 *    새 항목으로 다시 봉인**한다. 원장은 append-only 라 한번 들어간 중복은 지울 수 없다.
 *    (실측: API 재기동 3회 → 같은 오더의 ORDER_CREATED 가 3건 봉인됨)
 *
 * 그래서 소급 복원은 **행위 단위로 한 번만** 만든다. 진짜 반복 전이(재접수 등)는 실시간 배선이
 * 전이 사실을 알고 있으므로 그쪽에서 별도 항목으로 남긴다.
 */
export function missingEntries(derived: DerivedEntry[], existing: { action: string; occurredAt: Date }[]): DerivedEntry[] {
  const seen = new Set(existing.map((e) => e.action));
  return derived.filter((d) => !seen.has(d.action));
}

/** 취소 상태인데 취소 시각이 없는 오더 — 소급 복원이 불가능해 화면에 '시각 미상'으로 드러낼 대상 */
export function hasUnrecoverableCancel(o: OrderStampSnapshot): boolean {
  return o.status === 'CANCELLED' && !o.cancelledAt;
}

/** 요약 문구 재료 — 이름·연락처가 들어오지 못하게 **코드·명칭 필드만** 받는다 */
export interface SummarySource {
  orderType?: string | null;
  department?: string | null;
  priority?: string | null;
  code?: string | null;
  codeName?: string | null;
  dosage?: string | null;
  instructions?: string | null;
}

const MAX_SUMMARY = 200;

/**
 * 봉인 본문에 실을 요약. 원장은 외부 시스템에 남으므로 **환자·의료진 식별 정보는 넣지 않는다**
 * (환자는 targetRef 의 UUID 로만 지목). 지시문은 자유입력이라 길이를 자르고 개행을 없앤다.
 */
export function buildSummary(s: SummarySource): string {
  const parts = [
    s.codeName ?? undefined,
    s.code ? `(${s.code})` : undefined,
    s.dosage ?? undefined,
    s.priority && s.priority !== 'ROUTINE' ? `[${s.priority}]` : undefined,
    s.instructions ?? undefined,
  ].filter(Boolean) as string[];
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

/** sign `/v1/audit-events` 로 보낼 본문 — PHI 를 넣을 자리를 아예 만들지 않는다 */
export interface SignEventBody {
  action: OrderSignAction;
  actor: string;
  actorRole?: string;
  targetType: 'ORDER';
  targetRef: string;
  stream: string;
  occurredAt: string;
  anchor: boolean;
  data: Record<string, string | undefined>;
}

export const ORDER_STREAM = 'his-orders';

/** 행위자 미상(시스템·외부 웹훅)일 때 원장에 남길 주체 표기 */
export const SYSTEM_ACTOR = 'system:hospitalrun';

export function buildSignEventBody(e: {
  action: OrderSignAction;
  orderId: string;
  actorId?: string | null;
  actorRole?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  prescriptionId?: string | null;
  orderType?: string | null;
  department?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  summary?: string | null;
  occurredAt: Date;
  origin: string;
  anchor?: boolean;
}): SignEventBody {
  return {
    action: e.action,
    actor: e.actorId ?? SYSTEM_ACTOR,
    actorRole: e.actorRole ?? undefined,
    targetType: 'ORDER',
    targetRef: e.orderId,
    stream: ORDER_STREAM,
    occurredAt: e.occurredAt.toISOString(),
    anchor: e.anchor ?? false,
    data: {
      patientId: e.patientId ?? undefined,
      encounterId: e.encounterId ?? undefined,
      prescriptionId: e.prescriptionId ?? undefined,
      orderType: e.orderType ?? undefined,
      department: e.department ?? undefined,
      fromStatus: e.fromStatus ?? undefined,
      toStatus: e.toStatus,
      summary: e.summary || undefined,
      origin: e.origin,
    },
  };
}

/**
 * 봉인 재시도 대상 판정 — 무한 재시도로 sign 을 두드리지 않는다.
 * FAILED 는 지수적으로 간격을 벌리고, 일정 횟수를 넘으면 사람이 볼 수 있게 남겨둔다.
 */
export const MAX_SEAL_ATTEMPTS = 8;

/**
 * 재시도 대상 상태 — **판정 함수와 크론 쿼리가 이 하나에서 파생한다.**
 *
 * 🔴 종전 크론은 `sealStatus in [PENDING, FAILED, SKIPPED]` 로 **가장 오래된
 *    200건**을 가져온 뒤 이 함수로 걸렀다. 이 함수는 SKIPPED·상한 도달 행을 버리므로, SIMULATION 시기의
 *    SKIPPED 가 200건 넘게 쌓여 있으면(또는 상한에 이른 FAILED 가 200건을 넘으면) 창이 늘 그 행들로 차고
 *    **새로 생긴 FAILED/PENDING 은 영영 재시도되지 않았다**(`retried 0` 반복). 쿼리와 판정이 각자 목록을
 *    가져서 갈라진 자리다(P12). 이제 쿼리는 `SEAL_RETRY_WHERE` 를, 판정은 같은 상수를 쓴다.
 *    (SKIPPED 를 늦게라도 봉인할지는 사람 결정이다 — 여기서 넣지 않는다.)
 */
export const RETRYABLE_SEAL_STATUSES = ['PENDING', 'FAILED'] as const;

/** 크론 쿼리 조건 — `shouldRetrySeal` 의 상태·상한 조건과 같은 것(백오프만 판정 함수가 더 본다) */
export const SEAL_RETRY_WHERE = {
  sealStatus: { in: [...RETRYABLE_SEAL_STATUSES] as string[] },
  sealAttempts: { lt: MAX_SEAL_ATTEMPTS },
};

export function shouldRetrySeal(row: { sealStatus: string; sealAttempts: number; createdAt: Date }, now: Date): boolean {
  if (!(RETRYABLE_SEAL_STATUSES as readonly string[]).includes(row.sealStatus)) return false;
  if (row.sealAttempts >= MAX_SEAL_ATTEMPTS) return false;
  if (row.sealAttempts === 0) return true;
  const backoffMs = Math.min(2 ** row.sealAttempts, 64) * 60_000; // 2분 → 최대 64분
  return now.getTime() - row.createdAt.getTime() >= backoffMs;
}
