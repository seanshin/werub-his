/**
 * S4(2026-09-15) — 기획 잔여 소형 기능 3종.
 *  ① 여정 기간 보고서: 간격은 양 끝 이벤트가 있을 때만(없으면 null·0 금지) · 기간 없으면 400 · 다른 환자 입원 404 · 잘림 표시
 *  ② 처방 설명 가이드: 처방·마스터 값 그대로 — 마스터 미연결은 null(문구 생성 없음) · 취소 처방 제외 · 잘림
 *  ③ 관제 SSE: 인가는 클래스 가드(CanActivate) — 핸들러 안 인가 분기 없음 · 힌트에 환자 정보 없음 · 5초 합침
 *  ④ 세 조회 경로가 PHI 열람 감사 대상
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHI_READ_PATTERNS } from '../../src/modules/audit/audit-routes';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { JourneyConsoleController } from '../../src/modules/journey-console/journey-console.controller';
import { buildJourneyReport } from '../../src/modules/journey/journey-report';
import { JourneyService } from '../../src/modules/journey/journey.service';
import { NurseStationService } from '../../src/modules/nurse-station/nurse-station.service';

const at = (iso: string) => new Date(iso);
const PERIOD = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', source: 'RANGE' as const };

describe('① 여정 기간 보고서', () => {
  it('간격은 양 끝 이벤트가 모두 있을 때만 — 하나라도 없으면 null', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T01:00:00Z'), occurredAt: at('2026-09-01T01:00:00Z') },
        { eventType: 'ER_DISPOSITION', eventAt: at('2026-09-01T04:30:00Z'), occurredAt: at('2026-09-01T04:30:00Z') },
        { eventType: 'SURGERY_START', eventAt: at('2026-09-01T06:00:00Z'), occurredAt: at('2026-09-01T06:00:00Z') },
        { eventType: 'LAB_RESULT', eventAt: at('2026-09-01T02:00:00Z') },
      ],
      { limit: 100, period: PERIOD },
    );
    // 🔴 (2026-10-01 여정 P0-3) 처분(결정)은 응급 체류의 끝이 아니다 — 퇴실 사건이 없으면 산출 불가(종전엔 210분을 냈다)
    expect(r.intervals.erStayMinutes, '처분만 있고 퇴실이 없으면 산출 불가').toBeNull();
    expect(r.intervals.surgeryMinutes, '수술 종료 이벤트가 없으면 산출 불가').toBeNull();
    expect(r.intervals.admitToSurgeryMinutes, '입원 이벤트가 없으면 산출 불가').toBeNull();
    expect(r.counts).toEqual({ prescriptionAdded: 0, labResult: 1, imagingResult: 0 });
    expect(r.events.firstAt).toBe('2026-09-01T01:00:00.000Z');
    expect(r.events.truncated).toBe(false);
  });

  it('응급 체류 끝점은 퇴실(ER_CHECKOUT) — 처분과 별개', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T01:00:00Z'), occurredAt: at('2026-09-01T01:00:00Z') },
        { eventType: 'ER_DISPOSITION', eventAt: at('2026-09-01T02:00:00Z'), occurredAt: at('2026-09-01T02:00:00Z') },
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T04:30:00Z'), occurredAt: at('2026-09-01T04:30:00Z') },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.erStayMinutes).toBe(210);
  });

  it('🔴 같은 날 응급 방문 둘 — 양 끝이 원 기록을 가지면 같은 방문끼리만 잇는다(발산 방지)', () => {
    const V1 = '11111111-1111-4111-8111-111111111111';
    const V2 = '22222222-2222-4222-8222-222222222222';
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T00:00:00Z'), occurredAt: at('2026-09-01T00:00:00Z'), refType: 'EmergencyVisit', refId: V1 },
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T01:00:00Z'), occurredAt: at('2026-09-01T01:00:00Z'), refType: 'EmergencyVisit', refId: V2 }, // 다른 방문의 퇴실(오래 남은 기록)
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T02:00:00Z'), occurredAt: at('2026-09-01T02:00:00Z'), refType: 'EmergencyVisit', refId: V1 },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.erStayMinutes).toBe(120);
  });

  it('대조군 — 과거 행처럼 포인터가 없으면 종전 규칙(시간 순서)으로 잇는다', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T00:00:00Z'), occurredAt: at('2026-09-01T00:00:00Z') },
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T01:00:00Z'), occurredAt: at('2026-09-01T01:00:00Z') },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.erStayMinutes).toBe(60);
  });

  it('표본 0 — 전부 null·0건이며 지어낸 값이 없다', () => {
    const r = buildJourneyReport([], { limit: 100, period: PERIOD });
    expect(r.events).toMatchObject({ total: 0, byType: [], firstAt: null, lastAt: null });
    expect([r.intervals.erStayMinutes, r.intervals.admitToSurgeryMinutes, r.intervals.surgeryMinutes].every((v) => v === null)).toBe(true);
    expect(r.intervals.excludedUnknownTime).toBe(0);
    expect(r.admission).toBeNull();
  });

  it('🔴 P1 — 간격은 발생 시각으로만 잰다: 발생 시각 미상 행은 빼고 그 수를 밝힌다(기록 시각으로 대신하지 않는다)', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T00:00:00Z'), occurredAt: null },
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T01:00:00Z'), occurredAt: null },
        { eventType: 'LAB_RESULT', eventAt: at('2026-09-01T00:30:00Z'), occurredAt: null },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.erStayMinutes, '기록 시각만 있으면 간격을 내지 않는다').toBeNull();
    expect(r.intervals.excludedUnknownTime, '간격 유형 행만 센다(검사 결과 제외)').toBe(2);
    expect(r.counts.labResult, '건수는 시각과 무관하게 센다').toBe(1);
  });

  it('🔴 P1 — 발생 시각은 기록 시각과 다를 수 있다(늦은 입력): 간격은 발생 시각 차이', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ER_ARRIVAL', eventAt: at('2026-09-01T02:00:00Z'), occurredAt: at('2026-09-01T00:00:00Z') }, // 2시간 늦게 입력
        { eventType: 'ER_CHECKOUT', eventAt: at('2026-09-01T03:00:00Z'), occurredAt: at('2026-09-01T03:00:00Z') },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.erStayMinutes).toBe(180);
  });

  it('🔴 P1 — 종류가 다른 원 기록(입원→수술)은 포인터가 달라도 시간 순서로 잇는다(P0 규칙이 영원히 null 을 냈다)', () => {
    const r = buildJourneyReport(
      [
        { eventType: 'ADMISSION', eventAt: at('2026-09-01T00:00:00Z'), occurredAt: at('2026-09-01T00:00:00Z'), refType: 'ADMISSION', refId: '11111111-1111-4111-8111-111111111111' },
        { eventType: 'SURGERY_START', eventAt: at('2026-09-01T05:00:00Z'), occurredAt: at('2026-09-01T05:00:00Z'), refType: 'SURGERY', refId: '22222222-2222-4222-8222-222222222222' },
      ],
      { limit: 100, period: PERIOD },
    );
    expect(r.intervals.admitToSurgeryMinutes).toBe(300);
  });

  it('상한을 넘으면 잘렸다고 말한다', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ eventType: 'LAB_RESULT', eventAt: at(`2026-09-01T0${i}:00:00Z`) }));
    const r = buildJourneyReport(rows, { limit: 3, period: PERIOD });
    expect(r.events).toMatchObject({ total: 3, truncated: true });
  });

  it('기간을 안 주면 400 · 다른 환자의 입원 id 는 404', async () => {
    const prisma = {
      admission: { findFirst: vi.fn().mockResolvedValue(null) },
      patientJourneyEvent: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new JourneyService(prisma as any, {} as any);
    await expect(svc.getReport('p1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getReport('p1', { admissionId: 'a1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.admission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', patientId: 'p1' } }));
    expect(prisma.patientJourneyEvent.findMany).not.toHaveBeenCalled();
  });

  it('기간 조회는 환자·기간으로 거르고 상한+1 로 잘림을 판단한다', async () => {
    const prisma = { patientJourneyEvent: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new JourneyService(prisma as any, {} as any);
    const r = await svc.getReport('p1', { from: '2026-09-01', to: '2026-09-03' });
    const arg = prisma.patientJourneyEvent.findMany.mock.calls[0][0];
    expect(arg.where.patientId).toBe('p1');
    expect(arg.where.eventAt.gte).toBeInstanceOf(Date);
    expect(arg.where.eventAt.lt).toBeInstanceOf(Date);
    expect(arg.take).toBe(JourneyService.REPORT_LIMIT + 1);
    expect(r.period.source).toBe('RANGE');
  });
});

describe('② 처방 설명 가이드', () => {
  const svc = (rows: unknown[], enc: unknown = { id: 'e1', patientId: 'p1', status: 'COMPLETED' }) => {
    const prisma = {
      encounter: { findUnique: vi.fn().mockResolvedValue(enc) },
      prescription: { findMany: vi.fn().mockResolvedValue(rows) },
    };
    return { s: new NurseStationService(prisma as any, {} as any, {} as any, {} as any, {} as any), prisma };
  };
  const rx = (over: Record<string, unknown> = {}) => ({
    id: 'rx1', dosage: '1정', frequency: '1일 3회', duration: 3, quantity: 9, route: 'PO', instructions: null,
    priority: 'ROUTINE', dispensingType: 'EXTERNAL', createdAt: new Date(),
    medicationCode: { code: 'M1', nameKo: '약', nameEn: null, ingredient: null, dosageForm: null, unit: null, storageCondition: null,
      highAlertFlag: false, highAlertCategory: null, controlSchedule: null, narcoticType: null, pregnancyCategory: null, lasaGroup: null, isActive: true },
    ...over,
  });

  it('마스터 미연결 처방은 medication=null — 약 정보를 지어내지 않는다', async () => {
    const { s } = svc([rx({ medicationCode: null })]);
    const r = await s.getRxGuide('e1');
    expect(r.items[0].medication).toBeNull();
    expect(r.items[0].order).toMatchObject({ dosage: '1정', frequency: '1일 3회', durationDays: 3 });
  });

  it('취소 처방 제외·약 처방만·상한+1 조회', async () => {
    const { s, prisma } = svc([rx()]);
    await s.getRxGuide('e1');
    const arg = prisma.prescription.findMany.mock.calls[0][0];
    // 2026-09-30: 복약 설명은 지금 먹는 약 — 취소·중단 모두 뺀다(ACTIVE 만)
    expect(arg.where).toEqual({ encounterId: 'e1', type: 'MEDICATION', status: 'ACTIVE' });
    expect(arg.take).toBe(NurseStationService.RX_GUIDE_LIMIT + 1);
  });

  it('상한 초과면 잘림 표시 · 없는 진료는 404', async () => {
    const many = Array.from({ length: NurseStationService.RX_GUIDE_LIMIT + 1 }, (_, i) => rx({ id: `rx${i}` }));
    const { s } = svc(many);
    const r = await s.getRxGuide('e1');
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(NurseStationService.RX_GUIDE_LIMIT);
    const { s: s2 } = svc([], null);
    await expect(s2.getRxGuide('e9')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('③ 관제 SSE', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('인가는 클래스 가드(JwtAuthGuard·RolesGuard) — 응답 시작 전에 막힌다', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, JourneyConsoleController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('여러 저장을 5초에 한 힌트로 합치고 환자 정보를 싣지 않는다', () => {
    const handlers = new Map<string, () => void>();
    const emitter = { on: vi.fn((e: string, h: () => void) => handlers.set(e, h)), off: vi.fn() };
    const ctrl = new JourneyConsoleController({} as any, {} as any, {} as any, emitter as any, {} as any);
    const got: any[] = [];
    const sub = ctrl.stream().subscribe((m) => got.push(m.data));
    const fire = handlers.get(JourneyService.SAVED_EVENT)!;
    fire(); fire(); fire();
    vi.advanceTimersByTime(5000);
    const refresh = got.filter((d) => d.type === 'refresh');
    expect(refresh).toHaveLength(1);
    expect(Object.keys(refresh[0]).sort()).toEqual(['at', 'type']);
    sub.unsubscribe();
    expect(emitter.off).toHaveBeenCalledWith(JourneyService.SAVED_EVENT, expect.any(Function));
  });
});

describe('④ 열람 감사', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  it.each([`/api/v1/journey/${U}/report`, `/api/v1/journey/${U}/timeline`, `/api/v1/nurse-station/rx-guide/${U}`])('%s 는 PHI 열람 감사 대상', (p) => {
    expect(PHI_READ_PATTERNS.some((re) => re.test(p))).toBe(true);
  });
  it('대조군 — 집계(/journey/metrics)는 대상 아님', () => {
    expect(PHI_READ_PATTERNS.some((re) => re.test('/api/v1/journey/metrics'))).toBe(false);
  });
});
