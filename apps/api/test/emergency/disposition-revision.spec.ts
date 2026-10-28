import { describe, it, expect, vi } from 'vitest';
import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { MakeDispositionDto } from '../../src/modules/emergency/dto/emergency.dto';

/**
 * 응급 처분 재결정 가드 — 2026-08-18.
 *
 * 🔴 무엇이 있었나: `EmergencyDispositionRecord.visitId` 는 `@unique` 인데(운영 인덱스
 *    `emergency_dispositions_visit_id_key` 실측) 서비스는 `.create()` 하나였다. 그래서 **같은 방문의
 *    두 번째 처분은 Prisma P2002** 였고, 전역 예외 필터는 P2002 를 HttpException 으로 인식하지 못해
 *    **500 `INTERNAL_ERROR`** 로 나갔다. 화면은 "처분 결정 실패"만 띄웠다.
 *    처분은 실제로 바뀐다(관찰→입원, 전원 결정 후 취소). 운영 워크스테이션은 `OBSERVATION` 을
 *    '처분 완료'로 세지 않아 관찰 환자에게 퇴원·전원 버튼을 계속 노출한다 — 그 버튼이 정확히 이 경로다.
 *
 * 이 가드가 세우는 계약:
 *   ① 두 번째 처분이 **기록된다**(P2002 로 죽지 않는다)
 *   ② 변경 전 기록이 **통째로 보존된다**(보존처가 없으면 아예 덮지 않는다)
 *   ③ 같은 결정 재전송은 **멱등**이고 결정 시각을 앞으로 밀지 않는다
 *   ④ 이전 결정의 전원기관·귀가지침이 새 결정에 **얹혀 남지 않는다**
 *   ⑤ 화면이 보내는 페이로드가 **실제 ValidationPipe** 를 통과하고 키가 지워지지 않는다
 */

const VISIT = { id: 'v-1', patientId: 'p-1', status: 'IN_TREATMENT', chiefComplaint: '흉통', triageLevel: 'LEVEL_2', arrivalAt: new Date('2026-08-18T01:00:00Z') };

/**
 * 운영 유니크 인덱스를 그대로 흉내내는 prisma 대역.
 * 🔴 유니크를 흉내내지 않으면 이 가드는 **결함을 재주입해도 통과한다** — 그것이 이 저장소에서
 *    가드가 헛돈 12건의 전형이다. create 중복은 반드시 P2002 를 던진다.
 */
function fakePrisma() {
  const rows: Record<string, unknown>[] = [];
  const visitUpdates: Record<string, unknown>[] = [];
  const api = {
    rows,
    visitUpdates,
    emergencyVisit: {
      findUnique: vi.fn(async () => ({ ...VISIT })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { visitUpdates.push(data); return {}; }),
    },
    emergencyDispositionRecord: {
      findUnique: vi.fn(async ({ where }: { where: { visitId: string } }) => rows.find((r) => r.visitId === where.visitId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (rows.some((r) => r.visitId === data.visitId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`visit_id`)', {
            code: 'P2002', clientVersion: 'test', meta: { target: ['visit_id'] },
          });
        }
        const row = { id: `d-${rows.length}`, decidedAt: new Date('2026-08-18T02:00:00Z'), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { visitId: string }; data: Record<string, unknown> }) => {
        const i = rows.findIndex((r) => r.visitId === where.visitId);
        if (i < 0) throw new Error('record not found');
        rows[i] = { ...rows[i], ...data };
        return rows[i];
      }),
    },
    /**
     * 🔴 (I2) 정본이 처분 원장과 방문 상태를 한 트랜잭션에서 쓴다 — 목도 같은 호출 모양을 준다.
     *    콜백형을 처리하지 않으면 트랜잭션 안의 쓰기가 통째로 사라져 가드가 헛돈다(목은 정본의 실제 호출 모양으로).
     */
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(api) : Promise.all(arg as unknown[]))),
  };
  return api;
}

function makeService(prisma: ReturnType<typeof fakePrisma>, audit?: { log: (e: unknown) => Promise<unknown> }) {
  // 위치 인자 순서 = EmergencyService 생성자. audit 은 마지막(11번째).
  return new EmergencyService(
    prisma as never, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    audit as never,
  );
}

function auditSpy() {
  const calls: Record<string, unknown>[] = [];
  return { calls, log: vi.fn(async (e: Record<string, unknown>) => { calls.push(e); return {}; }) };
}

