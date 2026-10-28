import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 표준 매핑 제안 패널이 **조회 실패를 "해당 없음"으로 번역**하고 있었다(2026-08-26).
 *    `catch { result[ts] = [] }` — AI 서버가 죽어도 화면은 "이 코드에는 해당 표준이 없다"고 단정했다.
 *    그리고 진단코드에 LOINC·ICD10PCS 를 "미매핑"으로 세어 **채울 수 없는 갭**을 만들고 있었다.
 */
const PANEL = join(process.cwd(), 'src/app/(main)/admin/codes/auto-mapping-dashboard.tsx');
const DETAIL = join(process.cwd(), 'src/app/(main)/admin/codes/code-detail-panel.tsx');

describe('표준 매핑 제안은 세 상태를 구분한다', () => {
  const panel = readFileSync(PANEL, 'utf8');
  const detail = readFileSync(DETAIL, 'utf8');

  it('🔴 조회 실패를 빈 배열로 접지 않는다', () => {
    expect(panel).not.toMatch(/catch\s*\{\s*result\[ts\] = \[\];/);
    expect(panel).toMatch(/error: \(e as Error\)\?\.message/);
  });

  it('🔴 실패는 실패라고 말한다', () => {
    expect(panel).toContain('제안을 받지 못했습니다');
  });

  it('진짜 후보 없음은 "제안 없음"으로 말한다(해당 없음과 구분)', () => {
    expect(panel).toContain('제안 없음');
  });

  it('대조군 — 후보가 있으면 코드·신뢰도를 그대로 보여준다', () => {
    expect(panel).toContain('c.targetCode');
    expect(panel).toMatch(/confidence \* 100/);
  });

  it('🔴 해당 사항이 아닌 표준을 미매핑으로 세지 않는다', () => {
    expect(detail).toContain('applicableFor');
    expect(detail).toMatch(/applicable\.includes\(s\)/);
  });

  it('진단코드의 해당 표준에 LOINC 이 없다(서버 판정과 같은 기준)', () => {
    const i = detail.indexOf("includes('diagnosis')");
    expect(detail.slice(i, i + 120)).not.toContain('LOINC');
  });
});

/**
 * 🔴 일괄 매핑 화면이 **서버가 하지 않는 일을 약속**하고 있었다(2026-08-26).
 *    "Confidence >= 0.90 자동 확정" — 그러나 대조할 표준 코드 사전이 없어
 *    AI 제안은 자동 확정되지 않는다(규칙 매핑만 확정된다).
 */
describe('일괄 매핑 화면은 실제 동작만 약속한다', () => {
  const panel = readFileSync(PANEL, 'utf8');

  it('🔴 AI 제안이 자동 확정된다고 말하지 않는다', () => {
    expect(panel).toContain('AI 제안은 자동 확정되지 않습니다');
    expect(panel).toContain('규칙 매핑은 신뢰도');
  });

  it('🔴 결과 집계가 상태를 뭉치지 않는다', () => {
    for (const k of ['notApplicableCount', 'noCandidateCount', 'errorCount']) {
      expect(panel, `${k} 를 표시하지 않는다`).toContain(k);
    }
  });

  it('오류만 재시도 대상이라고 말한다', () => {
    expect(panel).toContain('재시도 대상');
  });

  it('대조군 — 확정·대기 칸은 그대로 있다', () => {
    expect(panel).toContain('confirmedCount');
    expect(panel).toContain('pendingCount');
  });
});

/**
 * 🔴 코드 상세가 **이 코드가 어디 쓰이는지** 말한다(2026-08-26 · C1).
 *    중지·개정 전에 실무가 가장 먼저 묻는 값이고, 못 셌으면 "없음"이라 하지 않는다.
 */
describe('코드 상세는 사용처를 말한다', () => {
  const detail = readFileSync(DETAIL, 'utf8');

  it('사용처를 조회한다', () => {
    expect(detail).toMatch(/\/usage`/);
    expect(detail).toContain("queryKey: ['code-usage'");
  });

  it('🔴 전부 세지 못하면 그 사실을 말한다(없음이라 하지 않는다)', () => {
    expect(detail).toContain('전부 확인하지 못했습니다');
    expect(detail).toMatch(/usage\.countedRefs[\s\S]*usage\.totalRefs/);
  });

  it('🔴 조회 실패를 "사용처 없음"으로 번역하지 않는다', () => {
    expect(detail).toContain('사용처를 조회하지 못했습니다');
  });

  it('사용 중이면 건수와 영향을 말한다', () => {
    expect(detail).toContain('중지하면 이 기록들이 영향을 받습니다');
  });

  it('대조군 — 진짜 0건이면 "사용처 없음"이라고 말한다', () => {
    expect(detail).toContain('사용처 없음');
  });
});
