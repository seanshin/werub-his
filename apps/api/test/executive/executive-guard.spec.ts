import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ExecutiveService } from '../../src/modules/executive/executive.service';

/**
 * 경영 대시보드 **가드 스펙** — 화면 실사용 점검 W7(2026-08-14).
 *
 * 이 화면은 원장이 보고 숫자가 의사결정 문서로 유통된다. W7 지배 패턴은
 * **P17 근거 없이 안심시킴**(초록·0건·100% 가 정상 신호로 읽히는데 실은 표본 부재).
 * 아래 세 계약이 깨지면 그 결함이 그대로 돌아온다:
 *
 *   G1. 분모가 없으면 `rate`/`value` 는 **null(산출 불가)** — 0% 도 100% 도 아니다.
 *   G2. 날짜 버킷은 **로컬(KST) 달력** — `toISOString().slice(0,10)` 은 UTC 라 하루가 밀린다.
 *   G3. 진료과 축은 **실데이터**에서 만든다 — 하드코딩 목록 재유입 차단.
 */

const SERVICE_SRC = readFileSync(
  join(__dirname, '../../src/modules/executive/executive.service.ts'),
  'utf8',
);

/**
 * 구조 가드는 **코드만** 본다 — 주석에는 원래 결함을 그대로 인용해 두었으므로
 * 주석까지 훑으면 "고쳐 놓은 기록"이 위반으로 잡힌다(내가 남긴 설명이 가드를 깨뜨리는 P16 변형).
 */
const SERVICE_CODE = SERVICE_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\/])\/\/.*$/, '$1'))
  .join('\n');

function makePrisma() {
  return {
    billing: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn() },
    encounter: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
    bed: { count: vi.fn().mockResolvedValue(0) },
    admission: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    icuBed: { count: vi.fn().mockResolvedValue(0) },
    icuAdmission: { count: vi.fn().mockResolvedValue(0) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    staff: { groupBy: vi.fn().mockResolvedValue([]) },
    claim: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { claimedAmount: 0, reducedAmount: 0 }, _count: 0 }) },
    inventoryItem: { count: vi.fn().mockResolvedValue(0), fields: { safetyStock: 'safetyStock' } },
    equipment: { count: vi.fn().mockResolvedValue(0) },
    appointment: { count: vi.fn().mockResolvedValue(0) },
    waitingQueue: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    surgery: { count: vi.fn().mockResolvedValue(0) },
    safetyIncident: { findMany: vi.fn().mockResolvedValue([]) },
    infectionSurveillance: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}

describe('경영 대시보드 가드 — G1 분모 0 → null(산출 불가)', () => {
  let prisma: any;
  let service: ExecutiveService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExecutiveService(prisma);
  });

  it('데이터가 전무한 병원에서 KPI 가 "달성"으로 보이지 않는다', async () => {
    const kpis = await service.getKpi();

    for (const k of kpis) {
      if (k.n === 0) {
        // 표본이 없는데 초록(달성률 80% 이상)으로 읽히면 안 된다 — 그게 P17 이다.
        expect.soft(k.rate ?? 0, `${k.n}=0 인데 "${k.name}" 이 달성률 ${k.rate}% 로 보인다`).toBeLessThan(80);
      }
      // rate 가 null 이면 실적도 '-' 이거나 사유(note)가 있어야 한다 — 둘이 어긋나면 한 줄이 양방향으로 틀린다
      if (k.rate === null) {
        expect(k.actual === '-' || !!k.note, `"${k.name}" 은 rate=null 인데 사유도 '-'도 없다`).toBe(true);
      }
    }
  });

  it('비율의 분모가 사라지는 지표는 0/100 이 아니라 null 이다', async () => {
    const kpis = await service.getKpi();
    const byName = Object.fromEntries(kpis.map(k => [k.name, k]));

    // 청구 0건 → 삭감률 산출 불가(종전: parseFloat('0.0') <= 3 → 100 초록)
    expect(byName['청구 삭감률'].rate).toBeNull();
    // 퇴원 0건 → 평균 재원일수 산출 불가(종전: 0 = 빨강 미달)
    expect(byName['평균 재원일수'].rate).toBeNull();
    // 등록 병상 0 → 가동률 산출 불가
    expect(byName['병상 가동률'].rate).toBeNull();
    // 목표 없는 참고 지표 → 달성률 해당 없음
    expect(byName['입원환자'].rate).toBeNull();
  });

  it('overview 의 전주比·병상 가동률도 표본이 없으면 null 이고 표본 수를 동반한다', async () => {
    prisma.billing.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { patientCopay: 0, paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 });

    const ov = await service.getOverview();

    expect(ov.revenueChange).toBeNull();
    expect(ov.patientChange).toBeNull();
    expect(ov.bedOccupancy).toBeNull();
    // /journey-console `avgWait:{value,n}` 과 같은 규약 — 표본 수를 함께 낸다
    for (const m of [ov.revenueChangeMetric, ov.patientChangeMetric, ov.bedOccupancyPct, ov.revenue.accrued, ov.revenue.collected]) {
      expect(m).toHaveProperty('value');
      expect(m).toHaveProperty('n');
      if (m.n === 0) expect(m.value).toBeNull();
    }
  });

  it('청구 0건의 삭감률은 문자열 "0.0" 이 아니다', async () => {
    const claims = await service.getClaimsSummary();
    expect(claims.reductionRate).toBeNull();
    expect(claims.reductionRate).not.toBe('0.0');
  });

  it('조회 실패를 0/[] 으로 흡수하지 않는다', async () => {
    prisma.safetyIncident.findMany.mockRejectedValue(new Error('down'));
    prisma.infectionSurveillance.findMany.mockRejectedValue(new Error('down'));

    expect((await service.getSafety()).unavailable).toBe(true);
    expect((await service.getInfection()).unavailable).toBe(true);

    // 소스에 `.catch(() => 0)` / `.catch(() => [])` 가 다시 들어오지 못하게
    expect(SERVICE_CODE).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>\s*(0|\[\])\s*\)/);
  });
});

