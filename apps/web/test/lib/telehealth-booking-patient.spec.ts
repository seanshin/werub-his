import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 비대면 예약 환자 입력 가드 (2026-08-18).
 *
 * 종전 동작: 원내 '새 원격진료' 예약 모달이 환자를 **UUID 직접 입력**으로 받았다
 * (`placeholder="환자 UUID"`). 실사용에서 아무도 환자 UUID 를 외우지 않는다 —
 * 이 화면은 예약을 만들 수 있는 것처럼 보이지만 사실상 만들 수 없었고,
 * 어쩌다 손으로 넣은 문자열이 맞는 환자인지 화면은 확인해 주지도 않았다.
 *
 * 규약:
 *  - 환자는 **고르는 것**이지 외우는 것이 아니다 → 병원 정본 PatientSelector 재사용
 *    (같은 개념에 정본이 둘이 되면 P12).
 *  - 고르지 않으면 예약 버튼이 잠긴다 — UUID 를 손으로 넣어 우회하는 경로를 남기지 않는다.
 *  - 고른 환자를 **이름으로 되읽어 준다** — 누구를 예약하는지 모른 채 확정하지 않는다.
 *  - 검색 결과 '없음'과 **조회 실패**는 다른 사실이다(P1).
 */
const BOOKING = join(process.cwd(), 'src', 'app', '(main)', 'telehealth', 'page.tsx');
const SELECTOR = join(process.cwd(), 'src', 'components', 'ui', 'PatientSelector.tsx');

describe('원내 원격진료 예약 화면은 환자를 고르게 한다', () => {
  const src = readFileSync(BOOKING, 'utf8');

  it('🔴 환자 UUID 를 손으로 넣는 경로가 없다', () => {
    expect(src).not.toContain('환자 UUID');
    // patientId 에 직접 타이핑하는 input 이 되살아나면 실패한다
    expect(src).not.toMatch(/patientId:\s*e\.target\.value/);
    expect(src).not.toMatch(/<input[^>]*value=\{form\.patientId\}/);
  });

  it('병원 정본 환자 검색(PatientSelector)을 재사용한다 — 같은 개념에 정본을 둘로 만들지 않는다', () => {
    expect(src).toContain("import PatientSelector from '@/components/ui/PatientSelector'");
    expect(src).toMatch(/<PatientSelector[\s\S]{0,400}value=\{form\.patientId\}/);
  });

  it('🔴 환자를 고르지 않으면 예약 버튼이 잠긴다', () => {
    expect(src).toMatch(/disabled=\{[^}]*!form\.patientId/);
  });

  it('🔴 고른 환자를 이름으로 되읽어 준다(누구를 예약하는지 모른 채 확정하지 않는다)', () => {
    // 표시 정본 PatientName 규약 — 인라인 {familyName}{givenName} 재조립 금지
    expect(src).toMatch(/<PatientName[\s\S]{0,200}picked\.familyName/);
    expect(src).toContain('님으로 예약합니다');
    // 선택 전에는 "고르라"고 말한다(빈 칸을 방치하지 않는다)
    expect(src).toContain('환자를 선택해야 예약할 수 있습니다');
  });

  it('선택 확인 문구는 MRN 을 덧붙이지 않는다(식별정보 과다 노출 금지)', () => {
    expect(src).toMatch(/<PatientName[\s\S]{0,200}showMrn=\{false\}/);
  });
});

describe('환자 검색은 "없음"과 "조회 실패"를 구분해 말한다', () => {
  const src = readFileSync(SELECTOR, 'utf8');

  it('조회 실패를 검색 결과 없음으로 위장하지 않는다', () => {
    expect(src).toMatch(/isError/);
    expect(src).toContain('환자를 조회하지 못했습니다');
    // 실패 분기가 '검색 결과 없음' 분기보다 먼저 판정된다
    const errIdx = src.indexOf('환자를 조회하지 못했습니다');
    const emptyIdx = src.indexOf('검색 결과 없음');
    expect(errIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(errIdx);
  });

  it('실패했을 때 다시 시도할 수 있다', () => {
    expect(src).toMatch(/onClick=\{\(\) => refetch\(\)\}/);
  });
});

/**
 * 🔴 코디네이터 회수분(2026-08-18) — 정본 셀렉터가 **누구인지 모르는 채 "선택됨"** 을 그리던 것.
 *
 * `value`(환자 id)만 외부에서 주고 내부 선택 상태가 없는 경우(프리필·URL 파라미터),
 * 칩이 이름 없이 `()` 만 렌더했다. 20여 화면이 쓰는 정본이라 한 곳에서 고친다.
 */
describe('PatientSelector — 이름을 모르면 모른다고 말한다', () => {
  const SELECTOR = readFileSync(
    join(process.cwd(), 'src/components/ui/PatientSelector.tsx'),
    'utf8',
  );

  it('🔴 value 만 있을 때 환자를 조회해 이름을 채운다', () => {
    expect(SELECTOR).toMatch(/patient-selector-prefill/);
    expect(SELECTOR).toMatch(/needsLookup/);
  });

  it('🔴 이름을 모르는 채 빈 괄호를 그리지 않는다', () => {
    // 종전: `({p?.mrn})` — p 가 없으면 "()" 만 남았다
    expect(SELECTOR).not.toMatch(/\(\{p\?\.mrn\}\)/);
    expect(SELECTOR).toContain('환자 정보를 불러오지 못했습니다');
  });

  it('조회 중과 조회 실패를 구분해 말한다', () => {
    expect(SELECTOR).toContain('환자 확인 중');
  });
});
