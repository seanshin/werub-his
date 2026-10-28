/**
 * 🔴 KIDS(한국의약품안전관리원) 이상사례 법정보고 전송 정본 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 무엇이 잘못이었나:
 *  - `submitAdrToKids()` 는 E2B 페이로드를 만들어 두고 `kidsReported:true` ·
 *    `kidsReportDate:now` · `status:'SUBMITTED'` · `kidsReportNumber:'KIDS-STUB-xxxx'` 를
 *    **적기만** 했다. KIDS 웹서비스/게이트웨이로 나가는 전송·큐·아웃박스 코드는
 *    전 코드베이스에 없다(`grep -rn kids apps/api/src` → 이 경로뿐).
 *  - 그런데 함수 첫 줄이 `if (r.kidsReported) return r;` 였다. 즉 **스텁이 세운 마킹이
 *    멱등 가드가 되어, 실제 연동이 붙는 날에도 그 건은 영구히 다시 보고되지 않는다.**
 *    약사법 §37-2·의약품 부작용 보고 의무가 코드 한 줄로 영구 미이행이 된다.
 *  - 화면(`/pharmacy/admin` ADR 탭)은 그 마킹을 보고 초록 '보고완료' 배지를 띄웠다.
 *
 * 원칙(감염병 신고 정본 `modules/infection-control/external-reporting.ts` 와 같은 규약):
 *  **없는 연동을 흉내내지 않는다.** 나가지 않았다는 사실을 그대로 적고, 화면이 그것을 말한다.
 *  - 미구축 → `LOCAL_RECORDED` · `kidsReported:false` · `kidsReportDate:null`
 *  - **미전송은 항상 재보고 가능**(멱등 차단은 '실제로 나간 것'에만 건다)
 *  - 실제 연동이 붙는 날 고칠 자리는 `transmitKidsReport()` **한 곳뿐**이다.
 */

/** 외부 기관 전송 채널 — `implemented:false` 인 동안 어떤 코드도 '보고 완료'를 적을 수 없다. */
export interface KidsChannel {
  readonly key: 'KIDS';
  readonly name: string;
  /** 실제 전송 구현 여부. 연동을 붙이는 날 true 로 바꾼다(그 전엔 보고 완료를 쓸 수 없다). */
  readonly implemented: boolean;
  /** 미구현 동안 사람이 대신 해야 하는 일 */
  readonly manualFallback: string;
}

export const KIDS_CHANNEL: KidsChannel = {
  key: 'KIDS',
  name: '한국의약품안전관리원 의약품이상사례보고시스템(KAERS)',
  implemented: false,
  manualFallback:
    'E2B(R3) XML 을 내려받아 KAERS(open.drugsafe.or.kr)에 업로드/수기 보고한 뒤 KIDS 접수번호를 기록하십시오',
};

/** ADR 보고 상태 어휘 — 스키마는 VarChar(enum 아님)이라 여기가 정본이다. */
export const ADR_STATUS = {
  REPORTED: 'REPORTED',
  /** 원내 접수·E2B 생성만 완료 — KIDS 로 **나가지 않았다** */
  LOCAL_RECORDED: 'LOCAL_RECORDED',
  /** 전송을 시도했으나 실패 */
  SEND_FAILED: 'SEND_FAILED',
  /** 실제 전송 성공(현재는 채널 미구현이라 이 값이 새로 기록되지 않는다) */
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
} as const;

export type KidsTransmitOutcome = 'SENT' | 'NOT_TRANSMITTED' | 'FAILED';

export interface KidsTransmitResult {
  outcome: KidsTransmitOutcome;
  /** KIDS 가 실제로 부여한 접수번호 — `SENT` 일 때만 존재한다. */
  externalRef?: string;
  /** KIDS 가 접수한 시각 — `SENT` 일 때만 존재한다(모르는 시각은 추정하지 않는다). */
  at?: Date;
  reason?: string;
}

/**
 * 🔴 실제 전송 자리 — **여기 한 곳**만 고치면 연동이 붙는다.
 * 채널이 미구현인 동안에는 어떤 경우에도 `SENT` 를 돌려주지 않는다.
 */
