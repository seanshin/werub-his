/**
 * AI 소견 **근거(grounding)** 계약 — 원자료가 없으면 AI 를 부르지 않는다.
 *
 * 🔴 왜 필요한가(2026-08-18 실측 · P15/P16 정면 위반 5건):
 *   · 영상 판독: `visionAnalyze('' , …)` — **영상 URL 자리에 빈 문자열**을 넣고 "판독 소견"을 받아
 *     화면에 렌더했다. 보지 않은 영상의 소견이다.
 *   · 검사 해석: `results: [{ testName: <주호소>, value: 'pending' }]` — 값 자리에 문자열 `'pending'`,
 *     검사명 자리에 주호소를 넣었다. 해석 대상이 존재하지 않는다.
 *   · 추적 검진 권고: 검진 결과를 **한 건도 보내지 않고** "비정상 소견이 발견되었습니다"라는
 *     **허위 전제**로 권고를 받았다.
 *   · 건강 점수: 진료 횟수·검사 횟수만으로 0~100 점을 만들어 **환자에게 직접** 노출했다.
 *   · 재입원 위험도: `age: 65, sex: 'M', lengthOfStay: 5` **상수**를 박아 위험도를 산출했다.
 *
 * 이 저장소의 판정 규칙이 답을 정해 두었다 —
 *   **표본 부재의 정답은 폴백이 아니라 `null` + "산출 불가"** 다(`0`·상수·플레이스홀더는 다른 사실이다).
 *   **입력을 그럴듯하게 채워 넣어 호출을 성사시키지 않는다.**
 *
 * 그래서 호출 직전에 원자료 유무를 판정하고, 없으면 **호출하지 않고** 이 계약을 돌려준다.
 * `source: 'UNAVAILABLE'` 은 `'FALLBACK'`(= 호출은 했으나 실패)과 **구분되는 사실**이다 —
 * 화면이 둘을 같게 그리면 결함이 화면으로 이동할 뿐이다.
 */

/** 산출 불가 사유 코드 — 화면이 문구가 아니라 코드로 분기하도록 기계 판정 키를 준다. */
export type AiUnavailableCode =
  /** 판독·해석 대상 원자료가 아직 존재하지 않음(결과 미입력·항목 0건) */
  | 'NO_SOURCE_DATA'
  /** 원자료는 있으나 외부 AI 가 가져갈 수 없음(영상 바이트·인증 경로 부재) */
  | 'SOURCE_UNREACHABLE'
  /** 산출에 필요한 입력이 부족함(나이·성별·재원일수 등 미기록) */
  | 'INSUFFICIENT_INPUT'
  /** 검증된 산출 도구가 없어 수치화 자체가 불가(임의 점수는 날조) */
  | 'NO_VALIDATED_INSTRUMENT';

export interface AiUnavailable {
  /** 🔴 'FALLBACK'(호출 실패)과 구분 — 이건 **부르지 않았다**는 사실이다. */
  source: 'UNAVAILABLE';
  available: false;
  reasonCode: AiUnavailableCode;
  /** 사람이 읽는 사유 — 화면은 이 문장을 그대로 보여준다(무엇이 없어서 못 하는지). */
  reason: string;
}

export function aiUnavailable(reasonCode: AiUnavailableCode, reason: string): AiUnavailable {
  return { source: 'UNAVAILABLE', available: false, reasonCode, reason };
}

/**
 * 🔴 프롬프트에 넣는 "없음"도 3가지를 구분한다 — `없음(확인됨)` / `미기록·미문진` / `조회 실패`.
 *
 * 2026-08-19 실측: FE 는 NKA 3상태(미문진/없음/확인불가)를 지키는데, 프롬프트 조립 층 26곳이
 * `list.join(', ') || '없음'` 으로 **AI 에게는 "없음"이라고 말하고 있었다.** 감별진단·약물 추천 프롬프트가
 * 문진하지 않은 환자를 "알레르기 없음"으로 전제하면 AI 는 그 전제 위에서 약을 고른다.
 * 근거 게이트가 프롬프트 층에서 뒤집힌 것이다(`clinical-ux-agent-era.plan.md` §7.5-b).
 */
export const PROMPT_UNRECORDED = '기록 없음(등록 항목 0건 — "없음"으로 확인된 것은 아님)';

/** 목록을 프롬프트 한 줄로 — 비어 있으면 "없음"이 아니라 미기록이라고 말한다 */
export function promptList(items: readonly (string | null | undefined)[] | null | undefined, sep = ', '): string {
  const xs = (items ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0);
  return xs.length ? xs.join(sep) : PROMPT_UNRECORDED;
}

/** 알레르기 3상태(정본 `AllergyService.getStatus`) → 프롬프트 문장. 상태 서비스가 없으면 "조회 불가"라고 말한다. */
export function allergyPromptLine(
  st: { status: string; allergies: { allergen: string }[] } | null | undefined,
): string {
  if (!st) return '조회 불가(문진 상태를 확인하지 못함 — 없음으로 가정하지 말 것)';
  switch (st.status) {
    case 'HAS_ALLERGIES':
      return st.allergies.map((a) => a.allergen).join(', ') || PROMPT_UNRECORDED;
    case 'NO_KNOWN_ALLERGIES':
      return '없음(문진으로 확인됨)';
    case 'UNABLE_TO_ASSESS':
      return '확인 불가(문진 불가 — 없음으로 가정하지 말 것)';
    default:
      return '미문진(알레르기 정보 없음 — 없음으로 가정하지 말 것)';
  }
}
