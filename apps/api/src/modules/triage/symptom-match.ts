/**
 * 트리아지 증상 매칭 정본 (2026-08 W8 R0)
 *
 * 🔴 원 결함 T1 — `text.includes(alias)` 단순 부분일치였다.
 *    DB 별칭은 "머리 아파요"·"가슴 답답" 형태인데 환자는 "머리가 아파요"·"가슴이 답답해요" 라고 쓴다.
 *    조사(가/이/은/는…) 한 글자, 공백 하나, 어미 변화 하나로 매칭이 통째로 빗나갔고,
 *    그 결과 실운영 공개 예약 16건 중 6건이 "내과 · 기본 추천(50%)" 으로 흘렀다(T2).
 *
 * 🔴 원 결함 T4 — agent-session.service.ts 에 컴파일 타임 `SYMPTOM_DEPT_MAP` 이 따로 있어
 *    증상 매칭 경로가 둘이었고, 그 중 하나에는 응급 개념 자체가 없었다.
 *    이제 두 경로 모두 이 파일의 `matchPhrase()` 하나만 쓴다 — 정본은 하나다.
 *
 * 설계 원칙: 과매칭을 만들지 않는다(거짓 경보는 진짜 경보를 죽인다).
 *  - 별칭이 한 덩어리면 예전과 똑같은 부분일치 — 허용 범위를 넓히지 않는다.
 *  - 별칭이 여러 덩어리면 덩어리들이 "순서대로" 나오고, 그 사이 틈이
 *    **조사로만 이루어진 2글자 이하**일 때만 인정한다. ("가슴 답답" ⊂ "가슴이 답답해요" ○,
 *    "가슴은 아프지만 답답하진 않아요" ×)
 *  - 어미 정규화는 닫힌 목록(아프다·답답하다·어지럽다 3계열)만. 형태소 분석기를 흉내내지 않는다.
 */

/** 덩어리 사이에 끼어들 수 있다고 인정하는 조사 글자 (닫힌 목록) */
const PARTICLE_CHARS = new Set(['가', '이', '은', '는', '을', '를', '에', '의', '도', '만', '과', '와', '랑', '서', '로', '께']);

/** 덩어리 사이 허용 최대 길이 — 조사 2글자("에서", "이나"가 아닌 조사 조합)까지 */
const MAX_PARTICLE_GAP = 2;

/**
 * 어미 정규화 — 닫힌 목록.
 * 양쪽(입력 텍스트 / DB 별칭·증상명)에 **같은 함수**를 적용해야 의미가 있다.
 * 목록에 없는 동사는 건드리지 않는다(모르는 것을 아는 척하지 않는다).
 */
const VERB_FORMS: ReadonlyArray<readonly [RegExp, string]> = [
  // 아프다 계열: 아파요/아픕니다/아프고/아픈데/아파서/아퍼/아픔 → 아파
  [/아(?:픕니다|프네요|프신데|픈데요|파서요|파요|퍼요|프고|프다|프네|픈데|파서|파|퍼|픔)/g, '아파'],
  // 답답하다 계열: 답답해요/답답합니다/답답하고/답답함 → 답답
  [/답답(?:합니다|하네요|해요|하고|해서|함|해)?/g, '답답'],
  // 어지럽다 계열: 어지러워요/어지럽습니다/어지러움 → 어지러
  [/어지(?:럽습니다|러워요|러워서|럽네요|러움|러워|럽고|럽다|러)/g, '어지러'],
];

/** 한글/영숫자만 남긴다 — 공백·문장부호·이모지 제거 */
function stripNoise(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣ㄱ-ㆎ]+/g, '');
}

function applyVerbForms(s: string): string {
  let out = s;
  for (const [re, canon] of VERB_FORMS) out = out.replace(re, canon);
  return out;
}

/** 정규화: 잡음 제거 + 어미 정규화. 입력과 별칭 양쪽에 동일 적용. */
export function normalizeSymptomText(s: string): string {
  return applyVerbForms(stripNoise(s));
}

/** 별칭/증상명을 공백 기준 덩어리로 쪼갠 뒤 각각 정규화 (빈 덩어리는 버린다) */
export function phraseChunks(phrase: string): string[] {
  return (phrase ?? '')
    .split(/\s+/)
    .map(normalizeSymptomText)
    .filter(c => c.length > 0);
}

export interface PhraseMatch {
  /** 정규화된 입력 텍스트 안에서 매칭이 시작된 위치 */
  start: number;
  /** 매칭이 끝난 위치(exclusive) */
  end: number;
}

function isParticleGap(gap: string): boolean {
  if (gap.length === 0) return true;
  if (gap.length > MAX_PARTICLE_GAP) return false;
  for (const ch of gap) if (!PARTICLE_CHARS.has(ch)) return false;
  return true;
}

function searchFrom(hay: string, chunks: string[], ci: number, from: number, start: number): PhraseMatch | null {
  if (ci >= chunks.length) return { start, end: from };
  let idx = hay.indexOf(chunks[ci], from);
  while (idx >= 0) {
    if (ci === 0) {
      const found = searchFrom(hay, chunks, ci + 1, idx + chunks[ci].length, idx);
      if (found) return found;
    } else if (isParticleGap(hay.slice(from, idx))) {
      const found = searchFrom(hay, chunks, ci + 1, idx + chunks[ci].length, start);
      if (found) return found;
    } else {
      // 틈이 이미 허용 범위를 넘었다 — 뒤로 갈수록 더 멀어질 뿐이다.
      break;
    }
    idx = hay.indexOf(chunks[ci], idx + 1);
  }
  return null;
}

