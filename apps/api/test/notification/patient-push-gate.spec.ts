/**
 * 🔴 환자 푸시(대외 발신) 게이트 가드 — 2026-08-20 신규 배선.
 *
 * 켜지면 **실제 환자 휴대폰으로 나간다.** 그래서 이 파일이 지키는 것은 "동작한다"가 아니라
 * **"쏟아지지 않는다"** 와 **"안 보냈으면 안 보냈다고 말한다"** 다.
 *
 * 재주입 검증(2026-08-20 실제 수행 — 되돌린 것 → 깨진 테스트):
 *   ① `deliver()` 의 마스터 스위치 검사 제거 → "마스터 OFF 면 발송 0" 실패
 *   ② 타입별 스위치 검사 제거 → "타입 OFF 면 그 타입만 0" 실패
 *   ③ `requiresOptIn` 검사 제거 → "notifyPatient 미요청이면 0" 실패
 *   ④ 중복 억제(findFirst) 제거 → "같은 환자·같은 타입 2회 → 1회만" 실패
 *   ⑤ 야간 억제 제거 → "야간 창에서는 LAB_RESULT 미발송" 실패
 *   ⑥ CALLED 를 `quietHoursExempt: false` 로 바꿈 → "긴급 계열은 야간에도 나간다" 실패
 */
import { describe, it, expect, vi } from 'vitest';
import { PatientPushGateService } from '../../src/modules/notification/patient-push-gate.service';
import { NotificationListener } from '../../src/modules/notification/notification.listener';
import {
  PATIENT_PUSH_MASTER_KEY,
  PATIENT_PUSH_QUIET_HOURS_KEY,
  PATIENT_PUSH_TYPES,
  isQuietHour,
  kstHour,
  normalizeQuietHours,
  patientPushTypeKey,
  firstPatientPushResult,
  DEFAULT_QUIET_HOURS,
} from '../../src/modules/notification/patient-push.contract';

const ACCOUNT = { id: 'acct-1' };

function mk(opts?: { config?: Record<string, unknown>; account?: unknown; recent?: unknown }) {
  const created: any[] = [];
  const prisma: any = {
    patientAccount: { findFirst: vi.fn(async () => ('account' in (opts ?? {}) ? opts!.account : ACCOUNT)) },
    patientNotification: {
      findFirst: vi.fn(async () => opts?.recent ?? null),
      create: vi.fn(async ({ data }: any) => {
        created.push(data);
        return { id: `pn-${created.length}`, ...data };
      }),
    },
  };
  // 🔴 단말 푸시 층 — 자격이 설정된 상태를 기본으로 둔다(꺼진 경우는 별도 테스트에서 확인)
  const fcm: any = { pushPatientNotification: vi.fn(async () => undefined), isEnabled: true };
  const config: any = { get: vi.fn(async (k: string) => (opts?.config ?? {})[k] ?? null) };
  const svc = new PatientPushGateService(prisma, fcm, config);
  return { svc, prisma, fcm, config, created };
}

/** 마스터 + 해당 타입만 켠 설정 */
const on = (...types: Array<keyof typeof PATIENT_PUSH_TYPES>) => {
  const c: Record<string, unknown> = { [PATIENT_PUSH_MASTER_KEY]: true };
  for (const t of types) c[patientPushTypeKey(t)] = true;
  return c;
};

/** 야간 창 밖(KST 12시)·안(KST 02시)인 고정 시각 */
const NOON_KST = new Date('2026-08-20T03:00:00.000Z'); // KST 12시
const NIGHT_KST = new Date('2026-08-19T17:00:00.000Z'); // KST 다음날 02시

