/**
 * 간호 스테이션 보드 — 상·하번 인계 메모(2026-10-04).
 *  🔴 종전 보드는 인계를 "미확인 N건" 숫자 하나로만 말했다(어떤 환자·무슨 메모인지 볼 곳 없음).
 *     입원 상세의 I-PASS 인계 폼은 **개통 이래 저장 0**(운영 실호출 400 — patientId·toDoctorId 빈 문자열·중증도 자유 입력).
 *  · 보드 = 이번·직전 근무조 창(교대 경계 config·병원 표준시) 안의 인계 피드(I-PASS 전체) + 입원별 마지막 인계(창 밖이어도 · inWindow 로 구분)
 *  · 피드는 상한 + 전체 수(잘렸으면 truncated) · 조치 목록 모양을 모르면 null(0 으로 접지 않는다)
 *  · 인계 생성: 입원의 환자와 인계 환자가 다르면 400(메모가 다른 환자에게 붙지 않게)
 *  · 어휘 정본 shared `HANDOFF_ILLNESS` — DTO·시드가 같은 어휘
 * 재주입: 창 계산·truncated·inWindow·openActions null·환자 불일치 검사·DTO/시드 어휘를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HANDOFF_ILLNESS } from '@hospital-run/shared';
import { NursingService, STATION_HANDOFF_FEED_LIMIT } from '../../src/modules/nursing/nursing.service';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

// 2026-10-04 10:00 KST = 01:00Z → 주간(07~15) · 직전 = 야간(전날 23:00 KST = 10-03 14:00Z)
const NOW = new Date('2026-10-04T01:00:00Z');
const PREV_START = new Date('2026-10-03T14:00:00Z');
const CUR_START = new Date('2026-10-03T22:00:00Z');

function board(opts: { feed?: unknown[]; total?: number; last?: unknown[]; assigns?: unknown[]; duty?: (w: any) => unknown[]; latest?: Date | null; shiftCounts?: Record<string, Array<{ admissionId: string; _count: { _all: number } }>>; medsSoFar?: unknown[]; lastVitals?: unknown[]; mapping?: unknown; crit?: unknown[]; surg?: unknown[]; npo?: unknown[]; transfers?: unknown[]; staleHours?: unknown } = {}) {
  const findMany = vi.fn(async (a: any) => (a.distinct ? (opts.last ?? []) : (opts.feed ?? [])));
  const prisma: any = {
    admission: { findMany: vi.fn(async () => [
      { id: 'adm1', admitDate: new Date('2026-10-01T00:00:00Z'), patientId: 'p1', patient: { familyName: '김', givenName: '하나', mrn: 'M1' }, bed: { roomNumber: '701', bedNumber: '1', ward: { id: 'w1', name: '7병동' } } },
      { id: 'adm2', admitDate: new Date('2026-10-02T00:00:00Z'), patientId: 'p2', patient: { familyName: '이', givenName: '둘', mrn: 'M2' }, bed: { roomNumber: '702', bedNumber: '2', ward: { id: 'w1', name: '7병동' } } },
    ]) },
    $queryRaw: vi.fn(async () => []),
    // 오늘 예정(status SCHEDULED) 조회와 근무조 지금까지(status 조건 없음) 조회를 가른다
    medicationAdministration: { findMany: vi.fn(async (a: any) => (a.where.status ? [] : (opts.medsSoFar ?? []))) },
    nursingNote: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => opts.shiftCounts?.notes ?? []) },
    // 입원 활력 읽기 정본(두 원장 · 2026-10-10) — 최신(distinct)은 lastVitals, 창 안 행은 shiftCounts.vitals 를 행으로 펼친다
    flowSheetEntry: { findMany: vi.fn(async (a: any) => (a.where?.OR ? [] /* I/O 칸 조회(I/O 읽기 정본) — 플로시트 I/O 없음 */ : a.distinct
      ? (opts.lastVitals ?? []).map((v: any) => ({ id: `fs-${v.admissionId}`, admissionId: v.admissionId, recordedAt: v._max.recordedAt, nurseId: 'n1' }))
      : (opts.shiftCounts?.vitals ?? []).flatMap((c) => Array.from({ length: c._count._all }, (_, i) => ({ id: `fs-${c.admissionId}-${i}`, admissionId: c.admissionId, recordedAt: NOW, nurseId: 'n1' }))))) },
    preVisitVitals: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    criticalValueAlert: { findMany: vi.fn(async () => opts.crit ?? []) },
    surgery: { findMany: vi.fn(async () => opts.surg ?? []) },
    dietOrder: { findMany: vi.fn(async () => opts.npo ?? []) },
    bedTransferRequest: { findMany: vi.fn(async () => opts.transfers ?? []) },
    ward: { findMany: vi.fn(async () => [{ id: 'w9', name: '9병동' }]) },
    // I/O 읽기 정본(두 원장 · 2026-10-10) — 행으로 센다
    intakeOutput: { findMany: vi.fn(async () => (opts.shiftCounts?.io ?? []).flatMap((c) => Array.from({ length: c._count._all }, (_, i) => ({ id: `io-${c.admissionId}-${i}`, admissionId: c.admissionId, recordedAt: NOW, intakeType: 'ORAL', intakeAmount: 100, outputType: null, outputAmount: null, nurse: null })))) },
    clinicalHandoff: {
      findMany,
      groupBy: vi.fn(async () => opts.shiftCounts?.handoffs ?? []),
      count: vi.fn(async (a: any) => (a.where.acknowledgedAt === null && a.where.createdAt ? 1 : a.where.createdAt ? (opts.total ?? (opts.feed ?? []).length) : 3)),
    },
    isolationPrecaution: { findMany: vi.fn(async () => []) },
    nursePatientAssignment: { findMany: vi.fn(async () => opts.assigns ?? []) },
    dutyEntry: {
      findMany: vi.fn(async (a: any) => (a.distinct ? [{ department: '간호부 (내과병동)' }, { department: '투석실' }] : opts.duty ? opts.duty(a.where) : [])),
      findFirst: vi.fn(async () => (opts.latest === undefined ? null : opts.latest ? { date: opts.latest } : null)),
    },
  };
  const svc = new NursingService(prisma, undefined, { get: vi.fn(async (k: string) => (k === 'nursing.vitals.boardStaleHours' ? (opts.staleHours ?? null) : k === 'nursing.roster.wardDepartments' ? (opts.mapping ?? null) : null)) } as never);
  return { svc, prisma, findMany };
}

