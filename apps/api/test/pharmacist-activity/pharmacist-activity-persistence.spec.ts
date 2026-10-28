import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PharmacistActivityService } from '../../src/modules/pharmacist-activity/pharmacist-activity.service';

/**
 * 약사 임상활동 — 인메모리 저장분 DB 영속화 가드(2026-08-18).
 *
 * 되살아나면 안 되는 것:
 *  ① 중재/TDM 이 `private interventions = [...mockInterventions]` 인메모리로 회귀(서버 재시작마다 소실)
 *  ② 죽은 mock 상수(가짜 KAERS 접수번호 포함)가 파일에 다시 등장
 *  ③ 월별 추이를 하드코딩 상수(42/38/55/48)로 날조
 *  ④ 처리된 중재가 0건인데 수락률을 "0%"로 단정(분모 부재 → null 이어야 한다)
 *  ⑤ 목표범위·실측농도 미입력을 0 으로 채움
 *  ⑥ 모르는 시각(sampledAt) 을 결과 입력 시 지어냄
 *  ⑦ 주체(pharmacistId/requestedBy)를 클라이언트 값으로 신뢰
 */

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INTV_ID = '33333333-3333-4333-8333-333333333333';
const TDM_ID = '44444444-4444-4444-8444-444444444444';
const RX_ID = '55555555-5555-4555-8555-555555555555';

function makeIntvRow(over: Record<string, unknown> = {}) {
  return {
    id: INTV_ID, pharmacistId: USER_ID, patientId: PATIENT_ID, prescriptionId: null,
    drugText: 'Vancomycin 1g IV', type: 'DOSE', reason: 'CrCl 35', suggestion: '750mg q12h',
    status: 'PENDING', doctorResponse: null, respondedBy: null, respondedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  };
}

function makeTdmRow(over: Record<string, unknown> = {}) {
  return {
    id: TDM_ID, patientId: PATIENT_ID, drugName: 'Vancomycin', indication: null,
    targetRangeMin: null, targetRangeMax: null, targetUnit: null, status: 'REQUESTED',
    resultLevel: null, resultInterpretation: null, doseRecommendation: null,
    requestedBy: USER_ID, requestedAt: new Date('2026-08-01T00:00:00Z'),
    sampledAt: null, resultedAt: null, reviewedBy: null, reviewedAt: null,
    ...over,
  };
}

