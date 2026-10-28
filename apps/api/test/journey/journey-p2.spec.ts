/**
 * 환자 여정 P2(2026-10-01 · `docs/01-plan/features/patient-journey-model.plan.md` §6 P2).
 *  · P2-1 어휘 전 항목이 활동·전이로 매핑된다 · 한 번만 일어나는 전이는 멱등 키로 이중 발행을 막는다
 *  · P2-2 응급 처분: 최초 결정은 COMPLETED 로 **한 번** · 같은 결정 재클릭은 사건 아님 · 변경은 REVISED(앞 결정을 가리킨다)
 *         · 데모 정리(deleteMany)는 REAL 에서 막힌다 · 여정 행 갱신·삭제는 데모 정리 도구만(I1)
 *  · P2-3 감시자 79·80·81 — 경계 시각이 shared 등록부와 같다
 *  · P2-4 관측 범위 등록부 — 근거 커밋 형식·보고서가 기록 범위 밖을 말한다
 *  · P2-5 발행기 상태 — 이중 발행 억제는 실패로 세지 않는다
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  JOURNEY_ACTIVITY_MAP, JOURNEY_EVENT_TYPES, JOURNEY_OBSERVED_SINCE, JOURNEY_REF_ATTACHED_SINCE, JOURNEY_TRANSITIONS,
} from '@hospital-run/shared';
import { JourneyService, journeyActivityFields } from '../../src/modules/journey/journey.service';
import { buildJourneyReport } from '../../src/modules/journey/journey-report';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { PatientAuthController } from '../../src/modules/patient-auth/patient-auth.controller';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

const V = '11111111-1111-4111-8111-111111111111';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('P2-1 활동·전이 매핑', () => {
  it('🔴 어휘 전 항목이 매핑되고 전이는 어휘 안에 있다(빠지면 새 행의 activity 가 null 이 된다)', () => {
    const missing = JOURNEY_EVENT_TYPES.filter((t) => !JOURNEY_ACTIVITY_MAP[t]);
    expect(missing).toEqual([]);
    for (const v of Object.values(JOURNEY_ACTIVITY_MAP)) expect(JOURNEY_TRANSITIONS).toContain(v.transition);
    expect(Object.keys(JOURNEY_ACTIVITY_MAP).sort()).toEqual([...JOURNEY_EVENT_TYPES].sort());
  });
  it('기획 §5.3 표의 대응을 지킨다', () => {
    expect(JOURNEY_ACTIVITY_MAP.ER_ARRIVAL).toMatchObject({ activity: 'ER_VISIT', transition: 'STARTED' });
    expect(JOURNEY_ACTIVITY_MAP.ER_CHECKOUT).toMatchObject({ activity: 'ER_VISIT', transition: 'COMPLETED' });
    expect(JOURNEY_ACTIVITY_MAP.DISCHARGE).toMatchObject({ activity: 'INPATIENT_STAY', transition: 'COMPLETED' });
    expect(JOURNEY_ACTIVITY_MAP.ENCOUNTER_SIGNED.activity).not.toBe(JOURNEY_ACTIVITY_MAP.ENCOUNTER_START.activity); // 서명=기록 완료
  });
  it('멱등 키 — 한 번만 일어나는 전이 + uuid 원 기록일 때만 · 전이를 덮으면 만들지 않는다', () => {
    expect(journeyActivityFields({ eventType: 'ER_ARRIVAL', refId: V }).idempotencyKey).toBe(`ER_VISIT:STARTED:${V}`);
    expect(journeyActivityFields({ eventType: 'ER_DISPOSITION', refId: V, transition: 'REVISED' }))
      .toMatchObject({ transition: 'REVISED', idempotencyKey: null });
    expect(journeyActivityFields({ eventType: 'RECEPTION_CALLED', refId: V }).idempotencyKey).toBeNull(); // 호출은 반복된다
    expect(journeyActivityFields({ eventType: 'ER_ARRIVAL', refId: 'ORD-1' }).idempotencyKey).toBeNull();
    expect(journeyActivityFields({ eventType: 'CONSENT_SIGNED' }).outcome).toBe('SIGNED_BY_PATIENT');
    expect(journeyActivityFields({ eventType: 'NOT_IN_VOCAB' })).toMatchObject({ activity: null, idempotencyKey: null });
  });
});

describe('P2 emit — 저장·억제·정정', () => {
  function make(create: ReturnType<typeof vi.fn>, findFirst = vi.fn().mockResolvedValue(null)) {
    const svc = new JourneyService({ patientJourneyEvent: { create, findFirst } } as any, {} as any);
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    (svc as any).logger = logger;
    vi.spyOn(svc as any, 'updatePatientLocation').mockResolvedValue(undefined);
    return { svc, logger, findFirst };
  }
  it('activity·transition·outcome·멱등 키를 저장한다', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'e1', eventAt: new Date() });
    const { svc } = make(create);
    svc.emit({ patientId: 'p', eventType: 'ER_CHECKOUT', title: 't', refType: 'EmergencyVisit', refId: V, outcome: 'DISCHARGE' });
    await flush();
    expect(create.mock.calls[0][0].data).toMatchObject({
      activity: 'ER_VISIT', transition: 'COMPLETED', outcome: 'DISCHARGE', idempotencyKey: `ER_VISIT:COMPLETED:${V}`, supersedesId: null,
    });
    expect(svc.emitStats()).toMatchObject({ saved: 1, failed: 0 });
  });
  it('🔴 멱등 키 충돌(P2002)은 억제로 센다 — 실패가 아니다 · 대조군: 다른 오류는 실패', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' });
    const a = make(vi.fn().mockRejectedValue(dup));
    a.svc.emit({ patientId: 'p', eventType: 'ER_ARRIVAL', title: 't', refType: 'EmergencyVisit', refId: V });
    await flush();
    expect(a.svc.emitStats()).toMatchObject({ duplicateSuppressed: 1, failed: 0 });
    expect(a.logger.warn).not.toHaveBeenCalled();
    const b = make(vi.fn().mockRejectedValue(new Error('db down')));
    b.svc.emit({ patientId: 'p', eventType: 'ER_ARRIVAL', title: 't', refType: 'EmergencyVisit', refId: V });
    await flush();
    expect(b.svc.emitStats()).toMatchObject({ duplicateSuppressed: 0, failed: 1 });
    expect(b.svc.emitStats().lastFailureAt).not.toBeNull();
  });
  it('🔴 REVISED 는 같은 활동·같은 원 기록의 직전 사건을 가리킨다 · 없으면 null(추정 귀속 없음)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'e2', eventAt: new Date() });
    const { svc, findFirst } = make(create, vi.fn().mockResolvedValue({ id: 'prev-1' }));
    svc.emit({ patientId: 'p', eventType: 'ER_DISPOSITION', transition: 'REVISED', title: 't', refType: 'EmergencyVisit', refId: V });
    await flush();
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ refType: 'EmergencyVisit', refId: V, eventType: { in: ['ER_DISPOSITION'] } });
    expect(create.mock.calls[0][0].data.supersedesId).toBe('prev-1');
    const c2 = vi.fn().mockResolvedValue({ id: 'e3', eventAt: new Date() });
    const m2 = make(c2);
    m2.svc.emit({ patientId: 'p', eventType: 'ER_ARRIVAL', title: 't', refType: 'EmergencyVisit', refId: V });
    await flush();
    expect(m2.findFirst).not.toHaveBeenCalled(); // REVISED 가 아니면 찾지 않는다
    expect(c2.mock.calls[0][0].data.supersedesId).toBeNull();
  });
  it('발행 경로는 await 뒤에도 호출 파일로 남는다', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'e4', eventAt: new Date() });
    const { svc } = make(create, vi.fn().mockResolvedValue(null));
    svc.emit({ patientId: 'p', eventType: 'ER_BED_MOVED', title: 't', refType: 'EmergencyVisit', refId: V });
    await flush();
    expect(create.mock.calls[0][0].data.emitter).toBe('journey-p2.spec');
  });
});

describe('P2-2 응급 처분 사건', () => {
  function fakePrisma() {
    const rows: Record<string, unknown>[] = [];
    const api = {
      rows,
      emergencyVisit: {
        findUnique: vi.fn(async () => ({ id: 'v-1', patientId: 'p-1', status: 'IN_TREATMENT', chiefComplaint: 'c', triageLevel: 'LEVEL_2', arrivalAt: new Date() })),
        update: vi.fn(async () => ({})),
      },
      emergencyDispositionRecord: {
        findUnique: vi.fn(async ({ where }: { where: { visitId: string } }) => rows.find((r) => r.visitId === where.visitId) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `d-${rows.length}`, decidedAt: new Date('2026-10-01T02:00:00Z'), ...data };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { visitId: string }; data: Record<string, unknown> }) => {
          const i = rows.findIndex((r) => r.visitId === where.visitId);
          rows[i] = { ...rows[i], ...data };
          return rows[i];
        }),
      },
      $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(api) : Promise.all(arg as unknown[]))),
    };
    return api;
  }
  function svcWith(journey: { emit: ReturnType<typeof vi.fn> }) {
    const prisma = fakePrisma();
    const audit = { log: vi.fn(async () => ({})) };
    return new EmergencyService(prisma as never, journey as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, audit as never);
  }
  const dispositionEmits = (emit: ReturnType<typeof vi.fn>) => emit.mock.calls.map((c) => c[0]).filter((e) => e.eventType === 'ER_DISPOSITION');

  it('🔴 최초 결정은 정본 경로에서 한 번 남는다(종전 0) · 재클릭은 사건 아님 · 변경은 REVISED', async () => {
    const journey = { emit: vi.fn() };
    const svc = svcWith(journey);
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });
    expect(dispositionEmits(journey.emit)).toHaveLength(1);
    expect(dispositionEmits(journey.emit)[0]).toMatchObject({ outcome: 'OBSERVATION', refId: 'v-1' });
    expect(dispositionEmits(journey.emit)[0].transition, '최초 결정은 매핑 기본(COMPLETED)').toBeUndefined();
    expect(dispositionEmits(journey.emit)[0].occurredAt).toEqual(new Date('2026-10-01T02:00:00Z'));
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });
    expect(dispositionEmits(journey.emit), '같은 결정 재클릭은 사건이 아니다').toHaveLength(1);
    await svc.makeDisposition('v-1', 'u-2', { disposition: 'ADMISSION', admissionId: 'a-1' });
    const all = dispositionEmits(journey.emit);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ transition: 'REVISED', outcome: 'ADMISSION' });
  });

  it('🔴 구 경로(updateEmergencyStatus)는 정본에 맡긴다 — 결과와 무관한 추가 발행 없음', async () => {
    const journey = { emit: vi.fn() };
    const svc = svcWith(journey);
    await svc.updateEmergencyStatus('v-1', 'u-1', { status: 'OBSERVATION' } as never);
    await svc.updateEmergencyStatus('v-1', 'u-1', { status: 'OBSERVATION' } as never);
    expect(dispositionEmits(journey.emit)).toHaveLength(1);
  });

  it('🔴 데모 여정 정리(deleteMany)는 REAL 에서 막힌다 · 대조군 DEV 는 지난다', async () => {
    for (const [mode, blocked] of [['REAL', true], ['DEV', false]] as const) {
      const auth = { seedCheckupJourney: vi.fn(async () => ({ ok: true })), seedOutpatientJourney: vi.fn(async () => ({ ok: true })) };
      const ctrl = Object.create(PatientAuthController.prototype) as PatientAuthController;
      (ctrl as any).auth = auth;
      (ctrl as any).hisMode = { effective: async () => mode };
      if (blocked) {
        await expect(ctrl.seedCheckupJourney()).rejects.toBeInstanceOf(ForbiddenException);
        await expect(ctrl.seedOutpatientJourney()).rejects.toBeInstanceOf(ForbiddenException);
        expect(auth.seedCheckupJourney).not.toHaveBeenCalled();
      } else {
        await ctrl.seedCheckupJourney();
        expect(auth.seedCheckupJourney).toHaveBeenCalledTimes(1);
      }
    }
  });
});

// ── 구조 가드 ──
const SRC = join(__dirname, '..', '..', 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('P2 구조 가드', () => {
  it('🔴 I1 사건 불변 — 여정 행 갱신·삭제는 데모 정리 도구에만(정정은 새 사건)', () => {
    const hits = walk(SRC)
      .filter((f) => /patientJourneyEvent(Object)?\.(update|updateMany|delete|deleteMany|upsert)\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(hits).toEqual(['modules/patient-auth/patient-auth.service.ts']);
  });

  it('관측 범위 등록부 — 어휘 전 항목 · 값은 커밋 근거(형식) 또는 미확인(null)', () => {
    expect(Object.keys(JOURNEY_OBSERVED_SINCE).sort()).toEqual([...JOURNEY_EVENT_TYPES].sort());
    for (const v of Object.values(JOURNEY_OBSERVED_SINCE)) {
      if (v === null) continue;
      expect(v.commit).toMatch(/^[0-9a-f]{9}$/);
      expect(Number.isFinite(Date.parse(v.since))).toBe(true);
    }
    // 귀속 시작은 첫 발행보다 이르지 않다
    for (const [t, r] of Object.entries(JOURNEY_REF_ATTACHED_SINCE)) {
      const first = JOURNEY_OBSERVED_SINCE[t as keyof typeof JOURNEY_OBSERVED_SINCE];
      expect(first && Date.parse(r!.since) >= Date.parse(first.since)).toBe(true);
    }
  });

  it('🔴 감시자 79·80 경계 시각 = shared 귀속 시작 등록부 · 81 은 정정 제외', () => {
    const sql = readFileSync(join(__dirname, '../../../../infra/scripts/data-integrity-scan.sql'), 'utf8');
    const seg = (n: string) => sql.slice(sql.indexOf(`'${n} 여정 원장`), sql.indexOf('UNION ALL', sql.indexOf(`'${n} 여정 원장`)));
    expect(seg('79')).toContain(`'${JOURNEY_REF_ATTACHED_SINCE.ER_TREATMENT_START!.since}'::timestamptz`);
    expect(seg('80')).toContain(`'${JOURNEY_REF_ATTACHED_SINCE.DISCHARGE!.since}'::timestamptz`);
    expect(seg('81')).toMatch(/supersedes_id IS NULL/);
  });
});

describe('P2-4 보고서 — 기록 범위 밖을 말한다', () => {
  it('기간 시작 뒤에 기록되기 시작한 간격 사건을 밝힌다 · 대조군: 기록 이후 기간이면 비어 있다', () => {
    const early = buildJourneyReport([], { limit: 10, period: { from: '2026-04-01T00:00:00.000Z', to: '2026-04-02T00:00:00.000Z', source: 'RANGE' } });
    const types = early.observationScope.map((o) => o.eventType);
    expect(types).toContain('ER_CHECKOUT'); // 2026-08-05 부터
    expect(early.observationScope.find((o) => o.eventType === 'ER_CHECKOUT')!.since).toBe(JOURNEY_OBSERVED_SINCE.ER_CHECKOUT!.since);
    const late = buildJourneyReport([], { limit: 10, period: { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z', source: 'RANGE' } });
    expect(late.observationScope).toEqual([]);
  });
});

describe('P2 데모 생성기 — 상태만 쓰고 사건을 안 남기던 것', () => {
  it('🔴 데모 응급 방문은 원장 시각 그대로 DEMO 사건을 남긴다(운영 감시자 79 의 21건이 전부 이 생성기였다)', () => {
    const emit = vi.fn();
    const svc = new DevDemoService({} as never, {} as never, { emit } as never);
    const arrivalAt = new Date('2026-10-01T00:00:00Z');
    (svc as any).emitDemoErJourney({ id: V, patientId: 'p', arrivalAt, triagedAt: new Date('2026-10-01T00:10:00Z'), treatmentStartedAt: new Date('2026-10-01T00:30:00Z') });
    const types = emit.mock.calls.map((c) => c[0].eventType);
    expect(types).toEqual(['ER_ARRIVAL', 'ER_TRIAGE', 'ER_TREATMENT_START']);
    for (const [e] of emit.mock.calls) expect(e).toMatchObject({ dataOrigin: 'DEMO', refType: 'EmergencyVisit', refId: V, metadata: { simulated: true } });
    expect(emit.mock.calls[0][0].occurredAt).toEqual(arrivalAt);
    // 대조군 — 분류 전 방문은 도착만
    const e2 = vi.fn();
    (new DevDemoService({} as never, {} as never, { emit: e2 } as never) as any).emitDemoErJourney({ id: V, patientId: 'p', arrivalAt, triagedAt: null, treatmentStartedAt: null });
    expect(e2.mock.calls.map((c) => c[0].eventType)).toEqual(['ER_ARRIVAL']);
  });
  it('생성 직후 발행을 부른다(구조)', () => {
    const code = readFileSync(join(SRC, 'modules/dev-demo/dev-demo.service.ts'), 'utf8');
    const createAt = code.indexOf('const visit = await this.prisma.emergencyVisit.create(');
    expect(createAt).toBeGreaterThan(0);
    expect(code.indexOf('this.emitDemoErJourney(visit)', createAt)).toBeGreaterThan(createAt);
  });
});
