/**
 * 🔴 나이 계산이 정본(`ageOf`)을 안 쓰던 두 자리 — 2026-08-27.
 *
 *  ① `(main)/patients/[id]/page.tsx` — 불량·미래 생년월일에 **`return 0`**.
 *     0세는 **신생아**라는 다른 사실이다. 이 값은 환자 헤더와 환자정보 탭이 그대로 찍는다
 *     (소아 용량·검사 기준치·연령가산을 읽는 사람이 보는 자리다).
 *     정본 `ageOf` 는 모르는 값을 **`null`** 로 답한다 — P1(아는 것/모르는 것을 뒤바꿔 말함).
 *  ② `components/workstation/PatientAddModal.tsx` — `Math.floor(Δ/(365.25*86400000))` 근사.
 *     **생일 경계에서 한 살 어긋난다.** BE 32곳이 같은 병이라 2026-08 에 `ageOf` 로 통일했는데
 *     이 화면만 남아 있었다. 게다가 유효하지 않은 생년월일에 `'-'` 를 돌려주고 호출부가
 *     `세` 를 붙여 화면에 **"-세"** 라고 찍혔다.
 *
 * 재주입: 두 파일 중 하나라도 로컬 나이 계산(연도 뺄셈·365.25 나눗셈)을 되살리거나
 *         `null` 을 `0`/`'-'` 로 접으면 이 파일이 실패한다.
 * 대조군: 정본이 **정상 입력에는 정상 답**을 준다는 것과, `null` 자리에 화면이 실제로
 *         "나이 미상"을 그리는지 함께 본다(스캔만 하는 가드는 문구가 사라져도 통과한다).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ageOf } from '@hospital-run/shared';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** 주석은 사건 경위를 적어야 하므로 제외하고 실행되는 코드만 본다. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TARGETS = [
  'app/(main)/patients/[id]/page.tsx',
  'components/workstation/PatientAddModal.tsx',
];

/** 화면이 나이 미상을 그리는 자리 — 문구가 사라지면 `null` 이 조용히 뭉개진 것이다. */
const UNKNOWN_TEXT_FILES = [
  'app/(main)/patients/[id]/components/BoardHeaderBar.tsx',
  'app/(main)/patients/[id]/components/PatientHeader.tsx',
  'app/(main)/patients/[id]/components/PatientInfoTab.tsx',
  'components/workstation/PatientAddModal.tsx',
];

describe('나이는 정본으로만 계산한다', () => {
  it.each(TARGETS)('🔴 %s 는 `ageOf` 를 부른다', (rel) => {
    const src = code(read(rel));
    expect(src).toMatch(/\bageOf\s*\(/);
    expect(src).toMatch(/from\s+'@hospital-run\/shared'/);
  });

  it.each(TARGETS)('🔴 %s 에 로컬 나이 계산이 남아 있지 않다', (rel) => {
    const src = code(read(rel));
    // 365.25 근사
    expect(src, '365.25 근사').not.toMatch(/365\.25/);
    // 연도 뺄셈으로 나이를 만드는 관용구
    expect(src, 'getFullYear 뺄셈').not.toMatch(/getFullYear\(\)\s*-\s*\w+\.getFullYear\(\)/);
  });

  it('🔴 나이 미상을 `0` 이나 `-` 로 접지 않는다 — 화면이 "나이 미상"이라 말한다', () => {
    for (const rel of UNKNOWN_TEXT_FILES) {
      // 🔴 주석을 벗기고 본다 — 설명문에만 남은 문구가 렌더를 대신하지 못한다.
      expect(code(read(rel)), rel).toContain('나이 미상');
    }
  });

  it('환자 상세의 나이 prop 은 `null` 을 받을 수 있다(타입에서부터 0 과 구분한다)', () => {
    for (const rel of UNKNOWN_TEXT_FILES.slice(0, 3)) {
      expect(code(read(rel)), rel).toMatch(/patientAge:\s*number\s*\|\s*null/);
    }
  });
});

describe('대조군 — 정본이 실제로 옳은 답을 준다(가드가 헛돌지 않는다)', () => {
  const at = (iso: string) => new Date(iso);

  it('생일 전날은 아직 한 살 적고, 생일 당일에 오른다', () => {
    expect(ageOf('1990-06-15', at('2026-06-14T09:00:00'))).toBe(35);
    expect(ageOf('1990-06-15', at('2026-06-15T09:00:00'))).toBe(36);
  });

  it('🔴 365.25 근사였다면 어긋났을 경계 — 윤년을 여러 번 지난 생일 당일', () => {
    // 2000-02-29 생 → 2026-03-01 시점 26세. 근사(Δ/365.25)는 경계에서 25 로 내려갈 수 있다.
    expect(ageOf('2000-02-29', at('2026-03-01T00:00:00'))).toBe(26);
  });

  it('🔴 0세(신생아)는 실제 값이지 "모름"이 아니다', () => {
    expect(ageOf('2026-08-01', at('2026-08-27T00:00:00'))).toBe(0);
  });

  it('🔴 모르는 값은 `null` — 0 이 아니다', () => {
    expect(ageOf('not-a-date')).toBeNull();
    expect(ageOf(null)).toBeNull();
    expect(ageOf('')).toBeNull();
    expect(ageOf('2099-01-01', at('2026-08-27T00:00:00'))).toBeNull(); // 미래
  });

  it('가드가 실제 파일을 읽고 있다(경로 오타로 전부 통과하지 않는다)', () => {
    for (const rel of [...TARGETS, ...UNKNOWN_TEXT_FILES]) {
      expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true);
    }
  });
});
