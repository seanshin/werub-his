/**
 * 🔴 NIMS(식약처 마약류통합관리시스템) 취급보고 전송 정본 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 무엇이 잘못이었나:
 *  - `buildNimsBatch()` 는 **파일을 만들기만** 하고 배치에 포함된 보고를
 *    `status:'SUBMITTED' · submittedAt:now · nimsRefNo:'NIMS-<타임스탬프>'` 로 확정했다.
 *    식약처로 나가는 전송 코드는 전 코드베이스에 없다
 *    (`grep -rni nims apps/api/src | grep -E 'fetch|axios|http'` → 내부 라우트 1건뿐).
 *    즉 **다운로드만 하고 업로드를 안 해도 원장상 '제출 완료'** 였고,
 *    그 보고는 재제출 대상에서 빠져 **다음 배치에서 영구 누락**됐다(마약류관리법 §11 취급보고 미이행).
 *  - `submitNimsReport()` 는 아예 `nimsRefNo:'STUB-…'` 를 적는 자인된 스텁이었는데
 *    화면은 "NIMS 배치(식약처 제출)" 라고만 말했다.
 *
 * 원칙(W7 법정감염병 KCDC 와 동일):
 *  **없는 연동을 흉내내지 않는다.** 나가지 않았으면 `LOCAL_RECORDED` · `submittedAt=null`
 *  (전송 시각을 모르면 추정하지 않는다) · 접수번호는 `LOCAL-NIMS-…`(원내 번호) ·
 *  **미전송은 항상 재제출 가능**. 실제 연동이 붙는 날 고칠 자리는 `transmitNims()` 한 곳뿐이다.
 *
 * 🔴 저장값은 변형하지 않는다 — 운영에 남은 레거시(`NIMS-…`/`STUB-…`, status=SUBMITTED)는
 *    지우지 않고 **읽는 쪽에서** `UNVERIFIED`(전송 근거 없음)로 분류한다.
 */

export interface NimsChannel {
  readonly key: 'NIMS';
  readonly name: string;
  /** 실제 전송 구현 여부. 연동을 붙이는 날 true 로 바꾼다(그 전엔 '전송 완료'를 쓸 수 없다). */
  readonly implemented: boolean;
  /** 미구현 동안 사람이 대신 해야 하는 일 */
  readonly manualFallback: string;
}

export const NIMS_CHANNEL: NimsChannel = {
  key: 'NIMS',
  name: '식약처 마약류통합관리시스템(NIMS)',
  implemented: false,
  manualFallback:
    '내려받은 배치파일을 NIMS 에 업로드한 뒤, 발급받은 접수번호를 이 화면의 "수기 접수번호 기록"에 입력하십시오',
};

/** NIMS 보고 상태 어휘 — 스키마는 VarChar(20)(enum 아님)이라 여기가 정본이다. */
export const NIMS_STATUS = {
  /** 아웃박스 적재 직후 — 아직 배치에 담기지도 않았다 */
  PENDING: 'PENDING',
  /** 원내 배치파일에는 담겼으나 식약처로 **나가지 않았다** */
  LOCAL_RECORDED: 'LOCAL_RECORDED',
  /** 전송을 시도했으나 실패 */
  SEND_FAILED: 'SEND_FAILED',
  /** 실제 전송 성공(현재는 채널 미구현이라 이 값이 새로 기록되지 않는다) */
  SUBMITTED: 'SUBMITTED',
  /** 접수 확인 — 지금은 사람이 NIMS 웹에서 받은 접수번호를 기록한 경우에만 붙는다 */
  ACK: 'ACK',
  FAILED: 'FAILED',
} as const;

/**
 * 🔴 재제출(배치 재포함) 가능 상태 — **실제로 나가지 않은 건은 다시 담겨야 한다.**
 * (종전: 파일 생성만으로 SUBMITTED 가 되어 다음 배치에서 영구 누락됐다.)
 */
export const RESUBMITTABLE_NIMS_STATUSES: readonly string[] = [
  NIMS_STATUS.PENDING,
  NIMS_STATUS.LOCAL_RECORDED,
  NIMS_STATUS.SEND_FAILED,
  NIMS_STATUS.FAILED,
];

/** 사람이 아니라 코드가 붙인 번호 접두어 — 기관 접수번호가 아님을 판별하는 데 쓴다. */
const AUTO_REF_PREFIXES = ['LOCAL-', 'STUB-', 'NIMS-'];

export type NimsTransmitOutcome = 'SENT' | 'NOT_TRANSMITTED' | 'FAILED';

export interface NimsTransmitResult {
  outcome: NimsTransmitOutcome;
  /** 식약처가 실제로 부여한 접수번호 — `SENT` 일 때만 존재한다. */
  externalRef?: string;
  /** 식약처가 접수한 시각 — `SENT` 일 때만 존재한다(모르는 시각은 추정하지 않는다). */
  at?: Date;
  reason?: string;
}

/**
 * 🔴 실제 전송 자리 — **여기 한 곳만** 구현하면 전 경로가 정직하게 SENT 로 바뀐다.
 * 지금은 인증서·API 계약(외부 게이트)이 없으므로 언제나 '전송하지 않았다'를 반환한다.
 */
