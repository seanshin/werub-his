/**
 * 간호기록 **정본 경계** — 어느 표에 쓰는지를 컨텍스트가 정한다.
 *
 * 🔴 이 저장소의 간호기록은 정본이 둘이 아니라 **컨텍스트로 갈린 정본**이다.
 *   - 입원(admission 소속) 간호기록의 정본 = `NursingNote`(`/admissions/:id/nursing-notes`).
 *     서명·정정(amend)·공동서명·AI 프로비넌스·미비기록·사본발급 동결이 **이쪽에만** 있다.
 *   - 그 밖의 접점(외래·응급·PACU·수술·검사·영상) = `UniversalNursingNote`(`/nursing-notes`).
 *
 * 🔴 경계가 코드로 강제되지 않아 실제로 새어나간 적이 있다 —
 *   워크스테이션이 입원 기록을 `contextType:'INPATIENT'` 로 universal 에 밀어 넣어
 *   보드 최근기록·미서명·서명·QA 흐름 어디에도 안 잡히는 유령 기록을 만들었다(`127faa58` 에서 되돌림).
 *   되돌린 뒤에도 **막는 코드가 없어서** 같은 우회가 지금도 가능했다 → 이 파일이 그 정본이다.
 *   판정: `docs/05-reference/clinical-integrity-backlog.md` #10 · 기획 `universal-nursing-note.plan.md`.
 *
 * 어휘는 **시드에서 갈라진다** — 시드·화면·DTO 가 같은 목록을 봐야 한다(가드가 기계 대조한다).
 */

/** 범용 간호기록(UniversalNursingNote)이 붙을 수 있는 컨텍스트 — 정본 */
export const UNIVERSAL_NURSING_CONTEXT_TYPES = [
  'EMERGENCY',   // EmergencyVisit
  'PACU',        // PacuRecord
  'SURGERY',     // Surgery
  'OUTPATIENT',  // Encounter / WaitingQueue
  'LAB',         // Order(검사)
  'IMAGING',     // Order(영상)
  'PROCEDURE',   // 처치실
] as const;
export type UniversalNursingContextType = (typeof UNIVERSAL_NURSING_CONTEXT_TYPES)[number];

/**
 * 🔴 **금지 컨텍스트** — 재원(입원) 환자의 간호기록은 universal 로 쓰지 않는다.
 * 여기로 새면 서명·QA·미비기록·사본발급을 **전부 우회**한다. 정본은 `NursingNote`.
 */
export const ADMISSION_SCOPED_NURSING_CONTEXT_TYPES = ['INPATIENT', 'ICU', 'WARD', 'ADMISSION'] as const;
export type AdmissionScopedNursingContextType = (typeof ADMISSION_SCOPED_NURSING_CONTEXT_TYPES)[number];

/** 범용 간호기록 유형 — 화면(NursingNotePanel)이 제시하는 값과 한 벌 */
export const UNIVERSAL_NURSING_NOTE_TYPES = [
  'OBSERVATION', 'TREATMENT', 'MEDICATION', 'EDUCATION', 'HANDOFF', 'ASSESSMENT', 'INCIDENT',
] as const;
export type UniversalNursingNoteType = (typeof UNIVERSAL_NURSING_NOTE_TYPES)[number];

/** 심각도 — `StatusBadge`/시드와 한 벌 */
export const UNIVERSAL_NURSING_SEVERITIES = ['NORMAL', 'CAUTION', 'WARNING', 'CRITICAL'] as const;
export type UniversalNursingSeverity = (typeof UNIVERSAL_NURSING_SEVERITIES)[number];

/**
 * 본문 칸 — 🔴 이 중 **최소 한 칸**이 채워져야 기록이다.
 * 화면이 DTO 에 없는 키(`spiSituation` 등)로 보내던 시절, whitelist 가 그 키를 조용히 지워
 * **본문이 통째로 빈 행**이 저장될 수 있었다(성공 응답 + 데이터 소실).
 */
export const UNIVERSAL_NURSING_BODY_FIELDS = [
  'situation', 'background', 'assessment', 'recommendation', 'content',
] as const;
export type UniversalNursingBodyField = (typeof UNIVERSAL_NURSING_BODY_FIELDS)[number];

/** SBAR 4칸(본문 칸의 부분집합) — 화면 폼과 한 벌 */
export const UNIVERSAL_NURSING_SBAR_FIELDS = ['situation', 'background', 'assessment', 'recommendation'] as const;

