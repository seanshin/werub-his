/**
 * 늦은 기록 유예 · 활력 이상 표시 기준 수렴(2026-10-01).
 *  · 유예는 원내 규정 config `nursing.lateEntry.graceMinutes` — 미설정은 null(판정은 유예 0) · 범위 밖은 미설정
 *  · 간호 스테이션 활력 이상 표시는 서버 정본 임계(`vitals-evaluate` + `clinical.vitals.thresholds`)로 판정해 싣는다
 *    (화면 하드코딩 임계 = 4번째 정본 회수) · 개정 반영/기본값을 밝히고 버려진 개정 키도 밝힌다
 */
import { describe, it, expect, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { NurseStationService } from '../../src/modules/nurse-station/nurse-station.service';
import { VitalsService } from '../../src/modules/vitals/vitals.service';
import { vitalItemFlags, VITALS_THRESHOLDS } from '../../src/modules/vitals/vitals-evaluate';

const kst = (s: string) => new Date(`${s}+09:00`);
const cfg = (map: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => (k in map ? map[k] : null)) });

describe('늦은 기록 유예', () => {
  const rows = [{ id: 'n', recordedAt: kst('2026-09-30T10:00:00'), createdAt: kst('2026-09-30T15:20:00') }];
  const svc = (grace: unknown) => new NursingService({ nursingNote: { findMany: vi.fn(async () => rows) } } as never, undefined, cfg({ 'nursing.lateEntry.graceMinutes': grace }) as never);

  it('🔴 유예 30분이면 종료 20분 뒤 기록은 늦은 기록이 아니다', async () => {
    const r = (await svc(30).getNotes('a1', {})) as Array<{ lateEntry: boolean }>;
    expect(r[0].lateEntry).toBe(false);
  });
  it('대조군 — 미설정이면 유예 0 → 늦은 기록', async () => {
    const r = (await svc(null).getNotes('a1', {})) as Array<{ lateEntry: boolean }>;
    expect(r[0].lateEntry).toBe(true);
  });
  it('규칙은 미설정을 configured:false 로 밝힌다 · 범위 밖 값도 미설정', async () => {
    expect(await svc(null).lateEntryRule()).toEqual({ graceMinutes: null, configured: false });
    expect(await svc(9999).lateEntryRule()).toEqual({ graceMinutes: null, configured: false });
    expect(await svc(60).lateEntryRule()).toEqual({ graceMinutes: 60, configured: true });
  });
  it('🔴 설정 조회 실패는 기본값으로 번역하지 않고 전파한다', async () => {
    const s = new NursingService({} as never, undefined, { get: vi.fn(async () => { throw new Error('db'); }) } as never);
    await expect(s.lateEntryRule()).rejects.toThrow('db');
  });
});

describe('활력 항목 판정 — 서버 정본 임계', () => {
  it('위급·주의·정상·미측정 4상태(경계 포함)', () => {
    const f = vitalItemFlags({ systolicBp: 185, heartRate: 100, spo2: 97, temperature: null, respiratoryRate: 22, painScore: 3 });
    expect(f).toMatchObject({ systolicBp: 'CRITICAL', heartRate: 'WARNING', spo2: 'NORMAL', temperature: null, respiratoryRate: 'WARNING', painScore: 'NORMAL', diastolicBp: null });
  });
  it('🔴 호흡수도 판정한다(종전 화면은 규칙이 없었다)', () => {
    expect(vitalItemFlags({ respiratoryRate: 6 }).respiratoryRate).toBe('CRITICAL');
  });
  it('개정된 임계를 따른다', () => {
    const T = JSON.parse(JSON.stringify(VITALS_THRESHOLDS));
    T.systolicBp.warnHigh = 160;
    expect(vitalItemFlags({ systolicBp: 150 }).systolicBp).toBe('WARNING');
    expect(vitalItemFlags({ systolicBp: 150 }, T).systolicBp).toBe('NORMAL');
  });
});

describe('적용 임계의 출처', () => {
  const vs = (raw: unknown) => new VitalsService({} as never, {} as never, undefined, undefined, cfg({ 'clinical.vitals.thresholds': raw }) as never);
  it('개정 없음(빈값) → DEFAULT', async () => {
    expect((await vs('').effectiveThresholds()).source).toBe('DEFAULT');
  });
  it('개정 반영 → CONFIGURED · 값이 병합된다', async () => {
    const r = await vs({ systolicBp: { warnHigh: 160 } }).effectiveThresholds();
    expect(r.source).toBe('CONFIGURED');
    expect(r.thresholds.systolicBp.warnHigh).toBe(160);
  });
  it('🔴 오타 키만 있으면 CONFIGURED 가 아니다 · 버려진 키를 밝힌다', async () => {
    const r = await vs({ sbp: { high: 170 } }).effectiveThresholds();
    expect(r).toMatchObject({ source: 'DEFAULT', droppedKeys: ['sbp'] });
  });
});

describe('간호 스테이션 활력 조회 — 행마다 flags + 규칙', () => {
  it('🔴 개정 임계로 판정한 flags 를 싣는다 · 규칙 출처를 함께 돌려준다', async () => {
    const prisma = {
      preVisitVitals: { findMany: vi.fn(async () => [{ id: 'v1', nurseId: 'n1', systolicBp: 150, temperature: '38.6', spo2: 93, respiratoryRate: null, measuredAt: new Date() }]) },
      user: { findMany: vi.fn(async () => []) },
    };
    // 행은 두 원장 읽기 정본(VitalsService.listRecent)이 준다 — 여기선 외래 원장 행 하나
    const vitals = { listRecent: vi.fn(async () => prisma.preVisitVitals.findMany()), effectiveThresholds: vi.fn(async () => {
      const T = JSON.parse(JSON.stringify(VITALS_THRESHOLDS)); T.systolicBp.warnHigh = 160;
      return { thresholds: T, source: 'CONFIGURED', droppedKeys: [], invertedKeys: [] };
    }) };
    const svc = new NurseStationService(prisma as never, {} as never, {} as never, { emit: vi.fn() } as never, vitals as never);
    const r = await svc.getVitalsByPatientWithRule('p1');
    expect(r.rule.source).toBe('CONFIGURED');
    expect(r.rows[0].flags).toMatchObject({ systolicBp: 'NORMAL', temperature: 'CRITICAL', spo2: 'WARNING', respiratoryRate: null });
    // 서버 필드명 그대로(temperature·spo2) — 화면이 읽는 이름
    expect(r.rows[0]).toMatchObject({ temperature: 38.6, spo2: 93 });
  });
});
