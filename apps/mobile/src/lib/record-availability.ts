/**
 * 환자에게 보이는 기록 중 **원내에 쓰는 경로가 아예 없는 것** — 모바일 미러.
 *
 * 정본은 `packages/shared/src/record-availability.ts` 다. 모바일은 Metro 번들러가
 * 워크스페이스 패키지를 따라가지 못해 값을 **의도적으로 복제**한다(`lab-flags.ts` 와 같은 관례).
 * 웹 구조 가드(`apps/web/test/architecture/record-availability-mirror.spec.ts`)가 이 파일의 값을
 * shared 와 기계 대조한다 — 한쪽만 바뀌면 실패한다.
 *
 * 🔴 2026-09-02 실측: `vaccinations` 는 읽는 곳 3(포털·모바일·FHIR), 쓰는 곳 **0**.
 *    그런데 이 화면은 빈 목록에 대고 "예방접종 기록이 없습니다"라고 단정했다 —
 *    환자는 그것을 **자기 접종 이력**으로 읽는다. 자료 부재와 진짜 0 은 다른 사실이다.
 */
export const VACCINATION_RECORDING_SUPPORTED = false;

export const VACCINATION_UNSUPPORTED_NOTE =
  '본원은 예방접종 이력을 별도로 관리하지 않습니다. 이 목록이 비어 있는 것이 "접종을 받지 않았다"는 뜻은 아닙니다.';
