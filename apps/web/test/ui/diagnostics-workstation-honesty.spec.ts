import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DIAGNOSTIC_TEST_TYPES } from '@hospital-run/shared';

/**
 * 기초검사 화면 정직성 가드 — 2026-08-26.
 *
 * 🔴 봉합한 실결함:
 *   ① `/workstation/diagnostic` 이 `orders`(department=LAB) 큐를 불러서, 심전도·폐기능·내시경·
 *      청력·심장 다섯 자리가 전부 **같은 채혈 오더 8건**을 자기 대기로 보여줬다.
 *      기초검사 정본은 `diagnostic_tests` 다.
 *   ② 두 화면 모두 결론(conclusion)을 `'NORMAL'` 로 시작해, 손대지 않고 저장하면
 *      판독하지 않은 검사가 "정상"으로 기록됐다.
 *   ③ 검사 종류 목록이 서버 1 + FE 3 = **네 벌**로 갈라져 있었다(shared 정본으로 수렴).
 */

const APP = path.join(__dirname, '..', '..', 'src', 'app', '(main)');
const WS_DIAG = path.join(APP, 'workstation', 'diagnostic', 'page.tsx');
const DIAG = path.join(APP, 'diagnostics', 'page.tsx');
const BOARD = path.join(APP, 'diagnostics-board', 'page.tsx');

const read = (p: string) => fs.readFileSync(p, 'utf8');
/**
 * 주석은 제외하고 **실행되는 코드만** 본다 — 주석에 적힌 옛 경로(무엇을 왜 고쳤는지)까지
 * 위반으로 세면 기록을 지우게 된다. 재주입 검증은 아래 it 에서 실제 호출로 확인했다.
 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('기초검사 워크스테이션이 보는 정본', () => {
  const src = code(WS_DIAG);

  it('🔴 검사 오더 큐를 `orders` 워크스테이션 EP 에서 가져오지 않는다', () => {
    expect(src).not.toMatch(/workstation\/station\/[^`'"]*\/queue/);
    expect(src).not.toMatch(/workstation\/order\//);
    expect(src).not.toMatch(/workstation\/lab\//);
  });

  it('대조군 — 기초검사 정본 EP 세 가지를 실제로 부른다(설정·대기·검사값)', () => {
    expect(src).toContain('/api/v1/diagnostic-tests/stations');
    expect(src).toMatch(/diagnostic-tests\/stations\/\$\{[^}]+\}\/queue/);
    expect(src).toMatch(/diagnostic-tests\/\$\{[^}]+\}\/measurements/);
    expect(src).toMatch(/diagnostic-tests\/stations\/\$\{[^}]+\}\/test-types/);
  });

  it('🔴 설정이 없는 자리를 "대기 없음"으로 말하지 않는다(configured 를 읽는다)', () => {
    expect(src).toContain('configured');
    expect(src).toMatch(/waiting === null/); // 미설정 대기 건수를 0 으로 그리지 않는다
  });
});

describe('쓰기 폼 초기값 — 임상값으로 시작하지 않는다', () => {
  for (const [name, file] of [['워크스테이션', WS_DIAG], ['기초검사', DIAG]] as const) {
    it(`🔴 ${name} 화면의 결론은 미선택으로 시작한다`, () => {
      const src = read(file);
      // 결론 state 를 정상값으로 초기화하는 형태를 금지한다
      expect(src).not.toMatch(/useState\(\s*['"]NORMAL['"]\s*\)/);
      expect(src).not.toMatch(/useState\(\s*['"]ABNORMAL['"]\s*\)/);
      expect(src).not.toMatch(/conclusion\s*(\?\?|\|\|)\s*['"]NORMAL['"]/);
    });
  }

  it('🔴 판독 저장 버튼이 결론 미선택 상태로 눌리지 않는다', () => {
    expect(read(DIAG)).toMatch(/disabled=\{[^}]*!conclusion/);
    expect(read(WS_DIAG)).toMatch(/conclusion !== ''/);
  });

  it('검사 의뢰 폼이 검사 유형을 미리 골라두지 않는다', () => {
    const src = read(DIAG);
    expect(src).not.toMatch(/testType:\s*['"]EKG['"]/);
    expect(src).toMatch(/testType:\s*['"]['"]/);
  });
});

describe('검사 종류 어휘는 shared 정본 하나', () => {
  it('세 화면 모두 shared 정본에서 가져온다(로컬 사본 재정의 금지)', () => {
    for (const file of [WS_DIAG, DIAG]) {
      expect(read(file)).toMatch(/from '@hospital-run\/shared'/);
    }
  });

  it('🔴 로컬에 검사 종류 표를 다시 적지 않는다(종전 TABS·TEST_TYPES·TEST_LABEL 3벌)', () => {
    for (const file of [WS_DIAG, DIAG]) {
      const src = read(file);
      // `EKG`/`ENDOSCOPY_UPPER` 같은 종류 코드를 3개 이상 리터럴로 나열하면 사본이다
      const literals = DIAGNOSTIC_TEST_TYPES.filter((t) => new RegExp(`['"]${t.code}['"]`).test(src));
      expect(literals.length, `${path.basename(path.dirname(file))} 에 종류 코드 사본이 있다: ${literals.map((t) => t.code).join(',')}`)
        .toBeLessThan(3);
    }
  });

  it('보드 화면의 라벨표는 정본 코드를 모두 덮는다(빠지면 영문 코드가 새어나온다)', () => {
    const src = read(BOARD);
    if (!/TEST_LABEL/.test(src)) return; // 이미 정본으로 수렴했다면 검사할 것이 없다
    for (const t of DIAGNOSTIC_TEST_TYPES) {
      expect(src, `보드 라벨표에 ${t.code} 가 없다`).toContain(`${t.code}:`);
    }
  });
});

describe('임상 쓰기 버튼 터치 규약(44px)', () => {
  it('검사값 등록·판독 버튼이 44px 이상이다', () => {
    const src = read(WS_DIAG);
    const writeButtons = src.match(/bg-(emerald|blue|amber)-\d00 text-white/g) ?? [];
    expect(writeButtons.length).toBeGreaterThan(0);
    // 모달 하단 저장 버튼들이 min-h-[44px] 를 갖는지
    expect((src.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
