/**
 * 환자가 집에서 잰 값(SMBG) = 참고용(2026-10-20 포털 P3 B4 · 결정 `portal.patientReportedVitals` = REFERENCE_ONLY · 사용자 지시).
 *  · 🔴 종전: 포털 입력 하나가 목표 미달이면 담당의에게 CHRONIC_ALERT 를 바로 보냈다
 *  · 🔴 종전: 추이 중복 정리에서 SMBG(4) 가 같은 분의 외래 측정(3)을 밀어냈다
 *  · 🔴 종전: 조절 판정·추적관리(리콜·목표 미달)·추세가 출처를 가리지 않고 셌다
 *  · 대조군: 의료진 측정(CLINIC)은 종전처럼 경보·판정에 쓰인다 · 환자 입력도 기록·표시는 된다
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { ChronicService } from '../../src/modules/chronic/chronic.service';

function mk(rows: any[] = []) {
  const prisma: any = {
    chronicObservation: {
      create: vi.fn(async ({ data }: any) => ({ id: 'o1', ...data })),
      findMany: vi.fn().mockResolvedValue(rows),
    },
    notification: { findFirst: vi.fn().mockResolvedValue(null) },
    encounter: { findFirst: vi.fn().mockResolvedValue({ doctorId: 'd1' }) },
    admission: { findFirst: vi.fn().mockResolvedValue(null) },
    problemList: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const notifications = { create: vi.fn().mockResolvedValue({}) };
  return { svc: new ChronicService(prisma, notifications as any), prisma, notifications };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('🔴 환자 입력 혈압·혈당은 참고용 — 경보를 내지 않는다', () => {
  it('SMBG 목표 미달 → 기록은 되고 담당의 경보 없음 · 대조군 CLINIC 같은 값은 경보', async () => {
    const a = mk();
    const obs = await a.svc.create('p1', { code: 'SBP', value: 170, source: 'SMBG' } as any);
    await flush();
    expect(obs).toMatchObject({ source: 'SMBG', flag: 'H' });
    expect(a.notifications.create).not.toHaveBeenCalled();
    expect(a.prisma.notification.findFirst).not.toHaveBeenCalled();

    const b = mk();
    await b.svc.create('p1', { code: 'SBP', value: 170, source: 'CLINIC' } as any);
    await flush();
    expect(b.notifications.create).toHaveBeenCalledWith('d1', expect.objectContaining({ type: 'CHRONIC_ALERT' }));
  });
});

describe('🔴 추이 — 의료진 측정이 이기고, 판정은 의료진 측정만', () => {
  const at = (iso: string) => new Date(iso);
  it('같은 분의 외래 측정과 환자 입력 → 외래 측정을 남긴다(종전 반대)', async () => {
    const { svc } = mk([
      { code: 'SBP', value: 150, unit: 'mmHg', measuredAt: at('2026-10-01T01:00:10Z'), source: 'CLINIC', flag: 'H', normalMin: null, normalMax: 120 },
      { code: 'SBP', value: 118, unit: 'mmHg', measuredAt: at('2026-10-01T01:00:40Z'), source: 'SMBG', flag: 'N', normalMin: null, normalMax: 120 },
    ]);
    const r = await svc.getTrend('p1', {});
    expect(r.series.SBP).toHaveLength(1);
    expect(r.series.SBP[0]).toMatchObject({ value: 150, source: 'CLINIC', patientReported: false });
  });
  it('최신이 환자 입력이면 표시는 그 값(참고용 표식) · 판정용 clinical 은 마지막 의료진 측정 · 추세는 의료진 측정만', async () => {
    const { svc } = mk([
      { code: 'SBP', value: 150, unit: 'mmHg', measuredAt: at('2026-07-01T01:00:00Z'), source: 'CLINIC', flag: 'H', normalMin: null, normalMax: 120 },
      { code: 'SBP', value: 145, unit: 'mmHg', measuredAt: at('2026-08-01T01:00:00Z'), source: 'CLINIC', flag: 'H', normalMin: null, normalMax: 120 },
      { code: 'SBP', value: 160, unit: 'mmHg', measuredAt: at('2026-09-01T01:00:00Z'), source: 'CLINIC', flag: 'H', normalMin: null, normalMax: 120 },
      { code: 'SBP', value: 110, unit: 'mmHg', measuredAt: at('2026-10-01T01:00:00Z'), source: 'SMBG', flag: 'N', normalMin: null, normalMax: 120 },
    ]);
    const s = (await svc.getTrend('p1', {})).summary.SBP;
    expect(s).toMatchObject({ latest: 110, latestPatientReported: true, patientReportedCount: 1, count: 4 });
    expect(s.clinical).toMatchObject({ latest: 160 });
    // 의료진 측정 150→145→160 은 악화 — 환자 입력 110 을 넣으면 개선으로 뒤집힌다
    expect(s.trend).toBe('WORSENING');
  });
  it('환자 입력만 있으면 clinical = null(판정할 의료진 측정 없음)', async () => {
    const { svc } = mk([{ code: 'FBS', value: 160, unit: 'mg/dL', measuredAt: at('2026-10-01T01:00:00Z'), source: 'SMBG', flag: 'H', normalMin: 70, normalMax: 100 }]);
    expect((await svc.getTrend('p1', {})).summary.FBS.clinical).toBeNull();
  });
});

describe('🔴 조절 판정·추적관리·코호트는 환자 입력을 세지 않는다', () => {
  it('문제 중심 뷰 조회가 SMBG 를 뺀다', async () => {
    const { svc, prisma } = mk();
    prisma.problemList.findMany.mockResolvedValue([{ diagnosisCode: { code: 'I10', nameKo: '고혈압' } }]);
    await svc.getProblemView('p1');
    expect(prisma.chronicObservation.findMany.mock.calls[0][0].where.source).toEqual({ notIn: ['SMBG'] });
  });
  it('구조 — 추적관리·대시보드 최신값 SQL 이 환자 입력 출처를 뺀다(두 곳)', () => {
    const src = readFileSync('src/modules/chronic/chronic.service.ts', 'utf8');
    const hits = src.match(/FROM chronic_observations\s+WHERE context = 'CHRONIC' AND source <> ALL\(\$\{\[\.\.\.PATIENT_REPORTED_SOURCES\]\}\)/g) ?? [];
    expect(hits).toHaveLength(2);
  });
});
