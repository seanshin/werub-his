import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERP_READ_FAILURES } from '@hospital-run/shared';
import { EssService } from '../../src/modules/ess/ess.service';

/**
 * 🔴 R59(생태계 인바운드 §16) — **ERP 조회 실패를 한 가지로 말하지 않고, "없음"으로 번역하지 않는다.**
 *
 * 2026-09-23 수렴 전에 세 갈래가 한 파일에 겹쳐 있었다:
 *   (A) main — `erpGetDetailed` 가 사유 4종을 갈랐지만 **`getPayslip` 한 곳만** 그것을 썼고, web 은 `failure` 를 읽지 않았다.
 *   (B) 병행 갈래 — 나머지 8호출부를 고쳤으나 어휘가 `ERP_AUTH_FAILED` 등 자체 5종이라 그대로 얹으면 화면 분기가 영원히 안 탄다.
 *   → 어휘는 shared `ERP_READ_FAILURES`(NOT_CONFIGURED·UNAUTHORIZED·UPSTREAM_ERROR·UNREACHABLE·BAD_RESPONSE) 하나로 통일.
 *
 * 이 스펙이 고정하는 것:
 *   ① 사유가 갈린다 — 그리고 그 값이 shared 어휘 안에 있다(어휘가 둘이면 분기가 죽는다)
 *   ② **조회 실패를 '항목 0건'으로 번역하지 않는다** — 목록은 `items: null`(산출 불가)이지 `[]` 가 아니다
 *   ③ 못 물어본 것을 사실 주장(`registered:false`·"출처 일치")으로 말하지 않는다
 *   ④ **대조군** — 정상 경로는 종전과 똑같이 값을 낸다(실패 판정이 성공을 삼키지 않는다)
 *   ⑤ 화면이 서버가 가른 `failure` 를 실제로 읽는다(서버가 갈라도 화면이 뭉치면 같은 거짓말)
 */