describe('킬 스위치 — 기본값은 OFF 이고 마스터 AND 타입별이다', () => {
  it('🔴 아무 설정도 없으면(기본) 한 건도 나가지 않는다 — 대외 발신은 자동으로 켜지지 않는다', async () => {
    const { svc, prisma } = mk();
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b');
    expect(r).toEqual({ attempted: false, sent: false, reason: 'DISABLED_BY_CONFIG', pushChannel: null });
    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
  });

  it('🔴 마스터 OFF 면 타입을 켜도 발송 0 — 재주입: deliver 의 마스터 검사를 지우면 이 단언이 깨진다', async () => {
    const { svc, prisma } = mk({
      config: { [PATIENT_PUSH_MASTER_KEY]: false, [patientPushTypeKey('LAB_RESULT')]: true },
    });
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('DISABLED_BY_CONFIG');
    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
  });

  it('🔴 마스터 ON 이어도 타입 OFF 면 그 타입만 0 — 다른 켜진 타입은 나간다', async () => {
    const { svc, created } = mk({ config: on('LAB_RESULT') }); // CALLED 는 꺼둔 채
    const off = await svc.deliver('p1', 'CALLED', 't', 'b', { requested: true, now: NOON_KST });
    expect(off).toEqual({ attempted: false, sent: false, reason: 'TYPE_DISABLED', pushChannel: null });

    const okd = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(okd.sent).toBe(true);
    expect(okd.reason).toBe('SENT');
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('LAB_RESULT');
  });

  it('꺼져 있을 때 조용히 통과하지 않는다 — 설정 키를 실제로 읽는다(로그의 근거)', async () => {
    const { svc, config } = mk();
    await svc.deliver('p1', 'BILLING', 't', 'b', { requested: true });
    expect(config.get).toHaveBeenCalledWith(PATIENT_PUSH_MASTER_KEY);
  });
});

describe('옵트인 — 설정만으로 몰래 나가지 않는다', () => {
  it('🔴 직원이 요청하지 않으면(notifyPatient 미체크) 설정이 다 켜져 있어도 0', async () => {
    const { svc, prisma } = mk({ config: on('CALLED') });
    const r = await svc.deliver('p1', 'CALLED', 't', 'b', { now: NOON_KST }); // requested 없음
    expect(r).toEqual({ attempted: false, sent: false, reason: 'NOT_REQUESTED', pushChannel: null });
    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
  });

  it('요청 + 설정 ON 이면 1회 나간다', async () => {
    const { svc, created } = mk({ config: on('CALLED') });
    const r = await svc.deliver('p1', 'CALLED', '진료 호출', '내과에서 호출되었습니다.', {
      requested: true, now: NOON_KST,
    });
    expect(r).toEqual({ attempted: true, sent: true, reason: 'SENT', pushChannel: 'ATTEMPTED' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ accountId: ACCOUNT.id, type: 'CALLED', title: '진료 호출' });
  });

  it('🔴 옵트인 없는 유형(LAB_RESULT)은 시스템이 만드는 것이라 requested 를 요구하지 않는다', async () => {
    expect(PATIENT_PUSH_TYPES.LAB_RESULT.requiresOptIn).toBe(false);
    const { svc } = mk({ config: on('LAB_RESULT') });
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(true);
  });
});

