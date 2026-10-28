/**
 * 🔴 법정보고 외부 전송 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 무엇이 잘못이었나:
 *  - 법정감염병 신고(감염병예방법 §11)는 `status:'SUBMITTED'` · `submittedAt:now` ·
 *    `reportRef:'KCDC-'+Date.now().toString(36)` 를 **적기만** 했다. 질병관리청으로
 *    나가는 전송·큐·아웃박스 코드는 전 코드베이스에 없었다(`grep -ri kcdc apps/api/src`
 *    → 그 한 줄뿐). 그런데 화면은 초록 '신고완료' 배지와 접수번호를 보여줬다.
 *  - 게다가 재제출이 `DRAFT/REJECTED` 로만 열려 있어, 한 번 누르면 **영구 미신고**로 굳었다.
 *  - KONIS 보고도 FE 가 보낸 `reportedToKonis` 플래그를 그대로 저장했을 뿐이다.
 *
 * 원칙: **없는 연동을 흉내내지 않는다.** 나가지 않았다는 사실을 그대로 적고,
 * 화면이 그것을 말하게 한다(W6 CRM 리마인더와 같은 규약 — 실제 발송=SENT ·
 * 채널 미구현=미전송 · 실패=FAILED). 실제 연동이 붙는 날 고칠 자리는
 * `InfectionControlService.transmitNotifiable / transmitKonis` **한 곳뿐**이다.
 */

/** 외부 기관 전송 채널 — `implemented:false` 인 동안 어떤 코드도 '전송 완료'를 적을 수 없다. */
export interface ExternalChannel {
  readonly key: 'KCDC' | 'KONIS';
  readonly name: string;
  /** 실제 전송 구현 여부. 연동을 붙이는 날 true 로 바꾼다(그 전엔 전송 완료를 쓸 수 없다). */
  readonly implemented: boolean;
  /** 미구현 동안 사람이 대신 해야 하는 일 */
  readonly manualFallback: string;
}

export const KCDC_CHANNEL: ExternalChannel = {
  key: 'KCDC',
  name: '질병관리청 감염병 웹신고(is.kdca.go.kr)',
  implemented: false,
  manualFallback: '감염병 웹신고 시스템에서 수기 신고 후 접수번호를 신고 건에 기록하십시오',
};

export const KONIS_CHANNEL: ExternalChannel = {
  key: 'KONIS',
  name: '전국의료관련감염감시체계(KONIS)',
  implemented: false,
  manualFallback: 'KONIS 웹에서 수기 보고 후 근거번호(konisManualRef)를 입력하십시오',
};

export type TransmitOutcome = 'SENT' | 'NOT_TRANSMITTED' | 'FAILED';

export interface TransmitResult {
  outcome: TransmitOutcome;
  /** 외부 기관이 실제로 부여한 접수번호 — `SENT` 일 때만 존재한다. */
  externalRef?: string;
  /** 외부 기관이 접수한 시각 — `SENT` 일 때만 존재한다(모르는 시각은 추정하지 않는다). */
  at?: Date;
  reason?: string;
}

/**
 * 원내 접수번호 — **기관이 준 번호가 아님**을 접두어로 드러낸다.
 * (종전 `KCDC-XXXX` 는 질병관리청 접수번호처럼 보였다.)
 */
export function localReportRef(channel: 'KCDC' | 'KONIS', now: Date = new Date()): string {
  return `LOCAL-${channel}-${now.getTime().toString(36).toUpperCase()}`;
}

/** 미전송 사유를 errorLog/notes 에 남기는 한 줄 — 사람이 읽고 바로 조치할 수 있게 쓴다. */
export function notTransmittedLog(
  channel: ExternalChannel,
  at: Date,
  extra?: { attemptedBy?: string; reason?: string },
): string {
  const who = extra?.attemptedBy ? ` · 시도자 ${extra.attemptedBy}` : '';
  const why = extra?.reason ?? `${channel.name} 연동 미구축 — 전송 코드 없음`;
  return `[미전송] ${at.toISOString()}${who} · ${why} · 조치: ${channel.manualFallback}`;
}

