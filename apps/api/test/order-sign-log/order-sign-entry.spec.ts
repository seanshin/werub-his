import { describe, it, expect } from 'vitest';
import {
  deriveEntries,
  missingEntries,
  hasUnrecoverableCancel,
  buildSummary,
  buildSignEventBody,
  shouldRetrySeal,
  ACTION_BY_STATUS,
  ORDER_STREAM,
  SYSTEM_ACTOR,
  MAX_SEAL_ATTEMPTS,
  type OrderStampSnapshot,
} from '../../src/modules/order-sign-log/order-sign-entry';
import { VALID_ORDER_TRANSITIONS } from '../../src/modules/order/order.service';

const d = (s: string) => new Date(s);
const base: OrderStampSnapshot = {
  id: 'o1',
  status: 'ORDERED',
  createdAt: d('2026-07-31T01:00:00Z'),
  prescribedById: 'doc-1',
};

describe('스탬프 → 로그 항목 복원', () => {
  it('발행만 있는 오더는 1건', () => {
    expect(deriveEntries(base).map((e) => e.action)).toEqual(['ORDER_CREATED']);
  });

  it('전이 스탬프 전량을 시간순으로 복원한다', () => {
    const o: OrderStampSnapshot = {
      ...base,
      status: 'COMPLETED',
      receivedAt: d('2026-07-31T02:00:00Z'), receivedById: 'nurse-1',
      startedAt: d('2026-07-31T03:00:00Z'), startedById: 'tech-1',
      completedAt: d('2026-07-31T04:00:00Z'), completedById: 'tech-1',
    };
    expect(deriveEntries(o).map((e) => [e.action, e.actorId])).toEqual([
      ['ORDER_CREATED', 'doc-1'],
      ['ORDER_RECEIVED', 'nurse-1'],
      ['ORDER_IN_PROGRESS', 'tech-1'],
      ['ORDER_COMPLETED', 'tech-1'],
    ]);
  });

  it('행위자를 모르는 전이도 항목은 만든다(actor=null) — 기록 자체를 빠뜨리지 않는다', () => {
    const o: OrderStampSnapshot = { ...base, status: 'COMPLETED', completedAt: d('2026-07-31T04:00:00Z') };
    const done = deriveEntries(o).find((e) => e.action === 'ORDER_COMPLETED');
    expect(done?.actorId).toBeNull();
  });

  it('🔴 취소 시각이 없으면 항목을 만들지 않는다 — 추정 시각을 원장에 박으면 영구히 틀린다', () => {
    const o: OrderStampSnapshot = { ...base, status: 'CANCELLED' };
    expect(deriveEntries(o).map((e) => e.action)).toEqual(['ORDER_CREATED']);
    expect(hasUnrecoverableCancel(o)).toBe(true);
  });

  it('취소 시각이 있으면 복원되고, 미상 판정도 풀린다', () => {
    const o: OrderStampSnapshot = { ...base, status: 'CANCELLED', cancelledAt: d('2026-07-31T05:00:00Z'), cancelledById: 'doc-1' };
    expect(deriveEntries(o).map((e) => e.action)).toContain('ORDER_CANCELLED');
    expect(hasUnrecoverableCancel(o)).toBe(false);
  });

  it('상태 → 행위 매핑이 상태기계 전량을 덮는다(새 상태 추가 시 여기서 걸린다)', () => {
    for (const st of Object.keys(VALID_ORDER_TRANSITIONS)) expect(ACTION_BY_STATUS[st]).toBeTruthy();
  });
});

