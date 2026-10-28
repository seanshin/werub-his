/**
 * 환자 식별 QR/바코드 페이로드 — **정본**(2026-08-18).
 *
 * 🔴 정본이 없어서 갈라져 있던 것(P12):
 *   - 발급 A: 환자 팔찌 인쇄(`PatientHeader`)      → `{"t":"PATIENT","mrn":…,"n":성명,"dob":생년월일,"g":성별}`
 *   - 발급 B: 포털 '내 QR'(`ProfileTab`)            → 위와 동일 JSON
 *   - 발급 C: 포털 셀프 체크인(`SelfCheckIn`)       → `HRPT:<MRN>`
 *   - 소비 A: BCMA 투약 대조(nursing.service)       → **MRN 완전일치만 통과**
 *   - 소비 B: 접수 워크스테이션 스캔(front-desk)     → `HRPT:` 접두만 제거 후 환자검색
 *   ⇒ 팔찌(JSON)를 BCMA 에 스캔하면 **항상 `BCMA_PATIENT_MISMATCH`** — 개통 이래 통과 불가.
 *
 * 🔴 페이로드에 성명·생년월일·성별을 넣지 않는다(PHI 최소화).
 *    팔찌/QR 사진 한 장이 곧 신원 전체가 되면 안 된다. 식별자는 MRN 하나로 충분하고,
 *    이름 대조는 사람이 팔찌의 인쇄 텍스트로 한다(IPSG.1 두 식별자는 화면·팔찌 인쇄분이 담당).
 *
 * **발급 정본 = `buildPatientQr(mrn)` = MRN 문자열 그대로.**
 * 접두 없는 순수 MRN 으로 정한 이유: 유일한 서버 소비자(BCMA)가 MRN 완전일치 비교이며
 * 서버 파서를 이 커밋에서 바꿀 수 없다(모듈 소유 분리). 접두를 붙이면 BCMA 는 계속 100% 실패한다.
 * 소비측은 `parsePatientQr()` 로 **구 형식(JSON·`HRPT:`)까지 관대하게** 받는다 —
 * 이미 인쇄되어 병동에 돌아다니는 팔찌가 있기 때문이다.
 */

/** 구 형식 접두(포털 셀프 체크인이 쓰던 것). 신규 발급에는 쓰지 않는다. */
export const LEGACY_PATIENT_QR_PREFIX = 'HRPT:';

/** 발급 정본 — 환자 식별 QR/바코드 페이로드. PHI(성명·생년월일·성별) 금지. */
export function buildPatientQr(mrn: string | null | undefined): string {
  const v = String(mrn ?? '').trim();
  return v;
}

/**
 * 소비 정본 — 스캔 원문에서 MRN 을 뽑는다. 인식 불가면 `null`(추정하지 않는다).
 * 지원: ① 순수 MRN(정본) ② `HRPT:<MRN>`(구 포털) ③ `{"t":"PATIENT","mrn":…}`(구 팔찌 인쇄분)
 */
export function parsePatientQr(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as { t?: unknown; mrn?: unknown };
      if (o && typeof o === 'object' && (o.t === undefined || o.t === 'PATIENT')) {
        const mrn = typeof o.mrn === 'string' ? o.mrn.trim() : '';
        return mrn || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  const upper = s.toUpperCase();
  if (upper.startsWith(LEGACY_PATIENT_QR_PREFIX)) {
    const mrn = s.slice(LEGACY_PATIENT_QR_PREFIX.length).trim();
    return mrn || null;
  }

  return s;
}
