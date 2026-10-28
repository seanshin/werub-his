/**
 * 의료질관리 흐름 P0 화면(2026-10-08).
 *  · /safety 상태 버튼은 shared 전이표에서 · 사유가 필요한 전이는 브라우저 prompt 가 아니라 화면 입력 · KOPS 미구축 표식
 *  · /quality 원장 대조는 센 기간을 말한다(전 기간 건수를 월 측정 옆에 붙이지 않는다)
 *  · 만족도 NPS null 은 "산출 불가"(0 아님) · 위젯 평균에 null 부서를 0 으로 넣지 않는다
 *  · /admin/qi 재입원 목표가 원장에 없으면 "미등록"
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { satisfactionSummary } from '@/lib/widget-summaries';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

describe('사고 상태 화면', () => {
  it('🔴 전이표·사유 입력·KOPS 표식', () => {
    const s = src('app/(main)/safety/page.tsx');
    expect(s).toContain('INCIDENT_STATUS_TRANSITIONS[selected.status].map');
    expect(s).toContain('incidentTransitionNeedsReason(');
    expect(s).not.toMatch(/prompt\('조치 내역/);
    expect(s).toContain('data-kops-status="LOCAL_RECORDED"');
    expect(s).not.toMatch(/REPORTED: '보고됨', INVESTIGATING: '조사중'/); // 로컬 라벨표 회수
  });
});

describe('원장 대조·NPS·재입원 목표', () => {
  it('🔴 원장 대조는 기간을 말한다', () => {
    const s = src('app/(main)/quality/page.tsx');
    expect(s).toContain('data-ledger-period');
    expect(s).not.toContain('건(전 기간)과 대조해 보십시오');
  });
  it('🔴 NPS null 부서를 0 으로 평균에 넣지 않는다', () => {
    const r = satisfactionSummary([{ department: 'A', nps: null, responseCount: 10 }, { department: 'B', nps: 50, responseCount: 10 }]);
    expect(r.avgNps).toBe(50);
    expect(r.worstNps).toBe(50);
    expect(satisfactionSummary([{ department: 'A', nps: null, responseCount: 3 }]).avgNps).toBeNull();
    expect(src('app/(main)/satisfaction/page.tsx')).toContain('data-nps-unavailable');
  });
  it('재입원 목표 미등록을 말한다', () => {
    expect(src('app/(main)/admin/qi/page.tsx')).toContain('질 지표 원장에 미등록');
  });
});
