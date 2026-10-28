/**
 * 🔴 HIRA EDI 전송 정본 — 화면 실사용 점검 W8 R3(2026-08-14) · C1.
 *
 * 무엇이 잘못이었나:
 *  - `HiraEdiService.submitDocument` 는 `status:'SUBMITTED'` · `submittedAt: new Date()` 를
 *    **적기만** 했다. 심평원(요양기관업무포털)으로 나가는 전송·큐·아웃박스 코드는
 *    전 코드베이스에 없다(`grep -rn "hira" apps/api/src | grep -i "http\|axios\|fetch\|outbox"` → 0건).
 *    그런데 화면은 '제출됨' 배지와 제출 시각을 보여줬고, 통계 '승인율'이 그 위에서 계산됐다.
 *  - 게다가 재생성이 `SUBMITTED/ACCEPTED` 를 영구 차단해, 한 번 누르면 **나가지도 않은 명세서가
 *    영원히 고칠 수 없는 상태**로 굳었다(요양급여비용 청구 시한 3년 — 미청구 위험).
 *
 * 원칙: **없는 연동을 흉내내지 않는다.** 감염병 법정보고 정본
 * (`modules/infection-control/external-reporting.ts`)과 **같은 형태**로 맞춘다 —
 * 미구축 = `LOCAL_RECORDED` · `submittedAt: null` · 접수번호 `LOCAL-HIRA-…` ·
 * 미전송은 재제출 가능 · 화면은 '원내 접수(미전송)'.
 *
 * 실제 연동이 붙는 날 고칠 자리는 `HIRA_CHANNEL.implemented` 와 `transmitToHira()` **두 곳뿐**이다.
 */

/** 외부 기관 전송 채널 — `implemented:false` 인 동안 어떤 코드도 '전송 완료'를 적을 수 없다. */
export interface HiraChannel {
  readonly key: 'HIRA';
  readonly name: string;
  /** 실제 전송 구현 여부. 연동을 붙이는 날 true 로 바꾼다(그 전엔 전송 완료를 쓸 수 없다). */
  readonly implemented: boolean;
  /** 미구현 동안 사람이 대신 해야 하는 일 */
  readonly manualFallback: string;
}

export const HIRA_CHANNEL: HiraChannel = {
  key: 'HIRA',
  name: '건강보험심사평가원 EDI 청구(요양기관업무포털)',
  implemented: false,
  manualFallback:
    '요양기관업무포털에서 EDI 명세서를 수기 제출한 뒤, 심평원이 부여한 접수번호를 「심사결과 기록」에 입력하십시오',
};

/**
 * EDI 명세서 상태 어휘 — 스키마는 VarChar(20)(enum 아님)이라 여기가 정본이다.
 * 🔴 `SUBMITTED` 는 **실제 전송 성공에만** 쓴다(현재 채널 미구현이라 새로 기록되지 않는다).
 */
export const HIRA_DOC_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  /** 원내 접수만 완료 — 심평원으로 **나가지 않았다** */
  LOCAL_RECORDED: 'LOCAL_RECORDED',
  /** 전송을 시도했으나 실패 */
  SEND_FAILED: 'SEND_FAILED',
  /** 실제 전송 성공 */
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  ADJUSTED: 'ADJUSTED',
} as const;

export type HiraDocStatus = (typeof HIRA_DOC_STATUS)[keyof typeof HIRA_DOC_STATUS];

/** 제출(전송 시도) 버튼을 누를 수 있는 상태 — 🔴 나가지 않은 건은 다시 시도할 수 있어야 한다. */
export const HIRA_SUBMITTABLE_STATUSES: readonly string[] = [
  HIRA_DOC_STATUS.VALIDATED,
  HIRA_DOC_STATUS.LOCAL_RECORDED,
  HIRA_DOC_STATUS.SEND_FAILED,
];

/**
 * 🔴 재생성 가능 상태 — **실제로 나가지 않은 건은 다시 만들 수 있어야 한다.**
 * (종전: SUBMITTED/ACCEPTED 를 무조건 차단 → 시뮬레이션 'SUBMITTED' 가 정정을 영구 봉쇄했다.)
 * 심사결과가 기록된 건(ACCEPTED/ADJUSTED)은 사람이 판단할 영역이라 여전히 막는다.
 */
export function canRegenerateHiraDocument(status: string): boolean {
  if (status === HIRA_DOC_STATUS.ACCEPTED || status === HIRA_DOC_STATUS.ADJUSTED) return false;
  if (status === HIRA_DOC_STATUS.SUBMITTED) return !HIRA_CHANNEL.implemented; // 전송 근거 없음 → 정정 허용
  return true;
}

/**
 * 원내 접수번호 — **심평원이 준 번호가 아님**을 접두어로 드러낸다.
 * (종전에는 접수번호 자체가 없었고 상태만 'SUBMITTED' 였다.)
 */
export function localReceiptNo(now: Date = new Date()): string {
  return `LOCAL-HIRA-${now.getTime().toString(36).toUpperCase()}`;
}

export type HiraTransmitOutcome = 'SENT' | 'NOT_TRANSMITTED' | 'FAILED';

