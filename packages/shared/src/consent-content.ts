/**
 * 동의서 본문 — 사람이 읽는 모양 정본(2026-10-12).
 *
 * 🔴 서명 화면(환자가 보는 것)과 서명 대상 문서(서버가 동결해 해시하는 것)가 **같은 함수**로 본문을 만든다.
 *    종전 서버 HTML 은 `content` JSON 을 그대로 덤프했다 — 환자가 본 본문과 서명 대상이 달랐다.
 *  · 순서: 본문 절(sections[].title/body) 또는 단일 본문(body·text) → 위험·합병증 → 대체 치료법 → 설명 요지
 *  · 🔴 본문이 없으면 지어 채우지 않는다 — 빈 배열 + hasBody=false(호출자가 "본문 없음"을 말하거나 서명을 막는다)
 */
export interface ConsentReadableSection { title: string | null; body: string }

export function consentReadableSections(c: {
  content?: unknown; risks?: string | null; alternatives?: string | null; explanation?: string | null;
}): { sections: ConsentReadableSection[]; hasBody: boolean } {
  const content = c.content && typeof c.content === 'object' ? (c.content as Record<string, unknown>) : null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const out: ConsentReadableSection[] = [];
  const secs = Array.isArray(content?.sections) ? (content!.sections as Array<{ title?: unknown; body?: unknown }>) : [];
  for (const s of secs) {
    const body = str(s?.body);
    if (body) out.push({ title: str(s?.title), body });
  }
  if (!out.length) {
    const single = str(content?.body) ?? str(content?.text) ?? (typeof c.content === 'string' ? str(c.content) : null);
    if (single) out.push({ title: null, body: single });
  }
  const hasBody = out.length > 0;
  if (str(c.risks)) out.push({ title: '위험·합병증', body: c.risks! });
  if (str(c.alternatives)) out.push({ title: '대체 치료법', body: c.alternatives! });
  if (str(c.explanation)) out.push({ title: '설명 요지', body: c.explanation! });
  return { sections: out, hasBody };
}
