'use client';

import type { ReactNode } from 'react';

/**
 * AI 응답 글의 최소 마크다운 — 제목(#)·목록(- * 1.)·굵게(**)·코드(`)만.
 * 🔴 종전엔 `whitespace-pre-wrap` 평문이라 `**`·백틱이 글자 그대로 보였다.
 * 🔴 HTML 로 해석하지 않는다(dangerouslySetInnerHTML 없음) — 상류 글이 마크업을 넣어도 글자로만 보인다.
 */
export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    out.push(tok.startsWith('**')
      ? <strong key={i++} className="font-semibold">{tok.slice(2, -2)}</strong>
      : <code key={i++} className="rounded bg-gray-100 px-1 font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inlineMd(it)}</li>);
    blocks.push(list.ordered
      ? <ol key={`l${blocks.length}`} className="ml-5 list-decimal space-y-0.5">{items}</ol>
      : <ul key={`l${blocks.length}`} className="ml-5 list-disc space-y-0.5">{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={`h${blocks.length}`} className="mt-1 font-semibold text-gray-900">{inlineMd(h[2])}</p>);
    } else {
      blocks.push(<p key={`p${blocks.length}`}>{inlineMd(line)}</p>);
    }
  }
  flush();
  return <div className={`space-y-1.5 break-words leading-relaxed ${className}`} data-rich-text>{blocks}</div>;
}