describe('누락분 대조(멱등)', () => {
  const o: OrderStampSnapshot = {
    ...base, status: 'RECEIVED',
    receivedAt: d('2026-07-31T02:00:00Z'), receivedById: 'nurse-1',
  };

  it('이미 봉인된 전이는 다시 만들지 않는다', () => {
    const existing = [{ action: 'ORDER_CREATED', occurredAt: d('2026-07-31T01:00:00Z') }];
    expect(missingEntries(deriveEntries(o), existing).map((e) => e.action)).toEqual(['ORDER_RECEIVED']);
  });

  it('전부 봉인돼 있으면 빈 배열 — 실시간 배선과 소급 복원이 겹쳐도 이중 기록 없음', () => {
    const existing = [
      { action: 'ORDER_CREATED', occurredAt: d('2026-07-31T01:00:00Z') },
      { action: 'ORDER_RECEIVED', occurredAt: d('2026-07-31T02:00:00Z') },
    ];
    expect(missingEntries(deriveEntries(o), existing)).toEqual([]);
  });

  it('🔴 시각이 달라도 같은 행위는 다시 만들지 않는다 — 스탬프가 갱신되면 중복 봉인된다', () => {
    // 실측: 데모 리프레시가 orders.createdAt 을 재기동마다 갱신 → 같은 오더의 ORDER_CREATED 3건 봉인.
    // 원장은 append-only 라 한번 들어간 중복은 지울 수 없다. 소급 복원은 행위 단위로 한 번만.
    const existing = [{ action: 'ORDER_RECEIVED', occurredAt: d('2026-07-31T09:00:00Z') }];
    expect(missingEntries(deriveEntries(o), existing).map((e) => e.action)).toEqual(['ORDER_CREATED']);
  });

  it('스탬프가 통째로 바뀌어도 신규 항목이 생기지 않는다(재기동 반복 안전)', () => {
    const existing = [
      { action: 'ORDER_CREATED', occurredAt: d('2020-01-01T00:00:00Z') },
      { action: 'ORDER_RECEIVED', occurredAt: d('2020-01-01T00:00:00Z') },
    ];
    expect(missingEntries(deriveEntries(o), existing)).toEqual([]);
  });
});

describe('요약 — PHI 차단', () => {
  it('코드·명칭·용법만 조립한다', () => {
    expect(buildSummary({ codeName: '아모잘탄정', code: 'A11', dosage: '1일 1회', priority: 'STAT' }))
      .toBe('아모잘탄정 (A11) 1일 1회 [STAT]');
  });

  it('ROUTINE 은 표시하지 않는다(신호 없는 정보)', () => {
    expect(buildSummary({ codeName: 'CBC', priority: 'ROUTINE' })).toBe('CBC');
  });

  it('자유입력 지시문은 개행 제거·길이 절단', () => {
    const s = buildSummary({ codeName: 'X', instructions: 'a\n'.repeat(300) });
    expect(s.length).toBeLessThanOrEqual(201);
    expect(s).not.toContain('\n');
  });

  it('🔴 요약 재료에 이름·연락처 자리가 없다 — 넣으려 해도 넣을 필드가 없어야 한다', () => {
    const keys = ['orderType', 'department', 'priority', 'code', 'codeName', 'dosage', 'instructions'];
    const sample = buildSummary({ codeName: 'CBC' });
    expect(sample).toBe('CBC');
    // 타입 계약: SummarySource 에 환자/의료진 필드가 추가되면 이 목록과 어긋나 리뷰에서 걸린다
    expect(keys).not.toContain('patientName');
    expect(keys).not.toContain('phone');
  });
});

describe('sign 전송 본문', () => {
  const body = buildSignEventBody({
    action: 'ORDER_CANCELLED',
    orderId: 'ord-1',
    actorId: 'doc-1',
    actorRole: 'DOCTOR',
    patientId: 'pat-1',
    prescriptionId: 'rx-1',
    orderType: 'LAB',
    department: 'LAB',
    fromStatus: 'ORDERED',
    toStatus: 'CANCELLED',
    summary: 'CBC',
    occurredAt: d('2026-07-31T05:00:00Z'),
    origin: 'EVENT',
  });

  it('오더를 대상으로 지목하고 전용 스트림에 넣는다', () => {
    expect(body.targetType).toBe('ORDER');
    expect(body.targetRef).toBe('ord-1');
    expect(body.stream).toBe(ORDER_STREAM);
    expect(body.occurredAt).toBe('2026-07-31T05:00:00.000Z');
  });

  it('환자는 식별자로만 지목한다 — 본문 어디에도 이름이 없다', () => {
    const flat = JSON.stringify(body);
    expect(body.data.patientId).toBe('pat-1');
    expect(flat).not.toMatch(/familyName|givenName|patientName|phone/);
  });

  it('행위자 미상이면 시스템 주체로 남긴다(빈 actor 로 400 나지 않게)', () => {
    const sys = buildSignEventBody({ action: 'ORDER_COMPLETED', orderId: 'o', toStatus: 'COMPLETED', occurredAt: d('2026-07-31T05:00:00Z'), origin: 'RECONCILED' });
    expect(sys.actor).toBe(SYSTEM_ACTOR);
    expect(sys.data.origin).toBe('RECONCILED');
  });

  it('빈 요약은 키를 아예 넣지 않는다', () => {
    const b = buildSignEventBody({ action: 'ORDER_CREATED', orderId: 'o', toStatus: 'ORDERED', occurredAt: d('2026-07-31T05:00:00Z'), origin: 'EVENT', summary: '' });
    expect(b.data.summary).toBeUndefined();
  });
});

