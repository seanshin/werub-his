/**
 * Scoring 아키타입 콘텐츠 (항목 점수 합산 → 밴드)
 * 출처: clinical-charts 03·04·06·07·08·10 문서.
 * ⚠️ 전 차트 verified=false — 운영 노출 전 공식 가이드라인 원문 대조 필수.
 *    수치·임계값은 기관 정책으로 대체될 수 있음. 보조도구·최종판단 의사 귀속.
 */
import type { ScoringDef } from '../types';

const yesNo = (score: number) => [{ label: '아니오', score: 0 }, { label: '예', score }];

export const SCORING_DEFS: ScoringDef[] = [
  /* ── 신경/의식 ── */
  {
    chartId: 'GCS', name: 'Glasgow Coma Scale (GCS)', category: '신경', archetype: 'scoring',
    sourceGuideline: 'Teasdale & Jennett', sourceVersion: '1974', verified: false, range: '3-15',
    note: '삽관 등으로 언어평가 불가 시 V는 별도 표기(T). 표기 예 E3V4M5.',
    categories: [
      { key: 'e', label: '개안 반응 (E)', options: [
        { label: '자발적 개안', score: 4 }, { label: '음성에 개안', score: 3 },
        { label: '통증에 개안', score: 2 }, { label: '개안 없음', score: 1 } ] },
      { key: 'v', label: '언어 반응 (V)', options: [
        { label: '지남력 정상', score: 5 }, { label: '혼돈 대화', score: 4 },
        { label: '부적절 단어', score: 3 }, { label: '이해불가 소리', score: 2 }, { label: '언어반응 없음', score: 1 } ] },
      { key: 'm', label: '운동 반응 (M)', options: [
        { label: '명령에 따름', score: 6 }, { label: '통증 부위 인지', score: 5 },
        { label: '도피 반응', score: 4 }, { label: '비정상 굴곡(제피질)', score: 3 },
        { label: '신전 반응(제뇌)', score: 2 }, { label: '운동반응 없음', score: 1 } ] },
    ],
    bands: [
      { min: 3, max: 8, label: '중증', level: 'critical', recommendation: '기도확보·중환자 평가' },
      { min: 9, max: 12, label: '중등도', level: 'moderate' },
      { min: 13, max: 15, label: '경증', level: 'low' },
    ],
  },

  /* ── 조기경보 (※ 기존 EarlyWarningScore 모델 존재 — 참조 계산기) ── */
  {
    chartId: 'NEWS2', name: 'National Early Warning Score 2 (NEWS2)', category: '응급/중환자', archetype: 'scoring',
    sourceGuideline: 'Royal College of Physicians', sourceVersion: '2017', verified: false, range: '0-20',
    existingModel: 'EarlyWarningScore', note: '단일 항목 3점이면 총점과 무관하게 중위험 — 임상 판단 병행. SpO₂ Scale2(목표 88–92%)는 별도 적용.',
    categories: [
      { key: 'rr', label: '호흡수 (/min)', options: [
        { label: '≤8', score: 3 }, { label: '9–11', score: 1 }, { label: '12–20', score: 0 }, { label: '21–24', score: 2 }, { label: '≥25', score: 3 } ] },
      { key: 'spo2', label: 'SpO₂ (%)', options: [
        { label: '≤91', score: 3 }, { label: '92–93', score: 2 }, { label: '94–95', score: 1 }, { label: '≥96', score: 0 } ] },
      { key: 'o2', label: '보충산소', options: yesNo(2) },
      { key: 'sbp', label: '수축기혈압 (mmHg)', options: [
        { label: '≤90', score: 3 }, { label: '91–100', score: 2 }, { label: '101–110', score: 1 }, { label: '111–219', score: 0 }, { label: '≥220', score: 3 } ] },
      { key: 'hr', label: '맥박 (/min)', options: [
        { label: '≤40', score: 3 }, { label: '41–50', score: 1 }, { label: '51–90', score: 0 }, { label: '91–110', score: 1 }, { label: '111–130', score: 2 }, { label: '≥131', score: 3 } ] },
      { key: 'acvpu', label: '의식 (ACVPU)', options: [ { label: 'A (명료)', score: 0 }, { label: 'C/V/P/U', score: 3 } ] },
      { key: 'temp', label: '체온 (℃)', options: [
        { label: '≤35.0', score: 3 }, { label: '35.1–36.0', score: 1 }, { label: '36.1–38.0', score: 0 }, { label: '38.1–39.0', score: 1 }, { label: '≥39.1', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 0, label: '저위험', level: 'normal', recommendation: '최소 12시간마다 관찰' },
      { min: 1, max: 4, label: '저위험', level: 'low', recommendation: '4–6시간마다 간호사 평가' },
      { min: 5, max: 6, label: '중위험', level: 'moderate', recommendation: '1시간마다·신속대응팀 고려' },
      { min: 7, max: 20, label: '고위험', level: 'critical', recommendation: '지속 모니터·긴급/중환자 대응' },
    ],
  },

  /* ── 낙상 (※ 기존 FallRiskAssessment 모델 존재) ── */
  {
    chartId: 'MORSE', name: 'Morse Falls Scale (낙상 위험)', category: '간호', archetype: 'scoring',
    sourceGuideline: 'Morse', sourceVersion: '1989', verified: false, range: '0-125', existingModel: 'FallRiskAssessment',
    categories: [
      { key: 'history', label: '낙상력 (최근 3개월)', options: [ { label: '없음', score: 0 }, { label: '있음', score: 25 } ] },
      { key: 'dx', label: '이차 진단 (둘 이상)', options: [ { label: '없음', score: 0 }, { label: '있음', score: 15 } ] },
      { key: 'aid', label: '보행 보조', options: [ { label: '없음/침상/간호보조', score: 0 }, { label: '목발·지팡이·보행기', score: 15 }, { label: '가구 잡고', score: 30 } ] },
      { key: 'iv', label: '정맥주입(IV)/헤파린락', options: yesNo(20) },
      { key: 'gait', label: '걸음걸이', options: [ { label: '정상/침상/부동', score: 0 }, { label: '약함', score: 10 }, { label: '장애', score: 20 } ] },
      { key: 'mental', label: '정신상태', options: [ { label: '자기능력 인지', score: 0 }, { label: '과대평가·망각', score: 15 } ] },
    ],
    bands: [
      { min: 0, max: 24, label: '저위험', level: 'low', recommendation: '기본 간호' },
      { min: 25, max: 44, label: '중위험', level: 'moderate', recommendation: '표준 낙상예방' },
      { min: 45, max: 125, label: '고위험', level: 'high', recommendation: '고위험 낙상예방 프로토콜' },
    ],
  },

  /* ── 욕창 (※ 기존 bradenScore 컬럼 존재) ── */
  {
    chartId: 'BRADEN', name: 'Braden Scale (욕창 위험)', category: '간호', archetype: 'scoring',
    sourceGuideline: 'Braden & Bergstrom', sourceVersion: '1987', verified: false, range: '6-23', existingModel: 'bradenScore',
    note: '점수가 낮을수록 고위험 (역방향).',
    categories: [
      { key: 'sensory', label: '감각 인지', options: [ { label: '1 완전제한', score: 1 }, { label: '2 매우제한', score: 2 }, { label: '3 약간제한', score: 3 }, { label: '4 장애없음', score: 4 } ] },
      { key: 'moisture', label: '습기', options: [ { label: '1 지속습윤', score: 1 }, { label: '2 자주습윤', score: 2 }, { label: '3 가끔습윤', score: 3 }, { label: '4 거의없음', score: 4 } ] },
      { key: 'activity', label: '활동 정도', options: [ { label: '1 침상', score: 1 }, { label: '2 의자', score: 2 }, { label: '3 가끔보행', score: 3 }, { label: '4 자주보행', score: 4 } ] },
      { key: 'mobility', label: '기동성', options: [ { label: '1 완전부동', score: 1 }, { label: '2 매우제한', score: 2 }, { label: '3 약간제한', score: 3 }, { label: '4 제한없음', score: 4 } ] },
      { key: 'nutrition', label: '영양 상태', options: [ { label: '1 매우부족', score: 1 }, { label: '2 부족', score: 2 }, { label: '3 적절', score: 3 }, { label: '4 우수', score: 4 } ] },
      { key: 'friction', label: '마찰·전단력', options: [ { label: '1 문제있음', score: 1 }, { label: '2 잠재문제', score: 2 }, { label: '3 문제없음', score: 3 } ] },
    ],
    bands: [
      { min: 6, max: 9, label: '매우 높음', level: 'critical' },
      { min: 10, max: 12, label: '높음', level: 'high' },
      { min: 13, max: 14, label: '중간', level: 'moderate' },
      { min: 15, max: 18, label: '경증 위험', level: 'low' },
      { min: 19, max: 23, label: '위험 낮음', level: 'normal' },
    ],
  },

  /* ── 심혈관/혈전 ── */
  {
    chartId: 'CHA2DS2VASC', name: 'CHA₂DS₂-VASc (심방세동 뇌졸중 위험)', category: '심혈관', archetype: 'scoring',
    sourceGuideline: 'ESC AF Guideline', sourceVersion: '2020', verified: false, range: '0-9',
    note: '항응고 시작 결정은 가이드라인 임계값·출혈위험(HAS-BLED) 종합 판단.',
    categories: [
      { key: 'chf', label: 'C — 울혈성 심부전', options: yesNo(1) },
      { key: 'htn', label: 'H — 고혈압', options: yesNo(1) },
      { key: 'age75', label: 'A₂ — 연령 ≥75세', options: yesNo(2) },
      { key: 'dm', label: 'D — 당뇨', options: yesNo(1) },
      { key: 'stroke', label: 'S₂ — 뇌졸중/TIA/색전 과거력', options: yesNo(2) },
      { key: 'vasc', label: 'V — 혈관질환', options: yesNo(1) },
      { key: 'age65', label: 'A — 연령 65–74세', options: yesNo(1) },
      { key: 'sex', label: 'Sc — 여성', options: yesNo(1) },
    ],
    bands: [
      { min: 0, max: 0, label: '저위험', level: 'normal', recommendation: '항응고 통상 불필요' },
      { min: 1, max: 1, label: '경계', level: 'low', recommendation: '항응고 고려(개별 판단)' },
      { min: 2, max: 9, label: '고위험', level: 'high', recommendation: '경구항응고제 권고' },
    ],
  },
  {
    chartId: 'HASBLED', name: 'HAS-BLED (출혈 위험)', category: '심혈관', archetype: 'scoring',
    sourceGuideline: 'Pisters et al.', sourceVersion: '2010', verified: false, range: '0-9',
    categories: [
      { key: 'htn', label: 'H — 고혈압(수축기>160)', options: yesNo(1) },
      { key: 'renal_liver', label: 'A — 신/간기능 이상', options: [ { label: '없음', score: 0 }, { label: '하나', score: 1 }, { label: '둘 다', score: 2 } ] },
      { key: 'stroke', label: 'S — 뇌졸중 과거력', options: yesNo(1) },
      { key: 'bleeding', label: 'B — 출혈 경향/과거력', options: yesNo(1) },
      { key: 'labile_inr', label: 'L — INR 불안정', options: yesNo(1) },
      { key: 'elderly', label: 'E — 고령(>65)', options: yesNo(1) },
      { key: 'drugs_alcohol', label: 'D — 약물(항혈소판/NSAID)/음주', options: [ { label: '없음', score: 0 }, { label: '하나', score: 1 }, { label: '둘 다', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 2, label: '낮음', level: 'low' },
      { min: 3, max: 9, label: '고위험', level: 'high', recommendation: '면밀 모니터링·교정 가능 위험요인 관리' },
    ],
  },

  /* ── 감염/패혈증 ── */
  {
    chartId: 'CURB65', name: 'CURB-65 (지역사회획득 폐렴 중증도)', category: '감염', archetype: 'scoring',
    sourceGuideline: 'BTS', sourceVersion: '2003', verified: false, range: '0-5',
    categories: [
      { key: 'confusion', label: 'C — 의식 혼탁', options: yesNo(1) },
      { key: 'urea', label: 'U — BUN >19 mg/dL', options: yesNo(1) },
      { key: 'rr', label: 'R — 호흡수 ≥30', options: yesNo(1) },
      { key: 'bp', label: 'B — 저혈압(SBP<90 또는 DBP≤60)', options: yesNo(1) },
      { key: 'age', label: '65 — 연령 ≥65세', options: yesNo(1) },
    ],
    bands: [
      { min: 0, max: 1, label: '경증', level: 'low', recommendation: '외래 관리 고려' },
      { min: 2, max: 2, label: '중등도', level: 'moderate', recommendation: '단기입원 고려' },
      { min: 3, max: 5, label: '중증', level: 'high', recommendation: '입원, 3↑은 중환자 고려' },
    ],
  },
  {
    chartId: 'QSOFA', name: 'qSOFA (패혈증 빠른 선별)', category: '감염', archetype: 'scoring',
    sourceGuideline: 'Sepsis-3', sourceVersion: '2016', verified: false, range: '0-3',
    categories: [
      { key: 'mental', label: '의식 변화 (GCS<15)', options: yesNo(1) },
      { key: 'rr', label: '호흡수 ≥22 /min', options: yesNo(1) },
      { key: 'sbp', label: '수축기혈압 ≤100 mmHg', options: yesNo(1) },
    ],
    bands: [
      { min: 0, max: 1, label: '낮음', level: 'low' },
      { min: 2, max: 3, label: '패혈증 의심', level: 'high', recommendation: 'SOFA 정밀 평가·패혈증 번들 고려' },
    ],
  },
  {
    chartId: 'SIRS', name: 'SIRS 기준', category: '감염', archetype: 'scoring',
    sourceGuideline: 'ACCP/SCCM', sourceVersion: '1992', verified: false, range: '0-4',
    categories: [
      { key: 'temp', label: '체온 >38℃ 또는 <36℃', options: yesNo(1) },
      { key: 'hr', label: '맥박 >90 /min', options: yesNo(1) },
      { key: 'rr', label: '호흡수 >20 또는 PaCO₂<32', options: yesNo(1) },
      { key: 'wbc', label: '백혈구 >12k 또는 <4k 또는 미성숙>10%', options: yesNo(1) },
    ],
    bands: [
      { min: 0, max: 1, label: '음성', level: 'normal' },
      { min: 2, max: 4, label: 'SIRS', level: 'moderate', recommendation: '감염원 평가' },
    ],
  },

  /* ── 정신과 ── */
  {
    chartId: 'PHQ9', name: 'PHQ-9 (우울 선별)', category: '정신', archetype: 'scoring',
    sourceGuideline: 'Kroenke et al.', sourceVersion: '2001', verified: false, range: '0-27',
    note: '선별도구(진단 아님). 9번 항목 양성 시 추가 안전 평가 필요.',
    alertCategories: ['q9'],
    categories: ['관심·흥미 저하', '우울·절망감', '수면 문제', '피로·기력 저하', '식욕 문제', '자기 부정감', '집중 곤란', '정신운동 지연/초조', '자해·자살 사고']
      .map((label, i) => ({ key: i === 8 ? 'q9' : `q${i + 1}`, label: `${i + 1}. ${label}`, options: [
        { label: '전혀 없음', score: 0 }, { label: '며칠', score: 1 }, { label: '7일 이상', score: 2 }, { label: '거의 매일', score: 3 } ] })),
    bands: [
      { min: 0, max: 4, label: '없음/최소', level: 'normal' },
      { min: 5, max: 9, label: '경도', level: 'low' },
      { min: 10, max: 14, label: '중등도', level: 'moderate' },
      { min: 15, max: 19, label: '중등도-중증', level: 'high' },
      { min: 20, max: 27, label: '중증', level: 'critical' },
    ],
  },
  {
    chartId: 'GAD7', name: 'GAD-7 (불안 선별)', category: '정신', archetype: 'scoring',
    sourceGuideline: 'Spitzer et al.', sourceVersion: '2006', verified: false, range: '0-21',
    categories: ['긴장·불안', '걱정 조절 곤란', '여러 일 과도한 걱정', '안절부절', '쉬기 어려움', '쉽게 짜증', '나쁜 일 예감 두려움']
      .map((label, i) => ({ key: `q${i + 1}`, label: `${i + 1}. ${label}`, options: [
        { label: '전혀 없음', score: 0 }, { label: '며칠', score: 1 }, { label: '7일 이상', score: 2 }, { label: '거의 매일', score: 3 } ] })),
    bands: [
      { min: 0, max: 4, label: '최소', level: 'normal' },
      { min: 5, max: 9, label: '경도', level: 'low' },
      { min: 10, max: 14, label: '중등도', level: 'moderate' },
      { min: 15, max: 21, label: '중증', level: 'high' },
    ],
  },

  /* ── 마취/회복 ── */
  {
    chartId: 'ALDRETE', name: 'Aldrete Score (회복실 퇴실)', category: '마취', archetype: 'scoring',
    sourceGuideline: 'Aldrete', sourceVersion: '1995(modified)', verified: false, range: '0-10',
    note: '통상 ≥9 퇴실 가능.',
    categories: [
      { key: 'activity', label: '활동', options: [ { label: '사지 못 움직임', score: 0 }, { label: '2개 사지', score: 1 }, { label: '4개 사지', score: 2 } ] },
      { key: 'respiration', label: '호흡', options: [ { label: '무호흡', score: 0 }, { label: '호흡곤란/얕음', score: 1 }, { label: '깊은 호흡·기침 가능', score: 2 } ] },
      { key: 'circulation', label: '순환', options: [ { label: 'BP 기저±50 초과', score: 0 }, { label: '±20–50', score: 1 }, { label: '±20 이내', score: 2 } ] },
      { key: 'consciousness', label: '의식', options: [ { label: '무반응', score: 0 }, { label: '부르면 각성', score: 1 }, { label: '완전 각성', score: 2 } ] },
      { key: 'spo2', label: '산소포화', options: [ { label: '<90%(산소공급)', score: 0 }, { label: '산소공급 시 ≥90%', score: 1 }, { label: '실내공기 ≥92%', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 8, label: '회복 미흡', level: 'moderate', recommendation: '회복실 관찰 지속' },
      { min: 9, max: 10, label: '퇴실 가능', level: 'normal' },
    ],
  },

  /* ── 산과/신생아 ── */
  {
    chartId: 'APGAR', name: 'APGAR (신생아)', category: '산과/소아', archetype: 'scoring',
    sourceGuideline: 'Apgar', sourceVersion: '1953', verified: false, range: '0-10',
    note: '1분·5분에 측정.',
    categories: [
      { key: 'appearance', label: '외모(피부색)', options: [ { label: '청색/창백', score: 0 }, { label: '사지 청색', score: 1 }, { label: '전신 분홍', score: 2 } ] },
      { key: 'pulse', label: '맥박', options: [ { label: '없음', score: 0 }, { label: '<100', score: 1 }, { label: '≥100', score: 2 } ] },
      { key: 'grimace', label: '반사(자극반응)', options: [ { label: '없음', score: 0 }, { label: '찡그림', score: 1 }, { label: '기침·재채기', score: 2 } ] },
      { key: 'activity', label: '활동(근긴장)', options: [ { label: '늘어짐', score: 0 }, { label: '약간 굴곡', score: 1 }, { label: '활발', score: 2 } ] },
      { key: 'respiration', label: '호흡', options: [ { label: '없음', score: 0 }, { label: '약함·불규칙', score: 1 }, { label: '우렁참', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 3, label: '심한 곤란', level: 'critical', recommendation: '즉각 소생술' },
      { min: 4, max: 6, label: '중등도 곤란', level: 'moderate' },
      { min: 7, max: 10, label: '양호', level: 'normal' },
    ],
  },

  /* ── 간 ── */
  {
    chartId: 'CHILDPUGH', name: 'Child-Pugh (간경변 중증도)', category: '소화기', archetype: 'scoring',
    sourceGuideline: 'Pugh', sourceVersion: '1973', verified: false, range: '5-15',
    categories: [
      { key: 'bilirubin', label: '총 빌리루빈 (mg/dL)', options: [ { label: '<2', score: 1 }, { label: '2–3', score: 2 }, { label: '>3', score: 3 } ] },
      { key: 'albumin', label: '알부민 (g/dL)', options: [ { label: '>3.5', score: 1 }, { label: '2.8–3.5', score: 2 }, { label: '<2.8', score: 3 } ] },
      { key: 'inr', label: 'INR', options: [ { label: '<1.7', score: 1 }, { label: '1.7–2.3', score: 2 }, { label: '>2.3', score: 3 } ] },
      { key: 'ascites', label: '복수', options: [ { label: '없음', score: 1 }, { label: '경증', score: 2 }, { label: '중등도', score: 3 } ] },
      { key: 'encephalopathy', label: '간성뇌증', options: [ { label: '없음', score: 1 }, { label: 'Grade 1–2', score: 2 }, { label: 'Grade 3–4', score: 3 } ] },
    ],
    bands: [
      { min: 5, max: 6, label: 'A (경증)', level: 'low' },
      { min: 7, max: 9, label: 'B (중등)', level: 'moderate' },
      { min: 10, max: 15, label: 'C (중증)', level: 'high' },
    ],
  },

  /* ── 혈액 ── */
  {
    chartId: 'HIT4TS', name: 'HIT 4Ts Score (헤파린유발 혈소판감소증)', category: '혈액', archetype: 'scoring',
    sourceGuideline: 'Lo et al.', sourceVersion: '2006', verified: false, range: '0-8',
    categories: [
      { key: 'thrombocytopenia', label: 'Thrombocytopenia (감소 정도)', options: [ { label: '<30%', score: 0 }, { label: '30–50%', score: 1 }, { label: '>50%', score: 2 } ] },
      { key: 'timing', label: 'Timing (발생 시점)', options: [ { label: '부합 안 함', score: 0 }, { label: '모호', score: 1 }, { label: '5–10일 전형적', score: 2 } ] },
      { key: 'thrombosis', label: 'Thrombosis (혈전)', options: [ { label: '없음', score: 0 }, { label: '진행성·재발', score: 1 }, { label: '새 혈전·피부괴사', score: 2 } ] },
      { key: 'other', label: 'oTher (다른 원인)', options: [ { label: '명확', score: 0 }, { label: '가능', score: 1 }, { label: '없음', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 3, label: '낮음', level: 'low' },
      { min: 4, max: 5, label: '중간', level: 'moderate' },
      { min: 6, max: 8, label: '높음', level: 'high', recommendation: '헤파린 중단·대체 항응고·HIT 항체 검사' },
    ],
  },

  /* ── 영상(갑상선) — 점수합산형 ── */
  {
    chartId: 'TIRADS', name: 'ACR TI-RADS (갑상선 결절)', category: '영상', archetype: 'scoring',
    sourceGuideline: 'ACR TI-RADS', sourceVersion: '2017', verified: false, range: '0-17',
    note: 'TR등급별 FNA/추적 크기 기준은 별도 — 결절 크기와 함께 판단.',
    categories: [
      { key: 'composition', label: '구성(Composition)', options: [
        { label: '낭성/거의 낭성', score: 0 }, { label: '해면상', score: 0 }, { label: '혼합 낭성-고형', score: 1 }, { label: '고형/거의 고형', score: 2 } ] },
      { key: 'echogenicity', label: '에코(Echogenicity)', options: [
        { label: '무에코', score: 0 }, { label: '고·등에코', score: 1 }, { label: '저에코', score: 2 }, { label: '현저한 저에코', score: 3 } ] },
      { key: 'shape', label: '모양(Shape)', options: [
        { label: '가로>세로', score: 0 }, { label: '세로>가로', score: 3 } ] },
      { key: 'margin', label: '경계(Margin)', options: [
        { label: '매끈', score: 0 }, { label: '불명확', score: 0 }, { label: '분엽·불규칙', score: 2 }, { label: '갑상선외 침범', score: 3 } ] },
      { key: 'foci', label: '에코발생 병소(Echogenic foci)', options: [
        { label: '없음/혜성꼬리', score: 0 }, { label: '거대 석회', score: 1 }, { label: '변연 석회', score: 2 }, { label: '점상 고에코', score: 3 } ] },
    ],
    bands: [
      { min: 0, max: 1, label: 'TR1 (양성)', level: 'normal', recommendation: 'FNA 불필요' },
      { min: 2, max: 2, label: 'TR2 (양성 추정)', level: 'low', recommendation: 'FNA 불필요' },
      { min: 3, max: 3, label: 'TR3 (경도 의심)', level: 'moderate', recommendation: '≥2.5cm FNA / ≥1.5cm 추적' },
      { min: 4, max: 6, label: 'TR4 (중등도 의심)', level: 'high', recommendation: '≥1.5cm FNA / ≥1cm 추적' },
      { min: 7, max: 17, label: 'TR5 (고도 의심)', level: 'critical', recommendation: '≥1cm FNA / ≥0.5cm 추적' },
    ],
  },

  /* ── 신경 (뇌졸중 중증도) ── */
  {
    chartId: 'NIHSS', name: 'NIHSS (뇌졸중 중증도)', category: '신경', archetype: 'scoring',
    sourceGuideline: 'NIH Stroke Scale', sourceVersion: '', verified: false, range: '0-42',
    note: 'ASPECTS·재관류(TICI)와 함께 stroke 워크플로. 표준 15항목.',
    categories: [
      { key: '1a', label: '1a. 의식수준', options: [ { label: '0 명료', score: 0 }, { label: '1 졸림', score: 1 }, { label: '2 혼미', score: 2 }, { label: '3 혼수', score: 3 } ] },
      { key: '1b', label: '1b. 의식수준 질문(월·나이)', options: [ { label: '0 둘 다 정확', score: 0 }, { label: '1 하나', score: 1 }, { label: '2 없음', score: 2 } ] },
      { key: '1c', label: '1c. 명령 수행(개안·악수)', options: [ { label: '0 둘 다', score: 0 }, { label: '1 하나', score: 1 }, { label: '2 없음', score: 2 } ] },
      { key: '2', label: '2. 응시', options: [ { label: '0 정상', score: 0 }, { label: '1 부분마비', score: 1 }, { label: '2 완전편향', score: 2 } ] },
      { key: '3', label: '3. 시야', options: [ { label: '0 정상', score: 0 }, { label: '1 부분반맹', score: 1 }, { label: '2 완전반맹', score: 2 }, { label: '3 양측반맹', score: 3 } ] },
      { key: '4', label: '4. 안면마비', options: [ { label: '0 정상', score: 0 }, { label: '1 경미', score: 1 }, { label: '2 부분', score: 2 }, { label: '3 완전', score: 3 } ] },
      { key: '5a', label: '5a. 좌측 상지 운동', options: [ { label: '0 무낙하', score: 0 }, { label: '1 낙하', score: 1 }, { label: '2 중력저항', score: 2 }, { label: '3 중력불가', score: 3 }, { label: '4 움직임 없음', score: 4 } ] },
      { key: '5b', label: '5b. 우측 상지 운동', options: [ { label: '0 무낙하', score: 0 }, { label: '1 낙하', score: 1 }, { label: '2 중력저항', score: 2 }, { label: '3 중력불가', score: 3 }, { label: '4 움직임 없음', score: 4 } ] },
      { key: '6a', label: '6a. 좌측 하지 운동', options: [ { label: '0 무낙하', score: 0 }, { label: '1 낙하', score: 1 }, { label: '2 중력저항', score: 2 }, { label: '3 중력불가', score: 3 }, { label: '4 움직임 없음', score: 4 } ] },
      { key: '6b', label: '6b. 우측 하지 운동', options: [ { label: '0 무낙하', score: 0 }, { label: '1 낙하', score: 1 }, { label: '2 중력저항', score: 2 }, { label: '3 중력불가', score: 3 }, { label: '4 움직임 없음', score: 4 } ] },
      { key: '7', label: '7. 사지운동실조', options: [ { label: '0 없음', score: 0 }, { label: '1 한 사지', score: 1 }, { label: '2 두 사지', score: 2 } ] },
      { key: '8', label: '8. 감각', options: [ { label: '0 정상', score: 0 }, { label: '1 경미-중등', score: 1 }, { label: '2 중증', score: 2 } ] },
      { key: '9', label: '9. 언어', options: [ { label: '0 정상', score: 0 }, { label: '1 경미-중등 실어', score: 1 }, { label: '2 중증 실어', score: 2 }, { label: '3 무언/전실어', score: 3 } ] },
      { key: '10', label: '10. 구음장애', options: [ { label: '0 정상', score: 0 }, { label: '1 경미-중등', score: 1 }, { label: '2 중증', score: 2 } ] },
      { key: '11', label: '11. 소거·무시', options: [ { label: '0 없음', score: 0 }, { label: '1 한 영역', score: 1 }, { label: '2 두 영역', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 0, label: '증상 없음', level: 'normal' },
      { min: 1, max: 4, label: '경증', level: 'low' },
      { min: 5, max: 15, label: '중등도', level: 'moderate' },
      { min: 16, max: 20, label: '중등도-중증', level: 'high' },
      { min: 21, max: 42, label: '중증', level: 'critical' },
    ],
  },

  /* ── 혈전 ── */
  {
    chartId: 'WELLS_DVT', name: 'Wells Score (DVT 가능성)', category: '심혈관', archetype: 'scoring',
    sourceGuideline: 'Wells', sourceVersion: '', verified: false, range: '-2 ~ 9',
    categories: [
      { key: 'cancer', label: '활동성 암(6개월 내 치료/완화)', options: yesNo(1) },
      { key: 'paralysis', label: '마비/최근 석고고정', options: yesNo(1) },
      { key: 'bedridden', label: '최근 침상 ≥3일/대수술 4주 내', options: yesNo(1) },
      { key: 'tenderness', label: '심부정맥 분포 국소 압통', options: yesNo(1) },
      { key: 'swelling_leg', label: '전체 다리 부종', options: yesNo(1) },
      { key: 'calf', label: '종아리 둘레차 >3cm', options: yesNo(1) },
      { key: 'pitting', label: '증상다리 함요부종', options: yesNo(1) },
      { key: 'collateral', label: '표재정맥 측부순환(정맥류 아님)', options: yesNo(1) },
      { key: 'prior_dvt', label: 'DVT 과거력', options: yesNo(1) },
      { key: 'alt_dx', label: '대체 진단 가능성 ≥ DVT', options: [ { label: '아니오', score: 0 }, { label: '예', score: -2 } ] },
    ],
    bands: [
      { min: -2, max: 0, label: '낮음', level: 'low', recommendation: 'D-dimer 음성 시 배제' },
      { min: 1, max: 2, label: '중간', level: 'moderate' },
      { min: 3, max: 9, label: '높음', level: 'high', recommendation: '초음파 권고' },
    ],
  },

  /* ── 산과 ── */
  {
    chartId: 'BISHOP', name: 'Bishop Score (분만 유도 적합성)', category: '산과', archetype: 'scoring',
    sourceGuideline: 'Bishop', sourceVersion: '1964', verified: false, range: '0-13',
    categories: [
      { key: 'dilation', label: '경부 개대(cm)', options: [ { label: '0', score: 0 }, { label: '1–2', score: 1 }, { label: '3–4', score: 2 }, { label: '≥5', score: 3 } ] },
      { key: 'effacement', label: '소실(%)', options: [ { label: '0–30', score: 0 }, { label: '40–50', score: 1 }, { label: '60–70', score: 2 }, { label: '≥80', score: 3 } ] },
      { key: 'station', label: '태아 하강도', options: [ { label: '-3', score: 0 }, { label: '-2', score: 1 }, { label: '-1/0', score: 2 }, { label: '+1/+2', score: 3 } ] },
      { key: 'consistency', label: '경도(consistency)', options: [ { label: '단단', score: 0 }, { label: '중간', score: 1 }, { label: '부드러움', score: 2 } ] },
      { key: 'position', label: '경부 위치', options: [ { label: '후방', score: 0 }, { label: '중간', score: 1 }, { label: '전방', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 5, label: '불리(유도 성공 낮음)', level: 'moderate' },
      { min: 6, max: 7, label: '중간', level: 'low' },
      { min: 8, max: 13, label: '유리(유도 성공 높음)', level: 'normal' },
    ],
  },

  /* ── 노인 기능 (높을수록 자립) ── */
  {
    chartId: 'BARTHEL', name: 'Barthel Index (일상생활수행, ADL)', category: '노인/재활', archetype: 'scoring',
    sourceGuideline: 'Mahoney & Barthel', sourceVersion: '1965', verified: false, range: '0-100',
    note: '점수 높을수록 자립.',
    categories: [
      { key: 'feeding', label: '식사', options: [ { label: '0 불가', score: 0 }, { label: '5 도움', score: 5 }, { label: '10 자립', score: 10 } ] },
      { key: 'transfer', label: '이동(침대-의자)', options: [ { label: '0 불가', score: 0 }, { label: '5 많은 도움', score: 5 }, { label: '10 약간 도움', score: 10 }, { label: '15 자립', score: 15 } ] },
      { key: 'grooming', label: '개인위생', options: [ { label: '0 도움', score: 0 }, { label: '5 자립', score: 5 } ] },
      { key: 'toilet', label: '화장실 사용', options: [ { label: '0 불가', score: 0 }, { label: '5 도움', score: 5 }, { label: '10 자립', score: 10 } ] },
      { key: 'bathing', label: '목욕', options: [ { label: '0 도움', score: 0 }, { label: '5 자립', score: 5 } ] },
      { key: 'mobility', label: '보행', options: [ { label: '0 불가', score: 0 }, { label: '5 휠체어', score: 5 }, { label: '10 도움 보행', score: 10 }, { label: '15 자립', score: 15 } ] },
      { key: 'stairs', label: '계단', options: [ { label: '0 불가', score: 0 }, { label: '5 도움', score: 5 }, { label: '10 자립', score: 10 } ] },
      { key: 'dressing', label: '옷 입기', options: [ { label: '0 불가', score: 0 }, { label: '5 도움', score: 5 }, { label: '10 자립', score: 10 } ] },
      { key: 'bowels', label: '배변 조절', options: [ { label: '0 실금', score: 0 }, { label: '5 가끔', score: 5 }, { label: '10 정상', score: 10 } ] },
      { key: 'bladder', label: '배뇨 조절', options: [ { label: '0 실금', score: 0 }, { label: '5 가끔', score: 5 }, { label: '10 정상', score: 10 } ] },
    ],
    bands: [
      { min: 0, max: 20, label: '완전 의존', level: 'critical' },
      { min: 21, max: 60, label: '심한 의존', level: 'high' },
      { min: 61, max: 90, label: '중등도 의존', level: 'moderate' },
      { min: 91, max: 99, label: '경도 의존', level: 'low' },
      { min: 100, max: 100, label: '자립', level: 'normal' },
    ],
  },
  {
    chartId: 'LAWTON', name: 'Lawton IADL (도구적 일상생활)', category: '노인/재활', archetype: 'scoring',
    sourceGuideline: 'Lawton & Brody', sourceVersion: '1969', verified: false, range: '0-8',
    note: '점수 높을수록 자립. Barthel(기본 ADL)과 짝.',
    categories: ['전화 사용', '쇼핑', '음식 준비', '가사', '세탁', '교통수단 이용', '투약 관리', '재정 관리']
      .map((label, i) => ({ key: `i${i + 1}`, label, options: [ { label: '의존', score: 0 }, { label: '자립', score: 1 } ] })),
    bands: [
      { min: 0, max: 2, label: '높은 의존', level: 'high' },
      { min: 3, max: 5, label: '중등도', level: 'moderate' },
      { min: 6, max: 8, label: '자립', level: 'normal' },
    ],
  },

  /* ── 류마티스/혈액 ── */
  {
    chartId: 'RA_ACR_EULAR', name: 'RA 분류 기준 (2010 ACR/EULAR)', category: '류마티스', archetype: 'scoring',
    sourceGuideline: 'ACR/EULAR', sourceVersion: '2010', verified: false, range: '0-10',
    note: '대상=활막염 ≥1관절·다른 원인 배제. 합산 ≥6 → 명백한 RA 분류.',
    categories: [
      { key: 'joints', label: '관절 침범', options: [ { label: '1 큰 관절', score: 0 }, { label: '2–10 큰 관절', score: 1 }, { label: '1–3 작은 관절', score: 2 }, { label: '4–10 작은 관절', score: 3 }, { label: '>10 (≥1 작은)', score: 5 } ] },
      { key: 'serology', label: '혈청학 (RF/항CCP)', options: [ { label: '둘 다 음성', score: 0 }, { label: '낮은 양성', score: 2 }, { label: '높은 양성', score: 3 } ] },
      { key: 'apr', label: '급성기 반응물질 (ESR/CRP)', options: [ { label: '정상', score: 0 }, { label: '상승', score: 1 } ] },
      { key: 'duration', label: '증상 지속 기간', options: [ { label: '<6주', score: 0 }, { label: '≥6주', score: 1 } ] },
    ],
    bands: [
      { min: 0, max: 5, label: '미충족', level: 'low' },
      { min: 6, max: 10, label: '명백한 RA', level: 'high' },
    ],
  },
  {
    chartId: 'DIC_ISTH', name: 'DIC Score (ISTH, 명백한 DIC)', category: '혈액', archetype: 'scoring',
    sourceGuideline: 'ISTH', sourceVersion: '2001', verified: false, range: '0-8',
    note: '기저 질환(DIC 연관) 전제. ≥5 → 명백한 DIC 부합.',
    categories: [
      { key: 'platelet', label: '혈소판 (/µL)', options: [ { label: '≥100k', score: 0 }, { label: '50–100k', score: 1 }, { label: '<50k', score: 2 } ] },
      { key: 'fibrin', label: '피브린 마커 (D-dimer 등)', options: [ { label: '증가 없음', score: 0 }, { label: '중등도 증가', score: 2 }, { label: '현저한 증가', score: 3 } ] },
      { key: 'pt', label: 'PT 연장', options: [ { label: '<3초', score: 0 }, { label: '3–6초', score: 1 }, { label: '>6초', score: 2 } ] },
      { key: 'fibrinogen', label: '피브리노겐', options: [ { label: '≥1.0 g/L', score: 0 }, { label: '<1.0 g/L', score: 1 } ] },
    ],
    bands: [
      { min: 0, max: 4, label: '비명백 DIC', level: 'moderate', recommendation: '의심 시 1–2일 후 재평가' },
      { min: 5, max: 8, label: '명백한 DIC', level: 'critical' },
    ],
  },

  /* ── 중독/금단 ── */
  {
    chartId: 'CIWA_AR', name: 'CIWA-Ar (알코올 금단)', category: '중독', archetype: 'scoring',
    sourceGuideline: 'CIWA-Ar', sourceVersion: '1989', verified: false, range: '0-67',
    note: '증상기반 투약 프로토콜의 표준 척도. 지남력 항목만 0–4, 나머지 0–7.',
    categories: [
      ...['오심·구토', '진전', '발한', '불안', '초조', '촉각 장애', '청각 장애', '시각 장애', '두통']
        .map((label) => ({ key: label, label, options: Array.from({ length: 8 }, (_, i) => ({ label: String(i), score: i })) })),
      { key: '지남력', label: '지남력·의식 흐림', options: Array.from({ length: 5 }, (_, i) => ({ label: String(i), score: i })) },
    ],
    bands: [
      { min: 0, max: 9, label: '경증', level: 'low', recommendation: '약물 불필요·모니터' },
      { min: 10, max: 18, label: '중등도', level: 'moderate', recommendation: '증상기반 약물요법 고려' },
      { min: 19, max: 67, label: '중증', level: 'high', recommendation: '적극 약물요법·경련/섬망 위험' },
    ],
  },

  /* ── 음주 선별 ── */
  {
    chartId: 'AUDIT', name: 'AUDIT (음주 선별)', category: '정신', archetype: 'scoring',
    sourceGuideline: 'WHO AUDIT', sourceVersion: '', verified: false, range: '0-40',
    note: '국내 별도 절단점 사용 가능(한국판 AUDIT). 선별도구(진단 아님).',
    categories: [
      ...['음주 빈도', '1회 음주량', '폭음 빈도(6잔+)', '중단 불능 빈도', '역할 실패 빈도', '해장술 빈도', '죄책감 빈도', '기억상실 빈도']
        .map((label, i) => ({ key: `q${i + 1}`, label: `${i + 1}. ${label}`, options: [
          { label: '0', score: 0 }, { label: '1', score: 1 }, { label: '2', score: 2 }, { label: '3', score: 3 }, { label: '4', score: 4 } ] })),
      { key: 'q9', label: '9. 음주로 인한 상해 (본인/타인)', options: [ { label: '없음', score: 0 }, { label: '있으나 지난 1년 아님', score: 2 }, { label: '지난 1년 내', score: 4 } ] },
      { key: 'q10', label: '10. 주변의 절주 권고', options: [ { label: '없음', score: 0 }, { label: '있으나 지난 1년 아님', score: 2 }, { label: '지난 1년 내', score: 4 } ] },
    ],
    bands: [
      { min: 0, max: 7, label: '저위험', level: 'normal' },
      { min: 8, max: 15, label: '위험 음주', level: 'moderate', recommendation: '단순 조언(brief advice)' },
      { min: 16, max: 19, label: '유해 음주', level: 'high', recommendation: '상담·모니터링' },
      { min: 20, max: 40, label: '알코올 의존 의심', level: 'critical', recommendation: '전문 평가·치료 의뢰' },
    ],
  },
  {
    chartId: 'CAGE', name: 'CAGE (알코올 문제 선별)', category: '정신', archetype: 'scoring',
    sourceGuideline: 'Ewing', sourceVersion: '1984', verified: false, range: '0-4',
    categories: [
      { key: 'cut', label: 'C — 절주 필요성을 느낀 적', options: yesNo(1) },
      { key: 'annoyed', label: 'A — 음주 비난에 짜증난 적', options: yesNo(1) },
      { key: 'guilty', label: 'G — 음주에 죄책감을 느낀 적', options: yesNo(1) },
      { key: 'eye', label: 'E — 해장술(아침 음주)을 마신 적', options: yesNo(1) },
    ],
    bands: [
      { min: 0, max: 1, label: '음성', level: 'normal' },
      { min: 2, max: 4, label: '알코올 문제 의심', level: 'high', recommendation: '정밀 평가(AUDIT 등)' },
    ],
  },

  /* ── 인지 ── */
  {
    chartId: 'MMSE', name: 'MMSE (간이정신상태검사)', category: '정신', archetype: 'scoring',
    sourceGuideline: 'Folstein', sourceVersion: '1975', verified: false, range: '0-30',
    note: '절단점은 연령·교육수준 보정 필요 — 국내는 K-MMSE 규준 사용. 영역별 획득 점수를 선택.',
    categories: [
      { key: 'orientation_time', label: '지남력 — 시간 (0-5)', options: Array.from({ length: 6 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'orientation_place', label: '지남력 — 장소 (0-5)', options: Array.from({ length: 6 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'registration', label: '기억 등록 (0-3)', options: Array.from({ length: 4 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'attention', label: '주의·계산 (0-5)', options: Array.from({ length: 6 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'recall', label: '회상 (0-3)', options: Array.from({ length: 4 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'language', label: '언어 (0-8)', options: Array.from({ length: 9 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'construction', label: '시공간 구성 (0-1)', options: [ { label: '0', score: 0 }, { label: '1', score: 1 } ] },
    ],
    bands: [
      { min: 24, max: 30, label: '정상 범위', level: 'normal' },
      { min: 18, max: 23, label: '경도 인지저하 의심', level: 'moderate', recommendation: '정밀 인지평가 고려' },
      { min: 0, max: 17, label: '중등도 이상 인지저하 의심', level: 'high', recommendation: '정밀 평가·치매 검사 의뢰' },
    ],
  },
  {
    chartId: 'MINICOG', name: 'Mini-Cog (간이 인지선별)', category: '노인', archetype: 'scoring',
    sourceGuideline: 'Borson', sourceVersion: '', verified: false, range: '0-5',
    note: '양성 시 정밀검사(MMSE/MoCA) 연계.',
    categories: [
      { key: 'recall', label: '3단어 회상 (0-3)', options: Array.from({ length: 4 }, (_, i) => ({ label: String(i), score: i })) },
      { key: 'clock', label: '시계 그리기', options: [ { label: '비정상 (0)', score: 0 }, { label: '정상 (2)', score: 2 } ] },
    ],
    bands: [
      { min: 0, max: 2, label: '치매 선별 양성', level: 'high', recommendation: '정밀 인지평가(MMSE/MoCA) 의뢰' },
      { min: 3, max: 5, label: '음성', level: 'normal' },
    ],
  },
];
