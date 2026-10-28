import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

/**
 * 🔴 **시드도 타입 검사 대상이다** (2026-08-28).
 *
 * 실측으로 나온 것: `prisma/seed.ts` 의 임상경로 배정 블록이 스키마에 없는 필드(`note`)를 쓰고
 * 필수 필드(`encounterId`·`startDate`·`actualDay`)를 빠뜨려 **개통 이래 한 번도 성공한 적이 없었다.**
 * 그 지점에서 예외가 터져 **뒤의 생성 호출 57개가 전부 실행되지 않았다**
 * (`pathway_assignments` 0 · `milestone_outcomes` 0 · `cancer_treatments` 0 —
 *  그 앞의 `clinical_pathways` 5 · `pathway_milestones` 30 은 정상).
 *
 * 🔴 근본 원인: `apps/api/tsconfig.json` 의 `include` 가 `src/**` 뿐이라
 *    **시드 파일은 `tsc` 가 한 번도 본 적이 없었다.** 타입이 붙어 있었다면 컴파일러가 잡았을 오류다.
 *    규약 §8 — *"tsc 가 통과한다는 사실이 스캔의 열쇠다"* 는 **검사 범위 안에 있을 때만** 참이다.
 *
 * 재주입: `tsconfig.seed.json` 을 지우거나 `include` 에서 prisma 를 빼면 실패한다.
 */
const API = path.join(__dirname, '../..');

describe('시드 타입 검사 범위', () => {
  it('🔴 시드 전용 tsconfig 가 있고 prisma 를 포함한다', () => {
    const p = path.join(API, 'tsconfig.seed.json');
    expect(fs.existsSync(p), '시드가 검사 범위 밖이면 타입 오류를 아무도 못 본다').toBe(true);
    const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(cfg.include.some((g: string) => g.startsWith('prisma/'))).toBe(true);
    expect(cfg.compilerOptions?.noEmit).toBe(true);
  });

  it('🔴 실행 가능한 스크립트로 등록돼 있다 — 설정만 있고 아무도 안 부르면 없는 것과 같다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(API, 'package.json'), 'utf-8'));
    expect(pkg.scripts['typecheck:seed']).toContain('tsconfig.seed.json');
  });

  it('본 tsconfig 는 여전히 src 만 빌드한다(산출물 경로가 바뀌면 안 된다)', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(API, 'tsconfig.json'), 'utf-8'));
    expect(cfg.include).toEqual(['src/**/*']);
    expect(cfg.compilerOptions.rootDir).toBe('./src');
  });
});

/**
 * 🔴 **기준선 동결** — 시드 꼬리에 남은 타입 오류 16건.
 *
 * `@ts-nocheck` 를 걷어내니 `seed.ts` 에서 **29건**이 드러났다. 그중
 *  · CP 배정 블록(`prisma/seed.ts` 의 `pathwayAssignment.upsert`) **앞**의 13건은 고쳤다 —
 *    거기까지 도달해야 배정이 시드된다.
 *  · 남은 16건은 **꼬리**(설치결제·EWS·봇·DICOM·환자확인·안전사고·휴진·검진 7종)에 있고,
 *    전부 **한 번도 실행된 적 없는 구간**이다.
 *
 * 🔴 **고치지 않고 동결한 이유** — 이 블록들은 모델과 어긋난 필드명을 대량으로 쓴다
 *    (`itemName`↔`testName` · `doctorId`↔`authoredBy` · `scheduledDate`↔`dueDate` …).
 *    의도를 추측해 채우면 **허구 시드 데이터**가 된다. 규약: *"다 고쳤다고 말하지 않는다 —
 *    위험순만 고치고 기준선 동결"* · *"어휘를 지어내지 않는다"*.
 *
 * 이 가드는 **늘지 않는 것**만 강제한다. 줄이면 아래 숫자를 낮춘다.
 */
describe('🔴 시드 타입 오류 기준선 — 늘어나지 않는다', () => {
  // 🔴 줄면 낮춘다 — 여유를 두면 신규 위반을 흡수한다(2026-08-28: 16 → 15 · 2026-09-22: 15 → 14 — 분납 회차가 `billings[0]` 대신 `extBillings[0]` 을 읽게 되며 1건 해소)
  const BASELINE = 14;

  it(`남은 오류가 ${BASELINE}건 이하다 (새 오류를 들이지 않는다)`, () => {
    const out = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.seed.json'], {
      cwd: API, encoding: 'utf-8', timeout: 300_000,
    });
    const lines = (out.stdout ?? '').split('\n').filter((l) => l.includes('prisma/seed.ts'));
    expect(lines.length, `새 오류:\n${lines.join('\n')}`).toBeLessThanOrEqual(BASELINE);
  }, 300_000);

  it('🔴 CP 배정 블록보다 앞에는 오류가 없다 — 있으면 배정이 시드되지 않는다', () => {
    const seed = fs.readFileSync(path.join(API, 'prisma/seed.ts'), 'utf-8');
    const assignLine = seed.slice(0, seed.indexOf('pathwayAssignment.upsert')).split('\n').length;
    const out = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.seed.json'], {
      cwd: API, encoding: 'utf-8', timeout: 300_000,
    });
    const before = (out.stdout ?? '').split('\n')
      .filter((l) => l.includes('prisma/seed.ts'))
      .map((l) => Number(l.match(/\((\d+),/)?.[1] ?? 0))
      .filter((n) => n > 0 && n < assignLine);
    expect(before, `배정 블록(${assignLine}행) 앞 오류: ${before.join(', ')}`).toEqual([]);
  }, 300_000);
});

describe('🔴 배정 시드가 필수 필드를 갖춘다 — 종전엔 빠져서 시드가 죽었다', () => {
  const SEED = fs.readFileSync(path.join(API, 'prisma/seed.ts'), 'utf-8');
  const block = SEED.slice(SEED.indexOf('pathwayAssignment.upsert') - 2000, SEED.indexOf('milestoneOutcome.upsert') + 1500);

  it('PathwayAssignment 에 encounterId·startDate 가 있다', () => {
    expect(block).toContain('encounterId:');
    expect(block).toContain('startDate:');
  });

  it('MilestoneOutcome 에 actualDay 가 있고, 없는 필드(note)를 쓰지 않는다', () => {
    expect(block).toContain('actualDay:');
    expect(block, '`note` 는 이 모델에 없다 — 정본 필드는 `variance` 다').not.toMatch(/milestoneOutcome[\s\S]{0,600}?\bnote:/);
    expect(block).toContain('variance:');
  });

  it('🔴 허구 실적을 만들지 않는다 — 진행 중 배정은 마일스톤을 일부만 완료한다', () => {
    expect(block).toMatch(/doneCount:\s*2/);          // 진행 중
    expect(block).toContain('actualDays: plan.status === \'COMPLETED\'');  // 완료만 소요일을 갖는다
  });

  it('🔴 표본을 일부러 남긴다 — 이탈 건이 있어야 탐지기가 작동하는지 안다', () => {
    expect(block).toContain("'DEVIATED'");
    // deviations 카운트는 실제 이탈 결과 수와 일치해야 한다(숫자만 올리지 않는다)
    expect(block).toMatch(/deviations:\s*deviationCount/);
  });
});
