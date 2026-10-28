import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PortalService } from '../../src/modules/portal/portal.service';
import { guardianSectionOf, guardianDenies } from '../../src/modules/portal/guardian-scope';

/**
 * 화면 실사용 점검 W9 — 환자 포털이 "아는 것과 모르는 것"을 뒤바꿔 말하지 않는지에 대한 가드.
 *
 * 여기 있는 단언은 전부 **운영 실측에서 실제로 어긋났던 것**이다(2026-08-14).
 * 각 it 은 종전 구현을 되돌리면 반드시 실패하도록 썼다(역검증).
 */

function svcWith(prisma: Record<string, unknown>) {
  return new PortalService(
    prisma as never, null as never, null as never, null as never,
    null as never, null as never, null as never,
  ) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
}

describe('W9 포털 — 복약 목록에 약이 아닌 오더가 섞이지 않는다', () => {
  /**
   * 🔴 Prescription 은 MEDICATION/LAB/IMAGING 오더를 한 테이블에 담는다.
   *    포털 복약 조회 5곳 + 리마인더 cron 이 type 을 걸지 않아, 운영 환자 P2026-0006 화면에
   *    LAB 8건·IMAGING 1건이 "활성 처방 9건 / 오늘 복용 일정 ☀️아침 식후 ×9" 로 떴다.
   *    같은 순간 /portal/medications(type 필터 있음)는 0건 — 한 환자가 같은 앱에서
   *    "복용약 9종"과 "복용약 없음"을 동시에 봤다(P12 정본이 둘).
   */
  const captured: Record<string, unknown>[] = [];
  const prisma = {
    prescription: {
      findMany: vi.fn().mockImplementation((args: Record<string, unknown>) => {
        captured.push(args.where as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    },
    medicationCheckLog: { findMany: vi.fn().mockResolvedValue([]) },
    preVisitVitals: { findFirst: vi.fn().mockResolvedValue(null) },
    problemList: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findFirst: vi.fn().mockResolvedValue(null) },
    allergy: { findMany: vi.fn().mockResolvedValue([]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
  };

  it('오늘의 복약 스케줄은 type=MEDICATION 만 조회한다', async () => {
    captured.length = 0;
    await svcWith(prisma).getMedicationSchedule('p1');
    expect(captured[0]).toMatchObject({ status: 'ACTIVE', type: 'MEDICATION' });
  });

  it('건강 대시보드의 활성 처방(activeRx)도 type=MEDICATION 만 센다', async () => {
    captured.length = 0;
    await svcWith(prisma).getHealthDashboard('p1');
    expect(captured[0]).toMatchObject({ status: 'ACTIVE', type: 'MEDICATION' });
  });
});

describe('W9 포털 — 측정한 적 없는 대기시간을 지어내지 않는다', () => {
  /**
   * 🔴 `getWaitingStatus` 의 상수 8분/명 날조는 W8 에서 걷어냈지만,
   *    여정 API(buildOutpatientStatus)에 `aheadCount * 8` 이 그대로 남아 있었다.
   *    같은 환자앱이 같은 대기를 두고 한 화면에선 '모름', 다른 화면에선 '약 N분'이라 말했다.
   */
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const prisma = {
    waitingQueue: { count: vi.fn().mockResolvedValue(7) },
    patientJourneyEvent: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    diagnosticTest: { findMany: vi.fn().mockResolvedValue([]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const queue = {
    id: 'q1', queueNumber: 12, status: 'WAITING', departmentName: '내과', doctorId: 'd1',
    checkedInAt: new Date(), calledAt: null, startedAt: null, doctor: null,
  };

  it('앞 대기 인원은 실제로 센 값을 내고, 예상 대기 분은 null(=모름)이다', async () => {
    const svc = svcWith(prisma) as unknown as { buildOutpatientStatus: (...a: unknown[]) => Promise<{ queue: Record<string, unknown> }> };
    const res = await svc.buildOutpatientStatus('p1', queue, today, new Date());
    expect(res.queue.aheadCount).toBe(7);       // 센 값은 낸다
    expect(res.queue.estimatedWaitMinutes).toBeNull(); // 종전 구현이면 56 이 나온다
  });
});

describe('W9 포털 — 퇴원 체크리스트가 모르는 것을 "안 했다"로 단정하지 않는다', () => {
  /**
   * 🔴 종전 `medicationReceived: false` / `satisfactionSurveyDone: false` 는 상수였다.
   *    퇴원약 수령 여부를 기록하는 정본이 HIS 에 없는데도 환자에게 "미완료"라고 말했고(P1),
   *    실제로 제출한 만족도 평가도 영원히 '안 함'이었다(P15/P16).
   */
  const admitDate = new Date('2026-08-01T00:00:00Z');
  const prisma = {
    appointment: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
    interimBilling: { findMany: vi.fn().mockResolvedValue([]) },
    satisfactionSurvey: { count: vi.fn().mockResolvedValue(1) },
  };

  it('정본이 없는 항목은 null(=모름), 실제로 센 항목은 사실대로', async () => {
    const svc = svcWith(prisma) as unknown as { buildPreDischargeStatus: (...a: unknown[]) => Promise<{ checklist: Record<string, unknown> }> };
    const res = await svc.buildPreDischargeStatus('p1', { id: 'a1', admitDate, bed: null }, { dischargeDate: null });
    expect(res.checklist.medicationReceived).toBeNull();     // 종전이면 false
    expect(res.checklist.satisfactionSurveyDone).toBe(true); // 종전이면 항상 false
    expect(res.checklist.billingSettled).toBeNull();         // 중간정산 0건 = 정산 여부 모름
  });
});

describe('W9 포털 — 검사 추이는 시간축을 갖는다', () => {
  /**
   * 🔴 종전 `getLabTrends` 는 orderBy 가 없어 배열 순서가 시간순이라는 보장이 없었고
   *    날짜도 내려주지 않았다. 화면은 마지막 원소를 '최근값'으로 삼아 ↑/↓ 를 그린다 —
   *    정렬이 뒤집히면 환자가 "좋아지고 있다"를 반대로 읽는다.
   */
  it('완료시각 오름차순으로 조회하고 각 점에 measuredAt 을 붙인다', async () => {
    const seen: Record<string, unknown>[] = [];
    const prisma = {
      labResultItem: {
        findMany: vi.fn().mockImplementation((args: Record<string, unknown>) => {
          seen.push(args);
          return Promise.resolve([
            { testName: 'AST', value: '44', unit: 'IU/L', flag: 'H', labResult: { id: 'l1', completedAt: new Date('2025-03-27T00:00:00Z'), order: { acknowledgedAt: null } } },
            { testName: 'AST', value: '22', unit: 'IU/L', flag: 'N', labResult: { id: 'l2', completedAt: new Date('2026-05-17T00:00:00Z'), order: { acknowledgedAt: null } } },
          ]);
        }),
      },
      criticalValueAlert: { findMany: vi.fn().mockResolvedValue([]) }, // 위급값 가림 — 추이도 결과 목록과 같은 규칙(2026-10-20)
    };
    const res = (await svcWith(prisma).getLabTrends('p1')) as Array<{ testName: string; data: Array<{ measuredAt: Date | null }> }>;
    expect(seen[0].orderBy).toEqual({ labResult: { completedAt: 'asc' } }); // 종전엔 orderBy 자체가 없었다
    expect(res[0].data[0].measuredAt).toBeInstanceOf(Date);
    expect(res[0].data[1].measuredAt).toBeInstanceOf(Date);
  });
});

describe('W9 포털 — 남의 것과 없는 것을 똑같이 거절한다(존재 여부 누설 금지)', () => {
  /**
   * 포털 상세 조회는 전부 `{ id, patientId }` 복합 조건으로 찾는다.
   * 타인 소유든 실존하지 않든 **같은 문구**로 거절해야 한다(있다/없다가 새면 그 자체가 정보다).
   */
  const notFound = { billing: { findFirst: vi.fn().mockResolvedValue(null) } };

  it('타인 영수증과 없는 영수증이 같은 메시지로 거절된다', async () => {
    const svc = svcWith({ ...notFound, patient: { findUnique: vi.fn() }, systemConfig: { findMany: vi.fn().mockResolvedValue([]) } });
    const other = await svc.getReceipt('p1', 'other-patients-billing').catch((e: Error) => e.message);
    const missing = await svc.getReceipt('p1', 'does-not-exist').catch((e: Error) => e.message);
    expect(other).toBe(missing);
    // patientId 가 where 에 반드시 들어간다(빠지면 IDOR)
    expect(notFound.billing.findFirst.mock.calls[0][0].where).toMatchObject({ patientId: 'p1' });
  });

  it('영수증 조회는 세션 환자에 바인딩된다 — 응답에 암호화 PID 필드가 없다', async () => {
    const prisma = {
      billing: { findFirst: vi.fn().mockResolvedValue({ id: 'b1', createdAt: new Date(), totalAmount: 1, insuranceCovered: 0, patientCopay: 1, paidAmount: 1, status: 'PAID', encounter: null }) },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '한', givenName: '지영', mrn: 'P1', dateOfBirth: new Date(), insuranceType: 'NHI' }) },
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'hospital.name', value: '병원' }]) },
    };
    const res = await svcWith(prisma).getReceipt('p1', 'b1');
    const body = JSON.stringify(res);
    // 정본 PATIENT_SENSITIVE_OMIT 대상 — 하나라도 실리면 저장형 노출
    for (const f of ['nationalId', 'nationalIdHash', '"ci"', 'passportNumber', 'alienRegistrationNo', 'insuranceNumber', 'incomeDecile']) {
      expect(body).not.toContain(f.replace(/"/g, ''));
    }
    expect(prisma.patient.findUnique.mock.calls[0][0].select.nationalId).toBeUndefined();
  });
});

describe('W9 포털 — 보호자 위임 범위를 우회하는 옆문이 없다', () => {
  /**
   * 🔴 가드의 SECTION_MAP 에 없는 경로는 범위 제어를 통째로 건너뛴다(section=undefined → 통과).
   *    `labs:false` 로 위임받은 보호자가 /portal/lab-results 에서는 403 을 받고도
   *    /portal/lab-trends · /portal/chronic-trend 로 같은 수치를 그대로 읽어갔다.
   */
  // 🔴 2026-09-02: 지도가 **두 가드에 각자** 있어 이 W9 봉합이 한쪽에만 반영돼 있었다
  //    → 정본 `portal/guardian-scope.ts` 하나. 여기서도 정본을 본다(사본을 검사하면 갈라진다).
  it.each([
    ['lab-trends', 'labs'],
    ['chronic-trend', 'labs'],
    ['chronic-observations', 'labs'],
    ['billing/annual-summary', 'billing'],
    ['medical-expenses', 'billing'],
  ])('%s 가 %s 범위로 등재돼 있다', (match, section) => {
    expect(guardianSectionOf(`/api/v1/portal/${match}`), `${match} 가 지도에 없다`).toBe(section);
  });

  it('🔴 지도에 있는 구획은 fail-closed 로 막힌다 — 키가 없으면 통과하지 않는다', () => {
    // 종전 `scope[section] === false` 는 키가 없는 imaging 을 한 번도 막지 못했다
    expect(guardianDenies({ labs: false }, '/api/v1/portal/lab-trends')).toBe(true);
    expect(guardianDenies({}, '/api/v1/portal/imaging/studies')).toBe(true);
  });
});

describe('W9 포털 — 복합 응답에서 위임 범위 밖 영역을 덜어낸다', () => {
  /**
   * health-dashboard·journey/status 는 검사·예약을 한 응답에 섞어 담아 단일 section 으로 가를 수 없다.
   * 🔴 종전엔 그래서 아무 제어도 받지 않았다.
   */
  const CTRL = readFileSync(resolve(__dirname, '../../src/modules/portal/portal.controller.ts'), 'utf8');

  it('health-dashboard 는 stripOutOfScope 를 거친다', () => {
    expect(CTRL).toMatch(/stripOutOfScope\(req, await this\.svc\.getHealthDashboard/);
    expect(CTRL).toMatch(/scope\.labs === false\) out\.recentLabs = \[\]/);
  });

  it('journey/status 도 품고 있는 healthDashboard 에서 범위 밖을 덜어낸다', () => {
    const seg = CTRL.slice(CTRL.indexOf("@Get('journey/status')"));
    expect(seg).toMatch(/req\.isGuardianAccess/);
    expect(seg).toMatch(/recentLabs: \[\]/);
  });

  it('본인 세션(위임 아님)은 아무것도 덜어내지 않는다 — 과잉 차단 방지', () => {
    expect(CTRL).toMatch(/if \(!dash \|\| !req\.isGuardianAccess\) return dash;/);
  });
});
