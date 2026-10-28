import { describe, it, expect, vi } from 'vitest';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { EMERGENCY_METRICS } from '../../src/modules/data-quality/quality-registry';

/**
 * 트리아지 사실 기록 가드 — 시드 흐름 전수 검토 5단계(응급).
 *
 * 🔴 무엇이 있었나: `POST /emergency/triage` 는 KTAS 등급을 **필수로 받아 저장하면서**
 *    `triagedAt`/`triageNurseId` 를 남기지 않았고 상태를 `PENDING_TRIAGE`(분류 대기)로 두었다.
 *    그러면서 여정에는 "트리아지 완료 (LEVEL_X)"를 발행했다 — P16(실행하지 않고 성공 상태만 기록).
 *    `triagedAt` 을 쓰는 런타임 코드가 **저장소에 하나도 없었다**(유일한 쓰기가 시드 생성기).
 *    운영 실측 결과: 공개 전광판이 분류 끝난 환자를 '도착'에 세우고, 여정 관제는 `ER_ARRIVED` 에
 *    멈춰 KTAS 목표 초과 시 TRIAGE_DELAY 거짓 경보를 내고, door-to-triage 는 시드가 박은
 *    10분만 재며 위반율 0%(=전건 목표 달성)로 보였다.
 *
 * 이 가드가 세우는 계약:
 *   ① 등급이 확정되면 **분류 시각·분류자**가 원장에 남는다
 *   ② 상태가 '분류 대기'로 남지 않는다(등급이 있는데 대기라고 말하지 않는다)
 *   ③ 도착 시각을 받으면 그것을 쓰고, **미래 도착은 거절**한다(조용히 고치지 않는다)
 *   ④ 도착 시각을 모르면 접수 시각을 쓰되 door-to-triage 는 **0분이 아니라 산출 불가**로 갈린다
 *   ⑤ 응급 도메인 데이터품질 지표가 **존재하고**, 결함을 재주입하면 그 지표가 잡는다
 */

function fakePrisma() {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    patient: { findUnique: vi.fn(async () => ({ id: 'p-1' })) },
    emergencyVisit: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'v-1', ...data, patient: { familyName: '검', givenName: '증' } };
      }),
    },
  } as unknown as Record<string, never>;
}

function makeService(prisma: unknown) {
  const journey = { emit: vi.fn() };
  const svc = new EmergencyService(prisma as never);
  (svc as unknown as { journey: unknown }).journey = journey;
  return { svc, journey };
}

const DTO = { patientId: 'p-1', chiefComplaint: '흉통', triageLevel: 'LEVEL_2' as never };

describe('응급 트리아지 — 분류 사실이 원장에 남는다', () => {
  it('① 분류 시각과 분류자를 기록한다', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService(prisma);
    await svc.createTriage({ ...DTO }, 'nurse-9');
    const data = (prisma as unknown as { created: Record<string, unknown>[] }).created[0];
    expect(data.triagedAt).toBeInstanceOf(Date);
    expect(data.triageNurseId).toBe('nurse-9');
  });

  it('② 등급이 확정됐는데 상태를 "분류 대기"로 두지 않는다', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService(prisma);
    await svc.createTriage({ ...DTO }, 'nurse-9');
    const data = (prisma as unknown as { created: Record<string, unknown>[] }).created[0];
    expect(data.status).not.toBe('PENDING_TRIAGE');
    expect(data.status).toBe('TRIAGED');
  });

  it('③ 도착 시각을 받으면 쓰고, 미래 도착은 거절한다', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService(prisma);
    const past = new Date(Date.now() - 40 * 60_000);
    await svc.createTriage({ ...DTO, arrivalAt: past.toISOString() }, 'nurse-9');
    const data = (prisma as unknown as { created: Record<string, unknown>[] }).created[0];
    expect((data.arrivalAt as Date).getTime()).toBe(past.getTime());
    // 도착이 분류보다 나중일 수는 없다
    await expect(
      svc.createTriage({ ...DTO, arrivalAt: new Date(Date.now() + 3600_000).toISOString() }, 'nurse-9'),
    ).rejects.toThrow();
  });

  it('④ 도착 시각을 모르면 도착=분류 동시 기록이 되고, 그 건은 0분이 아니라 산출 불가다', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService(prisma);
    await svc.createTriage({ ...DTO }, 'nurse-9');
    const data = (prisma as unknown as { created: Record<string, unknown>[] }).created[0];
    // 같은 순간이라는 사실 자체는 정당하다 — 분석이 이것을 0분 성적으로 읽지 않아야 한다
    expect((data.arrivalAt as Date).getTime()).toBe((data.triagedAt as Date).getTime());
  });

  it('⑤ 대조군 — 정상 입력을 결함이라 말하지 않는다', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService(prisma);
    await expect(svc.createTriage({ ...DTO, arrivalAt: new Date(Date.now() - 60_000).toISOString() }, 'nurse-9')).resolves.toBeTruthy();
  });
});

