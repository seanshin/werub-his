import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientService } from '../../src/modules/patient/patient.service';

/** 환자 필터 스카우트(2026-07-24) — DTO strip으로 무동작이던 서버 필터 수리 + 외국인 구분 */
describe('PatientService — 필터 buildWhere', () => {
  let svc: any;
  beforeEach(() => { svc = new PatientService({} as any, { getOrThrow: () => '00'.repeat(32) } as any); });

  const where = (q: object) => (svc as any).buildWhere(q);
  const flat = (w: any) => JSON.stringify(w);

  it('보험/상태/태그 — 서버 조건 반영(종전 무동작 수리)', async () => {
    expect(flat(await where({ insuranceType: 'MEDICAID' }))).toContain('MEDICAID');
    expect(flat(await where({ status: 'deceased' }))).toContain('"isDeceased":true');
    expect(flat(await where({ status: 'active' }))).toContain('"isActive":true');
    expect(flat(await where({ status: 'inactive' }))).toContain('"isActive":false');
    const w = await where({ tags: 'VIP, 감염주의' });
    expect(flat(w)).toContain('hasEvery');
    expect(flat(w)).toContain('감염주의');
  });

  it('외국인 구분 — Y=비KR·N=KR/null 포함', async () => {
    const y = flat(await where({ foreigner: 'Y' }));
    expect(y).toContain('notIn');
    expect(y).toContain('KOR');
    const n = flat(await where({ foreigner: 'N' }));
    expect(n).toContain('"nationality":null');
  });

  it('국적/언어 세부 필터', async () => {
    expect(flat(await where({ nationality: 'MNG' }))).toContain('MNG');
    expect(flat(await where({ language: 'en' }))).toContain('preferredLanguage');
  });

  it('품질 드릴다운 — 단순 판정 5종은 where 직접 반영', async () => {
    for (const [q, frag] of [
      ['noPhone', '"phone":null'], ['noInsurance', '"insuranceNumber":null'],
      ['noPhoto', '"photoUrl":null'],
    ] as const) {
      expect(flat(await where({ quality: q }))).toContain(frag);
    }
    const dormant = flat(await where({ quality: 'dormant' }));
    expect(dormant).toContain('encounters');
    expect(dormant).toContain('none');
    const pp = flat(await where({ quality: 'passportExpiring' }));
    expect(pp).toContain('passportExpiry');
  });

  it('품질 드릴다운 — raw 판정 2종은 id 선해석 목록으로', async () => {
    (svc as any).prisma = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) };
    const w = flat(await where({ quality: 'dupSuspect' }));
    expect(w).toContain('"in":["a","b"]');
  });
});
