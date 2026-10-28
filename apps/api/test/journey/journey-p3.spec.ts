/**
 * 환자 여정 P3(2026-10-01 · `patient-journey-model.plan.md` §6 P3) — 결정 대기 항목은 열지 않고, 열 수 있는 것만.
 *  · P3-1 반출 준비도: **집계만**(사건·환자 데이터를 싣지 않는다) · 반출 경로 없음(결정 `journey.exportMode`) · 관리자 전용
 *  · 타임라인 응답이 방문 단위(episode) 관계를 싣는다(화면의 "이 방문만")
 *  · 30일 재입원: 취소된 입원은 재입원이 아니다(종전엔 셌다)
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JourneyService } from '../../src/modules/journey/journey.service';
import { JourneyController } from '../../src/modules/journey/journey.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const svcWith = (prisma: unknown) => new JourneyService(prisma as never, {} as never);

describe('P3-1 반출 준비도', () => {
  function prisma() {
    const count = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.occurredAt) return 4;
      if (where.eventType) return 9;
      if (where.objects) return 6;
      return 10;
    });
    return {
      patientJourneyEvent: { count, groupBy: vi.fn(async () => [{ dataOrigin: 'LIVE', _count: { _all: 7 } }, { dataOrigin: 'DEMO', _count: { _all: 3 } }]) },
      patientJourneyEventObject: {
        groupBy: vi.fn(async () => [{ eventId: 'e1', _count: { _all: 2 } }]),
        findMany: vi.fn(async () => [{ objectId: 'a' }, { objectId: 'b' }]),
      },
    };
  }
  it('🔴 집계만 낸다 — 시각 미상·매핑 불가·평탄화(결핍/수렴)·출처별 · 반출 경로 없음(결정 키)', async () => {
    const r = await svcWith(prisma()).exportReadiness({ caseType: 'EmergencyVisit', from: '2026-09-01', to: '2026-09-30' });
    expect(r.events).toEqual({ total: 10, withOccurredAt: 4, unknownTime: 6, mappable: 9, unmappable: 1, byOrigin: { LIVE: 7, DEMO: 3 } });
    expect(r.flattening).toEqual({ cases: 2, relatedToCase: 6, deficiency: 4, convergence: 1 });
    expect(r.export).toEqual({ available: false, reason: 'NO_EXPORT_PATH', decisionKey: 'journey.exportMode' });
    expect(r.period.basis).toBe('RECORDED_AT');
    // 사건·환자 데이터가 실리지 않는다
    expect(JSON.stringify(r)).not.toMatch(/patientId|title|description/);
  });
  it('사례 기준은 방문 단위 유형만 · 관리자 전용 EP', async () => {
    await expect(svcWith(prisma()).exportReadiness({ caseType: 'Order' })).rejects.toBeInstanceOf(BadRequestException);
    const roles = Reflect.getMetadata(ROLES_KEY, JourneyController.prototype.exportReadiness);
    expect(roles).toEqual([UserRole.ADMIN]);
  });
});

describe('타임라인 — 방문 단위 관계를 싣는다', () => {
  it('episode 관계만 include · 대조군: 종전 필드·잘림은 그대로', async () => {
    const findMany = vi.fn(async () => [{ id: 'e1', eventAt: new Date('2026-10-01T00:00:00Z'), objects: [{ objectType: 'Admission', objectId: 'a1' }] }]);
    // (2026-10-01) 정렬·잘림은 매개변수 SQL 이 id 를 고르고(발생 시각 기준) 행·관계는 Prisma 로 읽는다
    const $queryRaw = vi.fn(async () => [{ id: 'e1', sort_at: new Date('2026-10-01T00:00:00Z') }]);
    const r = await svcWith({ $queryRaw, patientJourneyEvent: { findMany } }).getTimeline('p1');
    expect(findMany.mock.calls[0][0]).toMatchObject({ include: { objects: { where: { qualifier: 'episode' } } } });
    expect(r.events[0]).toMatchObject({ objects: [{ objectType: 'Admission' }] });
    expect(r.truncated).toBe(false);
  });
});

describe('30일 재입원 — 취소된 입원은 재입원이 아니다', () => {
  it('🔴 퇴원 뒤 취소된 입원만 있으면 재입원 0 · 대조군: 실제 입원이면 1', async () => {
    const make = (laterStatus: string) => {
      const later = [{ patientId: 'p1', admitDate: new Date('2026-09-10T00:00:00Z'), status: laterStatus }];
      return {
        waitingQueue: { findMany: vi.fn(async () => []) },
        emergencyVisit: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
        billing: { findMany: vi.fn(async () => []) },
        admission: {
          findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
            if (where.patientId) return later.filter((a) => !(where.status?.not && a.status === where.status.not));
            if (where.dischargeDate && where.status === 'DISCHARGED' && !where.admitDate) {
              return [{ patientId: 'p1', dischargeDate: new Date('2026-09-05T00:00:00Z') }];
            }
            return [];
          }),
        },
      };
    };
    const opts = { from: '2026-09-01', to: '2026-09-30' };
    const cancelled = await svcWith(make('CANCELLED')).getMetrics(opts);
    const real = await svcWith(make('ADMITTED')).getMetrics(opts);
    expect(cancelled.readmissionRate30Days).toBe(0);
    expect(real.readmissionRate30Days).toBe(100);
  });
});

describe('표시 정본 — 라벨이 화면 언어에 등재돼 있다', () => {
  it('🔴 유형·트랙·방문·전이·출처 라벨이 전부 카탈로그에 있다(새 유형이 원문+미등록 티로 새지 않게)', async () => {
    const s = await import('@hospital-run/shared');
    const labels = new Set<string>([
      ...Object.values(s.JOURNEY_EVENT_DISPLAY).map((v) => v.label),
      ...Object.values(s.JOURNEY_TRACKS),
      ...(Object.values(s.JOURNEY_EPISODE_LABEL) as string[]),
      ...Object.values(s.JOURNEY_TRANSITION_BADGE).map((v) => v.label),
      ...Object.values(s.JOURNEY_ORIGIN_BADGE),
    ]);
    expect(labels.size).toBeGreaterThan(60);
    expect([...labels].filter((k) => s.tOf(k, 'en').missing)).toEqual([]);
  });
});
