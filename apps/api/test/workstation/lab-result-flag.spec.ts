/**
 * 🔴 검사 워크스테이션 결과 입력의 flag — 검사 흐름 검토(계획서 §3 #2).
 *
 * 2026-08-21 실측으로 드러난 것:
 *   ① **`H*` 는 정본 어휘가 아니다** — `CRITICAL_LAB_FLAGS` = HH·LL·AA·C·CC·CRITICAL·PANIC.
 *      워크스테이션은 `finding==='CRITICAL'` 일 때 `'H*'` 를 저장했고,
 *      `isCriticalFlag('H*')` 는 **false** 다. 검사자가 '위급'을 골라도 flag 를 읽는 소비처
 *      (위급값 배너·FHIR interpretation·결과 화면)가 위급으로 보지 않는다.
 *      v3.96 "flag 를 H/L 만 처리하면 위급값이 정상처럼 샌다"의 재발.
 *   ② **방향을 보지 않았다** — 참고범위 **아래**인 값도 무조건 `'H'`(높음)로 저장됐다.
 *      `normalMin`/`normalMax` 를 바로 위에서 파싱해 두고도 쓰지 않았다.
 *
 * 실측 실피해는 **0**이었다(`H*` 0건 · 방향 오기 0건 — 이 경로로 위급/이상 입력이 아직 없었다).
 * 🔴 구조적 결함이며 **첫 위급값 입력에서 터진다.**
 *
 * 재주입: `'H*'`/무조건 `'H'` 로 되돌리면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isCriticalFlag, isAbnormalFlag, CRITICAL_LAB_FLAGS } from '@hospital-run/shared';

const WS = join(__dirname, '../../src/modules/workstation/workstation.service.ts');
const src = readFileSync(WS, 'utf8');

describe('flag 어휘 — 정본을 쓴다', () => {
  it('🔴 정본에 없는 `H*` 를 저장하지 않는다', () => {
    expect(src, "`H*` 는 CRITICAL_LAB_FLAGS 에 없다 — isCriticalFlag 가 false 를 낸다").not.toContain("'H*'");
  });

  it('🔴 위급은 정본 어휘로만 — HH/LL/CRITICAL', () => {
    const i = src.indexOf("item.finding === 'CRITICAL'");
    expect(i, '위급 분기를 찾지 못했다').toBeGreaterThan(-1);
    const block = src.slice(i, i + 400);
    for (const f of ["'LL'", "'HH'", "'CRITICAL'"]) {
      expect(block, `위급 분기에 ${f} 가 없다`).toContain(f);
    }
    // 저장되는 세 값이 전부 정본이 위급으로 인식하는 값이어야 한다
    for (const f of ['LL', 'HH', 'CRITICAL']) {
      expect(isCriticalFlag(f), `${f} 를 정본이 위급으로 보지 않는다`).toBe(true);
      expect(CRITICAL_LAB_FLAGS as readonly string[]).toContain(f);
    }
  });

  it('🔴 방향을 참고범위로 판정한다 — 저치를 H 로 적지 않는다', () => {
    const i = src.indexOf("item.finding === 'CRITICAL'");
    const block = src.slice(i - 900, i + 500);
    expect(block, '방향 판정이 없다').toMatch(/direction/);
    expect(block, '하한 비교가 없다').toMatch(/normalMin/);
    expect(block, '상한 비교가 없다').toMatch(/normalMax/);
  });

  it('🔴 방향을 모르면 지어내지 않는다 — 이상은 A, 위급은 CRITICAL(방향 미상)', () => {
    const i = src.indexOf("item.finding === 'ABNORMAL'");
    const block = src.slice(i, i + 300);
    expect(block, "방향 미상 이상치가 'A' 로 떨어지지 않는다").toContain("'A'");
    // 'A' 는 정상이 아니어야 한다(소비처가 이상으로 읽어야 한다)
    expect(isAbnormalFlag('A')).toBe(true);
    expect(isCriticalFlag('A')).toBe(false); // 위급으로 과대표시하지도 않는다
  });
});

describe('참고범위 이탈인데 정상으로 기록한 항목 — 되묻는다', () => {
  it('🔴 자동으로 고치지 않되 응답에 담아 화면이 되묻게 한다', () => {
    expect(src, '이탈-정상 항목을 세지 않는다').toContain('outOfRangeButNormal');
    const i = src.indexOf('const outOfRangeButNormal');
    const block = src.slice(i, i + 900);
    // 검사자가 이상/위급으로 표시한 것은 대상이 아니다(그건 이미 드러났다)
    expect(block).toContain("i.finding !== 'ABNORMAL'");
    expect(block).toContain("i.finding !== 'CRITICAL'");
    // 분모를 함께 낸다
    expect(src, '분모(입력 항목 수)가 응답에 없다').toContain('itemsEntered');
  });

  it('🔴 flag 를 덮어써 자동 이상 처리하지 않는다 — 임상 판단은 사람의 것', () => {
    const i = src.indexOf('const outOfRangeButNormal');
    const block = src.slice(i, i + 900);
    expect(block, '검사자 판단을 덮는 코드가 있다').not.toMatch(/flag\s*=\s*'[HL]/);
  });
});
