/**
 * 기초검사(생리기능검사) 정본 — 검사 종류 · 자리(스테이션) 설정 · 측정 항목.
 *
 * 🔴 착수 전 실측(2026-08-26): 같은 목록이 **네 벌**로 갈라져 있었다.
 *    ① `apps/api/.../diagnostic-test.service.ts` 의 `TEST_TYPES`(11종·ediCode 보유)
 *    ② `apps/web/(main)/diagnostics/page.tsx` 의 `TEST_TYPES`(11종·ediCode 없음·이름 다름)
 *    ③ 같은 파일의 `TABS`(9종)
 *    ④ `apps/web/(main)/diagnostics-board/page.tsx` 의 `TEST_LABEL`(11종)
 *    게다가 운영 `workstation_configs.order_codes` 는 **또 다른 어휘**(`ECG`·`EGD`·`PTA`)라
 *    검사 종류(`EKG`·`ENDOSCOPY_UPPER`·`AUDIOMETRY`)와 **교집합이 0** 이었다.
 *    → 어휘 정본을 여기 하나로 두고, 자리 설정도 이 코드로만 저장한다.
 *
 * 🔴 측정 항목에는 **placeholder(예시값) 필드를 두지 않는다.** 임상값을 예시로 보여주면
 *    그것이 그대로 입력된다(입력 보조 UX 규약 P0 — Apgar `8`·수혈량 `320` 이 실제로 그랬다).
 *    라벨과 단위만 말하고, 값은 사람이 넣는다.
 *
 * 🔴 참고범위(refRange)도 **일부러 담지 않았다.** 이 축의 정상범위는 연령·성별·인종·장비
 *    보정에 따라 달라진다(PFT 예측치·DEXA T-score·청력). 틀린 기준을 화면이 말하는 것은
 *    아무 말도 하지 않는 것보다 나쁘다. 원내 기준이 정해지면 그때 config 로 싣는다.
 */

export interface DiagnosticTestTypeDef {
  /** 검사 종류 코드 — `DiagnosticTest.testType` 저장값 */
  code: string;
  /** 정식 명칭(의뢰서·목록에 쓰는 이름) */
  name: string;
  /** 탭·배지용 짧은 라벨 */
  shortLabel: string;
  /** 임상 분류 */
  category: string;
  /** 건강보험 수가(EDI) 코드 — 청구 연계 시 참조 */
  ediCode: string;
}

export const DIAGNOSTIC_TEST_TYPES: readonly DiagnosticTestTypeDef[] = [
  { code: 'EKG', name: '심전도 (12-lead EKG)', shortLabel: '심전도', category: '심장', ediCode: 'E6011' },
  { code: 'HOLTER', name: '24시간 활동 심전도 (Holter)', shortLabel: 'Holter', category: '심장', ediCode: 'E6012' },
  { code: 'TMT', name: '운동부하 심전도 (TMT)', shortLabel: '운동부하', category: '심장', ediCode: 'EB441' },
  { code: 'ECHO', name: '심장초음파 (Echocardiography)', shortLabel: '심초음파', category: '심장', ediCode: 'EB421' },
  { code: 'PFT', name: '폐기능검사 (PFT)', shortLabel: '폐기능', category: '호흡기', ediCode: 'E6591' },
  { code: 'EEG', name: '뇌파검사 (EEG)', shortLabel: '뇌파', category: '신경', ediCode: 'F6100' },
  { code: 'PSG', name: '수면다원검사 (PSG)', shortLabel: '수면다원', category: '수면', ediCode: 'F6110' },
  { code: 'AUDIOMETRY', name: '순음청력검사 (PTA)', shortLabel: '청력', category: '이비인후', ediCode: 'FA091' },
  { code: 'DEXA', name: '골밀도검사 (DEXA)', shortLabel: '골밀도', category: '근골격', ediCode: 'FA011' },
  { code: 'ENDOSCOPY_UPPER', name: '상부위장관내시경 (EGD)', shortLabel: '위내시경', category: '소화기', ediCode: 'E7631' },
  { code: 'ENDOSCOPY_LOWER', name: '대장내시경 (Colonoscopy)', shortLabel: '대장내시경', category: '소화기', ediCode: 'E7651' },
] as const;

