/**
 * '원내 환자' 판정 — 순수 로직.
 *
 * 목록의 기본 시야를 "지금 병원 안에 있는 사람"으로 두기 위한 조건.
 * 원내는 한 덩어리가 아니라 **상태의 합집합**이라 각각 고를 수 있어야 한다
 * (예: 병동 회진은 재원만, 접수데스크는 대기·수납만 본다).
 *
 * 🔴 '오늘'은 서버 로컬(pm2 TZ)이 아니라 **KST 고정**으로 계산한다 —
 *    컨테이너 OS 는 UTC 라 로컬 기준으로 자르면 09시 이전 기록이 전날로 밀린다.
 */

export type OnsiteStateKey =
  | 'admitted' | 'waiting' | 'called' | 'in_consult' | 'cashier' | 'pharmacy' | 'drafting' | 'booked';

interface OnsiteState {
  key: OnsiteStateKey;
  label: string;
  /** 판정 근원 — 입원 / 대기열 / 진료기록 / 예약 */
  source: 'admission' | 'queue' | 'encounter' | 'appointment';
  /** 대기열 상태값(source=queue 일 때) */
  queueStatus?: string;
  /**
   * '원내 전체'(기본 시야)에 포함할지.
   * 🔴 예약은 **아직 도착 전**이라 원내가 아니다 — 골라서만 본다(기본 합집합에 넣으면 원내 수가 부풀려진다).
   */
  inAll: boolean;
  /** 왜 이 상태인가 — 화면 툴팁 */
  hint: string;
}

/** 상태 레지스트리 — 화면 칩·서버 판정의 단일 정본(순서=표시 순서) */
export const ONSITE_STATES: OnsiteState[] = [
  { key: 'admitted', label: '재원', source: 'admission', inAll: true, hint: '입원해 병동에 있는 환자(입원일과 무관)' },
  { key: 'waiting', label: '대기', source: 'queue', queueStatus: 'WAITING', inAll: true, hint: '오늘 접수해 진료를 기다리는 중' },
  { key: 'called', label: '호출됨', source: 'queue', queueStatus: 'CALLED', inAll: true, hint: '진료실 호출을 받은 상태' },
  { key: 'in_consult', label: '진료중', source: 'queue', queueStatus: 'IN_CONSULTATION', inAll: true, hint: '진료실에 들어가 있는 중' },
  { key: 'cashier', label: '수납대기', source: 'queue', queueStatus: 'CASHIER_WAITING', inAll: true, hint: '진료는 끝났고 수납을 기다리는 중(아직 원내)' },
  { key: 'pharmacy', label: '약국대기', source: 'queue', queueStatus: 'PHARMACY_WAITING', inAll: true, hint: '조제를 기다리는 중(아직 원내)' },
  { key: 'drafting', label: '기록 작성중', source: 'encounter', inAll: true, hint: '오늘 진료가 열려 있고 아직 서명 전' },
  { key: 'booked', label: '오늘 예약', source: 'appointment', inAll: false, hint: '오늘 예약이 있으나 **아직 도착 전** — 원내 전체에는 포함되지 않고 골랐을 때만 봅니다' },
];

export const ONSITE_STATE_KEYS = ONSITE_STATES.map((s) => s.key);

/** 아직 흐름이 끝나지 않은 대기열 상태(완료·취소·미방문 제외) */
export const ONSITE_QUEUE_STATUSES = ONSITE_STATES.filter((s) => s.source === 'queue').map((s) => s.queueStatus!);

/** 기준 시각이 속한 KST 하루의 시작(UTC Date) */
export function kstDayStart(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000);
}

/** 기본 시야(원내 전체)에 들어가는 상태 — 예약은 제외(도착 전) */
export const ONSITE_DEFAULT_KEYS = ONSITE_STATES.filter((s) => s.inAll).map((s) => s.key);

/** 요청 문자열 → 유효 상태 키(빈 값·미상은 기본 시야로 해석). 알 수 없는 값은 조용히 버린다 */
export function parseOnsiteStates(raw?: string): OnsiteStateKey[] {
  if (!raw || raw === 'onsite' || raw === 'all') return [...ONSITE_DEFAULT_KEYS];
  const picked = raw.split(',').map((t) => t.trim()).filter((t): t is OnsiteStateKey => (ONSITE_STATE_KEYS as string[]).includes(t));
  return picked.length ? picked : [...ONSITE_DEFAULT_KEYS];
}

/** Prisma where 조각 — 선택된 상태들의 OR (enum 은 호출부에서 좁힌다) */
export function onsitePatientWhere(states?: string, now: Date = new Date()) {
  const keys = parseOnsiteStates(states);
  const from = kstDayStart(now);
  const or: Record<string, unknown>[] = [];

  if (keys.includes('admitted')) or.push({ admissions: { some: { status: 'ADMITTED' as const } } });

  const queueStatuses = ONSITE_STATES.filter((s) => s.source === 'queue' && keys.includes(s.key)).map((s) => s.queueStatus!);
  // 🔴 '오늘 접수'의 도메인 정본은 checkedInAt — createdAt 으로 자르면 데모 롤포워드(checkedInAt만 +1d)와
  //    어긋나 대기 환자가 원내 0명으로 잡힌다(2026-08-04 환자관리↔진료실대기 불일치 실측)
  // 🔴 **상한이 없어 "지금 병원에 있는 사람"에 아직 오지 않은 예약이 섞였다.**
  //    `checkedInAt` 은 오늘 하루 어디든 될 수 있다 — 실측(2026-08-13 08:30) 대기 180건 중
  //    129건이 미래 접수였다. 오늘 아침 진료실 대기·접수 데스크에서 같은 병을 고쳤는데
  //    원내 판정에도 남아 있었다(세 번째 화면). '오늘 예약'은 `booked` 칩으로 따로 센다.
  if (queueStatuses.length) or.push({ waitingQueues: { some: { status: { in: queueStatuses }, checkedInAt: { gte: from, lte: now } } } });

  if (keys.includes('drafting')) or.push({ encounters: { some: { status: 'DRAFT' as const, createdAt: { gte: from } } } });

  // 예약 — 오늘 예약이 잡혀 있고 아직 도착/종료 전(도착하면 대기열·진료 상태로 잡힌다)
  if (keys.includes('booked')) {
    const to = new Date(from.getTime() + 86_400_000);
    or.push({ appointments: { some: { status: { in: ['SCHEDULED' as const, 'CONFIRMED' as const] }, scheduledAt: { gte: from, lt: to } } } });
  }

  return { OR: or };
}