/**
 * 정규화된 입력(`hay`)에서 별칭/증상명(`phrase`)을 찾는다.
 * `hay` 는 반드시 `normalizeSymptomText()` 를 통과한 문자열이어야 한다.
 */
export function matchPhraseIn(hay: string, phrase: string): PhraseMatch | null {
  const chunks = phraseChunks(phrase);
  if (chunks.length === 0 || hay.length === 0) return null;
  if (chunks.length === 1) {
    const idx = hay.indexOf(chunks[0]);
    return idx < 0 ? null : { start: idx, end: idx + chunks[0].length };
  }
  return searchFrom(hay, chunks, 0, 0, 0);
}

/** 편의 함수 — 원문 텍스트를 직접 받는다 */
export function matchPhrase(text: string, phrase: string): PhraseMatch | null {
  return matchPhraseIn(normalizeSymptomText(text), phrase);
}

// ─────────────────────────────────────────────────────────────
// 응급 문구 정책 (T6)
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 원 결함 T6 — DB `triage_symptoms.emergency_msg` 10건은 전부
 *    "급성 관상동맥증후군/대동맥박리 감별 필요" 같은 **감별진단 임상 메모**다.
 *    수신자는 미인증 공개 예약 챗의 환자인데, 코드 폴백에 있던 "119에 연락하세요"가 시드에는 없어
 *    환자가 받는 첫 줄이 전문용어였고 **무엇을 해야 하는지가 없었다**.
 *
 *    과거 기록 변조를 피하기 위해 DB 저장값은 손대지 않는다.
 *    대신 **환자에게 나가는 행동 지시는 코드가 정본으로 소유**하고,
 *    DB 임상 메모는 스태프 채널(원무 데스크)에서만 참고로 덧붙인다.
 */
export const PATIENT_EMERGENCY_ACTION =
  '🚨 응급 상황일 수 있습니다. 지금 바로 119에 연락하거나 가까운 응급실로 가세요.';

/**
 * 🔴 원 결함 T3 — FALLBACK(못 알아들음)이 `emergency: false` 를 단정했다.
 *    "모름"을 "아님"으로 뒤바꿔 말하는 것(P1). 공개 채널에는 안전측 안내를 남긴다.
 */
export const PATIENT_EMERGENCY_UNDETERMINED =
  '말씀만으로는 응급 여부를 판단하지 못했습니다. 가슴 통증·호흡곤란·의식 저하·심한 출혈이 있으면 즉시 119에 연락하세요.';

/**
 * DB 응급 문구가 **환자용 행동 지시**인지 판정한다.
 * 판정 근거는 "119 / 응급실 지시가 문구 안에 있는가" 하나뿐이다(추측하지 않는다).
 * false 면 그 문구는 임상 메모이므로 환자에게 그대로 내보내지 않는다.
 */
export function isPatientActionableEmergencyMsg(msg?: string | null): boolean {
  return !!msg && /119|응급실|응급전화/.test(msg);
}

// ─────────────────────────────────────────────────────────────
// 시스템이 환자에게 제시하는 예시 문장 (정본)
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 원 결함 T1 의 발견 지점 — 이 목록은 시스템 **자신이** 환자에게 버튼으로 제시하는 문장이다.
 *    그런데 그 절반이 자기 자신의 매칭기를 통과하지 못했다.
 *    agent-session 의 `COMMON_SYMPTOMS` 에 사본이 있었으나(정본이 둘·P12) 여기로 합쳤다.
 *    `/api/v1/triage/self-check` 가 이 목록을 실제 DB 규칙에 돌려 실패를 화면에 드러낸다.
 */
export const TRIAGE_EXAMPLE_PHRASES: ReadonlyArray<{ label: string; icon: string; value: string; expectSymptom: boolean }> = [
  { label: '두통', icon: '🤕', value: '머리가 아파요', expectSymptom: true },
  { label: '복통', icon: '🤢', value: '배가 아파요', expectSymptom: true },
  { label: '기침/감기', icon: '🤧', value: '기침이 나고 감기 증상이 있어요', expectSymptom: true },
  { label: '발열', icon: '🌡️', value: '열이 나요', expectSymptom: true },
  { label: '허리통증', icon: '💪', value: '허리가 아파요', expectSymptom: true },
  { label: '관절통', icon: '🦵', value: '관절이 아파요', expectSymptom: true },
  { label: '피부 문제', icon: '🩹', value: '피부에 발진이 있어요', expectSymptom: true },
  { label: '눈 불편', icon: '👁️', value: '눈이 아프고 불편해요', expectSymptom: true },
  { label: '어지러움', icon: '😵', value: '어지러워요', expectSymptom: true },
  { label: '소화불량', icon: '😣', value: '소화가 안 돼요', expectSymptom: true },
  { label: '불면/수면', icon: '😴', value: '잠을 잘 못 자요', expectSymptom: true },
  { label: '가슴 답답', icon: '💓', value: '가슴이 답답해요', expectSymptom: true },
  { label: '소아 진료', icon: '👶', value: '아이가 아파요', expectSymptom: true },
  // 아래 둘은 증상이 아니라 서비스 요청 — 매칭 실패가 정상이다.
  { label: '건강검진', icon: '🩺', value: '건강검진을 받고 싶어요', expectSymptom: false },
  { label: '원격진료', icon: '📹', value: '원격진료(비대면 진료)를 예약하고 싶어요', expectSymptom: false },
];
