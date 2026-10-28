import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * gap-remediation R-W1 배선 가드 — 화상 평가(R1)·BTG 사후검토(R2)·마약류 사전승인 상신(R3).
 *
 * 🔴 이 세 축의 공통 병력은 "만들었는데 소비처 0"이다(2026-09-06 갭 스캔):
 *    - R1: 모델+서비스+EP 5+BurnsChart(372행 SVG)까지 있는데 import 0 · 로드맵 문서는 "✅ 구현완료" 주장
 *    - R2: 규정상 의무인 사후검토가 EP 만 있고 화면 0 — 검토가 구조적으로 불가능했다
 *    - R3: 게이트(BLOCK)를 켜는 순간 의사가 차단당하고 갈 곳이 없었다(상신 EP 3종 고아)
 *    그래서 이 가드는 **소비(사용)를 센다** — import 문은 사용 검사를 대신 통과시키므로 세지 않는다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
// import 문·주석 제거 — import 가 JSX 사용 검사를 대신 통과한 전례(v4.11.0 재주입 9건)
const body = (s: string) =>
  s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '');

describe('R1 — 화상 평가가 환자 차트에 실제로 배선되어 있다', () => {
  const page = read('app/(main)/patients/[id]/page.tsx');
  const tab = read('app/(main)/patients/[id]/components/BurnsTab.tsx');

  it('환자 차트가 burns 탭을 등재하고 BurnsTab 을 렌더한다', () => {
    expect(page).toMatch(/key:\s*'burns'/);
    // [\s/>] 경계 — 접미사 치환(<BurnsTabX)이 무동작으로 통과한 재주입 실측(2026-09-06)
    expect(body(page)).toMatch(/<BurnsTab[\s/>]/);
  });

  it('BurnsTab 이 서버 정본 EP 를 소비한다(TBSA 서버 재산정·Parkland·저장·이력)', () => {
    const b = body(tab);
    // 경로 정본은 단수 burn-assessment (복수로 바꾸면 404 — 실측 계약)
    expect(b).toMatch(/api\/v1\/burn-assessment/);
    expect(b).toMatch(/calculate-tbsa/);
    expect(b).toMatch(/parkland/);
  });

  it('BurnsTab 이 BurnsChart(SVG 신체도)를 렌더한다 — 다시 고아가 되지 않는다', () => {
    expect(body(tab)).toMatch(/<BurnsChart[\s/>]/);
  });
});

describe('R2 — BTG(로그인 응급접근) 사후검토 화면이 배선되어 있다', () => {
  const page = read('app/(main)/admin/break-glass/page.tsx');
  const frozen = read('components/layout/screen-codes.frozen.ts');
  const sidebar = read('components/layout/Sidebar.tsx');

  it('목록·검토 EP 를 모두 소비한다(목록만 있고 검토 버튼이 없으면 워크리스트가 아니다)', () => {
    const b = body(page);
    expect(b).toMatch(/api\/v1\/admin\/break-glass/);
    expect(b).toMatch(/\/review/);
  });

  it('조회 실패를 "0건"으로 번역하지 않는다(QueryErrorFallback 렌더)', () => {
    expect(body(page)).toMatch(/<QueryErrorFallback[\s/>]/);
  });

  it('절단 사실을 화면이 밝힌다 — 서버는 최근 100건만 준다', () => {
    expect(page).toMatch(/최근 100건/);
  });

  it('nav·화면번호 정본에 등재되어 있다(미등재 임시코드는 재정렬로 이동한다)', () => {
    expect(frozen).toMatch(/'\/admin\/break-glass':\s*'3406'/);
    expect(sidebar).toMatch(/'\/admin\/break-glass'/);
  });
});

describe('R3 — 사전승인 게이트 차단이 상신 동선을 그린다(갈 곳 없는 토스트 금지)', () => {
  const page = read('app/(main)/orders/page.tsx');

  it('PREAUTH_REQUIRED 분기가 상신 상태를 연다', () => {
    const b = body(page);
    expect(b).toMatch(/PREAUTH_REQUIRED/);
    expect(b).toMatch(/setPreAuthBlock\(\{/);
  });

  it('v1/pre-auth FE 소비 ≥2 — 상신·내 목록(고아 EP 회수 검증)', () => {
    const b = body(page);
    const consumed = ['/api/v1/pre-auth/orders', '/api/v1/pre-auth/mine'].filter((ep) => b.includes(ep));
    expect(consumed.length).toBeGreaterThanOrEqual(2);
    expect(b).toMatch(/pre-auth\/\$\{id\}\/cancel/);
  });

  it('상신≠발행을 화면이 말한다 — 상신 성공을 발행으로 오독시키지 않는다', () => {
    expect(page).toMatch(/승인되면 처방이 발행/);
  });
});
