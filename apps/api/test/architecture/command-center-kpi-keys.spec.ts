import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { CommandCenterService } from '../../src/modules/command-center/command-center.service';

/**
 * 통합 관제 KPI — **없는 키를 조용히 접지 않는다.**
 *
 * 🔴 2026-09-02 운영 실측: 베드 보드 요약은 `totalBeds` 를 내는데 관제가 `total` 을 읽어
 *    `occupancyDenominator` 가 **항상 null** 이었다. 화면은 그것을
 *    **"산출 불가 — 등록 병상 없음"** 으로 그렸는데, 운영에는 병상 **57개**(5병동)가 있었고
 *    분자(5)와 가동률(9%)은 정상으로 함께 내려오고 있었다.
 *    🔴 **정직해 보이는 '산출 불가'가 그 자체로 거짓**이었던 자리다 —
 *    `nOrNull` 이 없는 키를 null 로 만들어 타입도 테스트도 못 잡았다.
 */
const call = (svc: any, sections: Record<string, unknown>) => (svc as any).buildKpi(sections);

const make = () => {
  // 🔴 목은 **정본의 실제 생성자 모양**을 쓴다 — 8번째는 드리프트 기록기다.
  //    빈 객체를 넣으면 `record` 가 없어 터지고, 그러면 이 가드가 다른 이유로 실패한다.
  const record = vi.fn();
  const svc = new (CommandCenterService as any)(...Array(7).fill({}), { record });
  const warn = vi.fn();
  (svc as any).logger = { warn, log: vi.fn(), error: vi.fn() };
  return { svc, warn, record };
};

/** 운영 실측으로 확인한 실제 키(2026-09-02) */
const BED_SUMMARY = { totalBeds: 57, occupied: 5, occupancyRate: 9 };

describe('관제 KPI 키 계약', () => {
  it('🔴 베드 분모를 실제 키(totalBeds)에서 읽는다 — 운영에 57병상이 있는데 "등록 병상 없음"이었다', () => {
    const { svc } = make();
    const kpi = call(svc, { bed: { ok: true, summary: BED_SUMMARY } });
    expect(kpi.occupancyDenominator).toBe(57);
    expect(kpi.occupancyNumerator).toBe(5);
  });

  it('🔴 섹션은 성공했는데 키가 없으면 로그로 드러낸다(조용한 드리프트 금지)', () => {
    const { svc, warn } = make();
    // 종전 실제 상태: `total` 이 없는 요약
    call(svc, { bed: { ok: true, summary: { totalBeds: 57, occupied: 5, occupancyRate: 9 } } });
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    // bed.total 은 이제 읽지 않으므로 경고가 없어야 한다(대조군)
    expect(msgs.filter((m) => m.includes("'total'"))).toEqual([]);

    const { svc: svc2, warn: warn2, record } = make();
    call(svc2, { bed: { ok: true, summary: { occupied: 5 } } }); // totalBeds 누락
    expect(warn2.mock.calls.map((c) => String(c[0])).some((m) => m.includes("'totalBeds'"))).toBe(true);

    // 🔴 로그만으로는 아무도 보지 않는다 — 감시자 원장에도 남아야 화면에 뜬다(P2)
    const sigs = record.mock.calls.map((c) => c[0] as { kind: string; consumer: string; detail: string });
    expect(sigs.some((g) => g.kind === 'KEY_MISSING' && g.detail.includes("'totalBeds'")), '원장에 적히지 않았다').toBe(true);
    expect(sigs[0].consumer).toBe('command-center.buildKpi');
  });

  it('섹션 자체가 실패했으면 경고하지 않는다 — 그건 키 문제가 아니다', () => {
    const { svc, warn, record } = make();
    call(svc, { bed: { ok: false, error: 'boom' } });
    expect(warn).not.toHaveBeenCalled();
    expect(record, '섹션 실패를 키 드리프트로 적으면 거짓 경보가 된다').not.toHaveBeenCalled();
  });

  it('산출 불가에서는 병상 경보를 올리지 않는다(모르는 것을 위반으로 세지 않는다)', () => {
    const { svc } = make();
    expect(call(svc, { bed: { ok: true, summary: { occupied: 0 } } }).bedAlert).toBe(0);
    expect(call(svc, { bed: { ok: true, summary: { ...BED_SUMMARY, occupancyRate: 95 } } }).bedAlert).toBe(1);
  });

  /**
   * 🔴 **캐스팅이 되돌아오면 이 축 전체가 다시 무방비가 된다.**
   *    `as { summary: Record<string, unknown> }` 한 줄이 생산자 타입을 지워
   *    키 오타를 tsc 에서 화면으로 옮긴다(실제로 그렇게 병상 분모를 잃었다).
   */
  it('🔴 롤업이 하위 보드를 구조 캐스팅으로 받지 않는다 — 키 검사를 tsc 가 계속 하도록', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/modules/command-center/command-center.service.ts'),
      'utf-8',
    );
    // 🔴 주석 안의 같은 문자열이 검사를 대신 통과/실패시키지 않게 먼저 지운다(이 저장소에서 겪은 함정)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const casts = code.match(/as \{\s*summary:\s*Record<string,\s*unknown>\s*\}/g) ?? [];
    expect(casts, `하위 보드 결과를 캐스팅으로 받고 있습니다(${casts.length}곳) — 생산자 타입이 지워집니다`).toEqual([]);
    // 대조군: 타입 유도가 실제로 걸려 있는지(없으면 위 검사가 무의미하다)
    expect(src).toContain('type BoardSummaries');
    expect(src).toContain('NumericKeyOf');
  });
});
