import { describe, it, expect } from 'vitest';
import { toClinicLine, fromClinicLine, DocTypeRegistry, InternalLineEntry, ClinicLineEntry } from '../../src/modules/ess/approval-registry';

describe('P3 — 결재선 변환·docType 레지스트리', () => {
  const clinicIdOf = new Map([['st-1', 'c-111'], ['st-2', 'c-222']]);
  const staffIdOf = new Map([['c-111', 'st-1'], ['c-222', 'st-2']]);

  it('INTERNAL→CLINIC — order→step 재부여·role 변환·결과 보존', () => {
    const internal: InternalLineEntry[] = [
      { order: 2, staffId: 'st-2', role: 'REFERENCE' },
      { order: 1, staffId: 'st-1', role: 'APPROVE', result: 'APPROVED', actedAt: '2026-07-18T00:00:00Z' },
    ];
    const r = toClinicLine(internal, clinicIdOf);
    expect(r.unmapped).toEqual([]);
    expect(r.line).toEqual([
      { step: 1, userId: 'c-111', type: 'approve', result: 'APPROVED', actedAt: '2026-07-18T00:00:00Z' },
      { step: 2, userId: 'c-222', type: 'reference' },
    ]);
  });

  it('미매핑 staffId는 제외·unmapped 반환(조용한 유실 금지)', () => {
    const r = toClinicLine([{ order: 1, staffId: 'st-x' }, { order: 2, staffId: 'st-1' }], clinicIdOf);
    expect(r.unmapped).toEqual(['st-x']);
    expect(r.line).toHaveLength(1);
    expect(r.line[0].step).toBe(1); // step 재부여(공백 없음)
  });

  it('CLINIC→INTERNAL 역변환 — 왕복 보존', () => {
    const clinic: ClinicLineEntry[] = [
      { step: 1, userId: 'c-111', type: 'approve', result: 'APPROVED' },
      { step: 2, userId: 'c-222', type: 'reference' },
    ];
    const back = fromClinicLine(clinic, staffIdOf);
    expect(back.unmapped).toEqual([]);
    expect(back.line[0]).toMatchObject({ order: 1, staffId: 'st-1', role: 'APPROVE', result: 'APPROVED' });
    expect(back.line[1]).toMatchObject({ order: 2, staffId: 'st-2', role: 'REFERENCE' });
    // 재왕복
    const again = toClinicLine(back.line, clinicIdOf);
    expect(again.line.map((e) => e.userId)).toEqual(['c-111', 'c-222']);
  });

  it('레지스트리 — 등록·조회·docTypes 열거', async () => {
    const r = new DocTypeRegistry();
    const calls: string[] = [];
    r.register({
      docType: 'HR_TEST', refModule: 'hr.tests', updatesRelay: false,
      onDecision: async (refId, decision) => { calls.push(`${refId}:${decision}`); },
      resolveDrafter: async () => 'u-1',
    });
    expect(r.has('HR_TEST')).toBe(true);
    expect(r.has('HR_UNKNOWN')).toBe(false);
    expect(r.docTypes()).toEqual(['HR_TEST']);
    await r.get('HR_TEST')!.onDecision('ref-1', 'APPROVED');
    expect(calls).toEqual(['ref-1:APPROVED']);
    expect(await r.get('HR_TEST')!.resolveDrafter('ref-1')).toBe('u-1');
  });
});