describe('응급 처분은 바뀔 수 있다 (재결정)', () => {
  it('🔴 두 번째 처분이 P2002 로 죽지 않고 기록된다 — 관찰 → 입원', async () => {
    const prisma = fakePrisma();
    const audit = auditSpy();
    const svc = makeService(prisma, audit);

    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });
    const second = await svc.makeDisposition('v-1', 'u-2', { disposition: 'ADMISSION', admissionId: 'a-1' });

    expect(second.outcome).toBe('REVISED');
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].disposition).toBe('ADMISSION');
    expect(prisma.rows[0].decidedBy).toBe('u-2');
  });

  it('🔴 변경 전 기록이 감사에 통째로 보존된다 — old 값이 실려야 한다', async () => {
    const prisma = fakePrisma();
    const audit = auditSpy();
    const svc = makeService(prisma, audit);

    await svc.makeDisposition('v-1', 'u-1', {
      disposition: 'TRANSFER', transferTo: '가상권역대학교병원', transferReason: '중환자실 부재',
    });
    await svc.makeDisposition('v-1', 'u-2', { disposition: 'DISCHARGE', dischargeInstructions: '경과 관찰', revisionReason: '전원 취소 — 보호자 거부' });

    expect(audit.calls).toHaveLength(1);
    const entry = audit.calls[0] as { resourceType: string; resourceId: string; changes: Record<string, { old: unknown; new: unknown }> };
    expect(entry.resourceType).toBe('EmergencyDisposition');
    expect(entry.resourceId, '환자 지목 조회로 찾을 수 있어야 한다').toBe('p-1');
    // 🔴 부분 문자열이 아니라 **값**을 본다. old 가 비어 있으면 보존이 아니다.
    expect(entry.changes.disposition).toEqual({ old: 'TRANSFER', new: 'DISCHARGE' });
    expect(entry.changes.transferTo.old).toBe('가상권역대학교병원');
    expect(entry.changes.transferReason.old).toBe('중환자실 부재');
    expect(entry.changes.decidedBy).toEqual({ old: 'u-1', new: 'u-2' });
    expect(entry.changes.revisionReason.new).toBe('전원 취소 — 보호자 거부');
  });

  it('🔴 이전 결정의 전원기관·사유가 새 결정에 얹혀 남지 않는다', async () => {
    const prisma = fakePrisma();
    const svc = makeService(prisma, auditSpy());
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'TRANSFER', transferTo: '가상권역대학교병원', transferReason: 'ICU 부재' });
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'DISCHARGE', dischargeInstructions: '3일 후 외래' });

    expect(prisma.rows[0].transferTo, '퇴원 기록에 전원기관이 남으면 그것이 곧 오정보다').toBeNull();
    expect(prisma.rows[0].transferReason).toBeNull();
    expect(prisma.rows[0].dischargeInstructions).toBe('3일 후 외래');
  });

  it('같은 결정 재전송은 멱등 — 새로 쓰지 않고 결정 시각도 밀지 않는다', async () => {
    const prisma = fakePrisma();
    const audit = auditSpy();
    const svc = makeService(prisma, audit);

    await svc.makeDisposition('v-1', 'u-1', { disposition: 'DISCHARGE', dischargeInstructions: '경과 관찰' });
    const updateCallsAfterFirst = prisma.emergencyDispositionRecord.update.mock.calls.length;
    const again = await svc.makeDisposition('v-1', 'u-1', { disposition: 'DISCHARGE', dischargeInstructions: '경과 관찰' });

    expect(again.outcome).toBe('UNCHANGED');
    expect(prisma.emergencyDispositionRecord.update.mock.calls.length, '내용이 같은데 갱신했다').toBe(updateCallsAfterFirst);
    expect(audit.calls, '바뀐 것이 없는데 변경 감사를 남겼다').toHaveLength(0);
    // 🔴 더블클릭이 처분 소요 지표를 좋게 만들면 안 된다 — 재전송은 결정 시각을 **지금으로 밀지 않는다**.
    //    (2026-09-16 I2) 단 방문의 결정 시각이 비어 있으면 **원장의 decidedAt** 으로 채운다 —
    //    원장 쓰기만 커밋되고 방문 갱신이 실패한 뒤의 반쪽 상태를 복구하는 경로다. 이 목의 방문은
    //    항상 dispositionAt=null 을 돌려주므로 여기서 그 복구가 걸린다. 지어낸 시각이 아니라
    //    **일어난 시각**(원장)인지를 본다.
    const second = prisma.visitUpdates[1] as { dispositionAt?: Date };
    if (second.dispositionAt !== undefined) {
      expect(second.dispositionAt, '재전송이 결정 시각을 지금으로 밀었다').toEqual(prisma.rows[0].decidedAt);
    }
    expect(prisma.visitUpdates[0]).toHaveProperty('dispositionAt');
  });

  it('🔴 보존처(감사)가 없으면 덮어쓰지 않는다 — 갱신 자체가 일어나면 안 된다', async () => {
    const prisma = fakePrisma();
    const svc = makeService(prisma); // audit 미주입
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });

    await expect(svc.makeDisposition('v-1', 'u-1', { disposition: 'ADMISSION' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.emergencyDispositionRecord.update).not.toHaveBeenCalled();
    expect(prisma.rows[0].disposition, '보존 없이 덮였다').toBe('OBSERVATION');
  });

  it('🔴 감사 쓰기가 실패하면 갱신하지 않는다 — 보존이 먼저다', async () => {
    const prisma = fakePrisma();
    const audit = { log: vi.fn(async () => { throw new Error('audit down'); }) };
    const svc = makeService(prisma, audit as never);
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });

    await expect(svc.makeDisposition('v-1', 'u-1', { disposition: 'ADMISSION' })).rejects.toThrow(/audit down/);
    expect(prisma.emergencyDispositionRecord.update).not.toHaveBeenCalled();
    expect(prisma.rows[0].disposition).toBe('OBSERVATION');
  });

  it('동시 결정(P2002 경합)도 변경으로 수렴한다 — check-then-act 는 원자적이지 않다', async () => {
    const prisma = fakePrisma();
    const audit = auditSpy();
    const svc = makeService(prisma, audit);

    // findUnique 가 null 을 본 직후 다른 결정이 먼저 들어온 상황을 만든다.
    let firstLook = true;
    prisma.emergencyDispositionRecord.findUnique.mockImplementation(async ({ where }: { where: { visitId: string } }) => {
      if (firstLook) {
        firstLook = false;
        prisma.rows.push({ id: 'd-race', visitId: where.visitId, disposition: 'ADMISSION', decidedBy: 'u-other', decidedAt: new Date() });
        return null; // 경합: 이 시점엔 아직 못 봤다
      }
      return prisma.rows.find((r) => r.visitId === where.visitId) ?? null;
    });

    const res = await svc.makeDisposition('v-1', 'u-1', { disposition: 'DISCHARGE' });
    expect(res.outcome).toBe('REVISED');
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].disposition).toBe('DISCHARGE');
    expect(audit.calls[0].changes).toMatchObject({ disposition: { old: 'ADMISSION', new: 'DISCHARGE' } });
  });

  it('응급 퇴원(dischargeFromEmergency)도 이미 처분이 있으면 막히지 않는다', async () => {
    const prisma = fakePrisma();
    prisma.emergencyVisit.findUnique.mockImplementation(async () => ({ ...VISIT, patient: { id: 'p-1', familyName: '김', givenName: '환자' } } as never));
    const svc = makeService(prisma, auditSpy());
    await svc.makeDisposition('v-1', 'u-1', { disposition: 'OBSERVATION' });

    await expect(svc.dischargeFromEmergency('v-1', 'u-1', { instructions: '3일 후 외래' })).resolves.toBeDefined();
    expect(prisma.rows[0].disposition).toBe('DISCHARGE');
  });
});

