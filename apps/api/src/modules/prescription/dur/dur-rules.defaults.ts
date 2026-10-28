/**
 * DUR 룰 기본값(2026-08-04 테이블화 P0-a) — 정본은 DurRule 테이블.
 * 이 상수들은 ①최초 시드 소스 ②로드 실패/타입 소실 시 폴백(fail-safe) 로만 쓰인다.
 * 🔴 룰 개정은 여기가 아니라 관리 EP(/api/v1/dur/rules) → 테이블에서 한다(약사위 심의 대상).
 */

/** `ruleId` = 테이블 행 id(적중 계측 · 2026-10-21) — 코드 기본값(폴백) 룰에는 없다 */
export interface InteractionRule { drugA: string; drugB: string; severity: 'ERROR' | 'WARNING'; message: string; ruleId?: string }
export interface AgeRule { ingredient: string; minAge?: number; maxAge?: number; severity: 'ERROR' | 'WARNING'; message: string; ruleId?: string }
export interface DoseLimit { ingredient: string; maxDailyDose: number; unit: string; message: string; ruleId?: string }
export interface BeersRule { keywords: string[]; message: string; ruleId?: string }
export interface PediatricDoseRule { ingredient: string; maxPerKgDay: number; unit: string; maxAbsolute?: number; ruleId?: string }

// 병용금기/상호작용 룰 (확장)
export const INTERACTION_RULES: InteractionRule[] = [
  // 항응고제 상호작용
  { drugA: '와파린', drugB: '아스피린', severity: 'ERROR', message: '출혈 위험 증가 (항응고+항혈소판)' },
  { drugA: '와파린', drugB: '이부프로펜', severity: 'ERROR', message: '출혈 위험 증가 (항응고+NSAIDs)' },
  { drugA: '와파린', drugB: '아세트아미노펜', severity: 'WARNING', message: 'INR 상승 가능 (고용량 시)' },
  // NSAIDs 상호작용
  { drugA: '이부프로펜', drugB: '아스피린', severity: 'WARNING', message: '아스피린 항혈소판 효과 감소' },
  { drugA: '이부프로펜', drugB: '로사르탄', severity: 'WARNING', message: 'NSAIDs가 ARB 혈압강하 효과 감소' },
  { drugA: '이부프로펜', drugB: '메트포르민', severity: 'WARNING', message: 'NSAIDs가 신기능 저하 유발 가능' },
  // 당뇨약 상호작용
  { drugA: '메트포르민', drugB: '조영제', severity: 'WARNING', message: '유산산증 위험 (CT 촬영 시 중단 필요)' },
  { drugA: '글리메피리드', drugB: '플루코나졸', severity: 'ERROR', message: '저혈당 위험 증가' },
  // 항생제 상호작용
  { drugA: '아목시실린', drugB: '메토트렉세이트', severity: 'WARNING', message: '메토트렉세이트 독성 증가' },
  { drugA: '시프로플록사신', drugB: '테오필린', severity: 'ERROR', message: '테오필린 혈중농도 상승' },
  { drugA: '클래리스로마이신', drugB: '아토르바스타틴', severity: 'ERROR', message: '횡문근융해증 위험 (스타틴+마크로라이드)' },
  { drugA: '아지스로마이신', drugB: '아토르바스타틴', severity: 'WARNING', message: '스타틴 혈중농도 상승 가능' },
  // 심혈관 상호작용
  { drugA: 'ACE억제제', drugB: '칼륨보존이뇨제', severity: 'WARNING', message: '고칼륨혈증 위험' },
  { drugA: '암로디핀', drugB: '시메티딘', severity: 'WARNING', message: '암로디핀 혈중농도 상승' },
  { drugA: '아토르바스타틴', drugB: '자몽', severity: 'WARNING', message: '스타틴 혈중농도 상승 (자몽 섭취 주의)' },
  // 정신과 약물
  { drugA: 'SSRI', drugB: 'MAO억제제', severity: 'ERROR', message: '세로토닌 증후군 위험 (절대 병용금기)' },
  { drugA: 'SSRI', drugB: '트라마돌', severity: 'WARNING', message: '세로토닌 증후군 위험' },
  { drugA: '졸피뎀', drugB: '알코올', severity: 'ERROR', message: 'CNS 억제 증강 (호흡억제 위험)' },
  // 위장약 상호작용
  { drugA: '오메프라졸', drugB: '클로피도그렐', severity: 'ERROR', message: 'PPI가 클로피도그렐 효과 감소 (심혈관 위험)' },
  { drugA: '오메프라졸', drugB: '메토트렉세이트', severity: 'WARNING', message: '메토트렉세이트 배설 지연' },
  // 기타
  { drugA: '세티리진', drugB: '알코올', severity: 'WARNING', message: '졸음 증가' },
  { drugA: '프레드니솔론', drugB: '이부프로펜', severity: 'WARNING', message: '위장관 출혈 위험 증가 (스테로이드+NSAIDs)' },
  { drugA: '프레드니솔론', drugB: '메트포르민', severity: 'WARNING', message: '스테로이드가 혈당 상승 유발' },
];

