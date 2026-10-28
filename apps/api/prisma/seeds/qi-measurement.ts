/**
 * QI 지표 카탈로그 · 측정값 생성기 (시드 정본)
 *
 * 🔴 원래 결함(2026-08-18 실측 — 측정 300건 중 **273건(91%)** 이 모순):
 *    시드가 **값을 먼저 정하고 분자·분모를 `×100` 가정으로 역산**했다.
 *
 *      const value = base + trend + noise;              // 값이 먼저
 *      const denom = Math.round(sim.denom * jitter);
 *      const numer = Math.round(value * denom / 100);   // 🔴 배율을 항상 100 으로 가정
 *
 *    그래서 `×1000` 지표(낙상·감염·CLABSI·CAUTI·VAP·투약오류·욕창)는 저장값이 재산출의 **1/10**,
 *    배율 1 지표(만족도·재원일수·대기시간·불만건수)는 **100배** 어긋났다.
 *    화면이 분자·분모와 값을 나란히 보여주면 **같은 사실에 정본이 둘**이 된다(P12).
 *    정정 화면에서 아무것도 고치지 않고 [저장]만 눌러도 낙상률이 10배로 뛰었다.
 *
 * 🔴 규칙: **값은 분자·분모에서 나온다.** 그럴듯한 임상 범위는 **분자·분모를 조정해서** 맞춘다 —
 *    값을 맞추려고 배율을 왜곡하지 않는다.
 *
 * 산출은 서비스와 **같은 정본 함수**(`computeMeasurementValue`)를 부른다. 시드가 자기 식으로
 * 반올림하면 시드 데이터만 서비스 재산출과 어긋나는 축이 다시 생긴다.
 *
 * 이 파일은 Nest 데코레이터·DI·Prisma 없는 순수 TS 다 — 시드와 테스트가 함께 import 한다
 * (시드를 실행하지 않고 생성 결과를 검증하기 위한 분리다).
 */

import {
  computeMeasurementValue,
  evaluateMeetTarget,
  resolveIndicatorPolicy,
  MEASUREMENT_VALUE_MAX,
} from '../../src/modules/quality/indicator-policy';

/** 지표 카탈로그 1건 — `QualityIndicator` 행 그대로. `i` 는 결정적 UUID 인덱스. */
export interface QiIndicatorSeed {
  i: number;
  name: string;
  category: string;
  formula: string;
  targetValue: number;
}

/**
 * 지표 카탈로그 — 시드와 테스트가 **같은 표**를 본다.
 * 🔴 방향·단위·배율 컬럼은 **일부러 비운다**. 관리자 등재(① DB 컬럼)가 아니면
 *    `indicator-policy` 의 등재표·formula 파싱(②)이 정본이다. 시드가 컬럼에 값을 박으면
 *    등재표와 어긋날 때 `directionConflict` 만 늘고 정본이 둘이 된다.
 */
