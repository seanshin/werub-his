/**
 * AI(WeRU.B) 어시스턴트 패널 명령 **정본**(2026-10-02 어시스턴트 재구성).
 *
 * 🔴 종전엔 명령이 세 곳에 따로 있었다(P12):
 *    · 서버 `processCommand` 의 switch 19갈래 · 서버 `/도움` 이 돌려주는 한국어 표 · 화면 퀵칩 6개
 *    → 칩은 6개만 보였고, `/요약`·`/재입원` 은 화면이 맥락을 한 번도 보내지 않아 **늘 실패**했다.
 *    이제 서버 분기·`/도움`·화면 명령 팔레트가 전부 이 표를 읽는다(빠지면 컴파일·가드가 잡는다).
 *
 * 라벨·설명은 한국어 원문 = i18n 키다(화면은 `<T k={…}>`).
 *
 * 🔴 `clinical` = 임상 판단(감별·위험도·처방 매핑)을 내놓는 명령. 허용 역할은 **진료 직군만**(DOCTOR·NURSE) —
 *    RolesGuard 의 ADMIN 전역 우회가 EP 에서는 통과시키므로 **서버가 명령 단위로 다시 막는다**.
 * 🔴 `draft` = 산출물이 기록 문장(SOAP·설명문·문서)이다 — 화면은 "초안 · 확정 아님"을 붙이고, 차트에 쓰는 경로는 없다
 *    (복사만 · 확정은 사람이 기록 화면에서).
 * 🔴 `needs` = 명령이 동작하려면 반드시 있어야 하는 것. 없으면 서버가 **AI 를 부르지 않고** 이유 코드로 돌려준다
 *    (빈 증상·빈 진단을 AI 에 보내 그럴듯한 답을 받지 않는다).
 */

export type AiChatCommandGroup = 'RECORD' | 'CLINICAL' | 'REFERENCE' | 'HELP';

/** 명령이 요구하는 입력 — ARG=명령 뒤 글, SOAP=진료 작성 화면의 현재 SOAP, PATIENT=환자 맥락 */
export type AiChatNeed = 'ARG' | 'SOAP' | 'PATIENT';

export interface AiChatCommandDef {
  /** 정본 명령(`/` 포함) */
  cmd: string;
  /** 같은 명령의 다른 표기 */
  aliases?: readonly string[];
  group: AiChatCommandGroup;
  /** 짧은 이름(팔레트·칩) */
  label: string;
  /** 한 줄 설명 */
  desc: string;
  /** 인자 자리 표시(예: `증상1, 증상2`) — 없으면 인자 없이 쓴다 */
  argHint?: string;
  needs: readonly AiChatNeed[];
  clinical: boolean;
  draft: boolean;
  /** 환자 정보(기록 문장·환자 나이/성별)가 외부 AI 로 나가는가 — 감사 기록에 환자를 귀속한다 */
  sendsPatientData: boolean;
  /**
   * 호출 계측 키(ASCII · 2026-10-02) — AI 호출 원장 `skill` 이 `medical-ai:chat.<metric>` 으로 남는다.
   * 🔴 종전엔 어시스턴트 호출이 전부 `medical-ai` 한 덩어리라 어떤 명령이 얼마나 불렸는지 알 수 없었다.
   */
  metric: string;
}

/** 명령 없이 입력한 글·모르는 명령(참고 검색으로 처리) 의 계측 키 */
export const AI_CHAT_FREE_METRIC = 'free';

const CLINICAL_ROLES = ['DOCTOR', 'NURSE'] as const;
const GENERAL_ROLES = ['DOCTOR', 'NURSE', 'ADMIN'] as const;

/** 패널을 열 수 있는 역할(EP `@Roles(DOCTOR, NURSE)` + ADMIN 전역 우회와 같은 집합) */
export const AI_CHAT_PANEL_ROLES = GENERAL_ROLES;