describe('응급 데이터품질 지표 — "기록되지 않은 것"을 세는 곳이 있다', () => {
  it('응급 도메인 지표가 등록되어 있다(개통 이래 0개였다)', () => {
    const keys = EMERGENCY_METRICS.map((m) => m.key);
    expect(keys).toContain('emergency.triageActMissing');
    expect(keys).toContain('emergency.dispositionRecordMissing');
    expect(EMERGENCY_METRICS.every((m) => m.domain === 'emergency' && m.drillDown)).toBe(true);
  });

  it('분류 시각 없는 방문을 분모와 함께 센다 — 결함을 재주입하면 잡힌다', async () => {
    const metric = EMERGENCY_METRICS.find((m) => m.key === 'emergency.triageActMissing')!;
    const prisma = {
      emergencyVisit: {
        count: vi.fn(async (args?: { where?: { triagedAt?: null } }) =>
          args?.where?.triagedAt === null ? 3 : 10),
      },
    } as never;
    expect(await metric.compute(prisma)).toEqual({ value: 3, total: 10 });
  });

  it('대조군 — 전건 기록되어 있으면 0으로 말한다(무조건 경보하지 않는다)', async () => {
    const metric = EMERGENCY_METRICS.find((m) => m.key === 'emergency.triageActMissing')!;
    const prisma = {
      emergencyVisit: { count: vi.fn(async (args?: { where?: { triagedAt?: null } }) => (args?.where?.triagedAt === null ? 0 : 10)) },
    } as never;
    expect(await metric.compute(prisma)).toEqual({ value: 0, total: 10 });
  });

  it('처분 원장 없는 방문을 센다 — 필드만 있고 원장이 없으면 결정자가 없다', async () => {
    const metric = EMERGENCY_METRICS.find((m) => m.key === 'emergency.dispositionRecordMissing')!;
    const prisma = {
      emergencyVisit: { findMany: vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
      emergencyDispositionRecord: { findMany: vi.fn(async () => [{ visitId: 'a' }]) },
    } as never;
    expect(await metric.compute(prisma)).toEqual({ value: 2, total: 3 });
  });

  it('처분이 둘인데 서로 다른 건을 센다(P12) — 같은 값이면 세지 않는다', async () => {
    const metric = EMERGENCY_METRICS.find((m) => m.key === 'emergency.dispositionDisagree')!;
    const prisma = {
      emergencyDispositionRecord: {
        findMany: vi.fn(async () => [{ visitId: 'a', disposition: 'ADMISSION' }, { visitId: 'b', disposition: 'DISCHARGE' }]),
      },
      emergencyVisit: {
        findMany: vi.fn(async () => [{ id: 'a', disposition: 'DISCHARGE' }, { id: 'b', disposition: 'DISCHARGE' }]),
      },
    } as never;
    expect(await metric.compute(prisma)).toEqual({ value: 1, total: 2 });
  });
});
