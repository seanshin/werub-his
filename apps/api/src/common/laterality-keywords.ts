/**
 * 오부위수술 방지(IPSG.4) — 좌우가 구분되는 부위/술식 키워드 코드 기본(폴백 정본).
 * 개정 표면 = config `surgery.lateralityKeywords`(유효 문자열 배열이면 전량 대체·§7 P1).
 * ⚠️ '신' 단독 토큰은 '신경/신생아' 등 오매칭 소지가 실측됨(2026-08-04) — 목록 내용 개정은
 *    위원회(SAFE) 재량이라 코드에서 임의 삭제하지 않는다. 화면(시스템 설정)에서 개정할 것.
 */
export const LATERALITY_REQUIRED_KEYWORDS = [
  '슬관절', '고관절', '견관절', '족관절', '주관절', '수부', '족부', '사지', '상지', '하지', '팔', '다리',
  '안구', '안와', '백내장', '망막', '눈', '귀', '고막', '편도',
  '신장', '신', '요관', '고환', '정관', '난소', '난관', '유방', '유선', '서혜부', '탈장', '폐', '폐엽',
];

/**
 * 좌우 구분(laterality) 판정 정본 — **키워드 근거로만** 판정한다.
 *
 * 🔴 왜 "모든 수술에 laterality 필수"가 아닌가:
 *    좌/우가 존재하지 않는 술식(충수절제·제왕절개·심장수술·정중선 접근)에까지 필수로 걸면
 *    집도의는 아무 값이나 골라 통과시킨다 — 그 순간 원장의 laterality 는 **거짓 데이터**가 되고
 *    진짜 좌우 경보(슬관절·안구)를 죽인다("거짓 경보는 진짜 경보를 죽인다").
 *    그래서 **쌍(pair)으로 존재하는 해부학적 부위 키워드**에 걸릴 때만 필수로 본다.
 *    키워드 목록은 위원회(SAFE) 개정 표면(config `surgery.lateralityKeywords`)이며
 *    이 함수는 판정 규칙만 담는다(목록을 여기서 만들지 않는다).
 *
 * 🔴 판정 불가는 '필수 아님'과 다르다 — 술식명도 부위도 비어 있으면 `null`(모름)을 낸다.
 *    모르는 것을 "필수 아님"으로 접으면 화면이 실제보다 안전하다고 말하게 된다.
 */
export type LateralityRequirement = true | false | null;

export function isLateralityRequired(
  procedureName: string | null | undefined,
  bodySite: string | null | undefined,
  keywords: string[],
): LateralityRequirement {
  const hay = `${procedureName ?? ''} ${bodySite ?? ''}`.trim();
  if (!hay) return null; // 근거 자체가 없다 — '필수 아님'이라고 말하지 않는다
  return keywords.some((k) => hay.includes(k));
}

/**
 * 기재된 laterality 가 "좌우를 특정했는가".
 * `null`(미입력)과 `NA`(해당 없음) 둘 다 **좌우를 특정하지 않았다** — 좌우구분 술식에서는 미기재다.
 * (좌우가 있는 부위에 'NA' 를 고르는 것은 부위 판정과 모순이다.)
 */
export function lateralitySpecified(laterality: string | null | undefined): boolean {
  return !!laterality && laterality !== 'NA';
}
