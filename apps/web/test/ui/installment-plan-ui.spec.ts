import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 분할 납부 회차 화면 가드 (2026-08-25 · 시드 흐름 §6 이연 회수)
 *
 * 🔴 종전엔 **계획을 세우는 화면만** 있었다 — 세운 뒤 회차를 보거나 납부할 자리가 없어
 *    EP 두 개가 고아였다("EP 를 만들면 부르는 화면까지가 한 벌").
 * 🔴 같은 파일에서 함께 나온 것: 미수금 조회가 `useState(() => fetch…)` 로 초기화 훅을 부수효과에 쓰고
 *    `.catch(() => {})` 로 실패를 삼켜 **조회 장애가 "미수금 없음"으로 보였다**.
 */
const SRC = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'billing', 'page.tsx');
const src = fs.readFileSync(SRC, 'utf8');

describe('분할 납부 — 계획을 세웠으면 회차를 보고 납부할 수 있다', () => {
  it('🔴 회차 조회 EP 를 부른다', () => {
    expect(src).toMatch(/\/api\/v1\/billings\/\$\{billingId\}\/installments/);
  });

  it('🔴 회차 납부 EP 를 부른다(7단계에서 통합한 정본 경로)', () => {
    expect(src).toMatch(/\/api\/v1\/billing\/installments\/\$\{paymentId\}\/pay/);
  });

  it('분할 진행 중인 건에 회차 진입점이 있다', () => {
    expect(src).toMatch(/setPayPlanFor\(item\.id\)/);
    expect(src).toContain('InstallmentPlanModal');
  });

  it('🔴 결제수단은 선택 — 모르면 보내지 않는다(서버가 UNKNOWN 으로 남기고 화면이 미기록이라 말한다)', () => {
    expect(src).toMatch(/method \? \{ method \} : \{\}/);
  });

  it('대조군 — 납부 완료 회차는 다시 납부 버튼을 열지 않는다', () => {
    expect(src).toMatch(/pmt\.status === 'PAID'/);
  });
});

describe('미수금 조회 실패를 "없음"으로 말하지 않는다', () => {
  it("🔴 useState 초기화 함수에 fetch 부수효과를 넣지 않는다", () => {
    expect(src).not.toMatch(/useState\(\(\) => \{\s*apiClient/);
  });

  it('🔴 조회 실패를 침묵으로 삼키지 않는다 — 화면이 말한다', () => {
    expect(src).toMatch(/outstandingIsError/);
    expect(src).not.toMatch(/billing\/outstanding'\)[\s\S]{0,200}catch\(\(\) => \{\}\)/);
  });
});

describe('결제수단 라벨은 shared 정본', () => {
  it('🔴 로컬 라벨 재정의가 없다', () => {
    expect(src).not.toMatch(/\{ value: 'CARD', label: '카드' \}/);
    expect(src).toMatch(/label: paymentMethodLabel\(value\)/);
  });
});
