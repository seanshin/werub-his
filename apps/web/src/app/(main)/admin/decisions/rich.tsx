/**
 * 등록부 문구 렌더 — 결정 화면 전 부품이 같이 쓴다(설명자료·작업대·목록·이력·대장).
 */
/** `**굵게**` 만 해석한다 — 등록부가 강조한 곳을 문서에서도 강조하기 위해서다(임의 HTML 은 넣지 않는다). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')
    ? <b key={i} className="font-bold text-gray-900">{p.slice(2, -2)}</b>
    : <span key={i}>{p}</span>))}</>;
}