export async function transmitKidsReport(_payload: unknown): Promise<KidsTransmitResult> {
  if (!KIDS_CHANNEL.implemented) {
    return {
      outcome: 'NOT_TRANSMITTED',
      reason: `${KIDS_CHANNEL.name} 연동 미구축 — 전송 코드 없음`,
    };
  }
  // 연동 구축 시: 실제 전송 후 KIDS 가 준 접수번호·접수시각만 externalRef/at 에 담는다.
  throw new Error('KIDS 전송 구현 필요 — implemented=true 로 바꿨다면 여기를 채워야 한다');
}

/**
 * 원내 접수번호 — **KIDS 가 준 번호가 아님**을 접두어로 드러낸다.
 * (종전 `KIDS-STUB-xxxx` 는 기관 접수번호처럼 보였고, 약사활동 화면은 이 값을
 *  `kaersReportId` 로 그대로 노출했다.)
 */
export function localKidsRef(now: Date = new Date()): string {
  return `LOCAL-KIDS-${now.getTime().toString(36).toUpperCase()}`;
}

/** 미전송 사유 한 줄 — 사람이 읽고 바로 조치할 수 있게 쓴다. */
export function kidsNotTransmittedNote(at: Date, reason?: string): string {
  return `[미전송] ${at.toISOString()} · ${reason ?? `${KIDS_CHANNEL.name} 연동 미구축 — 전송 코드 없음`} · 조치: ${KIDS_CHANNEL.manualFallback}`;
}

export type KidsTransmissionState = 'NOT_SUBMITTED' | 'LOCAL_ONLY' | 'SEND_FAILED' | 'UNVERIFIED' | 'SENT';

export interface KidsTransmissionInfo {
  state: KidsTransmissionState;
  /** KIDS 에 실제로 도달한 근거가 있는가 — 화면 배지·재보고 허용 판정의 유일한 기준 */
  transmitted: boolean;
  label: string;
  note: string;
  channel: string;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **기존 저장값은 변조하지 않는다**.
 * 과거에 스텁이 찍은 `kidsReported=true` / `KIDS-STUB-…` 행이 있다면, 전송 채널이
 * 존재한 적이 없으므로 '보고완료'가 아니라 `UNVERIFIED`(전송 근거 없음)로 읽는다.
 */
export function classifyKidsTransmission(r: {
  status?: string | null;
  kidsReported?: boolean | null;
  kidsReportNumber?: string | null;
  kidsReportDate?: Date | null;
}): KidsTransmissionInfo {
  const channel = KIDS_CHANNEL.name;
  const ref = r.kidsReportNumber ?? '';

  if (r.status === ADR_STATUS.SEND_FAILED) {
    return {
      state: 'SEND_FAILED', transmitted: false, label: '전송 실패',
      note: `전송에 실패했습니다 — ${KIDS_CHANNEL.manualFallback}`, channel,
    };
  }
  if (!r.kidsReported) {
    if (r.status === ADR_STATUS.LOCAL_RECORDED || ref.startsWith('LOCAL-')) {
      return {
        state: 'LOCAL_ONLY', transmitted: false, label: '원내 접수(미전송)',
        note: `KIDS 로 전송되지 않았습니다 — ${KIDS_CHANNEL.manualFallback}`, channel,
      };
    }
    return {
      state: 'NOT_SUBMITTED', transmitted: false, label: '미보고',
      note: '아직 KIDS 보고를 시도하지 않았습니다', channel,
    };
  }
  // kidsReported = true
  if (!KIDS_CHANNEL.implemented || ref.startsWith('KIDS-STUB-') || ref.startsWith('LOCAL-')) {
    return {
      state: 'UNVERIFIED', transmitted: false, label: '전송 근거 없음',
      note: `연동이 구축된 적이 없어 이 접수번호는 KIDS 가 부여한 것이 아닙니다 — ${KIDS_CHANNEL.manualFallback}`,
      channel,
    };
  }
  return { state: 'SENT', transmitted: true, label: '보고완료', note: 'KIDS 접수 확인', channel };
}
