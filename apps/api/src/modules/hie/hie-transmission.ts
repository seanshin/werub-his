/**
 * 🔴 진료정보교류(HIE) 외부 전송 판정 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 무엇이 잘못이었나:
 *  - `HieService.transmitToHie()` 는 `logger.log('Would transmit CDA …')` 한 줄만 찍고
 *    `status:'SENT'` · `sentAt: new Date()` 를 적은 뒤
 *    `{ success:true, message:'교류 문서 전송 완료 (게이트웨이 연동 대기)' }` 를 돌려줬다.
 *    건강정보고속도로(myhealthway) 게이트웨이로 나가는 SOAP/REST 호출은 코드베이스에 없다
 *    (`grep -rn "transmit" apps/api/src/modules/hie` → 그 한 줄뿐).
 *  - 그런데 **CDA 는 법정 진료기록의 반출**이다(의료법 §21조의2). 전건 '전송 완료'로 남으면
 *    "언제 어디로 무엇을 내보냈다"는 반출 대장이 통째로 거짓이 된다.
 *  - 메시지 안에 "게이트웨이 연동 대기"라고 자인까지 해 두었으면서 상태는 SENT 였다.
 *
 * 원칙(법정보고 정본 `modules/infection-control/external-reporting.ts` 와 **같은 판정**):
 *  - 없는 연동을 흉내내지 않는다 — 나가지 않았으면 `LOCAL_RECORDED`.
 *  - `sentAt` 에 모르는 시각을 박지 않는다 — 나가지 않았으면 `null`.
 *  - 저장값은 변형하지 않는다 — 이미 `SENT` 로 박힌 과거 행은 **읽는 쪽에서** `UNVERIFIED`
 *    (전송 근거 없음)로 분류한다.
 *  - 미전송은 다시 보낼 수 있어야 한다 — `RETRANSMITTABLE_STATUSES`.
 *
 * 실제 게이트웨이가 붙는 날 고칠 자리는 `HIE_GATEWAY.implemented` 와
 * `HieService.transmitToHie` **한 곳뿐**이다.
 */
import type { ExternalChannel, TransmitOutcome, TransmitResult } from '../infection-control/external-reporting';

export type { TransmitOutcome, TransmitResult };

/**
 * 건강정보고속도로 교류 게이트웨이.
 * 법정보고 정본의 `ExternalChannel` 모양을 그대로 쓴다(key 만 이 도메인 값).
 */
export type HieChannel = Omit<ExternalChannel, 'key'> & { readonly key: 'HIE_HIGHWAY' };

export const HIE_GATEWAY: HieChannel = {
  key: 'HIE_HIGHWAY',
  name: '건강정보고속도로 진료정보교류 게이트웨이(myhealthway)',
  /** 실제 전송 구현 여부. 연동을 붙이는 날 true 로 바꾼다(그 전엔 '전송 완료'를 쓸 수 없다). */
  implemented: false,
  manualFallback:
    '교류 문서를 내려받아 진료정보교류시스템(또는 수신 기관 지정 경로)으로 직접 전달한 뒤 회신번호를 기록하십시오',
};

/** 교류 이력 상태 어휘 — 스키마가 VarChar(20)(enum 아님)이라 여기가 정본이다. */
export const HIE_STATUS = {
  /** 문서 생성 직후 — 아직 전송을 시도하지 않았다 */
  PENDING: 'PENDING',
  /** 원내 기록만 완료 — 게이트웨이로 **나가지 않았다** */
  LOCAL_RECORDED: 'LOCAL_RECORDED',
  /** 전송을 시도했으나 실패 */
  SEND_FAILED: 'SEND_FAILED',
  /** 실제 전송 성공(현재는 게이트웨이 미구현이라 이 값이 새로 기록되지 않는다) */
  SENT: 'SENT',
  /** 외부에서 수신 — 수신은 문서가 실제로 도착한 것이라 시뮬레이션이 아니다 */
  RECEIVED: 'RECEIVED',
} as const;

/**
 * 🔴 재전송 가능 상태 — **실제로 나가지 않은 건은 다시 시도할 수 있어야 한다.**
 * (KIDS·법정감염병에서 겪은 함정: 시뮬레이션 'SENT' 가 재시도를 영구 차단하면
 *  진짜 연동이 붙는 날 그 건은 영구 누락된다.)
 */
