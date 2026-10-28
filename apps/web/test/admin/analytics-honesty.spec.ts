/**
 * /admin/analytics 정직성 가드 (W8 · R8)
 *
 * 🔴 이 화면은 /executive 와 **같은 서버 EP** 를 본다. W7 에서 서버·/executive 는 정직해졌는데
 *    이 화면만 옛 키를 읽어, 서버 주석이 "고쳤다"고 적어둔 결함을 FE 가 되돌리고 있었다:
 *      · `rate:null`(산출 불가) → `k.rate ?? 0` → **0% 빨강 막대**
 *      · 알림 `count`/`href` 를 두고 **메시지 문자열 정규식**으로 숫자를 뽑음
 *      · 서버 `label:'의료진'` 을 두고 `category`(영문 enum)를 렌더
 *      · 서버가 `type:'chart:error'` 로 드러낸 실패를 `type==='chart'` 필터가 놓쳐 **"0건"으로 둔갑**
 *      · 주 시작일 `getDay() + 1` (일요일에 미래 구간) — 서버는 고쳤는데 FE 만 남아 있었다
 *    소스 스캔으로 회귀를 막는다(렌더 테스트는 chart.js 의존이 커서 스캔이 더 값싸고 확실하다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** 🔴 주석은 제거하고 스캔한다 — 원 결함을 설명하는 🔴 주석 자체가 금지 패턴을 담고 있다 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SRC = stripComments(readFileSync(
  resolve(__dirname, '../../src/app/(main)/admin/analytics/page.tsx'),
  'utf8',
));

describe('/admin/analytics — 서버의 정직한 계약을 FE 가 되돌리지 않는다', () => {
  it('🔴 KPI rate=null 을 0 으로 접지 않는다', () => {
    expect(SRC).not.toMatch(/k\.rate\s*\?\?\s*0/);
    expect(SRC).toMatch(/k\.rate\s*==\s*null/);
    expect(SRC).toContain('산출 불가');
  });

  it('🔴 서버가 보낸 note(사유)를 화면이 삼키지 않는다', () => {
    expect(SRC).toMatch(/k\.note/);
  });

  it('🔴 알림 메시지 문자열에서 숫자를 정규식으로 뽑지 않는다 — 서버 count 를 쓴다', () => {
    expect(SRC).not.toMatch(/message\??\.match\(/);
    expect(SRC).toMatch(/hit\?\.count/);
  });

  it('🔴 조회 실패(type:"<도메인>:error")를 0건으로 두지 않는다', () => {
    expect(SRC).toContain(':error');
    expect(SRC).toMatch(/failed/);
  });

  it('🔴 서버 href 로 근거 목록에 갈 수 있다', () => {
    expect(SRC).toMatch(/href=\{(chartAlert|billingAlert)\.href\}/);
  });

  it('🔴 인력 현황 라벨은 서버 label — 영문 enum(category)을 그대로 그리지 않는다', () => {
    expect(SRC).toMatch(/c\.label\s*\?\?\s*c\.category/);
  });

  it('🔴 주 시작일은 월요일 — `getDay() + 1`(일요일에 내일) 금지', () => {
    expect(SRC).not.toMatch(/getDay\(\)\s*\+\s*1/);
    expect(SRC).toMatch(/getDay\(\)\s*\+\s*6\)\s*%\s*7/);
  });

  it('🔴 병상/ICU 가동률은 서버 Metric 을 쓰고, 등록 0 을 0% 라 하지 않는다', () => {
    expect(SRC).toMatch(/bedOccupancyPct/);
    expect(SRC).toMatch(/icuOccupancyPct/);
    // FE 가 다시 나눗셈해서 정본을 둘로 만들지 않는다(P12)
    expect(SRC).not.toMatch(/Math\.round\(\(\(eo\.icuOccupied/);
  });

  it('🔴 조회 실패를 "데이터 없음"(=진짜 0)이라 말하지 않는다', () => {
    expect(SRC).toMatch(/error=\{[a-zA-Z]+Err\}/);
    expect(SRC).toContain('확인 불가');
  });

  it('🔴 미확인 총계를 `?? 0` 으로 0 이라 단정하지 않는다', () => {
    expect(SRC).not.toMatch(/bedData\.total\s*\?\?\s*0/);
  });
});
