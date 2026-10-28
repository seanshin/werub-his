import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  achievementPercent,
  evaluateMeetTarget,
  resolveIndicatorDirection,
  resolveIndicatorPolicy,
  resolveIndicatorUnit,
  resolveValueScale,
} from '../../src/modules/quality/indicator-policy';

/**
 * 질 지표 판정 정본 — 계약 + 구조 가드 (화면 실사용 점검 W7).
 *
 * 🔴 봉합한 것
 *   ① 달성 판정이 seed·서버·화면 세 벌이었고 방향이 서로 반대였다(P12).
 *   ② 단위 컬럼이 없는데 화면이 전 지표에 '%'를 붙였다.
 *   ③ 전국 벤치마크·적정성평가 등급·PSI·HSMR 이 상수였다(P15-b).
 *   ④ JCI 인증 근거 문구를 지어내 DB 에 영속했다('손위생 준수율 95%' — 실제 관측 0건).
 * 이 스펙은 위 넷이 되살아나는 것을 막는다.
 */

const API_SRC = join(process.cwd(), 'src');
const WEB_SRC = join(process.cwd(), '..', 'web', 'src');
const read = (p: string) => readFileSync(p, 'utf-8');

describe('지표 방향 — 정본 등재표', () => {
  it('낮을수록 좋은 지표', () => {
    for (const n of ['낙상 발생률', '투약오류 발생률', '병원감염 발생률', '평균 재원일수', '환자 불만 건수', '외래 초진 대기시간']) {
      expect(resolveIndicatorDirection(n), n).toBe('LOWER_IS_BETTER');
    }
  });

  it('높을수록 좋은 지표', () => {
    for (const n of ['손위생 수행률', '환자만족도', '병상 가동률', '필수교육 이수율']) {
      expect(resolveIndicatorDirection(n), n).toBe('HIGHER_IS_BETTER');
    }
  });

  it('🔴 인공호흡기 관련 폐렴 발생률 — seed 키워드에 폐렴이 없어 뒤집혀 있던 지표', () => {
    expect(resolveIndicatorDirection('인공호흡기 관련 폐렴 발생률')).toBe('LOWER_IS_BETTER');
    expect(evaluateMeetTarget(1.51, 2.0, 'LOWER_IS_BETTER')).toBe(true); // 화면엔 '✗ 미달'로 떴다
  });

  it('공백 표기가 갈려도 같은 지표로 본다', () => {
    expect(resolveIndicatorDirection('낙상발생률')).toBe('LOWER_IS_BETTER');
    expect(resolveIndicatorDirection('손위생  수행률')).toBe('HIGHER_IS_BETTER');
  });

  it('🔴 모르는 지표는 추정하지 않는다(null) — 방향을 지어내면 임상 지표가 뒤집힌다', () => {
    expect(resolveIndicatorDirection('신규 지표 XYZ')).toBeNull();
    expect(resolveIndicatorDirection('')).toBeNull();
    // 상충 신호(낮을수록 좋음 + 높을수록 좋음)도 판정하지 않는다
    expect(resolveIndicatorDirection('감염 예방 교육 이수율')).toBeNull();
  });
});

describe('목표 달성 판정 — 유일한 정본', () => {
  it('방향에 따라 부등호가 뒤집힌다', () => {
    expect(evaluateMeetTarget(1.2, 1.5, 'LOWER_IS_BETTER')).toBe(true);
    expect(evaluateMeetTarget(1.8, 1.5, 'LOWER_IS_BETTER')).toBe(false);
    expect(evaluateMeetTarget(96, 95, 'HIGHER_IS_BETTER')).toBe(true);
    expect(evaluateMeetTarget(90, 95, 'HIGHER_IS_BETTER')).toBe(false);
  });

  it('🔴 값·목표·방향 중 하나라도 모르면 false 가 아니라 null 이다', () => {
    expect(evaluateMeetTarget(null, 1.5, 'LOWER_IS_BETTER')).toBeNull();
    expect(evaluateMeetTarget(1.2, null, 'LOWER_IS_BETTER')).toBeNull();
    expect(evaluateMeetTarget(1.2, 1.5, null)).toBeNull();
    expect(evaluateMeetTarget(Number.NaN, 1.5, 'LOWER_IS_BETTER')).toBeNull();
  });
});

