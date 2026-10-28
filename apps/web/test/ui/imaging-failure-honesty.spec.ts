import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 영상 화면 실패 정직성 가드 — 이연 회수(2026-08-18).
 *
 * 서버(`pacs-proxy`)는 PACS 조회 실패를 **503 `PACS_UNAVAILABLE`** 로 말하도록 고쳐졌다.
 * 그런데 화면이 `isError` 를 다루지 않으면 그 정직함이 **"검색 결과가 없습니다"** 로 덮인다.
 * 실측(2026-08-18 운영): PACS 가 401 을 돌려주는데 프록시가 `{count:0}` 으로 덮어
 * 모든 영상 화면이 "없음"을 말하고 있었다 — 서버를 고쳤으면 화면도 함께 고친다.
 */
const DIR = join(process.cwd(), 'src', 'app', '(main)', 'imaging', 'components');

const CASES = [
  { file: 'StudiesTab.tsx', empty: '검색 결과가 없습니다' },
  { file: 'ReportsTab.tsx', empty: '판독 리포트가 없습니다' },
  { file: 'StatsTab.tsx', empty: '판독 대기 중인 검사가 없습니다' },
];

describe('영상 화면은 조회 실패를 "없음"으로 말하지 않는다', () => {
  for (const c of CASES) {
    const src = readFileSync(join(DIR, c.file), 'utf8');

    it(`${c.file} — isError 분기가 있다`, () => {
      expect(src).toMatch(/isError/);
    });

    it(`${c.file} — 실패 문구가 "없는 것이 아니라"를 말한다`, () => {
      expect(src).toContain('것이 아니라 조회에 실패');
    });

    it(`${c.file} — 빈 상태 문구는 실패 분기 뒤에만 남는다`, () => {
      // 빈 문구가 여전히 있으되, 그 앞에 실패 분기가 존재해야 한다
      const emptyAt = src.indexOf(c.empty);
      const errorAt = src.search(/isError|queueError/);
      expect(emptyAt).toBeGreaterThan(-1);
      expect(errorAt).toBeGreaterThan(-1);
      expect(errorAt).toBeLessThan(emptyAt);
    });
  }
});

/**
 * 🔴 이송 전 안전 확인 — 시드 흐름 전수 검토 6단계(2026-08-24).
 *
 * 서버는 `ionizing`·`usesContrast` 를 함께 돌려주는데 화면이 `ionizing` 을 **쓰지 않아서**,
 * 판정 항목이 비면 전리방사선 검사에도 "확인 항목 없음(조영·방사선 검사 아님)" 이라 단정했다.
 * 운영 실측: `radiation_exposures` 0행 → 누적선량 항목이 전건 침묵 → 남성·비가임기 환자의
 * CT·단순촬영에서 checks 가 빈 배열이 되어 **"방사선 검사 아님"** 이 그대로 떴다(P1).
 */
describe('이송 전 안전 확인은 해당 없음과 확인 못 함을 구분한다', () => {
  const src = readFileSync(
    join(process.cwd(), 'src', 'components', 'imaging', 'ImagingSafetyPrecheck.tsx'),
    'utf8',
  );

  it('조회 실패를 렌더한다 — 실패에 아무것도 안 그리면 확인이 있었는지조차 모른다', () => {
    expect(src).toMatch(/isError/);
    expect(src).toContain('확인하지 못한 상태');
  });

  it('서버가 준 ionizing 을 화면이 쓴다', () => {
    expect(src).toMatch(/d\.ionizing/);
  });

  it('검사 종류를 판정 못 한 것을 "해당 없음"과 가른다', () => {
    // 서버가 modalityKnown=false 를 주는 경우 — 시술코드가 없어 조영·임신·피폭이 한 항목도 안 돈다
    expect(src).toMatch(/modalityKnown/);
    expect(src).toContain('검사 종류를 판정하지 못했습니다');
    // 그 상태에서 "검사 아님" 문구로 떨어지지 않는다
    expect(src).toContain('unknownKind ? null :');
  });

  it('"조영·방사선 검사 아님" 단정은 해당 없음 분기 안에서만 나온다', () => {
    // 렌더되는 문구(마지막 출현)가 분기 뒤에 있어야 한다 — 앞쪽 출현은 이 결함을 적어둔 주석이다
    const branchAt = src.indexOf('applicable ? (');
    const claimAt = src.lastIndexOf('조영·방사선 검사 아님');
    expect(branchAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(branchAt);
  });
});