describe('경영 대시보드 가드 — G2 날짜 버킷은 로컬(KST) 달력', () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    // 로컬 달력과 UTC 달력이 갈리는 지역으로 고정(Node 는 런타임 TZ 변경을 반영한다)
    process.env.TZ = 'Asia/Seoul';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
    vi.useRealTimers();
  });

  /**
   * 로컬 날짜와 UTC 날짜가 **다른** 순간을 만든다.
   * - UTC 보다 앞선 지역(KST 등): 로컬 새벽 → UTC 는 전날
   * - UTC 보다 뒤진 지역: 로컬 밤 → UTC 는 다음날
   * - 정확히 UTC: 구분 불가(그 경우 아래 소스 가드가 회귀를 잡는다)
   */
  function discriminatingHour(): number | null {
    const off = new Date().getTimezoneOffset(); // KST = -540
    if (off < 0) return 1; // 로컬 01:00
    if (off > 0) return 23; // 로컬 23:00
    return null;
  }

  it('🔴 주간 매출: 로컬 오늘 새벽 청구가 오늘 버킷에 들어간다(UTC 버킷이면 어제로 새어나간다)', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);

    const now = new Date();
    const hour = discriminatingHour();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour ?? 12, 30);
    prisma.billing.findMany.mockResolvedValue([{ createdAt: at, totalAmount: 77_000 }]);

    const days = await service.getWeeklyRevenue();

    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(days[days.length - 1].date).toBe(todayKey);
    expect(days[days.length - 1].count, '오늘 버킷에서 청구가 사라졌다(UTC 버킷 의심)').toBe(1);
    expect(days[days.length - 1].revenue).toBe(77_000);

    if (hour != null) {
      // 이 순간의 UTC 날짜는 로컬 날짜와 다르다 — 즉 위 단언은 실제로 구분력이 있다
      expect(at.toISOString().slice(0, 10)).not.toBe(todayKey);
    }
  });

  it('🔴 진료과 주간 추이도 로컬 달력으로 버킷팅한다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);

    const now = new Date();
    const hour = discriminatingHour();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour ?? 12, 30);
    prisma.encounter.findMany.mockResolvedValue([{ createdAt: at, doctor: { department: '피부과' } }]);

    const { days } = await service.getClinicalWeeklyTrend();
    const last = days[days.length - 1];

    expect(last['피부과']).toBe(1);
    expect(last.total).toBe(1);
  });

  it('소스에 UTC 일자 버킷(`toISOString().slice(0,10)`)이 다시 들어오지 못한다', () => {
    expect(SERVICE_CODE).not.toMatch(/toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/);
    // 로컬 달력 정본을 쓰고 있는지
    expect(SERVICE_CODE).toMatch(/localDateKey/);
  });

  it('date-only 파싱은 `new Date(문자열)` 이 아니라 정본(day-range)을 쓴다', () => {
    // 🔴 `new Date('YYYY-MM-DD')` 는 TZ 무관 항상 UTC 자정이다
    expect(SERVICE_CODE).not.toMatch(/new Date\(\s*(dateStr|from|to)\s*\)/);
    expect(SERVICE_CODE).toMatch(/parseLocalDate|dayRange/);
  });
});

