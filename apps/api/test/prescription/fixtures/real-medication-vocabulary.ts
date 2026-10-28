/**
 * 운영 DB(`his.example.org` · medication_codes 24,022행)에서 **그대로 뜬** 실제 약품 어휘 스냅샷.
 * 채취: 2026-08-18 · `SELECT code, name_ko, name_en, ingredient, ingredient_code, category`
 *
 * 🔴 이 파일이 존재하는 이유 — 종전 DUR 가드는 전부 다음 둘 중 하나였다:
 *   ① `DurService` 를 목(mock)으로 갈아끼우고 게이트만 검사(test/prescription/dur-enforce-gate.spec.ts)
 *   ② 서비스 로직을 스펙 안에 **다시 구현**하고 한글 성분명("와파린")을 먹임(test/phase2-dur.spec.ts)
 *  둘 다 초록이었고, 그 사이 운영에서는 55룰 중 42룰이 개통 이래 한 번도 매칭되지 않았다.
 *  판정 가드는 **실제 룰 × 실제 어휘**로만 의미가 있다. 지어낸 성분명을 넣지 말 것.
 *
 * 어휘의 사실(이 스냅샷이 증언하는 것):
 *  - ingredient 는 영문 INN 이고 용량이 붙어 있다("warfarin sodium   2mg").
 *  - name_ko 는 한글 상품명이라 성분 한글명을 담지 않는 경우가 많다(아자스건조시럽 ← azithromycin).
 *  - name_en 은 상당수 비어 있다.
 */
export interface RealMedRow {
  id: string;
  code: string;
  nameKo: string;
  nameEn: string | null;
  ingredient: string | null;
  ingredientCode: string | null;
  category: string | null;
}

const R = (code: string, nameKo: string, nameEn: string, ingredient: string, ingredientCode: string, category: string): RealMedRow => ({
  id: `med-${code}`, code, nameKo, nameEn: nameEn || null, ingredient: ingredient || null,
  ingredientCode: ingredientCode || null, category: category || null,
});

