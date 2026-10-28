/**
 * DUR/CDSS 성분 매칭 정본(2026-08-18) — 룰의 **한글 성분어(語)** 를 실제 약품 어휘에 닿게 한다.
 *
 * 🔴 이 파일이 생긴 이유(실측):
 *   룰(`dur-rules.defaults.ts` → `dur_rules` 테이블)은 한글(`와파린`)인데
 *   `medication_codes.ingredient` 는 영문 INN(`warfarin sodium 2mg`)이다.
 *   종전 판정은 `newIngredient.includes(rule.drugA)` — **ingredient 단일 필드 · 대소문자 구분** 이라
 *   한글 룰은 영원히 false 였다. 운영 실측(2026-08-18, 24,022행):
 *     ingredient ILIKE '%와파린%' = 0   vs  '%warfarin%' = 4
 *     ingredient ILIKE '%아세트아미노펜%' = 0 vs '%acetaminophen%' = 343
 *   → 55룰 중 BEERS 13룰(hay 3원+소문자화 사용)만 살아 있고 **42룰(ERROR 21 전량 포함)이 사멸**.
 *
 * 정본 재사용:
 *   - 검색 정본 `common/medication-search.ts` 가 이미 **nameKo·nameEn·ingredient 3원 + 대소문자 무시** 다.
 *     판정도 같은 어휘 표면을 봐야 한다 → `buildMedicationHay()` 가 그 3원을 소문자로 합친다.
 *   - BEERS 룰이 쓰던 `hay = ingredient+nameKo+nameEn` 소문자화(dur.service.ts) 가 유일한 생존 경로였다.
 *     그 방식을 전 룰 타입으로 확장한 것이 이 모듈이다(새 방식이 아니라 살아 있던 방식의 승격).
 *
 * 🔴 hay 3원만으로는 부족하다 — 별칭이 필요한 이유(운영 실측):
 *     아세트아미노펜: name_ko 매칭 52 vs ingredient 'acetaminophen' 343 (85% 누락)
 *     메트포르민:     name_ko 422 vs 'metformin' 1,145 (63% 누락)
 *     아지스로마이신: name_ko 0   vs 'azithromycin' 18 (한글 표기가 '아지트로마이신')
 *     테트라사이클린: name_ko 0   vs 'tetracycline' 1 (한글 표기가 '테라싸이클린')
 *   → 한글 룰어 1개당 **실측으로 확인한** 영문 INN·한글 이표기를 함께 본다.
 *
 * 🔴 아래 별칭은 전부 운영 DB(24,022행) 대조로 **매칭 건수를 확인한 것만** 넣는다.
 *   추측으로 넣지 않는다(허위 별칭 = 오탐 = 거짓 경보 = 진짜 경보 사망).
 */