describe('🔴 R59 ERP 조회 실패 3상태 — 실패를 "없음"으로 번역하지 않는다', () => {
  let service: EssService;
  let mockPrisma: any;
  let fetchMock: any;
  const cfg: Record<string, unknown> = {};

  beforeEach(() => {
    cfg['erp.webhookUrl'] = 'https://erp.example.test';
    cfg['erp.integrationKey'] = 'k';
    mockPrisma = {
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'st-1', employeeNumber: 'EMP-1', clinicUserId: null }) },
      leaveBalance: { findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: { aggregate: vi.fn().mockResolvedValue({ _sum: { days: 0 } }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const configRuntime = { get: vi.fn(async (k: string) => cfg[k] ?? null) };
    service = new EssService(mockPrisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (service as any).audit = vi.fn();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

  // ── ① 사유가 갈린다(어휘 = shared) ──
  it('erp.webhookUrl 미설정 = NOT_CONFIGURED (장애가 아니라 설정 작업이다 · ERP 를 부르지도 않는다)', async () => {
    delete cfg['erp.webhookUrl'];
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, reason: 'ERP_UNAVAILABLE', failure: 'NOT_CONFIGURED', upstreamStatus: null, requestedPeriod: '202608' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])('HTTP %i = UNAUTHORIZED (재시도로 풀리지 않는다 — 키 교체)', async (status) => {
    fetchMock.mockResolvedValue(bad(status));
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, failure: 'UNAUTHORIZED', upstreamStatus: status });
  });

  it('HTTP 500 = UPSTREAM_ERROR (인증 실패와 다른 사실)', async () => {
    fetchMock.mockResolvedValue(bad(500));
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, failure: 'UPSTREAM_ERROR', upstreamStatus: 500 });
  });

  it('네트워크·타임아웃 = UNREACHABLE (물어보지 못한 것이다)', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, failure: 'UNREACHABLE', upstreamStatus: null });
  });

  it('🔴 200 인데 JSON 이 아니면 BAD_RESPONSE — 종전에는 json() 예외가 UNREACHABLE(망)로 새어 "닿지 못했다"고 거짓말했다', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, failure: 'BAD_RESPONSE', upstreamStatus: 200 });
    expect(r.failure).not.toBe('UNREACHABLE');
  });

  it('200 인데 오브젝트가 아니면(배열·문자열) BAD_RESPONSE — 성공으로 읽지 않는다', async () => {
    fetchMock.mockResolvedValue(ok([]));
    const r: any = await service.getPayslip('u-1', '202608');
    expect(r).toMatchObject({ available: false, failure: 'BAD_RESPONSE' });
  });

  it('🔴 실어보내는 failure 값은 전부 shared 어휘 안에 있다(어휘가 둘이면 화면 분기가 죽는다)', async () => {
    const seen = new Set<string>();
    for (const setup of [
      () => { delete cfg['erp.webhookUrl']; },
      () => { fetchMock.mockResolvedValue(bad(403)); },
      () => { fetchMock.mockResolvedValue(bad(502)); },
      () => { fetchMock.mockRejectedValue(new Error('ECONNREFUSED')); },
      () => { fetchMock.mockResolvedValue(ok('nope')); },
    ]) {
      cfg['erp.webhookUrl'] = 'https://erp.example.test';
      setup();
      const r: any = await service.getPayslip('u-1', '202608');
      seen.add(r.failure);
      expect(ERP_READ_FAILURES as readonly string[]).toContain(r.failure);
    }
    expect([...seen].sort()).toEqual([...ERP_READ_FAILURES].sort()); // 어휘 5종이 전부 실제로 나온다(죽은 어휘 없음)
  });

  // ── ② 실패를 '항목 0건'으로 번역하지 않는다 ──
  it.each([
    ['getDeductionCodes', () => service.getDeductionCodes()],
    ['getDuties', () => service.getDuties('u-1')],
    ['getErpCertificates', () => service.getErpCertificates('u-1')],
  ])('%s — 조회 실패는 items:null(산출 불가) + 사유. 빈 배열이면 화면이 "0건"이라 말한다', async (_n, call) => {
    fetchMock.mockResolvedValue(bad(500));
    const r: any = await call();
    expect(r.items).toBeNull();
    expect(r).toMatchObject({ available: false, failure: 'UPSTREAM_ERROR', upstreamStatus: 500 });
  });

  it.each([
    ['getPerformance', () => service.getPerformance('u-1', '202608')],
    ['getSeverance', () => service.getSeverance('u-1')],
    ['getWithholdingReceipt', () => service.getWithholdingReceipt('u-1', '2025')],
  ])('%s — available:false 에 사유가 실린다("해당 없음"·"발급 전"으로 읽히지 않게)', async (_n, call) => {
    fetchMock.mockResolvedValue(bad(403));
    const r: any = await call();
    expect(r).toMatchObject({ available: false, reason: 'ERP_UNAVAILABLE', failure: 'UNAUTHORIZED', upstreamStatus: 403 });
  });

  // ── ③ 못 물어본 것을 사실 주장으로 말하지 않는다 ──
  it('getErpPayrollIdentity — "ERP 미등록(registered:false)"이라 단언하지 않는다(null)', async () => {
    fetchMock.mockResolvedValue(bad(500));
    const r: any = await service.getErpPayrollIdentity('u-1');
    expect(r.registered).toBeNull(); // false 는 "등록 안 돼 있다"는 사실 주장이다
    expect(r).toMatchObject({ unavailable: true, available: false, failure: 'UPSTREAM_ERROR' });
  });

  it('연차 잔여 — ERP 를 못 물어봤다는 사실이 meta(unavailableSources)에 실린다(HIS 원장 하나만 조용히 쓰지 않는다)', async () => {
    fetchMock.mockResolvedValue(bad(403));
    mockPrisma.leaveBalance.findMany.mockResolvedValue([{ type: 'ANNUAL', granted: 15, used: 3 }]);
    const r = await service.leaveBalanceDetailed('u-1', 2026);
    expect(r.items[0].source).toBe('HIS_LEDGER');
    expect(r.unavailableSources).toEqual([{ source: 'ERP', failure: 'UNAUTHORIZED', upstreamStatus: 403 }]);
  });

  it('🔴 연차 잔여 — HIS 원장도 비어 있으면 항목은 0개지만 실패는 남는다(항목에 실었다면 통째로 사라졌을 자리)', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    mockPrisma.leaveBalance.findMany.mockResolvedValue([]);
    const r = await service.leaveBalanceDetailed('u-1', 2026);
    expect(r.items).toEqual([]);
    expect(r.unavailableSources).toEqual([{ source: 'ERP', failure: 'UNREACHABLE', upstreamStatus: null }]);
  });

  it('증명서 PDF — 목록을 못 받으면(items:null) fail-closed 로 거부하고 ERP 에 PDF 를 요청하지 않는다', async () => {
    fetchMock.mockResolvedValue(bad(500));
    const r = await service.getErpCertificatePdf('u-1', 'cert-1');
    expect(r).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // 목록 조회 1회뿐 — PDF 요청 없음
  });

  // ── ④ 대조군 — 성공을 실패로 말하지 않는다 ──
  describe('대조군 — 정상 경로는 그대로 값을 낸다', () => {
    it('급여명세 200 = available:true · failure 없음', async () => {
      fetchMock.mockResolvedValue(ok({ period: '202608', issued: true, net: 2470508 }));
      const r: any = await service.getPayslip('u-1', '202608');
      expect(r.available).toBe(true);
      expect(r.failure).toBeUndefined();
      expect(r.payslip.net).toBe(2470508);
    });

    it('목록 200 = 항목이 그대로 오고 available:true · ERP 가 0건을 주면 [] (null 이 아니다 — 진짜 0건)', async () => {
      fetchMock.mockResolvedValue(ok({ items: [{ code: 'D1' }] }));
      const r: any = await service.getDeductionCodes();
      expect(r).toEqual({ items: [{ code: 'D1' }], available: true });
      fetchMock.mockResolvedValue(ok({ items: [] }));
      const z: any = await service.getErpCertificates('u-1');
      expect(z).toEqual({ items: [], available: true });
    });

    it('급여기초 200 = registered 가 ERP 값 그대로 · unavailable:false', async () => {
      fetchMock.mockResolvedValue(ok({ registered: false }));
      const r: any = await service.getErpPayrollIdentity('u-1');
      expect(r).toMatchObject({ registered: false, unavailable: false, available: true });
    });

    it('연차 잔여 200 = unavailableSources 가 빈 배열(전부 물어봤다)', async () => {
      fetchMock.mockResolvedValue(ok({ items: [{ type: 'ANNUAL', granted: 17, used: 0, remaining: 17 }] }));
      mockPrisma.leaveBalance.findMany.mockResolvedValue([]);
      const r = await service.leaveBalanceDetailed('u-1', 2026);
      expect(r.items[0].source).toBe('ERP');
      expect(r.unavailableSources).toEqual([]);
    });
  });
});

