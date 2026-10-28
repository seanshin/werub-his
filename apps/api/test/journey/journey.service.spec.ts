import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JourneyService } from '../../src/modules/journey/journey.service';

describe('JourneyService', () => {
  let service: JourneyService;
  let mockPrisma: any;
  let mockFloor: any;

  beforeEach(() => {
    mockPrisma = {
      patientJourneyEvent: { create: vi.fn(), findMany: vi.fn() },
      patientLocation: { updateMany: vi.fn(), create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
      spaceNode: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      emergencyVisit: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      billing: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mockFloor = { emitMovement: vi.fn().mockResolvedValue(undefined), recordLocation: vi.fn().mockResolvedValue({ id: 'loc-1' }) };
    service = new JourneyService(mockPrisma, mockFloor);
  });

  // ── emit ──

  describe('emit', () => {
    it('should create journey event (fire-and-forget)', () => {
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({ id: 'je-1' });
      mockPrisma.spaceNode.findFirst.mockResolvedValue(null);
      service.emit({ patientId: 'p-1', eventType: 'RECEPTION_CHECKIN', title: '접수 완료' });
      expect(mockPrisma.patientJourneyEvent.create).toHaveBeenCalled();
    });

    it('should record an INFERRED location via the canonical writer when exactly one zone matches', async () => {
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({ id: 'je-1' });
      mockPrisma.spaceNode.findMany.mockResolvedValue([{ id: 'zone-1', floor: 1 }]);

      service.emit({ patientId: 'p-1', eventType: 'RECEPTION_CHECKIN', title: '접수', department: '내과' });

      // Wait for async chain
      await new Promise(r => setTimeout(r, 50));
      expect(mockPrisma.spaceNode.findMany).toHaveBeenCalled();
      expect(mockFloor.recordLocation).toHaveBeenCalledWith(expect.objectContaining({
        patientId: 'p-1', zoneId: 'zone-1', source: 'INFERRED_EVENT', granularity: 'ZONE', eventType: 'RECEPTION_CHECKIN', eventId: 'je-1',
      }));
      // 위치 원장에 직접 쓰지 않는다(단일 쓰기 경로)
      expect(mockPrisma.patientLocation.create).not.toHaveBeenCalled();
    });

    it('should not update location for unmapped event type', async () => {
      mockPrisma.patientJourneyEvent.create.mockResolvedValue({ id: 'je-1' });
      service.emit({ patientId: 'p-1', eventType: 'UNKNOWN_EVENT', title: 'Unknown' });
      await new Promise(r => setTimeout(r, 50));
      expect(mockPrisma.spaceNode.findMany).not.toHaveBeenCalled();
      expect(mockFloor.recordLocation).not.toHaveBeenCalled();
    });

    it('should not throw on create failure', () => {
      mockPrisma.patientJourneyEvent.create.mockRejectedValue(new Error('DB error'));
      // Should not throw
      expect(() => service.emit({ patientId: 'p-1', eventType: 'ADMISSION', title: 'Test' })).not.toThrow();
    });
  });

  // ── getTimeline ──

  describe('getTimeline', () => {
    /**
     * 🔴 (2026-10-01 P3 표시 잔여) 정렬·잘림·커서 = **발생 시각(모르면 표시 시각)** — 종전 표시 시각(event_at)으로 자르고
     *    화면이 페이지 안에서만 다시 줄 세웠다. id 는 매개변수 SQL 로 고르고, 행은 Prisma 로 읽는다.
     */
    const at = (min: number) => new Date(Date.UTC(2026, 8, 30, 0, min));
    const ID = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
    const sqlOf = (n = 0) => mockPrisma.$queryRaw.mock.calls[n][0] as { sql: string; values: unknown[] };
    beforeEach(() => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      // findMany 는 id 로 고른 행을 **순서 없이** 돌려준다(정렬은 SQL 이 정한다)
      mockPrisma.patientJourneyEvent.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...where.id.in].reverse().map((id) => ({ id, eventType: 'LAB_RESULT' })));
    });

    it('🔴 발생 시각(모르면 표시 시각) 최신 N건 · 응답은 시간순(오래된→최신) · 잘림·커서도 같은 키', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: ID('c'), sort_at: at(3) }, { id: ID('b'), sort_at: at(2) }, { id: ID('a'), sort_at: at(1) }]);
      const r = await service.getTimeline('p-1', { limit: 2 });
      expect(sqlOf().sql).toMatch(/ORDER BY COALESCE\(e\.occurred_at, e\.event_at\) DESC, e\.id DESC/);
      expect(sqlOf().values).toContain(3); // limit + 1
      expect(r.events.map((e) => e.id)).toEqual([ID('b'), ID('c')]);
      expect(r.truncated).toBe(true);
      expect(r.olderCursor).toBe(`${at(2).toISOString()}|${ID('b')}`);
      expect(r.orderBy).toBe('OCCURRED_ELSE_DISPLAYED');
    });

    it('대조군 — 잘리지 않으면 truncated false · 커서 없음 · 0건이면 행 조회 안 함', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: ID('b'), sort_at: at(2) }, { id: ID('a'), sort_at: at(1) }]);
      const r = await service.getTimeline('p-1', { limit: 2 });
      expect(r).toMatchObject({ truncated: false, olderCursor: null });
      expect(r.events.map((e) => e.id)).toEqual([ID('a'), ID('b')]);
      mockPrisma.patientJourneyEvent.findMany.mockClear();
      mockPrisma.$queryRaw.mockResolvedValue([]);
      expect((await service.getTimeline('p-1')).events).toEqual([]);
      expect(mockPrisma.patientJourneyEvent.findMany).not.toHaveBeenCalled();
    });

    it('before 커서 — 같은 키 값 행도 빠지지 않게 (키 < 커서) 또는 (키 = 커서 이고 id < 커서 id)', async () => {
      await service.getTimeline('p-1', { before: `2026-09-30T00:02:00.000Z|${ID('b')}` });
      const q = sqlOf();
      expect(q.sql).toMatch(/\(COALESCE\(e\.occurred_at, e\.event_at\) < \? OR \(COALESCE\(e\.occurred_at, e\.event_at\) = \? AND e\.id < \?::uuid\)\)/);
      expect(q.values).toContainEqual(new Date('2026-09-30T00:02:00.000Z'));
      expect(q.values).toContain(ID('b'));
    });

    it('잘못된 커서는 400(시각·uuid 아닌 id 모두)', async () => {
      await expect(service.getTimeline('p-1', { before: 'nope' })).rejects.toMatchObject({ status: 400 });
      await expect(service.getTimeline('p-1', { before: '2026-09-30T00:02:00.000Z|b' })).rejects.toMatchObject({ status: 400 });
    });

    it('🔴 날짜 경계는 KST(dayRange) · 기간도 같은 정렬 키로 거른다', async () => {
      await service.getTimeline('p-1', { from: '2026-05-01', to: '2026-05-31' });
      const q = sqlOf();
      expect(q.sql).toMatch(/COALESCE\(e\.occurred_at, e\.event_at\) >= \?/);
      expect(q.values.map((v) => (v instanceof Date ? v.toISOString() : v))).toEqual(
        expect.arrayContaining(['2026-04-30T15:00:00.000Z', '2026-05-31T15:00:00.000Z']));
    });

    it('유형 필터·상한(500) · 환자 조건은 매개변수(문자열 이어붙이기 아님)', async () => {
      await service.getTimeline('p-1', { types: ['ENCOUNTER_START', 'BILLING_PAID'], limit: 9999 });
      const q = sqlOf();
      expect(q.sql).toMatch(/e\.event_type = ANY\(\?::text\[\]\)/);
      expect(q.values).toContainEqual(['ENCOUNTER_START', 'BILLING_PAID']);
      expect(q.values).toContain(501);
      expect(q.values).toContain('p-1');
      expect(q.sql).not.toContain('p-1');
    });
  });

  // ── getMetrics ──

  describe('getMetrics', () => {
    it('🔴 표본이 없으면 전 지표 null(산출 불가) + 표본 수 — 종전 응급 체류·재원일수·재입원율은 0 이었다', async () => {
      const r = await service.getMetrics();
      expect(r).toMatchObject({
        avgOutpatientWaitMinutes: null, outpatientWaitSampleN: 0,
        avgErStayHours: null, avgLengthOfStayDays: null, admissionSampleN: 0,
        readmissionRate30Days: null, dischargeSampleN: 0,
      });
    });

    it('🔴 (결정 D9) 응급 체류 = 도착 → 퇴실 시각 · 퇴실 시각 없는 방문은 빼고 수를 밝힌다 · 입원 기간을 대용으로 쓰지 않는다', async () => {
      const a = new Date('2026-10-02T00:00:00Z');
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { arrivalAt: a, departedAt: new Date(a.getTime() + 3 * 3_600_000) },
        { arrivalAt: a, departedAt: new Date(a.getTime() + 4 * 3_600_000) },
        { arrivalAt: a, departedAt: null }, // 진행 중·자동 종결 — 끝을 지어내지 않는다
        { arrivalAt: a, departedAt: new Date(a.getTime() - 60_000) }, // 도착보다 앞(데이터 결함)
      ]);
      const r = await service.getMetrics();
      expect(r).toMatchObject({ avgErStayHours: 3.5, erStayUnavailableReason: null, erVisitSampleN: 2, erStayExcluded: 2 });
      for (const c of mockPrisma.admission.findMany.mock.calls) expect(JSON.stringify(c[0])).not.toContain('admitReason');
    });

    it('대조군 — 퇴실 시각이 기록된 방문이 없으면 null + 이유(0 시간이 아니다)', async () => {
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([{ arrivalAt: new Date(), departedAt: null }]);
      const r = await service.getMetrics();
      expect(r).toMatchObject({ avgErStayHours: null, erStayUnavailableReason: 'NO_DEPARTURE_RECORDED', erVisitSampleN: 0, erStayExcluded: 1 });
    });

    it('🔴 (결정 D8) 외래 체류 = 접수 → 그 진료의 수납 완료 · 수납 전·미수·입원 진료는 빼고 수를 밝힌다', async () => {
      const t = new Date('2026-10-02T00:00:00Z');
      mockPrisma.waitingQueue.findMany
        .mockResolvedValueOnce([]) // 대기 지표
        .mockResolvedValueOnce([
          { checkedInAt: t, encounterId: 'e1' }, { checkedInAt: t, encounterId: 'e2' },
          { checkedInAt: t, encounterId: 'e3' }, { checkedInAt: t, encounterId: 'e4' },
        ]);
      mockPrisma.billing.findMany.mockResolvedValue([
        { encounterId: 'e1', status: 'PAID', paidAt: new Date(t.getTime() + 60 * 60000) },
        { encounterId: 'e2', status: 'REFUNDED', paidAt: new Date(t.getTime() + 90 * 60000) }, // 환불돼도 방문은 끝났다
        { encounterId: 'e3', status: 'PENDING', paidAt: null },
      ]);
      const r = await service.getMetrics();
      expect(r).toMatchObject({ avgOutpatientStayMinutes: 75, outpatientStaySampleN: 2, outpatientStayExcluded: 2 });
      // 입원 진료의 수납은 외래 끝이 아니다
      expect(JSON.stringify((mockPrisma.billing.findMany.mock.calls[0] as any)[0].where)).toContain('"admissionId":null');
    });

    it('should calculate avg wait time', async () => {
      const now = Date.now();
      mockPrisma.waitingQueue.findMany.mockResolvedValue([
        { checkedInAt: new Date(now - 20 * 60000), startedAt: new Date(now) },
        { checkedInAt: new Date(now - 40 * 60000), startedAt: new Date(now) },
      ]);
      const result = await service.getMetrics();
      expect(result.avgOutpatientWaitMinutes).toBe(30);
    });

    it('재원일수 평균', async () => {
      const now = Date.now();
      mockPrisma.admission.findMany
        .mockResolvedValueOnce([
          { admitDate: new Date(now - 5 * 86400000), dischargeDate: new Date(now) },
          { admitDate: new Date(now - 3 * 86400000), dischargeDate: new Date(now) },
        ])
        .mockResolvedValueOnce([]); // allDischarges
      const result = await service.getMetrics();
      expect(result.avgLengthOfStayDays).toBe(4);
      expect(result.admissionSampleN).toBe(2);
    });

    it('🔴 30일 재입원율 — 한 번의 조회로 짝짓는다(퇴원마다 쿼리하던 N+1 제거)', async () => {
      const now = Date.now();
      const d1 = new Date(now - 20 * 86400000);
      mockPrisma.admission.findMany
        .mockResolvedValueOnce([]) // 재원일수 대상
        .mockResolvedValueOnce([   // 기간 안 퇴원
          { patientId: 'p-1', dischargeDate: d1 },
          { patientId: 'p-2', dischargeDate: d1 },
        ])
        .mockResolvedValueOnce([   // 재입원 후보(한 번)
          { patientId: 'p-1', admitDate: new Date(d1.getTime() + 5 * 86400000) },
          { patientId: 'p-2', admitDate: new Date(d1.getTime() - 86400000) }, // 퇴원 전 입원은 재입원 아님
        ]);
      const result = await service.getMetrics();
      expect(result.readmissionRate30Days).toBe(50);
      expect(result.sampleCounts.readmissions).toBe(1);
      expect(result.dischargeSampleN).toBe(2);
      expect(mockPrisma.admission.findFirst).not.toHaveBeenCalled();
    });

    it('기간 지정 — KST 날짜 경계', async () => {
      const result = await service.getMetrics({ from: '2026-01-01', to: '2026-01-31' });
      expect(result.period.from).toBe('2025-12-31T15:00:00.000Z');
      expect(result.period.to).toBe('2026-01-31T15:00:00.000Z');
    });
  });
});