export const RETRANSMITTABLE_STATUSES: readonly string[] = [
  HIE_STATUS.PENDING,
  HIE_STATUS.LOCAL_RECORDED,
  HIE_STATUS.SEND_FAILED,
  'FAILED', // 구 어휘(2026-08 이전 행)
];

/** 원내 관리번호 — **게이트웨이가 준 번호가 아님**을 접두어로 드러낸다. */
export function localHieRef(now: Date = new Date()): string {
  return `LOCAL-HIE-${now.getTime().toString(36).toUpperCase()}`;
}

/** 미전송 사유를 errorMessage 에 남기는 한 줄 — 사람이 읽고 바로 조치할 수 있게 쓴다. */
export function hieNotTransmittedLog(at: Date, extra?: { requestedBy?: string; reason?: string }): string {
  const who = extra?.requestedBy ? ` · 요청자 ${extra.requestedBy}` : '';
  const why = extra?.reason ?? `${HIE_GATEWAY.name} 연동 미구축 — 전송 코드 없음`;
  return `[미전송] ${at.toISOString()}${who} · ${why} · 조치: ${HIE_GATEWAY.manualFallback}`;
}

export type HieTransmissionState =
  | 'PENDING'
  | 'LOCAL_ONLY'
  | 'SEND_FAILED'
  | 'UNVERIFIED'
  | 'SENT'
  | 'RECEIVED';

export interface HieTransmissionInfo {
  state: HieTransmissionState;
  /** 상대 기관에 실제로 도달한 근거가 있는가 */
  transmitted: boolean;
  /** 다시 보낼 수 있는가(미전송·실패는 항상 true) */
  retransmittable: boolean;
  label: string;
  note: string;
  channel: string;
}

/**
 * 읽는 쪽에서 전송 여부를 판정한다 — **기존 저장값은 변조하지 않는다**.
 * 게이트웨이가 존재한 적이 없으므로 과거 `status='SENT'` 행은 '전송 완료'가 아니라
 * `UNVERIFIED`(전송 근거 없음)로 읽는다.
 */
export function classifyHieTransmission(r: {
  direction?: string | null;
  status: string;
  sentAt?: Date | null;
}): HieTransmissionInfo {
  const channel = HIE_GATEWAY.name;

  // 수신은 문서가 실제로 도착한 것 — 전송 판정 대상이 아니다.
  if (r.direction === 'RECEIVE' || r.status === HIE_STATUS.RECEIVED) {
    return {
      state: 'RECEIVED',
      transmitted: true,
      retransmittable: false,
      label: '수신',
      note: '외부 기관 문서를 수신했습니다',
      channel,
    };
  }

  if (r.status === HIE_STATUS.PENDING) {
    return {
      state: 'PENDING',
      transmitted: false,
      retransmittable: true,
      label: '전송 대기',
      note: '문서를 만들었으나 아직 전송하지 않았습니다',
      channel,
    };
  }

  if (r.status === HIE_STATUS.SEND_FAILED || r.status === 'FAILED') {
    return {
      state: 'SEND_FAILED',
      transmitted: false,
      retransmittable: true,
      label: '전송 실패',
      note: `전송에 실패했습니다 — ${HIE_GATEWAY.manualFallback}`,
      channel,
    };
  }

  if (r.status === HIE_STATUS.LOCAL_RECORDED) {
    return {
      state: 'LOCAL_ONLY',
      transmitted: false,
      retransmittable: true,
      label: '원내 기록(미전송)',
      note: `상대 기관으로 전송되지 않았습니다 — ${HIE_GATEWAY.manualFallback}`,
      channel,
    };
  }

  // SENT
  if (!HIE_GATEWAY.implemented) {
    return {
      state: 'UNVERIFIED',
      transmitted: false,
      retransmittable: true,
      label: '전송 근거 없음',
      note: `게이트웨이 연동이 구축된 적이 없어 이 건의 '전송 완료'는 근거가 없습니다 — ${HIE_GATEWAY.manualFallback}`,
      channel,
    };
  }

  return {
    state: 'SENT',
    transmitted: true,
    retransmittable: false,
    label: '전송 완료',
    note: '상대 기관 접수 확인',
    channel,
  };
}