describe('약사 임상활동 영속화 가드', () => {
  let service: PharmacistActivityService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      pharmacistIntervention: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      tdmRequest: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      adverseReactionReport: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      aspRequest: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        findUnique: vi.fn().mockResolvedValue({ id: PATIENT_ID }),
        findMany: vi.fn().mockResolvedValue([{ id: PATIENT_ID, familyName: '김', givenName: '환자' }]),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: USER_ID, familyName: '임', givenName: '약사' }]) },
      prescription: { findUnique: vi.fn().mockResolvedValue({ id: RX_ID, encounter: { patientId: PATIENT_ID } }) },
    };
    service = new PharmacistActivityService(prisma);
  });

  // ── ① 인메모리 회귀 차단 ──

  describe('① 저장소는 DB 다 — 인메모리 seed 회귀 차단', () => {
    it('DB 가 비면 중재 목록은 빈 목록이다(mock 3건이 나오면 회귀)', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue([]);
      const page = await service.getInterventions();
      expect(prisma.pharmacistIntervention.findMany).toHaveBeenCalled();
      expect(page.items).toEqual([]);
      expect(page.truncated).toBe(false);
    });

    it('DB 가 비면 TDM 목록도 빈 목록이다', async () => {
      const page = await service.getTdmRequests();
      expect(prisma.tdmRequest.findMany).toHaveBeenCalled();
      expect(page.items).toEqual([]);
    });

    it('중재 등록은 prisma.create 를 호출한다(메모리 배열 unshift 아님)', async () => {
      prisma.pharmacistIntervention.create.mockResolvedValue(makeIntvRow());
      await service.createIntervention({
        pharmacistId: USER_ID, patientId: PATIENT_ID, type: 'DOSE',
        reason: 'CrCl 35', suggestion: '750mg q12h',
      });
      expect(prisma.pharmacistIntervention.create).toHaveBeenCalledTimes(1);
    });

    it('TDM 등록은 prisma.create 를 호출한다', async () => {
      prisma.tdmRequest.create.mockResolvedValue(makeTdmRow());
      await service.createTdmRequest({ patientId: PATIENT_ID, drugName: 'Vancomycin', requestedBy: USER_ID });
      expect(prisma.tdmRequest.create).toHaveBeenCalledTimes(1);
    });

    it('새 인스턴스도 같은 DB 를 본다(프로세스 상태에 기대지 않는다)', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue([makeIntvRow()]);
      const other = new PharmacistActivityService(prisma);
      const page = await other.getInterventions();
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(INTV_ID);
    });
  });

  // ── ② 죽은 mock 상수 ──

  describe('② 죽은 mock 상수·가짜 접수번호는 파일에 없다', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/pharmacist-activity/pharmacist-activity.service.ts'),
      'utf8',
    );

    it.each(['mockInterventions', 'mockTdmRequests', 'mockAdrReports', 'mockAspRequests'])(
      '%s 상수가 없다',
      (name) => { expect(src).not.toContain(name); },
    );

    it('가짜 KAERS 접수번호가 소스에 없다', () => {
      expect(src).not.toMatch(/KAERS-\d{4}-\d{2}-\d{3}/);
    });

    it('인메모리 필드 선언이 없다', () => {
      expect(src).not.toMatch(/private\s+(interventions|tdmRequests|aspRequests)\s*=/);
    });
  });

  // ── ③ 월별 추이 ──

  describe('③ 월별 추이는 실제 행을 센다', () => {
    it('하드코딩 상수(42/38/55/48)가 아니라 실제 0 이다', async () => {
      const stats: any = await service.getStats();
      expect(stats.trend).toHaveLength(6);
      const nums = stats.trend.flatMap((r: any) => [r.interventions, r.tdm, r.adr, r.asp]);
      expect(nums.every((n: number) => n === 0)).toBe(true);
      expect(nums).not.toContain(42);
      expect(nums).not.toContain(55);
    });

    it('행이 있으면 그 달 버킷에 잡힌다', async () => {
      const now = new Date();
      prisma.pharmacistIntervention.findMany.mockResolvedValue([
        { createdAt: now }, { createdAt: now },
      ]);
      prisma.tdmRequest.findMany.mockResolvedValue([{ requestedAt: now }]);
      const stats: any = await service.getStats();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const row = stats.trend.find((r: any) => r.month === key);
      expect(row).toBeTruthy();
      expect(row.interventions).toBe(2);
      expect(row.tdm).toBe(1);
      expect(row.adr).toBe(0);
    });

    it('추이 월 라벨은 고정 상수(2026-01…)가 아니라 현재 기준 최근 6개월이다', async () => {
      const stats: any = await service.getStats();
      const now = new Date();
      const expected = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
      expect(stats.trend.map((r: any) => r.month)).toEqual(expected);
    });
  });

  // ── ④ 분모 부재 ──

  describe('④ 수락률 — 분모가 없으면 0% 가 아니라 산출 불가', () => {
    it('중재 0건이면 acceptanceRate=null · 사유를 준다', async () => {
      const stats: any = await service.getStats();
      expect(stats.interventions.total).toBe(0);
      expect(stats.interventions.acceptanceRate).toBeNull(); // 0 이면 회귀
      expect(stats.interventions.acceptanceRateNote).toBeTruthy();
    });

    it('전부 대기(PENDING)면 분모가 없으므로 여전히 null 이다', async () => {
      prisma.pharmacistIntervention.groupBy.mockImplementation(({ by }: any) =>
        by[0] === 'status' ? [{ status: 'PENDING', _count: { _all: 7 } }] : [],
      );
      const stats: any = await service.getStats();
      expect(stats.interventions.pending).toBe(7);
      expect(stats.interventions.decided).toBe(0);
      expect(stats.interventions.acceptanceRate).toBeNull();
    });

    it('처리된 중재가 있으면 처리 건수를 분모로 계산한다', async () => {
      prisma.pharmacistIntervention.groupBy.mockImplementation(({ by }: any) =>
        by[0] === 'status'
          ? [
              { status: 'ACCEPTED', _count: { _all: 3 } },
              { status: 'REJECTED', _count: { _all: 1 } },
              { status: 'PENDING', _count: { _all: 6 } },
            ]
          : [{ type: 'DOSE', _count: { _all: 10 } }],
      );
      const stats: any = await service.getStats();
      expect(stats.interventions.total).toBe(10);
      expect(stats.interventions.acceptanceRate).toBe(75); // 3/(3+1)
      expect(stats.interventions.acceptanceRateNote).toBeNull();
      expect(stats.interventions.byType.DOSE).toBe(10);
      expect(stats.interventions.byType.OTHER).toBe(0);
    });

    it('period 를 말하면 실제로 그 창을 집계한다(라벨만 바꾸지 않는다)', async () => {
      const stats: any = await service.getStats(undefined, '30d');
      expect(stats.period).toBe('30d');
      const where = prisma.pharmacistIntervention.groupBy.mock.calls[0][0].where;
      expect(where.createdAt?.gte).toBeInstanceOf(Date);
      expect(prisma.adverseReactionReport.count.mock.calls[0][0].where.createdAt?.gte).toBeInstanceOf(Date);
    });

    it('모르는 period 는 조용히 all 로 바꾸지 않고 거절한다', async () => {
      await expect(service.getStats(undefined, 'month')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── ⑤ 미입력을 0 으로 채우지 않는다 ──

  describe('⑤ 실측값 부재는 0 이 아니라 null', () => {
    it('목표범위 미입력은 null 로 저장된다(0 아님)', async () => {
      prisma.tdmRequest.create.mockResolvedValue(makeTdmRow());
      await service.createTdmRequest({
        patientId: PATIENT_ID, drugName: 'Digoxin', requestedBy: USER_ID,
        targetRangeMin: '', targetRangeMax: undefined, targetUnit: '  ',
      });
      const data = prisma.tdmRequest.create.mock.calls[0][0].data;
      expect(data.targetRangeMin).toBeUndefined();
      expect(data.targetRangeMax).toBeUndefined();
      expect(data.targetUnit).toBeUndefined();
      expect(data.targetRangeMin).not.toBe(0);
    });

    it('결과 미입력 TDM 의 resultLevel 은 null 로 나온다', async () => {
      prisma.tdmRequest.findMany.mockResolvedValue([makeTdmRow()]);
      const page = await service.getTdmRequests();
      expect(page.items[0].resultLevel).toBeNull();
      expect(page.items[0].targetRangeMin).toBeNull();
      expect(page.items[0].resultedAt).toBeNull();
    });

    it('실측 농도 없이 결과 입력을 시도하면 거절한다(0 으로 기록하지 않는다)', async () => {
      await expect(
        service.recordTdmResult(TDM_ID, { resultLevel: '' as never, resultInterpretation: '범위 내' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tdmRequest.updateMany).not.toHaveBeenCalled();
    });

    it('Decimal 실측값은 숫자로 변환된다', async () => {
      prisma.tdmRequest.findMany.mockResolvedValue([
        makeTdmRow({ resultLevel: '18.5', targetRangeMin: '15', targetRangeMax: '20', status: 'RESULTED' }),
      ]);
      const page = await service.getTdmRequests();
      expect(page.items[0].resultLevel).toBe(18.5);
      expect(page.items[0].targetRangeMin).toBe(15);
    });
  });

  // ── ⑥ 모르는 시각 ──

  describe('⑥ 모르는 시각은 원장에 박지 않는다', () => {
    it('결과 입력은 resultedAt 만 쓰고 sampledAt(채혈 시각)은 건드리지 않는다', async () => {
      prisma.tdmRequest.findUnique.mockResolvedValue(
        makeTdmRow({ status: 'RESULTED', resultLevel: '18.5', resultedAt: new Date() }),
      );
      await service.recordTdmResult(TDM_ID, { resultLevel: 18.5, resultInterpretation: '범위 내' });
      const data = prisma.tdmRequest.updateMany.mock.calls[0][0].data;
      expect(data.resultedAt).toBeInstanceOf(Date);
      expect('sampledAt' in data).toBe(false);
    });

    it('TDM 등록 시 채혈·결과 시각을 만들지 않는다', async () => {
      prisma.tdmRequest.create.mockResolvedValue(makeTdmRow());
      await service.createTdmRequest({ patientId: PATIENT_ID, drugName: 'Amikacin', requestedBy: USER_ID });
      const data = prisma.tdmRequest.create.mock.calls[0][0].data;
      expect('sampledAt' in data).toBe(false);
      expect('resultedAt' in data).toBe(false);
    });

    it('미처리 중재의 respondedAt 은 null 이다', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue([makeIntvRow()]);
      const page = await service.getInterventions();
      expect(page.items[0].respondedAt).toBeNull();
      expect(page.items[0].respondedBy).toBeNull();
    });

    it('중재 처리 시에만 respondedAt/respondedBy 가 기록된다', async () => {
      prisma.pharmacistIntervention.findUnique.mockResolvedValue(
        makeIntvRow({ status: 'ACCEPTED', respondedBy: USER_ID, respondedAt: new Date() }),
      );
      await service.updateIntervention(INTV_ID, { status: 'ACCEPTED', doctorResponse: '동의', respondedBy: USER_ID });
      const data = prisma.pharmacistIntervention.updateMany.mock.calls[0][0].data;
      expect(data.respondedAt).toBeInstanceOf(Date);
      expect(data.respondedBy).toBe(USER_ID);
    });
  });

  // ── ⑦ 원자 처리·검증 ──

  describe('⑦ 상태 전이는 원자적이고, 주체·대상은 검증된다', () => {
    it('중재 처리는 PENDING 만 전이한다', async () => {
      prisma.pharmacistIntervention.findUnique.mockResolvedValue(
        makeIntvRow({ status: 'ACCEPTED', respondedBy: USER_ID, respondedAt: new Date() }),
      );
      await service.updateIntervention(INTV_ID, { status: 'ACCEPTED', respondedBy: USER_ID });
      expect(prisma.pharmacistIntervention.updateMany.mock.calls[0][0].where).toMatchObject({
        id: INTV_ID, status: 'PENDING',
      });
    });

    it('이미 처리된 중재는 BadRequest', async () => {
      prisma.pharmacistIntervention.updateMany.mockResolvedValue({ count: 0 });
      prisma.pharmacistIntervention.findUnique.mockResolvedValue(makeIntvRow({ status: 'ACCEPTED' }));
      await expect(
        service.updateIntervention(INTV_ID, { status: 'REJECTED', respondedBy: USER_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('없는 중재는 NotFound', async () => {
      prisma.pharmacistIntervention.updateMany.mockResolvedValue({ count: 0 });
      prisma.pharmacistIntervention.findUnique.mockResolvedValue(null);
      await expect(
        service.updateIntervention(INTV_ID, { status: 'ACCEPTED', respondedBy: USER_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('결과가 이미 있는 TDM 은 재입력을 거절한다', async () => {
      prisma.tdmRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.tdmRequest.findUnique.mockResolvedValue(makeTdmRow({ status: 'RESULTED' }));
      await expect(
        service.recordTdmResult(TDM_ID, { resultLevel: 12, resultInterpretation: '재입력' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('UUID 가 아닌 식별자는 Prisma 로 흘려보내지 않고 400 으로 막는다', async () => {
      await expect(
        service.createIntervention({
          pharmacistId: 'ph-001', patientId: 'pt-001', type: 'DOSE', reason: 'a', suggestion: 'b',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.getInterventions({ pharmacistId: 'ph-001' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pharmacistIntervention.create).not.toHaveBeenCalled();
    });

    it('없는 환자에게는 중재·TDM 을 붙이지 않는다', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.createIntervention({
          pharmacistId: USER_ID, patientId: PATIENT_ID, type: 'DOSE', reason: 'a', suggestion: 'b',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createTdmRequest({ patientId: PATIENT_ID, drugName: 'X', requestedBy: USER_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('다른 환자의 처방에 중재를 연결하지 않는다', async () => {
      prisma.prescription.findUnique.mockResolvedValue({ id: RX_ID, encounter: { patientId: 'other' } });
      await expect(
        service.createIntervention({
          pharmacistId: USER_ID, patientId: PATIENT_ID, prescriptionId: RX_ID,
          type: 'DOSE', reason: 'a', suggestion: 'b',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('알 수 없는 중재 유형은 저장하지 않는다', async () => {
      await expect(
        service.createIntervention({
          pharmacistId: USER_ID, patientId: PATIENT_ID, type: 'WHATEVER', reason: 'a', suggestion: 'b',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── ⑧ 이름 조회·절단 고지 ──

  describe('⑧ 이름은 원장에서 조회하고, 자르면 잘랐다고 말한다', () => {
    it('환자·약사 이름을 원장에서 붙인다', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue([makeIntvRow()]);
      const page = await service.getInterventions();
      expect(page.items[0].patientName).toBe('김환자');
      expect(page.items[0].pharmacistName).toBe('임약사');
    });

    it('원장에 없는 환자 이름은 빈 문자열이 아니라 null 이다', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue([makeIntvRow()]);
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
      const page = await service.getInterventions();
      expect(page.items[0].patientName).toBeNull();
      expect(page.items[0].pharmacistName).toBeNull();
    });

    it('상한을 넘으면 truncated=true 로 알린다', async () => {
      prisma.pharmacistIntervention.findMany.mockResolvedValue(
        Array.from({ length: 201 }, (_, i) => makeIntvRow({ id: `${INTV_ID.slice(0, -3)}${String(i).padStart(3, '0')}` })),
      );
      const page = await service.getInterventions();
      expect(page.items).toHaveLength(200);
      expect(page.truncated).toBe(true);
      expect(page.limit).toBe(200);
    });
  });
});