describe('진행바(달성률) — 방향 반영', () => {
  it('🔴 낮을수록 좋은 지표는 나빠질수록 짧아진다(종전엔 길어졌다)', () => {
    expect(achievementPercent(1.0, 1.5, 'LOWER_IS_BETTER')).toBe(100);
    expect(achievementPercent(3.0, 1.5, 'LOWER_IS_BETTER')).toBe(50);
    expect(achievementPercent(15, 1.5, 'LOWER_IS_BETTER')).toBe(10);
  });

  it('높을수록 좋은 지표는 목표 대비 비율', () => {
    expect(achievementPercent(90, 95, 'HIGHER_IS_BETTER')).toBe(95);
    expect(achievementPercent(99, 95, 'HIGHER_IS_BETTER')).toBe(100); // 상한 100
  });

  it('방향·값을 모르면 막대를 그리지 않는다(null)', () => {
    expect(achievementPercent(1.2, 1.5, null)).toBeNull();
    expect(achievementPercent(null, 1.5, 'LOWER_IS_BETTER')).toBeNull();
  });
});

describe('단위 — formula 에 적힌 것만 읽는다', () => {
  it('배율·괄호 표기에서 단위를 읽는다', () => {
    expect(resolveIndicatorUnit('(30일 이내 재입원 환자 수 / 퇴원 환자 수) × 100')).toBe('%');
    expect(resolveIndicatorUnit('(낙상 발생 건수 / 재원일수) × 1000')).toBe('건/1000 재원일수');
    expect(resolveIndicatorUnit('접수 ~ 진료 시작 평균 시간 (분)')).toBe('분');
    expect(resolveIndicatorUnit('환자만족도 설문 평균 점수 (100점 만점)')).toBe('점');
    expect(resolveIndicatorUnit('총 재원일수 / 퇴원 환자 수')).toBe('일');
    expect(resolveIndicatorUnit('월간 환자 불만 접수 건수')).toBe('건');
  });

  it('🔴 힌트가 없으면 단위를 만들지 않는다(null) — 종전엔 전부 %였다', () => {
    expect(resolveIndicatorUnit('')).toBeNull();
    expect(resolveIndicatorUnit(null)).toBeNull();
    expect(resolveIndicatorUnit('알 수 없는 산식')).toBeNull();
  });

  it('🔴 W7 실측 오표기 7건 — 어느 것도 %가 아니다', () => {
    const cases: Array<[string, string | null]> = [
      ['총 재원일수 / 퇴원 환자 수', '일'],                              // 평균 재원일수 "7%"
      ['접수 ~ 진료 시작 평균 시간 (분)', '분'],                          // 외래 초진 대기시간 "30%"
      ['접수 ~ 결과 보고 평균 시간 (분)', '분'],                          // 검사결과 보고시간 "60%"
      ['처방 ~ 약국 수령 평균 시간 (분)', '분'],                          // 처방전달시간 "20%"
      ['KTAS 1-2 환자 응급실 평균 체류시간 (분)', '분'],                   // 응급실 체류시간 "60%"
      ['월간 환자 불만 접수 건수', '건'],                                  // 환자 불만 "5%"
      ['(VAP 건수 / 인공호흡기 유치일수) × 1000', '건/1000 인공호흡기 유치일수'], // VAP "2%"
    ];
    for (const [formula, unit] of cases) expect(resolveIndicatorUnit(formula), formula).toBe(unit);
  });
});

describe('측정값 배율 — 지표마다 다르다', () => {
  it('formula 의 × N 을 따른다', () => {
    expect(resolveValueScale('(낙상 발생 건수 / 재원일수) × 1000')).toBe(1000);
    expect(resolveValueScale('(퇴원 / 입원) × 100')).toBe(100);
    expect(resolveValueScale('총 재원일수 / 퇴원 환자 수')).toBe(1);
    expect(resolveValueScale('월간 환자 불만 접수 건수')).toBe(1);
    expect(resolveValueScale('접수 ~ 진료 시작 평균 시간 (분)')).toBe(1);
  });

  it('힌트가 없으면 null — 서비스가 백분율 가정을 쓰되 그 사실을 표시한다', () => {
    expect(resolveValueScale('알 수 없는 산식')).toBeNull();
    expect(resolveIndicatorPolicy({ name: 'x', formula: '알 수 없는 산식' }).valueScaleKnown).toBe(false);
    expect(resolveIndicatorPolicy({ name: 'x', formula: '알 수 없는 산식' }).valueScale).toBe(100);
  });
});

/* ── 구조 가드 — 되살아나지 못하게 ────────────────────────────────── */

