import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RETENTION_RECORD_KINDS, retentionRecordKindsOf } from '@hospital-run/shared';
import { RetentionService } from '../../src/modules/retention/retention.service';

/**
 * 🔴 T10(A1) — 보존 관제가 **모르는 것을 0 으로 말하지 않고, 결정 전 값을 지어내지 않는다** (2026-09-13).
 *
 *  ① 핸들러 없는 정책은 `lastCandidates=null`·`candidates=null` 로 저장·응답한다 — 종전엔 0 을 저장해
 *     정책 목록이 "후보 0건"이라 말했다(운영 5행 전부 0).
 *  ② 임상 기록 3종(MEDICAL_RECORD·PRESCRIPTION·CONSENT_FORM)은 **집계만** 한다 — 파기 핸들러를 갖지 않는다.
 *  ③ 기산점이 결정 대기라 두 기준(작성일·마지막 진료일)을 모두 돌려준다 — 환자 귀속이 없는 기록은 null(해당 없음).
 *  ④ 법정 종류 보유 현황은 기간이 없으므로 **후보 수를 계산하지 않는다**(SQL 에 cutoff 필터가 없다).
 *  ⑤ 🔴 법정 종류 어휘 파일에 보존 기간 숫자가 없다(저장소 규칙 — 법령 수치는 레지스트리·시드에 박지 않는다).
 */

type Row = { total: number; by_created: number | null; oldest_created: Date | null; by_last: number | null; oldest_last: Date | null };

function makeService(opts: { policies: Array<{ id: string; resourceType: string; retentionDays: number; legalMinDays: number; action: string; legalConfirmed: boolean; enabled: boolean }>; raw?: (sql: string, cutoff?: Date) => Row[] }) {
  const updates: Array<{ id: string; lastCandidates: number | null }> = [];
  const sqls: string[] = [];
  const prisma = {
    retentionPolicy: {
      findMany: vi.fn(async () => opts.policies),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { lastCandidates: number | null } }) => {
        updates.push({ id: where.id, lastCandidates: data.lastCandidates });
        return {};
      }),
    },
    auditLog: { count: vi.fn(async () => 7), findFirst: vi.fn(async () => ({ timestamp: new Date('2020-01-01') })) },
    $queryRawUnsafe: vi.fn(async (sql: string, cutoff?: Date) => {
      sqls.push(sql);
      return opts.raw ? opts.raw(sql, cutoff) : [{ total: 10, by_created: 4, oldest_created: new Date('2019-05-01'), by_last: 2, oldest_last: new Date('2021-02-01') }];
    }),
  };
  const svc = new RetentionService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, prisma, updates, sqls };
}

const policy = (resourceType: string) => ({ id: `id-${resourceType}`, resourceType, retentionDays: 3650, legalMinDays: 3650, action: 'REPORT_ONLY', legalConfirmed: false, enabled: true });