/** 룰의 한글 성분어 → 실제 어휘에서 찾을 검색어들(한글 이표기 + 영문 INN). 값은 소문자 비교. */
export const DUR_INGREDIENT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // ── 단일 성분(운영 DB ingredient 매칭 건수 주석 = 2026-08-18 실측)
  '와파린': ['와파린', '와르파린', 'warfarin'],                          // ingredient 4
  '아스피린': ['아스피린', 'aspirin', 'acetylsalicylic'],                 // 67 + 1
  '이부프로펜': ['이부프로펜', 'ibuprofen'],                              // 105
  '아세트아미노펜': ['아세트아미노펜', 'acetaminophen', 'paracetamol'],    // 343 + 2
  '메트포르민': ['메트포르민', 'metformin'],                              // 1,145
  '로사르탄': ['로사르탄', 'losartan'],                                   // 247
  '글리메피리드': ['글리메피리드', 'glimepiride'],                        // 236
  '플루코나졸': ['플루코나졸', 'fluconazole'],                            // 168
  '아목시실린': ['아목시실린', 'amoxicillin'],                            // 381
  '메토트렉세이트': ['메토트렉세이트', 'methotrexate'],                   // 15
  '시프로플록사신': ['시프로플록사신', 'ciprofloxacin'],                  // 110
  '테오필린': ['테오필린', 'theophylline'],                               // 3
  '클래리스로마이신': ['클래리스로마이신', '클래리트로마이신', 'clarithromycin'], // 189
  '아지스로마이신': ['아지스로마이신', '아지트로마이신', 'azithromycin'],  // 18 (name_ko 0)
  '아토르바스타틴': ['아토르바스타틴', 'atorvastatin'],                   // 662
  '암로디핀': ['암로디핀', 'amlodipine'],                                 // 1,369
  '시메티딘': ['시메티딘', 'cimetidine'],                                 // 23
  '졸피뎀': ['졸피뎀', 'zolpidem'],                                       // 16
  '오메프라졸': ['오메프라졸', 'omeprazole'],                             // 362
  '클로피도그렐': ['클로피도그렐', 'clopidogrel'],                        // 158
  '세티리진': ['세티리진', 'cetirizine'],                                 // 160
  '프레드니솔론': ['프레드니솔론', 'prednisolone'],                       // 103
  '트라마돌': ['트라마돌', 'tramadol'],                                   // 301
  '테트라사이클린': ['테트라사이클린', '테라싸이클린', '테트라싸이클린', 'tetracycline'], // 1 (name_ko 0)
  '세프트리악손': ['세프트리악손', 'ceftriaxone'],                        // 100
  '반코마이신': ['반코마이신', 'vancomycin'],                             // 25
  '겐타마이신': ['겐타마이신', 'gentamicin'],                             // 31
  '오셀타미비르': ['오셀타미비르', 'oseltamivir'],                        // 48
  // CDSS 신기능 용량조절 룰(cdss.service.ts)에서 쓰는 성분 — 같은 정본을 본다
  '가바펜틴': ['가바펜틴', 'gabapentin'],                                 // 149
  '에녹사파린': ['에녹사파린', 'enoxaparin'],                             // 9

  // ── 약효군(성분명이 아니라 계열) — 구성 성분으로 전개해야 매칭된다.
  //    종전엔 계열명 문자열을 ingredient 에서 찾았으므로 언어와 무관하게 100% 사멸이었다.
  'SSRI': ['escitalopram', 'citalopram', 'fluoxetine', 'paroxetine', 'sertraline', 'fluvoxamine',
           '에스시탈로프람', '시탈로프람', '플루옥세틴', '파록세틴', '설트랄린'],              // 302
  'MAO억제제': ['selegiline', 'rasagiline', 'moclobemide', 'linezolid',
                '셀레길린', '라사길린', '리네졸리드'],                                        // 35
  'ACE억제제': ['captopril', 'enalapril', 'ramipril', 'lisinopril', 'perindopril',
                '캅토프릴', '에날라프릴', '라미프릴', '리시노프릴', '페린도프릴'],            // 26
  '칼륨보존이뇨제': ['spironolactone', 'eplerenone', 'amiloride', 'triamterene',
                     '스피로노락톤', '에플레레논', '아밀로라이드'],                           // 4
  '조영제': ['iohexol', 'iopamidol', 'iodixanol', 'ioversol', 'iopromide', 'gadoterate',
             '이오헥솔', '이오파미돌', '이오디사놀'],                                          // 267
};

/**
 * 🔴 처방 어휘로는 **매칭될 수 없는** 룰어 — 봉합 대상이 아니라 사실이다.
 *  - '알코올'(음주): 원내 코드의 ethanol 243건은 전부 소독제·용제다. 별칭을 붙이면
 *    졸피뎀 처방마다 알코올솜으로 ERROR 가 뜬다(거짓 경보가 진짜 경보를 죽인다) → 붙이지 않는다.
 *  - '자몽'(식품): 원내 코드 0건. 식이 상호작용은 복약지도 영역이다.
 * 이 값들은 "고쳤다"고 말하지 않기 위해 명시적으로 남긴다(가드가 검증한다).
 */
export const NON_FORMULARY_TERMS: Readonly<Record<string, string>> = {
  '알코올': '음주(식이) — 원내 ethanol 코드는 소독제/용제라 매칭 시 전건 오탐',
  '자몽': '식품 — 원내 약품 코드 0건(복약지도 영역)',
};

/** 룰어 → 소문자 검색어 목록. 별칭 미등재어는 그 자체를 소문자로(무해한 기본값). */
export function ingredientMatchTerms(term: string): string[] {
  const raw = (term ?? '').trim();
  if (!raw) return [];
  const aliases = DUR_INGREDIENT_ALIASES[raw];
  return (aliases ? [...aliases] : [raw]).map((t) => t.toLowerCase()).filter(Boolean);
}

/** 약품 1건의 매칭 표면 — 검색 정본과 동일한 3원(nameKo·nameEn·ingredient)을 소문자로. */
export function buildMedicationHay(
  med: { ingredient?: string | null; nameKo?: string | null; nameEn?: string | null } | null | undefined,
): string {
  if (!med) return '';
  return `${med.ingredient ?? ''} ${med.nameKo ?? ''} ${med.nameEn ?? ''}`.toLowerCase();
}

/** hay(소문자)가 룰어에 해당하는가. 빈 hay/빈 룰어는 false(빈 문자열 전건 매칭 방지). */
export function hayMatchesTerm(hay: string, term: string): boolean {
  if (!hay) return false;
  const terms = ingredientMatchTerms(term);
  if (!terms.length) return false;
  return terms.some((t) => hay.includes(t));
}

/** 약품 객체가 룰어에 해당하는가(호출부 편의). */
export function medicationMatchesTerm(
  med: { ingredient?: string | null; nameKo?: string | null; nameEn?: string | null } | null | undefined,
  term: string,
): boolean {
  return hayMatchesTerm(buildMedicationHay(med), term);
}