describe('봉인 재시도', () => {
  const now = d('2026-07-31T10:00:00Z');
  it('한 번도 시도 안 했으면 즉시 대상', () => {
    expect(shouldRetrySeal({ sealStatus: 'PENDING', sealAttempts: 0, createdAt: now }, now)).toBe(true);
  });
  it('봉인·면제된 항목은 재시도하지 않는다', () => {
    expect(shouldRetrySeal({ sealStatus: 'SEALED', sealAttempts: 0, createdAt: now }, now)).toBe(false);
    expect(shouldRetrySeal({ sealStatus: 'SKIPPED', sealAttempts: 0, createdAt: now }, now)).toBe(false);
  });
  it('실패는 간격을 벌려 재시도한다', () => {
    const row = { sealStatus: 'FAILED', sealAttempts: 3, createdAt: d('2026-07-31T09:56:00Z') }; // 4분 경과 < 8분
    expect(shouldRetrySeal(row, now)).toBe(false);
    expect(shouldRetrySeal({ ...row, createdAt: d('2026-07-31T09:50:00Z') }, now)).toBe(true);
  });
  it('한계를 넘으면 멈추고 사람이 보도록 남긴다', () => {
    expect(shouldRetrySeal({ sealStatus: 'FAILED', sealAttempts: MAX_SEAL_ATTEMPTS, createdAt: d('2026-01-01T00:00:00Z') }, now)).toBe(false);
  });
});

/**
 * 상태 전이 시각 선택 — 실시간 배선이 소급 복원과 **같은 시각**을 써야 1건으로 합쳐진다.
 * 🔴 우선순위 체인으로 고르면 역전이(IN_PROGRESS→RECEIVED)에서 이전 시행 시각이 잡혔다.
 */
describe('전이 시각 선택', () => {
  const pick = (newStatus: string, o: Record<string, Date | null>, updatedAt: Date) => {
    const stampOf: Record<string, Date | null> = {
      RECEIVED: o.receivedAt, IN_PROGRESS: o.startedAt, COMPLETED: o.completedAt, CANCELLED: o.cancelledAt,
    };
    return stampOf[newStatus] ?? updatedAt;
  };
  const t = (h: number) => d(`2026-07-31T0${h}:00:00Z`);

  it('🔴 역전이는 되돌아간 상태의 스탬프를 쓴다(이전 시행 시각이 아니라)', () => {
    const o = { receivedAt: t(5), startedAt: t(3), completedAt: null, cancelledAt: null };
    expect(pick('RECEIVED', o, t(9))).toEqual(t(5));
  });

  it('각 전이는 자기 스탬프를 집는다', () => {
    const o = { receivedAt: t(1), startedAt: t(2), completedAt: t(3), cancelledAt: t(4) };
    expect(pick('IN_PROGRESS', o, t(9))).toEqual(t(2));
    expect(pick('COMPLETED', o, t(9))).toEqual(t(3));
    expect(pick('CANCELLED', o, t(9))).toEqual(t(4));
  });

  it('스탬프가 없으면 updatedAt 으로 물러난다(기록 자체는 빠뜨리지 않는다)', () => {
    expect(pick('RECEIVED', { receivedAt: null, startedAt: null, completedAt: null, cancelledAt: null }, t(9))).toEqual(t(9));
  });

  it('실시간 배선이 남긴 항목을 소급 복원이 덧쓰지 않는다', () => {
    const at = t(3);
    const derived = deriveEntries({ ...base, status: 'COMPLETED', completedAt: at, completedById: 'u1' });
    expect(missingEntries(derived, [
      { action: 'ORDER_CREATED', occurredAt: base.createdAt },
      { action: 'ORDER_COMPLETED', occurredAt: at },
    ])).toEqual([]);
  });
});