/**
 * 🔴 서버가 사유를 갈라 줘도 **화면이 읽지 않으면 같은 거짓말**이다 — 2026-09-23 실측: main 은 `failure` 를 실어보냈는데
 *    web 어디에서도 읽지 않았다(grep 0). ESS 화면 쪽 계약을 소스로 고정한다.
 *    (문자열이 파일 어딘가에 있는 것과 **분기가 그 값을 읽는 것**은 다르다 — 가드가 다른 이유로 통과한다.)
 */
describe('🔴 R59 ESS 화면 — 서버가 가른 failure 를 읽고, 실패를 "없음"으로 그리지 않는다', () => {
  const WEB = join(__dirname, '../../../web/src');
  const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8');
  const ESS = 'app/(main)/ess/_components';

  it('대조군 — 화면 파일을 실제로 읽었다', () => {
    for (const f of ['PayslipSection.tsx', 'PayExtrasSection.tsx', 'PayrollBasicsSection.tsx', 'EssContent.tsx', 'ErpFailureNote.tsx']) {
      expect(read(`${ESS}/${f}`).length, f).toBeGreaterThan(500);
    }
  });

  it('사유 문장 표(ErpFailureNote)가 shared 어휘 **전부**를 덮는다 — 하나 빠지면 그 사유는 "사유 미상"으로 뜬다', () => {
    const src = read(`${ESS}/ErpFailureNote.tsx`);
    for (const f of ERP_READ_FAILURES) expect(src, `${f} 문장이 없다`).toMatch(new RegExp(`^\\s*${f}:\\s*'`, 'm'));
    expect(src).toMatch(/isErpFailureRetryable/); // 설정·키 문제에 '다시 시도' 를 그리지 않는다
  });

  it('급여명세·원천징수 — `failure` 를 ErpFailureNote 로 넘긴다(한 문장 "연결하지 못해"로 뭉치지 않는다)', () => {
    const src = read(`${ESS}/PayslipSection.tsx`);
    expect(src).toContain('<ErpFailureNote failure={r?.failure}');
    expect(src).toContain('<ErpFailureNote failure={wh.data.failure}');
    expect(src).not.toContain('급여시스템(ERP)에 연결하지 못해');
  });

  it('퇴직금·성과급 — available:false 를 "대상 아님"·"해당 없음"으로 읽지 않는다', () => {
    const src = read(`${ESS}/PayExtrasSection.tsx`);
    expect(src).toContain("s?.available === false");
    expect(src).toContain("p?.available === false");
    expect(src).toContain('<ErpFailureNote failure={s?.failure}');
    expect(src).toContain('<ErpFailureNote failure={p?.failure}');
  });

  it('급여기초·공제구분 — unavailable 을 "미등록"으로, items:null 을 "선택지 없음"으로 그리지 않는다', () => {
    const src = read(`${ESS}/PayrollBasicsSection.tsx`);
    expect(src).toContain('<ErpFailureNote failure={erp.failure}');
    expect(src).toContain('<ErpFailureNote failure={codesQ.data?.failure}');
    expect(src).not.toMatch(/deduction-codes'\)\.then\(\(r\) => r\.data\?\.items \?\? \[\]\)/);
  });

  it('증명서·연차 — items:null 을 "발급된 증명서가 없습니다"로, meta.unavailableSources 를 침묵으로 접지 않는다', () => {
    const src = read(`${ESS}/EssContent.tsx`);
    expect(src).toContain('<ErpFailureNote failure={erpCerts.data?.failure}');
    expect(src).toContain('meta?.unavailableSources');
    expect(src).toContain('<ErpFailureNote key={u.source} failure={u.failure}');
    expect(src).not.toMatch(/erp-certificates'\)\.then\(\(r\) => r\.data\?\.items \?\? \[\]\)/);
  });

  it('직원 대시보드 근무표·급여 위젯 — ERP 실패를 `?? []`(근무 없음)·"확정 명세 없음"으로 접지 않는다', () => {
    const dash = read('app/staff/dashboard/page.tsx');
    expect(dash).toContain('<ErpFailureNote failure={duties.data?.failure}');
    expect(dash).not.toMatch(/duties\?from=.*\.then\(\(r\) => r\.data\?\.items \?\? \[\]\)/);
    const widget = read('app/(main)/dashboard/components/widgets/MyPaySnapshotWidget.tsx');
    expect(widget).toContain('slip.data?.available === false');
    expect(widget).toContain('failureText(slip.data?.failure)');
  });
});