export interface HiraTransmitResult {
  outcome: HiraTransmitOutcome;
  /** 심평원이 실제로 부여한 접수번호 — `SENT` 일 때만 존재한다. */
  externalRef?: string;
  /** 심평원이 접수한 시각 — `SENT` 일 때만 존재한다(모르는 시각은 추정하지 않는다). */
  at?: Date;
  reason?: string;
}

/**
 * 심평원 전송 — **연동이 붙는 날 이 함수 하나만 구현한다.**
 * 지금은 채널 미구현이므로 언제나 `NOT_TRANSMITTED` 를 반환한다(성공을 흉내내지 않는다).
 */
export async function transmitToHira(_ediData: unknown): Promise<HiraTransmitResult> {
  if (!HIRA_CHANNEL.implemented) {
    return { outcome: 'NOT_TRANSMITTED', reason: `${HIRA_CHANNEL.name} 연동 미구축 — 전송 코드 없음` };
  }
  /* istanbul ignore next — implemented=true 로 바꾸는 날 실제 전송 구현을 여기에 둔다 */
  return { outcome: 'FAILED', reason: '전송 채널이 implemented=true 이지만 구현이 없습니다' };
}

/** 미전송 사유 한 줄 — 사람이 읽고 바로 조치할 수 있게 쓴다. */
export function notTransmittedNote(at: Date, reason?: string): string {
  const why = reason ?? `${HIRA_CHANNEL.name} 연동 미구축 — 전송 코드 없음`;
  return `[미전송] ${at.toISOString()} · ${why} · 조치: ${HIRA_CHANNEL.manualFallback}`;
}

export type HiraTransmissionState =
  | 'DRAFT'
  | 'VALIDATED'
  | 'LOCAL_ONLY'
  | 'SEND_FAILED'
  | 'UNVERIFIED'
  | 'REVIEW_RECORDED'
  | 'SENT';

export interface HiraTransmissionInfo {
  state: HiraTransmissionState;
  /** 심평원에 실제로 도달한 근거가 있는가 */
  transmitted: boolean;
  label: string;
  note: string;
  channel: string;
  /** 화면 접수번호 — LOCAL- 접두어면 원내 번호(기관 부여 아님) */
  receiptNo: string | null;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **기존 저장값은 변조하지 않는다**.
 * 운영에 남아 있는 status=SUBMITTED 건은 전송 채널이 존재한 적이 없으므로
 * '제출됨'이 아니라 `UNVERIFIED`(전송 근거 없음)로 읽는다.
 */
export function classifyHiraTransmission(d: {
  status: string;
  submittedAt?: Date | null;
  receiptNo?: string | null;
}): HiraTransmissionInfo {
  const channel = HIRA_CHANNEL.name;
  const receiptNo = d.receiptNo ?? null;
  const base = { channel, receiptNo };

  switch (d.status) {
    case HIRA_DOC_STATUS.DRAFT:
      return { ...base, state: 'DRAFT', transmitted: false, label: '작성중', note: '아직 검증하지 않았습니다' };
    case HIRA_DOC_STATUS.VALIDATED:
      return { ...base, state: 'VALIDATED', transmitted: false, label: '검증완료(미제출)', note: '검증만 끝났습니다 — 아직 제출하지 않았습니다' };
    case HIRA_DOC_STATUS.SEND_FAILED:
      return { ...base, state: 'SEND_FAILED', transmitted: false, label: '전송 실패', note: `전송에 실패했습니다 — ${HIRA_CHANNEL.manualFallback}` };
    case HIRA_DOC_STATUS.LOCAL_RECORDED:
      return {
        ...base,
        state: 'LOCAL_ONLY',
        transmitted: false,
        label: '원내 접수(미전송)',
        note: `심평원으로 전송되지 않았습니다 — ${HIRA_CHANNEL.manualFallback}`,
      };
    case HIRA_DOC_STATUS.ACCEPTED:
    case HIRA_DOC_STATUS.REJECTED:
    case HIRA_DOC_STATUS.ADJUSTED:
      return {
        ...base,
        state: 'REVIEW_RECORDED',
        transmitted: HIRA_CHANNEL.implemented,
        label: HIRA_CHANNEL.implemented ? '심사결과' : '심사결과(수기 기록)',
        note: HIRA_CHANNEL.implemented
          ? '심평원 심사결과가 기록되었습니다'
          : '연동이 없어 이 결과는 사람이 수기로 기록한 값입니다(시스템 전송 근거 없음)',
      };
    case HIRA_DOC_STATUS.SUBMITTED:
    default:
      if (!HIRA_CHANNEL.implemented || (receiptNo ?? '').startsWith('LOCAL-')) {
        return {
          ...base,
          state: 'UNVERIFIED',
          transmitted: false,
          label: '전송 근거 없음',
          note: `연동이 구축된 적이 없어 이 건은 심평원으로 나가지 않았습니다 — ${HIRA_CHANNEL.manualFallback}`,
        };
      }
      return { ...base, state: 'SENT', transmitted: true, label: '제출됨', note: '심평원 접수 확인' };
  }
}