describe('중복 억제 — 쏟아지지 않게', () => {
  it('🔴 같은 환자·같은 타입 2회 → 1회만(2번째는 DUPLICATE_SUPPRESSED)', async () => {
    // 실제 조회 동작을 흉내: 억제 창 안에 이미 만들어진 같은 타입이 있으면 findFirst 가 그것을 준다
    const rows: Array<{ type: string; createdAt: Date }> = [];
    const prisma: any = {
      patientAccount: { findFirst: vi.fn(async () => ACCOUNT) },
      patientNotification: {
        findFirst: vi.fn(async ({ where }: any) =>
          rows.find((r) => r.type === where.type && r.createdAt >= where.createdAt.gte) ?? null,
        ),
        create: vi.fn(async ({ data }: any) => {
          rows.push({ type: data.type, createdAt: new Date(NOON_KST) });
          return { id: `pn-${rows.length}`, ...data };
        }),
      },
    };
    const svc = new PatientPushGateService(prisma, { pushPatientNotification: vi.fn(async () => undefined) } as any, {
      get: vi.fn(async (k: string) => on('CALLED')[k] ?? null),
    } as any);

    const a = await svc.deliver('p1', 'CALLED', 't', 'b', { requested: true, now: NOON_KST });
    const b = await svc.deliver('p1', 'CALLED', 't', 'b', { requested: true, now: NOON_KST });
    expect(a.reason).toBe('SENT');
    expect(b).toEqual({ attempted: false, sent: false, reason: 'DUPLICATE_SUPPRESSED', pushChannel: null });
    expect(prisma.patientNotification.create).toHaveBeenCalledTimes(1);
  });

  it('억제 창은 유형별 정본 값으로 조회한다 — 값이 바뀌면 조회 창도 바뀐다', async () => {
    const { svc, prisma } = mk({ config: on('PHARMACY') });
    await svc.deliver('p1', 'PHARMACY', 't', 'b', { requested: true, now: NOON_KST });
    const where = prisma.patientNotification.findFirst.mock.calls[0][0].where;
    expect(where.type).toBe('PHARMACY');
    expect(NOON_KST.getTime() - where.createdAt.gte.getTime()).toBe(
      PATIENT_PUSH_TYPES.PHARMACY.dedupMinutes * 60_000,
    );
  });
});

describe('야간 억제 — 긴급 계열은 예외', () => {
  it('🔴 야간 창(KST 02시)에는 LAB_RESULT 가 나가지 않는다 · 지연이 아니라 미발송이다', async () => {
    const { svc, prisma } = mk({ config: on('LAB_RESULT') });
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NIGHT_KST });
    expect(r).toEqual({ attempted: false, sent: false, reason: 'QUIET_HOURS', pushChannel: null });
    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
  });

  it('🔴 진료 호출은 야간에도 나간다 — 지금 부르는 것을 억제하면 환자가 호출을 못 듣는다(응급실 24시간)', async () => {
    expect(PATIENT_PUSH_TYPES.CALLED.quietHoursExempt).toBe(true);
    const { svc, created } = mk({ config: on('CALLED') });
    const r = await svc.deliver('p1', 'CALLED', 't', 'b', { requested: true, now: NIGHT_KST });
    expect(r.reason).toBe('SENT');
    expect(created).toHaveLength(1);
  });

  it('원내 대기 계열(약 수령·수납)도 야간 예외 — 환자가 그 자리에서 기다리는 알림이다', () => {
    expect(PATIENT_PUSH_TYPES.PHARMACY.quietHoursExempt).toBe(true);
    expect(PATIENT_PUSH_TYPES.BILLING.quietHoursExempt).toBe(true);
    for (const d of Object.values(PATIENT_PUSH_TYPES)) {
      expect(d.quietHoursNote.length, `${d.type}: 야간 예외/억제 근거를 적는다`).toBeGreaterThan(10);
    }
  });

  it('KST 계산은 OS 타임존에 기대지 않는다(컨테이너는 UTC)', () => {
    expect(kstHour(new Date('2026-08-19T17:00:00.000Z'))).toBe(2);
    expect(kstHour(new Date('2026-08-20T03:00:00.000Z'))).toBe(12);
    expect(isQuietHour(2, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isQuietHour(23, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isQuietHour(12, DEFAULT_QUIET_HOURS)).toBe(false);
    // start === end 는 "억제 없음"
    expect(isQuietHour(3, { startHour: 0, endHour: 0 })).toBe(false);
    // 형식 위반은 조용히 기본값 유지(fail-safe — 억제가 사라지지 않는다)
    expect(normalizeQuietHours({ startHour: 'x', endHour: 9 })).toEqual(DEFAULT_QUIET_HOURS);
    expect(normalizeQuietHours(null)).toEqual(DEFAULT_QUIET_HOURS);
    expect(normalizeQuietHours({ startHour: 21, endHour: 8 })).toEqual({ startHour: 21, endHour: 8 });
  });
});

