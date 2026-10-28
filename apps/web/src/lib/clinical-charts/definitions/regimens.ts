/**
 * Tree 아키타입 콘텐츠 — 항암 레지멘 (레지멘→주기→약물라인→전처치/지지요법)
 * 출처: clinical-charts 01·13 문서(구조) + 표준 레지멘 참조 구성.
 * ⚠️ verified=false — 용량·스케줄은 **참조용**. 처방 전 NCCN/제약 허가사항·기관 프로토콜 원문 대조 필수.
 *    용량 계산: BSA=doseValue×BSA(Mosteller), AUC=Calvert(doseValue×(GFR+25)), weight=doseValue×체중.
 *    본 화면은 용량 산출 보조까지 — 처방(CPOE) 결선은 후속(자동 처방 생성 없음).
 */
import type { TreeDef } from '../types';

export const REGIMEN_DEFS: TreeDef[] = [
  {
    chartId: 'MFOLFOX6', name: 'mFOLFOX6 (대장암)', category: '종양', archetype: 'tree',
    sourceGuideline: 'NCCN Colon Cancer', sourceVersion: '', verified: false,
    note: '신경독성(Oxaliplatin 누적) 모니터. 감량 단계는 기관 프로토콜 따름.',
    regimen: {
      cancer: '대장암', indication: '전이성/보조', intent: '근치·완화', line: '1차',
      cycleLengthDays: 14, totalCycles: '보조 12주기 등(적응증별)',
      drugs: [
        { name: 'Oxaliplatin', medicationCodeQuery: '옥살리플라틴', doseBasis: 'BSA', doseValue: 85, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: '2 hr', sequence: 1 },
        { name: 'Leucovorin', medicationCodeQuery: '류코보린', doseBasis: 'BSA', doseValue: 400, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: '2 hr', sequence: 2 },
        { name: '5-FU (bolus)', medicationCodeQuery: '플루오로우라실', doseBasis: 'BSA', doseValue: 400, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: 'bolus', sequence: 3 },
        { name: '5-FU (infusion)', medicationCodeQuery: '플루오로우라실', doseBasis: 'BSA', doseValue: 2400, doseUnit: 'mg/m²', route: 'IV', days: ['D1-2'], infusion: '46 hr', sequence: 4 },
      ],
      premedication: ['5-HT3 길항제', 'Dexamethasone'],
      supportive: ['말초신경병증 평가(냉감 회피 교육)', 'CBC/간신기능(주기 전)'],
    },
  },
  {
    chartId: 'FOLFIRI', name: 'FOLFIRI (대장암)', category: '종양', archetype: 'tree',
    sourceGuideline: 'NCCN Colon Cancer', sourceVersion: '', verified: false,
    note: 'UGT1A1 다형성 시 Irinotecan 감량 고려. 지연성 설사 교육(loperamide).',
    regimen: {
      cancer: '대장암', indication: '전이성', intent: '완화', line: '1·2차',
      cycleLengthDays: 14,
      drugs: [
        { name: 'Irinotecan', medicationCodeQuery: '이리노테칸', doseBasis: 'BSA', doseValue: 180, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: '90 min', sequence: 1 },
        { name: 'Leucovorin', medicationCodeQuery: '류코보린', doseBasis: 'BSA', doseValue: 400, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: '2 hr', sequence: 2 },
        { name: '5-FU (bolus)', medicationCodeQuery: '플루오로우라실', doseBasis: 'BSA', doseValue: 400, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: 'bolus', sequence: 3 },
        { name: '5-FU (infusion)', medicationCodeQuery: '플루오로우라실', doseBasis: 'BSA', doseValue: 2400, doseUnit: 'mg/m²', route: 'IV', days: ['D1-2'], infusion: '46 hr', sequence: 4 },
      ],
      premedication: ['5-HT3 길항제', 'Dexamethasone', '(콜린성 증상 시) Atropine'],
      supportive: ['지연성 설사 프로토콜(loperamide)', 'CBC(주기 전)'],
    },
  },
  {
    chartId: 'AC_REGIMEN', name: 'AC (유방암)', category: '종양', archetype: 'tree',
    sourceGuideline: 'NCCN Breast Cancer', sourceVersion: '', verified: false,
    note: 'Doxorubicin 누적 450–550 mg/m² 심독성 한계 — 누적용량 추적 필수. 고催吐(High emetogenic).',
    regimen: {
      cancer: '유방암', indication: '보조/선행', intent: '근치', line: '보조',
      cycleLengthDays: 21, totalCycles: '4주기(→탁산 연계 등)',
      drugs: [
        { name: 'Doxorubicin', medicationCodeQuery: '독소루비신', doseBasis: 'BSA', doseValue: 60, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], sequence: 1, cumulativeLimit: '450–550 mg/m² (심독성)' },
        { name: 'Cyclophosphamide', medicationCodeQuery: '사이클로포스파미드', doseBasis: 'BSA', doseValue: 600, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], sequence: 2 },
      ],
      premedication: ['NK1 길항제', '5-HT3 길항제', 'Dexamethasone (고최토성 3제)'],
      supportive: ['심기능(LVEF) 기저/추적', 'G-CSF(dose-dense 시)'],
    },
  },
  {
    chartId: 'CARBO_PACLI', name: 'Carboplatin + Paclitaxel (난소/폐암)', category: '종양', archetype: 'tree',
    sourceGuideline: 'NCCN Ovarian/NSCLC', sourceVersion: '', verified: false,
    note: 'Carboplatin은 Calvert(AUC) 기반 — GFR 캡 정책 확인. Paclitaxel 과민반응 전처치 필수.',
    regimen: {
      cancer: '난소암·비소세포폐암', indication: '1차', intent: '근치·완화', line: '1차',
      cycleLengthDays: 21, totalCycles: '6주기(통상)',
      drugs: [
        { name: 'Paclitaxel', medicationCodeQuery: '파클리탁셀', doseBasis: 'BSA', doseValue: 175, doseUnit: 'mg/m²', route: 'IV', days: ['D1'], infusion: '3 hr', sequence: 1 },
        { name: 'Carboplatin', medicationCodeQuery: '카보플라틴', doseBasis: 'AUC', doseValue: 5, doseUnit: 'AUC 5', route: 'IV', days: ['D1'], infusion: '30–60 min', sequence: 2 },
      ],
      premedication: ['Dexamethasone', 'H1 길항제(항히스타민)', 'H2 길항제 (Paclitaxel 과민 전처치)'],
      supportive: ['CBC(주기 전)', '말초신경병증 평가'],
    },
  },
];