const h = (over: Record<string, unknown>) => ({
  id: 'h1', type: 'NURSING_SHIFT', admissionId: 'adm1', patientId: 'p1', illness: 'UNSTABLE', summary: '요약', patientSummary: null,
  actionList: [{ action: 'BST 재측정', status: 'PENDING' }], situationAwareness: null, synthesis: null, pendingItems: null,
  acknowledgedAt: null, createdAt: new Date('2026-10-04T00:30:00Z'), fromDoctor: { id: 'n1' }, toDoctor: { id: 'n2' }, ...over,
});

describe('근무조 창', () => {
  it('🔴 이번(주간)·직전(야간) 창을 병원 표준시로 — 피드는 직전 근무조 시작부터', async () => {
    const { svc, findMany } = board();
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.shift).toMatchObject({ current: 'DAY', previous: 'NIGHT' });
    expect(r.shift.start.toISOString()).toBe(CUR_START.toISOString());
    expect(r.shift.previousStart.toISOString()).toBe(PREV_START.toISOString());
    const feedCall = findMany.mock.calls.find((c: any) => !c[0].distinct)![0];
    expect(feedCall.where).toEqual({ admissionId: { in: ['adm1', 'adm2'] }, createdAt: { gte: PREV_START } });
    expect(feedCall.take).toBe(STATION_HANDOFF_FEED_LIMIT);
  });
});

