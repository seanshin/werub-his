import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SurgerySafetyService } from '../../src/modules/qi/surgery-safety.service';
import { SurgerySafetyCron } from '../../src/modules/qi/surgery-safety.cron';
import { CreateSurgeryDto } from '../../src/modules/surgery/dto/surgery.dto';
import { evaluateSurgerySafety } from '../../src/common/surgery-safety-canon';
import { LATERALITY_REQUIRED_KEYWORDS } from '../../src/common/laterality-keywords';

const D = (s: string) => new Date(s);
const inRange = D('2026-08-05T02:00:00Z');

function surgeryRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1', procedureName: '충수절제술', bodySite: null, laterality: null,
    status: 'COMPLETED', scheduledAt: inRange,
    patient: { id: 'p1', mrn: 'M1', familyName: '홍', givenName: '길동' },
    surgeon: { id: 'd1', familyName: '김', givenName: '의사' },
    ...over,
  };
}

describe('SurgerySafetyService — 미이행 탐지(분모 포함)', () => {
  let svc: SurgerySafetyService;
  let prisma: any;
  let config: { get: any };

  beforeEach(() => {
    prisma = {
      surgery: { findMany: vi.fn(async () => []) },
      surgicalChecklist: { findMany: vi.fn(async () => []) },
    };
    config = { get: vi.fn(async () => null) };
    svc = new SurgerySafetyService(prisma, config as any);
  });

  it('🔴 대상 수술이 0건이면 이행률은 0% 가 아니라 **산출 불가**(null)다', async () => {
    const r = await svc.getSummary('2026-08-01', '2026-08-31');
    expect(r.available).toBe(false);
    expect(r.checklist.compliancePct).toBeNull();
    expect(r.checklist.denominator).toBe(0);
    expect(r.reason).toMatch(/산출 불가/);
  });

  it('체크리스트 3단계 중 하나라도 비면 "완료"가 아니다 — 분모와 함께 낸다', async () => {
    prisma.surgery.findMany = vi.fn(async () => [
      surgeryRow({ id: 'a' }), surgeryRow({ id: 'b' }), surgeryRow({ id: 'c' }),
    ]);
    prisma.surgicalChecklist.findMany = vi.fn(async () => [
      { surgeryId: 'a', signInCompletedAt: inRange, timeOutCompletedAt: inRange, signOutCompletedAt: inRange, countStatus: 'MATCH', countDiscrepancyNote: null },
      { surgeryId: 'b', signInCompletedAt: inRange, timeOutCompletedAt: inRange, signOutCompletedAt: null, countStatus: null, countDiscrepancyNote: null },
      // c 는 체크리스트 행 자체가 없다
    ]);
    const r = await svc.getSummary('2026-08-01', '2026-08-31');
    expect(r.checklist.denominator).toBe(3);
    expect(r.checklist.complete).toBe(1);
    expect(r.checklist.incomplete).toBe(2);
    // 🔴 "행이 없다"와 "행은 있는데 단계가 비었다"는 다른 사실이다
    expect(r.checklist.noChecklistRow).toBe(1);
    expect(r.checklist.compliancePct).toBeCloseTo(33.3, 1);
    expect(r.checklist.basis).toContain('3건');
  });

  it('🔴 좌우 "판정 불가"를 "필요 없음"에 합치지 않는다(합치면 갭이 줄어 보인다)', async () => {
    prisma.surgery.findMany = vi.fn(async () => [
      surgeryRow({ id: 'a', procedureName: '슬관절 전치환술', bodySite: '슬관절', laterality: null }),
      surgeryRow({ id: 'b', procedureName: '', bodySite: null }),  // 판정 근거 없음
      surgeryRow({ id: 'c', procedureName: '충수절제술' }),
    ]);
    const r = await svc.getSummary('2026-08-01', '2026-08-31');
    expect(r.siteVerification.lateralityRequired).toBe(1);
    expect(r.siteVerification.gaps).toBe(1);
    expect(r.siteVerification.lateralityUndetermined).toBe(1);
    expect(r.siteVerification.verifiedPct).toBe(0);
  });

  it('게이트가 OFF 면 "갭이 차단되지 않는다"고 화면에 말한다(초록으로 안심시키지 않는다)', async () => {
    prisma.surgery.findMany = vi.fn(async () => [surgeryRow()]);
    const r = await svc.getSummary('2026-08-01', '2026-08-31');
    expect(r.gateModes.siteVerify).toBe('OFF');
    expect(r.gateNote).toMatch(/OFF/);
  });

  it('워크리스트는 문제 있는 건만 담되 **분모(scanned)** 를 함께 낸다', async () => {
    prisma.surgery.findMany = vi.fn(async () => [
      surgeryRow({ id: 'a' }),
      surgeryRow({ id: 'b', procedureName: '백내장 수술' }),
    ]);
    prisma.surgicalChecklist.findMany = vi.fn(async () => [
      { surgeryId: 'a', signInCompletedAt: inRange, timeOutCompletedAt: inRange, signOutCompletedAt: inRange, countStatus: null, countDiscrepancyNote: null },
    ]);
    const r = await svc.getWorklist({ from: '2026-08-01', to: '2026-08-31', kind: 'ALL' });
    expect(r.scanned).toBe(2);
    expect(r.flagged).toBe(1);
    expect(r.items[0].surgeryId).toBe('b');
    expect(r.items[0].issues.map(i => i.code)).toContain('CHECKLIST_ABSENT');
    expect(r.items[0].issues.map(i => i.code)).toContain('LATERALITY_MISSING');
  });

  it('예정(SCHEDULED) 건은 체크리스트 미이행으로 세지 않는다(아직 할 때가 아니다)', async () => {
    prisma.surgery.findMany = vi.fn(async () => [
      surgeryRow({ id: 'a', status: 'SCHEDULED', procedureName: '슬관절 전치환술', bodySite: '슬관절' }),
    ]);
    const r = await svc.getWorklist({ from: '2026-08-01', to: '2026-08-31', kind: 'ALL' });
    const codes = r.items[0].issues.map(i => i.code);
    expect(codes).toContain('LATERALITY_MISSING');       // 부위·좌우는 **미리** 잡아야 한다
    expect(codes).not.toContain('CHECKLIST_ABSENT');     // 체크리스트는 아직 아니다
  });

  it('계수 불일치는 해소기록이 있으면 미이행이 아니다', () => {
    const base = { id: 's', procedureName: 'x', bodySite: null, laterality: null, status: 'COMPLETED', scheduledAt: inRange };
    const cl = { surgeryId: 's', signInCompletedAt: inRange, timeOutCompletedAt: inRange, signOutCompletedAt: inRange, countStatus: 'MISMATCH', countDiscrepancyNote: null };
    expect(evaluateSurgerySafety(base, cl, LATERALITY_REQUIRED_KEYWORDS).countUnresolved).toBe(true);
    expect(evaluateSurgerySafety(base, { ...cl, countDiscrepancyNote: 'X-ray 확인' }, LATERALITY_REQUIRED_KEYWORDS).countUnresolved).toBe(false);
  });
});

