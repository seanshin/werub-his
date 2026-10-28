import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 결정 경로가 **화면에 붙었다** (2026-08-28 · P2 화면).
 *
 * 🔴 규칙: *"EP 를 만들면 부르는 화면까지가 한 벌"*. P2 엔진은 만들었지만 소비처가 0이었다.
 *    엔진의 존재 이유는 **"N건 진행 중"이 아니라 무엇이 어디서 왜 멈췄는지**를 보이는 것이다.
 *
 * 재주입: 막힌 이유·담당 표시를 지우거나, 조회 실패를 "없음"으로 뭉개면 실패한다.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/app/(main)/admin/governance/page.tsx'), 'utf-8');
/** 🔴 주석에 규칙 문구가 인용돼 있다 — 코드만 본다(이 세션에서 세 번 겪은 함정) */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('막혀 있는 결정 카드', () => {
  it('🔴 막힌 목록을 부른다 — 엔진의 존재 이유', () => {
    expect(CODE).toContain('/api/v1/governance/pathways/blocked');
  });

  it('🔴 무엇이·어디서·왜 를 모두 보여준다', () => {
    expect(CODE).toContain('무엇이·어디서·왜');
    expect(CODE).toMatch(/\{b\.blockedReason\}/);         // 왜
    expect(CODE).toMatch(/cur\?\.title \?\? b\.currentStepKey/); // 어디서
    expect(CODE).toMatch(/b\.source\.kind === 'AGENDA'/);  // 무엇이
  });

  it('🔴 담당을 모르면 모른다고 말한다 — 빈 배열로 "아무도 아니다"라 하지 않는다', () => {
    expect(CODE).toContain('담당 미지정');
    expect(CODE).toMatch(/b\.currentOwnerRoles\?\.length \? .* : '담당 미지정'/);
  });

  it('🔴 조회 실패를 "막힌 것 없음"으로 말하지 않는다', () => {
    expect(CODE).toMatch(/blockedQ\.isError \? \(/);
    expect(CODE).toContain('QueryErrorFallback');
  });
});

describe('🔴 P3 — 층별 진행은 합치지 않는다', () => {
  it('층별 카드를 그리고, 층 이름 정본을 재정의하지 않는다', () => {
    expect(CODE).toContain('/api/v1/governance/pathways/summary');
    expect(CODE).toContain('LAYER_TITLE_SHORT');
    // 🔴 화면이 자기 층 이름 Record 를 두면 정본이 둘이 된다
    expect(CODE, '층 이름을 로컬에서 다시 정의하지 않는다').not.toMatch(/LICENSE_HOLDER\s*:/);
  });

  it('🔴 표본이 없으면 0 이 아니라 "산출 불가"라고 말한다', () => {
    expect(CODE).toMatch(/stayDaysMedian == null/);
    // 🔴 문구를 손으로 적지 않고 shared 어휘 정본을 쓴다
    expect(CODE).toContain('RATIO_UNAVAILABLE');
    expect(CODE, '산출 불가를 화면이 자체 구현하지 않는다').not.toContain("'산출 불가'");
  });

  it('🔴 기준이 없다는 사실과 절단을 화면이 말한다', () => {
    expect(CODE).toContain('slaNote');
    expect(CODE).toMatch(/truncated &&/);
    expect(CODE).toContain('전수 아님');
  });

  it('🔴 조회 실패를 "0건"으로 그리지 않는다 — 실패 분기가 따로 있다', () => {
    expect(CODE).toMatch(/layerQ\.isError/);
    expect(CODE).toMatch(/layerQ\.isLoading/);
  });
});

describe('🔴 P3 — 체류일은 사실, 지연은 판정', () => {
  it('체류일을 보여준다', () => {
    expect(CODE).toMatch(/currentStepDays != null/);
    expect(CODE).toContain('일 경과');
  });

  it('🔴 화면이 "지연"이라 말하지 않는다 — 기준(SLA)이 없으므로 판정할 수 없다', () => {
    // 기준 없이 "지연 N건"이라 쓰면 근거 없는 경보가 된다
    expect(CODE, '기준이 생기기 전에는 지연이라 부르지 않는다').not.toContain('지연');
    expect(CODE).not.toContain('초과');
  });
});

describe('안건 목록의 경로 열', () => {
  it('🔴 안건별 경로를 부른다', () => {
    expect(CODE).toContain('/api/v1/governance/pathways/instance');
  });

  it('🔴 "경로 미시작"과 "확인 불가"를 구분한다 — 조회 실패는 없음이 아니다', () => {
    expect(CODE).toContain('경로 미시작');
    expect(CODE).toContain('확인 불가');
    expect(CODE).toContain('없다는 뜻이 아닙니다');
    expect(CODE).toContain('확인 중');
    /**
     * 🔴 처음 이 가드는 문구만 봤다 — 분기를 `false ? …` 로 죽여도 문구는 남아 **통과했다**.
     *    (이 세션에서 네 번째 "다른 이유로 통과한 가드")
     *    실제로 **조회 실패 상태를 읽는지**를 못박는다.
     */
    expect(CODE, '실패 분기가 isError 를 실제로 읽어야 한다').toMatch(/\{pathQ\.isError \? \(/);
    expect(CODE, '로딩 분기도 마찬가지').toMatch(/pathQ\.isLoading \? \(/);
  });

  it('🔴 진행률에 분모를 함께 낸다', () => {
    expect(CODE).toMatch(/p\.progress\.done\}\/\{p\.progress\.total/);
  });

  it('열 수를 늘렸으면 EmptyState colSpan 도 맞춘다(표가 깨지지 않게)', () => {
    const headers = (CODE.match(/<th className="text-(left|right) py-3 px-4 font-medium">/g) ?? []).length;
    expect(headers).toBeGreaterThanOrEqual(7);
    expect(CODE).toMatch(/colSpan=\{7\}/);
  });
});