export const QI_INDICATOR_CATALOG: QiIndicatorSeed[] = [
  // 환자안전
  { i: 1, name: '30일 내 재입원율', category: '환자안전', formula: '(30일 이내 재입원 환자 수 / 퇴원 환자 수) × 100', targetValue: 5.0 },
  { i: 2, name: '병원감염 발생률', category: '환자안전', formula: '(병원감염 발생 건수 / 재원일수) × 1000', targetValue: 3.0 },
  { i: 3, name: '낙상 발생률', category: '환자안전', formula: '(낙상 발생 건수 / 재원일수) × 1000', targetValue: 1.5 },
  { i: 4, name: '투약오류 발생률', category: '환자안전', formula: '(투약오류 건수 / 총 투약 건수) × 1000', targetValue: 0.5 },
  { i: 5, name: '수술부위 감염률', category: '환자안전', formula: '(수술부위 감염 건수 / 수술 건수) × 100', targetValue: 2.0 },
  { i: 6, name: '욕창 발생률', category: '환자안전', formula: '(욕창 신규 발생 건수 / 재원일수) × 1000', targetValue: 1.0 },
  { i: 7, name: '수혈 부작용 발생률', category: '환자안전', formula: '(수혈 부작용 건수 / 총 수혈 건수) × 100', targetValue: 0.3 },
  // 진료 성과
  { i: 8, name: '환자만족도', category: '진료 성과', formula: '환자만족도 설문 평균 점수 (100점 만점)', targetValue: 85.0 },
  { i: 9, name: '응급실 체류시간 (중증)', category: '진료 성과', formula: 'KTAS 1-2 환자 응급실 평균 체류시간 (분)', targetValue: 60.0 },
  { i: 10, name: '평균 재원일수', category: '진료 성과', formula: '총 재원일수 / 퇴원 환자 수', targetValue: 7.0 },
  { i: 11, name: '수술 사망률', category: '진료 성과', formula: '(수술 후 30일 내 사망 수 / 수술 건수) × 100', targetValue: 0.5 },
  { i: 12, name: '외래 초진 대기시간', category: '진료 성과', formula: '접수 ~ 진료 시작 평균 시간 (분)', targetValue: 30.0 },
  // 진료 효율
  { i: 13, name: '병상 가동률', category: '진료 효율', formula: '(점유 병상일수 / 가용 병상일수) × 100', targetValue: 85.0 },
  { i: 14, name: '수술실 가동률', category: '진료 효율', formula: '(수술 시간 / 운영 가능 시간) × 100', targetValue: 75.0 },
  { i: 15, name: '검사결과 보고시간', category: '진료 효율', formula: '접수 ~ 결과 보고 평균 시간 (분)', targetValue: 60.0 },
  { i: 16, name: '처방전달시간', category: '진료 효율', formula: '처방 ~ 약국 수령 평균 시간 (분)', targetValue: 20.0 },
  // 감염관리
  { i: 17, name: '손위생 수행률', category: '감염관리', formula: '(손위생 수행 횟수 / 손위생 기회 횟수) × 100', targetValue: 95.0 },
  { i: 18, name: '중심정맥관 관련 혈류감염률', category: '감염관리', formula: '(CLABSI 건수 / 중심정맥관 유치일수) × 1000', targetValue: 1.5 },
  { i: 19, name: '요로감염 발생률 (도뇨관)', category: '감염관리', formula: '(CAUTI 건수 / 도뇨관 유치일수) × 1000', targetValue: 2.0 },
  { i: 20, name: '인공호흡기 관련 폐렴 발생률', category: '감염관리', formula: '(VAP 건수 / 인공호흡기 유치일수) × 1000', targetValue: 2.0 },
  // 경영
  { i: 21, name: '직원 이직률', category: '경영', formula: '(퇴직자 수 / 평균 재직자 수) × 100', targetValue: 10.0 },
  { i: 22, name: '의료수익 대비 인건비율', category: '경영', formula: '(인건비 / 의료수익) × 100', targetValue: 55.0 },
  { i: 23, name: '필수교육 이수율', category: '경영', formula: '(이수자 수 / 대상자 수) × 100', targetValue: 95.0 },
  { i: 24, name: '환자 불만 건수', category: '경영', formula: '월간 환자 불만 접수 건수', targetValue: 5.0 },
  { i: 25, name: '진료비 청구 반송률', category: '경영', formula: '(반송 건수 / 청구 건수) × 100', targetValue: 3.0 },
];

/**
 * 지표별 12개월 시뮬레이션 모수.
 *
 * 🔴 `baseValue` 는 **표시 단위의 값**(배율이 이미 적용된 값 — %·건/1000·분·점)이고,
 *    `denominator` 는 **formula 의 분모가 실제로 뜻하는 모수**다. 생성기는 이 둘로 분자를
 *    정수로 확정한 뒤 **값을 정본식으로 산출**한다 — 즉 `baseValue` 는 목표하는 대략의 수준이지
 *    저장될 값이 아니다(정수 분자로 반올림되면서 조금 달라진다. 그게 사실이다).
 */
