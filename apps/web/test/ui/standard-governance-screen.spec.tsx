import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 표준 발효 거버넌스 화면 (2026-08-27 · 계획서 §3.5 · 가드 G10·G11·G15).
 *
 * 🔴 이 화면이 반드시 지켜야 하는 것:
 *   ① **막지 않는다** — 환자에게 적용 중인 표준을 근거 없다고 멈추면 진료 중단이다(기본 WARN)
 *   ② **"의결 근거 없음"과 "규칙 미설정"을 구분한다** — 다른 사실이다
 *   ③ **선택지로 고르게 한다** — 자유 입력이면 어휘가 갈라진다
 *   ④ **위임은 근거 없이 고를 수 없다** — 결정 3층 원칙
 *
 * 재주입: 두 상태를 한 라벨로 합치거나, 위임 근거 없이 저장 가능하게 하면 실패한다.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/app/(main)/admin/governance/standards/page.tsx'), 'utf-8');

/**
 * 🔴 **주석을 걷어낸 코드만 본다.**
 *
 * 이 세션에서 세 번 겪은 함정이다 — 주석에 인용된 문구 때문에 `contains` 가 통과해
 * **결함을 재주입해도 가드가 잡지 못했다.** 이 파일의 주석에는 규칙 문구가 그대로 인용돼
 * 있으므로(그게 근거다), 화면에 실제로 그려지는지를 보려면 주석을 지우고 봐야 한다.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SIDEBAR = fs.readFileSync(
  path.join(__dirname, '../../src/components/layout/Sidebar.tsx'), 'utf-8');

describe('표준 발효 거버넌스 화면', () => {
  it('🔴 G10 — 막지 않는다는 사실을 화면이 먼저 말한다', () => {
    expect(CODE).toContain('이미 발효된 표준은');
    expect(CODE).toContain('막지 않습니다');
    expect(CODE).toContain('진료 중단');
    // 기본 강도가 WARN
    expect(SRC).toMatch(/useState\(row\.rule\?\.gateMode \?\? 'WARN'\)/);
  });

  it('🔴 G11 — "의결 근거 없음"과 "규칙 미설정"을 구분한다', () => {
    expect(CODE).toContain('의결 근거 없음');
    expect(CODE).toContain('규칙 미설정');
    // 세 상태가 각기 다른 라벨을 갖는다
    const labels = ['의결로 발효', '의결 근거 없음', '미발효'];
    for (const l of labels) expect(CODE).toContain(l);
  });

  it('🔴 담당·발행자가 없으면 없다고 말한다 — 침묵하면 정해진 것처럼 보인다', () => {
    expect(CODE).toContain('담당 미지정');
    expect(CODE).toContain('발행자 미기록');
  });

  it('🔴 G15 — 위임은 근거 없이 저장할 수 없다(3층 원칙)', () => {
    expect(SRC).toMatch(/needsDelegation\s*=\s*Object\.values\(actions\)\.includes\('DELEGATED'\)/);
    expect(SRC).toMatch(/ready\s*=\s*!needsDelegation \|\| !!delegationRef\.trim\(\)/);
    expect(SRC).toMatch(/disabled=\{!ready \|\| busy\}/);
    expect(CODE).toContain('의결한 적이 있어야');
  });

  it('🔴 구성은 선택지로 고른다 — 자유 입력이 아니다', () => {
    // 행위별 요건·강도·주기가 전부 고정 선택지
    expect(SRC).toMatch(/\(\['COMMITTEE', 'DELEGATED', 'NONE'\] as ActionReq\[\]\)/);
    expect(SRC).toMatch(/\(\['OFF', 'WARN', 'BLOCK'\] as const\)/);
    // 🔴 UI 언어 배선(2026-09-09) 후 옵션 라벨은 `{tAttr('없음')}` 형태가 될 수 있다.
    //    긍정 단언을 지우지 않고 **두 형태를 다 찾도록 넓힌다** — 좁은 문자열 비교는
    //    배선 라운드마다 조용히 죽는다(부정 단언이었다면 통과해 버렸을 자리다).
    expect(CODE).toMatch(/<option value="">(없음|\{tAttr\('없음'\)\}|<T k="없음" \/>)<\/option>/);
  });

  it('🔴 근거·주기를 기본으로 요구하지 않는다', () => {
    expect(CODE).toContain('요구하지 않는 것이 기본입니다');
    expect(CODE).toContain('주기를 지어내지 않습니다');
  });

  it('🔴 BLOCK 을 켤 때 무슨 일이 일어나는지 그 자리에서 말한다', () => {
    expect(SRC).toMatch(/gateMode === 'BLOCK' && \(/);
    expect(CODE).toContain('발효가 막힙니다');
  });

  it('🔴 분모를 함께 낸다 — "근거 없음 N건"만 보면 규모를 모른다', () => {
    expect(SRC).toMatch(/\$\{s\.withBasis\} \/ \$\{s\.active\}/);
  });

  it('화면번호 정본에 등재됐다 — 코드만 있고 등재 없으면 번호 이동이 조용히 실패한다', () => {
    expect(SIDEBAR).toContain("href: '/admin/governance/standards'");
  });
});
