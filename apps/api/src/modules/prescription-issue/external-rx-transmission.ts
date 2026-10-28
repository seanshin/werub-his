/**
 * 🔴 전자처방전 **약국 전송** 채널 선언 — 2026-09-30.
 *
 * 국내에는 병원이 약국으로 처방전을 보내는 공용 전송망이 없다. 전송하려면 제3자 전달 서비스·팩스 등을 써야 하고,
 * 그 선택은 법률 검토(특정 약국 유도 금지·민감정보 제3자 제공 등)를 거친 **사람 결정**이다(`rx.external.transmission`).
 * 그래서 이 채널은 **구현되지 않았다**. 어떤 코드도 '전송 완료'를 적을 수 없다 — 원외처방전은 종이로 환자에게 교부되고,
 * 약국은 발급번호·QR 로 진위를 확인한다(`prescription-issue.service.ts`).
 * 연동이 붙는 날 고칠 자리는 여기(implemented)와 전송 함수 한 곳뿐이다.
 */
export const EPRESCRIPTION_CHANNEL = {
  key: 'EPRESCRIPTION',
  name: '전자처방전 약국 전송',
  implemented: false,
  manualFallback: '원외처방전을 인쇄해 환자에게 교부하십시오 — 약국은 인쇄물의 발급번호·QR 로 진위를 확인합니다(전송 없음)',
} as const;

/** 발급 응답에 싣는 전송 사실 — 나가지 않았으면 그렇다고 말한다(시각은 null) */
export function transmissionFact() {
  return {
    channel: EPRESCRIPTION_CHANNEL.key,
    implemented: EPRESCRIPTION_CHANNEL.implemented,
    transmitted: false as const,
    transmittedAt: null,
    reason: 'CHANNEL_NOT_IMPLEMENTED' as const,
  };
}