export interface QiSimProfile {
  /** 표시 단위 기준값 */
  baseValue: number;
  /** formula 분모의 모수(월 단위) */
  denominator: number;
  /** 월당 추세(표시 단위) */
  trend: number;
  /** 계절 변동 진폭(표시 단위) */
  noise: number;
  /** 분모가 무엇인지 — 숫자만 보고 오해하지 않도록 남긴다 */
  denominatorMeans: string;
}

export const QI_SIM_PROFILES: Record<string, QiSimProfile> = {
  '30일 내 재입원율': { baseValue: 4.2, denominator: 320, trend: -0.1, noise: 0.8, denominatorMeans: '월 퇴원 환자 수' },
  '병원감염 발생률': { baseValue: 2.5, denominator: 9500, trend: -0.05, noise: 0.4, denominatorMeans: '월 재원일수' },
  '낙상 발생률': { baseValue: 1.2, denominator: 9500, trend: -0.03, noise: 0.3, denominatorMeans: '월 재원일수' },
  '투약오류 발생률': { baseValue: 0.35, denominator: 15000, trend: -0.02, noise: 0.1, denominatorMeans: '월 총 투약 건수' },
  '수술부위 감염률': { baseValue: 1.6, denominator: 180, trend: -0.05, noise: 0.3, denominatorMeans: '월 수술 건수' },
  '욕창 발생률': { baseValue: 0.8, denominator: 9500, trend: -0.02, noise: 0.2, denominatorMeans: '월 재원일수' },
  '수혈 부작용 발생률': { baseValue: 0.2, denominator: 450, trend: 0, noise: 0.1, denominatorMeans: '월 총 수혈 건수' },
  '환자만족도': { baseValue: 82.0, denominator: 500, trend: 0.5, noise: 3, denominatorMeans: '월 설문 응답자 수(분자=점수 합)' },
  '응급실 체류시간 (중증)': { baseValue: 55, denominator: 85, trend: -1, noise: 8, denominatorMeans: '월 KTAS 1-2 환자 수(분자=총 체류 분)' },
  '평균 재원일수': { baseValue: 6.8, denominator: 320, trend: -0.05, noise: 0.5, denominatorMeans: '월 퇴원 환자 수(분자=총 재원일수)' },
  '수술 사망률': { baseValue: 0.3, denominator: 180, trend: 0, noise: 0.15, denominatorMeans: '월 수술 건수' },
  '외래 초진 대기시간': { baseValue: 28, denominator: 1200, trend: -0.5, noise: 5, denominatorMeans: '월 외래 초진 건수(분자=총 대기 분)' },
  // 🔴 종전 분모 100 은 '가용 병상일수'가 아니다(백분율 역산 편의로 넣은 수). 실제 모수로 바꾼다.
  '병상 가동률': { baseValue: 82, denominator: 7500, trend: 0.3, noise: 4, denominatorMeans: '월 가용 병상일수(250병상×30일)' },
  '수술실 가동률': { baseValue: 72, denominator: 84480, trend: 0.5, noise: 5, denominatorMeans: '월 운영 가능 시간(분) — 8실×22일×480분' },
  '검사결과 보고시간': { baseValue: 55, denominator: 2500, trend: -1, noise: 8, denominatorMeans: '월 검사 건수(분자=총 보고 소요 분)' },
  '처방전달시간': { baseValue: 18, denominator: 8000, trend: -0.3, noise: 3, denominatorMeans: '월 처방 건수(분자=총 전달 소요 분)' },
  '손위생 수행률': { baseValue: 91, denominator: 3000, trend: 0.5, noise: 3, denominatorMeans: '월 손위생 기회 횟수' },
  '중심정맥관 관련 혈류감염률': { baseValue: 1.2, denominator: 2800, trend: -0.03, noise: 0.3, denominatorMeans: '월 중심정맥관 유치일수' },
  '요로감염 발생률 (도뇨관)': { baseValue: 1.6, denominator: 3200, trend: -0.04, noise: 0.4, denominatorMeans: '월 도뇨관 유치일수' },
  '인공호흡기 관련 폐렴 발생률': { baseValue: 1.8, denominator: 1500, trend: -0.05, noise: 0.4, denominatorMeans: '월 인공호흡기 유치일수' },
  '직원 이직률': { baseValue: 8.5, denominator: 200, trend: -0.2, noise: 1.5, denominatorMeans: '평균 재직자 수' },
  // 🔴 종전 분모 100. 의료수익을 **천원 단위**로 둔다(원 단위는 Int 범위를 넘는다).
  '의료수익 대비 인건비율': { baseValue: 52, denominator: 4_200_000, trend: 0.1, noise: 2, denominatorMeans: '월 의료수익(천원)' },
  '필수교육 이수율': { baseValue: 88, denominator: 200, trend: 0.8, noise: 3, denominatorMeans: '교육 대상자 수' },
  // 배율 1 · 분모 1 — '건수' 지표는 분자가 곧 값이다
  '환자 불만 건수': { baseValue: 7, denominator: 1, trend: -0.3, noise: 2, denominatorMeans: '해당 월(분자=접수 건수)' },
  '진료비 청구 반송률': { baseValue: 3.5, denominator: 2800, trend: -0.1, noise: 0.5, denominatorMeans: '월 청구 건수' },
};

