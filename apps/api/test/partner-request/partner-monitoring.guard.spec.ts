import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PartnerRequestService } from '../../src/modules/partner-request/partner-request.service';
import { API_ACCESS_INSTRUMENTATION, errorRateOf } from '../../src/modules/partner-request/api-access-instrumentation';

/**
 * 🔴 가드 — **측정되지 않은 것을 "에러율 0%"라고 말하지 않는다**(W8 2026-08-14).
 *
 * `/admin/partner-monitoring` 은 `ApiAccessLog` 를 읽는데, 그 테이블에 **쓰는 코드가
 * 저장소에 없다**(운영 실측 0행). 종전 코드는 `total > 0 ? … : 0` 으로 항상 0 을 냈고,
 * 화면은 초록 0.0% 와 "알림 없음"을 영원히 보여줬다 — 연동이 전부 죽어도 똑같이 초록이다.
 */
describe('파트너 연동 모니터링 — 표본 부재를 0 으로 말하지 않는다', () => {
  let service: PartnerRequestService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      smartClient: { count: vi.fn().mockResolvedValue(4) },
      transferRecord: { count: vi.fn().mockResolvedValue(3) },
      organization: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', name: '연합의원', code: 'UN' }), findMany: vi.fn().mockResolvedValue([]) },
      apiAccessLog: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _avg: { responseTime: null } }),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    service = new PartnerRequestService(prisma);
  });

  it('계측이 배선되지 않았음을 화면이 읽을 수 있게 선언한다', async () => {
    const s: any = await service.getMonitoringStats();
    expect(s.measurement.measured).toBe(API_ACCESS_INSTRUMENTATION.wired);
    if (!API_ACCESS_INSTRUMENTATION.wired) {
      expect(s.measurement.note).toBeTruthy();  // 사람이 읽을 사유
      expect(s.measurement.hint).toBeTruthy();  // 어디에 붙일지
    }
  });

  it('🔴 미계측이면 호출 수·에러율·평균 응답이 0 이 아니라 null(산출 불가)', async () => {
    if (API_ACCESS_INSTRUMENTATION.wired) return; // 계측이 붙은 뒤에는 이 가드가 적용되지 않는다
    const s: any = await service.getMonitoringStats();
    expect(s.errorRate).toBeNull();
    expect(s.totalCalls).toBeNull();
    expect(s.todayCalls).toBeNull();
    expect(s.avgResponseTime).toBeNull();
    // 미계측 구간에서는 로그 테이블을 읽지도 않는다(0 을 만들 재료 자체를 만들지 않음)
    expect(prisma.apiAccessLog.count).not.toHaveBeenCalled();
  });

  it('실제로 측정되는 값은 그대로 낸다 — 활성 파트너 · 이번달 전원(하드코딩 0 봉합)', async () => {
    const s: any = await service.getMonitoringStats();
    expect(s.activePartners).toBe(4);
    expect(s.transfersThisMonth).toBe(3);
    expect(prisma.transferRecord.count).toHaveBeenCalled();
  });

  it('🔴 미계측이면 "알림 없음"이 아니라 감시 자체가 없음을 알린다', async () => {
    if (API_ACCESS_INSTRUMENTATION.wired) return;
    const a: any = await service.getAlerts();
    expect(a.alerts).toEqual([]);
    expect(a.measurement.measured).toBe(false);
    const l: any = await service.getOrgLogs('o1');
    expect(l.total).toBeNull(); // 0건이 아니라 '모른다'
    const m: any = await service.getOrgMonitoring('o1');
    expect(m.errorRate).toBeNull();
  });

  it('errorRate — 분모를 묻는다: 호출 0건도 0% 가 아니다', () => {
    expect(errorRateOf(null, null)).toBeNull();
    expect(errorRateOf(0, 0)).toBeNull();      // 표본 부재
    expect(errorRateOf(200, 3)).toBe(1.5);
  });
});
