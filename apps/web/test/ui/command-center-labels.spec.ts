import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boardView, NON_FIELD_KEYS } from '../../src/app/(main)/command-center/command-center-view';

/**
 * 통합 상황판 지표 라벨 계약 — 2026-08-11 신설 · 2026-09-02 재작성.
 *
 * 🔴 서버가 새 지표를 추가해도 화면에서 사라지지 않게 폴백이 있는데, 그 폴백이 **영문 키를 그대로
 *    라벨로** 쓴다. 그래서 한글 상황판에 `occupied`·`qiJudged` 같은 것이 섞여 노출된다.
 *
 * 🔴 **이 가드가 다른 이유로 통과하고 있었다**(2026-09-02 운영 실측).
 *    키 목록이 2026-08-11 에 **손으로 베낀 스냅샷**이라, 그 뒤 서버가 늘린 지표를 모른 채 초록이었다.
 *    그동안 운영 화면에는 `cleaning`·`verifyWaitExternal`·`criticalUnalerted`·`criticalFlagTotal`·
 *    `incidentsOpen30d`·`handHygieneObserved`·`handHygienePerformed`·`qiJudged`·`qiStaleMonths`
 *    **10개**가 영문 그대로 떠 있었다.
 *
 * 그래서 키 목록을 **API 정본 소스에서 뽑는다**(수기 스냅샷 금지).
 * 추출이 깨지면 조용히 0개를 통과시키지 않도록 섹션별 **최소 키 수**를 함께 못박는다.
 */

const API = resolve(__dirname, '../../../api/src/modules');

/** 섹션 → [소스 파일, 그 summary 블록을 특정하는 앵커 키, 오늘 실측 키 수(하한)] */
const SECTION_SOURCE: Record<string, [string, string, number]> = {
  nursing: ['nursing/nursing.service.ts', 'handoffPending', 6],
  emergency: ['emergency/emergency.service.ts', 'reassessOverdue', 5],
  bed: ['bed/bed-board.service.ts', 'totalBeds', 10],
  pharmacy: ['pharmacy/pharmacy-board.service.ts', 'verifyWaitExternal', 5],
  receptionBilling: ['billing/reception-billing-board.service.ts', 'eligUnchecked', 6],
  diagnostics: ['lab/diagnostics-board.service.ts', 'criticalFlagTotal', 9],
  safetyQuality: ['qi/safety-quality-board.service.ts', 'qiJudged', 11],
};

/** `summary: {` / `const summary = {` 블록을 중괄호 균형으로 잘라 **최상위** 키만 뽑는다 */
function summaryKeys(file: string, anchor: string): string[] {
  const src = readFileSync(resolve(API, file), 'utf-8');
  const starts = [...src.matchAll(/(?:summary: |const summary = )\{/g)].map((m) => m.index! + m[0].length - 1);
  for (const start of starts) {
    let depth = 0, end = start;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const body = src.slice(start + 1, end);
    const flat = body
      .replace(/\/\/[^\n]*/g, '')            // 줄 주석 — 주석 속 식별자를 키로 세지 않는다
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{[^{}]*\}/g, '_').replace(/\{[^{}]*\}/g, '_').replace(/\[[^[\]]*\]/g, '_');
    // 축약 표기(`handoffPending,`)와 `key: value` 를 모두 센다 — 축약을 놓치면 앵커가 안 잡힌다
    const keys = flat.split(',')
      .map((frag) => frag.trim())
      .map((frag) => /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(frag)?.[1])
      .filter((k): k is string => Boolean(k));
    if (keys.includes(anchor)) return [...new Set(keys)];
  }
  throw new Error(`${file} 에서 앵커 '${anchor}' 를 가진 summary 블록을 찾지 못했습니다 — 추출이 깨졌습니다`);
}