describe('보존 관제 — 정직성·두 기산점 (T10 A1)', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => { ctx = makeService({ policies: [policy('MEDICAL_RECORD'), policy('UNKNOWN_KIND'), policy('AUDIT_LOG')] }); });

  it('① 🔴 핸들러 없는 정책은 0 이 아니라 null 로 저장·응답한다', async () => {
    const r = await ctx.svc.report();
    const unknown = r.policies.find((p) => p.resourceType === 'UNKNOWN_KIND')!;
    expect(unknown.supported).toBe(false);
    expect(unknown.candidates).toBeNull();
    expect(ctx.updates.find((u) => u.id === 'id-UNKNOWN_KIND')!.lastCandidates, '미지원을 0 으로 저장하면 목록이 "후보 0건"이라 말한다').toBeNull();
  });

  it('② ③ MEDICAL_RECORD 는 집계되고 두 기산점을 모두 돌려준다', async () => {
    const r = await ctx.svc.report();
    const mr = r.policies.find((p) => p.resourceType === 'MEDICAL_RECORD')!;
    expect(mr.supported).toBe(true);
    expect(mr.candidates).toBe(4);
    expect(mr.candidatesByLastEncounterAt).toBe(2);
    expect(ctx.updates.find((u) => u.id === 'id-MEDICAL_RECORD')!.lastCandidates).toBe(4);
    // 컷오프가 파라미터로 넘어간다(문자열 보간이 아니다)
    expect(ctx.prisma.$queryRawUnsafe.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(ctx.sqls[0]).toMatch(/FILTER \(WHERE x\.r_date < \$1\)/);
    expect(ctx.sqls[0]).toMatch(/GREATEST\(COALESCE\(le\.last_at, x\.r_date\), x\.r_date\) < \$1/);
  });

  it('③ 환자 귀속이 없는 기록(감사 로그)은 마지막 진료일 기준이 null(해당 없음)이다', async () => {
    const r = await ctx.svc.report();
    const audit = r.policies.find((p) => p.resourceType === 'AUDIT_LOG')!;
    expect(audit.supported).toBe(true);
    expect(audit.candidatesByLastEncounterAt).toBeNull();
  });

  it('② 🔴 고위험 기록 종류의 핸들러는 파기(purge)를 갖지 않는다', () => {
    const handlers = (ctx.svc as unknown as { handlers(): Record<string, { purge?: unknown }> }).handlers();
    for (const k of ['MEDICAL_RECORD', 'PRESCRIPTION', 'CONSENT_FORM', 'AUDIT_LOG', 'SMART_ACCESS_LOG']) {
      expect(handlers[k], `${k} 핸들러가 없다`).toBeTruthy();
      expect(handlers[k].purge, `${k} 에 파기 핸들러가 생겼다 — 법정 보존·아카이빙 결정 전이다`).toBeUndefined();
    }
  });

  it('④ 🔴 법정 종류 보유 현황은 후보 수를 계산하지 않는다(cutoff 필터 없음 · 파라미터 없음)', async () => {
    const r = await ctx.svc.legalKinds('KR');
    expect(r.periodsConfirmed).toBe(false);
    for (const sql of ctx.sqls) {
      expect(sql).not.toMatch(/\$1/);
      expect(sql).toMatch(/NULL::int AS by_created/);
    }
    for (const call of ctx.prisma.$queryRawUnsafe.mock.calls) expect(call.length).toBe(1);
    // 매핑된 종류는 전부 셌다
    expect(r.kinds.every((k) => k.counted)).toBe(true);
    expect(r.kinds.length).toBe(retentionRecordKindsOf('KR').length);
  });

  it('④ 여러 소스로 된 종류(간호기록부)는 합산하고, 가장 오래된 날짜는 소스 중 최소다', async () => {
    let i = 0;
    const c = makeService({
      policies: [],
      raw: () => [i++ % 2 === 0
        ? { total: 3, by_created: null, oldest_created: new Date('2022-01-01'), by_last: null, oldest_last: new Date('2023-01-01') }
        : { total: 5, by_created: null, oldest_created: new Date('2020-06-01'), by_last: null, oldest_last: new Date('2024-01-01') }],
    });
    const r = await c.svc.legalKinds('KR');
    const nursing = r.kinds.find((k) => k.key === 'NURSING_RECORD')!;
    expect(nursing.sources).toEqual(['NURSING_NOTE', 'UNIVERSAL_NURSING_NOTE']);
    expect(nursing.total).toBe(8);
  });

  it('④ 미매핑 종류(UAE 보건 데이터)는 세지 않는다 — total 은 0 이 아니라 null', async () => {
    const r = await ctx.svc.legalKinds('AE');
    const h = r.kinds.find((k) => k.key === 'HEALTH_DATA')!;
    expect(h.mapping).toBe('UNMAPPED');
    expect(h.counted).toBe(false);
    expect(h.total).toBeNull();
    expect(ctx.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('⑤ 🔴 법정 종류 어휘 — 보존 기간 숫자를 넣지 않는다', () => {
  const file = path.resolve(__dirname, '../../../../packages/shared/src/retention-record-kinds.ts');
  const code = fs.readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('기간을 뜻하는 키에 숫자가 없고, `N일`·`N년`·`N years` 표기도 없다', () => {
    expect(code, '기간 키에 숫자 리터럴이 들어갔다 — 법령 수치는 기관 정책·법무 확정이 정본이다').not.toMatch(/\b(days|years|months|period\w*|retention\w*|legalMin\w*)\s*:\s*\d/i);
    expect(code).not.toMatch(/\d+\s*(일|년|개월)/);
    expect(code).not.toMatch(/\d+\s*(years?|days?)\b/i);
  });

  it('대조군 — 어휘가 실제로 채워져 있고, 매핑 상태·출처 대조 여부가 빠짐없이 있다', () => {
    expect(RETENTION_RECORD_KINDS.filter((k) => k.country === 'KR').length).toBe(9);
    for (const k of RETENTION_RECORD_KINDS) {
      expect(['MAPPED', 'CANDIDATE', 'UNMAPPED']).toContain(k.mapping);
      expect(k.source.url).toMatch(/^https:\/\//);
      expect(typeof k.source.sourceVerified).toBe('boolean');
      if (k.mapping === 'UNMAPPED') expect(k.sources).toEqual([]);
      else expect(k.sources.length).toBeGreaterThan(0);
    }
  });
});
