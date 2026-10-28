import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 위급값 통보(IPSG.2)가 **발동할 수 있는 화면**인가.
 *
 * 🔴 2026-09-02 실측: `workstation.service.completeLabResult` 는 `finding === 'CRITICAL'` 인 항목만
 *    모아 `lab.result.completed{ hasCritical }` 를 발행하는데, 검사 결과를 넣는 두 화면 어디에도
 *    검사자가 **'위급'을 고를 UI 가 없었다**(PC 는 읽기 전용 `<span>`, 태블릿은 자동 산정 2값).
 *    서버 주석은 "검사자가 '위급'을 골라도"를 전제로 쓰였는데 **고를 화면이 없었다** —
 *    이 경로로는 위급값 통보가 한 번도 발동할 수 없었다.
 *
 * 🔴 두 번째: 자동 산정이 참고범위 미상·비수치(`<5`·`≤200`)를 무조건 정상으로 떨어뜨려
 *    **모르는 값을 '정상'이라고 원장에 적었다**(조건식에서 미측정을 폴백하지 않는다).
 */
const web = (...p: string[]) => readFileSync(join(process.cwd(), '..', 'web', 'src', 'app', ...p), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREENS: [string, string[]][] = [
  ['PC 검사실', ['(main)', 'workstation', 'lab', 'page.tsx']],
  ['태블릿 워크스테이션', ['tablet', 'workstation', 'page.tsx']],
];

describe('검사 결과 입력에서 위급을 고를 수 있다', () => {
  it('대조군: 서버가 CRITICAL 로만 위급값을 발행한다(전제가 바뀌면 이 가드의 의미가 바뀐다)', () => {
    const svc = readFileSync(join(process.cwd(), 'src', 'modules', 'workstation', 'workstation.service.ts'), 'utf8');
    expect(svc).toContain("i.finding === 'CRITICAL'");
    expect(svc).toContain('hasCritical');
  });

  it.each(SCREENS)('%s 화면에 CRITICAL 선택지가 있다', (_label, parts) => {
    const src = code(web(...parts));
    expect(src, '검사자가 위급을 고를 수 없으면 위급값 통보가 발동하지 않는다').toContain('"CRITICAL"');
  });

  it.each(SCREENS)('%s — 참고범위를 못 읽으면 자동으로 정상이라 적지 않는다', (_label, parts) => {
    const src = code(web(...parts));
    expect(src).toContain('canJudgeRange');
    /**
     * 🔴 자동 판정 지점마다 **바로 앞에** 범위 판독 가능 여부(`canJudgeRange`)가 있어야 한다.
     *    "어딘가에 canJudgeRange 가 있다"만 보면, 게이트 없는 자동 판정이 새로 생겨도 통과한다.
     */
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/(isOutOfRange|outOfRange)\([^)]*\)\s*\?\s*'ABNORMAL'\s*:\s*'NORMAL'/.test(line)) return;
      const near = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      expect(near, `게이트 없는 자동 판정(${i + 1}행) — 모르는 범위를 '정상'으로 적는다`).toContain('canJudgeRange');
    });
  });

  it('PC 화면의 항목 초기값이 미판정이다 — 정상으로 시작하면 만지지 않은 판정이 남는다', () => {
    const src = code(web('(main)', 'workstation', 'lab', 'page.tsx'));
    // 초기 생성 지점은 빈 finding, '전부 정상' 버튼(명시적 선언)만 NORMAL 을 쓴다
    expect(src).toContain("finding: ''");
    const normals = (src.match(/finding: 'NORMAL'/g) ?? []).length;
    expect(normals, "초기값에 'NORMAL' 이 남아 있다(허용은 markAllNormal 하나뿐)").toBeLessThanOrEqual(1);
  });

  it('태블릿 — 미판정 항목이 있으면 저장하지 않는다', () => {
    const src = code(web('tablet', 'workstation', 'page.tsx'));
    expect(src).toContain('unjudged');
  });
});
