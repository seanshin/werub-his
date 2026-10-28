import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/** ER 잔여 3종 (2026-07-23) — NEDOCS·119 사전통보·MCI */
describe('EmergencyService — ER residual (NEDOCS/prenotify/MCI)', () => {
  let service: EmergencyService;
  let mockPrisma: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      emergencyVisit: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'v' }), update: vi.fn() },
      // 총 병원병상 500·ER 실병상(ward.type=EMERGENCY) 0 — ER 0 이면 config edBedCount 폴백(P1)이라 기존 기대값 유지
      bed: {
        count: vi.fn().mockImplementation((args?: { where?: { ward?: { type?: string } } }) =>
          Promise.resolve(args?.where?.ward?.type === 'EMERGENCY' ? 0 : 500)),
      },
      emergencyPrenotification: {
        create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(),
      },
      mciEvent: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    };
    mockConfig = { get: vi.fn().mockResolvedValue(20) }; // emergency.edBedCount
    service = new EmergencyService(
      mockPrisma, undefined, undefined, undefined, undefined, undefined, undefined, mockConfig,
    );
  });

  describe('getNedocs', () => {
    it('빈 응급실 → score 0(음수 클램프)·1등급 정상', async () => {
      const r = await service.getNedocs();
      expect(r.score).toBe(0);
      expect(r.grade).toBe(1);
      expect(r.tone).toBe('ok');
      expect(r.inputs.edBeds).toBe(20);
    });

    it('표준 산식 검증 — 재실/입원대기/호흡기/대기시간 반영', async () => {
      const now = Date.now();
      const visits = [
        // 입원대기(boarding) 2건 — dispositionAt 2시간 전
        ...Array.from({ length: 2 }, () => ({
          arrivalAt: new Date(now - 5 * 3600_000), status: 'PENDING_DISPOSITION',
          disposition: 'ADMISSION', dispositionAt: new Date(now - 2 * 3600_000), onVentilator: false,
        })),
        // 호흡기 1건
        { arrivalAt: new Date(now - 3600_000), status: 'IN_TREATMENT', disposition: null, dispositionAt: null, onVentilator: true },
        // 트리아지 대기 1건 — 1시간 대기
        { arrivalAt: new Date(now - 3600_000), status: 'PENDING_TRIAGE', disposition: null, dispositionAt: null, onVentilator: false },
        // 일반 재실 6건
        ...Array.from({ length: 6 }, () => ({
          arrivalAt: new Date(now - 1800_000), status: 'IN_TREATMENT', disposition: null, dispositionAt: null, onVentilator: false,
        })),
      ];
      mockPrisma.emergencyVisit.findMany.mockResolvedValue(visits);

      const r = await service.getNedocs();
      // -20 + 85.8*(10/20) + 600*(2/500) + 13.3*1 + 0.93*2 + 5.64*1 ≈ 45.75 → 46
      expect(r.score).toBe(46);
      expect(r.grade).toBe(2); // 20~60 분주
      expect(r.inputs.patients).toBe(10);
      expect(r.inputs.boarding).toBe(2);
      expect(r.inputs.ventilated).toBe(1);
      expect(r.inputs.longestAdmitHours).toBeCloseTo(2, 1);
      expect(r.inputs.longestWaitHours).toBeCloseTo(1, 1);
    });

    it('경계 등급 — 호흡기 다수로 severe(140~180) danger 톤', async () => {
      mockPrisma.emergencyVisit.findMany.mockResolvedValue(
        Array.from({ length: 12 }, () => ({
          arrivalAt: new Date(), status: 'IN_TREATMENT', disposition: null, dispositionAt: null, onVentilator: true,
        })),
      );
      const r = await service.getNedocs();
      // -20 + 85.8*(12/20) + 13.3*12 = -20 + 51.48 + 159.6 ≈ 191 → 6등급
      expect(r.grade).toBe(6);
      expect(r.tone).toBe('danger');
    });

    it('config 미구성 시 edBeds 기본 20·0 나눗셈 방지(min 1)', async () => {
      mockConfig.get.mockRejectedValue(new Error('no config'));
      mockPrisma.bed.count.mockResolvedValue(0);
      const r = await service.getNedocs();
      expect(r.inputs.edBeds).toBe(20);
      expect(Number.isFinite(r.score)).toBe(true);
    });
  });

  describe('prenotification', () => {
    it('생성 — etaMinutes → etaAt 파생·기본 source EMS_119', async () => {
      mockPrisma.emergencyPrenotification.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data, status: 'EN_ROUTE' }));
      const before = Date.now();
      const r = await service.createPrenotification({ chiefComplaint: '흉통', etaMinutes: 15 });
      expect(r.source).toBe('EMS_119');
      expect(r.etaAt!.getTime()).toBeGreaterThanOrEqual(before + 14 * 60_000);
      expect(r.etaAt!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    });

    it('주호소 누락 → 400', async () => {
      await expect(service.createPrenotification({ chiefComplaint: '  ' } as any)).rejects.toThrow(BadRequestException);
    });

    it('목록 — etaRemainingMins 파생(지연=음수)', async () => {
      const now = Date.now();
      mockPrisma.emergencyPrenotification.findMany.mockResolvedValue([
        { id: 'a', etaAt: new Date(now + 10 * 60_000), receivedAt: new Date() },
        { id: 'b', etaAt: new Date(now - 5 * 60_000), receivedAt: new Date() },
        { id: 'c', etaAt: null, receivedAt: new Date() },
      ]);
      const rows = await service.listPrenotifications();
      expect(rows[0].etaRemainingMins).toBe(10);
      expect(rows[1].etaRemainingMins).toBe(-5);
      expect(rows[2].etaRemainingMins).toBeNull();
    });

    it('도착 처리 — 멱등(이미 ARRIVED면 update 없이 반환)·CANCELLED는 400', async () => {
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'p1', status: 'ARRIVED' });
      const r = await service.markPrenotificationArrived('p1');
      expect(r.status).toBe('ARRIVED');
      expect(mockPrisma.emergencyPrenotification.update).not.toHaveBeenCalled();

      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'p2', status: 'CANCELLED' });
      await expect(service.markPrenotificationArrived('p2')).rejects.toThrow(BadRequestException);
    });

    it('도착 처리 — EN_ROUTE → ARRIVED + visit 연결', async () => {
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue({ id: 'p1', status: 'EN_ROUTE' });
      mockPrisma.emergencyPrenotification.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
      const r = await service.markPrenotificationArrived('p1', 'visit-9');
      expect(r.status).toBe('ARRIVED');
      expect(r.linkedVisitId).toBe('visit-9');
    });

    it('취소 — 미존재 404', async () => {
      mockPrisma.emergencyPrenotification.findUnique.mockResolvedValue(null);
      await expect(service.cancelPrenotification('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('MCI', () => {
    it('활성화 — 동시 ACTIVE 1건 가드', async () => {
      mockPrisma.mciEvent.findFirst.mockResolvedValue({ id: 'm0', title: '기존 사건', status: 'ACTIVE' });
      await expect(service.activateMci('u1', { title: '새 사건' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.mciEvent.create).not.toHaveBeenCalled();
    });

    it('활성화 — title 필수·기본 type MCI', async () => {
      mockPrisma.mciEvent.findFirst.mockResolvedValue(null);
      mockPrisma.mciEvent.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data, status: 'ACTIVE' }));
      await expect(service.activateMci('u1', { title: '' })).rejects.toThrow(BadRequestException);
      const r = await service.activateMci('u1', { title: '다중 추돌', expectedCasualties: 20 });
      expect(r.type).toBe('MCI');
      expect(r.activatedBy).toBe('u1');
    });

    it('getActiveMci — 비활성 시 active:false·활성 시 KTAS 분포 집계', async () => {
      mockPrisma.mciEvent.findFirst.mockResolvedValue(null);
      expect((await service.getActiveMci()).active).toBe(false);

      mockPrisma.mciEvent.findFirst.mockResolvedValue({ id: 'm1', title: '사건', status: 'ACTIVE' });
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { id: 'v1', triageLevel: 'LEVEL_1', status: 'IN_TREATMENT', disposition: null },
        { id: 'v2', triageLevel: 'LEVEL_1', status: 'COMPLETED', disposition: 'ADMISSION' },
        { id: 'v3', triageLevel: 'LEVEL_3', status: 'IN_TREATMENT', disposition: null },
      ]);
      const r = await service.getActiveMci();
      expect(r.active).toBe(true);
      expect(r.casualties!.total).toBe(3);
      expect(r.casualties!.byKtas.LEVEL_1).toBe(2);
      expect(r.casualties!.inTreatment).toBe(2);
      expect(r.casualties!.admitted).toBe(1);
    });

    it('태깅 — 활성 MCI 없으면 400·있으면 visit에 mciEventId 연결', async () => {
      mockPrisma.mciEvent.findFirst.mockResolvedValue(null);
      await expect(service.tagMciCasualty('v1')).rejects.toThrow(BadRequestException);

      mockPrisma.mciEvent.findFirst.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });
      mockPrisma.emergencyVisit.update.mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data }));
      const r = await service.tagMciCasualty('v1');
      expect(r.mciEventId).toBe('m1');
    });

    it('종료 — 멱등(CLOSED면 그대로)·미존재 404', async () => {
      mockPrisma.mciEvent.findUnique.mockResolvedValue(null);
      await expect(service.closeMci('u1', 'nope')).rejects.toThrow(NotFoundException);

      mockPrisma.mciEvent.findUnique.mockResolvedValue({ id: 'm1', status: 'CLOSED' });
      const r = await service.closeMci('u1', 'm1');
      expect(r.status).toBe('CLOSED');
      expect(mockPrisma.mciEvent.update).not.toHaveBeenCalled();

      mockPrisma.mciEvent.findUnique.mockResolvedValue({ id: 'm2', status: 'ACTIVE', note: null });
      mockPrisma.mciEvent.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm2', ...data }));
      const r2 = await service.closeMci('u1', 'm2', '상황 종료');
      expect(r2.status).toBe('CLOSED');
      expect(r2.closedBy).toBe('u1');
    });
  });

  describe('autoCloseStaleVisits — 관리 기능 전환(config 게이트)', () => {
    it('기본 0(OFF) → 아무것도 안 함', async () => {
      mockConfig.get.mockResolvedValue(0);
      const r = await service.autoCloseStaleVisits();
      expect(r).toEqual({ closed: 0, hours: 0 });
      expect(mockPrisma.emergencyVisit.findMany).not.toHaveBeenCalled();
    });

    it('임계 설정 시 — 기준 경과 미완료 방문을 COMPLETED(🔴 처분 미기록은 비워 둔다 · D3 2026-09-15)', async () => {
      mockConfig.get.mockResolvedValue(168); // 7일
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { id: 'v1', disposition: null },
        { id: 'v2', disposition: 'ADMISSION' },
      ]);
      mockPrisma.emergencyVisit.update.mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data }));
      const r = await service.autoCloseStaleVisits();
      expect(r.closed).toBe(2);
      const calls = mockPrisma.emergencyVisit.update.mock.calls.map((c: any[]) => c[0]);
      // 🔴 종전엔 처분 미기록 환자를 '귀가'로 적었다 — 시한 경과는 처분을 말해 주지 않는다(비우고 사유만 남긴다)
      expect(calls.find((c: any) => c.where.id === 'v1').data.disposition).toBeUndefined();
      expect(calls.find((c: any) => c.where.id === 'v1').data.dispositionNote).toBe('AUTO_CLOSE_NO_DISPOSITION');
      expect(calls.find((c: any) => c.where.id === 'v2').data.disposition).toBe('ADMISSION');
      // cutoff 조건이 where에 반영됐는지
      const findArgs = mockPrisma.emergencyVisit.findMany.mock.calls[0][0];
      expect(findArgs.where.status).toEqual({ not: 'COMPLETED' });
      expect(findArgs.where.arrivalAt.lt).toBeInstanceOf(Date);
    });

    it('config 조회 실패 → 안전하게 OFF', async () => {
      mockConfig.get.mockRejectedValue(new Error('down'));
      const r = await service.autoCloseStaleVisits();
      expect(r.closed).toBe(0);
    });
  });

  describe('스카우트 3차 봉합', () => {
    it('S2: etaMinutes 초대형 값 → 720분 상한(Invalid Date 방지)', async () => {
      mockPrisma.emergencyPrenotification.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data }));
      const r = await service.createPrenotification({ chiefComplaint: '흉통', etaMinutes: 1e15 });
      expect(r.etaAt!.getTime()).toBeLessThanOrEqual(Date.now() + 720 * 60_000 + 1000);
      expect(Number.isNaN(r.etaAt!.getTime())).toBe(false);
    });

    it('S4: 미존재 visit 태깅 → 404(P2025 500 방지)', async () => {
      mockPrisma.mciEvent.findFirst.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });
      mockPrisma.emergencyVisit.findUnique = vi.fn().mockResolvedValue(null);
      await expect(service.tagMciCasualty('nope')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.emergencyVisit.update).not.toHaveBeenCalled();
    });

    it('S3: EN_ROUTE 24h 경과 자동만료', async () => {
      mockPrisma.emergencyPrenotification.updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const r = await service.expireStalePrenotifications();
      expect(r.expired).toBe(3);
      const args = mockPrisma.emergencyPrenotification.updateMany.mock.calls[0][0];
      expect(args.where.status).toBe('EN_ROUTE');
      expect(args.data.status).toBe('CANCELLED');
    });
  });
});