export const AI_CHAT_COMMANDS: readonly AiChatCommandDef[] = [
  { cmd: '/도움', group: 'HELP', label: '명령어', desc: '사용할 수 있는 명령을 봅니다', needs: [], clinical: false, draft: false, sendsPatientData: false, metric: 'help' },

  { cmd: '/요약', group: 'RECORD', label: '진료 요약', desc: '작성 중인 SOAP 를 요약합니다(진료 작성 화면에서)', needs: ['SOAP'], clinical: false, draft: true, sendsPatientData: true, metric: 'summarize' },
  { cmd: '/초안', group: 'RECORD', label: '기록 초안', desc: '작성 중인 SOAP 로 의무기록 초안을 만듭니다', argHint: 'progress_note', needs: ['SOAP'], clinical: false, draft: true, sendsPatientData: true, metric: 'draft' },
  { cmd: '/자동기록', group: 'RECORD', label: '대화→SOAP', desc: '진료 대화 원문을 SOAP 초안으로 정리합니다', argHint: '진료 대화', needs: ['ARG'], clinical: false, draft: true, sendsPatientData: true, metric: 'auto-record' },
  { cmd: '/설명', group: 'RECORD', label: '환자 설명문', desc: '진단명으로 환자용 설명문 초안을 만듭니다', argHint: '진단명', needs: ['ARG'], clinical: false, draft: true, sendsPatientData: false, metric: 'explain' },
  { cmd: '/문서', group: 'RECORD', label: '문서 작성', desc: '퇴원요약·소견서 등 문서 초안을 만듭니다', argHint: '내용', needs: ['ARG'], clinical: false, draft: true, sendsPatientData: true, metric: 'writing' },

  { cmd: '/감별', group: 'CLINICAL', label: '감별진단', desc: '증상으로 감별진단 후보를 봅니다(환자 맥락이 있으면 나이·성별 포함)', argHint: '증상1, 증상2', needs: ['ARG'], clinical: true, draft: false, sendsPatientData: true, metric: 'ddx' },
  { cmd: '/정밀감별', group: 'CLINICAL', label: '정밀 감별', desc: '여러 모델을 거친 감별진단을 봅니다', argHint: '증상', needs: ['ARG'], clinical: true, draft: false, sendsPatientData: false, metric: 'ddx-enhanced' },
  { cmd: '/추론', group: 'CLINICAL', label: '임상 추론', desc: '증상→감별→순위→검사→평가 5단계 추론을 봅니다', argHint: '증상1, 증상2', needs: ['ARG'], clinical: true, draft: false, sendsPatientData: true, metric: 'reasoning' },
  { cmd: '/매핑', group: 'CLINICAL', label: '질병→검사·처방', desc: '질병코드에 흔히 연결되는 검사·처방을 봅니다', argHint: '질병코드', needs: ['ARG'], clinical: true, draft: false, sendsPatientData: false, metric: 'code-mapping' },
  { cmd: '/재입원', group: 'CLINICAL', label: '재입원 위험도', desc: '입원 환자의 재입원 위험도(나이·성별·재원일수는 실제 입원 건에서 읽음)', argHint: '진단1, 진단2', needs: ['ARG', 'PATIENT'], clinical: true, draft: false, sendsPatientData: true, metric: 'readmission' },
  { cmd: '/부작용', group: 'CLINICAL', label: '약물 부작용', desc: '약물 조합의 부작용 가능성을 봅니다', argHint: '약물1, 약물2', needs: ['ARG'], clinical: true, draft: false, sendsPatientData: false, metric: 'adr' },

  { cmd: '/참고', group: 'REFERENCE', label: '참고자료 검색', desc: '의학 참고자료에서 찾아 답합니다', argHint: '질문', needs: ['ARG'], clinical: false, draft: false, sendsPatientData: false, metric: 'reference' },
  { cmd: '/약물', group: 'REFERENCE', label: '약물 정보', desc: '약물 정보·금기·상호작용을 봅니다', argHint: '약물명', needs: ['ARG'], clinical: false, draft: false, sendsPatientData: false, metric: 'drug' },
  { cmd: '/번역', group: 'REFERENCE', label: '의학 번역', desc: '영어 의학 용어·문장을 번역합니다', argHint: '영문', needs: ['ARG'], clinical: false, draft: false, sendsPatientData: false, metric: 'translate' },
  { cmd: '/KCD', aliases: ['/kcd'], group: 'REFERENCE', label: 'KCD 검색', desc: 'KCD 질병코드를 찾습니다', argHint: '검색어', needs: ['ARG'], clinical: false, draft: false, sendsPatientData: false, metric: 'kcd' },
  { cmd: '/EDI', aliases: ['/edi'], group: 'REFERENCE', label: 'EDI 검색', desc: 'EDI 수가코드를 찾습니다', argHint: '검색어', needs: ['ARG'], clinical: false, draft: false, sendsPatientData: false, metric: 'edi' },
] as const;

