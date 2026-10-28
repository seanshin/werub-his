/**
 * 🔴 KONOS(장기이식관리센터) 대기자 등록 채널 — 2026-09-15 T1.
 *
 * 무엇이 잘못이었나:
 *  - `POST /transplant/waitlist/:id/konos` 가 전송 코드 없이 `konosRegistrationId: 'KONOS-'+Date.now()` ·
 *    `status: 'REGISTERED'` · `registeredAt: now` 를 **지어내 돌려줬다**(P16 — 실행하지 않고 성공만 기록).
 *    기관이 준 번호처럼 보이는 값을 받은 호출자가 대기자에 옮겨 적으면 "등록된 환자"가 된다.
 *
 * 원칙(대외 발신 정본 `infection-control/external-reporting.ts` 와 같은 규약):
 *  - 없는 연동을 흉내내지 않는다 — 결과는 `{attempted, sent, reason}` · 외부 번호·시각은 `null`.
 *  - 원장에 아무것도 쓰지 않으므로 몇 번이고 다시 부를 수 있다(재전송 가능).
 *  - 사람이 기관 시스템에 수기 등록한 번호는 대기자 `konosId` 에 기록한다 — 그 값만 "기관 번호"다.
 * 실제 연동이 붙는 날 고칠 자리는 `TransplantService.registerKonos` 한 곳이고, 그 전엔 `implemented:false`.
 */
export const KONOS_CHANNEL = {
  key: 'KONOS',
  name: '장기이식관리센터(KONOS) 대기자 등록',
  implemented: false,
  manualFallback: 'KONOS 시스템에서 수기 등록 후 부여된 등록번호를 대기자 KONOS 번호(konosId)에 기록하십시오',
} as const;

export const KONOS_NOT_IMPLEMENTED = 'KONOS_CHANNEL_NOT_IMPLEMENTED' as const;

/** 대기자 등록 전송 결과 — 미구축 동안 `sent` 는 항상 false · 외부 번호/시각은 null. */
export interface KonosRegisterResult {
  waitlistId: string;
  channel: typeof KONOS_CHANNEL.key;
  attempted: boolean;
  sent: boolean;
  reason: string | null;
  /** 기관이 부여한 등록번호 — 전송 성공 시에만. 미구축이면 null. */
  konosRegistrationId: string | null;
  /** 기관이 접수한 시각 — 모르는 시각은 추정하지 않는다. */
  registeredAt: Date | null;
  /** 사람이 수기 등록 후 대기자에 기록해 둔 번호(출처=원내 기록) */
  recordedKonosId: string | null;
  manualFallback: string;
  organType: string;
  bloodType: string;
  urgency: string;
}
