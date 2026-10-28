/**
 * Lookup 아키타입 콘텐츠 (소견 선택 → 카테고리/등급 직접 매핑)
 * 출처: clinical-charts 02·06·09 문서.
 * ⚠️ verified=false — 공식 가이드라인(ACR 등) 원문 대조 필수. 보조도구·최종판단 의사 귀속.
 */
import type { LookupDef } from '../types';

export const LOOKUP_DEFS: LookupDef[] = [
  {
    chartId: 'BIRADS', name: 'BI-RADS (유방 판독)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR BI-RADS', sourceVersion: '5th ed', verified: false, inputLabel: '범주',
    options: [
      { code: '0', label: '0 — 불완전(추가검사 필요)', level: 'moderate', attribute: '—', recommendation: '추가 영상검사 / 이전영상 비교' },
      { code: '1', label: '1 — 음성', level: 'normal', attribute: '0%', recommendation: '정기 검진' },
      { code: '2', label: '2 — 양성', level: 'normal', attribute: '0%', recommendation: '정기 검진' },
      { code: '3', label: '3 — 양성 추정', level: 'low', attribute: '≤2%', recommendation: '단기 추적(6개월)' },
      { code: '4A', label: '4A — 낮은 의심', level: 'moderate', attribute: '2–10%', recommendation: '조직검사 고려' },
      { code: '4B', label: '4B — 중등도 의심', level: 'high', attribute: '10–50%', recommendation: '조직검사 고려' },
      { code: '4C', label: '4C — 높은 의심', level: 'high', attribute: '50–95%', recommendation: '조직검사' },
      { code: '5', label: '5 — 악성 강력 시사', level: 'critical', attribute: '≥95%', recommendation: '조직검사·치료' },
      { code: '6', label: '6 — 조직검사 확인 악성', level: 'critical', attribute: '—', recommendation: '치료' },
    ],
  },
  {
    chartId: 'BOSNIAK', name: 'Bosniak 분류 (신장 낭종)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Bosniak', sourceVersion: '2019', verified: false, inputLabel: '범주',
    options: [
      { code: 'I', label: 'I — 단순 낭종', level: 'normal', attribute: '무시 가능', recommendation: '추적 불필요' },
      { code: 'II', label: 'II — 얇은 격막/미세석회', level: 'low', attribute: '매우 낮음', recommendation: '추적 불필요' },
      { code: 'IIF', label: 'IIF — 다수 격막/약간 두꺼움', level: 'moderate', attribute: '낮음', recommendation: '영상 추적' },
      { code: 'III', label: 'III — 두껍거나 불규칙한 격막·조영증강', level: 'high', attribute: '중간', recommendation: '수술/적극 고려' },
      { code: 'IV', label: 'IV — 조영증강 연부조직 결절', level: 'critical', attribute: '높음', recommendation: '수술' },
    ],
  },
  {
    chartId: 'NYHA', name: 'NYHA 심부전 기능 분류', category: '심혈관', archetype: 'lookup',
    sourceGuideline: 'NYHA', sourceVersion: '1994', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 일상 활동 시 증상 없음', level: 'low' },
      { code: 'II', label: 'II — 일상 활동 시 경도 증상', level: 'moderate' },
      { code: 'III', label: 'III — 경미한 활동에도 증상, 휴식 시 편안', level: 'high' },
      { code: 'IV', label: 'IV — 휴식 시에도 증상', level: 'critical' },
    ],
  },
  {
    chartId: 'KILLIP', name: 'Killip 분류 (급성 심근경색)', category: '심혈관', archetype: 'lookup',
    sourceGuideline: 'Killip & Kimball', sourceVersion: '1967', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 심부전 징후 없음', level: 'low', attribute: '사망률 낮음' },
      { code: 'II', label: 'II — 수포음·S3·정맥울혈', level: 'moderate', attribute: '중간' },
      { code: 'III', label: 'III — 폐부종', level: 'high', attribute: '높음' },
      { code: 'IV', label: 'IV — 심인성 쇼크', level: 'critical', attribute: '매우 높음' },
    ],
  },
  {
    chartId: 'PRESSURE_ULCER', name: '욕창 단계 (NPUAP/EPUAP)', category: '간호', archetype: 'lookup',
    sourceGuideline: 'NPUAP/EPUAP/NPIAP', sourceVersion: '2016', verified: false, inputLabel: '단계',
    options: [
      { code: '1', label: '1단계 — 비창백성 발적', level: 'low' },
      { code: '2', label: '2단계 — 부분층 손실(진피 노출)', level: 'moderate' },
      { code: '3', label: '3단계 — 전층 손실(피하지방)', level: 'high' },
      { code: '4', label: '4단계 — 전층 손실(뼈·건·근육 노출)', level: 'critical' },
      { code: 'U', label: '미분류(Unstageable)', level: 'high' },
      { code: 'DTI', label: '심부조직손상(DTI)', level: 'high' },
    ],
  },
  {
    chartId: 'BRISTOL', name: 'Bristol Stool Chart (대변 형태)', category: '소화기', archetype: 'lookup',
    sourceGuideline: 'Bristol', sourceVersion: '1997', verified: false, inputLabel: '유형',
    options: [
      { code: '1', label: '1 — 분리된 단단한 덩어리', level: 'moderate', attribute: '심한 변비' },
      { code: '2', label: '2 — 소시지형·울퉁불퉁', level: 'low', attribute: '경도 변비' },
      { code: '3', label: '3 — 소시지형·표면 균열', level: 'normal', attribute: '정상' },
      { code: '4', label: '4 — 매끈한 소시지/뱀형', level: 'normal', attribute: '정상(이상적)' },
      { code: '5', label: '5 — 부드러운 덩어리, 경계 명확', level: 'low', attribute: '섬유 부족' },
      { code: '6', label: '6 — 흐물한 조각, 경계 불명확', level: 'moderate', attribute: '경도 설사' },
      { code: '7', label: '7 — 완전 액상', level: 'high', attribute: '설사' },
    ],
  },
];
