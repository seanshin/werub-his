import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

/**
 * 위급값 폐루프 게이트 회귀 — 담당의 미확인(PENDING CriticalValueAlert) 위급값은
 * 환자 포털/모바일에서 수치를 가리고 "담당의 확인 중"으로 표기(ACKNOWLEDGED 시 정상).
 * 근거: 위급값은 담당의 확인 폐루프(미확인 3단 상향)인데 환자가 먼저 수치 인지하는 역전 차단.
 */
function makeSvc(
  alerts: Array<{ labResultId: string; testName: string }>,
  items?: Array<Record<string, unknown>>,
  checkupVisits: unknown[] = [],
) {
  const prisma: any = {
    labResult: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'lr1', completedAt: new Date('2026-07-29T00:00:00Z'), notes: 'CBC',
          // 의사가 결과를 확인한 결과 — 판정 공개(2026-10-20 결정 portal.labResultRelease). 확인 전 판정 비움은 portal-p3-disclosure 가 본다
          order: { acknowledgedAt: new Date('2026-07-29T01:00:00Z') },
          items: items ?? [
            // 🔴 HIS 가 실제로 내는 위급 flag 는 referenceRange.computeFlag 산출 **HH/LL** 이다.
            //    (종전 이 스펙은 'CRITICAL' 만 검증해, 운영에서 한 번도 발동하지 않는 마스킹을
            //     "동작한다"고 계약으로 굳혀뒀다 — W9 2026-08-14 정본 갱신)
            { testName: 'K', value: '6.9', unit: 'mmol/L', normalMin: '3.5', normalMax: '5.1', flag: 'HH' },
            { testName: 'Na', value: '140', unit: 'mmol/L', normalMin: '135', normalMax: '145', flag: '' },
          ],
        },
      ]),
    },
    checkupVisit: { findMany: vi.fn().mockResolvedValue(checkupVisits) },
    criticalValueAlert: { findMany: vi.fn().mockResolvedValue(alerts) },
  };
  const svc = new PortalService(prisma as never, null as never, null as never, null as never, null as never, null as never, null as never) as any;
  return svc;
}

describe('포털 위급값 폐루프 게이트', () => {
  it('미확인(PENDING) 위급값은 수치를 가리고 "담당의 확인 중"으로 표기', async () => {
    const svc = makeSvc([{ labResultId: 'lr1', testName: 'K' }]);
    const res = await svc.getLabResults('p1');
    const lab = res.find((r: any) => r.id === 'lr1');
    const k = lab.items.find((i: any) => i.name === 'K');
    const na = lab.items.find((i: any) => i.name === 'Na');
    expect(k.value).toBe('담당의 확인 중');
    expect(k.unit).toBe('');
    expect(k.flag).toBe('HH'); // 위급 표시는 유지(수치만 마스킹) — HH 를 H 로 격하하지 않는다
    expect(k.pendingReview).toBe(true);
    // 위급 아닌 항목은 그대로
    expect(na.value).toBe('140');
    expect(na.pendingReview).toBeUndefined();
  });

  // 🔴 역검증 — 종전 구현(`it.flag === 'CRITICAL'`)이었다면 아래 3건은 전부 실패한다.
  it.each(['HH', 'LL', 'AA'])('HIS 정본 위급 flag %s 도 마스킹된다(종전 CRITICAL 문자열 비교로는 새어나갔다)', async (flag) => {
    const svc = makeSvc([{ labResultId: 'lr1', testName: 'K' }], [
      { testName: 'K', value: '6.9', unit: 'mmol/L', normalMin: '3.5', normalMax: '5.1', flag },
    ]);
    const k = (await svc.getLabResults('p1'))[0].items[0];
    expect(k.value).toBe('담당의 확인 중');
    expect(k.pendingReview).toBe(true);
  });

  it('이상(H/L)일 뿐 위급이 아니면 마스킹하지 않는다 — 과잉 마스킹 방지', async () => {
    const svc = makeSvc([{ labResultId: 'lr1', testName: 'K' }], [
      { testName: 'K', value: '5.4', unit: 'mmol/L', normalMin: '3.5', normalMax: '5.1', flag: 'H' },
    ]);
    const k = (await svc.getLabResults('p1'))[0].items[0];
    expect(k.value).toBe('5.4');
    expect(k.pendingReview).toBeUndefined();
  });

  it('검진 결과의 finding 은 방향을 모른다 — ABNORMAL 을 "HIGH"(높음)로 단정하지 않는다', async () => {
    // 🔴 종전: finding==='ABNORMAL' → flag 'HIGH'. HDL 67(높아서 이상)과 Hb 8(낮아서 이상)이
    //    똑같이 "HIGH" 로 환자에게 나갔다. 방향을 모르면 정성 이상('A')으로만 말한다.
    const svc = makeSvc([], [], [{
      id: 'cv1', checkedInAt: new Date('2026-03-02T00:00:00Z'), program: { name: '종합검진' },
      items: [
        { testName: 'HDL', value: '67', unit: 'mg/dL', finding: 'ABNORMAL', completedAt: new Date('2026-03-02T00:00:00Z') },
        { testName: 'K', value: '7.2', unit: 'mmol/L', finding: 'CRITICAL', completedAt: new Date('2026-03-02T00:00:00Z') },
        { testName: 'Na', value: '140', unit: 'mmol/L', finding: 'NORMAL', completedAt: new Date('2026-03-02T00:00:00Z') },
      ],
    }]);
    const items = (await svc.getLabResults('p1'))[0].items;
    expect(items.find((i: any) => i.name === 'HDL').flag).toBe('A');   // 'HIGH' 가 아니다
    expect(items.find((i: any) => i.name === 'K').flag).toBe('AA');    // 위급은 위급으로
    expect(items.find((i: any) => i.name === 'Na').flag).toBe('N');
  });

  it('확인 완료(알림 없음/ACKNOWLEDGED)면 수치 그대로 노출', async () => {
    const svc = makeSvc([]); // PENDING 알림 없음
    const res = await svc.getLabResults('p1');
    const k = res.find((r: any) => r.id === 'lr1').items.find((i: any) => i.name === 'K');
    expect(k.value).toBe('6.9');
    expect(k.unit).toBe('mmol/L');
    expect(k.pendingReview).toBeUndefined();
  });
});