describe('인계 피드', () => {
  it('🔴 항목마다 근무조·병상·환자 · 잘리면 truncated + 전체 수', async () => {
    const { svc } = board({
      feed: [h({ id: 'a', createdAt: new Date('2026-10-04T00:30:00Z') }), h({ id: 'b', admissionId: 'adm2', patientId: 'p2', createdAt: new Date('2026-10-03T18:00:00Z') })],
      total: 75,
    });
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.handoffs.items.map((x: any) => [x.id, x.shift, x.room, x.bed, x.patientName])).toEqual([['a', 'DAY', '701', '1', '김하나'], ['b', 'NIGHT', '702', '2', '이둘']]);
    expect(r.handoffs).toMatchObject({ total: 75, truncated: true, limit: STATION_HANDOFF_FEED_LIMIT });
    expect(r.summary).toMatchObject({ handoffsInWindow: 75, handoffsInWindowPending: 1, handoffPending: 3 });
  });

  it('대조군 — 다 실었으면 truncated 아님', async () => {
    const { svc } = board({ feed: [h({})], total: 1 });
    expect(((await svc.getStationBoard(undefined, NOW)) as any).handoffs.truncated).toBe(false);
  });
});

describe('입원별 마지막 인계', () => {
  it('🔴 창 밖이어도 싣고 inWindow 로 구분 · 조치 목록이 배열이 아니면 openActions null · 없으면 null', async () => {
    const { svc } = board({ last: [
      { id: 'old', admissionId: 'adm1', illness: 'CRITICAL', summary: 's', patientSummary: 'P 메모', actionList: [{ action: 'a', status: 'DONE' }, { action: 'b', status: 'PENDING' }], acknowledgedAt: null, createdAt: new Date('2026-09-30T00:00:00Z') },
    ] });
    const r: any = await svc.getStationBoard(undefined, NOW);
    const p1 = r.patients.find((x: any) => x.admissionId === 'adm1');
    expect(p1.handoff).toMatchObject({ id: 'old', inWindow: false, openActions: 1, memo: 'P 메모', illness: 'CRITICAL' });
    expect(r.patients.find((x: any) => x.admissionId === 'adm2').handoff).toBeNull();

    const b2 = board({ last: [{ id: 'x', admissionId: 'adm1', illness: null, summary: '요약만', patientSummary: null, actionList: '문자열', acknowledgedAt: null, createdAt: new Date('2026-10-04T00:10:00Z') }] });
    const r2: any = await b2.svc.getStationBoard(undefined, NOW);
    expect(r2.patients.find((x: any) => x.admissionId === 'adm1').handoff).toMatchObject({ inWindow: true, openActions: null, memo: '요약만' });
  });

  it('재원 환자가 없어도 근무조·빈 피드를 말한다(구조가 사라지지 않게)', async () => {
    const { svc, prisma } = board();
    prisma.admission.findMany = vi.fn(async () => []);
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.shift.current).toBe('DAY');
    expect(r.handoffs).toMatchObject({ items: [], total: 0, truncated: false });
  });
});