describe('정직성 — 안 보냈으면 안 보냈다고 말한다', () => {
  it('🔴 환자앱 계정이 없으면 NO_PATIENT_ACCOUNT — 실패가 아니지만 "보냄"도 아니다', async () => {
    const { svc, prisma } = mk({ config: on('LAB_RESULT'), account: null });
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('NO_PATIENT_ACCOUNT');
    expect(prisma.patientNotification.create).not.toHaveBeenCalled();
  });

  it('🔴 수신자가 하나도 없으면 성공으로 접지 않는다(NO_LISTENER)', () => {
    expect(firstPatientPushResult([])).toEqual({ attempted: false, sent: false, reason: 'NO_LISTENER', pushChannel: null });
    expect(firstPatientPushResult(undefined)).toEqual({ attempted: false, sent: false, reason: 'NO_LISTENER', pushChannel: null });
    expect(firstPatientPushResult([{ attempted: true, sent: true, reason: 'SENT', pushChannel: 'ATTEMPTED' }]).sent).toBe(true);
  });

  it('sent=true 인 경우에만 원장(PatientNotification)이 만들어진다', async () => {
    for (const [cfg, expected] of [
      [{}, false],
      [on('LAB_RESULT'), true],
    ] as const) {
      const { svc, created } = mk({ config: cfg as Record<string, unknown> });
      const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
      expect(r.sent).toBe(expected);
      expect(created.length > 0).toBe(expected);
    }
  });

  it('예외는 삼키지 않고 ERROR 로 말한다(성공으로 접지 않는다)', async () => {
    const prisma: any = {
      patientAccount: { findFirst: vi.fn(async () => { throw new Error('db down'); }) },
      patientNotification: { findFirst: vi.fn(), create: vi.fn() },
    };
    const svc = new PatientPushGateService(prisma, { pushPatientNotification: vi.fn(async () => undefined) } as any, {
      get: vi.fn(async (k: string) => on('LAB_RESULT')[k] ?? null),
    } as any);
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r).toEqual({ attempted: true, sent: false, reason: 'ERROR', pushChannel: null });
  });
});

describe('리스너가 판정 결과를 발행부로 되돌린다 — 화면이 사유를 그대로 말할 수 있게', () => {
  const mkListener = (result: unknown) => {
    const gate: any = { deliver: vi.fn(async () => result), rawCreate: vi.fn(async () => true) };
    const listener = new NotificationListener({} as any, {} as any, {} as any, gate, undefined);
    return { listener, gate };
  };

  it('🔴 handler 가 결과를 return 한다 — void 로 바꾸면 발행부가 NO_LISTENER 를 받게 된다', async () => {
    const sent = { attempted: true, sent: true, reason: 'SENT' as const, pushChannel: 'ATTEMPTED' as const };
    for (const [fn, payload] of [
      ['handlePatientCalled', { patientId: 'p1', notifyPatient: true }],
      ['handlePrescriptionReady', { patientId: 'p1', notifyPatient: true }],
      ['handleBillingPending', { patientId: 'p1', amount: 12000, notifyPatient: true }],
      ['handlePatientLabResult', { patientId: 'p1', testName: 'CBC' }],
    ] as const) {
      const { listener, gate } = mkListener(sent);
      const r = await (listener as any)[fn](payload);
      expect(r, `${fn} 이 판정 결과를 돌려주지 않는다`).toEqual(sent);
      expect(gate.deliver).toHaveBeenCalledTimes(1);
    }
  });

  it('옵트인 값이 게이트까지 그대로 전달된다(중간에서 true 로 바뀌지 않는다)', async () => {
    const { listener, gate } = mkListener({ attempted: false, sent: false, reason: 'NOT_REQUESTED', pushChannel: null });
    await listener.handlePatientCalled({ patientId: 'p1' }); // notifyPatient 없음
    expect(gate.deliver.mock.calls[0][4]).toEqual({ requested: false });
  });

  it('🔴 금액이 없으면 문구에 금액을 지어내지 않는다', async () => {
    const { listener, gate } = mkListener({ attempted: false, sent: false, reason: 'NOT_REQUESTED', pushChannel: null });
    await listener.handleBillingPending({ patientId: 'p1', notifyPatient: true });
    expect(gate.deliver.mock.calls[0][3]).toBe('수납 처리가 필요합니다. 수납 창구를 방문해주세요.');

    const b = mkListener({ attempted: false, sent: false, reason: 'NOT_REQUESTED', pushChannel: null });
    await b.listener.handleBillingPending({ patientId: 'p1', amount: 12000, notifyPatient: true });
    expect(b.gate.deliver.mock.calls[0][3]).toContain('12,000원');
  });
});

