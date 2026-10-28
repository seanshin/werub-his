/**
 * Lookup 콘텐츠 — 종양 수행능력·반응평가·노인기능·발달
 * 출처: clinical-charts 01·11 문서.
 * ⚠️ verified=false — 공식 원문(CTCAE·RECIST 1.1 등) 대조 필수. 보조도구·최종판단 의사 귀속.
 */
import type { LookupDef } from '../types';

export const LOOKUP_ONC_FN_DEFS: LookupDef[] = [
  {
    chartId: 'ECOG', name: 'ECOG Performance Status', category: '종양', archetype: 'lookup',
    sourceGuideline: 'ECOG', sourceVersion: '', verified: false, inputLabel: '점수',
    options: [
      { code: '0', label: '0 — 완전 활동(제한 없음)', level: 'normal' },
      { code: '1', label: '1 — 격렬한 활동 제한, 가벼운 작업 가능', level: 'low' },
      { code: '2', label: '2 — 거동·자가관리 가능, 작업 불가(각성 50%+ 활동)', level: 'moderate' },
      { code: '3', label: '3 — 제한된 자가관리(각성 50%+ 침상)', level: 'high' },
      { code: '4', label: '4 — 완전 비활동·전적 침상', level: 'critical' },
      { code: '5', label: '5 — 사망', level: 'critical' },
    ],
  },
  {
    chartId: 'KPS', name: 'Karnofsky Performance Status (KPS)', category: '종양', archetype: 'lookup',
    sourceGuideline: 'Karnofsky', sourceVersion: '', verified: false, inputLabel: '점수',
    options: [
      { code: '100', label: '100 — 정상, 증상 없음', level: 'normal' },
      { code: '90', label: '90 — 정상 활동, 경미한 증상', level: 'normal' },
      { code: '80', label: '80 — 노력 시 정상 활동', level: 'low' },
      { code: '70', label: '70 — 자가관리 가능, 작업 불가', level: 'low' },
      { code: '60', label: '60 — 때때로 도움 필요', level: 'moderate' },
      { code: '50', label: '50 — 상당한 도움·잦은 의료', level: 'moderate' },
      { code: '40', label: '40 — 거동 불가, 특별 돌봄', level: 'high' },
      { code: '30', label: '30 — 심한 거동 불가, 입원 적응', level: 'high' },
      { code: '20', label: '20 — 매우 위중, 적극 지지', level: 'critical' },
      { code: '10', label: '10 — 임종 임박', level: 'critical' },
      { code: '0', label: '0 — 사망', level: 'critical' },
    ],
  },
  {
    chartId: 'CTCAE', name: 'CTCAE 일반 등급 (이상반응)', category: '종양', archetype: 'lookup',
    sourceGuideline: 'NCI CTCAE', sourceVersion: 'v5.0', verified: false, inputLabel: 'Grade',
    note: '항목별(혈액학·소화기 등) 세부 기준은 별도 — CTCAE 원문 참조.',
    options: [
      { code: '1', label: 'Grade 1 — 경증(무증상/경미, 중재 불필요)', level: 'low' },
      { code: '2', label: 'Grade 2 — 중등도(국소·비침습 중재)', level: 'moderate' },
      { code: '3', label: 'Grade 3 — 중증(입원/자가관리 제한)', level: 'high' },
      { code: '4', label: 'Grade 4 — 생명위협(긴급 중재)', level: 'critical' },
      { code: '5', label: 'Grade 5 — 사망', level: 'critical' },
    ],
  },
  {
    chartId: 'RECIST', name: 'RECIST 1.1 치료반응 (target lesions)', category: '종양', archetype: 'lookup',
    sourceGuideline: 'RECIST WG', sourceVersion: '1.1', verified: false, inputLabel: '반응 범주',
    options: [
      { code: 'CR', label: 'CR — 완전반응(모든 target 소실)', level: 'normal' },
      { code: 'PR', label: 'PR — 부분반응(직경합 ≥30% 감소)', level: 'low' },
      { code: 'SD', label: 'SD — 안정(PR·PD 미충족)', level: 'moderate' },
      { code: 'PD', label: 'PD — 진행(최소합 대비 ≥20%↑·≥5mm 또는 신규병변)', level: 'high' },
    ],
  },
  {
    chartId: 'FRAILTY', name: 'Clinical Frailty Scale (임상 노쇠)', category: '노인', archetype: 'lookup',
    sourceGuideline: 'Rockwood CFS', sourceVersion: '', verified: false, inputLabel: '점수',
    options: [
      { code: '1', label: '1 — 매우 건강', level: 'normal' },
      { code: '2', label: '2 — 건강', level: 'normal' },
      { code: '3', label: '3 — 양호하게 관리됨', level: 'low' },
      { code: '4', label: '4 — 취약(증상 있으나 의존 없음)', level: 'low' },
      { code: '5', label: '5 — 경도 노쇠', level: 'moderate' },
      { code: '6', label: '6 — 중등도 노쇠', level: 'moderate' },
      { code: '7', label: '7 — 중증 노쇠', level: 'high' },
      { code: '8', label: '8 — 매우 중증 노쇠', level: 'high' },
      { code: '9', label: '9 — 말기', level: 'critical' },
    ],
  },
  {
    chartId: 'TANNER', name: 'Tanner 분류 (사춘기 성숙도)', category: '소아', archetype: 'lookup',
    sourceGuideline: 'Tanner', sourceVersion: '', verified: false, inputLabel: '단계',
    options: [
      { code: 'I', label: 'I — 사춘기 전', level: 'normal' },
      { code: 'II', label: 'II — 발현 초기', level: 'normal' },
      { code: 'III', label: 'III — 진행', level: 'normal' },
      { code: 'IV', label: 'IV — 거의 성숙', level: 'normal' },
      { code: 'V', label: 'V — 성인형', level: 'normal' },
    ],
  },
];