describe('상·하번 간호사', () => {
  it('🔴 하번 = 이번 근무조(주간 · 그날) · 상번 = 다음 근무조(초번 · 그날) 근무표 · 병원 전체(병동 매핑 없음) · 최신일', async () => {
    const { svc, prisma } = board({
      duty: (w) => (w.shift === 'DAY' ? [{ staffId: 'n1', staffName: '박하번', department: '간호부 (내과병동)' }] : w.shift === 'EVENING' ? [{ staffId: 'n9', staffName: '최상번', department: '간호부 (외과병동)' }] : []),
      latest: new Date('2026-10-04T00:00:00Z'),
      feed: [h({ fromDoctor: { id: 'n1', familyName: '박', givenName: '하번' }, toDoctor: { id: 'n9', familyName: '최', givenName: '상번' } })],
    });
    const r: any = await svc.getStationBoard(undefined, NOW);
    const calls = prisma.dutyEntry.findMany.mock.calls.map((c: any) => c[0].where).filter((w: any) => w.shift);
    expect(calls).toEqual([
      { date: new Date('2026-10-04T00:00:00Z'), shift: 'DAY', role: 'nurse' },
      { date: new Date('2026-10-04T00:00:00Z'), shift: 'EVENING', role: 'nurse' },
    ]);
    expect(r.staffing.rosterScope).toBe('HOSPITAL');
    expect(r.staffing.current).toMatchObject({ shift: 'DAY', roster: [{ userId: 'n1', name: '박하번', department: '간호부 (내과병동)', handoffsToAck: 0 }] });
    expect(r.staffing.next).toMatchObject({ shift: 'EVENING', roster: [{ userId: 'n9', name: '최상번', handoffsToAck: 1 }] });
    expect(r.staffing.rosterLatestDate.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('🔴 야간(23시 시작)의 근무표 날짜는 시작한 날 — 자정 넘은 새벽에도 전날', async () => {
    const { svc, prisma } = board();
    await svc.getStationBoard(undefined, new Date('2026-10-03T17:00:00Z')); // KST 10-04 02:00 → 야간(10-03 23시 시작)
    const w = prisma.dutyEntry.findMany.mock.calls.map((c: any) => c[0].where).filter((x: any) => x.shift);
    expect(w[0]).toEqual({ date: new Date('2026-10-03T00:00:00Z'), shift: 'NIGHT', role: 'nurse' });
    expect(w[1]).toEqual({ date: new Date('2026-10-04T00:00:00Z'), shift: 'DAY', role: 'nurse' });
  });

  it('🔴 담당 간호사 — 배정이 없으면 null(지어내지 않는다) · 담당자별 환자 수·남긴 인계·미확인', async () => {
    const nurse = { id: 'n1', familyName: '박', givenName: '하번' };
    const { svc } = board({
      assigns: [{ admissionId: 'adm1', shiftType: 'DAY', isPrimary: true, assignedAt: new Date('2026-10-03T22:10:00Z'), nurse }],
      feed: [h({ fromDoctor: nurse }), h({ id: 'h2', fromDoctor: nurse, acknowledgedAt: new Date() })],
    });
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.patients.find((x: any) => x.admissionId === 'adm1').nurse).toMatchObject({ id: 'n1', name: '박하번', shiftType: 'DAY', isPrimary: true });
    expect(r.patients.find((x: any) => x.admissionId === 'adm2').nurse).toBeNull();
    expect(r.staffing.assignees).toEqual([{ userId: 'n1', name: '박하번', patients: 1, handoffsWritten: 2, handoffsUnacked: 1, handoffsToAck: 0 }]);
  });

  it('근무표가 비면 빈 목록 + 최신일 null — "근무자 없음"을 단정할 재료를 지어내지 않는다', async () => {
    const { svc } = board();
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.staffing).toMatchObject({ current: { roster: [] }, next: { roster: [] }, rosterLatestDate: null, assignees: [] });
  });
});

describe('⑧ 근무표 부서 ↔ 병동 연결', () => {
  it('🔴 병동을 골랐고 연결이 있으면 그 부서만(WARD) · 연결 없는 병동은 전체 + wardUnmapped · 병동 안 고르면 전체', async () => {
    const mapping = { w1: ['간호부 (내과병동)'], bad: 'x' };
    const a = board({ mapping });
    const ra: any = await a.svc.getStationBoard('w1', NOW);
    const wa = a.prisma.dutyEntry.findMany.mock.calls.map((c: any) => c[0].where).filter((w: any) => w.shift);
    expect(wa.every((w: any) => JSON.stringify(w.department) === JSON.stringify({ in: ['간호부 (내과병동)'] }))).toBe(true);
    expect(ra.staffing).toMatchObject({ rosterScope: 'WARD', wardDepartments: ['간호부 (내과병동)'], wardUnmapped: false, rosterDepartments: ['간호부 (내과병동)', '투석실'] });

    const b = board({ mapping });
    const rb: any = await b.svc.getStationBoard('w2', NOW);
    expect(b.prisma.dutyEntry.findMany.mock.calls.map((c: any) => c[0].where).filter((w: any) => w.shift).every((w: any) => !w.department)).toBe(true);
    expect(rb.staffing).toMatchObject({ rosterScope: 'HOSPITAL', wardDepartments: null, wardUnmapped: true });

    const c = board({ mapping });
    const rc: any = await c.svc.getStationBoard(undefined, NOW);
    expect(rc.staffing).toMatchObject({ rosterScope: 'HOSPITAL', wardUnmapped: false });
  });
});

describe('병동 근무조 마감 — 이번 근무조 기록 유무', () => {
  it('🔴 이번 근무조 창(시작~끝)으로 센다 · 투약은 시작~지금 예정분만 · 유무만 · 요약은 기록 없는 환자 수', async () => {
    const { svc, prisma } = board({
      shiftCounts: { notes: [{ admissionId: 'adm1', _count: { _all: 2 } }], vitals: [{ admissionId: 'adm2', _count: { _all: 1 } }], io: [], handoffs: [{ admissionId: 'adm1', _count: { _all: 1 } }] },
      medsSoFar: [{ patientId: 'p1', status: 'GIVEN' }, { patientId: 'p1', status: 'SCHEDULED' }, { patientId: 'p2', status: 'SCHEDULED' }],
    });
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(prisma.nursingNote.groupBy.mock.calls[0][0].where.recordedAt).toEqual({ gte: CUR_START, lt: new Date('2026-10-04T06:00:00Z') });
    const soFar = prisma.medicationAdministration.findMany.mock.calls.find((c: any) => !c[0].where.status)[0].where.scheduledAt;
    expect(soFar).toEqual({ gte: CUR_START, lt: NOW }); // 아직 오지 않은 시각은 미처리가 아니다
    const p1 = r.patients.find((x: any) => x.admissionId === 'adm1').shiftRecord;
    const p2 = r.patients.find((x: any) => x.admissionId === 'adm2').shiftRecord;
    expect(p1).toEqual({ notes: 2, vitals: 0, io: 0, medsDue: 2, medsPending: 1, handoffs: 1 });
    expect(p2).toEqual({ notes: 0, vitals: 1, io: 0, medsDue: 1, medsPending: 1, handoffs: 0 });
    expect(r.summary).toMatchObject({ shiftWithoutNote: 1, shiftWithoutVitals: 1, shiftWithoutHandoff: 1, shiftMedsPending: 2 });
  });
});

describe('④ 활력 경과', () => {
  it('🔴 간호 스테이션 입력(외래 원장 · 재원 기간 안)도 마지막 활력이다 — 종전 "측정 없음"(2026-10-10)', async () => {
    const { svc, prisma } = board();
    prisma.preVisitVitals.findFirst.mockImplementation(async (a: any) => (a.where.patientId === 'p2' && a.where.measuredAt.gte <= new Date('2026-10-03T23:00:00Z')
      ? { id: 'pv1', patientId: 'p2', nurseId: 'n1', measuredAt: new Date('2026-10-03T23:00:00Z') } : null));
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.patients.find((x: any) => x.admissionId === 'adm2').lastVitalsAt.toISOString()).toBe('2026-10-03T23:00:00.000Z');
    expect(r.patients.find((x: any) => x.admissionId === 'adm1').lastVitalsAt).toBeNull();
    // 재원 기간 조건 — 입원 시각 이상만 조회한다
    const pvCall = prisma.preVisitVitals.findFirst.mock.calls.find((c: any) => c[0].where.patientId === 'p2')[0];
    expect(pvCall.where.measuredAt.gte.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('🔴 기준 미설정이면 경과만 — 초과 수는 null(0 으로 접지 않는다) · 측정 없는 환자는 따로 · 마지막 측정은 활력 정본에서', async () => {
    const { svc, prisma } = board({ lastVitals: [{ admissionId: 'adm1', _max: { recordedAt: new Date('2026-10-03T20:00:00Z') } }] });
    const r: any = await svc.getStationBoard(undefined, NOW);
    // 두 원장 정본 — 플로시트 최신(distinct)과 재원 기간 안 외래 원장 최신을 함께 본다
    expect(prisma.flowSheetEntry.findMany.mock.calls.some((c: any) => c[0].distinct?.includes('admissionId'))).toBe(true);
    expect(prisma.preVisitVitals.findFirst).toHaveBeenCalled();
    expect(r.patients.find((x: any) => x.admissionId === 'adm1').lastVitalsAt.toISOString()).toBe('2026-10-03T20:00:00.000Z');
    expect(r.patients.find((x: any) => x.admissionId === 'adm2').lastVitalsAt).toBeNull();
    expect(r.summary).toMatchObject({ vitalsStaleHours: null, vitalsStale: null, vitalsNever: 1 });
  });
  it('기준이 설정되면 그 시간을 넘은 환자 수 · 범위 밖 값(0·100·소수)은 미설정으로', async () => {
    const lv = [{ admissionId: 'adm1', _max: { recordedAt: new Date('2026-10-03T20:00:00Z') } }]; // NOW 기준 5시간 전
    expect(((await board({ lastVitals: lv, staleHours: 4 }).svc.getStationBoard(undefined, NOW)) as any).summary).toMatchObject({ vitalsStaleHours: 4, vitalsStale: 1 });
    expect(((await board({ lastVitals: lv, staleHours: 6 }).svc.getStationBoard(undefined, NOW)) as any).summary).toMatchObject({ vitalsStaleHours: 6, vitalsStale: 0 });
    for (const bad of [0, 100, 2.5, 'x']) expect(((await board({ lastVitals: lv, staleHours: bad }).svc.getStationBoard(undefined, NOW)) as any).summary.vitalsStaleHours).toBeNull();
  });
});

describe('⑤~⑦ 위급값·수술·금식·퇴원·전동', () => {
  it('🔴 위급값은 열린 상태(정본)만 · 수술은 오늘(병원 표준시)~내일 · 금식은 활성 NPO 오더 · 전동은 받는 병동 이름', async () => {
    const { svc, prisma } = board({
      crit: [{ id: 'c1', patientId: 'p1', testName: 'K', value: '6.8', unit: 'mmol/L', status: 'PENDING', notifiedAt: new Date('2026-10-04T00:10:00Z') }],
      surg: [{ id: 's1', patientId: 'p2', scheduledAt: new Date('2026-10-04T05:00:00Z'), procedureName: '복강경 담낭절제', status: 'SCHEDULED' }],
      npo: [{ admissionId: 'adm2', startDate: new Date('2026-10-04T00:00:00Z') }],
      transfers: [{ id: 't1', admissionId: 'adm1', targetWardId: 'w9', requestedAt: new Date('2026-10-04T00:20:00Z') }],
    });
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(prisma.criticalValueAlert.findMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'ESCALATED'] });
    const sw = prisma.surgery.findMany.mock.calls[0][0].where;
    expect(sw.scheduledAt.lt.toISOString()).toBe('2026-10-05T15:00:00.000Z'); // 10-04 KST 자정 + 2일
    expect(prisma.dietOrder.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, dietType: 'NPO' });
    const p1 = r.patients.find((x: any) => x.admissionId === 'adm1');
    const p2 = r.patients.find((x: any) => x.admissionId === 'adm2');
    expect(p1.criticalOpen).toEqual([{ id: 'c1', testName: 'K', value: '6.8', unit: 'mmol/L', status: 'PENDING', notifiedAt: new Date('2026-10-04T00:10:00Z') }]);
    expect(p1.transferPending).toMatchObject({ id: 't1', targetWard: '9병동' });
    expect(p2).toMatchObject({ surgery: { procedureName: '복강경 담낭절제' }, npo: { since: new Date('2026-10-04T00:00:00Z') }, criticalOpen: [] });
    expect(p1.surgery).toBeNull(); expect(p1.npo).toBeNull();
    expect(r.summary).toMatchObject({ criticalOpenPatients: 1, surgeryUpcoming: 1, npo: 1, transferPending: 1 });
  });
});