export async function transmitNims(_payload: Record<string, unknown>): Promise<NimsTransmitResult> {
  if (!NIMS_CHANNEL.implemented) {
    return { outcome: 'NOT_TRANSMITTED', reason: `${NIMS_CHANNEL.name} 연동 미구축 — 전송 코드 없음` };
  }
  /* istanbul ignore next — 연동 구현 자리 */
  return { outcome: 'FAILED', reason: '전송 구현이 채널을 부르지 않았다' };
}

/** 원내 접수번호(건별) — **기관이 준 번호가 아님**을 접두어로 드러낸다. */
export function localNimsRef(now: Date = new Date()): string {
  return `LOCAL-NIMS-${now.getTime().toString(36).toUpperCase()}`;
}

/**
 * 원내 배치번호 — 로컬(KST) 시각 기준. 🔴 `toISOString()` 은 UTC 라 자정 근처에서 날짜가 밀린다.
 * (nims_reports.nims_ref_no 는 VarChar(50) — 아래 형식은 26자.)
 */
export function localNimsBatchNo(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `LOCAL-NIMS-${stamp}`;
}

/** 미전송 사유를 errorMessage 에 남기는 한 줄 — 사람이 읽고 바로 조치할 수 있게 쓴다. */
export function notTransmittedNimsLog(
  at: Date,
  extra?: { attemptedBy?: string; reason?: string; batchNo?: string },
): string {
  const who = extra?.attemptedBy ? ` · 시도자 ${extra.attemptedBy}` : '';
  const batch = extra?.batchNo ? ` · 원내 배치 ${extra.batchNo}` : '';
  const why = extra?.reason ?? `${NIMS_CHANNEL.name} 연동 미구축 — 전송 코드 없음`;
  return `[미전송] ${at.toISOString()}${who}${batch} · ${why} · 조치: ${NIMS_CHANNEL.manualFallback}`;
}

export type NimsTransmissionState =
  | 'QUEUED'
  | 'LOCAL_ONLY'
  | 'SEND_FAILED'
  | 'UNVERIFIED'
  | 'MANUAL_ACK'
  | 'SENT';

export interface NimsTransmissionInfo {
  state: NimsTransmissionState;
  /** 식약처에 실제로 도달한 근거가 있는가 */
  transmitted: boolean;
  label: string;
  note: string;
  channel: string;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **기존 저장값은 변조하지 않는다**.
 * 레거시 `NIMS-<타임스탬프>`/`STUB-…`(status=SUBMITTED)는 전송 채널이 존재한 적이 없으므로
 * '제출 완료'가 아니라 `UNVERIFIED`(전송 근거 없음)로 읽는다.
 */
export function classifyNimsTransmission(r: {
  status: string;
  nimsRefNo?: string | null;
  submittedAt?: Date | null;
}): NimsTransmissionInfo {
  const ch = NIMS_CHANNEL.name;
  const ref = r.nimsRefNo ?? '';
  const autoRef = AUTO_REF_PREFIXES.some((p) => ref.startsWith(p));

  if (r.status === NIMS_STATUS.PENDING) {
    return { state: 'QUEUED', transmitted: false, label: '제출대기', note: '아직 배치에 담기지 않았습니다', channel: ch };
  }
  if (r.status === NIMS_STATUS.SEND_FAILED || r.status === NIMS_STATUS.FAILED) {
    return {
      state: 'SEND_FAILED', transmitted: false, label: '전송 실패',
      note: `전송에 실패했습니다 — ${NIMS_CHANNEL.manualFallback}`, channel: ch,
    };
  }
  // 사람이 NIMS 웹에 올리고 받아 적은 접수번호 — 유일하게 '도달' 근거가 있는 경로
  if (r.status === NIMS_STATUS.ACK && ref && !autoRef && r.submittedAt) {
    return {
      state: 'MANUAL_ACK', transmitted: true, label: '수기 접수(NIMS 웹)',
      note: `담당자가 NIMS 웹 업로드 후 기록한 접수번호입니다 — ${ref}`, channel: ch,
    };
  }
  if (r.status === NIMS_STATUS.LOCAL_RECORDED || (autoRef && ref.startsWith('LOCAL-'))) {
    return {
      state: 'LOCAL_ONLY', transmitted: false, label: '원내 기록(미전송)',
      note: `식약처로 전송되지 않았습니다 — ${NIMS_CHANNEL.manualFallback}`, channel: ch,
    };
  }
  // SUBMITTED / ACK(자동 접두어) — 연동이 없던 시절에 찍힌 값
  if (!NIMS_CHANNEL.implemented) {
    return {
      state: 'UNVERIFIED', transmitted: false, label: '전송 근거 없음',
      note: `연동이 구축된 적이 없어 이 번호는 식약처가 부여한 것이 아닙니다 — ${NIMS_CHANNEL.manualFallback}`,
      channel: ch,
    };
  }
  /* istanbul ignore next — 연동 구축 후 경로 */
  return { state: 'SENT', transmitted: true, label: '제출 완료', note: '식약처 접수 확인', channel: ch };
}

/** 화면·헤더가 그대로 쓰는 채널 고지(전송 미구축 사실을 숨기지 않는다) */
export function nimsChannelNotice() {
  return {
    channel: NIMS_CHANNEL.name,
    implemented: NIMS_CHANNEL.implemented,
    manualFallback: NIMS_CHANNEL.manualFallback,
  };
}
