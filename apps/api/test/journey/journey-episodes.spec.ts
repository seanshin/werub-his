/**
 * 방문 묶음(2026-10-01 · 여정 P3 표시 잔여 · `patient-journey-model.plan.md` §6 표시 UX "남은 것").
 *  · 방문 요약은 **도메인 원장**에서(여정 원장 아님) — 시작·끝·상태
 *  · 🔴 끝을 지어내지 않는다: 외래 끝(D8)·응급 퇴실(D9)은 정의·원천이 없어 끝을 비우고 이유를 싣는다
 *       (대기열 완료 시각·처분 시각을 끝으로 그리지 않는다 — 처분은 결정 시각 milestone)
 *  · 모르는 상태값은 UNKNOWN(진행 중·끝남으로 추정하지 않는다) · 유형마다 상한·잘림 고지
 *  · 타임라인 방문 거르기는 서버에서 — 관계표(P1 이후) **또는** 옛 refType·refId(P1 전 행)
 * 재주입: 응급 완료를 ENDED+처분 시각 끝으로 되돌리면 실패 · 옛 refType 분기를 지우면 실패.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JourneyService } from '../../src/modules/journey/journey.service';
import { JourneyController } from '../../src/modules/journey/journey.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { PHI_READ_PATTERNS } from '../../src/modules/audit/audit-routes';
import {
  admissionEpisode, checkupEpisode, emergencyEpisode, outpatientEpisode, surgeryEpisode,
} from '../../src/modules/journey/journey-episodes';

const d = (s: string) => new Date(s);
const ID = '11111111-1111-4111-8111-111111111111';

describe('방문 요약 — 끝을 지어내지 않는다', () => {
  it('🔴 (결정 D9) 응급 완료: 끝 = 퇴실 시각 · 퇴실 시각이 없으면 끝 없음 + 이유 · 처분은 결정 시각(끝 아님)', () => {
    const base = { id: ID, status: 'COMPLETED', arrivalAt: d('2026-10-01T01:00:00Z'), disposition: 'ADMISSION', dispositionAt: d('2026-10-01T04:00:00Z') };
    expect(emergencyEpisode({ ...base, departedAt: d('2026-10-01T06:00:00Z') }))
      .toMatchObject({ state: 'ENDED', endAt: '2026-10-01T06:00:00.000Z', endUnavailableReason: null });
    const e = emergencyEpisode({ ...base, departedAt: null });
    expect(e).toMatchObject({ state: 'END_UNDEFINED', endAt: null, endUnavailableReason: 'DEPARTURE_NOT_RECORDED' });
    expect(e.milestone).toEqual({ kind: 'DISPOSITION', at: '2026-10-01T04:00:00.000Z' });
    // 도착보다 앞선 퇴실(데이터 결함)은 끝으로 쓰지 않는다
    expect(emergencyEpisode({ ...base, departedAt: d('2026-10-01T00:00:00Z') }).state).toBe('END_UNDEFINED');
    // 대조군: 진행 중이면 이유가 없다
    expect(emergencyEpisode({ id: ID, status: 'IN_TREATMENT', arrivalAt: d('2026-10-01T01:00:00Z'), disposition: null, dispositionAt: null }))
      .toMatchObject({ state: 'OPEN', endUnavailableReason: null, milestone: null });
  });

  it('🔴 (결정 D8) 외래: 끝 = 그 진료의 수납 완료 · 수납 전이면 끝 없음(대기열 완료를 끝으로 그리지 않는다) · 취소·미방문은 취소', () => {
    const q = { id: ID, departmentName: '내과', checkedInAt: d('2026-10-01T00:00:00Z') };
    expect(outpatientEpisode({ ...q, status: 'PHARMACY_WAITING', billing: { status: 'PAID', paidAt: d('2026-10-01T01:30:00Z') } }))
      .toMatchObject({ state: 'ENDED', endAt: '2026-10-01T01:30:00.000Z', endUnavailableReason: null });
    expect(outpatientEpisode({ ...q, status: 'VISIT_COMPLETED', billing: { status: 'PENDING', paidAt: null } }))
      .toMatchObject({ state: 'END_UNDEFINED', endAt: null, endUnavailableReason: 'OUTPATIENT_NOT_PAID', title: '내과' });
    expect(outpatientEpisode({ ...q, status: 'VISIT_COMPLETED' }).endUnavailableReason).toBe('OUTPATIENT_NOT_PAID'); // 수납 원장 없음
    expect(outpatientEpisode({ id: ID, departmentName: '내과', status: 'NO_SHOW', checkedInAt: d('2026-10-01T00:00:00Z') }).state).toBe('CANCELLED');
    expect(outpatientEpisode({ id: ID, departmentName: '내과', status: 'IN_CONSULTATION', checkedInAt: d('2026-10-01T00:00:00Z') }).state).toBe('OPEN');
  });

  it('입원 퇴원은 끝을 말한다 · 취소 · 퇴원 상태인데 퇴원일이 없으면 추정하지 않는다', () => {
    expect(admissionEpisode({ id: ID, status: 'DISCHARGED', admitDate: d('2026-09-20T00:00:00Z'), dischargeDate: d('2026-09-25T00:00:00Z'), wardName: '5병동' }))
      .toMatchObject({ state: 'ENDED', endAt: '2026-09-25T00:00:00.000Z', title: '5병동' });
    expect(admissionEpisode({ id: ID, status: 'CANCELLED', admitDate: d('2026-09-20T00:00:00Z'), dischargeDate: null, wardName: null }).state).toBe('CANCELLED');
    expect(admissionEpisode({ id: ID, status: 'DISCHARGED', admitDate: d('2026-09-20T00:00:00Z'), dischargeDate: null, wardName: null }))
      .toMatchObject({ state: 'UNKNOWN', endAt: null });
  });

  it('수술 예정은 "예정"(진행 중 아님) · 검진 예약은 날짜만 · 모르는 상태값은 UNKNOWN', () => {
    expect(surgeryEpisode({ id: ID, status: 'SCHEDULED', procedureName: 'LC', scheduledAt: d('2026-10-05T00:00:00Z'), startedAt: null, endedAt: null }))
      .toMatchObject({ state: 'PLANNED', startAt: null, milestone: { kind: 'SCHEDULED' } });
    const ck = checkupEpisode({ id: ID, status: 'RESERVED', scheduledDate: d('2026-10-10T00:00:00Z'), checkedInAt: null, completedAt: null, programName: '종합' });
    expect(ck).toMatchObject({ state: 'PLANNED', milestone: { kind: 'RESERVED_DATE', at: '2026-10-10' } });
    // 운영 저장값 전수(2026-10-01): 검사완료·부분완료·판정 중은 진행 중 · 통보(DELIVERED)는 끝
    for (const st of ['EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW']) {
      expect(checkupEpisode({ id: ID, status: st, scheduledDate: d('2026-10-10T00:00:00Z'), checkedInAt: d('2026-10-10T00:00:00Z'), completedAt: null, programName: null }).state, st).toBe('OPEN');
    }
    expect(checkupEpisode({ id: ID, status: 'DELIVERED', scheduledDate: d('2026-10-10T00:00:00Z'), checkedInAt: d('2026-10-10T00:00:00Z'), completedAt: d('2026-10-10T05:00:00Z'), programName: null }).state).toBe('ENDED');
    expect(checkupEpisode({ id: ID, status: 'WEIRD', scheduledDate: d('2026-10-10T00:00:00Z'), checkedInAt: null, completedAt: null, programName: null }).state).toBe('UNKNOWN');
  });
});

describe('getEpisodes — 도메인 원장 · 최신순 · 유형별 상한', () => {
  it('유형마다 상한을 넘으면 그 유형을 잘렸다고 말한다 · 최신 시작이 앞', async () => {
    const N = JourneyService.EPISODES_PER_TYPE;
    const qs = Array.from({ length: N + 1 }, (_, i) => ({ id: `q${i}`, departmentName: '내과', status: 'COMPLETED', checkedInAt: d(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`) }));
    const prisma = {
      waitingQueue: { findMany: vi.fn(async () => qs) },
      emergencyVisit: { findMany: vi.fn(async () => [{ id: 'er', status: 'TRIAGED', arrivalAt: d('2026-10-01T00:00:00Z'), disposition: null, dispositionAt: null }]) },
      admission: { findMany: vi.fn(async () => []) },
      surgery: { findMany: vi.fn(async () => []) },
      checkupVisit: { findMany: vi.fn(async () => []) },
    };
    const r = await new JourneyService(prisma as never, {} as never).getEpisodes(ID);
    expect(r.truncatedTypes).toEqual(['WaitingQueue']);
    expect(r.episodes.filter((e) => e.type === 'WaitingQueue')).toHaveLength(N);
    expect(r.episodes[0]).toMatchObject({ type: 'EmergencyVisit', id: 'er' });
    expect(prisma.waitingQueue.findMany.mock.calls[0][0]).toMatchObject({ where: { patientId: ID }, take: N + 1 });
  });
});

describe('타임라인 방문 거르기 — 서버에서', () => {
  it('🔴 관계표 또는 옛 refType·refId(P1 전 행) — 둘 다 본다', async () => {
    const $queryRaw = vi.fn(async () => []);
    await new JourneyService({ $queryRaw, patientJourneyEvent: { findMany: vi.fn() } } as never, {} as never)
      .getTimeline('p1', { episode: { type: 'Admission', id: ID } });
    const q = ($queryRaw.mock.calls[0] as unknown as [{ sql: string; values: unknown[] }])[0];
    expect(q.sql).toMatch(/EXISTS \(SELECT 1 FROM patient_journey_event_objects o WHERE o\.event_id = e\.id AND o\.qualifier = 'episode'/);
    expect(q.sql).toMatch(/OR \(e\.ref_type = ANY\(\?::text\[\]\) AND e\.ref_id = \?::uuid\)/);
    expect(q.values).toContainEqual(['ADMISSION']);
    expect(q.values.filter((v) => v === ID)).toHaveLength(2);
    expect(q.values).toContain('Admission');
  });

  it('컨트롤러 — 둘 중 하나만·방문 단위 아닌 유형·UUID 아님은 400 · 대조군: 정상은 넘긴다', async () => {
    const svc = { getTimeline: vi.fn(async () => ({ events: [], truncated: false, olderCursor: null })) };
    const c = new JourneyController(svc as never);
    await expect(c.getTimeline(ID, undefined, undefined, undefined, undefined, undefined, 'Admission', undefined)).rejects.toThrow(BadRequestException);
    await expect(c.getTimeline(ID, undefined, undefined, undefined, undefined, undefined, 'Order', ID)).rejects.toThrow(BadRequestException);
    await expect(c.getTimeline(ID, undefined, undefined, undefined, undefined, undefined, 'Admission', 'x')).rejects.toThrow(BadRequestException);
    await c.getTimeline(ID, undefined, undefined, undefined, undefined, undefined, 'Admission', ID);
    expect(svc.getTimeline).toHaveBeenCalledWith(ID, expect.objectContaining({ episode: { type: 'Admission', id: ID } }));
  });
});

describe('400 문구의 유형 목록 — shared 와 같다', () => {
  it('정적 문구(서버 조립 문장 가드)라 손으로 적었다 — 방문 단위 유형이 바뀌면 여기서 갈라짐을 잡는다', async () => {
    const { JOURNEY_EPISODE_OBJECT_TYPES } = await import('@hospital-run/shared');
    const src = (await import('node:fs')).readFileSync(require('node:path').join(__dirname, '../../src/modules/journey/journey.controller.ts'), 'utf8');
    const msg = src.match(/episodeType 은 방문 단위 유형\(([^)]+)\)/)![1].split('·');
    expect(msg.sort()).toEqual([...JOURNEY_EPISODE_OBJECT_TYPES].sort());
  });
});

describe('권한·감사', () => {
  it('방문 묶음은 타임라인과 같은 역할 · 환자 지목 열람 감사 대상', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, JourneyController.prototype.getEpisodes) as UserRole[];
    expect([...roles].sort()).toEqual([UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE].sort());
    expect(PHI_READ_PATTERNS.some((re: RegExp) => re.test(`/api/v1/journey/${ID}/episodes`))).toBe(true);
  });
});
