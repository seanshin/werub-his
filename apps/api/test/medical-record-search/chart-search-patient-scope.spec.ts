/**
 * 차트 내 검색(patient-chart-refinement C4) — 기존 의무기록 전문검색 정본에 환자 범위를 얹었다.
 * 지키는 것:
 *  ① patientId 를 주면 UNION 의 **모든 갈래**에 같은 환자 조건이 걸린다(한 갈래라도 빠지면 다른 환자 기록이 섞인다)
 *  ② 진단·처방·검사 갈래는 환자 지정 시에만 연다(대조군 — 전 환자 전문검색의 결과 구성 불변)
 *  ③ 자르면 잘랐다고 말한다(truncated)
 *  ④ 형식이 틀린 patientId 는 400 — 조건 없이 흘러가 전 환자 검색이 되지 않게
 *  ⑤ 환자 지정 검색은 환자 지목 열람 감사 대상이다(경로 패턴 + query.patientId 귀속)
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalRecordSearchService, PATIENT_SCOPED_TYPES } from '../../src/modules/medical-record-search/medical-record-search.service';
import { MedicalRecordSearchController } from '../../src/modules/medical-record-search/medical-record-search.controller';
import { PHI_READ_PATTERNS, patientIdFromQuery } from '../../src/modules/audit/audit-routes';

const PID = '11111111-2222-4333-8444-555555555555';

function branches(sql: string): string[] {
  const inner = sql.slice(sql.indexOf('FROM (') + 6, sql.lastIndexOf(') sub'));
  return inner.split(' UNION ALL ');
}

describe('차트 내 검색 — 환자 범위', () => {
  let prisma: { $queryRawUnsafe: ReturnType<typeof vi.fn> };
  let service: MedicalRecordSearchService;

  beforeEach(() => {
    prisma = { $queryRawUnsafe: vi.fn() };
    prisma.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT COUNT') ? [{ total: BigInt(0) }] : []),
    );
    service = new MedicalRecordSearchService(prisma as any, { get: vi.fn().mockResolvedValue(null), setex: vi.fn() } as any);
  });

  it('① 모든 갈래에 환자 조건이 걸리고, 그 파라미터 값이 요청한 환자다', async () => {
    await service.search('아스피린', { patientId: PID });
    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
    const parts = branches(sql as string);
    expect(parts).toHaveLength(7); // 기록 4 + 진단·처방·검사 3
    for (const part of parts) {
      const m = /AND \w+\.patient_id = \$(\d+)::uuid/.exec(part);
      expect(m, `환자 조건 없는 갈래:\n${part.slice(0, 160)}`).not.toBeNull();
      expect(params[Number(m![1]) - 1]).toBe(PID);
    }
    for (const t of PATIENT_SCOPED_TYPES) expect(sql).toContain(`'${t}' as type`);
  });

  it('② 대조군 — 환자를 지정하지 않으면 진단·처방·검사 갈래를 열지 않고 환자 조건도 없다', async () => {
    await service.search('아스피린', {});
    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(branches(sql as string)).toHaveLength(4);
    for (const t of PATIENT_SCOPED_TYPES) expect(sql).not.toContain(`'${t}' as type`);
    expect(sql).not.toMatch(/patient_id = \$\d+::uuid/);
  });

  it('② type 을 주면 그 갈래만(환자 지정 시 진단만)', async () => {
    await service.search('고혈압', { patientId: PID, type: 'diagnosis' });
    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(branches(sql as string)).toHaveLength(1);
    expect(sql).toContain("'diagnosis' as type");
  });

  it('③ total 이 돌려준 범위를 넘으면 truncated=true · 넘지 않으면 false', async () => {
    const row = { id: 'a', type: 'prescription', headline: '아스피린 100mg', patient_name: '김', doctor_name: '이', recorded_at: '2026-09-01', status: 'ACTIVE' };
    prisma.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT COUNT') ? [{ total: BigInt(35) }] : [row]),
    );
    const r = await service.search('아스피린', { patientId: PID, limit: 1 });
    expect(r.truncated).toBe(true);
    expect(r.results[0].status).toBe('ACTIVE');

    prisma.$queryRawUnsafe.mockImplementation((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT COUNT') ? [{ total: BigInt(1) }] : [row]),
    );
    const r2 = await service.search('아스피린x', { patientId: PID, limit: 30 });
    expect(r2.truncated).toBe(false);
  });

  it('④ 형식이 틀린 patientId 는 400 이고 검색을 부르지 않는다', async () => {
    const svc = { search: vi.fn() };
    const ctrl = new MedicalRecordSearchController(svc as any);
    await expect(ctrl.search('아스피린', undefined, undefined, undefined, undefined, undefined, undefined, 'not-a-uuid'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(svc.search).not.toHaveBeenCalled();
    svc.search.mockResolvedValue({ results: [], total: 0 });
    await ctrl.search('아스피린', undefined, undefined, undefined, undefined, undefined, undefined, PID);
    expect(svc.search.mock.calls[0][1].patientId).toBe(PID);
  });

  it('⑤ 환자 지정 검색 경로는 PHI 열람 감사 패턴에 걸리고 환자에게 귀속된다', () => {
    expect(PHI_READ_PATTERNS.some((re) => re.test('/api/v1/medical-records/search'))).toBe(true);
    expect(patientIdFromQuery({ patientId: PID })).toBe(PID);
  });
});
