/**
 * 🔴 간호 스테이션 정직성 가드 — 2026-08-20.
 *
 * 두 가지 실측 결함을 고정한다.
 *
 * ① **'통합' 탭이 조회하지 않은 것을 "없음"이라 말했다**(P1).
 *    VS·투약·I/O·기록 4개 쿼리가 `enabled: subTab === 'vs'` 식이라 통합 탭에서는
 *    **한 번도 조회되지 않는데**, 통합 탭은 "VS 없음 · 스케줄 없음 · 기록 없음"을 그렸다.
 *
 * ② **환자 한 명의 조회 실패가 그 환자를 목록에서 조용히 지웠다**.
 *    MAR·활력·I/O 집계가 `Promise.all(...).catch(() => [])` 라 실패한 환자만 빠졌고
 *    간호사는 "그 환자는 해당 없음"으로 읽었다.
 *
 * 🔴 이 파일은 **구조 가드**다 — 이 컴포넌트들이 export 되지 않아 단위 렌더가 어렵다.
 *    구조 가드는 "다른 이유로 통과"하기 쉬우므로, 아래 각 단언은 **결함을 재주입하면
 *    실패하는지 실제로 확인한 것만** 남겼다(2026-08-20 확인).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FILE = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'nurse-station', 'page.tsx');
const src = fs.readFileSync(FILE, 'utf8');
/** 규약을 적어 둔 주석과 규약을 어긴 코드를 같이 세지 않는다 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe("간호 스테이션 — '통합' 탭은 조회하지 않은 것을 '없음'이라 말하지 않는다", () => {
  const TABS = ['vs', 'med', 'io', 'note'] as const;

  it.each(TABS)("'%s' 쿼리는 통합 탭에서도 조회된다", (tab) => {
    const bare = new RegExp(`enabled:\\s*subTab === '${tab}'\\s*,`);
    const withAll = new RegExp(`enabled:\\s*subTab === '${tab}' \\|\\| subTab === 'all'`);
    expect(bare.test(code), `'${tab}' 쿼리가 통합 탭에서 비활성이다 — 통합 탭이 그 값을 "없음"으로 그린다`).toBe(false);
    expect(withAll.test(code)).toBe(true);
  });

  it('통합 탭이 그리는 항목 수와 통합 탭에서 켜지는 쿼리 수가 같다', () => {
    // 통합 탭 블록이 VS·투약·I/O·기록 넷을 모두 그린다 → 넷 모두 켜져야 한다
    const enabledForAll = code.match(/subTab === 'all'/g)?.length ?? 0;
    expect(enabledForAll).toBeGreaterThanOrEqual(TABS.length + 1); // 4개 enabled + 렌더 블록 1
  });
});

describe('간호 스테이션 — 환자 단위 부분 실패를 숨기지 않는다', () => {
  it('🔴 집계 쿼리가 실패를 빈 배열로 접지 않는다', () => {
    for (const t of ['MedScheduleItem', 'VitalsRecord', 'IORecord']) {
      const swallow = new RegExp(`\\.catch\\(\\(\\) => \\[\\] as ${t}\\[\\]\\)`);
      expect(swallow.test(code), `${t} 집계가 실패한 환자를 조용히 지운다`).toBe(false);
    }
  });

  it('실패한 환자를 결과에 담아 내보낸다', () => {
    const n = (code.match(/failed: results\.filter\(\(r\) => !r\.ok\)\.map\(\(r\) => r\.who\)/g) ?? []).length;
    expect(n, 'MAR·활력·I/O 세 집계 모두 실패 환자를 내보내야 한다').toBe(3);
  });

  it('🔴 실패한 환자 이름을 화면이 말한다 — "기록 없음"과 구분한다', () => {
    for (const v of ['marData', 'vitalsAll', 'ioAll']) {
      expect(code, `${v} 의 부분 실패가 화면에 드러나지 않는다`).toContain(`{(${v}?.failed?.length ?? 0) > 0 && (`);
    }
    const n = (code.match(/조회에 실패한 환자/g) ?? []).length;
    expect(n).toBe(3);
    expect(code).toContain('기록이 없는 것이 아니라 모르는 상태');
  });
});
