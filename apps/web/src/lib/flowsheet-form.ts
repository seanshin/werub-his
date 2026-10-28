/**
 * 플로시트 입력 폼 → 요청 본문(2026-10-10) — 화면(page.tsx 는 다른 export 를 둘 수 없다)과 테스트가 함께 쓴다.
 */
/** 폼 → 요청 본문 — 측정 시각은 고른 경우에만(로컬 → ISO) · 빈 칸은 보내지 않는다 */
export function toFlowsheetBody(form: Record<string, unknown>): Record<string, unknown> {
  const { recordedAtLocal, ...rest } = form;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== '' && v !== null) body[k] = v;
  const iso = localInputToIso(recordedAtLocal);
  if (iso) body.recordedAt = iso;
  return body;
}
/** `datetime-local` 입력(브라우저 현지 시각) → ISO · 비었거나 잘못되면 undefined(서버가 "측정 시각 미상"으로 기록 — 지어내지 않는다) */
export function localInputToIso(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
export function hasAnyFlowsheetValue(form: Record<string, unknown>): boolean {
  return Object.entries(form).some(([k, v]) => k !== 'recordedAtLocal' && k !== 'notes' && v !== undefined && v !== '' && v !== null);
}

