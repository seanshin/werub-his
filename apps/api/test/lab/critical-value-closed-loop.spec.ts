import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { LabService } from '../../src/modules/lab/lab.service';
import { CriticalValueEscalationService } from '../../src/modules/lab/critical-value-escalation.service';
import { RecordCriticalValueActionDto } from '../../src/modules/lab/dto/lab-result.dto';
import {
  CRITICAL_ALERT_STATUSES,
  CRITICAL_ALERT_OPEN_STATUSES,
  CRITICAL_ALERT_ESCALATE_CONFIG_KEY,
  canTransitionCriticalAlert,
  parseEscalateAfterMinutes,
  type CriticalAlertStatus,
} from '../../src/modules/lab/critical-value-alert-states';

/**
 * 위급값 클로즈드루프 상태기계 — agent-emr-alignment.plan.md §4.1(5단계 상태기계·ESCALATED 크론·허용시간 파라미터) · 2단계 2-1
 *
 * 🔴 이 파일이 막는 것:
 *   ① 확인(ACKNOWLEDGED)에서 루프가 멈춘다 — 조치·종결 상태가 없었다.
 *   ② 허용시간을 코드가 정한다(보드 `30` 하드코딩) — 미설정이면 상향 보고하지 않는다.
 *   ③ 크론이 같은 경보를 반복 상향한다 / 이미 확인된 경보를 되돌린다.
 *   ④ 🔴 상향 보고된(ESCALATED) 경보가 "미확인" 집계·포털 수치 마스킹에서 **사라진다** — `status: 'PENDING'` 만 보던 소비처들.
 */

// ── ① 전이표 전수 ──────────────────────────────────────────────────────
describe('① 상태 전이표 — 전수', () => {
  const EXPECTED: Record<CriticalAlertStatus, CriticalAlertStatus[]> = {
    PENDING: ['ESCALATED', 'ACKNOWLEDGED'],
    ESCALATED: ['ACKNOWLEDGED'],
    ACKNOWLEDGED: ['ACTED'],
    ACTED: ['CLOSED'],
    CLOSED: [],
  };
  for (const from of CRITICAL_ALERT_STATUSES) {
    for (const to of CRITICAL_ALERT_STATUSES) {
      const allowed = EXPECTED[from].includes(to);
      it(`${from} → ${to} : ${allowed ? '허용' : '거부'}`, () => {
        expect(canTransitionCriticalAlert(from, to)).toBe(allowed);
      });
    }
  }
  it('모르는 상태에서는 어디로도 전이하지 않는다', () => {
    expect(canTransitionCriticalAlert('DETECTED', 'ACKNOWLEDGED')).toBe(false);
  });
  it('미확인 집합 = PENDING ∪ ESCALATED', () => {
    expect([...CRITICAL_ALERT_OPEN_STATUSES].sort()).toEqual(['ESCALATED', 'PENDING']);
  });
});

// ── 서비스 픽스처 ─────────────────────────────────────────────────────
function makeLab(row: Record<string, unknown> | null, opts: { updateCount?: number } = {}) {
  const state = row ? { ...row } : null;
  const updateMany = vi.fn().mockImplementation(({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
    if (!state || state.status !== where.status || opts.updateCount === 0) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  });
  const prisma: any = {
    criticalValueAlert: {
      findUnique: vi.fn().mockImplementation(() => (state ? { ...state } : null)),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...state, ...data })),
      updateMany,
      findMany: vi.fn().mockResolvedValue([]),
    },
    patient: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { service: new LabService(prisma, {} as any, {} as any, {} as any), prisma, updateMany, state };
}
const BASE = { id: 'a1', labResultId: 'lr', patientId: 'p', doctorId: 'doc', testName: 'K', value: '7.2', unit: 'mEq/L', reason: 'HH', responseAction: '주치의 보고' };