export const AI_CHAT_GROUP_LABEL: Readonly<Record<AiChatCommandGroup, string>> = {
  RECORD: '기록',
  CLINICAL: '임상 판단',
  REFERENCE: '참고',
  HELP: '도움',
};

/** 명령을 쓸 수 있는 역할 — 임상 판단은 진료 직군만 */
export function aiChatCommandRoles(def: AiChatCommandDef): readonly string[] {
  return def.clinical ? CLINICAL_ROLES : GENERAL_ROLES;
}

export function canUseAiChatCommand(def: AiChatCommandDef, role: string | null | undefined): boolean {
  return !!role && aiChatCommandRoles(def).includes(role);
}

/** 입력 첫 낱말로 명령을 찾는다(별칭 포함). 없으면 null — 서버는 참고 검색으로 넘긴다 */
export function findAiChatCommand(token: string): AiChatCommandDef | null {
  return AI_CHAT_COMMANDS.find((c) => c.cmd === token || c.aliases?.includes(token)) ?? null;
}

/** `/명령 인자…` 를 나눈다 — 명령이 아니면 cmd=null */
export function parseAiChatInput(message: string): { cmd: AiChatCommandDef | null; token: string | null; arg: string } {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return { cmd: null, token: null, arg: trimmed };
  const sp = trimmed.search(/\s/);
  const token = sp < 0 ? trimmed : trimmed.slice(0, sp);
  const arg = sp < 0 ? '' : trimmed.slice(sp + 1).trim();
  return { cmd: findAiChatCommand(token), token, arg };
}

/** 패널 → 서버 맥락 계약(서버는 이 키만 읽는다 · 나이·성별은 서버가 환자 원장에서 읽는다) */
export interface AiChatContextPayload {
  patientId?: string;
  encounterId?: string;
  /** 진료 작성 화면의 현재 SOAP(저장 전 포함 — 화면에 보이는 그대로) */
  soap?: { subjective?: string; objective?: string; assessment?: string; plan?: string };
  department?: string;
}

/** 출처 3상태 — 정본 임상 UX 규약 */
export type AiChatSource = 'AI' | 'FALLBACK' | 'UNAVAILABLE';

/** 서버가 AI 를 부르지 않았거나 못 받은 이유(코드 — 문장은 화면이 만든다) */
export type AiChatReason =
  | 'ARG_REQUIRED'
  | 'SOAP_REQUIRED'
  | 'SOAP_EMPTY'
  | 'PATIENT_REQUIRED'
  | 'PATIENT_NOT_FOUND'
  | 'ROLE_NOT_ALLOWED'
  | 'UPSTREAM_ERROR'
  | 'AI_DISABLED'
  | 'READMISSION_NO_DOB'
  | 'READMISSION_NO_SEX'
  | 'READMISSION_NO_ADMISSION'
  | 'READMISSION_NO_LOS';

export const AI_CHAT_REASON_TEXT: Readonly<Record<AiChatReason, string>> = {
  ARG_REQUIRED: '이 명령은 뒤에 입력이 필요합니다',
  SOAP_REQUIRED: '진료 작성 화면에서만 쓸 수 있습니다(작성 중인 SOAP 가 없습니다)',
  SOAP_EMPTY: '작성 중인 SOAP 가 비어 있습니다',
  PATIENT_REQUIRED: '환자 맥락이 필요합니다 — 환자 화면에서 여세요',
  PATIENT_NOT_FOUND: '환자를 찾을 수 없습니다',
  ROLE_NOT_ALLOWED: '임상 판단 명령은 진료 직군(의사·간호사)만 쓸 수 있습니다',
  UPSTREAM_ERROR: 'AI 서버가 응답하지 않았습니다 — 결과가 없는 것이 아니라 받지 못한 것입니다',
  AI_DISABLED: 'AI 기능이 꺼져 있습니다(관리자 설정)',
  READMISSION_NO_DOB: '생년월일이 없어 나이를 알 수 없어 산출하지 않았습니다',
  READMISSION_NO_SEX: '성별이 기록되어 있지 않아 산출하지 않았습니다',
  READMISSION_NO_ADMISSION: '입원 이력이 없어 산출하지 않았습니다(입원 건에 대해서만)',
  READMISSION_NO_LOS: '재원일수를 계산할 수 없어 산출하지 않았습니다',
};
