/**
 * 간호 질관리 잔여(2026-10-26).
 *  · 🔴 Morse·Braden 등급 경계 정본 하나 — 서버 재평가 정책 = shared 화면 함수(전 구간 일치) · 정책에 숫자 경계 사본 없음(구조)
 *  · 🔴 신체보호대 점검 간격 = 설정 키 · 출처 3상태(원내 설정·코드 기본값·조회 실패) · 조회 실패에도 감시는 계속(끄는 쪽이 덜 안전)
 *  · 🔴 점검 기록 없는 보호대 알림이 "점검 2시간+분 경과"라는 깨진 문장이던 것
 *  · 처방 기한 경과와 점검 지연을 갈라 내려 준다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { bradenRiskLevel, morseRiskLevel, MORSE_RISK_BOUNDS } from '@hospital-run/shared';
import { deriveRiskLevel } from '../../src/modules/risk-reassessment/risk-reassessment.policy';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { NotificationListener } from '../../src/modules/notification/notification.listener';

const SRC = join(__dirname, '../../src/modules');

describe('🔴 위험 등급 경계 정본 하나', () => {
  it('Morse 0~125 · Braden 6~23 전 구간에서 서버 정책 = shared 화면 함수', () => {
    for (let s = 0; s <= 125; s++) expect(deriveRiskLevel('FALL_RISK', s), `Morse ${s}`).toBe(morseRiskLevel(s));
    for (let s = 6; s <= 23; s++) expect(deriveRiskLevel('PRESSURE_ULCER', s), `Braden ${s}`).toBe(bradenRiskLevel(s));
  });
  it('Morse 경계 24/25·44/45 · 범위 밖·소수는 등급을 지어내지 않는다', () => {
    expect([24, 25, 44, 45].map((s) => morseRiskLevel(s))).toEqual(['LOW', 'MODERATE', 'MODERATE', 'HIGH']);
    for (const v of [-1, 126, 30.5, null, undefined]) expect(morseRiskLevel(v as number)).toBeNull();
    expect(MORSE_RISK_BOUNDS).toEqual({ moderateMin: 25, highMin: 45 });
  });
  it('정책·간호 서비스에 숫자 경계 사본이 없다(구조)', () => {
    const policy = readFileSync(join(SRC, 'risk-reassessment/risk-reassessment.policy.ts'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    expect(policy).not.toMatch(/score\s*>=\s*(45|25)|score\s*<=\s*(12|14)/);
    const nursing = readFileSync(join(SRC, 'nursing/nursing.service.ts'), 'utf8');
    expect(nursing).not.toMatch(/bradenScore\s*<=\s*1[24]\b/);
  });
});

function svcWith(opts: { cfg?: { value: unknown; source: string } | 'throw'; orders?: any[] }) {
  const prisma: any = {
    restraintOrder: { findMany: vi.fn(async () => opts.orders ?? []) },
    patient: { findMany: vi.fn(async () => []) },
  };
  const config: any = {
    getWithSource: vi.fn(async () => { if (opts.cfg === 'throw') throw new Error('db down'); return opts.cfg ?? { value: 120, source: 'default', registered: true }; }),
  };
  return new PatientSafetyService(prisma, { emit: vi.fn() } as never, config);
}
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const ORDER = (o: Partial<{ last: number | null; plannedUntil: Date | null }>) => ({
  id: 'r1', patientId: 'p1', status: 'ACTIVE', plannedUntil: o.plannedUntil ?? null,
  monitorings: o.last == null ? [] : [{ checkedAt: ago(o.last) }],
});

describe('🔴 신체보호대 점검 간격 — 설정 키 · 출처', () => {
  it('원내 설정 60분 → 61분 지연 · 출처 CONFIGURED', async () => {
    const [r] = await svcWith({ cfg: { value: 60, source: 'db' }, orders: [ORDER({ last: 61 })] }).getActiveRestraints();
    expect(r).toMatchObject({ checkIntervalMinutes: 60, checkIntervalSource: 'CONFIGURED', monitoringOverdue: true, overdue: true });
  });
  it('설정 없음 → 코드 기본값 120 · CODE_DEFAULT · 61분은 지연 아님', async () => {
    const [r] = await svcWith({ orders: [ORDER({ last: 61 })] }).getActiveRestraints();
    expect(r).toMatchObject({ checkIntervalMinutes: 120, checkIntervalSource: 'CODE_DEFAULT', monitoringOverdue: false, overdue: false });
  });
  it('형식 밖 설정(5분) → 코드 기본값으로 · 출처를 원내 설정이라 말하지 않는다', async () => {
    const [r] = await svcWith({ cfg: { value: 5, source: 'db' }, orders: [ORDER({ last: 10 })] }).getActiveRestraints();
    expect(r).toMatchObject({ checkIntervalMinutes: 120, checkIntervalSource: 'CODE_DEFAULT' });
  });
  it('🔴 설정 조회 실패 → UNKNOWN 이지만 감시는 계속(기본값 120)', async () => {
    const [r] = await svcWith({ cfg: 'throw', orders: [ORDER({ last: 121 })] }).getActiveRestraints();
    expect(r).toMatchObject({ checkIntervalMinutes: 120, checkIntervalSource: 'UNKNOWN', monitoringOverdue: true });
  });
  it('점검 기록 없음 = 늘 점검 필요 · 처방 기한 경과는 따로', async () => {
    const [never] = await svcWith({ orders: [ORDER({ last: null })] }).getActiveRestraints();
    expect(never).toMatchObject({ lastCheckMinutesAgo: null, monitoringOverdue: true, expired: false });
    const [exp] = await svcWith({ orders: [ORDER({ last: 10, plannedUntil: ago(5) })] }).getActiveRestraints();
    expect(exp).toMatchObject({ expired: true, monitoringOverdue: false, overdue: true });
  });
});

describe('🔴 보호대 알림 문구', () => {
  async function msg(payload: object) {
    const l = Object.create(NotificationListener.prototype);
    const notify = vi.fn(async () => undefined);
    l.prisma = { patient: { findUnique: vi.fn(async () => ({ familyName: '김', givenName: '가람' })) } };
    l.notifyAttendingDoctor = notify;
    l.logger = { warn: vi.fn() };
    await l.handleRestraintOverdue({ patientId: 'p1', orderId: 'r1', ...payload });
    return (notify.mock.calls[0] as unknown[])[2] as { message: string };
  }
  it('점검 기록 없음 → "점검 기록 없음"(깨진 "2시간+분" 아님) · 대조군 분 · 처방 만료', async () => {
    const none = await msg({ reason: 'MONITORING_OVERDUE', lastCheckMinutesAgo: null });
    expect(none.message).toContain('점검 기록 없음');
    expect(none.message).not.toMatch(/2시간\+/);
    expect((await msg({ reason: 'MONITORING_OVERDUE', lastCheckMinutesAgo: 150 })).message).toContain('점검 150분 경과');
    expect((await msg({ reason: 'ORDER_EXPIRED', lastCheckMinutesAgo: 10 })).message).toContain('처방 기한 경과');
  });
});