describe('구조 가드: 달성 판정은 한 곳에서만 나온다', () => {
  const CONSUMERS = [
    join(API_SRC, 'modules/quality/quality.service.ts'),
    join(API_SRC, 'modules/qi/qi.service.ts'),
    join(WEB_SRC, 'app/(main)/quality/page.tsx'),
  ];

  it('🔴 소비자 코드가 value/target 을 직접 비교해 달성을 판정하지 않는다', () => {
    const offenders: string[] = [];
    for (const file of CONSUMERS) {
      read(file).split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//')) return; // 주석의 결함 설명은 남긴다
        if (/\b(value|current|latestValue)\s*(<=|>=|<|>)\s*(target|targetValue)\b/.test(line)) {
          offenders.push(`${file.split('/apps/')[1]}:${i + 1} ${t.slice(0, 80)}`);
        }
      });
    }
    expect(offenders, '판정은 evaluateMeetTarget(정본) 하나로만').toEqual([]);
  });

  it('🔴 지표 방향을 소비자 코드가 다시 정의하지 않는다', () => {
    for (const file of CONSUMERS) {
      expect(read(file), file).not.toMatch(/const\s+lower(IsBetter|Better)\s*=/);
    }
  });

  /** 주석(결함 기록)은 남기고 실코드만 본다 */
  const codeLines = (file: string) =>
    read(file)
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
      })
      .join('\n');

  it('🔴 화면이 단위를 %로 폴백하지 않는다', () => {
    const page = codeLines(join(WEB_SRC, 'app/(main)/quality/page.tsx'));
    expect(page).not.toMatch(/unit\s*\?\?\s*'%'/);
    expect(page).not.toMatch(/unit\s*\|\|\s*'%'/);
  });

  it('서버 판정을 화면이 그대로 쓴다(meetTarget 재계산 금지)', () => {
    const page = codeLines(join(WEB_SRC, 'app/(main)/quality/page.tsx'));
    expect(page).not.toMatch(/meetTarget\s*=\s*latestValue/);
  });
});

describe('구조 가드: 지표를 지어내지 않는다', () => {
  const qi = read(join(API_SRC, 'modules/qi/qi.service.ts'));
  const bodyOf = (name: string) => {
    const from = qi.indexOf(`async ${name}(`);
    expect(from, `${name} 을 찾지 못했다`).toBeGreaterThan(-1);
    const rest = qi.slice(from);
    const end = rest.indexOf('\n  /**');
    return end > 0 ? rest.slice(0, end) : rest;
  };

  it('🔴 전국 벤치마크 상수표가 없다 — 출처 없는 비교는 표시하지 않는다', () => {
    const body = bodyOf('getBenchmarkComparison');
    expect(body).not.toMatch(/national:\s*\d/);
    expect(body).not.toMatch(/top10pct:\s*\d/);
    expect(body).not.toMatch(/percentile:\s*\d/);
    expect(body).toMatch(/available:\s*false/);
  });

  it('🔴 심평원 적정성평가 값·등급 상수표가 없다 — 외부 평가 결과는 산출 대상이 아니다', () => {
    const body = bodyOf('getAdequacyIndicators');
    expect(body).not.toMatch(/grade:\s*\d/);
    expect(body).toMatch(/available:\s*false/);
  });

  it('🔴 PSI 값 상수표가 없다', () => {
    const body = bodyOf('calculatePsi');
    expect(body).not.toMatch(/code:\s*'PSI-\d+'/);
    expect(body).toMatch(/available:\s*false/);
  });

  it('🔴 HSMR 을 임의 계수(입원 × 1.5%)로 만들지 않는다 — 사망 원천이 없다', () => {
    const body = bodyOf('calculateHsmr');
    expect(body).not.toMatch(/\*\s*0\.01[58]/);
    expect(body).toMatch(/available:\s*false/);
  });

  it('🔴 재입원율 부서별 분해를 임의 배분하지 않는다', () => {
    const body = bodyOf('getReadmissionRate');
    expect(body).not.toMatch(/department:\s*'(내과|외과|정형외과)'/);
  });

  it('🔴 월별 지표 대시보드가 상수 지표표를 쓰지 않는다(DB 실측에서 만든다)', () => {
    const body = bodyOf('getIndicatorDashboard');
    expect(body).not.toMatch(/current:\s*\d/);
    expect(body).not.toMatch(/trend:\s*\[\s*\d/);
    expect(body).toMatch(/qualityIndicator\.findMany/);
  });
});

describe('구조 가드: 인증 근거 문구를 지어내지 않는다', () => {
  const qi = read(join(API_SRC, 'modules/qi/qi.service.ts'));

  it('🔴 DEFAULT_ACCREDITATION(self-seed → DB 영속)에 근거 문구·판정이 없다', () => {
    const from = qi.indexOf('DEFAULT_ACCREDITATION = [');
    expect(from).toBeGreaterThan(-1);
    const table = qi.slice(from, qi.indexOf('];', from));
    expect(table).not.toMatch(/evidence:/);
    expect(table).not.toMatch(/status:/);
  });

  it('🔴 관측된 적 없는 근거 문구가 코드에 남아 있지 않다', () => {
    for (const phrase of ['환자 식별 밴드 100% 착용', '손위생 준수율 95%', 'LASA 약물 분리 보관 완료', '낙상위험 평가 시행률 88%']) {
      // 주석(결함 기록)에는 남지만 데이터 리터럴로는 없어야 한다
      expect(qi).not.toMatch(new RegExp(`evidence:\\s*'${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    }
  });
});