describe('통합 상황판 — 지표 라벨 등재', () => {
  it('🔴 추출 자체가 살아 있다 — 섹션마다 최소 키 수를 넘는다(0개 통과 금지)', () => {
    for (const [section, [file, anchor, min]] of Object.entries(SECTION_SOURCE)) {
      const keys = summaryKeys(file, anchor);
      expect(keys.length, `${section}: 추출 키 ${keys.length}개(<${min}) — 정규식이 깨졌거나 정본이 바뀌었습니다`).toBeGreaterThanOrEqual(min);
    }
  });

  it('🔴 서버가 주는 모든 지표에 한글 라벨이 있다(영문 키 노출 금지)', () => {
    const leaked: string[] = [];
    for (const [section, [file, anchor]] of Object.entries(SECTION_SOURCE)) {
      // 값 1 로 채우면 숫자 키 판정을 타므로 폴백 경로가 그대로 재현된다
      const summary = Object.fromEntries(summaryKeys(file, anchor).map((k) => [k, 1]));
      const declared = NON_FIELD_KEYS[section] ?? {};
      for (const f of boardView(section, summary).fields) {
        // 숫자가 아니라 화면이 버리는 키는 NON_FIELD_KEYS 에 **사유와 함께** 선언돼야 한다
        if (f.unregistered && !declared[f.key]) leaked.push(`${section}.${f.key}`);
      }
    }
    expect(leaked, `한글 라벨 미등재(영문 키가 화면에 노출됨):\n  ${leaked.join('\n  ')}`).toEqual([]);
  });

  it('라벨에 영문 식별자가 그대로 들어가지 않는다', () => {
    for (const [section, [file, anchor]] of Object.entries(SECTION_SOURCE)) {
      const summary = Object.fromEntries(summaryKeys(file, anchor).map((k) => [k, 1]));
      const declared = NON_FIELD_KEYS[section] ?? {};
      for (const f of boardView(section, summary).fields) {
        if (declared[f.key]) continue;
        expect(/^[a-z][a-zA-Z]+$/.test(f.label), `${section}.${f.key} 라벨="${f.label}"`).toBe(false);
      }
    }
  });

  it('🔴 비표시 선언은 사유를 갖고, 실재하는 키만 가리킨다(죽은 선언 금지)', () => {
    for (const [section, decl] of Object.entries(NON_FIELD_KEYS)) {
      const [file, anchor] = SECTION_SOURCE[section];
      const keys = new Set(summaryKeys(file, anchor));
      for (const [k, why] of Object.entries(decl)) {
        expect(keys.has(k), `${section}.${k} 는 서버가 더 이상 주지 않습니다 — 죽은 선언`).toBe(true);
        expect(why.length, `${section}.${k} 비표시 사유가 비어 있습니다`).toBeGreaterThan(5);
      }
    }
  });

  it('폴백은 살아 있다 — 정의에 없는 신규 지표도 화면에서 사라지지 않는다', () => {
    const view = boardView('bed', { totalBeds: 10, brandNewMetric: 7 });
    const f = view.fields.find((x) => x.key === 'brandNewMetric');
    expect(f, '새 지표가 사라지면 안 된다').toBeTruthy();
    expect(f!.unregistered).toBe(true);
    expect(f!.label).toContain('⚠'); // 미등록임을 눈에 보이게
  });

  /**
   * 🔴 **감시 결과는 상황판에 붙이지 않는다** — 2026-09-03 사람 결정(기획 §7-b).
   *
   *    상황판은 임상 직군이 보는 화면이고, 감시 소음이 임상 경보와 같은 자리에 뜨면
   *    **진짜 경보가 묻힌다**(P4 에서 알림 대상을 관리자로 좁힌 것과 같은 이유).
   *    상황판이 답하는 질문("지금 병원이 어떤 상태인가")과 감시자가 답하는 질문
   *    ("지금 보고 있는 숫자를 믿어도 되는가")은 다르고, **행동 주체도 다르다.**
   *
   *    붙이는 것이 편해 보이는 순간이 오므로 여기서 동결한다.
   *    뒤집으려면 이 가드를 함께 고쳐야 하고, 그때 기획 §7-b 를 다시 읽게 된다.
   */
  it('🔴 상황판이 감시자·데이터품질을 끌어오지 않는다(관리자 화면 전용 결정)', () => {
    const page = readFileSync(resolve(__dirname, '../../src/app/(main)/command-center/page.tsx'), 'utf-8');
    const view = readFileSync(resolve(__dirname, '../../src/app/(main)/command-center/command-center-view.ts'), 'utf-8');
    const code = [page, view].map((c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n');
    for (const ep of ['/admin/sentinel', '/api/v1/admin/sentinel', '/api/v1/data-quality']) {
      expect(code, `상황판이 ${ep} 를 부르고 있습니다 — 감시 결과는 관리자 화면 전용입니다(기획 §7-b)`)
        .not.toContain(ep);
    }
    // 대조군 — 상황판이 실제로 무언가를 부르고 있는지(검사가 헛돌지 않게)
    expect(code, '상황판이 아무 EP 도 부르지 않습니다 — 검사가 헛돕니다').toContain('/api/v1/command-center/summary');
  });
});