describe('SurgerySafetyCron — 탐지와 상신은 분리 불가, 그러나 건당 알림은 만들지 않는다', () => {
  let cron: SurgerySafetyCron;
  let prisma: any;
  let notifications: { notify: any };
  let safety: { getWorklist: any };

  beforeEach(() => {
    prisma = {
      user: { findMany: vi.fn(async () => [{ id: 'u1' }, { id: 'u2' }]) },
      notification: { findFirst: vi.fn(async () => null) },
    };
    notifications = { notify: vi.fn(async () => ({ id: 'n1' })) };
    safety = { getWorklist: vi.fn() };
    cron = new SurgerySafetyCron(prisma, safety as any, notifications as any, { get: vi.fn(async () => null) } as any);
  });

  it('🔴 미이행 N건이어도 수신자당 알림은 **1건**이다(건당 알림 금지 — 읽음률 8.6%)', async () => {
    safety.getWorklist = vi.fn(async () => ({
      scanned: 46, flagged: 8,
      items: Array.from({ length: 8 }, (_, i) => ({ surgeryId: `s${i}`, issues: [{ code: 'CHECKLIST_ABSENT', severity: 'HIGH' }] })),
    }));
    const r = await cron.digest();
    expect(r.sent).toBe(2);                       // 수신자 2명 × 1건
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('🔴 본문에 **분모**가 들어간다("미이행 8건"만으로는 심각도를 말할 수 없다)', async () => {
    safety.getWorklist = vi.fn(async () => ({
      scanned: 46, flagged: 8,
      items: [{ surgeryId: 's', issues: [{ code: 'LATERALITY_MISSING', severity: 'HIGH' }] }],
    }));
    await cron.digest();
    const arg = notifications.notify.mock.calls[0][1];
    expect(arg.message).toContain('46');
    expect(arg.message).toContain('8');
    expect(arg.refId).toBeUndefined(); // 특정 수술이 아니라 목록을 가리킨다(refId 계약)
  });

  it('미이행 0건이면 아무것도 보내지 않는다(매일 오는 초록이 진짜 경보를 죽인다)', async () => {
    safety.getWorklist = vi.fn(async () => ({ scanned: 46, flagged: 0, items: [] }));
    const r = await cron.digest();
    expect(r.sent).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('같은 날 이미 보냈으면 다시 보내지 않는다', async () => {
    safety.getWorklist = vi.fn(async () => ({ scanned: 46, flagged: 8, items: [{ surgeryId: 's', issues: [{ code: 'X', severity: 'HIGH' }] }] }));
    prisma.notification.findFirst = vi.fn(async () => ({ id: 'already' }));
    const r = await cron.digest();
    expect(r.sent).toBe(0);
  });

  it('🔴 수신자가 없으면 "보냈다"고 하지 않는다(탐지만 남은 사실을 그대로 낸다)', async () => {
    safety.getWorklist = vi.fn(async () => ({ scanned: 46, flagged: 8, items: [{ surgeryId: 's', issues: [{ code: 'X', severity: 'HIGH' }] }] }));
    prisma.user.findMany = vi.fn(async () => []);
    const r = await cron.digest();
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe('no-recipient');
    expect(r.flagged).toBe(8);
  });
});

describe('CreateSurgeryDto — whitelist 가 부위·좌우를 지우지 않는다', () => {
  /**
   * 🔴 전역 `whitelist:true` 는 DTO 에 없는 키를 **성공 응답과 함께 조용히 삭제**한다.
   *    FE 가 보내기 시작해도 DTO 에 없으면 사라진다 — 기계 대조만이 잡는다.
   */
  it('bodySite·laterality 가 DTO 를 통과한다', async () => {
    const dto = plainToInstance(CreateSurgeryDto, {
      patientId: '00000000-0000-4000-8000-000000000001',
      surgeonId: '00000000-0000-4000-8000-000000000002',
      scheduledAt: '2026-09-01T09:00:00.000Z',
      procedureName: '슬관절 전치환술',
      bodySite: '슬관절',
      laterality: 'RIGHT',
    }, { excludeExtraneousValues: false });
    const errs = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    expect(errs).toEqual([]);
    expect(dto.bodySite).toBe('슬관절');
    expect(dto.laterality).toBe('RIGHT');
  });

  it('laterality 는 열거형 밖 값을 조용히 통과시키지 않는다', async () => {
    const dto = plainToInstance(CreateSurgeryDto, {
      patientId: '00000000-0000-4000-8000-000000000001',
      surgeonId: '00000000-0000-4000-8000-000000000002',
      scheduledAt: '2026-09-01T09:00:00.000Z',
      procedureName: 'x', laterality: '오른쪽',
    });
    const errs = await validate(dto, { whitelist: true });
    expect(errs.map(e => e.property)).toContain('laterality');
  });
});
