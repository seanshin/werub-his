import { describe, it, expect } from 'vitest';
import { probeOutboxIdle, probeOutboxStuck, type OutboxSnapshot } from '../../src/sentinel/pipe-sweep';
import { PIPE_CHECKS } from '../../src/sentinel/pipe-registry';

/**
 * 대외 발신 파이프 관측(2026-09-16 E4).
 *
 * 🔴 실측이 이 항목을 만들었다: 운영 outbox 는 2026-08-02 이후 **6주간 0행**인데 그 사이 청구 73·조제 86건이
 *    생겼고 `erp.webhookEnabled=true`·활성 웹훅 2개였다. `enqueue()` 가 실패를 warn 하나로 삼키고
 *    감시자는 이 파이프를 **아예 보지 않아서**, 발신이 죽었는지 보낼 것이 없었는지 구분할 길이 없었다.
 */
const snap = (o: Partial<OutboxSnapshot> = {}): OutboxSnapshot => ({
  enabled: true,
  lastEnqueuedAt: new Date('2026-09-16T00:00:00Z'),
  failed: 0,
  overduePending: 0,
  ...o,
});
const NOW = new Date('2026-09-16T00:00:00Z');
const TWO_WEEKS = 24 * 14;

describe('outbox 적재 정체(pipe.outbox.idle)', () => {
  it('🔴 발신이 켜져 있는데 6주간 적재가 없으면 위반 — 원인은 단정하지 않는다', () => {
    const r = probeOutboxIdle(snap({ lastEnqueuedAt: new Date('2026-08-02T00:00:00Z') }), TWO_WEEKS, NOW);
    expect(r.observable).toBe(true);
    expect(r.value).toBe(1);
    // 🔴 숫자는 문장이 아니라 필드로 내려온다(서버가 한국어를 조립하지 않는다 — 화면 언어를 바꿔도 남는다)
    expect(r.ageHours).toBe(45 * 24);
    expect(r.detail, '원인을 하나로 단정했다').toContain('확인이 필요');
  });

  it('🔴 발신이 꺼져 있으면 위반이 아니라 관측 불가 — 끈 것을 죽었다고 말하지 않는다', () => {
    const r = probeOutboxIdle(snap({ enabled: false, lastEnqueuedAt: null }), TWO_WEEKS, NOW);
    expect(r.observable).toBe(false);
    expect(r.value).toBe(0);
  });

  it('대조군 — 최근에 적재가 있으면 위반 0', () => {
    const r = probeOutboxIdle(snap({ lastEnqueuedAt: new Date('2026-09-15T00:00:00Z') }), TWO_WEEKS, NOW);
    expect(r.value).toBe(0);
  });

  it('DB 조회 실패는 0건이 아니라 관측 불가', () => {
    expect(probeOutboxIdle(null, TWO_WEEKS, NOW).observable).toBe(false);
  });

  it('켜져 있는데 적재 기록이 한 건도 없으면 위반', () => {
    expect(probeOutboxIdle(snap({ lastEnqueuedAt: null }), TWO_WEEKS, NOW).value).toBe(1);
  });
});

describe('outbox 적체(pipe.outbox.stuck)', () => {
  it('🔴 FAILED 와 기한 지난 PENDING 을 합치되 한 이름으로 부르지 않는다', () => {
    const r = probeOutboxStuck(snap({ failed: 3, overduePending: 2 }));
    expect(r.value).toBe(5);
    expect(r.failed).toBe(3);
    expect(r.overduePending).toBe(2);
    expect(r.detail, '두 종류를 구분해 말한다').toMatch(/최종 실패.*기한 경과/);
  });

  it('대조군 — 적체가 없으면 0', () => {
    expect(probeOutboxStuck(snap()).value).toBe(0);
  });

  it('조회 실패는 관측 불가(0건이라 말하지 않는다)', () => {
    expect(probeOutboxStuck(null).observable).toBe(false);
  });
});

describe('등록부 배선', () => {
  it('🔴 두 항목이 등록부에 있고 프로브 종류가 OUTBOX 다(빠지면 화면에서 통째로 사라진다)', () => {
    const keys = PIPE_CHECKS.filter((c) => c.probe === 'OUTBOX').map((c) => c.key);
    expect(keys).toEqual(['pipe.outbox.idle', 'pipe.outbox.stuck']);
    // FAILED 는 사람이 눌러야 나간다 — 놓치면 영영 안 나가므로 RED
    expect(PIPE_CHECKS.find((c) => c.key === 'pipe.outbox.stuck')!.severity).toBe('RED');
    // 🔴 딥링크는 실재하는 화면이어야 한다 — /admin/erp 의 '연동 모니터(outbox)' 카드
    for (const c of PIPE_CHECKS.filter((x) => x.probe === 'OUTBOX')) expect(c.drillDown).toBe('/admin/erp');
  });
});