describe('경영 대시보드 가드 — G3 진료과 축은 실데이터에서', () => {
  it('🔴 하드코딩 진료과 목록이 소스에 재유입되지 않는다', () => {
    // 종전: const departments = ['내과','외과','소아청소년과','정형외과','산부인과','응급의학과']
    // 실측(7월 이후 153건) 중 이 6과는 5건뿐이었고 나머지 148건이 표에서 소멸했다.
    const KNOWN_DEPTS = ['내과', '외과', '소아청소년과', '정형외과', '산부인과', '응급의학과', '피부과', '성형외과', '재활의학과', '가정의학과', '안과'];
    const hits = KNOWN_DEPTS.filter((d) => new RegExp(`['"\`]${d}['"\`]`).test(SERVICE_CODE));
    expect(hits, `진료과 이름이 코드 리터럴로 박혀 있다: ${hits.join(', ')}`).toEqual([]);
  });

  it('🔴 진료과로 조회를 좁히지 않는다(좁힌 합계를 총량처럼 쓰면 안 된다)', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);
    prisma.encounter.findMany.mockResolvedValue([
      { createdAt: new Date(), doctor: { department: '가정의학과' } },
      { createdAt: new Date(), doctor: { department: null } },
    ]);

    const result = await service.getClinicalWeeklyTrend();

    const arg = prisma.encounter.findMany.mock.calls[0][0];
    expect(arg.where.doctor, 'where 에 진료과 필터가 있으면 나머지 과가 화면에서 사라진다').toBeUndefined();
    expect(result.departments).toEqual(expect.arrayContaining(['가정의학과', '부서 미지정']));
    expect(result.total).toBe(2);
  });

  it('표본이 없으면 폴백이 아니라 빈 목록이다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);

    const result = await service.getClinicalWeeklyTrend();

    expect(result.departments).toEqual([]);
    expect(result.days).toHaveLength(7); // 날짜 축은 유지(그날 0건은 사실)
    expect(result.total).toBe(0);
  });
});

describe('경영 대시보드 가드 — 같은 라벨은 같은 정의', () => {
  it('🔴 미수납: KPI 카드와 경영 알림이 같은 집합(전 기간 PENDING·PARTIAL·DEFERRED)을 센다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);
    prisma.billing.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 });
    // P4-1: 미수 카드는 행 단위(감면까지 뺀다)
    prisma.billing.findMany.mockResolvedValueOnce(Array.from({ length: 54 }, () => ({ patientCopay: 1000, discountAmount: 0, paidAmount: 0 })));
    prisma.billing.count.mockResolvedValue(54);

    const ov = await service.getOverview();
    const alerts = await service.getAlerts();

    const alertCount = alerts.find(a => a.type === 'billing')?.count;
    expect(ov.unpaidCount).toBe(alertCount);

    const cardWhere = prisma.billing.findMany.mock.calls[0][0].where;
    const alertWhere = prisma.billing.count.mock.calls[0][0].where;
    expect(alertWhere).toEqual(cardWhere); // 같은 라벨 → 같은 where
  });

  it('🔴 미완료 차트: 알림과 작성자 표가 같은 정의(DRAFT 24시간 경과)를 쓴다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);

    await service.getAlerts();
    await service.getDoctorStats();

    const alertWhere = prisma.encounter.count.mock.calls[0][0].where;
    const tableWhere = prisma.encounter.groupBy.mock.calls[2][0].where;
    expect(alertWhere.status).toBe('DRAFT');
    expect(tableWhere.status).toBe('DRAFT');
    // 컷오프 시각이 사실상 같은 순간(호출 간격 오차 허용)
    expect(Math.abs(alertWhere.createdAt.lt.getTime() - tableWhere.createdAt.lt.getTime())).toBeLessThan(5_000);
  });

  it('🔴 대기: 의료 품질 카드와 작성자별 대기환자가 같은 단계 집합을 본다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);

    await service.getClinicalOverview();
    await service.getDoctorStats();

    const cardWhere = prisma.waitingQueue.count.mock.calls[0][0].where;
    const tableWhere = prisma.waitingQueue.groupBy.mock.calls[0][0].where;
    expect(cardWhere.status).toEqual(tableWhere.status);
    expect(cardWhere.createdAt, '"현재 대기"에 접수일 필터가 있으면 어제부터 대기 중인 환자가 사라진다').toBeUndefined();
  });

  it('🔴 매출: 발생/수납확정 두 기준을 라벨과 함께 낸다(/journey-console 은 수납확정을 "매출"이라 부른다)', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);
    prisma.billing.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 900 }, _count: 3 })
      .mockResolvedValueOnce({ _sum: { paidAmount: 500 }, _count: 2 })
      .mockResolvedValueOnce({ _sum: { patientCopay: 0, paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 });

    const ov = await service.getOverview();

    expect(ov.revenue.accrued).toEqual({ value: 900, n: 3 });
    expect(ov.revenue.collected).toEqual({ value: 500, n: 2 });
    expect(ov.revenue.basis).toBeTruthy();
  });

  it('🔴 bedOccupancy 는 화면마다 단위가 달랐다 — 단위를 응답이 명시한다', async () => {
    const prisma = makePrisma();
    const service = new ExecutiveService(prisma);
    prisma.billing.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { patientCopay: 0, paidAmount: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 }, _count: 0 });
    prisma.bed.count.mockResolvedValueOnce(100).mockResolvedValueOnce(9);

    const ov = await service.getOverview();

    expect(ov.bedOccupancyUnit).toBe('percent');
    expect(ov.bedOccupancyPct.value).toBe(9); // 0.09(비율)가 아니다
  });
});
