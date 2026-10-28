import { describe, it, expect } from 'vitest';
import { maskPublicName } from '../../src/modules/emergency/er-flow-display.service';
import { WaitingQueueService, maskGuideName } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 🔴 **공개 전광판 이름 마스킹이 두 곳에 각자 구현돼 있다** (2026-08-29 · 발굴 15회차).
 *
 * · `er-flow-display.service.ts` → `maskPublicName()`
 * · `waiting-queue.service.ts`  → `WaitingQueueService.maskName()`
 *
 * 지금은 **문자 단위로 동일**하다. 그런데 강제하는 것이 없다 — 한쪽만 고치면
 * **한 전광판은 마스킹하고 다른 전광판은 안 하는** 상태가 조용히 생긴다.
 * 이 저장소가 반복해 겪은 형태다(*"같은 사실에 정본이 둘이면 갈라진다"*).
 *
 * 🔴 **여기서 정본을 하나로 합치지 않은 이유**: 두 모듈이 서로를 import 하면
 *    순환 의존이 될 수 있고(부트 검증에서만 드러나는 사고), 실익 대비 위험이 크다.
 *    대신 **두 구현이 같은 답을 내는지 기계로 대조**한다 —
 *    합치는 것은 사람이 정할 리팩터링이다.
 *
 * 🔴 이 가드는 **행동으로 대조한다**(문자열 비교가 아니다) —
 *    구현이 달라져도 답이 같으면 통과한다. 지켜야 할 것은 **출력**이다.
 */
const svc = new WaitingQueueService(
  {} as never, {} as never, {} as never, {} as never, {} as never,
  {} as never, {} as never, {} as never, {} as never, {} as never,
);

describe('🔴 공개 전광판 마스킹은 두 곳이 같은 답을 낸다', () => {
  const CASES: Array<[string, string]> = [
    ['홍', '길동'],      // 3자 → 홍○동
    ['김', '철수'],      // 3자
    ['이', '준'],        // 2자 → 이○
    ['남궁', '민수'],    // 4자
    ['王', '伟'],        // 한자 2자
    ['O', ''],           // 1자 — 마스킹할 것이 없다
    ['', ''],            // 빈 값
    ['Бат-Эрдэнэ', 'Сарнай'], // 비한글 장문
  ];

  for (const [f, g] of CASES) {
    it(`"${f}${g}" — 두 구현이 같은 답`, () => {
      expect(maskPublicName(f, g)).toBe(svc.maskName(f, g));
    });
  }

  it('🔴 마스킹이 실제로 일어난다(대조군 — 둘 다 원문을 내면 위 검사가 통과해도 소용없다)', () => {
    expect(maskPublicName('홍', '길동')).toBe('홍○동');
    expect(svc.maskName('홍', '길동')).toBe('홍○동');
    expect(maskPublicName('이', '준')).toBe('이○');
  });

  it('🔴 1자 이하는 마스킹하지 않는다 — 가릴 것이 없다(둘 다 같은 판단)', () => {
    expect(maskPublicName('O', '')).toBe('O');
    expect(svc.maskName('O', '')).toBe('O');
  });
});

/**
 * 🔴 **세 번째 구현** (2026-09-16 F1) — 공개 길안내(QR·무인증)는 위 두 곳과 다른 규칙을 쓴다.
 *
 * 이 가드의 종전 전제는 "공개 마스킹은 두 곳"이었다. 실제로는 길안내 핸들러 안에 인라인으로
 * 하나가 더 있었다 — 즉 **가드가 덮는다고 믿은 범위가 이미 틀려 있었다.**
 *
 * 길안내는 이름 전체를 가려(홍○○) 정본(홍○동)보다 **더** 가린다. 공개 면에서 덜 가리는 쪽으로
 * 자동 수렴시키지 않고, 지켜야 할 성질만 못박는다 — **정본보다 덜 가리지 않는다.**
 * 하나로 합칠지는 사람이 정한다(합치면 길안내가 지금보다 한 글자를 더 드러낸다).
 */
describe('🔴 공개 길안내 마스킹 — 정본보다 덜 가리지 않는다', () => {
  /** 원문에서 그대로 남은 글자 수(마스킹 문자 ○ 는 제외) */
  const revealed = (masked: string) => [...masked].filter((c) => c !== '○').length;

  const CASES: Array<[string, string]> = [
    ['홍', '길동'], ['김', '철수'], ['이', '준'], ['남궁', '민수'], ['王', '伟'],
  ];

  for (const [f, g] of CASES) {
    it(`"${f}${g}" — 길안내가 전광판보다 더 드러내지 않는다`, () => {
      expect(revealed(maskGuideName(f, g))).toBeLessThanOrEqual(revealed(maskPublicName(f, g)));
    });
  }

  it('현재 동작 동결 — 성만 남기고 이름 글자 수만큼 가린다', () => {
    expect(maskGuideName('홍', '길동')).toBe('홍○○');
    expect(maskGuideName('이', '준')).toBe('이○');
    expect(maskGuideName('남궁', '민수')).toBe('남궁○○');
  });

  it('🔴 대조군 — 마스킹이 실제로 일어난다(원문을 그대로 내면 위 검사들이 무의미하다)', () => {
    expect(maskGuideName('홍', '길동')).not.toContain('길');
    expect(maskGuideName('홍', '길동')).not.toContain('동');
  });

  it('이름이 비어도 최소 한 글자는 가린 모양을 낸다(빈 성은 그대로)', () => {
    expect(maskGuideName('홍', '')).toBe('홍○');
  });
});