describe('⑦ 퇴원 예정', () => {
  it('🔴 오늘(병원 표준시) 퇴원 예정만 센다 — 내일·어제는 아니다', async () => {
    const { svc, prisma } = board();
    prisma.admission.findMany = vi.fn(async () => [
      { id: 'adm1', admitDate: new Date('2026-10-01T00:00:00Z'), expectedDischargeDate: new Date('2026-10-04T02:00:00Z'), patientId: 'p1', patient: { familyName: '김', givenName: '하나', mrn: 'M1' }, bed: { roomNumber: '701', bedNumber: '1', ward: { id: 'w1', name: '7병동' } } },
      { id: 'adm2', admitDate: new Date('2026-10-01T00:00:00Z'), expectedDischargeDate: new Date('2026-10-04T16:00:00Z'), patientId: 'p2', patient: { familyName: '이', givenName: '둘', mrn: 'M2' }, bed: { roomNumber: '702', bedNumber: '2', ward: { id: 'w1', name: '7병동' } } },
    ]);
    const r: any = await svc.getStationBoard(undefined, NOW);
    expect(r.summary.dischargeToday).toBe(1); // 10-05 01:00 KST 는 내일
    expect(r.patients.find((x: any) => x.admissionId === 'adm2').expectedDischargeAt.toISOString()).toBe('2026-10-04T16:00:00.000Z');
  });
});

