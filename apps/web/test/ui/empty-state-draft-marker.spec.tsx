import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { EmptyState, Ratio } from '../../src/components/ui/display';

/**
 * 🔴 AI 초안 표식이 빈 상태 부품에서 **살아 있는가** — 2026-09-12 (AI기본법 §31 병기 · 카탈로그는 전량 AI 초안).
 *
 * 호출부 285곳이 `title={tAttr('…')}` 로 **미리 번역한 문자열**을 넘기고 있었다. 부품은 그것을 다시 키로 조회하는데
 * 번역문(한글 없음)은 조회 대상이 아니라 그대로 찍혔고, 그 순간 `data-i18n-draft` + "AI 초안 번역" 툴팁이 사라졌다.
 * 왜 그렇게 썼나 — 스캐너가 `tAttr(` 호출 수로 배선을 세서, 키를 그대로 넘기면 "미배선"으로 계측됐기 때문이다(계측 모델 교정: `a38f5fa0`).
 *
 * 지키는 것: ① 키를 그대로 넘기면 en 에서 초안 표식이 붙는다 ② 🔴 미리 번역해 넘기면 표식이 없다(대조군 — 이 사실이 회수의 근거다)
 *            ③ app/** 에 `EmptyState`/`Ratio` 의 문자열 prop 을 번역 함수로 감싼 자리가 없다(0 동결 · 태그를 중괄호 깊이로 자른다).
 */
const KEY = '대상 환자가 없습니다.'; // 카탈로그에 있고(AI 초안) 검수되지 않은 키

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('빈 상태 부품 — AI 초안 표식', () => {
  it('① en — 키를 그대로 넘기면 번역되고 초안 표식이 붙는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<EmptyState title={KEY} />);
    expect(container.textContent).not.toMatch(/[가-힣]/);
    expect(container.querySelector('[data-i18n-draft]'), '초안 표식이 없다 — 검수 전 번역이 검수된 것처럼 보인다').not.toBeNull();
    expect(container.querySelector('[data-i18n-draft]')?.getAttribute('title')).toMatch(/초안/);
  });

  it('② 🔴 대조군 — 미리 번역한 문자열을 넘기면 표식이 사라진다(285곳이 이 상태였다)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<EmptyState title="No eligible patients." />);
    expect(container.querySelector('[data-i18n-draft]')).toBeNull();
  });

  it('① Ratio 의 unavailableHint 도 같다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<Ratio numerator={null} denominator={0} unavailableHint="관측 0건" />);
    expect(container.querySelector('[data-i18n-draft]')).not.toBeNull();
  });

  it('③ 🔴 app/** — EmptyState/Ratio 의 문자열 prop 을 번역 함수로 감싼 자리 0 동결', () => {
    const ROOT = path.resolve(__dirname, '../../src/app');
    const files: string[] = [];
    (function walk(d: string) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.tsx')) files.push(p); } })(ROOT);
    const bad: string[] = [];
    let tags = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/<(?:EmptyState|Ratio)\b/g)) {
        tags++;
        let j = m.index! + 1, depth = 0, q: string | null = null, end = -1;
        while (j < src.length) { const c = src[j]; if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; } else if (c === '"' || c === "'" || c === '`') q = c; else if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) { end = j; break; } j++; }
        if (end < 0) continue;
        const tag = src.slice(m.index!, end + 1);
        for (const pm of tag.matchAll(/\b(title|hint|unavailableHint|description|actionLabel)=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
          if (/\b(?:tAttr|tt|tA|portalTAttr|tfAttr)\s*\(/.test(pm[2])) bad.push(`${path.relative(ROOT, f)}  ${pm[1]}={${pm[2].replace(/\s+/g, ' ').slice(0, 80)}}`);
        }
      }
    }
    expect(tags, '대조군 — 태그를 하나도 못 찾았다').toBeGreaterThan(300);
    expect(bad, `번역 함수로 감싸 초안 표식을 지우는 자리 ${bad.length}건 — 키를 그대로 넘기세요(부품이 조회한다):\n${bad.join('\n')}`).toEqual([]);
  });
});
