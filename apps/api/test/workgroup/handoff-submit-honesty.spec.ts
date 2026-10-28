/**
 * 🔴 가드 — 인수인계가 한 건도 저장되지 않아도 '제출 완료'라 답하던 것(2026-08-20 · P16).
 *
 * 원 결함: `submitHandoff` 가 MRN 이 안 풀리는 환자를 조용히 `continue` 로 건너뛰고도
 * **무조건** `{ status:'submitted', submittedAt: new Date().toISOString() }` 을 돌려줬다.
 * 게다가 `handoffId` 는 `ho-<날짜>-<병동>-<근무>` 로 **날조**돼, 이력 조회(`getHandoffHistory`)가
 * 돌려주는 실제 ClinicalHandoff id 와 서로 다른 정본이었다.
 *
 * 이 스펙이 지키는 것:
 *  ① 실제로 저장된 인계가 있을 때만 '제출'이라 말하고 제출 시각을 남긴다
 *  ② 0건이면 시각이 없고(null) 상태가 성공 어휘가 아니며 이유를 밝힌다
 *  ③ 부분 실패는 삼키지 않는다 — 저장된 건수와 미해소 환자를 함께 돌려준다
 *  ④ handoffId 는 날조가 아니라 실제 생성된 레코드 id 다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkgroupService } from '../../src/modules/workgroup/workgroup.service';

describe('🔴 인수인계 제출 — 저장되지 않았으면 제출이라 적지 않는다', () => {
  let service: WorkgroupService;
  let p: any;

  beforeEach(() => {
    p = {
      patient: { findFirst: vi.fn() },
      clinicalHandoff: { create: vi.fn() },
    };
    service = new WorkgroupService(p, {} as never);
  });

  const body = (ids: string[]) => ({
    wardId: 'w-1', shift: 'day', handoffTime: new Date().toISOString(),
    fromNurseId: 'n-1', toNurseId: 'n-2',
    patients: ids.map((id) => ({ patientId: id, notes: '특이사항 없음' })),
  });

  it('① 저장된 인계가 있으면 제출 시각을 남긴다', async () => {
    p.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    p.clinicalHandoff.create.mockResolvedValue({ id: 'ch-1' });
    const r: any = await service.submitHandoff(body(['p-P2026-0001']));
    expect(r.status).toBe('submitted');
    expect(r.submittedAt).toEqual(expect.any(String));
    expect(r.createdCount).toBe(1);
  });

  it('② 한 건도 저장되지 않으면 시각도 성공 어휘도 없다', async () => {
    p.patient.findFirst.mockResolvedValue(null); // MRN 미해소 → create 호출 없음
    const r: any = await service.submitHandoff(body(['p-UNKNOWN-1', 'p-UNKNOWN-2']));
    expect(p.clinicalHandoff.create).not.toHaveBeenCalled();
    expect(r.submittedAt).toBeNull();          // 🔴 재주입 시 여기서 걸린다
    expect(r.status).not.toBe('submitted');
    expect(r.status).toBe('not_recorded');
    expect(r.message).toContain('저장되지 않았');
  });

  it('③ 부분 실패를 삼키지 않는다 — 저장 건수와 미해소 환자를 함께 돌려준다', async () => {
    p.patient.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.mrn.contains === 'P2026-0001' ? { id: 'pat-1' } : null),
    );
    p.clinicalHandoff.create.mockResolvedValue({ id: 'ch-1' });
    const r: any = await service.submitHandoff(body(['p-P2026-0001', 'p-NOPE']));
    expect(r.createdCount).toBe(1);
    expect(r.requestedCount).toBe(2);
    expect(r.unresolvedPatientIds).toEqual(['p-NOPE']);
  });

  it('④ handoffId 는 날조가 아니라 실제 생성된 레코드 id 다', async () => {
    p.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    p.clinicalHandoff.create.mockResolvedValue({ id: 'ch-real-1' });
    const r: any = await service.submitHandoff(body(['p-P2026-0001']));
    expect(r.handoffId).toBe('ch-real-1');
    expect(r.handoffIds).toEqual(['ch-real-1']);
    expect(String(r.handoffId)).not.toMatch(/^ho-\d{8}-/); // 종전 날조 형식
  });
});
