/**
 * Criteria 아키타입 콘텐츠 (기준 충족 여부 → 불린 판정)
 * 출처: clinical-charts 03·08 문서.
 * ⚠️ verified=false — 공식 원문 대조 필수. 보조도구·최종판단 의사 귀속.
 */
import type { CriteriaDef } from '../types';

export const CRITERIA_DEFS: CriteriaDef[] = [
  {
    chartId: 'CAM_ICU', name: 'CAM-ICU (중환자 섬망 평가)', category: '중환자', archetype: 'criteria',
    sourceGuideline: 'CAM-ICU', sourceVersion: '', verified: false,
    note: 'RASS 진정-각성 평가와 연계. 특징1 그리고 2 양성 + (특징3 또는 4 양성) → 섬망 양성.',
    items: [
      { key: 'f1', label: '특징 1 — 정신상태의 급성 변화 또는 24시간 내 변동' },
      { key: 'f2', label: '특징 2 — 부주의 (주의력 검사 오류, 예: SAVEAHAART)' },
      { key: 'f3', label: '특징 3 — 의식 수준 변화 (RASS ≠ 0)' },
      { key: 'f4', label: '특징 4 — 비조직적 사고 (비논리적 질문·명령 수행 오류)' },
    ],
    expr: 'f1 AND f2 AND (f3 OR f4)',
    positive: { label: '섬망 양성', level: 'high', recommendation: '섬망 프로토콜(원인 교정·비약물 중재) 적용·재평가' },
    negative: { label: '섬망 음성', level: 'normal' },
  },
  {
    chartId: 'DKA_CRITERIA', name: 'DKA 진단 기준 (당뇨병성 케톤산증)', category: '내분비', archetype: 'criteria',
    sourceGuideline: 'ADA', sourceVersion: '', verified: false,
    note: 'HHS와 감별(HHS: 혈당>600·pH>7.3·삼투압>320·케톤 미미). 전 항목 충족 시 부합.',
    items: [
      { key: 'glucose', label: '혈당 > 250 mg/dL' },
      { key: 'ph', label: '동맥 pH < 7.3' },
      { key: 'bicarb', label: '중탄산 < 18 mEq/L' },
      { key: 'ketone', label: '케톤 양성 (중등도 이상)' },
    ],
    expr: 'glucose AND ph AND bicarb AND ketone',
    positive: { label: 'DKA 부합', level: 'critical', recommendation: '수액·인슐린·전해질(K) 프로토콜, 유발 원인 탐색' },
    negative: { label: '기준 미충족', level: 'low', recommendation: '항목 재확인·HHS 감별' },
  },
  {
    chartId: 'HHS_CRITERIA', name: 'HHS 진단 기준 (고삼투압성 고혈당 상태)', category: '내분비', archetype: 'criteria',
    sourceGuideline: 'ADA', sourceVersion: '', verified: false,
    note: 'DKA와 감별(DKA: pH<7.3·케톤 양성). 전 항목 충족 시 부합.',
    items: [
      { key: 'glucose', label: '혈당 > 600 mg/dL' },
      { key: 'ph', label: '동맥 pH > 7.3' },
      { key: 'bicarb', label: '중탄산 > 18 mEq/L' },
      { key: 'osm', label: '혈장 유효삼투압 > 320 mOsm/kg' },
      { key: 'ketone', label: '케톤 미미/음성' },
    ],
    expr: 'glucose AND ph AND bicarb AND osm AND ketone',
    positive: { label: 'HHS 부합', level: 'critical', recommendation: '적극 수액·삼투압 교정 속도 관리·의식 모니터' },
    negative: { label: '기준 미충족', level: 'low', recommendation: '항목 재확인·DKA 감별' },
  },
];
