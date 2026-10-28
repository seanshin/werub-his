/**
 * 환자 이름 표시 정본(2026-10-06) — 외국인 환자의 원어 이름 + 한국식 호칭(`Patient.koreanName`).
 *
 * 🔴 종전엔 화면·서버가 `${familyName}${givenName}` 로 붙여 썼다 — 한글 이름엔 맞지만 외국 이름은
 *    `Бат-ЭрдэнэСарнай`·`SmithJohn` 처럼 띄어쓰기가 사라졌고, 등록 때 받은 한글 호칭(`사르나이`)은 어디에도 보이지 않았다.
 *    (호출·확인 때 원어를 읽지 못하는 직원이 쓰라고 받은 값이다 — 원어를 대신하지 않고 **함께** 보인다)
 * 🔴 한글 호칭이 없으면 원어만 — 지어내지(음역하지) 않는다.
 */

/**
 * 띄어 쓰는 문자권의 글자 — 한글·한자·가나 **밖의** 글자(라틴·키릴·아랍·그리스·태국 등).
 * 🔴 "한글만"으로 판정하면 숫자가 섞인 이름(`길동1`·시드 `자격검증환자11`)까지 띄운다 — 글자 문자권으로만 가른다.
 */
const SPACED_SCRIPT_LETTER = /(?![\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\p{L}/u;
const HANGUL_LETTER = /\p{Script=Hangul}/u;
const CJK_LETTER = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** 한글 이름인가 — 한글 글자가 있고 띄어 쓰는 문자권 글자가 없다(숫자·기호는 상관없다) */
export function isHangulName(s: string | null | undefined): boolean {
  return !!s && HANGUL_LETTER.test(s) && !SPACED_SCRIPT_LETTER.test(s);
}

/**
 * 성 + 이름 — 어느 한쪽이라도 한글·한자·가나가 있으면 붙이고, 둘 다 라틴·키릴·아랍 등 띄어 쓰는 문자권이면 한 칸 띄운다.
 * 한쪽이 비면 있는 쪽만.
 */
export function joinPatientName(familyName: string | null | undefined, givenName: string | null | undefined): string {
  const f = (familyName ?? '').trim();
  const g = (givenName ?? '').trim();
  if (!f || !g) return f || g;
  // 어느 한쪽이라도 한글·한자·가나가 있으면 붙인다(한국식 이름 — 숫자·영문이 섞인 시드·테스트 이름 포함) · 둘 다 없으면 띄운다
  const tight = CJK_LETTER.test(f) || CJK_LETTER.test(g) || (!SPACED_SCRIPT_LETTER.test(f) && !SPACED_SCRIPT_LETTER.test(g));
  return tight ? `${f}${g}` : `${f} ${g}`;
}

/**
 * 표시용 이름 — 원어 이름과(한글 이름이 아닐 때만) 한국식 호칭.
 * `korean` 은 원어가 한글 이름이 아니고 호칭이 있으며 원어와 다를 때만 채운다(같은 말을 두 번 보이지 않는다).
 */
export function patientNameView(p: { familyName?: string | null; givenName?: string | null; koreanName?: string | null; name?: string | null }): { primary: string; korean: string | null } {
  const primary = joinPatientName(p.familyName, p.givenName) || (p.name ?? '').trim();
  const ko = (p.koreanName ?? '').trim();
  const korean = ko && primary && !isHangulName(primary) && ko !== primary ? ko : null;
  return { primary, korean };
}

/** 한 줄 문자열 — 인쇄·알림·검색 결과처럼 부품을 못 쓰는 자리 · 예 `Бат-Эрдэнэ Сарнай (사르나이)` */
export function patientNameLabel(p: { familyName?: string | null; givenName?: string | null; koreanName?: string | null; name?: string | null }): string {
  const v = patientNameView(p);
  return v.korean ? `${v.primary} (${v.korean})` : v.primary;
}