/** 법정감염병 신고 상태 어휘 — 스키마는 VarChar(20)(enum 아님)이라 여기가 정본이다. */
export const NOTIFIABLE_STATUS = {
  DRAFT: 'DRAFT',
  /** 원내 접수만 완료 — 질병관리청으로 **나가지 않았다** */
  LOCAL_RECORDED: 'LOCAL_RECORDED',
  /** 전송을 시도했으나 실패 */
  SEND_FAILED: 'SEND_FAILED',
  /** 실제 전송 성공(현재는 채널 미구현이라 이 값이 새로 기록되지 않는다) */
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  REJECTED: 'REJECTED',
} as const;

/**
 * 🔴 재제출 가능 상태 — **실제로 나가지 않은 건은 다시 시도할 수 있어야 한다.**
 * (종전: DRAFT/REJECTED 만 허용 → 시뮬레이션 'SUBMITTED' 가 재신고를 영구 차단했다.)
 */
export const RESUBMITTABLE_STATUSES: readonly string[] = [
  NOTIFIABLE_STATUS.DRAFT,
  NOTIFIABLE_STATUS.REJECTED,
  NOTIFIABLE_STATUS.LOCAL_RECORDED,
  NOTIFIABLE_STATUS.SEND_FAILED,
];

export type NotifiableTransmissionState =
  | 'DRAFT'
  | 'LOCAL_ONLY'
  | 'SEND_FAILED'
  | 'UNVERIFIED'
  | 'SENT';

export interface NotifiableTransmissionInfo {
  state: NotifiableTransmissionState;
  /** 질병관리청에 실제로 도달한 근거가 있는가 */
  transmitted: boolean;
  label: string;
  note: string;
  channel: string;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **기존 저장값은 변조하지 않는다**.
 * 운영에 남아 있는 `KCDC-DEMO01`(status=SUBMITTED) 같은 건은 전송 채널이 존재한 적이
 * 없으므로 '신고완료'가 아니라 `UNVERIFIED`(전송 근거 없음)로 읽는다.
 */
export function classifyNotifiableTransmission(r: {
  status: string;
  reportRef?: string | null;
  submittedAt?: Date | null;
}): NotifiableTransmissionInfo {
  const ch = KCDC_CHANNEL.name;
  if (r.status === NOTIFIABLE_STATUS.DRAFT) {
    return { state: 'DRAFT', transmitted: false, label: '작성중', note: '아직 제출하지 않았습니다', channel: ch };
  }
  if (r.status === NOTIFIABLE_STATUS.REJECTED) {
    return { state: 'SEND_FAILED', transmitted: false, label: '반려', note: '반려된 신고입니다 — 보완 후 재제출하십시오', channel: ch };
  }
  if (r.status === NOTIFIABLE_STATUS.SEND_FAILED) {
    return { state: 'SEND_FAILED', transmitted: false, label: '전송 실패', note: `전송에 실패했습니다 — ${KCDC_CHANNEL.manualFallback}`, channel: ch };
  }
  if (r.status === NOTIFIABLE_STATUS.LOCAL_RECORDED || (r.reportRef ?? '').startsWith('LOCAL-')) {
    return {
      state: 'LOCAL_ONLY',
      transmitted: false,
      label: '원내 접수(미전송)',
      note: `질병관리청으로 전송되지 않았습니다 — ${KCDC_CHANNEL.manualFallback}`,
      channel: ch,
    };
  }
  // SUBMITTED / ACKNOWLEDGED
  if (!KCDC_CHANNEL.implemented) {
    return {
      state: 'UNVERIFIED',
      transmitted: false,
      label: '전송 근거 없음',
      note: `연동이 구축된 적이 없어 이 접수번호는 질병관리청이 부여한 것이 아닙니다 — ${KCDC_CHANNEL.manualFallback}`,
      channel: ch,
    };
  }
  return { state: 'SENT', transmitted: true, label: '신고완료', note: '질병관리청 접수 확인', channel: ch };
}
