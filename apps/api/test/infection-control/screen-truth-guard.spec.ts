import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfectionControlService } from '../../src/modules/infection-control/infection-control.service';

/**
 * 감염관리 화면이 **사실을 말하는지** 지키는 가드 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 되살아나면 안 되는 것:
 *  ① 표본 0건인데 준수율 "0%"(= 직원이 손을 전혀 안 씻는다)로 단정
 *  ② '격리 환자'를 감염감시 격리유형만 세어, 같은 화면 MDRO 4명과 모순
 *  ③ isolated 가 resolvedAt 을 무시해 해소된 과거 감염이 영구히 격리 환자로 남음
 *  ④ 감염감시 목록이 해소 여부를 말하지 않음
 *  ⑤ reportedToKCDC 플래그를 '신고완료'로 번역(질병관리청 전송 채널은 미구현)
 */
describe('감염관리 화면 진실성 가드 (W7)', () => {
  let service: InfectionControlService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      handHygieneObservation: { findMany: vi.fn().mockResolvedValue([]) },
      infectionSurveillance: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      isolationPrecaution: { findMany: vi.fn().mockResolvedValue([]) },
      mdroRegistry: { findMany: vi.fn().mockResolvedValue([]) },
      icuAdmission: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new InfectionControlService(prisma);
  });

  describe('① 손위생 준수율 — 표본 부재의 정답은 0 이 아니라 null', () => {
    it('관측 0건이면 complianceRate=null · sampleAvailable=false · 사유(note) 를 준다', async () => {
      prisma.handHygieneObservation.findMany.mockResolvedValue([]);
      const r = await service.getHandHygieneCompliance({});
      expect(r.overall.total).toBe(0);
      expect(r.overall.complianceRate).toBeNull(); // 🔴 0 이면 회귀
      expect(r.overall.sampleAvailable).toBe(false);
      expect(r.overall.note).toBeTruthy();
    });

    it('관측 0건이면 Moment별 비율도 전부 null(0% 아님)', async () => {
      prisma.handHygieneObservation.findMany.mockResolvedValue([]);
      const r = await service.getHandHygieneCompliance({});
      expect(r.byMoment).toHaveLength(5);
      expect(r.byMoment.every((m) => m.rate === null && m.total === 0)).toBe(true);
      expect(r.byRole).toEqual([]);
    });

    it('관측이 있으면 실제 비율을 준다(진짜 0% 는 0 으로 말한다)', async () => {
      prisma.handHygieneObservation.findMany.mockResolvedValue([
        { observedRole: 'NURSE', moment: 1, action: 'PERFORMED', method: 'SANITIZER' },
        { observedRole: 'NURSE', moment: 1, action: 'MISSED', method: 'SOAP' },
        { observedRole: 'DOCTOR', moment: 3, action: 'MISSED', method: 'SOAP' },
      ]);
      const r = await service.getHandHygieneCompliance({});
      expect(r.overall.complianceRate).toBe(33.3);
      expect(r.overall.sampleAvailable).toBe(true);
      const doctor = r.byRole.find((x) => x.key === 'DOCTOR')!;
      expect(doctor.rate).toBe(0); // 관측된 진짜 0% 는 0 으로 말해야 한다
      const m2 = r.byMoment.find((m) => m.moment === 2)!;
      expect(m2.rate).toBeNull(); // 관측 없는 Moment 는 null
    });

    it('WHO Moment 라벨은 BE 정본 문구를 그대로 내려준다(화면 라벨 2벌 방지)', async () => {
      const r = await service.getHandHygieneCompliance({});
      expect(r.byMoment.map((m) => m.label)).toEqual([...InfectionControlService.HH_MOMENTS]);
      expect(r.byMoment[2].label).toBe('체액 노출 위험 후');
    });
  });

  describe('② ③ 격리 환자 = 환자 단위 병합(오더+감염감시+MDRO+중환자실)', () => {
    it('MDRO 격리 환자가 집계에 포함된다(카드 1 vs MDRO 탭 4 모순 방지)', async () => {
      prisma.mdroRegistry.findMany.mockResolvedValue([
        { patientId: 'p1' }, { patientId: 'p2' }, { patientId: 'p3' }, { patientId: 'p4' },
      ]);
      prisma.infectionSurveillance.findMany.mockResolvedValue([{ patientId: 'p9' }]);
      const s = await service.getStats();
      expect(s.isolated).toBe(5);
      expect(s.isolatedBy).toEqual({ order: 0, surveillance: 1, mdro: 4, icu: 0 });
      expect(s.isolatedBasis).toContain('MDRO');
    });

    it('같은 환자가 여러 출처에 있어도 1명으로 센다(환자 단위)', async () => {
      prisma.isolationPrecaution.findMany.mockResolvedValue([{ patientId: 'p1' }]);
      prisma.infectionSurveillance.findMany.mockResolvedValue([{ patientId: 'p1' }]);
      prisma.mdroRegistry.findMany.mockResolvedValue([{ patientId: 'p1' }]);
      prisma.icuAdmission.findMany.mockResolvedValue([{ patientId: 'p1' }]);
      const s = await service.getStats();
      expect(s.isolated).toBe(1);
    });

    it('감염감시 격리는 미해소(resolvedAt=null)만 센다 — 해소된 과거 감염 영구 잔존 방지', async () => {
      await service.getStats();
      const where = prisma.infectionSurveillance.findMany.mock.calls[0][0].where;
      expect(where.resolvedAt).toBeNull();
      expect(where.isolationType).toEqual({ not: null });
    });

    it('MDRO 는 active 이면서 clearedAt=null 만, 중환자실은 재원+격리만 센다', async () => {
      await service.getStats();
      expect(prisma.mdroRegistry.findMany.mock.calls[0][0].where).toEqual({ active: true, clearedAt: null });
      expect(prisma.icuAdmission.findMany.mock.calls[0][0].where).toEqual({ status: 'ADMITTED', isolation: true });
      expect(prisma.isolationPrecaution.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
    });
  });

  describe('④ ⑤ 감염 감시 목록 — 해소 여부와 KCDC 플래그를 정직하게', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 'i1', patientId: 'p1', infectionType: 'SSI', organism: null, isolationType: 'CONTACT',
      detectedAt: new Date('2026-08-01'), resolvedAt: null, reportedToKCDC: false, notes: null,
      createdAt: new Date('2026-08-01'), patient: { id: 'p1', familyName: '김', givenName: '환자', mrn: 'M1' },
      ...over,
    });

    it('해소 건은 isResolved=true 로 표시되고 미해소 뒤로 밀린다', async () => {
      prisma.infectionSurveillance.findMany.mockResolvedValue([
        row({ id: 'resolved', resolvedAt: new Date('2026-08-05') }),
        row({ id: 'active' }),
      ]);
      const list = await service.findAll();
      expect(list.map((r) => r.id)).toEqual(['active', 'resolved']);
      expect(list[0].isResolved).toBe(false);
      expect(list[1].isResolved).toBe(true);
    });

    it('reportedToKCDC=true 를 "신고완료"로 번역하지 않는다(전송 채널 미구현)', async () => {
      prisma.infectionSurveillance.findMany.mockResolvedValue([row({ reportedToKCDC: true })]);
      const [r] = await service.findAll();
      expect(r.kcdc.flagged).toBe(true);
      expect(r.kcdc.transmitted).toBe(false); // 🔴 true 면 P16 회귀
      expect(r.kcdc.label).not.toBe('신고완료');
      expect(r.kcdc.note).toBeTruthy();
    });

    it('플래그가 없으면 경고색 없이 "신고 표시 없음"만 말한다(미신고 단정 금지)', async () => {
      prisma.infectionSurveillance.findMany.mockResolvedValue([row({})]);
      const [r] = await service.findAll();
      expect(r.kcdc).toEqual({ flagged: false, transmitted: false, label: '신고 표시 없음', note: null });
    });
  });
});
