import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 화면 구조 가드 — /safety (2026-08-14·W7).
 *
 * 코드·테스트가 통과해도 **화면이 사실을 말하는지**는 별개다. 이 스펙은 W7 에서 봉합한
 * 두 가지가 다시 갈라지는 것을 막는다.
 *   G1. 심각도 라벨을 화면이 **다시 로컬 Record 로 재정의**하는 것
 *       (정본 = shared `INCIDENT_SEVERITY_LABEL`. 로컬 표는 저장값 `LOW` 를 빈칸으로 만들었다)
 *   G2. 표본이 없는데 **안심 문구(초록 ✓)** 를 띄우는 것
 *       (관측 0건에 "오류가 없습니다 ✓" 를 띄우던 것 — P17)
 *
 * 🔴 이 저장소 교훈: **한 곳만 고치면 갈라진다.** 가드가 없으면 다음 편집에서 되돌아온다.
 */
const WEB = resolve(__dirname, '../../../web/src/app/(main)/safety/page.tsx');
const WIDGET = resolve(__dirname, '../../../web/src/app/(main)/dashboard/components/widgets/ext/SafetyIncidentsWidget.tsx');

const src = () => readFileSync(WEB, 'utf8');
/** 주석 줄 제외 — 원 결함을 한국어 주석으로 남기는 규약(🔴)이라 주석까지 훑으면 오탐한다 */
const code = () =>
  src()
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n');

describe('/safety 화면 구조 가드 (W7)', () => {
  it('G1 심각도 라벨 정본을 shared 에서 가져온다', () => {
    const s = src();
    expect(s).toMatch(/INCIDENT_SEVERITY_LABEL[\s\S]*?from '@hospital-run\/shared'/);
    expect(s).toContain('normalizeIncidentSeverity');
  });

  it('G1 로컬 심각도 라벨 Record 를 재정의하지 않는다', () => {
    const c = code();
    // `const SEV_LABEL = {...}` / `SEVERITY_LABEL: Record<...>` 형태의 로컬 라벨표 금지
    expect(c).not.toMatch(/const\s+SEV(ERITY)?_LABEL\s*[:=]/);
    // 폐기된 어휘(SEVERE)를 화면 키로 되살리지 않는다 — 정본 등급은 MAJOR/CRITICAL
    expect(c).not.toMatch(/['"]SEVERE['"]\s*:/);
  });

  it('G1 심각도 표시는 정본으로 접은 배지를 쓴다(하드코딩 5키 순회 금지)', () => {
    const c = code();
    expect(c).toContain('function SeverityBadge');
    expect(c).not.toMatch(/\[\s*'NEAR_MISS'\s*,\s*'MINOR'\s*,\s*'MODERATE'\s*,\s*'SEVERE'/);
  });

  it('G2 안심 문구(✓)는 관측이 있을 때만 렌더된다', () => {
    // 🔴 2026-08-20: 종전 판은 `s.indexOf('✓')` 로 **첫 번째** ✓ 를 앵커로 삼았는데, 그 첫 번째가
    //    "안심 문구(초록 ✓)는 …" 이라는 **주석**이었다. 즉 규약을 적어둔 주석을 검사하고 있었고,
    //    그 앞 600자에 `observed` 가 우연히 있어서 통과했다(가드가 다른 이유로 통과한 사례).
    //    비율 표시를 `<Ratio>` 정본으로 바꾸자 그 우연이 깨져 실패했다 — 화면 동작은 그대로였다.
    //    → 주석을 벗기고 **렌더되는 ✓ 전부**가 관측 분기 안에 있는지 본다.
    const raw = src();
    const s = raw
      .split('\n')
      .map((l) => (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) ? '' : l.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\*.*?\*\//g, '').replace(/\s\/\/.*$/, '')))
      .join('\n');
    const idxs: number[] = [];
    for (let i = s.indexOf('✓'); i >= 0; i = s.indexOf('✓', i + 1)) idxs.push(i);
    expect(idxs.length, '렌더되는 안심 문구(✓)가 없다 — 화면이 바뀌었으면 이 가드를 다시 맞춰라').toBeGreaterThan(0);
    const offenders = idxs.filter((i) => !/observed|hasObservations/.test(s.slice(Math.max(0, i - 600), i)));
    expect(offenders, `관측 분기 밖에서 ✓ 를 그린다(표본 0 에 안심 문구): ${offenders.map((i) => s.slice(Math.max(0, i - 80), i + 40).replace(/\n/g, ' ')).join(' | ')}`).toEqual([]);
  });

  it('G2 표본 0 을 0% 로 단정하지 않는다(비율은 null 허용 타입)', () => {
    const s = src();
    expect(s).toMatch(/verifyRate:\s*number\s*\|\s*null/);
    expect(s).toMatch(/failRate:\s*number\s*\|\s*null/);
    expect(s).toContain('산출 불가');
  });

  it('G3 0% 막대에 최소 폭을 칠하지 않는다', () => {
    // 🔴 종전 width 계산이 비율에 하한 2 를 씌워 오류율 0% 에도 2% 가 칠해졌다
    expect(code()).not.toMatch(/Math\.max\(\s*rate\s*,/);
  });

  it('G4 통계 기간을 화면에 밝힌다', () => {
    expect(src()).toContain('집계 기간');
    expect(readFileSync(WIDGET, 'utf8')).toMatch(/누적|이번달/);
  });

  it('G5 RCA 조회·승인 EP 를 부르는 화면이 존재한다(EP 를 만들면 부르는 화면까지가 한 벌)', () => {
    const s = src();
    expect(s).toContain("'/api/v1/safety/rca'");
    expect(s).toContain('/rca/approve');
  });
});
