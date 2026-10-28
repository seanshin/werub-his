import { describe, it, expect } from 'vitest';
import {
  psychMseRows, psychScaleRows, psychScaleSeries, psychSuicideRows,
  uroExamRows, uroPsaRows, uroIpssRows, uroPsaSeries, ipssSeverity,
  orthoRomRows, orthoSpecialTestRows, specialTestResultKind,
  obgynPrenatalRows, obgynGynRows, obgynUltrasoundRows, obgynGrowthPoints,
  gestationalWeeks, summarizeJson,
} from './exam-views';

/**
 * 과별 탭 매퍼 가드 — 2026-08-18.
 *
 * 이 스펙의 목적은 "동작한다"가 아니라 **옛 결함을 재주입하면 실패하는 것**이다.
 * 재주입 대상(전부 실제로 화면에 있던 코드):
 *   `?? 0`(미측정 → 0), `?? 10`(미측정 AFI → 정상), `result !== '+' → 음성(초록)`,
 *   `|| '-'`(진짜 0 은닉), 미시행 척도를 0점 행으로 만들기.
 */

/* ── 정신건강의학과 ───────────────────────────────────────── */

const psychExam = {
  id: 'e1',
  examinedAt: '2026-08-01T00:00:00.000Z',
  appearance: '단정', behavior: '협조적', speech: '정상속도',
  mood: '우울', affect: '제한',
  thoughtContent: { suicidalIdeation: false, delusions: false },
  thoughtProcess: '논리적',
  perception: { hallucinations: { auditory: false, visual: false } },
  cognition: { orientation: true, memory: true },
  insight: 'GOOD',
  phq9: 18, gad7: 8, mmse: 28,
  suicideRisk: 'LOW', safetyPlan: true,
};

describe('psychMseRows', () => {
  it('외양·행동을 합쳐 보여주고 JSONB 를 한 줄로 요약한다', () => {
    const [r] = psychMseRows([psychExam]);
    expect(r.appearanceBehavior).toBe('단정 / 협조적');
    expect(r.thoughtContent).toBe('자살사고 없음 · 망상 없음');
    expect(r.perception).toBe('환청 없음 · 환시 없음');
  });

  it('인지 boolean 은 있음/없음이 아니라 유지/저하로 읽는다(뜻이 뒤집힌다)', () => {
    const [r] = psychMseRows([psychExam]);
    expect(r.cognition).toBe('지남력 유지 · 기억력 유지');
    expect(r.cognition).not.toContain('있음');
  });

  it('기록되지 않은 항목은 슬래시만 남기지 않고 null 이다', () => {
    const [r] = psychMseRows([{ id: 'x', examinedAt: null }]);
    expect(r.appearanceBehavior).toBeNull();
    expect(r.moodAffect).toBeNull();
    expect(r.thoughtContent).toBeNull();
  });
});

