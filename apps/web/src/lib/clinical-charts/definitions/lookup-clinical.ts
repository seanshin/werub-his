/**
 * Lookup 콘텐츠 — 신경·마취·신장·호흡·소화기·재활
 * 출처: clinical-charts 06·07·14·15·16 문서.
 * ⚠️ verified=false — 공식 가이드라인 원문 대조 필수. 보조도구·최종판단 의사 귀속.
 */
import type { LookupDef } from '../types';

export const LOOKUP_CLINICAL_DEFS: LookupDef[] = [
  /* ── 신경 ── */
  {
    chartId: 'MRS', name: 'modified Rankin Scale (mRS, 기능 예후)', category: '신경', archetype: 'lookup',
    sourceGuideline: 'mRS', sourceVersion: '', verified: false, inputLabel: '점수',
    options: [
      { code: '0', label: '0 — 증상 전혀 없음', level: 'normal' },
      { code: '1', label: '1 — 유의한 장애 없음', level: 'low' },
      { code: '2', label: '2 — 경도 장애(자립)', level: 'low' },
      { code: '3', label: '3 — 중등도(도움 필요, 보행 자립)', level: 'moderate' },
      { code: '4', label: '4 — 중등도-중증(보행·신변 도움)', level: 'high' },
      { code: '5', label: '5 — 중증(와상·실금·지속 간호)', level: 'critical' },
      { code: '6', label: '6 — 사망', level: 'critical' },
    ],
  },
  {
    chartId: 'HUNT_HESS', name: 'Hunt-Hess (지주막하출혈)', category: '신경', archetype: 'lookup',
    sourceGuideline: 'Hunt & Hess', sourceVersion: '1968', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 무증상/경미한 두통', level: 'low' },
      { code: 'II', label: 'II — 중등도-심한 두통·경부강직', level: 'moderate' },
      { code: 'III', label: 'III — 기면·경도 국소결손', level: 'high' },
      { code: 'IV', label: 'IV — 혼미·중등도-중증 반신마비', level: 'critical' },
      { code: 'V', label: 'V — 혼수·제뇌강직', level: 'critical' },
    ],
  },
  {
    chartId: 'RASS', name: 'RASS (진정-각성 척도)', category: '중환자', archetype: 'lookup',
    sourceGuideline: 'RASS', sourceVersion: '2002', verified: false, inputLabel: '점수',
    note: 'CAM-ICU 섬망 평가와 연계.',
    options: [
      { code: '+4', label: '+4 — 호전적·폭력적', level: 'critical' },
      { code: '+3', label: '+3 — 매우 흥분', level: 'high' },
      { code: '+2', label: '+2 — 흥분', level: 'moderate' },
      { code: '+1', label: '+1 — 불안', level: 'low' },
      { code: '0', label: '0 — 명료·차분', level: 'normal' },
      { code: '-1', label: '-1 — 졸림(>10초 각성·시선접촉)', level: 'low' },
      { code: '-2', label: '-2 — 경도 진정(<10초)', level: 'moderate' },
      { code: '-3', label: '-3 — 중등도 진정(시선접촉 없음)', level: 'moderate' },
      { code: '-4', label: '-4 — 깊은 진정(자극에 움직임만)', level: 'high' },
      { code: '-5', label: '-5 — 각성 불가', level: 'critical' },
    ],
  },

  /* ── 마취 ── */
  {
    chartId: 'ASA', name: 'ASA Physical Status (마취 전 신체상태)', category: '마취', archetype: 'lookup',
    sourceGuideline: 'ASA', sourceVersion: '', verified: false, inputLabel: '등급',
    note: '응급 수술은 각 등급에 E 접미.',
    options: [
      { code: 'I', label: 'I — 정상 건강', level: 'normal' },
      { code: 'II', label: 'II — 경증 전신질환(조절됨)', level: 'low' },
      { code: 'III', label: 'III — 중증 전신질환·활동 제한', level: 'moderate' },
      { code: 'IV', label: 'IV — 생명 위협 중증 전신질환', level: 'high' },
      { code: 'V', label: 'V — 수술 없이 생존 불가', level: 'critical' },
      { code: 'VI', label: 'VI — 뇌사·장기적출 대상', level: 'critical' },
    ],
  },
  {
    chartId: 'MALLAMPATI', name: 'Mallampati 분류 (기도 평가)', category: '마취', archetype: 'lookup',
    sourceGuideline: 'Mallampati', sourceVersion: '', verified: false, inputLabel: '등급',
    note: 'III–IV는 어려운 기도삽관 가능성↑.',
    options: [
      { code: 'I', label: 'I — 연구개·구개수·인두기둥 모두', level: 'normal' },
      { code: 'II', label: 'II — 연구개·구개수 일부', level: 'low' },
      { code: 'III', label: 'III — 연구개·구개수 기저부만', level: 'high' },
      { code: 'IV', label: 'IV — 경구개만 보임', level: 'critical' },
    ],
  },

  /* ── 재활/척수 ── */
  {
    chartId: 'ASIA', name: 'ASIA 척수손상 등급 (AIS)', category: '재활', archetype: 'lookup',
    sourceGuideline: 'ASIA/ISNCSCI', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: 'A', label: 'A — 완전(S4-5 운동·감각 소실)', level: 'critical' },
      { code: 'B', label: 'B — 불완전(감각 보존, 운동 없음)', level: 'high' },
      { code: 'C', label: 'C — 불완전(운동 보존, 핵심근육 절반 미만 근력≥3)', level: 'high' },
      { code: 'D', label: 'D — 불완전(핵심근육 절반 이상 근력≥3)', level: 'moderate' },
      { code: 'E', label: 'E — 정상', level: 'normal' },
    ],
  },

  /* ── 신장 ── */
  {
    chartId: 'CKD_GFR', name: 'KDIGO CKD GFR 범주 (G)', category: '신장', archetype: 'lookup',
    sourceGuideline: 'KDIGO', sourceVersion: '2012', verified: false, inputLabel: 'GFR 범주',
    note: '알부민뇨(A1–A3)와 조합해 위험도(G×A) 산출.',
    options: [
      { code: 'G1', label: 'G1 — ≥90 (정상/높음)', level: 'normal' },
      { code: 'G2', label: 'G2 — 60–89 (경도 저하)', level: 'low' },
      { code: 'G3a', label: 'G3a — 45–59 (경도-중등도)', level: 'moderate' },
      { code: 'G3b', label: 'G3b — 30–44 (중등도-중증)', level: 'high' },
      { code: 'G4', label: 'G4 — 15–29 (중증 저하)', level: 'high' },
      { code: 'G5', label: 'G5 — <15 (신부전)', level: 'critical' },
    ],
  },
  {
    chartId: 'AKI', name: '급성신손상 AKI 병기 (KDIGO)', category: '신장', archetype: 'lookup',
    sourceGuideline: 'KDIGO', sourceVersion: '2012', verified: false, inputLabel: '단계',
    options: [
      { code: '1', label: '1 — Cr 기저 1.5–1.9배 또는 ≥0.3 mg/dL↑ / 소변량 <0.5 mL/kg/h×6–12h', level: 'moderate' },
      { code: '2', label: '2 — Cr 기저 2.0–2.9배 / 소변량 <0.5 mL/kg/h×≥12h', level: 'high' },
      { code: '3', label: '3 — Cr ≥3.0배 또는 ≥4.0 mg/dL 또는 투석 / 소변량 <0.3 mL/kg/h×≥24h 또는 무뇨 ≥12h', level: 'critical' },
    ],
  },

  /* ── 호흡 ── */
  {
    chartId: 'GOLD', name: 'GOLD 기류제한 중증도 (COPD)', category: '호흡', archetype: 'lookup',
    sourceGuideline: 'GOLD Report', sourceVersion: '2023', verified: false, inputLabel: '등급(FEV1 예측%)',
    note: '기관지확장제 후 FEV1/FVC<0.70 확인 전제.',
    options: [
      { code: '1', label: 'GOLD 1 — ≥80%', level: 'low' },
      { code: '2', label: 'GOLD 2 — 50–79%', level: 'moderate' },
      { code: '3', label: 'GOLD 3 — 30–49%', level: 'high' },
      { code: '4', label: 'GOLD 4 — <30%', level: 'critical' },
    ],
  },
  {
    chartId: 'MMRC', name: 'mMRC 호흡곤란 척도', category: '호흡', archetype: 'lookup',
    sourceGuideline: 'mMRC', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: '0', label: '0 — 격렬한 운동 시에만', level: 'normal' },
      { code: '1', label: '1 — 평지 빨리/오르막에서', level: 'low' },
      { code: '2', label: '2 — 평지에서 또래보다 느림', level: 'moderate' },
      { code: '3', label: '3 — 평지 100m·수분 후 멈춤', level: 'high' },
      { code: '4', label: '4 — 외출 불가·옷 입을 때 숨참', level: 'critical' },
    ],
  },

  /* ── 소화기 내시경 ── */
  {
    chartId: 'FORREST', name: 'Forrest 분류 (소화성궤양 출혈)', category: '소화기', archetype: 'lookup',
    sourceGuideline: 'Forrest', sourceVersion: '1974', verified: false, inputLabel: '등급',
    options: [
      { code: 'Ia', label: 'Ia — 분출성 출혈', level: 'critical', attribute: '재출혈 높음', recommendation: '내시경 지혈' },
      { code: 'Ib', label: 'Ib — 삼출성 출혈', level: 'high', attribute: '재출혈 높음', recommendation: '내시경 지혈' },
      { code: 'IIa', label: 'IIa — 노출 혈관(비출혈)', level: 'high', attribute: '중-높음', recommendation: '내시경 지혈' },
      { code: 'IIb', label: 'IIb — 부착 혈전', level: 'moderate', attribute: '중간', recommendation: '내시경 지혈 고려' },
      { code: 'IIc', label: 'IIc — 흑색 기저(평평한 색소반)', level: 'low', attribute: '낮음', recommendation: '보존' },
      { code: 'III', label: 'III — 깨끗한 기저', level: 'normal', attribute: '매우 낮음', recommendation: '보존' },
    ],
  },
  {
    chartId: 'LA_ESOPHAGITIS', name: 'LA 분류 (역류성 식도염)', category: '소화기', archetype: 'lookup',
    sourceGuideline: 'Los Angeles', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: 'A', label: 'A — ≤5mm, 점막주름 국한', level: 'low' },
      { code: 'B', label: 'B — >5mm, 비연속', level: 'moderate' },
      { code: 'C', label: 'C — 주름 사이 연속, 둘레<75%', level: 'high' },
      { code: 'D', label: 'D — 둘레 ≥75%', level: 'critical' },
    ],
  },
];
