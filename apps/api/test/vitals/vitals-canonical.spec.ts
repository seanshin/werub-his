import { describe, it, expect, vi } from 'vitest';
import { evaluateVitals, calcBmi, canScoreNews2, VITALS_THRESHOLDS } from '../../src/modules/vitals/vitals-evaluate';
import { VitalsService } from '../../src/modules/vitals/vitals.service';
import { VitalsIngestService } from '../../src/modules/vitals/vitals-ingest.service';

/**
 * 활력 쓰기 정본 통합(2026-07-30) 계약.
 * 종전 결함: 임계치 3벌 분기 · POST /api/v1/vitals 경로에 BMI·알림·NEWS2·만성추이 전부 누락.
 */

describe('evaluateVitals — 정본 임계치(순수)', () => {
  it('정상 측정은 이상 아님', () => {
    const r = evaluateVitals({ systolicBp: 120, diastolicBp: 78, heartRate: 72, temperature: 36.6, spo2: 98, respiratoryRate: 16, painScore: 1 });
    expect(r.isAbnormal).toBe(false);
    expect(r.abnormalLabels).toEqual([]);
  });

  it('고혈압 경계값(180) 포함 — 라벨에 수축/이완 동반', () => {
    const r = evaluateVitals({ systolicBp: 180, diastolicBp: 95 });
    expect(r.isAbnormal).toBe(true);
    expect(r.abnormalLabels[0]).toBe('BP 180/95');
  });

  it('저혈압 경계값(80) 포함', () => {
    expect(evaluateVitals({ systolicBp: 80 }).isAbnormal).toBe(true);
    expect(evaluateVitals({ systolicBp: 81 }).isAbnormal).toBe(false);
  });

  it('SpO2 는 저산소만 이상(고값은 이상 아님)', () => {
    expect(evaluateVitals({ spo2: 89 }).isAbnormal).toBe(true);
    expect(evaluateVitals({ spo2: 100 }).isAbnormal).toBe(false);
  });

  it('통증은 고값만 이상(7 이상)', () => {
    expect(evaluateVitals({ painScore: 7 }).isAbnormal).toBe(true);
    expect(evaluateVitals({ painScore: 0 }).isAbnormal).toBe(false);
  });

  it('미측정(null/undefined)은 이상 판정에 쓰지 않음', () => {
    const r = evaluateVitals({ systolicBp: undefined, spo2: null, temperature: undefined });
    expect(r.isAbnormal).toBe(false);
  });

  it('이완기 단독 이상도 포착(수축기 정상일 때)', () => {
    const r = evaluateVitals({ systolicBp: 120, diastolicBp: 115 });
    expect(r.isAbnormal).toBe(true);
    expect(r.abnormalLabels[0]).toContain('115');
  });

  it('임계치는 단일 정본에서만 정의된다', () => {
    expect(VITALS_THRESHOLDS.systolicBp).toMatchObject({ low: 80, high: 180 });
    expect(VITALS_THRESHOLDS.temperature).toMatchObject({ low: 35.0, high: 38.5 });
  });
});

describe('calcBmi / canScoreNews2', () => {
  it('BMI 계산(소수 1자리)', () => expect(calcBmi(70, 175)).toBe(22.9));
  it('신장 0/미측정이면 undefined', () => {
    expect(calcBmi(70, 0)).toBeUndefined();
    expect(calcBmi(70, undefined)).toBeUndefined();
    expect(calcBmi(undefined, 175)).toBeUndefined();
  });
  /**
   * 🔴 2026-08-18 갱신 — 종전 계약은 "수치 5요소면 산출"이었고, 나머지 두 요소(보충산소·의식)를
   *    서비스가 `false`/`'ALERT'` 로 **하드코딩**해 채웠다. 관측하지 않은 값을 법정기록에 남기지
   *    않기 위해 7요소 전부 관측된 경우에만 산출한다(미관측=산출 불가).
   */
  const FIVE = { systolicBp: 120, heartRate: 70, respiratoryRate: 16, temperature: 36.5, spo2: 98 };
  it('NEWS2 는 7요소(수치5+보충산소+의식) 완비 시에만 산출', () => {
    expect(canScoreNews2({ ...FIVE, supplementalO2: false, consciousness: 'ALERT' })).toBe(true);
    expect(canScoreNews2({ ...FIVE, supplementalO2: true, consciousness: 'VOICE' })).toBe(true);
    // 수치만으로는 산출하지 않는다(가정 금지)
    expect(canScoreNews2(FIVE)).toBe(false);
    expect(canScoreNews2({ ...FIVE, supplementalO2: false })).toBe(false);
    expect(canScoreNews2({ ...FIVE, consciousness: 'ALERT' })).toBe(false);
    // 미관측을 null 로 명시해도 산출하지 않는다
    expect(canScoreNews2({ ...FIVE, supplementalO2: null, consciousness: null })).toBe(false);
    // 어휘 밖 의식수준은 관측으로 인정하지 않는다
    expect(canScoreNews2({ ...FIVE, supplementalO2: false, consciousness: '명료' })).toBe(false);
    // 수치가 빠지면 당연히 불가
    expect(canScoreNews2({ systolicBp: 120, heartRate: 70, respiratoryRate: 16, temperature: 36.5, supplementalO2: false, consciousness: 'ALERT' })).toBe(false);
  });
});

