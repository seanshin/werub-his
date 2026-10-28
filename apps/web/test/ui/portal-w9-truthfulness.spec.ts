/**
 * 환자 포털 화면 정직성 가드 — W9(2026-08-14).
 *
 * 포털은 **환자 본인이 자기 의료정보를 보는 곳**이라, 틀린 값이 곧 환자의 오판이 된다.
 * 아래 단언은 전부 운영 실측에서 실제로 깨져 있던 것이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const PORTAL_DIR = resolve(__dirname, '../../src/app/portal');

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function portalFiles(dir = PORTAL_DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...portalFiles(p));
    else if (/\.tsx?$/.test(e.name) && !/\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = portalFiles().map((f) => ({ path: f.replace(PORTAL_DIR, 'portal'), src: stripComments(readFileSync(f, 'utf8')) }));

describe('W9 포털 — 모르는 대기시간을 빈칸으로 흘려 문장을 깨뜨리지 않는다', () => {
  /**
   * 🔴 어제 서버가 `estimatedMinutes` 를 상수 8분/명 날조에서 `null`(=표본 없음)로 바꿨는데
   *    화면 3곳(page.tsx 풀스크린 대기 · CareTab · HomeTab)이 `?? ''` 로 받아
   *    **"예상 대기 시간: 약  분"** · **"(분)"** 이라는 깨진 문장을 그대로 띄웠다.
   *    `?? 0` 만 막는 기존 가드(wait-null-guard)는 빈 문자열 폴드를 잡지 못한다.
   */
  it('🔴 estimatedMinutes/estimatedWaitMinutes 를 `?? \'\'` · `|| \'\'` 로 접지 않는다', () => {
    const offenders: string[] = [];
    const re = /(estimatedMinutes|estimatedWaitMinutes)\s*(\?\?|\|\|)\s*(''|""|`\`|'-'|"-")/g;
    for (const { path, src } of FILES) {
      for (const m of src.matchAll(re)) offenders.push(`${path} → ${m[1]} ${m[2]} ${m[3]}`);
    }
    expect(offenders, '표본이 없으면 그 줄을 아예 말하지 않는다 — 빈칸 + 단위는 깨진 문장이다').toEqual([]);
  });

  it('🔴 "분" 단위를 붙이는 자리는 null 가드를 함께 둔다', () => {
    // 대기 관련 분 표시가 있는 파일이면 그 파일 안에 != null / == null 가드가 있어야 한다.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      if (!/estimatedMinutes/.test(src)) continue;
      if (!/estimatedMinutes\s*!=\s*null/.test(src)) offenders.push(path);
    }
    expect(offenders, 'estimatedMinutes 를 쓰는 화면은 null(모름) 분기를 반드시 갖는다').toEqual([]);
  });
});

describe('W9 포털 — 검사 flag 를 이진으로 단정하지 않는다', () => {
  /**
   * 🔴 종전 `it.flag === 'H' ? '높음' : '낮음'` — HIS flag 집합은 N·H·L·HH·LL·A·AA 인데
   *    'H' 가 아닌 것을 전부 '낮음'으로 몰아 위급 고값(HH)을 "낮음"이라 설명했다(P10).
   */
  it('🔴 flag 를 문자열 리터럴과 직접 비교해 높음/낮음을 가르지 않는다', () => {
    const offenders: string[] = [];
    const re = /flag\s*===\s*'(H|L|HH|LL)'\s*\?/g;
    for (const { path, src } of FILES) {
      for (const m of src.matchAll(re)) offenders.push(`${path} → flag === '${m[1]}' ? …`);
    }
    expect(offenders, "방향 판정은 shared lab-flags 정본(isHighFlag/isLowFlag/isCriticalFlag)만 쓴다").toEqual([]);
  });

  it('🔴 검사 결과 화면은 shared lab-flags 정본을 import 한다', () => {
    const health = FILES.find((f) => f.path.endsWith('_health/HealthTab.tsx'))!;
    // 2026-10-19 포털 A2 — flag → 판정은 포털 판정 정본 `_shared/judgment` 가 shared lab-flags 술어로 한다(건강 탭은 그것만 부른다)
    expect(health.src).toMatch(/labFlagJudgment/);
    expect(health.src).toMatch(/from '\.\.\/_shared\/judgment'/);
    const judgment = readFileSync(join(process.cwd(), 'src/app/portal/_shared/judgment.tsx'), 'utf8');
    expect(judgment).toMatch(/from '@hospital-run\/shared'/);
    expect(judgment).toMatch(/isCriticalFlag/);
    // 위급을 H/L 로 격하하는 로컬 라벨 표를 새로 정의하지 않는다(정본에서 조용히 드리프트)
    for (const t of [health.src, judgment]) expect(t).not.toMatch(/const\s+FLAG_LABELS?\s*:\s*Record/);
  });
});

describe('W9→2026-08-18 포털 — AI 건강 점수 자체를 그리지 않는다', () => {
  /**
   * 🔴 W9 가 고친 것은 **"점수를 못 냈을 때"** 였다: `extractScore` 가 실패 시 0 을 돌려주고
   *    그 0 이 `pct>=60?…:'주의'` 를 타서 빨간 게이지 + "주의" 가 떴다 → null + '산출 불가' 로 교정.
   *
   * 🔴 그런데 진짜 문제는 **"점수를 냈을 때"** 였다(2026-08-18 적발 · P15-b).
   *    서버가 LLM 에게 `진료 횟수 / 검사 횟수` 만 주고 0~100 점을 만들게 했고, 그 숫자가 나오면
   *    환자는 근거 없는 등급(양호/보통/주의)을 자기 건강으로 읽었다. 영양·운동·정신건강 배지는
   *    병원에 자료조차 없는 값이었다. 검증된 산출 도구가 없으면 수치화 자체가 창작이다.
   *    → 게이지를 폐지하고 **셀 수 있는 사실**(진료·검사·활성 문제 건수)과 산출 불가 사유만 남겼다.
   *
   * 이 가드는 W9 가드를 대체한다 — 옛 가드는 "점수를 잘 못 내는지"를 보고 있어서,
   * 점수를 **아예 내지 않게** 된 지금은 통과할 수 없다(그리고 통과하면 안 된다).
   */
  const health = () => FILES.find((f) => f.path.endsWith('_health/HealthTab.tsx'))!.src;

  it('🔴 점수 게이지·등급 색칠이 남아 있지 않다', () => {
    expect(health()).not.toMatch(/AiHealthScoreGauge/);
    // 등급 삼항(pct >= 80 ? … : pct >= 60 ? … : '주의')이 되살아나면 잡는다.
    expect(health()).not.toMatch(/pct\s*>=\s*80\s*\?/);
    expect(health()).not.toMatch(/strokeDashoffset/);
  });

  it('🔴 점수를 그리지 않는 대신 그 사유와 셀 수 있는 사실을 보여준다', () => {
    const src = health();
    expect(src).toMatch(/산출 불가/);
    expect(src).toMatch(/encounterCount/);
    expect(src).toMatch(/labCount/);
    expect(src).toMatch(/activeProblemCount/);
    // 값을 못 받았을 때 0 으로 그리지 않는다(0건은 다른 사실이다).
    expect(src).toMatch(/value == null \? '-'/);
  });

  it("재진 권고는 'UNAVAILABLE'(부르지 않음)과 'FALLBACK'(실패)을 구분해 말한다", () => {
    const src = health();
    expect(src).toMatch(/source === 'UNAVAILABLE'/);
    expect(src).toMatch(/followupFailed/);
  });
});

describe('W9 포털 — 확인 실패를 "이상 없음"으로 바꿔 말하지 않는다', () => {
  /**
   * 🔴 약물 상호작용 확인이 실패해도(`{error:true}` / interactions 미배열)
   *    초록 배경 "특별한 상호작용이 발견되지 않았습니다" 가 떴다(P17).
   *    거짓 안심은 진짜 경보를 죽인다.
   */
  it('상호작용 결과는 배열일 때만 "발견되지 않았습니다"를 말한다', () => {
    const src = FILES.find((f) => f.path.endsWith('_health/HealthTab.tsx'))!.src;
    expect(src).toMatch(/Array\.isArray\(result\.interactions\)/);
    expect(src).toMatch(/확인하지 못했습니다/);
    // 안심 문구가 실패 분기보다 뒤(else)에 오는지 — 실패 분기 인덱스가 더 앞이어야 한다
    expect(src.indexOf('확인하지 못했습니다')).toBeLessThan(src.indexOf('특별한 상호작용이 발견되지 않았습니다'));
  });
});

describe('W9 포털 — 서버가 실제로 내는 필드명을 읽는다 (P11)', () => {
  it('🔴 연간 수납 요약은 totalInsurance/totalCopay 를 읽는다', () => {
    // 종전엔 insuranceCovered/copay 를 읽어 `?? 0` 으로 접혀 항상 "보험부담 0원·본인부담 0원" 이었다.
    // 운영 실측 P2026-0002/2026: 서버 totalInsurance=99,015 totalCopay=25,335 → 화면 0원/0원.
    const src = FILES.find((f) => f.path.endsWith('_services/ServicesTab.tsx'))!.src;
    expect(src).toMatch(/raw\.totalInsurance/);
    expect(src).toMatch(/raw\.totalCopay/);
  });

  it('🔴 건강 대시보드 활력징후는 systolicBp/diastolicBp/heartRate 를 읽는다', () => {
    // 종전엔 vitals.bp / vitals.hr 을 찾아 혈압·맥박 카드가 한 번도 뜨지 않았다.
    const src = FILES.find((f) => f.path.endsWith('_health/HealthTab.tsx'))!.src;
    expect(src).toMatch(/vitals\?\.systolicBp/);
    expect(src).toMatch(/vitals\?\.heartRate/);
    expect(src).not.toMatch(/vitals\?\.bp\b/);
    expect(src).not.toMatch(/vitals\?\.hr\b/);
  });
});

describe('W9 포털 — 퇴원 체크리스트가 모르는 것을 "안 했다"로 접지 않는다', () => {
  it('🔴 서버 null 을 `!!` 로 false 로 뭉개지 않는다', () => {
    const src = FILES.find((f) => f.path.endsWith('_home/HomeTab.tsx'))!.src;
    expect(src).not.toMatch(/!!cl\.medicationReceived/);
    expect(src).not.toMatch(/!!cl\.satisfactionSurveyDone/);
    expect(src).toMatch(/done === null/); // 모름 분기가 실제로 그려진다
  });
});
