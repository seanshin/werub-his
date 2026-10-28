/**
 * VoiceEMR 앰비언트 — 화자 추정 휴리스틱 (C안·순수 로직)
 *
 * 실시간 chunk STT 에는 화자분리가 없어(Q13) 텍스트 신호로 추정만 한다.
 * 원칙(기획 §5): **신호 없으면 UNKNOWN — 억지 귀속 금지**. 배지는 ↔(추정) 표기·탭 정정,
 * 사후 배치 diarize(P2)·voiceprint(P3)가 정정한다. 화자 라벨은 UX 보조이지 안전 판정 근거가 아님.
 */

export type AmbientSpeaker = 'DOCTOR' | 'PATIENT' | 'UNKNOWN';

// 의사 신호 — 환자에게 묻는 질문형 종결·지시/계획 선언
const DOCTOR_QUESTION = /(어디|언제|어떠|얼마나|무슨|어떻게|몇|왜|있으세요|없으세요|드세요|불편)[^?]*(\?|세요|나요|까요|가요|습니까|입니까)\s*$|(세요|나요|까요|가요)\s*\?$/;
const DOCTOR_DIRECTIVE = /(처방|오더|검사|촬영|엑스레이|시티|초음파|주사)[^]*?(할게요|하겠습니다|낼게요|드릴게요|해드릴|합시다|봅시다|찍)|드릴게요$|해드릴게요$|보겠습니다$|지켜봅시다|경과를? 보/;
// 환자 신호 — 1인칭 증상 호소
const PATIENT_SYMPTOM = /(아파요|아프고|아팠|아파서|쑤시|저리|저려|어지럽|어지러|메스껍|메슥|기침이|열이 나|열나|콧물|설사|변비|구토|토했|가렵|따갑|답답|숨이 차|잠을 못|안 아파|괜찮아요|없어요|것 같아요|먹었어요|먹고 있어요)/;

/**
 * 발화 텍스트로 화자 추정.
 * 양쪽 신호가 다 잡히면(드묾) 질문/지시 우선(의사) — 증상 어휘는 의사도 되물으며 쓰기 때문.
 */
export function guessSpeaker(text: string): AmbientSpeaker {
  const t = text.trim();
  if (!t) return 'UNKNOWN';
  if (DOCTOR_QUESTION.test(t) || DOCTOR_DIRECTIVE.test(t)) return 'DOCTOR';
  if (PATIENT_SYMPTOM.test(t)) return 'PATIENT';
  return 'UNKNOWN';
}