describe('VitalsService.record — 어느 경로로 들어와도 부가 로직 동일', () => {
  const build = () => {
    const created = { id: 'v1', measuredAt: new Date('2026-07-30T01:00:00Z') };
    const prisma: any = {
      preVisitVitals: { create: vi.fn().mockResolvedValue(created), findFirst: vi.fn().mockResolvedValue(null) },
      nurseTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '강', givenName: '미경', mrn: 'P1' }) },
      nursePatientAssignment: { findMany: vi.fn().mockResolvedValue([{ nurseId: 'n2' }]) },
      // 재원 판정(원장 고르기 · select.id)에는 재원 없음 — 외래 환자 · 알림 대상 조회(select.attendingDoctorId)에는 주치의
      admission: { findFirst: vi.fn().mockImplementation((a: { select?: Record<string, unknown> }) => Promise.resolve(a?.select?.attendingDoctorId ? { attendingDoctorId: 'doc1' } : null)) },
    };
    const emitter: any = { emit: vi.fn() };
    const notif: any = { create: vi.fn().mockResolvedValue({ id: 'x', type: 'VITAL_ALERT', title: 't', message: 'm', severity: 'CRITICAL', refType: 'PATIENT', refId: 'p1' }), pushNotification: vi.fn() };
    const safety: any = { calculateAndSaveEws: vi.fn().mockResolvedValue({ riskLevel: 'HIGH', totalScore: 7 }) };
    // 🔴 저장·이벤트는 수집 포트를 지난다 — 테스트도 실제 포트를 끼운다(목으로 대체하면 포트가 통과 대상에서 빠진다)
    const ingest = new VitalsIngestService(prisma, emitter);
    return { svc: new VitalsService(prisma, ingest, notif, safety), prisma, emitter, notif, safety, ingest };
  };

  it('BMI 를 계산해 저장한다 — 종전 /api/v1/vitals 경로에서 누락됐던 항목', async () => {
    const { svc, prisma } = build();
    await svc.record({ patientId: 'p1', weight: 70, height: 175 }, 'n1');
    expect(prisma.preVisitVitals.create.mock.calls[0][0].data.bmi).toBe(22.9);
  });

  it('만성추이 미러링 이벤트를 발행한다(vitals.recorded)', async () => {
    const { svc, emitter } = build();
    await svc.record({ patientId: 'p1', systolicBp: 130, diastolicBp: 85, weight: 70, height: 175 }, 'n1');
    expect(emitter.emit).toHaveBeenCalledWith('vitals.recorded', expect.objectContaining({ patientId: 'p1', vitalsId: 'v1', bmi: 22.9 }));
  });

  it('이상 바이탈이면 담당간호사·주치의·기록자에게 알림', async () => {
    const { svc, notif } = build();
    await svc.record({ patientId: 'p1', systolicBp: 190, diastolicBp: 100 }, 'n1');
    const targets = notif.create.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(targets)).toEqual(new Set(['n2', 'doc1', 'n1']));
    expect(notif.create.mock.calls[0][1].message).toContain('BP 190/100');
  });

  it('정상 측정이면 알림을 보내지 않는다', async () => {
    const { svc, notif } = build();
    await svc.record({ patientId: 'p1', systolicBp: 120, diastolicBp: 80 }, 'n1');
    expect(notif.create).not.toHaveBeenCalled();
  });

  it('7요소 완비 시 NEWS2 자동 산출 — 관측값을 그대로 넘긴다(가정 주입 금지)', async () => {
    const { svc, safety } = build();
    await svc.record({
      patientId: 'p1', systolicBp: 120, heartRate: 70, respiratoryRate: 16, temperature: 36.5, spo2: 98,
      supplementalO2: true, consciousness: 'VOICE',
    }, 'n1');
    expect(safety.calculateAndSaveEws).toHaveBeenCalled();
    const params = safety.calculateAndSaveEws.mock.calls[0][2];
    // 🔴 종전엔 여기에 supplementalO2:false·consciousness:'ALERT' 가 하드코딩돼 있었다(최대 5점 과소평가)
    expect(params.supplementalO2).toBe(true);
    expect(params.consciousness).toBe('VOICE');
  });

  it('보충산소·의식 미관측이면 NEWS2 를 산출하지 않는다(관측하지 않은 값을 기록하지 않는다)', async () => {
    const { svc, safety } = build();
    await svc.record({ patientId: 'p1', systolicBp: 120, heartRate: 70, respiratoryRate: 16, temperature: 36.5, spo2: 98 }, 'n1');
    expect(safety.calculateAndSaveEws).not.toHaveBeenCalled();
  });

  it('일부만 측정되면 NEWS2 미산출', async () => {
    const { svc, safety } = build();
    await svc.record({ patientId: 'p1', systolicBp: 120 }, 'n1');
    expect(safety.calculateAndSaveEws).not.toHaveBeenCalled();
  });

  it('queueId 있을 때만 VITALS 태스크를 완료 처리', async () => {
    const a = build();
    await a.svc.record({ patientId: 'p1', queueId: 'q1' }, 'n1');
    expect(a.prisma.nurseTask.updateMany).toHaveBeenCalled();

    const b = build();
    await b.svc.record({ patientId: 'p1' }, 'n1');
    expect(b.prisma.nurseTask.updateMany).not.toHaveBeenCalled();
  });

  it('알림 실패는 기록을 막지 않는다(non-blocking)', async () => {
    const { svc, notif } = build();
    notif.create.mockRejectedValue(new Error('down'));
    await expect(svc.record({ patientId: 'p1', spo2: 85 }, 'n1')).resolves.toMatchObject({ vitals: { id: 'v1' }, ingest: { status: 'STORED' } });
  });

  it('알림/안전 모듈 미주입(Optional)에도 기록은 성공', async () => {
    const prisma: any = {
      preVisitVitals: { create: vi.fn().mockResolvedValue({ id: 'v1', measuredAt: new Date() }), findFirst: vi.fn().mockResolvedValue(null) },
      nurseTask: { updateMany: vi.fn() },
      admission: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const svc = new VitalsService(prisma, new VitalsIngestService(prisma, { emit: vi.fn() } as never));
    await expect(svc.record({ patientId: 'p1', spo2: 80, systolicBp: 120, heartRate: 70, respiratoryRate: 16, temperature: 36.5 }, 'n1')).resolves.toMatchObject({ vitals: { id: 'v1' }, ingest: { status: 'STORED' } });
  });
});

