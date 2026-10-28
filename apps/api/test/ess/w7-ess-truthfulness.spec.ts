import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

/**
 * W7 화면 실사용 점검 — 내 행정(ESS)·급여명세.
 * 화면이 '아는 것/모르는 것'을 뒤바꿔 말하지 않는지, 하지 않은 인증을 적지 않는지,
 * 정본이 둘일 때 어느 쪽을 쓰는지 응답이 스스로 밝히는지를 계약으로 고정한다.
 */
describe('W7 ESS — 근태 인증수단 · 연차 정본 · 급여명세 사실성', () => {
  let service: EssService;
  let mockPrisma: any;
  let outbox: any;

  beforeEach(() => {
    outbox = { enqueue: vi.fn() };
    mockPrisma = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'st-1', employeeNumber: 'EMP-2020-001', clinicUserId: null }) },
      // 🔴 (2026-09-16 J4) clock() 은 create 전에 **같은 분 중복**을 findFirst 로 본다 — 목이 그 모양을 갖지 않으면
      //    테스트가 정본이 실제로 하는 일과 다른 것을 시험한다(이 저장소가 반복해 당한 함정).
      attendanceRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ar-1', at: new Date('2026-08-14T09:00:00Z'), ...data })),
      },
      leaveBalance: { findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { days: 2 } }),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'lr-1', status: 'REQUESTED', ...data })),
        update: vi.fn().mockResolvedValue({}),
      },
      eApprovalRelay: { create: vi.fn().mockResolvedValue({ id: 'relay-1', refId: 'REF-1' }), update: vi.fn().mockResolvedValue({}) },
      holidayCalendar: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };
    const configRuntime = { get: vi.fn(async () => null) };
    service = new EssService(mockPrisma, outbox, { get: vi.fn() } as any, configRuntime as any);
    (service as any).audit = vi.fn();
  });

  // ── ② 하지 않은 인증을 근태(법정 기록)에 적지 않는다 (P16) ──
  describe('근태 인증수단 — 클라이언트 선언 불신', () => {
    const methodOfCreate = () => mockPrisma.attendanceRecord.create.mock.calls[0][0].data.method;

    it("🔴 화면이 method:'BIO' 를 보내도 BIO 로 기록하지 않는다(생체 절차가 없으므로 WEB)", async () => {
      await service.clockFromClient('u-1', 'CLOCK_IN', 'BIO');
      expect(methodOfCreate()).toBe('WEB');
    });

    it('method 미지정 = 화면 버튼(WEB)', async () => {
      await service.clockFromClient('u-1', 'CLOCK_OUT');
      expect(methodOfCreate()).toBe('WEB');
    });

    it('서버가 확인할 수 없는 임의 수단(PIN·MANUAL·AUTO)도 body 로는 채택하지 않는다', async () => {
      for (const m of ['PIN', 'MANUAL', 'AUTO', 'FACE']) {
        mockPrisma.attendanceRecord.create.mockClear();
        await service.clockFromClient('u-1', 'CLOCK_IN', m);
        expect(methodOfCreate()).toBe('WEB');
      }
    });

    it('QR 은 화면이 선언할 수 있는 채널이라 보존', async () => {
      await service.clockFromClient('u-1', 'CLOCK_IN', 'QR');
      expect(methodOfCreate()).toBe('QR');
    });

    it('서버 내부 경로(단말 PIN 등)는 호출자가 적은 수단을 그대로 기록', async () => {
      await service.clock('u-1', 'CLOCK_IN', 'PIN');
      expect(methodOfCreate()).toBe('PIN');
    });

    it('ERP 아웃박스로 나가는 근태 이벤트도 같은 수단(WEB)을 싣는다', async () => {
      await service.clockFromClient('u-1', 'CLOCK_IN', 'BIO');
      expect(outbox.enqueue.mock.calls[0][3].method).toBe('WEB');
    });

    it('기본값이 BIO 로 되돌아오지 않는다(재유입 차단)', async () => {
      await service.clock('u-1', 'CLOCK_IN');
      expect(methodOfCreate()).not.toBe('BIO');
    });
  });

  // ── ① 연차 잔여 — 정본이 둘(P12) ──
  describe('연차 잔여 — 출처를 밝히고, 검증은 최소 잔여로', () => {
    const erpAnnual = (over: any = {}) => ({ items: [{ type: 'ANNUAL', granted: 17, used: 0, remaining: 17, ...over }] });
    const hisAnnual = [{ type: 'ANNUAL', granted: 15, used: 3 }];

    it('🔴 ERP 17 · HIS 원장 12 가 함께 나오고, 표시 정본은 ERP 라고 말한다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual(), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue(hisAnnual);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.source).toBe('ERP');
      expect(annual.remaining).toBe(17);
      expect(annual.alternates).toEqual([{ source: 'HIS_LEDGER', type: 'ANNUAL', granted: 15, used: 3, remaining: 12 }]);
      expect(annual.discrepancy).toBe(true);
    });

    it('🔴 초과검증 기준은 최소 잔여(12·HIS 원장) — 17 기준이면 12일 초과 신청이 통과한다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual(), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue(hisAnnual);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.enforceRemaining).toBe(12);
      expect(annual.enforceSource).toBe('HIS_LEDGER');
    });

    it('승인된 연차 신청 합계를 교차확인 값으로 함께 낸다(원장 used 와 어긋나도 지우지 않음)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual(), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue(hisAnnual);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.approvedRequestDays).toBe(2);
    });

    it('ERP 만 있으면 ERP 가 표시·집행 정본(불일치 없음)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual(), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue([]);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.source).toBe('ERP');
      expect(annual.discrepancy).toBe(false);
      expect(annual.enforceRemaining).toBe(17);
    });

    it('ERP 장애면 HIS 원장이 표시 정본이 되고, 그렇게 말한다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: null, reason: 'UNREACHABLE', status: null });
      mockPrisma.leaveBalance.findMany.mockResolvedValue(hisAnnual);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.source).toBe('HIS_LEDGER');
      expect(annual.remaining).toBe(12);
      expect(annual.enforceRemaining).toBe(12);
    });

    it("granted=0 은 '부여 정보 미등록' — 진짜 잔여 0과 구분해 집행 기준에서 뺀다", async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual({ granted: 0, used: 0, remaining: 0 }), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue(hisAnnual);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.enforceRemaining).toBe(12);
      expect(annual.enforceSource).toBe('HIS_LEDGER');
    });

    it('두 출처 모두 부여 정보가 없으면 enforceRemaining=null(잔여 0이라 단정하지 않음)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: erpAnnual({ granted: 0, used: 0, remaining: 0 }), reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue([{ type: 'ANNUAL', granted: 0, used: 0 }]);
      const [annual] = await service.leaveBalance('u-1', 2026);
      expect(annual.enforceRemaining).toBeNull();
    });
  });

  describe('휴가 신청 초과검증', () => {
    beforeEach(() => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { items: [{ type: 'ANNUAL', granted: 17, used: 0, remaining: 17 }] }, reason: 'OK', status: 200 });
      mockPrisma.leaveBalance.findMany.mockResolvedValue([{ type: 'ANNUAL', granted: 15, used: 3 }]);
    });
    const dto = (days: number) => ({ type: 'ANNUAL', fromDate: '2026-09-01', toDate: '2026-09-30', days, reason: '휴가' });

    it('🔴 최소 잔여(12일)를 넘는 신청은 차단하고, 어느 기준인지 사유에 적는다', async () => {
      (service as any).businessDays = vi.fn().mockResolvedValue(13);
      await expect(service.requestLeave('u-1', dto(13))).rejects.toThrow(/12일.*HIS 연차원장 기준.*초과/);
    });

    it('최소 잔여 이내면 접수하되, 출처 불일치를 경고로 되비친다', async () => {
      (service as any).businessDays = vi.fn().mockResolvedValue(12);
      const r: any = await service.requestLeave('u-1', dto(12));
      expect(r.warning).toMatch(/출처마다 다릅니다/);
      expect(r.warning).toMatch(/12일 기준/);
    });
  });

  // ── ③ 급여명세 — 장애 / 자료없음 / 미발행 / 확정 을 갈라 말한다 ──
  describe('급여명세 — 미발행을 0원이라 말하지 않는다', () => {
    it('🔴 미발행(issued:false)은 issued=false 로 명시된다(금액 단언 금지의 근거)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { employeeNumber: 'EMP-2020-001', period: '202608', issued: false }, reason: 'OK', status: 200 });
      const r: any = await service.getPayslip('u-1', '202608');
      expect(r.available).toBe(true);
      expect(r.issued).toBe(false);
      expect(r.payslip.net).toBeUndefined(); // 0 이 아니라 '없음'
    });

    it('🔴 ERP 장애는 미발행과 다른 사실 — reason 을 보존한다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: null, reason: 'UNREACHABLE', status: null });
      const r: any = await service.getPayslip('u-1', '202608');
      expect(r).toMatchObject({ available: false, reason: 'ERP_UNAVAILABLE', requestedPeriod: '202608' });
    });

    // 🔴 외부 점검 — 미설정·인증거부·상류오류·도달실패가 전부 `null` 한 가지였다.
    //    화면이 "ERP 미연결"과 "인증 실패"를 구분할 수 없으면 담당자는 엉뚱한 것을 확인하러 간다.
    it('🔴 실패 사유를 갈라 말한다 — 인증 거부와 미설정은 다른 사실이다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: null, reason: 'UNAUTHORIZED', status: 403 });
      const denied: any = await service.getPayslip('u-1', '202608');
      expect(denied).toMatchObject({ available: false, failure: 'UNAUTHORIZED', upstreamStatus: 403 });

      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: null, reason: 'NOT_CONFIGURED', status: null });
      const unset: any = await service.getPayslip('u-1', '202608');
      expect(unset).toMatchObject({ available: false, failure: 'NOT_CONFIGURED', upstreamStatus: null });
    });

    it('확정분은 issued=true 와 금액을 함께 낸다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { period: '202607', issued: true, gross: 2900478, net: 2470508 }, reason: 'OK', status: 200 });
      const r: any = await service.getPayslip('u-1', '202607');
      expect(r.issued).toBe(true);
      expect(r.periodMismatch).toBe(false);
    });

    it('ERP 가 다른 기간을 반환하면 periodMismatch 로 드러낸다(남의 달을 이 달로 라벨링 금지)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { period: '202607', issued: true, gross: 1, net: 1 }, reason: 'OK', status: 200 });
      const r: any = await service.getPayslip('u-1', '202608');
      expect(r.periodMismatch).toBe(true);
      expect(r.requestedPeriod).toBe('202608');
    });
  });

  // ── ④ 원천징수영수증 귀속연도 ──
  describe('원천징수영수증 — 응답 연도를 검증한다', () => {
    it('🔴 요청 2026 · 응답 2025 는 불일치로 표시된다(2025 발급분을 2026 귀속이라 말하지 않기 위해)', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { year: 2025, issued: true }, reason: 'OK', status: 200 });
      const r: any = await service.getWithholdingReceipt('u-1', '2026');
      expect(r).toMatchObject({ requestedYear: '2026', returnedYear: '2025', yearMismatch: true });
    });

    it('연도가 맞으면 불일치 아님', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: { year: 2026, issued: true }, reason: 'OK', status: 200 });
      const r: any = await service.getWithholdingReceipt('u-1', '2026');
      expect(r.yearMismatch).toBe(false);
    });

    it('ERP 장애는 발급 전과 구분된다', async () => {
      (service as any).erpGetDetailed = vi.fn().mockResolvedValue({ data: null, reason: 'UNREACHABLE', status: null });
      const r: any = await service.getWithholdingReceipt('u-1', '2026');
      expect(r).toMatchObject({ available: false, reason: 'ERP_UNAVAILABLE' });
    });
  });

  // ── 증명서 PDF 본인 스코프(fail-closed) ──
  describe('ERP 증명서 PDF — 본인 것인지 우리가 확인한다', () => {
    it('본인 목록에 없는 id 는 ERP 에 요청조차 하지 않는다', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
      (service as any).configRuntime = { get: vi.fn(async (k: string) => (k === 'erp.webhookUrl' ? 'https://erp.example' : null)) };
      (service as any).getErpCertificates = vi.fn().mockResolvedValue({ items: [{ id: 'cert-mine' }] });
      const r = await service.getErpCertificatePdf('u-1', 'cert-other');
      expect(r).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
