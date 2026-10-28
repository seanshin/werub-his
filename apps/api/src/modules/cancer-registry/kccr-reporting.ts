/**
 * 🔴 KCCR(중앙암등록본부) 전송 근거 정본 — 2026-08-18.
 *
 * 규약은 하나다: **전송을 흉내내지 않는다.**
 * (정본 패턴 = `modules/infection-control/external-reporting.ts` — 같은 문제를 이미 푼 코드)
 *
 * 무엇이 문제였나
 *  - `generateKccrReport()` 는 제출용 payload 를 **반환만** 하는데(전송 코드 없음)
 *    `reportedToKccr = true` 로 봉인했고 화면은 "KCCR 일괄 보고가 완료되었습니다"라고 말했다(P16).
 *  - W7 에서 응답에 `transmission: NOT_TRANSMITTED` 를 실어 화면이 사실을 말하게 했지만,
 *    **원장에는 전송 근거를 담을 컬럼 자체가 없었다** — 실제 연동이 붙어도 "언제 나갔는지"를
 *    적을 자리가 없었고, 재제출 판단의 근거도 없었다.
 *
 * 무엇이 정본인가 (🔴 두 필드의 관계를 여기서 못박는다)
 *  - `reportedToKccr: Boolean` = **보고 대상 확정(제출 자료 산출 완료)** 이다.
 *    전송 여부와 **무관**하다. 이 값 하나로 '보고 완료'를 말할 수 없다.
 *  - `kccrTransmittedAt: DateTime?` = **전송 근거의 정본**. 중앙암등록본부가 실제로 접수한
 *    시각만 들어간다. 연동이 없는 동안은 **항상 null** 이다(모르는 시각을 원장에 박지 않는다).
 *  - `kccrSubmissionId: String?` = 접수번호. 기관이 부여한 것이 아니면 **`LOCAL-` 접두**를 붙여
 *    한눈에 원내 번호임을 드러낸다(`localKccrRef()`).
 *  - 전송 여부 판정은 **`classifyKccrTransmission()` 한 곳**에서만 한다.
 *    화면·리포트가 각자 boolean 을 읽고 판정하면 정본이 둘이 된다(P12).
 *
 * 연동이 붙는 날 고칠 자리
 *  1) `KCCR_CHANNEL.implemented = true`
 *  2) `CancerRegistryService.transmitKccr()` 안에서 실제 전송 → 성공 시에만
 *     `kccrTransmittedAt` / 기관 접수번호를 기록한다.
 */
import type { ExternalChannel } from '../infection-control/external-reporting';

/** 정본 `ExternalChannel` 의 계약을 그대로 쓰되 key 만 KCCR 로 넓힌다(정본 키 목록은 감염관리 소유). */
export type KccrChannel = Omit<ExternalChannel, 'key'> & { readonly key: 'KCCR' };

export const KCCR_CHANNEL: KccrChannel = {
  key: 'KCCR',
  name: '중앙암등록본부(KCCR) 국가암등록통계사업',
  /** 🔴 전송 구현 여부. false 인 동안 어떤 코드도 '전송 완료'를 적을 수 없다. */
  implemented: false,
  manualFallback:
    '중앙암등록본부 암등록 자료 제출 절차(자료 내보내기 후 기관 제출)를 사람이 수행하고, ' +
    '기관이 부여한 접수번호를 등록 건에 기록하십시오',
};

/**
 * 원내 접수번호 — **기관이 준 번호가 아님**을 접두어로 드러낸다.
 * (`KCCR-…` 처럼 보이는 번호를 만들면 화면이 기관 접수번호로 읽는다.)
 */
export function localKccrRef(now: Date = new Date()): string {
  return `LOCAL-KCCR-${now.getTime().toString(36).toUpperCase()}`;
}

/** 접수번호가 원내 번호인가 — `LOCAL-` 접두는 전송 근거가 아니다. */
export function isLocalKccrRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith('LOCAL-');
}

export type KccrTransmissionState =
  /** 제출 자료 산출도 안 된 상태 */
  | 'NOT_PREPARED'
  /** 보고 대상 확정(자료 산출 완료) · **아직 나가지 않았다** */
  | 'PREPARED_NOT_TRANSMITTED'
  /** 전송 시각이 찍혀 있으나 전송 채널이 존재한 적이 없다 = 근거 없음 */
  | 'UNVERIFIED'
  /** 실제 전송 완료 */
  | 'TRANSMITTED';

export interface KccrTransmissionInfo {
  state: KccrTransmissionState;
  /** 🔴 중앙암등록본부에 실제로 도달한 근거가 있는가 — 화면의 초록 배지는 이 값만 본다 */
  transmitted: boolean;
  label: string;
  note: string;
  channel: string;
  /** 전송 근거 시각(정본). 미전송이면 null — 추정하지 않는다 */
  transmittedAt: Date | null;
  /** 접수번호와 그 출처 */
  submissionId: string | null;
  submissionIdIsLocal: boolean;
  /** 🔴 나가지 않은 건은 언제든 다시 제출할 수 있어야 한다(영구 미보고로 굳지 않게) */
  resubmittable: boolean;
}

export interface KccrTransmissionSource {
  reportedToKccr: boolean;
  kccrTransmittedAt?: Date | null;
  kccrSubmissionId?: string | null;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **저장값은 변조하지 않는다**.
 *
 * 🔴 `transmitted:true` 는 세 조건이 모두 참일 때만 나온다:
 *   ① 채널이 구현되어 있고 ② 전송 시각이 있고 ③ 접수번호가 원내(`LOCAL-`) 번호가 아니다.
 *   하나라도 어긋나면 초록 배지를 주지 않는다.
 */
export function classifyKccrTransmission(r: KccrTransmissionSource): KccrTransmissionInfo {
  const channel = KCCR_CHANNEL.name;
  const at = r.kccrTransmittedAt ?? null;
  const ref = r.kccrSubmissionId ?? null;
  const local = isLocalKccrRef(ref);
  const base = { channel, transmittedAt: at, submissionId: ref, submissionIdIsLocal: local };

  if (at && KCCR_CHANNEL.implemented && !local) {
    return {
      ...base,
      state: 'TRANSMITTED',
      transmitted: true,
      label: '전송 완료',
      note: '중앙암등록본부 접수 확인',
      resubmittable: false,
    };
  }

  if (at) {
    // 시각은 찍혀 있는데 채널이 구현된 적이 없거나 원내 번호다 → 근거로 인정하지 않는다.
    return {
      ...base,
      state: 'UNVERIFIED',
      transmitted: false,
      label: '전송 근거 없음',
      note:
        `전송 시각이 기록되어 있으나 ${!KCCR_CHANNEL.implemented ? '연동이 구축된 적이 없습니다' : '접수번호가 원내 번호입니다'}` +
        ` — 기관 접수 근거가 아닙니다. ${KCCR_CHANNEL.manualFallback}`,
      resubmittable: true,
    };
  }

  if (r.reportedToKccr) {
    return {
      ...base,
      state: 'PREPARED_NOT_TRANSMITTED',
      transmitted: false,
      label: '보고 대상 확정(미전송)',
      note: `제출 자료가 산출되었을 뿐 중앙암등록본부로 전송되지 않았습니다 — ${KCCR_CHANNEL.manualFallback}`,
      resubmittable: true,
    };
  }

  return {
    ...base,
    state: 'NOT_PREPARED',
    transmitted: false,
    label: '미보고',
    note: '아직 제출 자료를 산출하지 않았습니다',
    resubmittable: true,
  };
}