/**
 * 원장 고르기(2026-10-10) — 🔴 재원 중 환자를 간호 스테이션·차트에서 재면 외래 원장에 쌓여
 * 플로시트·병동 보드·회진 목록이 "기록 없음"이었다(운영 실측 재원 중 외래 원장 행 27).
 */
describe('VitalsService.record — 재원 중이면 입원 원장', () => {
  const build = (admission: { id: string; patientId: string; status: string } | null) => {
    const prisma: any = {
      preVisitVitals: { create: vi.fn().mockResolvedValue({ id: 'pv1', measuredAt: new Date() }), findFirst: vi.fn().mockResolvedValue(null) },
      flowSheetEntry: { create: vi.fn().mockResolvedValue({ id: 'fs1', recordedAt: new Date() }), findFirst: vi.fn().mockResolvedValue(null) },
      nurseTask: { updateMany: vi.fn() },
      admission: {
        findFirst: vi.fn().mockImplementation((a: { where?: { status?: string } }) => Promise.resolve(admission && a?.where?.status === 'ADMITTED' ? { id: admission.id } : null)),
        findUnique: vi.fn().mockResolvedValue(admission),
      },
    };
    const emitter: any = { emit: vi.fn() };
    const config: any = { get: vi.fn().mockResolvedValue(null) };
    const svc = new VitalsService(prisma, new VitalsIngestService(prisma, emitter), undefined, undefined, config);
    return { svc, prisma, emitter };
  };

  it('🔴 대기열·진료 문맥 없이 재원 중 환자 → 플로시트(입원 원장) · 근무조는 측정 시각의 교대', async () => {
    const { svc, prisma } = build({ id: 'a1', patientId: 'p1', status: 'ADMITTED' });
    // 10:00 KST = 주간(07~15)
    const r = await svc.record({ patientId: 'p1', heartRate: 80, measuredAt: '2026-10-10T01:00:00Z' }, 'n1');
    expect(prisma.flowSheetEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma.preVisitVitals.create).not.toHaveBeenCalled();
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data).toMatchObject({ admissionId: 'a1', heartRate: 80, shiftType: 'DAY' });
    expect(r).toMatchObject({ ledger: 'FLOWSHEET', admissionId: 'a1', ingest: { status: 'STORED' } });
  });

  it('야간 측정은 NIGHT — 수집 포트의 DAY 고정에 기대지 않는다', async () => {
    const { svc, prisma } = build({ id: 'a1', patientId: 'p1', status: 'ADMITTED' });
    await svc.record({ patientId: 'p1', heartRate: 80, measuredAt: '2026-10-09T17:30:00Z' }, 'n1'); // 02:30 KST
    expect(prisma.flowSheetEntry.create.mock.calls[0][0].data.shiftType).toBe('NIGHT');
  });

  it('대조군 — 재원이 없으면 외래 원장', async () => {
    const { svc, prisma } = build(null);
    const r = await svc.record({ patientId: 'p1', heartRate: 80 }, 'n1');
    expect(prisma.preVisitVitals.create).toHaveBeenCalledTimes(1);
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
    expect(r.ledger).toBe('PREVISIT');
  });

  it('대기열·진료 문맥이 있으면 재원 중이어도 외래 원장(외래 진료 중 측정)', async () => {
    const { svc, prisma } = build({ id: 'a1', patientId: 'p1', status: 'ADMITTED' });
    await svc.record({ patientId: 'p1', heartRate: 80, queueId: 'q1' }, 'n1');
    await svc.record({ patientId: 'p1', heartRate: 81, encounterId: 'e1' }, 'n1');
    expect(prisma.preVisitVitals.create).toHaveBeenCalledTimes(2);
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
  });

  it('🔴 체중·키는 입원 원장에 칸이 없다 — 버리지 않고 외래 원장', async () => {
    const { svc, prisma } = build({ id: 'a1', patientId: 'p1', status: 'ADMITTED' });
    await svc.record({ patientId: 'p1', weight: 60 }, 'n1');
    expect(prisma.preVisitVitals.create).toHaveBeenCalledTimes(1);
    expect(prisma.flowSheetEntry.create).not.toHaveBeenCalled();
  });

  it('🔴 명시한 재원이 다른 환자·퇴원이면 400 — 남의 재원에 붙이지 않는다', async () => {
    const other = build({ id: 'a1', patientId: 'p2', status: 'ADMITTED' });
    await expect(other.svc.record({ patientId: 'p1', admissionId: 'a1', heartRate: 80 }, 'n1')).rejects.toMatchObject({ response: { code: 'VITALS_ADMISSION_MISMATCH' } });
    const gone = build({ id: 'a1', patientId: 'p1', status: 'DISCHARGED' });
    await expect(gone.svc.record({ patientId: 'p1', admissionId: 'a1', heartRate: 80 }, 'n1')).rejects.toMatchObject({ response: { code: 'VITALS_ADMISSION_MISMATCH' } });
    expect(other.prisma.flowSheetEntry.create).not.toHaveBeenCalled();
  });

  it('입원 원장 저장은 만성 추이(vitals.recorded)에 넣지 않고 재원 사건만 낸다', async () => {
    const { svc, emitter } = build({ id: 'a1', patientId: 'p1', status: 'ADMITTED' });
    await svc.record({ patientId: 'p1', heartRate: 80 }, 'n1');
    expect(emitter.emit).not.toHaveBeenCalledWith('vitals.recorded', expect.anything());
    expect(emitter.emit).toHaveBeenCalledWith('vitals.admission.recorded', { admissionId: 'a1', route: 'INPATIENT' });
  });
});