describe('psychScaleRows', () => {
  it('시행한 척도만 행이 된다 — 미시행(AUDIT)을 0점으로 만들지 않는다', () => {
    const rows = psychScaleRows([psychExam]);
    expect(rows.map((r) => r.testName)).toEqual(['PHQ-9', 'GAD-7', 'MMSE']);
    expect(rows.find((r) => r.testName === 'AUDIT')).toBeUndefined();
  });

  it('해석은 임상도구 정본 밴드에서 온다(화면이 절단점을 새로 짓지 않는다)', () => {
    const rows = psychScaleRows([psychExam]);
    expect(rows.find((r) => r.testName === 'PHQ-9')?.interpretation).toBe('중등도-중증');
    expect(rows.find((r) => r.testName === 'GAD-7')?.interpretation).toBe('경도');
    // MMSE 는 낮을수록 나쁘다 — 방향을 정본에 위임했는지 확인
    expect(rows.find((r) => r.testName === 'MMSE')?.level).toBe('normal');
    expect(psychScaleRows([{ id: 'z', examinedAt: null, mmse: 12 }])[0].level).toBe('high');
  });

  it('점수 0 은 유효한 값이라 행으로 남는다', () => {
    const rows = psychScaleRows([{ id: 'z', examinedAt: null, phq9: 0 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(0);
  });
});

describe('psychScaleSeries', () => {
  it('시행 기록이 없는 척도는 시리즈를 만들지 않는다', () => {
    const series = psychScaleSeries([psychExam]);
    expect(series.map((s) => s.name)).toEqual(['PHQ-9', 'GAD-7', 'MMSE']);
    expect(series.every((s) => s.data.length > 0)).toBe(true);
  });

  it('시간순으로 정렬한다', () => {
    const series = psychScaleSeries([
      { id: 'b', examinedAt: '2026-08-05T00:00:00.000Z', phq9: 10 },
      { id: 'a', examinedAt: '2026-07-01T00:00:00.000Z', phq9: 20 },
    ]);
    expect(series[0].data.map((d) => d.date)).toEqual(['2026-07-01', '2026-08-05']);
  });
});

describe('psychSuicideRows', () => {
  it('평가 흔적이 전혀 없으면 행을 만들지 않는다(빈 목록이 정답)', () => {
    expect(psychSuicideRows([{ id: 'x', examinedAt: null, phq9: 5 }])).toEqual([]);
  });

  it('PHQ-9 문항9 양성을 자살사고 있음으로 읽고 근거를 함께 남긴다', () => {
    const [r] = psychSuicideRows([{ id: 'x', examinedAt: null, phq9Item9: 2 }]);
    expect(r.suicidalIdeation).toBe(true);
    expect(r.ideationSource).toBe('PHQ9_ITEM9');
  });

  it('평가되지 않은 자살계획을 "없음"으로 단정하지 않는다', () => {
    const [r] = psychSuicideRows([{ id: 'x', examinedAt: null, suicideRisk: 'MODERATE' }]);
    expect(r.suicidalPlan).toBeNull();
    expect(r.suicidalIdeation).toBeNull();
    expect(r.safetyPlan).toBeNull();
  });

  it('안전계획이 기록되면 true, 기록이 없으면 null 이다', () => {
    expect(psychSuicideRows([psychExam])[0].safetyPlan).toBe(true);
    expect(psychSuicideRows([{ id: 'x', examinedAt: null, suicideRisk: 'LOW' }])[0].safetyPlan).toBeNull();
  });
});

/* ── 비뇨의학과 ───────────────────────────────────────────── */

const uroExam = {
  id: 'u1', examinedAt: '2026-08-01T00:00:00.000Z',
  ipssScore: 18, ipssQol: 4, psaValue: 3.2,
  urodynamics: { maxFlowRate: 12, avgFlowRate: 6.5, voidedVolume: 250, residualVolume: 80 },
  prostateVolume: 42, diagnosis: '전립선 비대증',
};

describe('uroExamRows', () => {
  it('요류검사 값은 urodynamics JSONB 에서 꺼낸다(예전엔 평면 컬럼을 읽어 전 칸이 비었다)', () => {
    const [r] = uroExamRows([uroExam]);
    expect(r.maxFlowRate).toBe(12);
    expect(r.residualVolume).toBe(80);
    expect(r.prostateVolume).toBe(42);
  });

  it('미측정을 0 으로 만들지 않는다 — Qmax 0 은 요폐라는 별개의 사실이다', () => {
    const [none] = uroExamRows([{ id: 'u2', examinedAt: null }]);
    expect(none.maxFlowRate).toBeNull();
    const [zero] = uroExamRows([{ id: 'u3', examinedAt: null, urodynamics: { maxFlowRate: 0, residualVolume: 0 } }]);
    expect(zero.maxFlowRate).toBe(0);
    expect(zero.residualVolume).toBe(0);
  });

  it('Decimal 문자열 직렬화도 숫자로 읽는다', () => {
    const [r] = uroExamRows([{ id: 'u4', examinedAt: null, prostateVolume: '42.5' }]);
    expect(r.prostateVolume).toBe(42.5);
  });
});

describe('uroPsaRows / uroIpssRows', () => {
  it('측정된 항목만 행이 된다', () => {
    const exams = [uroExam, { id: 'u9', examinedAt: '2026-08-02T00:00:00.000Z' }];
    expect(uroPsaRows(exams)).toHaveLength(1);
    expect(uroIpssRows(exams)).toHaveLength(1);
  });

  it('IPSS 중증도는 표준 구간을 따른다', () => {
    expect(ipssSeverity(7)).toBe('MILD');
    expect(ipssSeverity(8)).toBe('MODERATE');
    expect(ipssSeverity(20)).toBe('SEVERE');
  });

  it('PSA 축 상한은 관측값을 담고 기준선 4.0 은 참고선으로만 둔다', () => {
    const [s] = uroPsaSeries(uroPsaRows([{ id: 'x', examinedAt: '2026-08-01T00:00:00.000Z', psaValue: 24.4 }]));
    expect(s.maxScore).toBeGreaterThanOrEqual(24.4);
    expect(s.referenceValue).toBe(4);
  });
});

/* ── 정형외과 ─────────────────────────────────────────────── */

const orthoExam = {
  id: 'o1', examinedAt: '2026-08-01T00:00:00.000Z', bodyPart: 'KNEE', side: 'RIGHT',
  rom: [{ movement: '굴곡', measured: 120, normal: 135 }, { movement: '신전', measured: 0, normal: 0 }],
  specialTests: [{ test: 'McMurray', result: '+', notes: '내측' }, { test: 'Lachman', result: '-' }, { test: 'Pivot shift', result: '판정 불가' }],
};

describe('orthoRomRows', () => {
  it('ROM JSONB 배열을 행으로 펼치고 부위·좌우를 함께 싣는다', () => {
    const rows = orthoRomRows([orthoExam]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ bodyPart: 'KNEE', side: 'RIGHT', movement: '굴곡', measured: 120, normal: 135 });
  });

  it('측정값 0 은 강직이라는 사실이다 — null 로 접지 않는다', () => {
    expect(orthoRomRows([orthoExam])[1].measured).toBe(0);
  });
});

describe('orthoSpecialTestRows', () => {
  it('양성/음성만 판정하고 나머지는 미상이다(모르는 결과를 초록으로 접지 않는다)', () => {
    const rows = orthoSpecialTestRows([orthoExam]);
    expect(rows.map((r) => r.resultKind)).toEqual(['POSITIVE', 'NEGATIVE', 'UNKNOWN']);
  });

  it('표기 변형을 모두 같은 판정으로 읽는다', () => {
    expect(specialTestResultKind('POSITIVE')).toBe('POSITIVE');
    expect(specialTestResultKind('양성')).toBe('POSITIVE');
    expect(specialTestResultKind('neg')).toBe('NEGATIVE');
    expect(specialTestResultKind(null)).toBe('UNKNOWN');
    expect(specialTestResultKind('equivocal')).toBe('UNKNOWN');
  });
});

/* ── 산부인과 ─────────────────────────────────────────────── */

const prenatal = {
  id: 'g1', examType: 'PRENATAL', examinedAt: '2026-08-01T00:00:00.000Z',
  gestationalAge: '28W3D', edd: '2026-08-15T00:00:00.000Z', gravida: 2, para: 1,
  currentWeight: 72.5, bloodPressure: '120/75', urineProtein: '-', urineGlucose: '-',
  fundalHeight: 28, fetalHeartRate: 140,
  ultrasound: { bpd: 72, fl: 54, ac: 245, efw: 1250, afi: 14, presentation: '두위', placentaLocation: '전벽 상부' },
};
const gyn = { id: 'g2', examType: 'GYNECOLOGY', examinedAt: '2026-08-02T00:00:00.000Z', papSmear: 'NILM', hpvTest: 'Negative', pelvicUltrasound: { uterus: '정상', ovary: '정상' }, diagnosis: '정상 검진' };

describe('obgyn 탭 분기', () => {
  it('examType 으로 산전/부인과를 가른다', () => {
    expect(obgynPrenatalRows([prenatal, gyn]).map((r) => r.id)).toEqual(['g1']);
    expect(obgynGynRows([prenatal, gyn]).map((r) => r.id)).toEqual(['g2']);
  });

  it('부인과 행은 실제 저장 필드(Pap·HPV·골반초음파)를 쓴다', () => {
    const [r] = obgynGynRows([gyn]);
    expect(r.papSmear).toBe('NILM');
    expect(r.pelvicUltrasound).toBe('uterus 정상 · ovary 정상');
  });

  it('태아심박 미측정을 0bpm 으로 말하지 않는다', () => {
    const [r] = obgynPrenatalRows([{ id: 'g3', examType: 'PRENATAL', examinedAt: null }]);
    expect(r.fetalHeartRate).toBeNull();
  });
});

describe('obgynUltrasoundRows', () => {
  it('초음파를 하지 않은 진료는 행이 되지 않는다', () => {
    expect(obgynUltrasoundRows([gyn])).toEqual([]);
  });

  it('AFI 미측정은 null 이다 — 예전엔 `?? 10` 이라 안 잰 것이 정상(초록)으로 보였다', () => {
    const [r] = obgynUltrasoundRows([{ id: 'g4', examType: 'PRENATAL', examinedAt: null, ultrasound: { bpd: 70 } }]);
    expect(r.afi).toBeNull();
    expect(r.bpd).toBe(70);
  });
});

describe('gestationalWeeks / obgynGrowthPoints', () => {
  it('"28W3D" 를 주수로 읽는다', () => {
    expect(gestationalWeeks('28W3D')).toBeCloseTo(28 + 3 / 7, 5);
    expect(gestationalWeeks('32W')).toBe(32);
  });

  it('형식을 모르면 추정하지 않는다', () => {
    expect(gestationalWeeks('28주 3일')).toBeNull();
    expect(gestationalWeeks(null)).toBeNull();
  });

  it('주수를 모르는 초음파는 성장곡선에 찍지 않는다', () => {
    const rows = obgynUltrasoundRows([prenatal, { id: 'g5', examType: 'PRENATAL', examinedAt: null, ultrasound: { efw: 1400 } }]);
    const pts = obgynGrowthPoints(rows);
    expect(pts).toHaveLength(1);
    expect(pts[0].efw).toBe(1250);
  });
});

describe('summarizeJson', () => {
  it('빈 객체는 요약이 아니라 null 이다', () => {
    expect(summarizeJson({})).toBeNull();
    expect(summarizeJson(null)).toBeNull();
  });

  it('모르는 키는 지어내지 않고 키 원문을 보여준다', () => {
    expect(summarizeJson({ someNewFlag: true })).toBe('someNewFlag 있음');
  });
});
