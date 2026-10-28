import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ControlledSubstanceService } from '../../src/modules/controlled-substance/controlled-substance.service';

describe('ControlledSubstanceService', () => {
  let service: ControlledSubstanceService;
  let p: any;
  const mockLog = { id: 'cl-1', status: 'PRESCRIBED', prescribedBy: 'doc-1' };

  /** 관계 없는 uuid 컬럼(수행자·증인)을 이름으로 채우는 배치 조회 등 — 모든 모델을 mock 한다 */
  const model = (over: Record<string, unknown> = {}) => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    ...over,
  });

  beforeEach(() => {
    p = {
      controlledSubstanceLog: { findMany: vi.fn().mockResolvedValue([mockLog]), findUnique: vi.fn().mockResolvedValue(mockLog), create: vi.fn().mockResolvedValue(mockLog), update: vi.fn().mockResolvedValue(mockLog), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(5), groupBy: vi.fn().mockResolvedValue([]) },
      // 폐기 증인 검증(User.id) 기본값 — '유효한 재직 직원'
      user: model({ findUnique: vi.fn().mockResolvedValue({ id: 'nurse-2', isActive: true }) }),
      nimsReport: model(),
      controlledSubstanceStockTxn: model(),
      controlledSubstanceIncident: model(),
    };
    service = new ControlledSubstanceService(p);
  });

  it('prescribe', async () => { const r = await service.prescribe({ patientId: 'p-1', drugName: '모르핀', deaSchedule: 'II', quantity: 10, unit: 'mg', prescribedBy: 'doc-1' }); expect(r.id).toBe('cl-1'); });
  it('verify (원자 전이)', async () => { await service.verify('cl-1', 'pharm-1'); expect(p.controlledSubstanceLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cl-1', status: 'PRESCRIBED' } })); });
  it('dispense (원자 전이)', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'VERIFIED' });
    await service.dispense('cl-1', 'pharm-1');
    expect(p.controlledSubstanceLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cl-1', status: 'VERIFIED' } }));
  });
  it('[P1] 동시 조제 충돌(count 0) → Conflict', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'VERIFIED' });
    p.controlledSubstanceLog.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.dispense('cl-1', 'pharm-1')).rejects.toThrow();
  });
  it('조제 시 마약재고 자동 차감(약품코드 있으면 issueByDrug 호출)', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'VERIFIED', drugCode: 'M1', drugName: '모르핀', quantity: 3 });
    const stock = { issueByDrug: vi.fn().mockResolvedValue({ txn: { id: 't1' } }) };
    const svc = new ControlledSubstanceService(p, stock as any);
    await svc.dispense('cl-1', 'pharm-1');
    expect(stock.issueByDrug).toHaveBeenCalledWith('M1', 'PHARMACY', 3, 'pharm-1', 'cl-1');
  });
  it('재고 미등록/차감 실패해도 조제는 성공(best-effort)', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'VERIFIED', drugCode: 'M1', quantity: 3 });
    const stock = { issueByDrug: vi.fn().mockRejectedValue(new Error('재고 부족')) };
    const svc = new ControlledSubstanceService(p, stock as any);
    await expect(svc.dispense('cl-1', 'pharm-1')).resolves.toBeDefined();
  });
  it('약품코드 없으면 재고 차감 건너뜀', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'VERIFIED', drugCode: null });
    const stock = { issueByDrug: vi.fn() };
    const svc = new ControlledSubstanceService(p, stock as any);
    await svc.dispense('cl-1', 'pharm-1');
    expect(stock.issueByDrug).not.toHaveBeenCalled();
  });
  it('recordWaste (조제 상태·독립 증인)', async () => { p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'DISPENSED' }); await service.recordWaste('cl-1', '잔량 폐기', 'nurse-2', 'nurse-1'); expect(p.controlledSubstanceLog.updateMany).toHaveBeenCalled(); });
  it('[P0] 미조제(PRESCRIBED) 폐기 차단(은폐 방지)', async () => { p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'PRESCRIBED' }); await expect(service.recordWaste('cl-1', 'x', 'nurse-2', 'nurse-1')).rejects.toThrow(); });
  it('[P0] 폐기 증인=수행자 동일 차단', async () => { p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'DISPENSED' }); await expect(service.recordWaste('cl-1', 'x', 'nurse-1', 'nurse-1')).rejects.toThrow(); });
  it('prescribe stores prescriptionId link (CPOE 자동발행)', async () => {
    await service.prescribe({ patientId: 'p-1', prescriptionId: 'rx-1', drugName: '모르핀', deaSchedule: 'II', quantity: 2, unit: '앰플', prescribedBy: 'doc-1' });
    expect(p.controlledSubstanceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ prescriptionId: 'rx-1', status: 'PRESCRIBED' }) }),
    );
  });

  it('markDispensedByPrescription transitions linked log to DISPENSED + NIMS', async () => {
    p.controlledSubstanceLog.findFirst = vi.fn().mockResolvedValue({ ...mockLog, prescriptionId: 'rx-1', drugName: '모르핀', drugCode: 'M1', quantity: 2, unit: '앰플', narcoticType: null, patientId: 'p-1' });
    // 🔴 (2026-09-16 K2) 정본이 **같은 사건 중복 보고를 먼저 센다** — count 없는 목은 계약이 아니라 목을 검사한다
    p.nimsReport = { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) };
    const r = await service.markDispensedByPrescription('rx-1', 'pharm-1');
    expect(p.controlledSubstanceLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cl-1', status: 'PRESCRIBED' }, data: expect.objectContaining({ status: 'DISPENSED', dispensedBy: 'pharm-1' }) }),
    );
    expect(p.nimsReport.create).toHaveBeenCalled();
    expect(r).toBeDefined();
  });

  it('markDispensedByPrescription no-op when no linked ledger (일반약)', async () => {
    p.controlledSubstanceLog.findFirst = vi.fn().mockResolvedValue(null);
    const r = await service.markDispensedByPrescription('rx-plain');
    expect(r).toBeNull();
    expect(p.controlledSubstanceLog.updateMany).not.toHaveBeenCalled();
  });

  it('getLogs', async () => { await service.getLogs({}); expect(p.controlledSubstanceLog.findMany).toHaveBeenCalled(); });
  it('getStats', async () => { const r = await service.getStats(); expect(r).toBeDefined(); });
  it('getUnverified', async () => { await service.getUnverified(); expect(p.controlledSubstanceLog.findMany).toHaveBeenCalled(); });

  it('[W8] getLogs 는 items/total 봉투를 준다(화면이 배열로 읽어 항상 비어 있던 계약)', async () => {
    p.controlledSubstanceLog.count.mockResolvedValue(37);
    const r = await service.getLogs({ page: 2, limit: 20 });
    expect(r).toMatchObject({ total: 37, page: 2, limit: 20 });
    expect(Array.isArray(r.items)).toBe(true);
    expect(p.controlledSubstanceLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  it('[W8] 폐기 증인이 실재 직원이 아니면 거부(성명 문자열 차단)', async () => {
    p.controlledSubstanceLog.findUnique.mockResolvedValue({ ...mockLog, status: 'DISPENSED' });
    p.user.findUnique.mockResolvedValue(null);
    await expect(service.recordWaste('cl-1', '잔량', 'not-a-user', 'nurse-1')).rejects.toThrow();
  });

  describe('[W8] 일일 원장(마약류관리법 시행규칙 취급 내역)', () => {
    const day = '2026-08-14';
    const at = new Date('2026-08-14T10:00:00+09:00');
    const base = { drugName: '모르핀', deaSchedule: 'II', narcoticType: '마약', unit: '앰플' };

    it('로컬(KST) 달력 날짜로 집계하고 그 날짜를 그대로 돌려준다', async () => {
      p.controlledSubstanceLog.findMany.mockResolvedValue([]);
      const r = await service.getDailyLedger(day);
      expect(r.date).toBe(day);
      expect(r.rows).toEqual([]);
      // UTC 자정이 아니라 로컬 자정 구간을 물어야 한다
      const where = p.controlledSubstanceLog.findMany.mock.calls[0][0].where;
      expect(where.OR[0].prescribedAt.gte.getHours()).toBe(0);
    });

    it('[P1] 폐기량 미기재가 섞이면 잔량은 0 이 아니라 null(산출 불가)+사유 note', async () => {
      p.controlledSubstanceLog.findMany.mockResolvedValue([
        { ...base, quantity: 2, administeredQty: null, wastedQty: null, status: 'WASTED', prescribedAt: at, dispensedAt: at, administeredAt: null },
      ]);
      const r = await service.getDailyLedger(day);
      expect(r.rows[0].remaining).toBeNull();
      expect(r.rows[0].wastedQtyUnknown).toBe(1);
      expect(r.rows[0].notes.join(' ')).toContain('폐기량 미기재');
    });

    it('투여량 미기재는 불출량으로 집계하되 그 사실을 note 로 밝힌다', async () => {
      p.controlledSubstanceLog.findMany.mockResolvedValue([
        { ...base, quantity: 1, administeredQty: null, wastedQty: null, status: 'ADMINISTERED', prescribedAt: at, dispensedAt: at, administeredAt: at },
      ]);
      const r = await service.getDailyLedger(day);
      expect(r.rows[0].administered).toBe(1);
      expect(r.rows[0].assumedFullDose).toBe(1);
      expect(r.rows[0].notes.join(' ')).toContain('투여량 미기재');
    });

    it('합계는 Decimal 누적 — 0.1+0.2 부동소수점 잔차가 잔량에 섞이지 않는다', async () => {
      p.controlledSubstanceLog.findMany.mockResolvedValue([
        { ...base, quantity: 0.1, administeredQty: null, wastedQty: null, status: 'DISPENSED', prescribedAt: at, dispensedAt: at, administeredAt: null },
        { ...base, quantity: 0.2, administeredQty: null, wastedQty: null, status: 'DISPENSED', prescribedAt: at, dispensedAt: at, administeredAt: null },
      ]);
      const r = await service.getDailyLedger(day);
      expect(r.rows[0].dispensed).toBe(0.3);
      expect(r.rows[0].remaining).toBe(0.3);
    });

    it('날짜 형식이 틀리면 조용히 오늘로 넘어가지 않고 거부한다', async () => {
      await expect(service.getDailyLedger('2026-13-99')).rejects.toThrow();
    });
  });

  describe('[W8] NIMS 취급보고 — 전송하지 않았으면 전송했다고 적지 않는다', () => {
    const row = { id: 'n1', reportType: 'DISPENSE', status: 'PENDING', drugName: '모르핀', drugCode: 'M1', narcoticType: '마약', quantity: 1, unit: '앰플', eventAt: new Date('2026-08-14T01:00:00Z'), nimsRefNo: null, submittedAt: null };

    it('[P16] 배치파일 생성은 제출이 아니다 — LOCAL_RECORDED · submittedAt=null · 원내 배치번호', async () => {
      p.nimsReport.findMany.mockResolvedValue([row]);
      const f = await service.buildNimsBatch(undefined, 'csv', 'u1');
      expect(f.transmitted).toBe(false);
      expect(f.count).toBe(1);
      expect(f.batchNo.startsWith('LOCAL-NIMS-')).toBe(true);
      expect(p.nimsReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'LOCAL_RECORDED', submittedAt: null }),
      }));
    });

    it('미전송 건은 다음 배치에 다시 담긴다(영구 누락 금지)', async () => {
      p.nimsReport.findMany.mockResolvedValue([{ ...row, status: 'LOCAL_RECORDED', nimsRefNo: 'LOCAL-NIMS-20260814120000' }]);
      const f = await service.buildNimsBatch(undefined, 'csv');
      expect(f.count).toBe(1);
    });

    it('수기 접수번호가 기록된 건(도달 근거)은 다시 담지 않는다', async () => {
      p.nimsReport.findMany.mockResolvedValue([{ ...row, status: 'ACK', nimsRefNo: '2026-000123', submittedAt: new Date() }]);
      const f = await service.buildNimsBatch(undefined, 'csv');
      expect(f.count).toBe(0);
    });

    it('건별 전송 시도도 SUBMITTED 를 위조하지 않는다', async () => {
      p.nimsReport.findUnique.mockResolvedValue(row);
      p.nimsReport.update.mockResolvedValue({ ...row, status: 'LOCAL_RECORDED', nimsRefNo: 'LOCAL-NIMS-X', submittedAt: null });
      const r = await service.submitNimsReport('n1', 'u1');
      expect(p.nimsReport.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'LOCAL_RECORDED', submittedAt: null }),
      }));
      expect(r.transmission.transmitted).toBe(false);
    });

    it('원내 배치번호를 접수번호로 받지 않는다', async () => {
      await expect(service.recordManualNimsAck({ id: 'n1' }, { nimsRefNo: 'LOCAL-NIMS-20260814' })).rejects.toThrow();
      await expect(service.recordManualNimsAck({ id: 'n1' }, { nimsRefNo: 'STUB-1' })).rejects.toThrow();
    });

    it('수기 접수번호를 기록하면 ACK+접수시각이 남는다(도달의 유일한 근거)', async () => {
      p.nimsReport.findMany.mockResolvedValue([{ ...row, id: 'n1' }]);
      const r = await service.recordManualNimsAck({ batchNo: 'LOCAL-NIMS-1' }, { nimsRefNo: '2026-000123' }, 'u1');
      expect(r.updated).toBe(1);
      expect(p.nimsReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ACK', nimsRefNo: '2026-000123' }),
      }));
    });

    it('큐는 건별 전송 여부와 채널 고지를 함께 준다', async () => {
      p.nimsReport.findMany.mockResolvedValue([row, { ...row, id: 'n2', status: 'SUBMITTED', nimsRefNo: 'NIMS-1755', submittedAt: new Date() }]);
      const q = await service.getNimsQueue();
      expect(q.implemented).toBe(false);
      expect(q.counts).toMatchObject({ total: 2, transmitted: 0, notTransmitted: 2 });
      // 연동이 없던 시절 찍힌 레거시 번호는 '전송 근거 없음'으로 읽는다(저장값은 변조하지 않는다)
      expect(q.items[1].transmission.state).toBe('UNVERIFIED');
      expect(q.items[1].nimsRefNo).toBe('NIMS-1755');
    });

    it('[P17] 연동 미구축이면 통계도 SUBMITTED 를 미전송으로 센다', async () => {
      await service.getStats();
      const statuses = p.nimsReport.count.mock.calls.find((c: any[]) => c[0]?.where)?.[0].where.status.in;
      expect(statuses).toContain('SUBMITTED');
      expect(statuses).toContain('LOCAL_RECORDED');
    });
  });

  describe('[W8] 사고마약류(§12)', () => {
    it('발생일시가 쓰레기면 500 이 아니라 400', async () => {
      await expect(service.reportIncident({ incidentType: 'LOSS', drugName: '모르핀', quantity: 1, unit: '앰플', occurredAt: 'ㅁㄴㅇㄹ', description: 'x' }, 'u1')).rejects.toThrow();
    });
    it('미래 발생은 거부', async () => {
      // 🔴 `toISOString()` 은 UTC 다 — KST 00~09시에는 "내일"이 **오늘 날짜 문자열**로 나와
      //    이 가드가 하루 9시간 동안 헛돌았다(2026-08-19 08:29 KST 에 실측). 로컬 날짜로 만든다.
      const d = new Date(Date.now() + 86_400_000);
      const future = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await expect(service.reportIncident({ incidentType: 'LOSS', drugName: '모르핀', quantity: 1, unit: '앰플', occurredAt: future, description: 'x' }, 'u1')).rejects.toThrow();
    });
    it('관할 신고는 전송이 아니라 사실 기록(FILED)', async () => {
      p.controlledSubstanceIncident.findUnique.mockResolvedValue({ id: 'i1', status: 'REPORTED', description: '경위' });
      await service.fileIncident('i1', { filedRef: '접수-1' }, 'u1');
      expect(p.controlledSubstanceIncident.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'FILED', filedAt: expect.any(Date) }),
      }));
    });
  });
});
