import { describe, it, expect, vi } from 'vitest';
import { RecordTimelineService, pendingCriticalIssue } from '../../src/modules/record-timeline/record-timeline.service';

/**
 * 🔴 가드 — **집계 실패가 0 으로 표시되지 않는다**(W8 2026-08-14).
 *
 * 종전: `criticalValueAlert.count(...).catch(() => 0)` — 집계가 실패하면 미확인 위급 검사값
 *       이슈가 **조용히 사라져**, 화면에서 "확인 대기 없음"과 구분되지 않았다.
 *       실패는 허용도 0 도 아니다. 산출 불가로 드러낸다(단, 거짓 위급 경보로 올리지도 않는다).
 */
describe('미확인 위급 검사값 — 집계 실패는 0 이 아니다', () => {
  it('진짜 0 이면 이슈를 만들지 않는다', () => {
    expect(pendingCriticalIssue(0)).toBeNull();
  });

  it('건수가 있으면 CRITICAL 로 올린다', () => {
    const i = pendingCriticalIssue(3)!;
    expect(i.level).toBe('CRITICAL');
    expect(i.value).toBe('3건');
  });

  it('🔴 집계 실패(null)는 사라지지 않고 "산출 불가"로 드러난다', () => {
    const i = pendingCriticalIssue(null)!;
    expect(i).not.toBeNull();
    expect(i.value).toBe('산출 불가');
    expect(i.why).toContain('없다는 뜻이 아닙니다');
    // 거짓 경보는 진짜 경보를 죽인다 — 모르는 것을 위급으로 단정하지 않는다
    expect(i.level).toBe('WARN');
  });

  it('요약 경로: count 가 던져도 이슈 목록에서 위급값 항목이 사라지지 않는다', async () => {
    const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
    const prisma: any = {
      encounter: empty(), admission: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      nursingNote: empty(), universalNursingNote: empty(), labResult: empty(), imagingResult: empty(),
      prescription: empty(), preVisitVitals: empty(), surgery: empty(), progressNote: empty(),
      medicationAdministration: empty(), dischargeSummary: empty(), aiProposal: empty(),
      scribeSession: empty(),
      user: { findMany: vi.fn().mockResolvedValue([]) },
      criticalValueAlert: { count: vi.fn().mockRejectedValue(new Error('relation down')) },
    };
    const svc = new RecordTimelineService(prisma);
    const res = await svc.summarize('p1', {}, 'all', false);
    const pending = res.issues.find((i) => i.label === '위급 검사값');
    expect(pending).toBeDefined();
    expect(pending!.value).toBe('산출 불가');
  });
});