export function isUniversalNursingContext(v: unknown): v is UniversalNursingContextType {
  return typeof v === 'string' && (UNIVERSAL_NURSING_CONTEXT_TYPES as readonly string[]).includes(v);
}

/** 🔴 재원(입원) 컨텍스트인가 — 참이면 universal 이 아니라 `NursingNote` 정본으로 가야 한다 */
export function isAdmissionScopedNursingContext(v: unknown): v is AdmissionScopedNursingContextType {
  return typeof v === 'string' && (ADMISSION_SCOPED_NURSING_CONTEXT_TYPES as readonly string[]).includes(v);
}

/** 본문이 하나라도 있는가 — 공백만 채운 것은 본문이 아니다 */
export function hasUniversalNursingBody(note: Partial<Record<UniversalNursingBodyField, unknown>>): boolean {
  return UNIVERSAL_NURSING_BODY_FIELDS.some((f) => typeof note[f] === 'string' && (note[f] as string).trim().length > 0);
}

/** 경계 위반 시 화면·API 가 같은 문장을 말하게 하는 안내문 */
export const ADMISSION_SCOPED_NURSING_HINT =
  '재원(입원) 환자의 간호기록은 입원 간호기록 정본(POST /api/v1/admissions/:admissionId/nursing-notes)으로 작성해야 합니다. '
  + '범용 간호기록으로 저장하면 서명·QA·미비기록·사본발급에서 누락됩니다.';

/**
 * 입원 간호기록(NursingNote) 본문을 **기록 형식대로** 칸으로 펼친다 — 2026-10-07 간호차트 검토.
 * 🔴 차트 '간호기록' 탭은 DAR 칸(D·A·R)만 그려 **SOAP 기록은 본문이 비고**(간호 스테이션 작성기의 기본 형식),
 *    DARE 의 E 는 어디에도 안 나오고, SBAR 은 B·A·R 이 D·A·R 라벨로 나왔다. 간호 스테이션 상세는 없는 `situation` 칸을 읽어 '-'.
 * 칸 배치는 서버 저장 규약 그대로(SBAR: focus=S · data=B · action=A · response=R).
 * 형식 밖 칸에 값이 있으면 버리지 않고 뒤에 붙인다(어휘 밖 저장값 보존).
 */
export type NursingNoteBody = {
  noteType?: string | null;
  focus?: string | null; data?: string | null; action?: string | null; response?: string | null;
  content?: string | null; subjective?: string | null; objective?: string | null; assessment?: string | null; plan?: string | null;
  education?: string | null;
};
const NOTE_LAYOUT: Record<string, [keyof NursingNoteBody, string][]> = {
  SOAP: [['subjective', 'S'], ['objective', 'O'], ['assessment', 'A'], ['plan', 'P']],
  DAR: [['focus', 'F'], ['data', 'D'], ['action', 'A'], ['response', 'R']],
  FOCUS: [['focus', 'F'], ['data', 'D'], ['action', 'A'], ['response', 'R']],
  DARE: [['focus', 'F'], ['data', 'D'], ['action', 'A'], ['response', 'R'], ['education', 'E']],
  SBAR: [['focus', 'S'], ['data', 'B'], ['action', 'A'], ['response', 'R']],
  NARRATIVE: [['content', '']],
};
const ALL_BODY: [keyof NursingNoteBody, string][] = [
  ['subjective', 'S'], ['objective', 'O'], ['assessment', 'A'], ['plan', 'P'], ['focus', 'F'], ['data', 'D'], ['action', 'A'], ['response', 'R'], ['education', 'E'], ['content', ''],
];
export function nursingNoteSections(n: NursingNoteBody): { label: string; text: string }[] {
  const layout = NOTE_LAYOUT[n.noteType ?? ''] ?? [];
  const used = new Set(layout.map(([k]) => k));
  const pick = ([k, label]: [keyof NursingNoteBody, string]) => {
    const v = n[k];
    return typeof v === 'string' && v.trim() ? { label, text: v.trim() } : null;
  };
  const main = layout.map(pick).filter((x): x is { label: string; text: string } => !!x);
  const rest = ALL_BODY.filter(([k]) => !used.has(k)).map(pick).filter((x): x is { label: string; text: string } => !!x);
  return [...main, ...rest];
}