/**
 * FE ↔ DTO 계약 — 화면 페이로드를 **실제 전역 ValidationPipe** 에 태운다.
 * 🔴 컨트롤러 단위 테스트는 파이프를 타지 않는다. 전역 `whitelist: true` 는 DTO 에 없는 키를
 *    **조용히 지운다**(200 + 데이터 소실). 변경 사유가 그렇게 사라지면 이 축의 봉합이 무의미해진다.
 */
describe('처분 결정 페이로드 ↔ MakeDispositionDto (실 파이프)', () => {
  // main.ts 와 동일 옵션 — 갈라지면 이 가드는 아무것도 보증하지 않는다.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
  const meta = (m: unknown): ArgumentMetadata => ({ type: 'body', metatype: m as never, data: '' });
  const through = (payload: Record<string, unknown>) => pipe.transform(payload, meta(MakeDispositionDto)) as Promise<Record<string, unknown>>;
  // 클래스 필드는 컴파일 결과에서 undefined 로 선언된다 — Object.keys 를 그냥 세면 "안 버려졌다"고 잘못 통과한다.
  const definedKeys = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k).sort();

  it('🔴 처분 변경 사유가 whitelist 에 지워지지 않는다', async () => {
    const out = await through({ disposition: 'ADMISSION', revisionReason: '관찰 중 악화 — 입원 전환' });
    expect(definedKeys(out)).toEqual(['disposition', 'revisionReason']);
    expect(out.revisionReason).toBe('관찰 중 악화 — 입원 전환');
  });

  it('/emergency 처분 패널이 보내는 4키가 하나도 버려지지 않는다', async () => {
    const screen = { disposition: 'DISCHARGE', dischargeInstructions: '3일 후 외래', followUpDate: '2026-08-21', revisionReason: '전원 취소' };
    const out = await through(screen);
    expect(definedKeys(out)).toEqual(Object.keys(screen).sort());
  });

  it('워크스테이션 즉시 버튼(사유 없음)도 통과한다 — 최초 결정에 사유를 강제하지 않는다', async () => {
    await expect(through({ disposition: 'DISCHARGE' })).resolves.toBeDefined();
    await expect(through({ disposition: 'TRANSFER' })).resolves.toBeDefined();
  });

  it('없는 처분 코드는 여전히 거절한다', async () => {
    await expect(through({ disposition: 'DISCHARGED' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
