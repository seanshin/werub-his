import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **시드가 진단 없는 "서명된 진료"를 만들고 있었다** (2026-08-30 · 발굴 31회차 운영 실측).
 *
 * 데이터 정합성 스캔의 `09 서명된 진료인데 진단 없음` 83건을 파니 **8월에도 6건이 새로 생기고**
 * 있었다. 서명 경로에는 게이트가 정확히 있었다(`encounter.requireDiagnosisOnSign` WARN·
 * 위반 원장 기록·BLOCK 승격 가능) — 그런데 **원장에는 2건뿐**이었다.
 *
 * 원인: 6건 중 5건이 결정적 시드 UUID 였다. 시드가 API 를 거치지 않고 `status:'SIGNED'` 를
 * 직접 넣으면서, 진단코드를 **정확 일치로만** 찾다가 `K29`·`N39` 를 못 찾고
 * `if (did)` 로 **조용히 건너뛰었다**. KCD-8 은 세분류(`K29.5`)로 실려 있다.
 * → **게이트가 샌 게 아니라 시드가 게이트를 우회**한 것이다.
 *
 * 🔴 데이터를 코드로 교정하지 않는다 — **시드 생성기를 고친다**(§규약 9).
 */
const seed = readFileSync(join(process.cwd(), 'prisma/seed-chart-richness.ts'), 'utf8');

describe('🔴 시드는 진단 없는 서명 진료를 만들지 않는다', () => {
  it('정확 일치 실패 시 상위코드 접두로 찾는다(KCD-8 은 세분류로 실린다)', () => {
    expect(seed).toMatch(/startsWith: `\$\{c\}\.`/);
  });

  it('🔴 그래도 못 찾으면 조용히 넘기지 않고 멈춘다', () => {
    expect(seed).toMatch(/dxMissing/);
    expect(seed).toMatch(/throw new Error\(\s*\n?\s*`\[seed-chart-richness\] 진단코드를 찾지 못했습니다/);
  });

  /**
   * 🔴 **소스 문자열 검사는 `if (false)` 를 못 잡는다** — 재주입이 드러냈다.
   *    조건이 살아 있는지 **행동으로** 확인한다(같은 로직을 그대로 실행).
   */
  it('🔴 행동 검증 — 누락 목록이 비지 않으면 반드시 던진다', () => {
    const guard = (missing: string[]) => {
      if (missing.length) {
        throw new Error(
          `[seed-chart-richness] 진단코드를 찾지 못했습니다: ${missing.join(', ')}. `
          + 'KCD-8 마스터를 먼저 적재하세요 — 진단 없이 서명된 진료를 만들면 청구 심사 삭감·반려 위험이 있습니다.',
        );
      }
    };
    expect(() => guard([])).not.toThrow();
    expect(() => guard(['K29', 'N39'])).toThrow(/K29, N39/);

    // 시드가 그 조건을 **상수로 무력화**하지 않았는지 본다(`if (false)` 주입 방어)
    const m = seed.match(/if \((.+?)\) \{\s*\n\s*\/\/ 코드 마스터가/);
    expect(m, '누락 검사 블록을 찾지 못했다').toBeTruthy();
    expect(m![1], '조건이 상수로 바뀌어 항상 통과한다').toBe('dxMissing.length');
  });

  it('🔴 입원 진료도 상병 없이 지나가지 않는다', () => {
    expect(seed).toMatch(/입원 진료 상병 누락/);
    expect(seed, '진단 upsert 실패를 삼킨다').not.toMatch(/encounterDiagnosis\.upsert\([\s\S]{0,400}?\}\)\.catch\(\(\) => \{\}\)/);
  });

  it('멈추는 이유를 사람이 읽을 수 있게 말한다', () => {
    expect(seed).toContain('KCD-8 마스터를 먼저 적재');
    expect(seed).toContain('청구 심사 삭감');
  });

  it('스캔이 실제로 파일을 읽었다(대조군)', () => {
    expect(seed.length).toBeGreaterThan(3000);
    expect(seed).toContain("status: 'SIGNED'");
  });
});

/**
 * 🔴 **같은 패턴이 퇴원에도 있었다** (2026-08-30 · 발굴 32회차 운영 실측).
 *
 * `inpatient.dischargeGate` 는 7/24 부터 켜져 있고 **API 퇴원은 전부 요약이 있다** —
 * 게이트 이후 "퇴원했는데 요약 없음" 9건이 **전부 시드**였다.
 * 원인: `seed.ts` 가 퇴원 환자 중 **`take: 2`** 만 요약을 만들었다.
 * 퇴원요약은 법정 기록이라, 시연 데이터라도 퇴원했으면 요약이 있어야 화면·지표가 사실을 말한다.
 */
describe('🔴 시드는 요약 없는 퇴원을 남기지 않는다', () => {
  const main = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');

  it('요약이 없는 퇴원 건을 전부 대상으로 삼는다', () => {
    const i = main.indexOf('퇴원요약 시딩');
    expect(i, '퇴원요약 시딩 블록을 찾지 못했다').toBeGreaterThan(-1);
    // 🔴 범위를 넓게 잡으면 **다음 시딩의 `take: 3`** 이 걸려 엉뚱하게 실패한다 — 그 질의만 본다
    const q = main.slice(i, i + 1600).match(/prisma\.admission\.findMany\(\{[\s\S]*?\}\);/);
    expect(q, '퇴원 조회 질의를 찾지 못했다').toBeTruthy();
    expect(q![0], '일부만 만든다(take 제한)').not.toMatch(/take:\s*\d+/);
    // 🔴 `dischargeSummary` 는 텍스트 컬럼 — 관계는 `dischargeSummaryDoc` 이다(내가 한 번 틀렸다)
    expect(q![0]).toMatch(/dischargeSummaryDoc: \{ is: null \}/);
  });

  it('🔴 id 를 indexOf 로 만들지 않는다 — 중복 행이 같은 id 를 두 번 만든다', () => {
    const i = main.indexOf('퇴원요약 시딩');
    const block = main.slice(i, i + 1600);
    expect(block).not.toMatch(/discharged\.indexOf\(d\)/);
    expect(block).toMatch(/discharged\.entries\(\)/);
  });
});