describe('⑩ 벽걸이(TV) — 서버 마스킹 계약', () => {
  it('🔴 원문 이름·등록번호·인계 메모·검사값·술식명·근무표 부서가 응답 어디에도 없다 · 이름은 홍○동 · 허용 목록 키만', async () => {
    const nurse = { id: 'n1', familyName: '박', givenName: '하번이' };
    const { svc } = board({
      last: [{ id: 'h', admissionId: 'adm1', illness: 'CRITICAL', summary: '흉통 비밀 메모', patientSummary: 'P 비밀 메모', actionList: [], acknowledgedAt: null, createdAt: new Date('2026-10-04T00:00:00Z') }],
      feed: [h({ summary: '피드 비밀 요약' })],
      assigns: [{ admissionId: 'adm1', shiftType: 'DAY', isPrimary: true, assignedAt: new Date('2026-10-03T22:10:00Z'), nurse }],
      crit: [{ id: 'c1', patientId: 'p1', testName: '칼륨', value: '6.8', unit: 'mmol/L', status: 'PENDING', notifiedAt: new Date('2026-10-04T00:10:00Z') }],
      surg: [{ id: 's1', patientId: 'p2', scheduledAt: new Date('2026-10-04T05:00:00Z'), procedureName: '복강경 담낭절제', status: 'SCHEDULED' }],
      duty: () => [{ staffId: 'n1', staffName: '박하번이', department: '간호부 (내과병동)' }],
    });
    const w: any = await svc.getStationWall(undefined, NOW);
    const json = JSON.stringify(w);
    for (const leak of ['김하나', '이둘', 'M1', 'M2', '비밀', '칼륨', '6.8', 'mmol', '복강경', '간호부', '하번이', 'p1', 'adm1']) expect(json, leak).not.toContain(leak);
    const p1 = w.patients.find((x: any) => x.room === '701');
    expect(p1).toMatchObject({ name: '김○나', criticalOpen: 1, handoffUnacked: true, nurse: '박○이' });
    expect(Object.keys(p1).sort()).toEqual(['bed', 'criticalOpen', 'ewsRisk', 'ewsStale', 'expectedDischargeAt', 'fallRisk', 'handoffUnacked', 'highRisk', 'isolation', 'medsOverdue', 'name', 'npo', 'nurse', 'room', 'surgeryAt', 'surgeryInProgress', 'transferPending', 'ward']);
    expect(Object.keys(w).sort()).toEqual(['generatedAt', 'patients', 'shift', 'summary', 'wardName']);
    expect(w.patients.find((x: any) => x.room === '702').surgeryAt.toISOString()).toBe('2026-10-04T05:00:00.000Z');
  });

  it('🔴 24시간 넘은 EWS·낙상 평가는 등급을 보이지 않는다(오래됐다는 표시만)', async () => {
    const { svc, prisma } = board();
    prisma.$queryRaw = vi.fn(async (q: any) => {
      const sql = String(q.strings?.join('?') ?? q);
      if (sql.includes('early_warning_scores')) return [{ patient_id: 'p1', total_score: 7, risk_level: 'HIGH', escalation_required: true, recorded_at: new Date('2026-10-01T00:00:00Z') }];
      return [];
    });
    const w: any = await svc.getStationWall(undefined, NOW);
    expect(w.patients.find((x: any) => x.room === '701')).toMatchObject({ ewsRisk: null, ewsStale: true });
  });

  it('벽걸이 라우트 — 직원 인증 컨트롤러(공개 아님) · 서비스 getStationWall', () => {
    const c = readFileSync(join(__dirname, '../../src/modules/nursing/nursing-station.controller.ts'), 'utf8');
    expect(c).toMatch(/@Get\('station-board\/wall'\)[\s\S]{0,300}getStationWall\(wardId\)/);
    expect(c).not.toMatch(/@Public\(\)/);
  });
});

