import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  NursingService,
  nursingDayWindow,
  matchCarePlanNeeds,
  buildCarePlanContext,
} from '../../src/modules/nursing/nursing.service';

/**
 * 시드 흐름 전수 검토 9단계(간호) 가드 — 2026-08-24.
 *
 * 🔴 재주입으로 검증한 결함 두 가지
 *   ① 하루 경계가 같은 파일 안에 둘이었다.
 *      `getNotes`·`getIntakeOutputs`·`getIntakeOutputSummary`·`getMedicationSchedule` 은
 *      `new Date('YYYY-MM-DD')`(=UTC 자정 = KST 09:00)로 창을 만들고,
 *      `getTimeline`·`getFlowSheet` 은 `T00:00:00+09:00`(KST)로 만들었다.
 *      운영 실측(입원 `2c993518…` · `?date=2026-05-16`): 화면 `섭취 850 / 배출 1,059 / 균형 -209`
 *      ↔ 실제 05-16(KST) `850 / 963 / -113` — **05-17 08:00 기록이 05-16 칸에 있었다.**
 *   ② 판정 어휘 집합이 운영에 저장된 값을 덮지 못했다.
 *      `BED_REST` 11 · `AMBULATORY_ASSIST` 8 · `AT_RISK` 6 (nursing_assessments 41행 중) 과
 *      화면이 만드는 `Verbal` 이 집합 밖이라 간호과정 제안이 조용히 비었다.
 *
 * 🔴 대조군을 함께 둔다 — "성공하면 실패라고 말하지 않는다"(무조건 통과하는 가드 방지).
 */

/** 서버가 KST 로 도는지(pm2 TZ=Asia/Seoul) — 아니면 이 축의 단언은 다른 것을 재게 된다. */
const KST_OFFSET_MIN = -540; // UTC+9
const runningInKst = new Date('2026-05-16T00:00:00Z').getTimezoneOffset() === KST_OFFSET_MIN;

describe('간호 하루 경계 정본 (nursingDayWindow)', () => {
  it.runIf(runningInKst)('YYYY-MM-DD 는 서버 로컬(KST) 자정에서 시작한다 — UTC 자정이 아니다', () => {
    const { gte, lt } = nursingDayWindow('2026-05-16');
    // 🔴 결함 재주입: `new Date('2026-05-16')` 로 되돌리면 gte 가 15:00Z 가 아니라 00:00Z 가 되어 실패한다.
    expect(gte.toISOString()).toBe('2026-05-15T15:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-05-16T15:00:00.000Z');
  });

  it('창의 폭은 정확히 24시간이고 끝은 다음 날 자정 "미만"이다', () => {
    const { gte, lt } = nursingDayWindow('2026-05-16');
    expect(lt.getTime() - gte.getTime()).toBe(24 * 3600_000);
  });

  it.runIf(runningInKst)('KST 08:00 기록은 그 날에 들어가고 다음 날에는 들어가지 않는다', () => {
    const rec = new Date('2026-05-16T08:00:00+09:00'); // = 2026-05-15T23:00Z (운영 실측 표본과 같은 시각)
    const d16 = nursingDayWindow('2026-05-16');
    const d15 = nursingDayWindow('2026-05-15');
    expect(rec >= d16.gte && rec < d16.lt).toBe(true);
    // 🔴 종전(UTC 창)에는 이 기록이 05-15 칸에 들어갔다 — 그 반대를 못 박는다
    expect(rec >= d15.gte && rec < d15.lt).toBe(false);
  });

  it('대조군 — KST 낮 시간대 기록은 종전에도 지금도 같은 날이다(모든 것을 결함이라 말하지 않는다)', () => {
    const noon = new Date('2026-05-16T14:00:00+09:00');
    const w = nursingDayWindow('2026-05-16');
    expect(noon >= w.gte && noon < w.lt).toBe(true);
  });

  it('파싱 불가 날짜는 500 이 아니라 400 이다', () => {
    expect(() => nursingDayWindow('2026-13-99')).toThrow(BadRequestException);
    expect(() => nursingDayWindow('어제')).toThrow(BadRequestException);
  });
});

