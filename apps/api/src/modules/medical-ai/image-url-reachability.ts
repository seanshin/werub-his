/**
 * 외부 AI 서버(WeRU.B)가 **스스로 가져갈 수 있는 URL 인가** 판정.
 *
 * 🔴 왜 필요한가(2026-08-18 실측): `POST /api/v1/ai/vision/analyze` 는 `image_url` 을 그대로 넘기고
 *    WeRU.B 가 그 주소를 fetch 한다. 판독 워크스테이션은 여기에 **상대경로**
 *    `/api/v1/pacs/wado?studyUID=...` 를 넘기고 있었다. 결과는 둘 중 하나였다 —
 *      · 스킴·호스트가 없어 AI 서버가 해석조차 못 함
 *      · (절대경로로 고쳐도) 그 경로는 HIS JWT + PACS_STUDY_VIEW 를 요구 → 401/HTML
 *    그리고 그 응답이 "판독 소견"으로 화면에 렌더됐다. **보지 않은 영상의 소견**이다.
 *
 * 그래서 여기서 막는다. 애매하면 막지 않는다(거짓 경보는 진짜 경보를 죽인다) — 확실한 두 가지만 본다.
 *   ① 절대 http(s) URL 이 아니다(상대경로·다른 스킴)
 *   ② HIS 인증을 요구하는 자체 API 경로다(`/api/v1/...`, `/fhir/R4/...`)
 *
 * @returns 막아야 할 사유 문장, 보낼 수 있으면 `null`
 */
export function unfetchableByExternalAi(imageUrl: string): string | null {
  const raw = (imageUrl ?? '').trim();
  if (!raw) return '영상 URL 이 비어 있습니다.';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '상대경로는 외부에서 해석할 수 없습니다(스킴·호스트 없음).';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `외부에서 가져올 수 없는 스킴입니다(${parsed.protocol}).`;
  }
  // HIS 자체 API 경로 — 인증이 걸려 있어 외부 주체는 401 을 받는다.
  if (/^\/(api\/v1|fhir\/R4)\//i.test(parsed.pathname)) {
    return 'HIS 인증이 필요한 내부 API 경로입니다(외부 주체는 401 을 받습니다).';
  }
  return null;
}