export const DIAGNOSTIC_TEST_TYPE_CODES: readonly string[] =
  DIAGNOSTIC_TEST_TYPES.map((t) => t.code);

export function isDiagnosticTestType(code: string | null | undefined): boolean {
  if (!code) return false;
  return DIAGNOSTIC_TEST_TYPE_CODES.includes(code);
}

/** 코드 → 정의. 모르는 코드는 `null`(지어내지 않는다). */
export function diagnosticTestTypeOf(code: string | null | undefined): DiagnosticTestTypeDef | null {
  if (!code) return null;
  return DIAGNOSTIC_TEST_TYPES.find((t) => t.code === code) ?? null;
}

/** 코드 → 짧은 라벨. 모르면 **코드를 그대로** 보여준다(빈칸으로 감추지 않는다). */
export function diagnosticTestLabel(code: string | null | undefined): string {
  if (!code) return '-';
  return diagnosticTestTypeOf(code)?.shortLabel ?? code;
}

// ── 측정 항목(검사값) ──

export type DiagnosticFieldKind = 'number' | 'text' | 'select';

export interface DiagnosticMeasurementField {
  /** `DiagnosticTest.measurements` JSON 의 키 — 델타체크·추이가 이 키로 비교한다 */
  key: string;
  /** 화면 라벨(한글 또는 임상 약어). 예시값을 넣지 않는다. */
  label: string;
  kind: DiagnosticFieldKind;
  /** 단위(UCUM 표기가 아니라 임상 관용 표기 — 표시 전용) */
  unit?: string;
  /** 입력 step 계산용 소수 자릿수(number 만) */
  decimals?: number;
  /** 물리적으로 불가능한 값을 막는 하한/상한(정상범위가 아니다) */
  min?: number;
  max?: number;
  /** select 선택지 — 첫 항목이 기본값이 되지 않도록 화면은 항상 빈 값으로 시작한다 */
  options?: readonly string[];
  /** 좌/우 등 같은 항목의 묶음 표시용 */
  group?: string;
}

const YES_NO_NOT_DONE = ['미시행', '양성', '음성'] as const;
const COMPLICATION = ['없음', '출혈', '천공', '기타'] as const;

/**
 * 검사 종류별 측정 항목.
 * 여기 없는 종류는 **정형 측정값이 없다는 뜻**이 아니라 *아직 정하지 않았다*는 뜻이다 —
 * 화면은 그 사실을 말하고 서술 소견만 받는다(빈 배열을 "측정할 것이 없다"로 읽지 않는다).
 */