// 연령 금기 룰
export const AGE_RULES: AgeRule[] = [
  { ingredient: '아스피린', maxAge: 18, severity: 'ERROR', message: '18세 이하 아스피린 투여 금기 (Reye 증후군)' },
  { ingredient: '테트라사이클린', maxAge: 8, severity: 'ERROR', message: '8세 이하 테트라사이클린 금기 (치아 변색)' },
  { ingredient: '시프로플록사신', maxAge: 18, severity: 'WARNING', message: '18세 이하 퀴놀론 사용 주의 (연골 독성)' },
  { ingredient: '졸피뎀', minAge: 65, severity: 'WARNING', message: '65세 이상 수면제 용량 감량 필요' },
  { ingredient: '메트포르민', minAge: 80, severity: 'WARNING', message: '80세 이상 메트포르민 신기능 확인 필요' },
  { ingredient: '트라마돌', maxAge: 12, severity: 'ERROR', message: '12세 이하 트라마돌 금기' },
];

// 최대 일일 용량
export const DOSE_LIMITS: DoseLimit[] = [
  { ingredient: '아세트아미노펜', maxDailyDose: 4000, unit: 'mg', message: '아세트아미노펜 일일 최대 4000mg (간독성)' },
  { ingredient: '이부프로펜', maxDailyDose: 2400, unit: 'mg', message: '이부프로펜 일일 최대 2400mg' },
  { ingredient: '아목시실린', maxDailyDose: 3000, unit: 'mg', message: '아목시실린 일일 최대 3000mg' },
];

// 노인 부적절 약물 — Beers Criteria 스타터(대표 성분). ≥65세 WARNING.
// DB ingredient는 영문·화면명은 한글이라 양쪽 키워드 병행 매칭.
export const BEERS_CRITERIA: BeersRule[] = [
  { keywords: ['diazepam', '디아제팜'], message: '장기작용 벤조디아제핀 — 낙상·인지장애 위험' },
  { keywords: ['chlordiazepoxide', '클로르디아제폭시드'], message: '장기작용 벤조디아제핀 — 낙상·과진정' },
  { keywords: ['chlorpheniramine', '클로르페니라민'], message: '1세대 항히스타민 — 항콜린 부작용(혼동·요저류·변비)' },
  { keywords: ['diphenhydramine', '디펜히드라민'], message: '1세대 항히스타민 — 항콜린 부작용·과진정' },
  { keywords: ['hydroxyzine', '히드록시진'], message: '1세대 항히스타민 — 항콜린 부작용' },
  { keywords: ['amitriptyline', '아미트리프틸린'], message: 'TCA — 항콜린·기립성저혈압·낙상' },
  { keywords: ['doxepin', '독세핀'], message: 'TCA(>6mg) — 항콜린·과진정' },
  { keywords: ['indomethacin', '인도메타신'], message: 'NSAIDs 중 CNS 부작용 최다 — 노인 회피 권장' },
  { keywords: ['glibenclamide', 'glyburide', '글리벤클라미드'], message: '장시간형 설폰요소제 — 지속 저혈당 위험' },
  { keywords: ['cyclobenzaprine', '시클로벤자프린'], message: '골격근이완제 — 항콜린·진정·낙상' },
  { keywords: ['meperidine', 'pethidine', '페티딘'], message: '신경독성 대사체 축적 — 노인 사용 회피' },
  { keywords: ['scopolamine', '스코폴라민'], message: '강한 항콜린제 — 혼동·섬망 위험' },
  { keywords: ['digoxin', '디곡신'], message: '디곡신 — 노인 신기능 저하 시 독성(0.125mg/일 초과 주의)' },
];

// 소아 체중기반 용량 (mg/kg/day)
export const PEDIATRIC_DOSE_PER_KG: PediatricDoseRule[] = [
  { ingredient: '아세트아미노펜', maxPerKgDay: 75, unit: 'mg', maxAbsolute: 4000 },
  { ingredient: '이부프로펜', maxPerKgDay: 40, unit: 'mg', maxAbsolute: 2400 },
  { ingredient: '아목시실린', maxPerKgDay: 90, unit: 'mg', maxAbsolute: 3000 },
  { ingredient: '세프트리악손', maxPerKgDay: 100, unit: 'mg', maxAbsolute: 4000 },
  { ingredient: '아지스로마이신', maxPerKgDay: 10, unit: 'mg', maxAbsolute: 500 },
  { ingredient: '클래리스로마이신', maxPerKgDay: 15, unit: 'mg', maxAbsolute: 1000 },
  { ingredient: '프레드니솔론', maxPerKgDay: 2, unit: 'mg', maxAbsolute: 60 },
  { ingredient: '오셀타미비르', maxPerKgDay: 4, unit: 'mg', maxAbsolute: 150 },
  { ingredient: '반코마이신', maxPerKgDay: 60, unit: 'mg', maxAbsolute: 4000 },
  { ingredient: '겐타마이신', maxPerKgDay: 7.5, unit: 'mg' },
];

