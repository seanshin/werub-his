/**
 * 진료기록 정정 사유(2026-10-03 · 선택 입력).
 *  · 서명된 진료기록을 다시 열었을 때만 "정정합니다" 안내 + 사유 입력(선택 — 강제하면 아무 값이나 넣고 넘어간다)
 *  · 저장·임시저장·서명 세 경로 모두 사유를 싣는다(한 경로만 실으면 그 경로로 정정한 사유가 사라진다)
 *  · 사유가 비어 있으면 보내지 않는다 · 서명본이 아니면(초안·정정 중) 보내지 않는다
 * 재주입: 서명본 판정·세 경로 배선·빈 사유 제외를 되돌리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src/app/(main)/patients/[id]/encounter/new/page.tsx'), 'utf8');

describe('진료기록 정정 사유', () => {
  it('🔴 다시 연 진료가 서명본일 때만 정정으로 본다', () => {
    expect(src).toMatch(/const amendingSigned = !!reEntryEncounterId && reEntryStatus === 'SIGNED';/);
    expect(src).toMatch(/\{amendingSigned && \(\s*<label[^>]*data-amendment-reason>/);
  });

  it('🔴 비어 있으면 보내지 않는다 · 서명본이 아니면 보내지 않는다', () => {
    expect(src).toMatch(/const amendExtra = \(\) => \(amendingSigned && amendmentReason\.trim\(\) \? \{ amendmentReason: amendmentReason\.trim\(\) \} : \{\}\);/);
  });

  it('🔴 저장·임시저장·서명 세 경로 모두 사유를 싣는다', () => {
    const calls = [...src.matchAll(/updateEncounter\.mutateAsync\(\{ id: encounterId, data: ([^\n]+)\}\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls.slice(0, 3)) expect(c).toContain('...amendExtra()');
  });

  it('🔴 구조화 저장도 사유를 싣는다 · 재진입 때 구조화 문진을 불러온다(빈 칸으로 덮지 않게)', () => {
    expect(src).toMatch(/physicalExamination: structured\.physicalExamination,\s*\.\.\.amendExtra\(\),/);
    expect(src).toMatch(/setStructured\(\(prev\) => \(\{\s*chiefComplaint: \(raw\.chiefComplaint as string\) \?\? '',/);
    expect(src).toMatch(/historyPresentIllness: \(raw\.historyPresentIllness as string\) \?\? '',/);
  });
});
