import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🔴 P0-C R7-b — **신뢰도를 화면이 지어내지 않는다**(P15).
 *
 * 원 결함(2026-09-09 실측): 스트리밍 SOAP 경로가 `confidence: 0.7` 을 박아 넣었다. 모델은 신뢰도를 준 적이 없는데
 * 화면은 "모델 자기보고 신뢰도 70%" 라고 말했다. 표시부는 이미 `null` 을 '미보고'로 그릴 줄 알았다 —
 * 지어낸 상수만 그 정직한 경로를 막고 있었다.
 *
 * 가드 방식: 기준선 동결(웹 src 전역 0건). 여유를 두지 않는다 — 여유를 두면 신규 위반을 흡수한다.
 *   · 대상: `confidence` 에 소수 리터럴을 대입/전달하는 자리(`confidence: 0.7` · `confidence={0.7}` · `confidence = 0.7`)
 *   · 주석(`//`, `/* *\/`)은 제외한다(규칙을 설명한 문장이 규칙을 깨뜨리지 않게).
 *   · 서버가 준 값(`d.confidence`)·`null`·`0`(측정된 0 은 다른 사실)은 대상이 아니다.
 *
 * 재주입 역검증(수동 확인함): AiAssistantPanel 스트리밍 경로에 `confidence: 0.7` 을 되살리면 이 스펙이 실패한다.
 */

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');

/** 🔴 `fs.globSync` 는 Node 22+ — CI(Node 20)에서 가드가 조용히 죽는다(2026-09 실측). readdirSync 재귀로 순회한다. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** 주석 제거 — 블록 주석과 줄 주석(문자열 안 `//` 오검출은 이 규칙 범위에서 실익이 없어 무시) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const INVENTED_CONFIDENCE = /confidence\s*(?::|=|=\{)\s*0\.\d/;

describe('AI 신뢰도 — 화면이 지어내지 않는다(기준선 0 동결)', () => {
  const files = walk(SRC_ROOT);

  it('스캔 대상이 비어 있지 않다(가드가 0건을 "통과"로 말하지 않게 하는 대조군)', () => {
    expect(files.length).toBeGreaterThan(100);
    // 실제로 confidence 를 다루는 파일이 존재해야 이 가드가 의미가 있다
    const touching = files.filter((f) => /confidence/i.test(fs.readFileSync(f, 'utf8')));
    expect(touching.length, 'confidence 를 다루는 파일이 0 이면 조준이 빗나간 것이다').toBeGreaterThan(0);
  });

  it('🔴 웹 src 어디에도 `confidence: 0.x` 하드코딩이 없다', () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      src.split('\n').forEach((line, i) => {
        if (INVENTED_CONFIDENCE.test(line)) hits.push(`${path.relative(SRC_ROOT, f)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(hits, `신뢰도 하드코딩 ${hits.length}건:\n${hits.join('\n')}`).toEqual([]);
  });

  it('스트리밍 SOAP 경로는 미보고를 `null` 로 두고, 표시부가 "미보고"라고 말한다', () => {
    const panel = fs.readFileSync(
      path.join(SRC_ROOT, 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'AiAssistantPanel.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/setSoapDraft\(\{ assessment: sections\.assessment, plan: sections\.plan, confidence: null, references: \[\] \}\)/);
    // 표시부가 null 을 0% 가 아니라 '미보고'로 그린다
    expect(panel).toMatch(/soapDraft\.confidence == null \? '미보고'/);
  });
});