describe('② 서비스 전이 — 잘못된 전이는 400, 경쟁은 409', () => {
  it('ESCALATED 도 확인할 수 있다(상향 보고됐다고 확인이 막히면 방치된다)', async () => {
    const { service, prisma } = makeLab({ ...BASE, status: 'ESCALATED' });
    await service.acknowledgeCriticalAlert('a1', 'doc', { readBack: false, responseAction: 'x' });
    expect(prisma.criticalValueAlert.update.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
  });

  it('ACKNOWLEDGED → ACTED: 조치자·시각이 남고 기존 조치란을 덮어쓰지 않는다', async () => {
    const { service, state } = makeLab({ ...BASE, status: 'ACKNOWLEDGED' });
    await service.recordCriticalAlertAction('a1', 'doc2', { action: 'KCl 중단·재검' });
    expect(state!.status).toBe('ACTED');
    expect(state!.actedBy).toBe('doc2');
    expect(state!.actedAt).toBeInstanceOf(Date);
    expect(state!.responseAction).toBe('주치의 보고\n[조치] KCl 중단·재검');
  });

  it('ACTED → CLOSED', async () => {
    const { service, state } = makeLab({ ...BASE, status: 'ACTED' });
    await service.closeCriticalAlert('a1', 'doc3');
    expect(state!.status).toBe('CLOSED');
    expect(state!.closedBy).toBe('doc3');
  });

  it.each([
    ['PENDING', 'act'],
    ['ESCALATED', 'act'],
    ['CLOSED', 'act'],
    ['PENDING', 'close'],
    ['ACKNOWLEDGED', 'close'],
    ['CLOSED', 'close'],
  ] as const)('🔴 %s 에서 %s → 400 (확인 없이 조치·조치 없이 종결 불가)', async (from, op) => {
    const { service, updateMany } = makeLab({ ...BASE, status: from });
    const call = op === 'act' ? service.recordCriticalAlertAction('a1', 'u', { action: 'x' }) : service.closeCriticalAlert('a1', 'u');
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('🔴 읽은 뒤 다른 사람이 상태를 바꿨으면 409 — 덮어쓰지 않는다(where 에 현재 상태)', async () => {
    const { service, updateMany } = makeLab({ ...BASE, status: 'ACKNOWLEDGED' }, { updateCount: 0 });
    await expect(service.recordCriticalAlertAction('a1', 'u', { action: 'x' })).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', status: 'ACKNOWLEDGED' });
  });

  it('조치 내용 없는 조치 기록은 400 — DTO 와 서비스 둘 다', async () => {
    const { service } = makeLab({ ...BASE, status: 'ACKNOWLEDGED' });
    await expect(service.recordCriticalAlertAction('a1', 'u', { action: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false });
    await expect(pipe.transform({}, { type: 'body', metatype: RecordCriticalValueActionDto })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 내 미확인 목록이 ESCALATED 를 포함한다', async () => {
    const { service, prisma } = makeLab(null);
    await service.getPendingCriticalAlerts('doc', 'DOCTOR');
    expect(prisma.criticalValueAlert.findMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'ESCALATED'] });
  });
});

// ── ③ 상향 보고 크론 ─────────────────────────────────────────────────
function makeEscalation(configValue: unknown, rows: Array<{ id: string; status: string; notifiedAt: Date; escalatedAt?: Date | null }>) {
  const updateMany = vi.fn().mockImplementation(({ where, data }: any) => {
    let count = 0;
    for (const r of rows) {
      if (r.status === where.status && r.notifiedAt < where.notifiedAt.lt) { Object.assign(r, data); count++; }
    }
    return { count };
  });
  const prisma: any = { criticalValueAlert: { updateMany } };
  const config: any = { get: vi.fn().mockImplementation((k: string) => (k === CRITICAL_ALERT_ESCALATE_CONFIG_KEY ? configValue : null)) };
  return { svc: new CriticalValueEscalationService(prisma, config), updateMany, config };
}
const NOW = new Date('2026-09-14T03:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('③ 상향 보고 크론 — 허용시간 미설정이면 아무것도 하지 않는다', () => {
  it('대조군 — 미설정(null)이면 NOT_CONFIGURED 이고 행을 건드리지 않는다', async () => {
    const rows = [{ id: 'old', status: 'PENDING', notifiedAt: minsAgo(600) }];
    const { svc, updateMany } = makeEscalation(null, rows);
    const run = await svc.escalateOverdue(NOW);
    expect(run).toEqual({ status: 'NOT_CONFIGURED', escalated: 0, afterMinutes: null, invalid: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('PENDING');
  });

  it('해석 불가("30분")는 기본값으로 바꾸지 않고 미설정과 구분해 말한다', async () => {
    const { svc, updateMany } = makeEscalation('30분', [{ id: 'x', status: 'PENDING', notifiedAt: minsAgo(600) }]);
    expect(await svc.escalateOverdue(NOW)).toMatchObject({ status: 'NOT_CONFIGURED', invalid: true });
    expect(updateMany).not.toHaveBeenCalled();
    expect(parseEscalateAfterMinutes('0')).toBeNull();
    expect(parseEscalateAfterMinutes(-5)).toBeNull();
    expect(parseEscalateAfterMinutes('45')).toBe(45);
  });

  it('🔴 설정(30분) — 기한 넘긴 PENDING 만 한 번 ESCALATED, 확인된·기한 전·이미 상향된 행은 그대로 · 재실행 멱등', async () => {
    const earlier = minsAgo(5);
    const rows = [
      { id: 'overdue', status: 'PENDING', notifiedAt: minsAgo(31), escalatedAt: null as Date | null },
      { id: 'fresh', status: 'PENDING', notifiedAt: minsAgo(10), escalatedAt: null as Date | null },
      { id: 'acked', status: 'ACKNOWLEDGED', notifiedAt: minsAgo(120), escalatedAt: null as Date | null },
      { id: 'already', status: 'ESCALATED', notifiedAt: minsAgo(200), escalatedAt: earlier },
    ];
    const { svc } = makeEscalation(30, rows);
    const first = await svc.escalateOverdue(NOW);
    expect(first).toEqual({ status: 'DONE', escalated: 1, afterMinutes: 30, notificationSent: false, notificationReason: 'ALERT_ROUTING_UNAPPROVED' });
    expect(rows.map((r) => r.status)).toEqual(['ESCALATED', 'PENDING', 'ACKNOWLEDGED', 'ESCALATED']);
    expect(rows[0].escalatedAt).toEqual(NOW);
    expect(rows[3].escalatedAt).toEqual(earlier); // 이미 상향된 행의 시각을 다시 찍지 않는다

    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = await svc.escalateOverdue(later);
    expect(second).toMatchObject({ escalated: 0 });
    expect(rows[0].escalatedAt).toEqual(NOW);
  });
});

// ── ④ 소비처 — 미확인을 PENDING 하나로 세지 않는다 ─────────────────────
describe('④ 🔴 미확인 소비처가 ESCALATED 를 빠뜨리지 않는다(포털 수치 마스킹 포함)', () => {
  const SRC = join(__dirname, '../../src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !/\.spec\.ts$/.test(n) ? [p] : [];
  });
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('criticalValueAlert 조회에 status 를 PENDING 단일값으로 거는 곳이 없다', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const src = strip(readFileSync(f, 'utf8'));
      const re = /criticalValueAlert\.(?:findMany|findFirst|count|groupBy)\(\{[\s\S]{0,300}?status:\s*'PENDING'/g;
      if (re.test(src)) hits.push(relative(SRC, f));
    }
    expect(hits).toEqual([]);
  });

  it('SQL 로 세는 감시자 펄스도 ESCALATED 를 포함한다', () => {
    const src = readFileSync(join(SRC, 'sentinel/pulse-registry.ts'), 'utf8');
    expect(src).not.toMatch(/critical_value_alerts WHERE status = 'PENDING'/);
    expect(src).toMatch(/critical_value_alerts WHERE status IN \('PENDING', 'ESCALATED'\)/);
  });

  it('대조군 — 탐지기가 PENDING 단일 조회를 실제로 잡는다', () => {
    const sample = "await this.prisma.criticalValueAlert.count({ where: { patientId, status: 'PENDING' } });";
    expect(/criticalValueAlert\.(?:findMany|findFirst|count|groupBy)\(\{[\s\S]{0,300}?status:\s*'PENDING'/.test(sample)).toBe(true);
  });
});
