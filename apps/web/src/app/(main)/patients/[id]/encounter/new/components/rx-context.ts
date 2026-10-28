/**
 * 처방 참고 패널 순수 로직 — 표기·정렬 규칙만.
 * 화면 문구가 임상 판단에 영향을 주므로(특히 알레르기 3-상태) 규칙을 함수로 고정한다.
 */

/** '아이리토정10밀리그램(아토르바스타틴칼슘삼수화물)_(10.85mg/1정)' → '아이리토정10밀리그램' */
export function drugShort(name: string): string {
  return name.replace(/[(_].*$/, '').trim() || name;
}

/** 'HbA1c 6.6%(H)' 처럼 H/L/A 플래그가 붙은 항목 = 이상치 */
export function isAbnormalLab(s: string): boolean {
  return /\((H|L|A)\)\s*$/i.test(s);
}

/** 이상치를 앞으로(원래 순서는 유지) */
export function sortLabs(labs: string[]): string[] {
  return labs.slice().sort((a, b) => Number(isAbnormalLab(b)) - Number(isAbnormalLab(a)));
}

/**
 * 알레르기 표기 — 🔴 빈 배열은 '없음'이 아니다(미문진 ≠ 무알레르기, NKA 3-상태 규약).
 * 없다고 단정하는 문구를 절대 만들지 않는다.
 */
export function allergyNotice(
  allergies: string[] | undefined,
  /** 서버 알레르기 문진 상태(patient-context `allergyStatus`) — 빈 목록의 뜻을 가른다 */
  status?: string,
): { kind: 'LIST' | 'NKA' | 'UNABLE' | 'NO_RECORD'; text?: string } {
  if (allergies && allergies.length > 0) return { kind: 'LIST' };
  // 빈 목록은 셋 중 하나다 — 무알레르기로 확인됨 / 문진 불가 / 아직 모름. 셋을 같은 문장으로 말하지 않는다
  if (status === 'NO_KNOWN_ALLERGIES') return { kind: 'NKA', text: '무알레르기 확인됨(NKA)' };
  if (status === 'UNABLE_TO_ASSESS') return { kind: 'UNABLE', text: '문진 불가로 기록됨' };
  return { kind: 'NO_RECORD', text: '등록된 알레르기 기록 없음' };
}