describe('간호 조회 EP 가 모두 같은 하루 경계를 쓴다', () => {
  let service: NursingService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', patientId: 'p1', admitDate: new Date('2026-05-01T00:00:00Z'), dischargeDate: null }) },
      preVisitVitals: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      nursingNote: { findMany: vi.fn().mockResolvedValue([]) },
      intakeOutput: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      flowSheetEntry: { findMany: vi.fn().mockResolvedValue([]) },
      nursingChecklist: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new NursingService(prisma);
  });

  const expected = () => nursingDayWindow('2026-05-16');

  it('getNotes — 간호기록 목록', async () => {
    await service.getNotes('a1', { date: '2026-05-16' });
    expect(prisma.nursingNote.findMany.mock.calls[0][0].where.recordedAt).toEqual(expected());
  });

  it('getIntakeOutputs — I/O 목록', async () => {
    await service.getIntakeOutputs('a1', '2026-05-16');
    expect(prisma.intakeOutput.findMany.mock.calls[0][0].where.recordedAt).toEqual(expected());
  });

  it('getIntakeOutputSummary — 수분 출납 합계(임상 판단의 입력)', async () => {
    await service.getIntakeOutputSummary('a1', '2026-05-16');
    expect(prisma.intakeOutput.findMany.mock.calls[0][0].where.recordedAt).toEqual(expected());
  });

  // 🔴 위 단언들은 `nursingDayWindow` 를 오라클로 쓴다 — 정본이 통째로 틀리면 함께 틀린다
  //    (가드가 오라클을 계약으로 못박는 함정). 절대값을 하나 박아 그 경로를 막는다.
  it.runIf(runningInKst)('오라클 없이 — 창의 시작이 실제로 KST 자정이다', async () => {
    await service.getIntakeOutputSummary('a1', '2026-05-16');
    const w = prisma.intakeOutput.findMany.mock.calls[0][0].where.recordedAt;
    expect(w.gte.toISOString()).toBe('2026-05-15T15:00:00.000Z');
    expect(w.lt.toISOString()).toBe('2026-05-16T15:00:00.000Z');
  });

  it('getMedicationSchedule — MAR', async () => {
    await service.getMedicationSchedule('a1', '2026-05-16');
    expect(prisma.medicationAdministration.findMany.mock.calls[0][0].where.scheduledAt).toEqual(expected());
  });

  it('getFlowSheet — 활력 시트(종전에도 KST 였다·경계가 갈라지지 않았음을 못 박는다)', async () => {
    await service.getFlowSheet('a1', '2026-05-16');
    expect(prisma.flowSheetEntry.findMany.mock.calls[0][0].where.recordedAt).toEqual(expected());
    // 외래 원장(간호 스테이션 입력)도 같은 하루 창 — 재원 기간과 겹치는 만큼(2026-10-10)
    expect(prisma.preVisitVitals.findMany.mock.calls[0][0].where.OR[0].measuredAt).toEqual(expected());
  });

  it('날짜 미지정이면 조회하지 않는 것이 아니라 창을 걸지 않는다(전체 조회) — 종전 동작 보존', async () => {
    await service.getIntakeOutputs('a1');
    expect(prisma.intakeOutput.findMany.mock.calls[0][0].where.recordedAt).toBeUndefined();
  });
});

