import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  INCIDENT_SEVERITY_LABEL,
  isEscalatingSeverity,
  normalizeIncidentSeverity,
} from '@hospital-run/shared';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

/**
 * 화면 실사용 점검 W7 — /safety.
 *
 * 이 화면이 사실을 말하지 않던 지점들:
 *  ① 심각도 어휘 3벌 → 저장된 값의 2/3 가 화면에서 사라짐
 *  ② 관측 0건인데 "성공률 0%" + "오류 없음 ✓" 동시 표시(P17)
 *  ③ RCA 조회 화면 부재 → "RCA 완료 0" 영구 고정
 *  ④ 대시보드 위젯 4칸 중 3칸이 영구 `-`(FE↔서버 계약 불일치·P11)
 *  ⑤ 기간 표기 부재(전 기간 vs 30일이 같은 이름으로 다른 수)
 */
describe('PatientSafety W7 — 화면이 말하는 사실', () => {
  let svc: PatientSafetyService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      safetyIncident: {
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        create: vi.fn(async ({ data }: any) => ({ id: 'i1', ...data })),
      },
      rcaReport: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
      patientIdentificationCheck: { findMany: vi.fn(async () => []) },
    };
    svc = new PatientSafetyService(prisma as any, { emit: vi.fn() } as any);
  });

  /* ── ① 심각도 어휘 ─────────────────────────────────────────────── */

  describe('① 심각도 어휘 — 저장값을 흘리지 않는다', () => {
    it('실측 저장값(LOW 2 · MODERATE 1)이 통계 합계에서 사라지지 않는다', async () => {
      prisma.safetyIncident.groupBy.mockImplementation(async ({ by }: any) => {
        if (by[0] === 'severity') {
          return [
            { severity: 'LOW', _count: { id: 2 } },
            { severity: 'MODERATE', _count: { id: 1 } },
          ];
        }
        return [{ type: 'FALL', _count: { id: 3 } }];
      });
      prisma.safetyIncident.count.mockResolvedValue(3);

      const stats = await svc.getIncidentStats();
      const sum = stats.bySeverity.reduce((a, s) => a + s.count, 0);
      // 🔴 종전: 화면 5키(NEAR_MISS·MINOR·MODERATE·SEVERE·SENTINEL)로 훑어 합계 1 (총 3 인데)
      expect(sum).toBe(3);
      expect(stats.bySeverity.find((s) => s.severity === 'MINOR')?.count).toBe(2); // LOW → 경미
      expect(stats.bySeverity.find((s) => s.severity === 'MODERATE')?.count).toBe(1);
    });

    it('모든 등급은 0건이어도 라벨과 함께 내려온다(막대가 사라지지 않게)', async () => {
      const stats = await svc.getIncidentStats();
      for (const row of stats.bySeverity) {
        expect(row.label).toBe(INCIDENT_SEVERITY_LABEL[row.severity]);
        expect(row.label).toBeTruthy();
      }
      expect(stats.bySeverity.map((s) => s.severity)).toEqual(
        expect.arrayContaining(['NEAR_MISS', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL', 'SENTINEL']),
      );
    });

    it('미분류(UNSPECIFIED)는 0건이면 감추고, 있으면 드러낸다 — 경미로 접지 않는다', async () => {
      prisma.safetyIncident.groupBy.mockImplementation(async ({ by }: any) =>
        by[0] === 'severity' ? [{ severity: '??', _count: { id: 4 } }] : [],
      );
      const stats = await svc.getIncidentStats();
      expect(stats.unspecified).toBe(4);
      expect(stats.bySeverity.find((s) => s.severity === 'MINOR')?.count).toBe(0);
    });

    it('저장된 LOW 를 "경미"로 조회할 수 있다 — 종전엔 조회조차 불가', async () => {
      await svc.getIncidents({ severity: 'MINOR' }, { userId: 'u-rev', canReviewAll: true });
      const arg = prisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.severity.in).toEqual(expect.arrayContaining(['MINOR', 'LOW', '경미', 'low']));
    });

    it('미분류 조회는 알려진 저장값 후보를 모두 제외해서 찾는다', async () => {
      await svc.getIncidents({ severity: 'UNSPECIFIED' }, { userId: 'u-rev', canReviewAll: true });
      const arg = prisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.severity.notIn).toEqual(expect.arrayContaining(['LOW', 'MODERATE', 'SENTINEL']));
      expect(arg.where.severity.in).toBeUndefined();
    });

    it('저장값은 변형하지 않는다(HIGH 로 보내면 HIGH 로 저장)', async () => {
      const r: any = await svc.reportIncident({ reporterId: 'u1', type: 'FALL', severity: 'HIGH', description: 'x', occurredAt: '2026-08-01' });
      expect(r.severity).toBe('HIGH');
    });
  });

  /* ── 에스컬레이션 범위 동결 ────────────────────────────────────── */

  describe('에스컬레이션 범위는 종전과 동일해야 한다', () => {
    /** 종전 서버 private normalizeSeverity 의 재현(비교 기준 — 이 파일에서만 씀) */
    const legacyNormalize = (s: string): string => {
      const u = String(s ?? '').trim().toUpperCase();
      if (u.includes('SENTINEL') || u === '적신호') return 'SENTINEL';
      if (u.includes('CRITICAL') || u === 'CATASTROPHIC' || u === 'SEVERE' || u === '위해') return 'CRITICAL';
      if (u === 'MAJOR' || u === 'HIGH' || u === '중대') return 'MAJOR';
      if (u === 'MODERATE' || u === 'MEDIUM' || u === '중등도') return 'MODERATE';
      if (u === 'MINOR' || u === 'LOW' || u === 'NEAR_MISS' || u === '근접오류' || u === '경미') return 'MINOR';
      return u || 'UNSPECIFIED';
    };
    const legacyEscalates = (s: string) => ['SENTINEL', 'CRITICAL'].includes(legacyNormalize(s));

    const SAMPLES = [
      'SENTINEL', 'sentinel', 'SENTINEL_EVENT', '적신호',
      'CRITICAL', 'critical', 'CATASTROPHIC', 'SEVERE', '위해',
      'MAJOR', 'HIGH', '중대', 'MODERATE', 'MEDIUM', '중등도', '보통',
      'MINOR', 'LOW', 'NEAR_MISS', 'NEARMISS', '근접오류', '아차사고', '경미',
      '', '  ', 'BOGUS', '기타',
    ];

    it.each(SAMPLES)('통지 여부가 종전과 같다: %s', (s) => {
      expect(isEscalatingSeverity(s)).toBe(legacyEscalates(s));
    });

    it('보고 시 통지는 위해·적신호에서만 발생한다', async () => {
      for (const [sev, expected] of [['SEVERE', true], ['적신호', true], ['HIGH', false], ['LOW', false]] as const) {
        const emit = vi.fn();
        const s2 = new PatientSafetyService(prisma as any, { emit } as any);
        await s2.reportIncident({ reporterId: 'u', type: 'FALL', severity: sev, description: 'x', occurredAt: '2026-08-01' });
        expect(emit.mock.calls.some((c) => c[0] === 'incident.critical')).toBe(expected);
      }
    });

    it('통지 payload 의 severity 는 정본 등급이다', async () => {
      const emit = vi.fn();
      const s2 = new PatientSafetyService(prisma as any, { emit } as any);
      await s2.reportIncident({ reporterId: 'u', type: 'FALL', severity: 'catastrophic', description: 'x', occurredAt: '2026-08-01' });
      expect(emit).toHaveBeenCalledWith('incident.critical', expect.objectContaining({ severity: 'CRITICAL' }));
      expect(normalizeIncidentSeverity('catastrophic')).toBe('CRITICAL');
    });
  });

  /* ── ② 표본 0 ──────────────────────────────────────────────────── */

  describe('② 환자 식별 — 표본 0 은 0% 가 아니다(P17)', () => {
    it('관측 0건이면 비율은 null(산출 불가)이고 hasObservations=false', async () => {
      const s = await svc.getIdCheckStats({});
      // 🔴 종전: verifyRate 0(초록 카드) + failRate 0 + "오류 없음 ✓" 를 동시에 표시
      expect(s.overall.total).toBe(0);
      expect(s.overall.verifyRate).toBeNull();
      expect(s.overall.failRate).toBeNull();
      expect(s.hasObservations).toBe(false);
      expect(s.window.label).toBe('최근 30일');
    });

    it('관측이 있으면 비율은 숫자로 산출된다', async () => {
      prisma.patientIdentificationCheck.findMany.mockImplementation(async ({ where }: any) => {
        const rows = [
          { checkType: 'ADMISSION', method: 'WRISTBAND', result: 'PASS' },
          { checkType: 'ADMISSION', method: 'WRISTBAND', result: 'PASS' },
          { checkType: 'MEDICATION', method: 'BARCODE', result: 'FAIL' },
        ];
        return where.result === 'FAIL' ? [] : rows;
      });
      const s = await svc.getIdCheckStats({});
      expect(s.hasObservations).toBe(true);
      expect(s.overall.total).toBe(3);
      expect(s.overall.failRate).toBeCloseTo(33.3, 1);
      expect(s.overall.verifyRate).toBeCloseTo(66.7, 1);
    });

    it('기간을 지정하면 window 가 그 사실을 밝힌다', async () => {
      const s = await svc.getIdCheckStats({ dateFrom: '2026-01-01', dateTo: '2026-02-01' });
      expect(s.window.days).toBeNull();
      expect(s.window.label).toBe('지정 기간');
    });
  });

  /* ── ③ RCA ────────────────────────────────────────────────────── */

  describe('③ RCA — 화면이 볼 수 있게 사건과 기한을 함께 내려준다', () => {
    const rca = (over: Record<string, unknown> = {}) => ({
      id: 'r1', incidentId: 'i1', status: 'OPEN', findings: null,
      dueAt: new Date(Date.now() + 20 * 86400000), approvedAt: null, ...over,
    });

    it('목록은 원 사건(유형·중증도·경위)을 붙여 내려준다', async () => {
      prisma.rcaReport.findMany.mockResolvedValue([rca()]);
      prisma.safetyIncident.findMany.mockResolvedValue([
        { id: 'i1', type: 'FALL', severity: 'LOW', description: '낙상', location: null, occurredAt: new Date(), status: 'REPORTED', rcaCompleted: false },
      ]);
      const [row]: any = await svc.listRca();
      expect(row.incident.type).toBe('FALL');
      expect(row.incident.severityLevel).toBe('MINOR');
      expect(row.incident.severityLabel).toBe('경미');
      expect(row.overdue).toBe(false);
      expect(row.daysToDue).toBeGreaterThan(0);
    });

    it('기한 초과 미승인 건은 overdue=true (크론 rca.overdue 와 같은 집합)', async () => {
      prisma.rcaReport.findMany.mockResolvedValue([rca({ dueAt: new Date(Date.now() - 5 * 86400000) })]);
      const [row]: any = await svc.listRca();
      expect(row.overdue).toBe(true);
      expect(row.daysToDue).toBeLessThan(0);
    });

    it('승인 완료 건은 기한이 지나도 overdue 가 아니다', async () => {
      prisma.rcaReport.findMany.mockResolvedValue([rca({ status: 'APPROVED', dueAt: new Date(Date.now() - 5 * 86400000), approvedAt: new Date() })]);
      const [row]: any = await svc.listRca();
      expect(row.overdue).toBe(false);
    });

    it('원 사건이 없으면 incident=null — 빈 껍데기를 만들지 않는다', async () => {
      prisma.rcaReport.findMany.mockResolvedValue([rca()]);
      prisma.safetyIncident.findMany.mockResolvedValue([]);
      const [row]: any = await svc.listRca();
      expect(row.incident).toBeNull();
    });

    it('진행 중(미승인) RCA 수를 통계로 내려 "RCA 완료 0"만 보이던 화면을 보완한다', async () => {
      prisma.rcaReport.count.mockResolvedValue(1);
      const stats = await svc.getIncidentStats();
      expect(stats.rcaPending).toBe(1);
      // 완료 수는 사실 그대로(미승인이므로 0) — 숫자를 바꾸지 않는다
      expect(stats.rcaCompleted).toBe(0);
      expect(prisma.rcaReport.count).toHaveBeenCalledWith({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } } });
    });
  });

  /* ── ④⑤ 위젯 계약·기간 표기 ──────────────────────────────────── */

  describe('④⑤ 대시보드 계약 — 위젯이 읽는 키가 실재해야 한다', () => {
    it('falls·medication·thisMonth 가 응답에 존재한다(종전엔 없어 3칸이 영구 `-`)', async () => {
      prisma.safetyIncident.groupBy.mockImplementation(async ({ by }: any) =>
        by[0] === 'type'
          ? [{ type: 'FALL', _count: { id: 2 } }, { type: 'MEDICATION_ERROR', _count: { id: 1 } }, { type: 'MEDICATION', _count: { id: 3 } }]
          : [],
      );
      const stats: any = await svc.getIncidentStats();
      expect(stats.falls).toBe(2);
      expect(stats.medication).toBe(4); // MEDICATION + MEDICATION_ERROR
      expect(typeof stats.thisMonth).toBe('number');
      for (const k of ['total', 'falls', 'medication', 'thisMonth']) {
        expect(stats[k]).not.toBeUndefined();
      }
    });

    it('기간을 응답에 밝힌다(전 기간 누적)', async () => {
      const stats = await svc.getIncidentStats();
      expect(stats.period.scope).toBe('ALL_TIME');
      expect(stats.period.label).toContain('전 기간');
    });

    it('"중대 이상" 은 MAJOR·CRITICAL·SENTINEL 을 모두 센다 — 종전 SEVERE+SENTINEL 두 키만 셌다', async () => {
      prisma.safetyIncident.groupBy.mockImplementation(async ({ by }: any) =>
        by[0] === 'severity'
          ? [
              { severity: 'HIGH', _count: { id: 1 } },        // → MAJOR
              { severity: 'CATASTROPHIC', _count: { id: 1 } }, // → CRITICAL
              { severity: 'SENTINEL', _count: { id: 1 } },
              { severity: 'LOW', _count: { id: 5 } },
            ]
          : [],
      );
      const stats = await svc.getIncidentStats();
      expect(stats.majorOrAbove).toBe(3);
      expect(stats.escalating).toBe(2); // 즉시통지 = 위해·적신호만
    });
  });
});