describe('설정 조회 — 관리 화면이 그릴 근거', () => {
  it('마스터·타입별·야간 창을 분모 없이 지어내지 않고 그대로 낸다', async () => {
    const { svc } = mk({ config: { ...on('CALLED'), [PATIENT_PUSH_QUIET_HOURS_KEY]: { startHour: 21, endHour: 8 } } });
    const s = await svc.settings();
    expect(s.master).toEqual({ key: PATIENT_PUSH_MASTER_KEY, enabled: true });
    expect(s.quietHours).toMatchObject({ startHour: 21, endHour: 8, timezone: 'Asia/Seoul', deferred: false });
    const called = s.types.find((t) => t.type === 'CALLED')!;
    const lab = s.types.find((t) => t.type === 'LAB_RESULT')!;
    expect(called.enabled).toBe(true);
    expect(called.effective).toBe(true);
    expect(lab.enabled).toBe(false);
    expect(lab.effective).toBe(false); // 마스터 ON 이어도 타입 OFF 면 안 나간다
    expect(s.types).toHaveLength(Object.keys(PATIENT_PUSH_TYPES).length);
  });

  it('마스터가 꺼지면 켜진 타입도 effective=false(한쪽만 보면 "켰는데 안 나간다"가 된다)', async () => {
    const { svc } = mk({ config: { [patientPushTypeKey('CALLED')]: true } }); // 마스터 미설정
    const s = await svc.settings();
    const called = s.types.find((t) => t.type === 'CALLED')!;
    expect(called.enabled).toBe(true);
    expect(called.effective).toBe(false);
  });
});

/**
 * 🔴 코디네이터 보강(2026-08-20) — **인앱 알림과 단말 푸시는 다른 층이다.**
 *
 * `sent:true` 는 "PatientNotification 이 만들어졌다"는 뜻이고, FCM 자격이 없어도 true 다.
 * 화면이 그것을 "폰으로 갔다"로 읽으면 과잉 주장이 된다 — 채널 상태를 함께 낸다.
 * 재주입: `patientPushResult(created ? 'SENT' : …, channel)` 에서 channel 을 빼면 실패한다.
 */
describe('단말 푸시 층 — sent:true 가 곧 "폰으로 갔다"가 아니다', () => {
  it('FCM 자격이 있으면 ATTEMPTED', async () => {
    const { svc } = mk({ config: on('LAB_RESULT') });
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(true);
    expect(r.pushChannel).toBe('ATTEMPTED');
  });

  it('🔴 FCM 자격이 없으면 UNAVAILABLE — 원장에는 남지만 폰은 울리지 않는다', async () => {
    const { svc, fcm } = mk({ config: on('LAB_RESULT') });
    fcm.isEnabled = false;
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(true); // 앱 알림은 실제로 만들어졌다
    expect(r.pushChannel).toBe('UNAVAILABLE');
  });

  it('보내지 않았으면 채널은 해당 없음(null) — 모르는 것을 채우지 않는다', async () => {
    const { svc } = mk(); // 기본 OFF
    const r = await svc.deliver('p1', 'LAB_RESULT', 't', 'b', { now: NOON_KST });
    expect(r.sent).toBe(false);
    expect(r.pushChannel).toBeNull();
  });
});