/** 프로필 미등재 지표의 기본값 — 새 지표가 들어와도 시드가 죽지 않게 한다. */
export const QI_SIM_FALLBACK: QiSimProfile = {
  baseValue: 50,
  denominator: 100,
  trend: 0,
  noise: 5,
  denominatorMeans: '미등재 — 기본값',
};

export interface QiMeasurementSeedRow {
  indicatorId: string;
  period: string;
  numerator: number;
  denominator: number;
  value: number;
  meetTarget: boolean | null;
  measuredAt: Date;
  /** 검증·디버깅용 — DB 컬럼은 아니다 */
  valueScale: number;
}

export interface QiIndicatorRef {
  id: string;
  name: string;
  formula?: string | null;
  category?: string | null;
  targetValue?: number | string | null;
  direction?: string | null;
  unit?: string | null;
  valueScale?: number | null;
}

/**
 * 지표 1건의 최근 `months` 개월 측정값 생성.
 *
 * 🔴 순서가 곧 규칙이다: **분모 확정 → 분자 정수 확정 → 값 산출**.
 *    값을 먼저 정하고 분자를 역산하면(종전 시드) 배율이 100 이 아닌 지표가 전부 어긋난다.
 */
export function buildQiMeasurements(
  indicator: QiIndicatorRef,
  opts: { now?: Date; months?: number } = {},
): QiMeasurementSeedRow[] {
  const months = opts.months ?? 12;
  const now = opts.now ?? new Date();
  const sim = QI_SIM_PROFILES[indicator.name] ?? QI_SIM_FALLBACK;
  const policy = resolveIndicatorPolicy({
    name: indicator.name,
    category: indicator.category ?? null,
    formula: indicator.formula ?? null,
    direction: indicator.direction ?? null,
    unit: indicator.unit ?? null,
    valueScale: indicator.valueScale ?? null,
  });
  const scale = policy.valueScale;
  const target =
    indicator.targetValue == null || indicator.targetValue === ''
      ? null
      : Number(indicator.targetValue);

  const rows: QiMeasurementSeedRow[] = [];
  for (let m = months - 1; m >= 0; m--) {
    /**
     * 🔴 **`setMonth()` 는 말일에서 다음 달로 굴러간다.**
     *    종전 코드는 오늘 날짜를 그대로 들고 달만 뺐다 — 오늘이 29일이면
     *    `2026-02-29` 를 만들려다 **2026-03-01** 이 되어 **2월이 통째로 사라지고
     *    3월이 두 번** 나왔다. 그러면 `@@unique([indicatorId, period])` 를 위반해
     *    **매달 29·30·31일에 `prisma db seed` 가 죽는다.**
     *    (이 저장소는 시드가 조용히 죽어 있던 전례가 있다 — 2026-06-10~)
     *
     * 🔴 **날짜를 빼지 말고 연·월로 계산한다.** 일(day)을 1로 고정하면 굴러갈 자리가 없다.
     */
    const period = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const periodStr = `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`;

    // 결정론적 변동(랜덤 금지 — 시드는 몇 번 돌려도 같은 값이어야 한다)
    const noise = sim.noise * Math.sin(m * 2.7 + indicator.name.length);
    /** 목표하는 대략의 수준(표시 단위). 저장될 값이 아니다 — 아래에서 분자·분모로부터 산출된다. */
    const aimed = Math.max(0, sim.baseValue + sim.trend * (months - 1 - m) + noise);

    const denominator = Math.max(1, Math.round(sim.denominator * (0.9 + (m % 3) * 0.05)));
    const numerator = Math.max(0, Math.round((aimed / scale) * denominator));

    const value = computeMeasurementValue(numerator, denominator, scale);
    if (value === null) {
      throw new Error(`[seed:qi] ${indicator.name} ${periodStr} 값 산출 불가 (분자 ${numerator} / 분모 ${denominator} × ${scale})`);
    }
    // 🔴 Decimal(5,2) 를 넘으면 Prisma 가 numeric overflow 로 터진다. 잘라 담지 않고 알린다.
    if (value > MEASUREMENT_VALUE_MAX) {
      throw new Error(
        `[seed:qi] ${indicator.name} ${periodStr} 값 ${value} 가 저장 한도 ${MEASUREMENT_VALUE_MAX} 초과 — 분모(${sim.denominatorMeans})를 다시 잡아라`,
      );
    }

    rows.push({
      indicatorId: indicator.id,
      period: periodStr,
      numerator,
      denominator,
      value,
      // 🔴 방향 판정은 정본 하나(evaluateMeetTarget). 시드가 키워드 목록을 따로 두면
      //    '폐렴' 누락 같은 한 글자로 임상 지표가 통째로 뒤집힌다(P12 실사례).
      meetTarget: evaluateMeetTarget(value, target, policy.direction),
      measuredAt: period,
      valueScale: scale,
    });
  }
  return rows;
}

