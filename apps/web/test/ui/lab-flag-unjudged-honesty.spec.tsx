import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isJudgedFlag, isAbnormalFlag, isCriticalFlag, LAB_FLAG_UNJUDGED_TEXT, LAB_FLAG_UNJUDGED_HINT } from '@hospital-run/shared';
import { t } from '@hospital-run/shared';

/**
 * 🔴 "판정하지 못했다"를 "정상"처럼 그리지 않는다 — 외부 점검.
 *
 * HIS 기준치 마스터에 그 검사가 없으면 `ReferenceRangeService.flagValue()` 가 `null` 을 돌려준다 —
 * **서버는 옳다**('N' 으로 강제하지 않는 것이 규칙이다). 그런데 화면이 `null` 과 `'N'` 을 똑같이
 * 아무것도 안 그렸다. 검증하는 사람은 정상으로 읽는다. 인쇄 성적서만 '미판정'을 적고 있었고 그 판정도
 * shared 가 아니라 거기서 다시 적은 것이었다.
 *
 * 이 가드가 못박는 것:
 *   ① 판정 여부 정본이 shared 하나다(`isJudgedFlag`) — 소비처가 로컬로 다시 적지 않는다
 *   ② 검사 결과를 그리는 세 화면(검증 워크리스트·기록 타임라인·성적서)이 미판정을 **눈에 보이게** 말한다
 *   ③ 대조군 — 정상('N')·이상('H')에는 미판정 표시가 붙지 않는다(거짓 경보는 진짜 경보를 죽인다)
 *   ④ 문구는 i18n 카탈로그를 지난다(등재되지 않은 원문은 다른 언어에서 한국어로 남는다)
 */

const WEB = process.cwd();
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
/**
 * 🔴 **import 문을 지우고 본다.** "심볼이 파일에 있다"를 "그 심볼을 쓴다"로 읽어 가드가 헛돈 적이
 *    이 저장소에 여러 번 있다(v4.11.0 에서만 9건). 본문의 **호출**만 본다.
 */
const stripImports = (s: string) => s.replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
const read = (p: string) => stripImports(stripComments(readFileSync(join(WEB, p), 'utf8')));

const CONSUMERS = {
  verifyTab: join('src', 'app', '(main)', 'lab', 'components', 'VerifyTab.tsx'),
  recordCard: join('src', 'components', 'record-timeline', 'record-card.tsx'),
  labReport: join('src', 'components', 'document', 'forms', 'LabReportDoc.tsx'),
};

describe('① 판정 여부 정본(shared) — 세 상태를 가른다', () => {
  it('null·빈 값은 판정되지 않은 것이다', () => {
    expect(isJudgedFlag(null)).toBe(false);
    expect(isJudgedFlag(undefined)).toBe(false);
    expect(isJudgedFlag('')).toBe(false);
    expect(isJudgedFlag('  ')).toBe(false);
  });
  it('대조군 — 정상(N)도 이상(H·HH)도 **판정된 것**이다(미판정과 섞지 않는다)', () => {
    expect(isJudgedFlag('N')).toBe(true);
    expect(isJudgedFlag('NORMAL')).toBe(true);
    expect(isJudgedFlag('H')).toBe(true);
    expect(isJudgedFlag('HH')).toBe(true);
  });
  it('🔴 미판정은 이상도 위급도 아니다 — 빨강으로 그리면 거짓 경보다', () => {
    expect(isAbnormalFlag(null)).toBe(false);
    expect(isCriticalFlag(null)).toBe(false);
  });
});

describe('② 검사 결과 화면이 미판정을 말한다', () => {
  for (const [name, path] of Object.entries(CONSUMERS)) {
    it(`${name} 이 shared 정본으로 판정 여부를 본다(호출 · 로컬 재도출 없음)`, () => {
      const src = read(path);
      // 🔴 호출을 본다 — 이름이 있는 것과 부르는 것은 다른 일이다
      expect(src).toMatch(/isJudgedFlag\(/);
      // 🔴 로컬 재도출 금지 — `flag !== 'N'` 을 손으로 적으면 'NORMAL' 을 이상으로 세고 미판정을 정상으로 그린다
      expect(/flag\s*!==\s*'N'/.test(src), `${name}: flag 판정을 로컬에서 다시 적고 있다`).toBe(false);
      expect(/flag\s*!=\s*null\s*&&\s*String\(/.test(src), `${name}: 판정 여부를 로컬에서 다시 적고 있다`).toBe(false);
    });
  }

  it('화면·문서가 같은 미판정 문구 정본을 쓴다', () => {
    for (const p of Object.values(CONSUMERS)) {
      expect(read(p), `${p}: 미판정 문구 정본을 쓰지 않는다`).toContain('LAB_FLAG_UNJUDGED_TEXT');
    }
    expect(LAB_FLAG_UNJUDGED_TEXT).toBe('판정 불가');
  });

  it('③ 대조군 — 미판정 표시는 `!isJudgedFlag` 에만 걸린다(정상에 경보를 달지 않는다)', () => {
    for (const path of [CONSUMERS.verifyTab, CONSUMERS.recordCard]) {
      const src = read(path);
      expect(src).toMatch(/!isJudgedFlag\(/);
      // 미판정 배지가 rose(이상 색)로 칠해지지 않는다 — 미판정은 빨강도 초록도 아니다
      const badge = src.match(/!isJudgedFlag\([^)]*\)\s*&&\s*\(\s*<span className="([^"]+)"/);
      expect(badge, `${path}: 미판정 배지를 찾지 못했다`).not.toBeNull();
      expect(badge![1]).not.toMatch(/rose|emerald|green/);
    }
  });

  it('④ 미판정 문구·힌트가 i18n 카탈로그에 등재돼 있다(영어에서 한국어로 남지 않는다)', () => {
    expect(t(LAB_FLAG_UNJUDGED_TEXT, 'en')).not.toBe(LAB_FLAG_UNJUDGED_TEXT);
    expect(t(LAB_FLAG_UNJUDGED_HINT, 'en')).not.toBe(LAB_FLAG_UNJUDGED_HINT);
  });
});
