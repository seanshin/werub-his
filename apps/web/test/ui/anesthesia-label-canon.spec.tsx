import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { ANESTHESIA_LABEL, anesthesiaText } from '@hospital-run/shared';

/**
 * 🔴 마취 종류 표기 — **정본은 shared `ANESTHESIA_LABEL` 하나다** (2026-09-12).
 *
 * `surgery/components/SurgeryAdvanced.tsx` 에 로컬 사본 `ANESTHESIA_TYPES` 가 있었고 **값이 정본과 갈라져** 있었다:
 * `SEDATION` 진정마취(정본 수면마취) · `REGIONAL` 부위마취(정본 부분마취) · `NONE`/`OTHER` 누락.
 * 같은 수술의 마취 종류가 수술 목록(정본 경유)과 이 화면에서 **다른 이름**으로 읽혔다(P12).
 * 또 DB 에 영문 코드와 한글이 섞여 저장돼 있어(`GENERAL` 1 / `전신마취` 5 — 정본 머리 주석 실측) 로컬 맵은 한글 저장분을 못 받았다.
 *
 * 지키는 것: ① 정본이 코드·한글 둘 다 받는다(대조군) ② app/** 에 마취 종류 **라벨 맵**을 새로 두지 않는다(0 동결)
 *            ③ SurgeryAdvanced 가 정본을 지난다.
 * 🔴 `PlasticEncounterLayout` 의 `ANESTHESIA_TYPES` **배열**은 입력 선택지(저장값)라 제외한다 — 라벨 맵이 아니고,
 *    바꾸면 저장값이 바뀐다(저장값 통일은 마이그레이션 과제 · 정본 머리 주석).
 */
const ROOT = path.resolve(__dirname, '../../src/app');
function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p); }
  return out;
}

describe('마취 종류 표기 정본', () => {
  it('① 대조군 — 정본은 영문 코드와 한글 저장값을 같은 한글로 답한다', () => {
    expect(anesthesiaText('SEDATION')).toBe('수면마취');
    expect(anesthesiaText('수면마취')).toBe('수면마취');
    expect(anesthesiaText('general')).toBe('전신마취');
    expect(anesthesiaText('자유기재')).toBe('자유기재'); // 모르는 값은 뭉개지 않는다
    expect(Object.keys(ANESTHESIA_LABEL).length).toBeGreaterThanOrEqual(8);
  });

  it('② 🔴 app/** 에 마취 종류 라벨 맵(`GENERAL: \'…마취\'`)을 새로 두지 않는다(0 동결)', () => {
    const bad: string[] = [];
    for (const f of walk(ROOT)) {
      const src = fs.readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\bGENERAL\s*:\s*'[^']*마취'/.test(src) || /\bSEDATION\s*:\s*'[^']*마취'/.test(src)) bad.push(path.relative(ROOT, f));
    }
    expect(bad, `정본(\`ANESTHESIA_LABEL\`)과 갈라질 로컬 마취 라벨 맵:\n${bad.join('\n')}`).toEqual([]);
  });

  it('③ SurgeryAdvanced 는 정본을 지난다', () => {
    const src = fs.readFileSync(path.join(ROOT, '(main)/surgery/components/SurgeryAdvanced.tsx'), 'utf-8');
    expect(src).toMatch(/import \{[^}]*\banesthesiaText\b[^}]*\} from '@hospital-run\/shared'/);
    expect(src).toMatch(/<AnesthesiaName value=\{s\.anesthesiaType\} \/>/);
    expect(src).toMatch(/<AnesthesiaName value=\{anesthesia\.anesthesiaType\} \/>/);
  });
});