/**
 * 측정 행의 **결정적 UUID 인덱스**.
 *
 * 🔴 원래 결함(같은 부류·2026-08-18 발견): 종전 시드는 `makeUuid('01010000', qmCount++)` 로
 *    **순번**을 id 로 썼고, 그 순번은 `findMany()`(orderBy 없음)가 돌려주는 **DB 행 순서**에
 *    의존했다. 즉 같은 id 가 실행마다 다른 (지표, 기간)을 가리킬 수 있었다.
 *    게다가 12개월 창이 한 달 굴러가면 슬롯 j 가 슬롯 j+1 이 쥐고 있던 기간을 넘겨받아,
 *    `@@unique([indicatorId, period])` 를 루프 도중에 위반한다.
 *    → id 는 **(지표, 기간)에서** 나오게 하고, upsert 는 **자연키**로 한다.
 *
 * 인덱스 = (카탈로그번호-1) × 200 + 2020-01 부터의 개월수. 지표당 200개월(2036년까지) 공간.
 */
export function qiMeasurementSeedIndex(catalogIndex: number, period: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`[seed:qi] 기간 형식이 아니다: ${period}`);
  const months = (Number(m[1]) - 2020) * 12 + (Number(m[2]) - 1);
  if (months < 0 || months >= 200) {
    throw new Error(`[seed:qi] 기간 ${period} 이 id 공간(2020-01 ~ 2036-08) 밖이다 — 인덱스 배치를 다시 잡아라`);
  }
  return (catalogIndex - 1) * 200 + months;
}
