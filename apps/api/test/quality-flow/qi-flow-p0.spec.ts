/**
 * 의료질관리 흐름 P0(QI-FLOW-001 · 2026-10-08) — 확정 결함 6건 봉합.
 *  D1 무효 측정이 `/admin/qi`·보고서·안전보드·상황판에 섞이던 것 → 읽는 곳은 모두 ACTIVE_MEASUREMENT(구조 가드 포함)
 *  D2 사고 상태 자유 문자열·워크그룹 우회 → shared 전이표·사유 필수·동시 409 · 알림 확인은 사고를 바꾸지 않는다
 *  D3 시드가 위원회 목표를 되돌림 → upsert update 에 targetValue 없음
 *  D4 NPS 응답 0 → 0 → null
 *  D5 원장 대조 전 기간 건수 → 측정 달의 건수
 *  D6 재입원 목표 5.0 하드코딩 → 지표 원장 목표(없으면 판정 없음)
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { INCIDENT_STATUS_TRANSITIONS, KOPS_REPORT_STATUS } from '@hospital-run/shared';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { QiService } from '../../src/modules/qi/qi.service';
import { SafetyQualityBoardService } from '../../src/modules/qi/safety-quality-board.service';
import { collectIndicatorLedgers } from '../../src/modules/quality/indicator-ledger';
import { SatisfactionService } from '../../src/modules/satisfaction/satisfaction.service';
import { WorkgroupService } from '../../src/modules/workgroup/workgroup.service';

const SRC = join(__dirname, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('D1 무효 측정 — 읽는 곳은 모두 무효를 거른다', () => {
  it('🔴 /admin/qi 지표 대시보드가 measurements include 에 무효 조건을 건다', async () => {
    const findMany = vi.fn(async () => []);
    const svc = new QiService({ qualityIndicator: { findMany } } as never);
    await svc.getIndicatorDashboard('2026-09');
    const arg = (findMany.mock.calls as unknown as Array<[{ include: { measurements: { where: unknown } } }]>)[0][0];
    expect(arg.include.measurements.where).toEqual({ voidedAt: null, stratumKey: '' });
  });
  it('🔴 안전·질 보드가 무효를 거른다', async () => {
    const qiFind = vi.fn(async () => []);
    const prisma = {
      safetyIncident: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
      infectionSurveillance: { count: vi.fn(async () => 0) },
      handHygieneObservation: { findMany: vi.fn(async () => []) },
      qiMeasurement: { findMany: qiFind },
    };
    await new SafetyQualityBoardService(prisma as never).getBoard().catch(() => undefined);
    const arg = (qiFind.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0];
    expect(arg.where).toEqual({ voidedAt: null, stratumKey: '' });
  });
  it('🔴 구조 가드 — quality 모듈 밖에서 측정을 읽는 자리는 무효 조건을 쓴다', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') || p.endsWith('.spec.ts')) continue;
        const rel = p.slice(SRC.length + 1);
        if (rel.startsWith('modules/quality/')) continue; // 쓰기·무효화 정본(읽기는 ACTIVE_MEASUREMENT)
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/qiMeasurement\.findMany\(\{([\s\S]{0,400}?)\}\)/g)) if (!/ACTIVE_MEASUREMENT|voidedAt: null/.test(m[1])) offenders.push(rel);
        // 관계 include 만(where/orderBy/take/select 로 시작) — 다른 모델의 JSON 칼럼 `measurements: { not: … }` 는 대상 아님
        if (/qualityIndicator\./.test(src)) for (const m of src.matchAll(/measurements: \{ ?(where|orderBy|take|select)([^}]{0,200})/g)) if (!/ACTIVE_MEASUREMENT|voidedAt: null/.test(m[1] + m[2])) offenders.push(rel);
      }
    };
    walk(join(SRC, 'modules'));
    expect(offenders).toEqual([]);
  });
  it('대조군 — 관계 include 형태(옛 qi.service)를 잡는다', () => {
    const bad = "include: { measurements: { orderBy: { period: 'desc' }, take: 12 } }";
    const m = [...bad.matchAll(/measurements: \{ ?(where|orderBy|take|select)([^}]{0,200})/g)];
    expect(m.length).toBe(1);
    expect(/ACTIVE_MEASUREMENT|voidedAt: null/.test(m[0][1] + m[0][2])).toBe(false);
  });
  it('대조군 — 스캐너가 무효 조건 없는 읽기를 잡는다', () => {
    const bad = "this.prisma.qiMeasurement.findMany({ orderBy: { measuredAt: 'desc' } })";
    const m = [...bad.matchAll(/qiMeasurement\.findMany\(\{([\s\S]{0,400}?)\}\)/g)];
    expect(m.length).toBe(1);
    expect(/ACTIVE_MEASUREMENT|voidedAt: null/.test(m[0][1])).toBe(false);
  });
});

describe('D2 사고 상태 전이', () => {
  function svc(status: string, raced = false) {
    const updateMany = vi.fn(async () => ({ count: raced ? 0 : 1 }));
    const prisma = {
      safetyIncident: {
        findUnique: vi.fn(async (a: { select?: { status?: boolean } }) => (a.select?.status ? { status } : { id: 'i1', status: 'X' })),
        updateMany,
      },
    };
    return { s: new PatientSafetyService(prisma as never, { emit: vi.fn() } as never), updateMany };
  }
  it('🔴 어휘 밖 400 · 건너뜀 409 · 종료는 끝', async () => {
    await expect(svc('REPORTED').s.updateIncidentStatus('i1', 'DONE')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc('REPORTED').s.updateIncidentStatus('i1', 'RESOLVED', '조치')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc('CLOSED').s.updateIncidentStatus('i1', 'INVESTIGATING')).rejects.toBeInstanceOf(ConflictException);
    expect(INCIDENT_STATUS_TRANSITIONS.CLOSED).toEqual([]);
  });
  it('🔴 해결·보고 즉시 종료·재조사는 사유 필수', async () => {
    await expect(svc('INVESTIGATING').s.updateIncidentStatus('i1', 'RESOLVED')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc('REPORTED').s.updateIncidentStatus('i1', 'CLOSED', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc('RESOLVED').s.updateIncidentStatus('i1', 'INVESTIGATING')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('허용 전이는 읽은 상태 조건으로 · 동시 조작 409', async () => {
    const a = svc('REPORTED');
    await a.s.updateIncidentStatus('i1', 'INVESTIGATING');
    expect((a.updateMany.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0].where).toEqual({ id: 'i1', status: 'REPORTED' });
    await expect(svc('REPORTED', true).s.updateIncidentStatus('i1', 'INVESTIGATING')).rejects.toBeInstanceOf(ConflictException);
  });
  it('🔴 워크그룹 알림 확인은 사고를 바꾸지 않는다', async () => {
    const update = vi.fn(); const findMany = vi.fn(async () => [{ id: 'abc123', status: 'REPORTED' }]);
    const w = new WorkgroupService({ safetyIncident: { update, findMany, updateMany: update } } as never, {} as never);
    await w.acknowledgeAlert('alert-safety-abc', { acknowledgedBy: 'u', action: 'resolved' });
    expect(update).not.toHaveBeenCalled();
    expect(read('modules/workgroup/workgroup.service.ts')).not.toMatch(/safetyIncident\.(update|updateMany)\(/);
  });
  it('KOPS 는 미구축 정직 표식 — 보고 시각을 지어내지 않는다', () => {
    expect(KOPS_REPORT_STATUS).toMatchObject({ implemented: false, status: 'LOCAL_RECORDED', reportedAt: null });
    expect(read('modules/patient-safety/patient-safety.service.ts')).toContain('externalReport: kopsReportStatusOf(row)') // 2026-10-09 직접 보고 기록이 있으면 MANUAL_REPORTED — 송신은 여전히 implemented:false;
  });
});

describe('D3·D4·D5·D6', () => {
  it('🔴 D3 시드 QI 지표 upsert update 에 targetValue 가 없다', () => {
    const seed = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');
    const i = seed.indexOf('for (const qi of QI_INDICATOR_CATALOG)');
    expect(i).toBeGreaterThan(0);
    const block = seed.slice(i, i + 700);
    const upd = block.slice(block.indexOf('update:'), block.indexOf('create:'));
    expect(upd).not.toContain('targetValue');
  });
  it('🔴 D4 NPS 점수 응답 0 이면 null(0 아님) · 있으면 계산', () => {
    const s = new SatisfactionService({} as never, {} as never) as unknown as { npsFrom: (x: (number | null)[]) => number | null };
    expect(s.npsFrom([])).toBeNull();
    expect(s.npsFrom([null, null])).toBeNull();
    expect(s.npsFrom([10, 10, 0])).toBe(33);
  });
  it('🔴 D5 원장 대조는 측정 달의 건수 · 기간 없으면 전 기간', async () => {
    const count = vi.fn(async () => 3);
    const prisma = { safetyIncident: { count } } as never;
    const m = await collectIndicatorLedgers(prisma, [{ name: '낙상 발생률', period: '2026-05' }]);
    const where = (count.mock.calls as unknown as Array<[{ where: { occurredAt?: { gte: Date; lt: Date } } }]>)[0][0].where;
    expect(where.occurredAt?.gte.getMonth()).toBe(4);
    expect(where.occurredAt?.lt.getMonth()).toBe(5);
    expect(m.get('낙상발생률')).toMatchObject({ count: 3, period: '2026-05' });
    count.mockClear();
    const all = await collectIndicatorLedgers(prisma, ['낙상 발생률']);
    expect((count.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>)[0][0].where).toEqual({ type: 'FALL' });
    expect(all.get('낙상발생률')?.period).toBeNull();
  });
  it('🔴 D6 재입원 목표는 지표 원장 — 미등록이면 목표·판정 없음', async () => {
    const mk = (indicators: unknown[]) => new QiService({
      admission: { findMany: vi.fn(async () => [{ id: 'a', patientId: 'p', dischargeDate: new Date('2026-09-10'), attendingDoctor: null, admittingDoctor: null }]), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      qualityIndicator: { findMany: vi.fn(async () => indicators) },
    } as never);
    const none = await mk([]).getReadmissionRate('2026-09');
    expect(none.target).toBeNull();
    expect(none.achievement).toBeNull();
    const reg = await mk([{ name: '30일 내 재입원율', targetValue: 8, direction: 'LOWER_IS_BETTER', unit: '%', valueScale: 100 }]).getReadmissionRate('2026-09');
    expect(reg.target).toBe(8);
    expect(reg.achievement).toBe('ACHIEVED');
    expect(read('modules/qi/qi.service.ts')).not.toMatch(/target: 5\.0/);
  });
});