describe('수분 출납 합계 — 창과 시간 눈금이 같은 하루를 가리킨다', () => {
  it.runIf(runningInKst)('다음 날 08:00 기록은 오늘 합계·오늘 08시 칸에 들어가지 않는다', async () => {
    const rows = [
      { recordedAt: new Date('2026-05-16T08:00:00+09:00'), intakeAmount: 500, outputAmount: 456 },
      { recordedAt: new Date('2026-05-16T16:00:00+09:00'), intakeAmount: 350, outputAmount: 507 },
      { recordedAt: new Date('2026-05-17T08:00:00+09:00'), intakeAmount: 500, outputAmount: 552 }, // 다음 날
    ];
    const prisma: any = {
      intakeOutput: {
        findMany: vi.fn(({ where }: any) =>
          Promise.resolve(rows.filter((r) => r.recordedAt >= where.recordedAt.gte && r.recordedAt < where.recordedAt.lt)),
        ),
      },
      flowSheetEntry: { findMany: vi.fn(async () => []) }, // I/O 읽기 정본의 플로시트 칸 — 없음
    };
    const service = new NursingService(prisma);
    const s = await service.getIntakeOutputSummary('a1', '2026-05-16');
    // 🔴 운영 실측 그대로 — 종전엔 850 / 1,059 / -209 가 나왔다(05-17 08:00 이 섞여서)
    expect({ i: s.totalIntake, o: s.totalOutput, b: s.balance }).toEqual({ i: 850, o: 963, b: -113 });
    expect(s.byHour.find((h) => h.hour === 8)).toEqual({ hour: 8, intake: 500, output: 456 });
    expect(s.byHour.find((h) => h.hour === 16)).toEqual({ hour: 16, intake: 350, output: 507 });
  });

  it('대조군 — 표본이 그 하루에만 있으면 합계는 그대로다(성공을 실패라 말하지 않는다)', async () => {
    const rows = [{ recordedAt: new Date('2026-05-16T14:00:00+09:00'), intakeAmount: 200, outputAmount: 100 }];
    const prisma: any = {
      intakeOutput: {
        findMany: vi.fn(({ where }: any) =>
          Promise.resolve(rows.filter((r) => r.recordedAt >= where.recordedAt.gte && r.recordedAt < where.recordedAt.lt)),
        ),
      },
      flowSheetEntry: { findMany: vi.fn(async () => []) }, // I/O 읽기 정본의 플로시트 칸 — 없음
    };
    const s = await new NursingService(prisma).getIntakeOutputSummary('a1', '2026-05-16');
    expect({ i: s.totalIntake, o: s.totalOutput, b: s.balance }).toEqual({ i: 200, o: 100, b: 100 });
  });
});

describe('간호과정 판정 어휘 — 운영에 저장된 값이 집합 밖으로 새지 않는다', () => {
  const ctxOf = (a: Record<string, unknown>) =>
    buildCarePlanContext({ painScore: null, bradenScore: null, ...a } as any, null, null);
  const keys = (a: Record<string, unknown>) => matchCarePlanNeeds(ctxOf(a)).map((n) => n.key);

  // 운영 실측 어휘(영문 enum) — 시드·원장이 실제로 쓰는 표기
  it('BED_REST(침상안정) 는 기동성 요구를 만든다', () => expect(keys({ mobility: 'BED_REST' })).toContain('mobility'));
  it('AMBULATORY_ASSIST(보행 보조) 는 기동성 요구를 만든다', () => expect(keys({ mobility: 'AMBULATORY_ASSIST' })).toContain('mobility'));
  it('AT_RISK(피부 손상 위험) 는 피부 요구를 만든다', () => expect(keys({ skinIntegrity: 'AT_RISK' })).toContain('skin'));

  // 화면 어휘(한글·ACVPU)
  it('Verbal(음성에만 반응) 은 의식 요구를 만든다', () => expect(keys({ consciousness: 'Verbal' })).toContain('consciousness'));
  it('보조기구 사용 은 기동성 요구를 만든다', () => expect(keys({ mobility: '보조기구 사용' })).toContain('mobility'));
  it('욕창 위험 은 피부 요구를 만든다', () => expect(keys({ skinIntegrity: '욕창 위험' })).toContain('skin'));
  it('전적 도움 은 기동성 요구를 만든다', () => expect(keys({ mobility: '전적 도움' })).toContain('mobility'));

  // 🔴 대조군 — 정상 어휘까지 요구로 만들면 거짓 경보가 되고 진짜 경보가 묻힌다
  it('AMBULATORY / 독립보행 은 기동성 요구를 만들지 않는다', () => {
    expect(keys({ mobility: 'AMBULATORY' })).not.toContain('mobility');
    expect(keys({ mobility: '독립보행' })).not.toContain('mobility');
  });
  it('INTACT / 정상 피부는 피부 요구를 만들지 않는다', () => {
    expect(keys({ skinIntegrity: 'INTACT' })).not.toContain('skin');
    expect(keys({ skinIntegrity: '정상' })).not.toContain('skin');
  });
  it('ALERT / Alert 는 의식 요구를 만들지 않는다', () => {
    expect(keys({ consciousness: 'ALERT' })).not.toContain('consciousness');
    expect(keys({ consciousness: 'Alert' })).not.toContain('consciousness');
  });
  it('미측정(null)은 어떤 요구도 만들지 않는다 — 모르는 것을 판정하지 않는다', () => {
    expect(keys({ mobility: null, skinIntegrity: null, consciousness: null })).toEqual([]);
  });
});