export const DIAGNOSTIC_MEASUREMENT_FIELDS: Readonly<Record<string, readonly DiagnosticMeasurementField[]>> = {
  EKG: [
    { key: 'heartRate', label: '심박수', kind: 'number', unit: 'bpm', decimals: 0, min: 10, max: 300 },
    { key: 'rhythm', label: '리듬', kind: 'select', options: ['정상동율동', '동성서맥', '동성빈맥', '심방세동', '심방조동', '심실조기수축', '심방조기수축', '인공심박동', '기타'] },
    { key: 'prInterval', label: 'PR 간격', kind: 'number', unit: 'ms', decimals: 0, min: 40, max: 600 },
    { key: 'qrsDuration', label: 'QRS 폭', kind: 'number', unit: 'ms', decimals: 0, min: 30, max: 400 },
    { key: 'qtc', label: 'QTc', kind: 'number', unit: 'ms', decimals: 0, min: 200, max: 800 },
    { key: 'axis', label: '전기축', kind: 'select', options: ['정상축', '좌축편위', '우축편위', '극단축편위', '판정 불가'] },
    { key: 'stChange', label: 'ST-T 변화', kind: 'select', options: ['없음', 'ST 상승', 'ST 하강', 'T 역전', '비특이적 변화'] },
  ],
  HOLTER: [
    { key: 'recordingHours', label: '기록 시간', kind: 'number', unit: 'h', decimals: 1, min: 0, max: 168 },
    { key: 'hrMin', label: '최저 심박수', kind: 'number', unit: 'bpm', decimals: 0, min: 10, max: 300 },
    { key: 'hrAvg', label: '평균 심박수', kind: 'number', unit: 'bpm', decimals: 0, min: 10, max: 300 },
    { key: 'hrMax', label: '최고 심박수', kind: 'number', unit: 'bpm', decimals: 0, min: 10, max: 300 },
    { key: 'pvcCount', label: '심실조기수축 총수', kind: 'number', unit: '회', decimals: 0, min: 0 },
    { key: 'pacCount', label: '심방조기수축 총수', kind: 'number', unit: '회', decimals: 0, min: 0 },
    { key: 'pauseMaxSec', label: '최장 휴지기', kind: 'number', unit: 's', decimals: 2, min: 0, max: 60 },
    { key: 'afBurdenPct', label: '심방세동 부담', kind: 'number', unit: '%', decimals: 1, min: 0, max: 100 },
    { key: 'symptomCorrelation', label: '증상-부정맥 연관', kind: 'select', options: ['증상 없음', '연관 있음', '연관 없음', '판정 불가'] },
  ],
  TMT: [
    { key: 'protocol', label: '프로토콜', kind: 'select', options: ['Bruce', 'Modified Bruce', 'Naughton', 'Balke', '기타'] },
    { key: 'exerciseMinutes', label: '운동 시간', kind: 'number', unit: 'min', decimals: 1, min: 0, max: 60 },
    { key: 'mets', label: '달성 METs', kind: 'number', unit: 'METs', decimals: 1, min: 0, max: 25 },
    { key: 'peakHeartRate', label: '최대 심박수', kind: 'number', unit: 'bpm', decimals: 0, min: 10, max: 300 },
    { key: 'peakSystolicBp', label: '최고 수축기혈압', kind: 'number', unit: 'mmHg', decimals: 0, min: 40, max: 320 },
    { key: 'peakDiastolicBp', label: '최고 이완기혈압', kind: 'number', unit: 'mmHg', decimals: 0, min: 20, max: 220 },
    { key: 'stDepressionMm', label: '최대 ST 하강', kind: 'number', unit: 'mm', decimals: 1, min: 0, max: 20 },
    { key: 'terminationReason', label: '종료 사유', kind: 'select', options: ['목표 심박수 도달', '피로', '흉통', '호흡곤란', '부정맥', '혈압 이상', '기타'] },
    { key: 'inducedSymptom', label: '유발 증상', kind: 'select', options: ['없음', '흉통', '호흡곤란', '어지럼', '실신 전조', '기타'] },
  ],
  ECHO: [
    { key: 'lvef', label: 'LVEF', kind: 'number', unit: '%', decimals: 0, min: 5, max: 90 },
    { key: 'lvidd', label: 'LVIDd', kind: 'number', unit: 'mm', decimals: 1, min: 10, max: 100 },
    { key: 'lvids', label: 'LVIDs', kind: 'number', unit: 'mm', decimals: 1, min: 5, max: 100 },
    { key: 'ivsThickness', label: 'IVS 두께', kind: 'number', unit: 'mm', decimals: 1, min: 2, max: 40 },
    { key: 'lvpwThickness', label: 'LVPW 두께', kind: 'number', unit: 'mm', decimals: 1, min: 2, max: 40 },
    { key: 'laDiameter', label: 'LA 직경', kind: 'number', unit: 'mm', decimals: 1, min: 10, max: 90 },
    { key: 'eOverEPrime', label: "E/e'", kind: 'number', decimals: 1, min: 1, max: 60 },
    { key: 'trVelocity', label: 'TR 최대속도', kind: 'number', unit: 'm/s', decimals: 2, min: 0, max: 8 },
    { key: 'rvsp', label: 'RVSP(추정)', kind: 'number', unit: 'mmHg', decimals: 0, min: 5, max: 150 },
    { key: 'wallMotion', label: '국소벽운동', kind: 'select', options: ['정상', '저운동', '무운동', '이상운동', '평가 불가'] },
    { key: 'mitralRegurg', label: '승모판 역류', kind: 'select', options: ['없음', '경도', '중등도', '중증'], group: '판막' },
    { key: 'aorticRegurg', label: '대동맥판 역류', kind: 'select', options: ['없음', '경도', '중등도', '중증'], group: '판막' },
    { key: 'tricuspidRegurg', label: '삼첨판 역류', kind: 'select', options: ['없음', '경도', '중등도', '중증'], group: '판막' },
    { key: 'pericardialEffusion', label: '심낭삼출', kind: 'select', options: ['없음', '소량', '중등량', '다량'] },
  ],
  PFT: [
    { key: 'fvc', label: 'FVC', kind: 'number', unit: 'L', decimals: 2, min: 0, max: 10 },
    { key: 'fvcPredictedPct', label: 'FVC 예측치 대비', kind: 'number', unit: '%', decimals: 0, min: 0, max: 200 },
    { key: 'fev1', label: 'FEV1', kind: 'number', unit: 'L', decimals: 2, min: 0, max: 10 },
    { key: 'fev1PredictedPct', label: 'FEV1 예측치 대비', kind: 'number', unit: '%', decimals: 0, min: 0, max: 200 },
    { key: 'fev1OverFvc', label: 'FEV1/FVC', kind: 'number', unit: '%', decimals: 0, min: 0, max: 100 },
    { key: 'fef2575', label: 'FEF 25-75%', kind: 'number', unit: 'L/s', decimals: 2, min: 0, max: 15 },
    { key: 'pef', label: 'PEF', kind: 'number', unit: 'L/s', decimals: 2, min: 0, max: 20 },
    { key: 'dlco', label: 'DLCO', kind: 'number', unit: 'mL/min/mmHg', decimals: 2, min: 0, max: 80 },
    { key: 'bronchodilatorResponse', label: '기관지확장제 반응', kind: 'select', options: [...YES_NO_NOT_DONE] },
    { key: 'pattern', label: '환기 패턴', kind: 'select', options: ['정상', '폐쇄성', '제한성', '혼합성', '판정 불가'] },
    { key: 'effortQuality', label: '검사 협조도', kind: 'select', options: ['양호', '보통', '불량(해석 주의)'] },
  ],
  EEG: [
    { key: 'backgroundRhythm', label: '기저 리듬', kind: 'select', options: ['알파(8-13Hz) 우세', '베타 우세', '세타 우세', '델타 우세', '저전위', '판정 불가'] },
    { key: 'backgroundFrequencyHz', label: '기저 주파수', kind: 'number', unit: 'Hz', decimals: 1, min: 0, max: 40 },
    { key: 'symmetry', label: '좌우 대칭성', kind: 'select', options: ['대칭', '좌측 비대칭', '우측 비대칭'] },
    { key: 'epileptiformDischarge', label: '간질양 방전', kind: 'select', options: ['없음', '국소', '전반', '다초점'] },
    { key: 'dischargeLocation', label: '방전 부위', kind: 'text' },
    { key: 'hyperventilation', label: '과호흡 부하', kind: 'select', options: ['미시행', '정상 반응', '이상 반응'] },
    { key: 'photicStimulation', label: '광자극', kind: 'select', options: ['미시행', '정상 반응', '광발작 반응'] },
    { key: 'sleepRecorded', label: '수면 기록', kind: 'select', options: ['없음', '있음'] },
  ],
  PSG: [
    { key: 'totalSleepMinutes', label: '총 수면시간', kind: 'number', unit: 'min', decimals: 0, min: 0, max: 900 },
    { key: 'sleepEfficiencyPct', label: '수면 효율', kind: 'number', unit: '%', decimals: 1, min: 0, max: 100 },
    { key: 'sleepLatencyMinutes', label: '입면 잠복기', kind: 'number', unit: 'min', decimals: 1, min: 0, max: 600 },
    { key: 'ahi', label: 'AHI', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'rdi', label: 'RDI', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'odi', label: 'ODI', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'supineAhi', label: '앙와위 AHI', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'remAhi', label: 'REM AHI', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'spo2Min', label: '최저 SpO₂', kind: 'number', unit: '%', decimals: 0, min: 30, max: 100 },
    { key: 'spo2MeanPct', label: '평균 SpO₂', kind: 'number', unit: '%', decimals: 1, min: 30, max: 100 },
    { key: 'arousalIndex', label: '각성 지수', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
    { key: 'periodicLimbMovementIndex', label: '주기성 사지운동 지수', kind: 'number', unit: '/h', decimals: 1, min: 0, max: 150 },
  ],
  AUDIOMETRY: [
    { key: 'ptaRight', label: 'PTA 우측', kind: 'number', unit: 'dB HL', decimals: 0, min: -10, max: 120, group: '순음역치' },
    { key: 'ptaLeft', label: 'PTA 좌측', kind: 'number', unit: 'dB HL', decimals: 0, min: -10, max: 120, group: '순음역치' },
    { key: 'boneRight', label: '골도 우측', kind: 'number', unit: 'dB HL', decimals: 0, min: -10, max: 90, group: '순음역치' },
    { key: 'boneLeft', label: '골도 좌측', kind: 'number', unit: 'dB HL', decimals: 0, min: -10, max: 90, group: '순음역치' },
    { key: 'srtRight', label: 'SRT 우측', kind: 'number', unit: 'dB', decimals: 0, min: -10, max: 120, group: '어음' },
    { key: 'srtLeft', label: 'SRT 좌측', kind: 'number', unit: 'dB', decimals: 0, min: -10, max: 120, group: '어음' },
    { key: 'wrsRight', label: '어음명료도 우측', kind: 'number', unit: '%', decimals: 0, min: 0, max: 100, group: '어음' },
    { key: 'wrsLeft', label: '어음명료도 좌측', kind: 'number', unit: '%', decimals: 0, min: 0, max: 100, group: '어음' },
    { key: 'hearingTypeRight', label: '난청 유형 우측', kind: 'select', options: ['정상', '감각신경성', '전음성', '혼합성'], group: '판정' },
    { key: 'hearingTypeLeft', label: '난청 유형 좌측', kind: 'select', options: ['정상', '감각신경성', '전음성', '혼합성'], group: '판정' },
    { key: 'tympanogramRight', label: '고막운동성 우측', kind: 'select', options: ['미시행', 'A형', 'As형', 'Ad형', 'B형', 'C형'], group: '판정' },
    { key: 'tympanogramLeft', label: '고막운동성 좌측', kind: 'select', options: ['미시행', 'A형', 'As형', 'Ad형', 'B형', 'C형'], group: '판정' },
  ],
  DEXA: [
    { key: 'lumbarBmd', label: '요추 BMD', kind: 'number', unit: 'g/cm²', decimals: 3, min: 0, max: 3, group: '요추' },
    { key: 'lumbarTScore', label: '요추 T-score', kind: 'number', decimals: 1, min: -8, max: 8, group: '요추' },
    { key: 'lumbarZScore', label: '요추 Z-score', kind: 'number', decimals: 1, min: -8, max: 8, group: '요추' },
    { key: 'femurNeckBmd', label: '대퇴경부 BMD', kind: 'number', unit: 'g/cm²', decimals: 3, min: 0, max: 3, group: '대퇴' },
    { key: 'femurNeckTScore', label: '대퇴경부 T-score', kind: 'number', decimals: 1, min: -8, max: 8, group: '대퇴' },
    { key: 'femurNeckZScore', label: '대퇴경부 Z-score', kind: 'number', decimals: 1, min: -8, max: 8, group: '대퇴' },
    { key: 'totalHipBmd', label: '고관절 전체 BMD', kind: 'number', unit: 'g/cm²', decimals: 3, min: 0, max: 3, group: '대퇴' },
    { key: 'totalHipTScore', label: '고관절 전체 T-score', kind: 'number', decimals: 1, min: -8, max: 8, group: '대퇴' },
    { key: 'referenceStandard', label: '판정 기준', kind: 'select', options: ['WHO T-score(폐경 후 여성·50세 이상 남성)', 'Z-score(폐경 전 여성·50세 미만 남성·소아)'] },
  ],
  ENDOSCOPY_UPPER: [
    { key: 'sedation', label: '진정 여부', kind: 'select', options: ['비수면', '수면(진정)'] },
    { key: 'esophagus', label: '식도', kind: 'select', options: ['정상', '역류성식도염', '바렛식도', '식도정맥류', '종괴', '기타'] },
    { key: 'stomach', label: '위', kind: 'select', options: ['정상', '표재성위염', '위축성위염', '장상피화생', '위궤양', '용종', '종괴', '기타'] },
    { key: 'duodenum', label: '십이지장', kind: 'select', options: ['정상', '십이지장염', '십이지장궤양', '기타'] },
    { key: 'biopsyCount', label: '조직검사 검체 수', kind: 'number', unit: '개', decimals: 0, min: 0, max: 30 },
    { key: 'biopsySite', label: '조직검사 부위', kind: 'text' },
    { key: 'hPylori', label: 'H. pylori 검사', kind: 'select', options: [...YES_NO_NOT_DONE] },
    { key: 'complication', label: '합병증', kind: 'select', options: [...COMPLICATION] },
  ],
  ENDOSCOPY_LOWER: [
    { key: 'sedation', label: '진정 여부', kind: 'select', options: ['비수면', '수면(진정)'] },
    { key: 'cecalIntubation', label: '맹장 도달', kind: 'select', options: ['도달', '미도달'] },
    { key: 'bbpsTotal', label: '장정결 점수(BBPS 합계)', kind: 'number', decimals: 0, min: 0, max: 9 },
    { key: 'withdrawalMinutes', label: '회수 시간', kind: 'number', unit: 'min', decimals: 1, min: 0, max: 120 },
    { key: 'polypCount', label: '용종 개수', kind: 'number', unit: '개', decimals: 0, min: 0, max: 50 },
    { key: 'polypMaxSizeMm', label: '최대 용종 크기', kind: 'number', unit: 'mm', decimals: 1, min: 0, max: 100 },
    { key: 'polypectomy', label: '용종절제', kind: 'select', options: ['미시행', '시행'] },
    { key: 'biopsyCount', label: '조직검사 검체 수', kind: 'number', unit: '개', decimals: 0, min: 0, max: 30 },
    { key: 'complication', label: '합병증', kind: 'select', options: [...COMPLICATION] },
  ],
};

/** 검사 종류의 측정 항목. 정하지 않은 종류는 빈 배열 — 화면이 그 사실을 말해야 한다. */
export function diagnosticMeasurementFields(testType: string | null | undefined): readonly DiagnosticMeasurementField[] {
  if (!testType) return [];
  return DIAGNOSTIC_MEASUREMENT_FIELDS[testType] ?? [];
}

/** 측정 항목이 정의된 종류인가 — 화면이 "정형 입력 없음"을 정직하게 말하기 위한 판정 */
export function hasDiagnosticMeasurementFields(testType: string | null | undefined): boolean {
  return diagnosticMeasurementFields(testType).length > 0;
}

// ── 자리(스테이션) 설정 ──

/** `WorkstationConfig.category` 중 기초검사 자리 */
export const DIAGNOSTIC_STATION_CATEGORY = 'DIAGNOSTIC';

/** 검사 결론 — 저장값 정본(FE 로컬 Record 재정의 금지) */
export const DIAGNOSTIC_CONCLUSIONS = [
  { code: 'NORMAL', label: '정상' },
  { code: 'BORDERLINE', label: '경계' },
  { code: 'ABNORMAL', label: '이상' },
] as const;

export const DIAGNOSTIC_CONCLUSION_CODES: readonly string[] =
  DIAGNOSTIC_CONCLUSIONS.map((c) => c.code);

/**
 * 자리에 설정된 검사 종류 중 **정본 어휘에 실재하는 것만** 남긴다.
 * 하나도 안 남으면 `unknown` 에 담아 화면이 "설정이 어긋났다"고 말할 수 있게 한다.
 * 🔴 조용히 전체로 폴백하지 않는다 — 틀린 목록은 빈 목록보다 나쁘다.
 */
export function resolveDiagnosticStationTypes(codes: unknown): { usable: string[]; unknown: string[] } {
  if (!Array.isArray(codes)) return { usable: [], unknown: [] };
  const usable: string[] = [];
  const unknownCodes: string[] = [];
  for (const c of codes) {
    if (typeof c !== 'string') continue;
    if (isDiagnosticTestType(c)) { if (!usable.includes(c)) usable.push(c); }
    else if (!unknownCodes.includes(c)) unknownCodes.push(c);
  }
  return { usable, unknown: unknownCodes };
}

// ── 상태 · 전이 정본(diagnostics-board-enhancement P2 — 2026-09-14) ──
//
// 🔴 착수 전 실측: `PATCH /diagnostic-tests/:id/transition` 은 있었지만 **어느 상태에서 어느 상태로든** 바꿨고,
//    사유를 **위험소견 메모(`criticalNote`) 칸에 덮어썼다** — 보류 사유 한 줄이 판독자가 남긴 위험소견을 지웠다.
//    행위자·시각도 남지 않았고, 보류 해제를 부르는 화면도 없었다.
// 기획서(§2 P2)는 "CANCELLED·ON_HOLD 전이(취소/보류 EP)"만 적었다 — 아래 전이표·사유 필수는 **이 저장소가 정한 규칙**이고
// 근거는 각 줄 주석에 있다. 바꿀 때는 이 표 하나만 고친다(서버 검증과 화면 버튼이 둘 다 이 표를 읽는다).

export const DIAGNOSTIC_TEST_STATUS_LABEL: Record<string, string> = {
  ORDERED: '의뢰',
  SCHEDULED: '예정',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  ON_HOLD: '보류',
  CANCELLED: '취소',
};

/** 현재 상태 → 사람이 직접 옮길 수 있는 상태(수행·판독 입력으로 가는 전이는 각 EP 가 따로 맡는다) */
export const DIAGNOSTIC_TEST_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  ORDERED: ['SCHEDULED', 'ON_HOLD', 'CANCELLED'],
  SCHEDULED: ['ON_HOLD', 'CANCELLED'],
  // 진행 중에도 멈출 수 있어야 한다(환자 상태 악화·장비 고장) — 막으면 기록 없이 방치된다
  IN_PROGRESS: ['ON_HOLD', 'CANCELLED'],
  // 보류 해제는 의뢰(ORDERED) 또는 예정(SCHEDULED — 예정 시각이 있어야 함)으로 되돌린다. 이전 상태를 추측하지 않는다
  ON_HOLD: ['ORDERED', 'SCHEDULED', 'CANCELLED'],
  // 결과가 난 검사의 취소는 막지 않는다 — 결과가 있다는 사실을 확인받고 기록한다(결과는 지우지 않는다)
  COMPLETED: ['CANCELLED'],
  // 취소는 끝이다 — 되살리려면 새로 의뢰한다(취소 기록을 덮지 않는다)
  CANCELLED: [],
};

/** 사유가 필수인 목적 상태 — 멈추거나 없애는 전이는 왜 그랬는지가 사실의 일부다 */
export const DIAGNOSTIC_TEST_REASON_REQUIRED: readonly string[] = ['ON_HOLD', 'CANCELLED'];

/** 전이 가능 여부. 모르는 현재 상태에서는 **옮기지 않는다**(지어낸 상태에서 출발하지 않는다). */
export function canTransitionDiagnosticTest(from: string | null | undefined, to: string): boolean {
  if (!from) return false;
  return (DIAGNOSTIC_TEST_TRANSITIONS[from] ?? []).includes(to);
}