describe('인계 생성 — 입원 ↔ 환자', () => {
  const mk = (admPatient: string | null) => {
    const create = vi.fn(async () => ({ id: 'h', patient: { familyName: '김', givenName: '하나', mrn: 'M' }, fromDoctor: { familyName: '박', givenName: '간호' } }));
    const prisma: any = {
      admission: { findUnique: vi.fn(async () => (admPatient ? { patientId: admPatient } : null)) },
      clinicalHandoff: { create },
    };
    return { svc: new InpatientService(prisma), create };
  };
  const dto = { type: 'NURSING_SHIFT', patientId: 'p1', fromDoctorId: 'n1', toDoctorId: 'n2', admissionId: 'adm1', summary: 's' };

  it('🔴 입원의 환자와 다르면 400 · 저장하지 않는다', async () => {
    const { svc, create } = mk('p-other');
    await expect(svc.createHandoff(dto)).rejects.toMatchObject({ response: { code: 'HANDOFF_PATIENT_MISMATCH' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('없는 입원은 404 · 대조군: 같은 환자면 저장', async () => {
    await expect(mk(null).svc.createHandoff(dto)).rejects.toThrow(/입원을 찾을 수 없습니다/);
    const ok = mk('p1');
    await ok.svc.createHandoff(dto);
    expect(ok.create).toHaveBeenCalled();
  });
});

describe('어휘 정본', () => {
  it('🔴 DTO 는 shared HANDOFF_ILLNESS 를 쓴다 · 시드 생성기도 그 코드만', () => {
    const dtoSrc = readFileSync(join(__dirname, '../../src/modules/inpatient/dto/inpatient.dto.ts'), 'utf8');
    expect(dtoSrc).toMatch(/@IsIn\(\[\.\.\.HANDOFF_ILLNESS\]\)/);
    const seed = readFileSync(join(__dirname, '../../prisma/seeds/clinical-volume-nursing.ts'), 'utf8');
    const m = seed.match(/const ILLNESS = \[([^\]]+)\]/)!;
    const vals = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(vals.length).toBeGreaterThan(0);
    for (const v of vals) expect(HANDOFF_ILLNESS as readonly string[]).toContain(v);
  });
});