export const REAL_MEDICATIONS: RealMedRow[] = [
  R('645600390', '대화와르파린나트륨정2밀리그램', '', 'warfarin sodium   2mg', '249103ATB', '혈액응고저지제'),
  R('693902000', '클로피렐듀오캡슐', '', 'aspirin', '517900ACE', ''),
  R('M040703', '부루펜정 400mg', 'Brufen Tab 400mg', 'Ibuprofen', 'KR58404413', ''),
  R('52400500', '엘트라셋세미정', '', 'acetaminophen', '480600ATB', ''),
  R('M082301', '글루코파지정 500mg', 'Glucophage Tab 500mg', 'Metformin', 'KRDF2D894F', ''),
  R('M091501', '로사르탄정 50mg', 'Losartan Tab 50mg', 'Losartan', 'KRF0E726D5', ''),
  R('52401260', '글리메디정(글리메피리드)', '', 'glimepiride', '165702ATB', ''),
  R('52401580', '아이나졸캡슐(플루코나졸)', '', 'fluconazole', '159903ACH', ''),
  R('53500060', '아목시클라정375mg(아목시실린-클라불란산칼륨(2:1))', '', 'amoxicillin', '310600ATB', ''),
  R('642101470', '유한메토트렉세이트정', '', 'methotrexate   2.5mg', '192101ATB', '항악성종양제'),
  R('629700041', '시프록스주(시프로플록사신)', '', 'ciprofloxacin   0.2g(2mg/mL)', '134134BIJ', '기타 화학요법제'),
  R('652601360', '테올란비서방캡슐100밀리그램(테오필린)', '', 'theophylline   0.1g', '237001ACR', '진해거담제'),
  R('55102280', '클로시드정250밀리그램(클래리트로마이신)', '', 'clarithromycin', '134901ATB', ''),
  R('643901891', '아자스건조시럽(아지트로마이신수화물)', '', 'azithromycin', '112732ASY', ''),
  R('M091503', '리피토정 20mg', 'Lipitor Tab 20mg', 'Atorvastatin', 'KR2457FD36', ''),
  R('M091502', '노바스크정 5mg', 'Norvasc Tab 5mg', 'Amlodipine', 'KR78027CEE', ''),
  R('627500090', '티지피시메티딘정', '', 'cimetidine', '133301ATB', ''),
  R('M094202', '스틸녹스정 10mg', 'Stilnox Tab 10mg', 'Zolpidem', 'KR554ED1EC', ''),
  R('M065201', '오메프라졸캡슐 20mg', 'Omeprazole Cap 20mg', 'Omeprazole', 'KRAA04AA03', ''),
  R('M091505', '플라빅스정 75mg', 'Plavix Tab 75mg', 'Clopidogrel', 'KR5E81DD24', ''),
  R('M073101', '지르텍정 10mg', 'Zyrtec Tab 10mg', 'Cetirizine', 'KRD623C998', ''),
  R('M085601', '소론도정 5mg', 'Solondo Tab 5mg', 'Prednisolone', 'KR6218D7FC', ''),
  R('M040704', '트라몰정 50mg', 'Tramol Tab 50mg', 'Tramadol', 'KR06CF40F6', ''),
  R('643303740', '테라싸이클린캅셀250밀리그람(염산테트라싸이클린)', '', 'tetracycline hydrochloride   0.25g', '236701ACH', '항생물질(리케차·바이러스)'),
  R('M099903', '세프트리악손 주사 1g', 'Ceftriaxone Inj 1g', 'Ceftriaxone', 'KR53A4613E', ''),
  R('640002281', '씨제이염산반코마이신-주1그램', '', 'vancomycin hydrochloride   1g', '247203BIJ', '항생물질(그람양성균)'),
  R('648502446', '신풍겐타마이신황산염크림', '', 'gentamicin sulfate   0.25g(1mg/g)', '165138CCM', '항생물질(페니실린계 등)'),
  R('643507450', '한미플루캡슐30밀리그램(오셀타미비르)', '', 'oseltamivir   30mg', '646901ACH', '기타 화학요법제'),
  R('54800950', '가바론틴캡슐100밀리그램(가바펜틴)', '', 'gabapentin', '164201ACH', ''),
  R('648201721', '크녹산주(에녹사파린나트륨)', '', 'enoxaparin sodium   80mg(0.1g/mL)', '152134BIJ', '혈액응고저지제'),
  // 약효군 룰(계열명) 확인용 — 계열 구성 성분의 실제 행
  R('M094201', '렉사프로정 10mg', 'Lexapro Tab 10mg', 'Escitalopram', 'KR51D8FFEF', ''),          // SSRI
  R('644308750', '리녹사졸정600밀리그램(리네졸리드)', '', 'linezolid', '412901ATB', ''),            // MAO억제제
  R('641903510', '카프릴정25mg(캅토프릴)', '', 'captopril   25mg', '122902ATB', '혈압강하제'),      // ACE억제제
  R('648900610', '알닥톤필름코팅정25밀리그람(스피로노락톤)', '', 'spironolactone   25mg', '231101ATB', '이뇨제'), // 칼륨보존이뇨제
  R('52600011', '아이맥스이오헥솔300주', '', 'iohexol', '176340BIJ', ''),                            // 조영제
  // Beers 룰 확인용 실제 행
  R('57200130', '바리움정5밀리그람(디아제팜)', '', 'diazepam', '142903ATB', ''),
  R('640000090', '디고신정(디곡신)', '', 'digoxin   0.25mg', '144801ATB', '강심제'),
  R('657202640', '에나폰정5밀리그램(아미트리프틸린염산염)', '', 'amitriptyline hydrochloride   5mg', '107504ATB', '정신신경용제'),
  R('657200200', '리버티정5밀리그램(클로르디아제폭시드염산염)', '', 'chlordiazepoxide hydrochloride   5mg', '131202ATB', '정신신경용제'),
  R('650500351', '제일클로르페니라민말레산염주사액', '', 'chlorpheniramine maleate', '131830BIJ', ''),
  R('651300630', '본렉스이알캡슐15밀리그램(시클로벤자프린염산염)', '', 'cyclobenzaprine hydrochloride   15mg', '138702ACR', '골격근이완제'),
  R('640006660', '사일레노정3밀리그램(독세핀염산염)', '', 'doxepin hydrochloride (as doxepin   3mg)', '149203ATB', '최면진정제'),
  R('644801160', '아디팜정(히드록시진염산염)', '', 'hydroxyzine hydrochloride   10mg', '172101ATB', '정신신경용제'),
  R('670700371', '바이겔크림(인도메타신)', '', 'indomethacin   0.25g(10mg/g)', '174830CCM', '진통·진양·수렴·소염제'),
  R('652100130', '다오닐정(글리벤클라미드)', '', 'glibenclamide   5mg', '165402ATB', '당뇨병용제'),
  R('649801381', '명문염산페치딘주사', '', 'pethidine hydrochloride   50mg(50mg/mL)', '211531BIJ', '마약(합성)'),
  R('74200070', '부스코판당의정(부틸스코폴라민브롬화물)', '', 'hyoscine butylbromide', '172301ATB', ''),
];

export const findRealMed = (codeOrIngredient: string): RealMedRow => {
  const q = codeOrIngredient.toLowerCase();
  const hit = REAL_MEDICATIONS.find(
    (m) => m.code.toLowerCase() === q || (m.ingredient ?? '').toLowerCase().includes(q),
  );
  if (!hit) throw new Error(`fixture 에 '${codeOrIngredient}' 실제 약품 행이 없다 — 지어내지 말고 운영 DB 에서 떠올 것`);
  return hit;
};
