#!/usr/bin/env node
/**
 * scripts/country-concept-scan.mjs — 국가 전용(한국) 개념의 **재현 가능한 계측기**
 *
 * 기획 정본: docs/01-plan/features/country-governance-profile.plan.md (§1 실측 · §4 G1)
 * 목록 산출물: docs/03-analysis/country-concept-inventory-2026-09-07.md
 *
 * 왜 있는가
 *   기획서 §1 의 "한국 전용 개념 566/190" 은 **세는 규칙이 기록되지 않아 재현되지 않았다.**
 *   (재현 시도 2026-09-07: KCD·요양기관·산정특례·주민등록·본인부담·의료급여·심평원 은 정확히 일치,
 *    copay 246↔358·HIRA 122↔206 은 불일치 — 어느 쪽이 맞는지 판정할 근거가 남아 있지 않다.)
 *   system-scale.mjs 와 같은 이유로, 세는 규칙을 여기 코드로 못박는다.
 *
 * 사용법
 *   node scripts/country-concept-scan.mjs            # 규칙 + 부류별 표 + 화면 목록
 *   node scripts/country-concept-scan.mjs --rules    # 세는 규칙(포함/제외)만
 *   node scripts/country-concept-scan.mjs --terms    # 용어 레지스트리(부류·확신도·사유)
 *   node scripts/country-concept-scan.mjs --screens  # 개념을 가진 화면 목록만
 *   node scripts/country-concept-scan.mjs --modules  # 개념을 가진 API 모듈 목록만
 *   node scripts/country-concept-scan.mjs --silent   # 🔴 한국어 낱말이 없는 KR 전용 코드
 *   node scripts/country-concept-scan.mjs --unknown  # 🔴 판단이 안 선 것만
 *   node scripts/country-concept-scan.mjs --json     # 기계 판독용
 *   node scripts/country-concept-scan.mjs --check    # 동결값과 비교(많아도 적어도 실패)
 *   node scripts/country-concept-scan.mjs --freeze   # 현재 실측을 동결
 *
 * 🔴 규약 — 이 저장소가 반복해서 데인 자리들
 *   1. **계측만 한다.** 소스를 고쳐 숫자를 맞추지 않는다. G1 은 태깅이지 수정이 아니다.
 *   2. **분모를 반드시 함께 낸다.** "566곳" 은 전체가 얼마인지 모르면 아무 뜻이 없다.
 *   3. **모르는 것은 모른다고 센다.** `UNKNOWN` 티어는 추정으로 KR_ONLY 에 넣지 않는다.
 *      특히 `본인부담`/`copay` 는 **어느 나라에나 있는 개념**이다 — 갈라야 할 것은
 *      산정 규칙이지 개념 자체가 아니다. 이 구분을 흐리면 목록이 쓸모없어진다.
 *   4. **한글 부분일치 함정** — `수가` 는 `실수가·접수가·건수가·다수가` 에 걸린다.
 *      한글 어절 경계(`(?<![가-힣])`)를 쓴다. 이 함정이 없는 척하지 않는다.
 *   5. 파일시스템만 읽는다(런타임/DB 없음). 그래서 "운영 DB 의 KCD 18,184 행" 은 범위 밖이다.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, 'scripts', 'country-concept-scan.lock.json');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.next', '.turbo', 'coverage', '.git', 'build', 'out', '.expo',
]);

// ───────────────────────────────────────────────────────────── 부류(거버넌스 사슬)

/**
 * 기획서 §2 "거버넌스 → 레이아웃 사슬" 의 왼쪽 열을 그대로 부류로 쓴다.
 * 부류가 사슬과 어긋나면 목록이 "그래서 화면을 어떻게 고치나" 에 답하지 못한다.
 */
const CLASSES = {
  payer:    { label: '지불자·본인부담', layer: 'L3',  chain: '단일 지불자(건보공단) ↔ 다보험사 → 접수 자격조회·수납 블록' },
  claim:    { label: '청구·제출',      layer: 'L3/L4', chain: '관할 1(심평원) ↔ 3(DHA·DoH·MOHAP) → 제출처 선택 블록' },
  coding:   { label: '코드체계',        layer: 'L3',  chain: 'KCD-8·수가 ↔ ICD-10-AM·CPT → 진단 위젯·청구 라인' },
  identity: { label: '신원',            layer: 'L3',  chain: '주민등록번호 ↔ Emirates ID·여권 → 등록 폼 필드 구성' },
  form:     { label: '법정서식·법령',   layer: 'L3',  chain: '시행규칙 별지 ↔ 관할별 서식 → 인쇄 화면' },
  calendar: { label: '역법·주말',       layer: 'L4',  chain: '양력·토일 ↔ 히즈리 병기·금토 → 일정·근무표' },
  currency: { label: '(참고) 통화 표기', layer: 'L2',  chain: '🔴 이 축의 대상이 아니다(L2 로케일). 다만 KRW/₩ 하드코딩은 AE 에서 깨지므로 함께 센다' },
};

// ─────────────────────────────────────────────────────────────── 확신도(티어)

/**
 * 🔴 이 세 티어를 흐리면 목록이 쓸모없어진다.
 *
 *  KR_ONLY  — 한국의 **기관·법령·제도·코드체계 고유명**. 다른 나라에 그 이름의 것이 없다.
 *             → AE 화면에서 **빼거나 대체**해야 한다.
 *  KR_RULE  — 개념 자체는 어느 나라에나 있고, **규칙·값만** 한국 것이다.
 *             → AE 화면에서 **블록은 남고 규칙이 바뀐다**. 빼면 안 된다.
 *  UNKNOWN  — 기계적으로 갈리지 않는다(동음이의·문맥 의존·오탐 다수).
 *             → **사람이 읽어야 한다.** 추정해서 위 둘로 넣지 않는다.
 */
const TIERS = ['KR_ONLY', 'KR_RULE', 'UNKNOWN'];

// ─────────────────────────────────────────────────────── 용어 레지스트리 (정본)

/**
 * 각 항목: { id, cls, tier, re, why, ae }
 *   re  — 정규식. **한글 어절 경계**를 쓸 것(부분일치 함정).
 *   why — 왜 이 티어인가(사람이 검증할 수 있게).
 *   ae  — AE 에서 어떻게 되는가. **모르면 `null`** — 지어내지 않는다.
 */
const TERMS = [
  // ── payer ─────────────────────────────────────────────────────────────────
  { id: '산정특례', cls: 'payer', tier: 'KR_ONLY', re: /산정특례/,
    why: '국민건강보험 본인일부부담금 산정특례 — 한국 고시 제도의 고유명.',
    ae: '대응물 없음. AE 는 플랜별 코페이·연간 한도. 배지 자체를 빼고 "플랜 한도 잔액" 으로 대체' },
  { id: '의료급여', cls: 'payer', tier: 'KR_ONLY', re: /의료급여/,
    why: '의료급여법상 수급권자 제도(1종·2종) — 한국 고유 공공부조.',
    ae: null },
  { id: '차상위', cls: 'payer', tier: 'KR_ONLY', re: /차상위/,
    why: '차상위계층 — 한국 복지 분류 고유명.', ae: null },
  { id: '건강보험공단', cls: 'payer', tier: 'KR_ONLY', re: /국민건강보험|건강보험공단|(?<![가-힣])공단(?![가-힣])/,
    why: '단일 지불자 기관명. AE 는 다보험사(MULTI) 라 대응 기관이 없다.',
    ae: '기관 하나가 아니라 보험사 목록. 자격조회 EP 가 보험사별로 갈린다' },
  { id: '건강보험(제도)', cls: 'payer', tier: 'KR_ONLY', re: /(?<![가-힣])건강보험(?![가-힣])|(?<![가-힣])건보(?![가-힣])/,
    why: '국민건강보험 = 한국 단일 공보험 제도명.',
    ae: null },
  { id: '건강보험증', cls: 'payer', tier: 'KR_ONLY', re: /건강보험증/,
    why: '한국 건강보험증(증서) — AE 는 보험사 카드.', ae: null },
  { id: 'copay(영문)', cls: 'payer', tier: 'KR_RULE', re: /copay/i,
    why: '🔴 본인부담은 **어느 나라에나 있다.** 한국 전용인 것은 개념이 아니라 산정 규칙'
       + '(비급여>감면>코드 특례>자격 기본율). 이 항목을 KR_ONLY 로 세면 목록이 거짓이 된다.',
    ae: '블록은 그대로. 산정 규칙만 플랜별 코페이·연간 한도로 교체' },
  { id: '본인부담', cls: 'payer', tier: 'KR_RULE', re: /본인부담/,
    why: 'copay 와 같다 — 개념은 보편, 규칙이 KR.', ae: 'copay 와 동일' },
  { id: '비급여', cls: 'payer', tier: 'KR_RULE', re: /비급여/,
    why: '"보험 미적용 항목" 은 보편 개념. 다만 한국의 비급여는 **고지·보고 의무**(HIRA 연1회)가 붙은'
       + ' 법정 범주라, 보고 쪽 코드는 claim 부류로 따로 걸린다.',
    ae: '블록 유지·규칙 교체. 다만 "비급여 진료비 보고" 는 KR 전용(claim 참조)' },
  { id: '감면', cls: 'payer', tier: 'UNKNOWN', re: /(?<![가-힣])감면/,
    why: '🔴 판단 불가 — 보편적 "할인/감면" 인지 한국 법정 감면 자격(국가유공자·희귀난치 등)인지'
       + ' 문자열만으로 갈리지 않는다. 소비처를 사람이 읽어야 한다.', ae: null },
  { id: '보험자', cls: 'payer', tier: 'UNKNOWN', re: /보험자/,
    why: '🔴 판단 불가 — "payer" 일반어인지 한국 단일 보험자(공단) 지칭인지 문맥 의존.', ae: null },

  // ── claim ─────────────────────────────────────────────────────────────────
  { id: '심평원', cls: 'claim', tier: 'KR_ONLY', re: /심평원|건강보험심사평가원/,
    why: 'HIRA 한글 기관명 — 한국 단일 심사기관.', ae: 'AE 는 관할 3(DHA·DoH·MOHAP). 제출처 선택이 필요' },
  { id: 'HIRA', cls: 'claim', tier: 'KR_ONLY', re: /HIRA/,
    why: '심평원 영문 약칭. 🔴 모듈 디렉터리명(`hira/`)·import 경로에도 박혀 있어 계수가 크게 나온다'
       + ' — "개념 밀도" 가 아니라 "결합 정도" 로 읽어야 한다.',
    ae: '기관 자체가 없음. 제출 어댑터를 관할별로 갈라야 한다' },
  { id: '요양기관', cls: 'claim', tier: 'KR_ONLY', re: /요양기관/,
    why: '국민건강보험법상 요양기관(기호 포함) — 한국 고유. 개원 축이 이미 "이름이 그 나라 어휘를 담고'
       + ' 있으면 이미 국가 항목" 이라고 판정한 자리다.', ae: 'AE 는 관할별 facility license. 대응 개념은 있으나 발급처가 셋' },
  { id: '요양급여비용명세서', cls: 'claim', tier: 'KR_ONLY', re: /명세서/,
    why: '🔴 부분 확신 — `명세서` 단독은 보편어(itemized statement)일 수 있으나, 이 저장소에서는'
       + ' "비급여 진료비 명세서"·"요양급여비용 명세서" 로 쓰인다. 소비처 확인 필요.', ae: null },
  { id: 'EDI(청구전송)', cls: 'claim', tier: 'UNKNOWN', re: /(?<![A-Za-z])EDI(?![A-Za-z])/,
    why: '🔴 판단 불가 — EDI 는 국제 일반 표준어. 여기서는 대부분 "HIRA EDI 청구" 를 뜻하지만'
       + ' 문자열만으로는 갈리지 않는다(단어 경계를 걸어도 MEDIA·EDIT 오탐만 빠진다).', ae: null },
  { id: '청구', cls: 'claim', tier: 'KR_RULE', re: /(?<![가-힣])청구/,
    why: '보험 청구는 어느 나라에나 있다. 한국 전용인 것은 제출처·형식·주기.',
    ae: '블록 유지. 제출처가 1→3 이 되면서 "제출처 선택" 이 추가된다' },
  { id: '심사(청구심사)', cls: 'claim', tier: 'UNKNOWN', re: /(?<![가-힣])심사(?![가-힣])/,
    why: '🔴 판단 불가 — 청구심사(claim adjudication)·IRB 심사·자격심사·인증심사가 모두 같은 낱말이다.', ae: null },

  // ── coding ────────────────────────────────────────────────────────────────
  { id: 'KCD', cls: 'coding', tier: 'KR_ONLY', re: /KCD/,
    why: '한국표준질병사인분류 — ICD-10 파생이지만 코드 집합·자릿수가 한국 고유.',
    ae: 'AE 는 ICD-10-AM 계열. 진단 검색 정본·위젯이 갈린다' },
  { id: '상병', cls: 'coding', tier: 'KR_ONLY', re: /(?<!임)상병/,
    why: '"상병(傷病)" 은 한국 보험청구 어휘(상병코드·주상병·부상병). 임상 일반어 "진단" 과 구분된다. '
       + '🔴 `(?<!임)` 필수 — 없으면 **임상병리사**(clinical pathologist)가 통째로 걸린다(실측 오탐).',
    ae: 'AE 는 principal/secondary diagnosis. 어휘가 갈린다' },
  { id: '수가', cls: 'coding', tier: 'KR_ONLY', re: /(?<![가-힣])수가/,
    why: '건강보험 요양급여비용(수가) — 상대가치점수 기반 한국 고유 체계. '
       + '🔴 어절 경계 필수: `실수가·접수가·건수가·다수가·회수가` 오탐이 200건 넘는다.',
    ae: 'AE 는 CPT 계열. 청구 라인·오더 매핑이 갈린다' },
  { id: '상대가치', cls: 'coding', tier: 'KR_ONLY', re: /상대가치/,
    why: '상대가치점수 = 한국 수가 산정 기준.', ae: null },
  { id: '급여기준', cls: 'coding', tier: 'KR_ONLY', re: /급여기준/,
    why: '보건복지부 고시 요양급여 적용기준.', ae: null },

  // ── identity ──────────────────────────────────────────────────────────────
  { id: '주민등록번호', cls: 'identity', tier: 'KR_ONLY', re: /주민등록/,
    why: '한국 국민 고유 식별번호. 형식(생년월일+성별코드+검증숫자)까지 한국 전용.',
    ae: 'Emirates ID(15자리)·여권. 등록 폼 필드 구성과 검증기가 통째로 갈린다' },
  { id: 'RRN', cls: 'identity', tier: 'KR_ONLY', re: /(?<![A-Za-z])RRN(?![A-Za-z])/,
    why: '주민등록번호 영문 약칭.', ae: '위와 동일' },
  { id: '외국인등록번호', cls: 'identity', tier: 'KR_ONLY', re: /외국인등록/,
    why: '출입국관리법상 외국인등록번호 — 한국 발급.', ae: null },
  { id: 'residentNumber(필드명)', cls: 'identity', tier: 'KR_ONLY', re: /residentNumber|residentId(?![a-zA-Z])|residentIdMask|residentRegistration/,
    why: '주민등록번호의 영문 필드명. 실측으로 이 카멜케이스 계열은 전부 주민번호였다(전공의 뜻 0건).',
    ae: '필드 자체가 없어진다. Emirates ID·여권으로 대체' },
  { id: 'RESIDENT(환자유형)', cls: 'identity', tier: 'UNKNOWN', re: /(?<![A-Za-z_])RESIDENT(?![A-Za-z_])/,
    why: '🔴 판단 불가 — `RESIDENT`/`FOREIGN_RESIDENT` 환자 유형 enum. "거주자/비거주자" 구분은 '
       + '어느 나라에나 있지만, 이 저장소의 분기가 **주민등록번호 유무**로 서 있다면 KR 전용이 된다. '
       + '소비처를 사람이 읽어야 한다.', ae: null },

  // ── form ──────────────────────────────────────────────────────────────────
  { id: '시행규칙별지', cls: 'form', tier: 'KR_ONLY', re: /시행규칙|별지/,
    why: '한국 법령 서식 체계(시행규칙 별지 제N호 서식).', ae: '관할별(DHA/DoH/MOHAP) 서식. 대체 불가·재작성' },
  { id: '보건복지부', cls: 'form', tier: 'KR_ONLY', re: /보건복지부/, why: '한국 주무부처.', ae: null },
  { id: '질병관리청', cls: 'form', tier: 'KR_ONLY', re: /질병관리청/, why: '한국 감염병 신고 수신처(KDCA).', ae: null },
  { id: '의료법', cls: 'form', tier: 'KR_ONLY', re: /의료법/,
    why: '대한민국 의료법. 🔴 계수가 크지만 대부분 **주석·문서 문자열**이다 — 화면 블록 수가 아니다.', ae: null },
  { id: '약사법', cls: 'form', tier: 'KR_ONLY', re: /약사법/, why: '대한민국 약사법.', ae: null },
  { id: '전공의법', cls: 'form', tier: 'KR_ONLY', re: /전공의(?:법|\s*규정)/,
    why: '전공의의 수련환경 개선 및 지위 향상을 위한 법률 — 연속근무 80h 상한이 근무표 로직에 박혀 있다.',
    ae: null },
  { id: '응급의료법', cls: 'form', tier: 'KR_ONLY', re: /응급의료(?:법|에 관한)/, why: '응급의료에 관한 법률.', ae: null },
  { id: '마약류관리법', cls: 'form', tier: 'UNKNOWN', re: /마약류/,
    why: '🔴 판단 불가 — 향정·마약 관리는 어느 나라에나 있다. 한국 전용인 것은 `마약류관리법` 상'
       + ' 보고 의무(NIMS)와 분류 체계다. 문자열 `마약류` 만으로는 갈리지 않는다.', ae: null },
  { id: '연말정산·원천징수', cls: 'form', tier: 'KR_ONLY', re: /연말정산|원천징수|국세청/,
    why: '한국 소득세 제도(의료비 소득공제 자료 제출 포함).', ae: null },
  { id: '사업자등록', cls: 'form', tier: 'KR_ONLY', re: /사업자등록/, why: '한국 국세청 사업자등록번호.', ae: null },
  { id: '4대보험', cls: 'form', tier: 'KR_ONLY', re: /국민연금|고용보험|(?<![가-힣])산재보험/,
    why: '한국 사회보험 4종(인사·급여 축).', ae: null },
  { id: '진단서·처방전(서식)', cls: 'form', tier: 'UNKNOWN', re: /진단서|처방전/,
    why: '🔴 판단 불가 — 문서 자체는 보편. 한국 전용인 것은 **서식(별지 양식)과 기재사항**이다.'
       + ' 이 문자열이 "서식" 을 가리키는지 "문서 일반" 을 가리키는지 문맥 의존.', ae: null },

  // ── calendar ──────────────────────────────────────────────────────────────
  { id: '공휴일', cls: 'calendar', tier: 'KR_ONLY', re: /공휴일/,
    why: '관공서의 공휴일에 관한 규정 — 한국 달력. 🔴 소비처가 KR 공휴일표를 하드코딩하는지'
       + ' 설정에서 읽는지는 이 스캐너가 판정하지 않는다(문자열 계측만).',
    ae: 'UAE 공휴일(히즈리 이동 축일). 주말도 금토가 아니라 토일로 바뀐 이력이 있어 값 확인 필요' },
  { id: '음력·간지', cls: 'calendar', tier: 'KR_ONLY', re: /음력|(?<![가-힣])간지(?![가-힣])/, why: '한국 역법.', ae: null },

  // ── currency (참고 · L2) ──────────────────────────────────────────────────
  // 🔴 `원화` 에 어절 경계 필수 — 없으면 **이원화·일원화**(dualize/unify)가 걸린다(실측 오탐 11건).
  { id: 'KRW·원화·₩', cls: 'currency', tier: 'KR_ONLY', re: /(?<![A-Za-z])KRW(?![A-Za-z])|(?<![가-힣])원화|₩/,
    why: '🔴 이 축(L3 거버넌스)의 대상이 아니다 — L2 로케일 서식이다. 그래도 AE 화면에서 깨지므로'
       + ' 함께 센다. 정본은 표시 부품(`Money`)이고, 하드코딩 `₩` 는 그 정본을 우회한 자리다.',
    ae: 'AED. 표시 부품 정본을 쓰는 곳은 자동, 하드코딩은 개별 수정' },
];

// ─────────────────────────────────────────────────────────── 계측 표면(surface)

/**
 * 표면마다 **분모**(파일 수·코드 행 수)를 함께 낸다.
 * 🔴 분모 없이 "566곳" 만 말하면 큰지 작은지 알 수 없다 — 이 저장소가 반복해서 데인 자리.
 */
const SURFACES = [
  { key: 'api',      base: 'apps/api/src',        exts: ['.ts'],          label: 'API (apps/api/src)',
    exclude: (f) => f.endsWith('.spec.ts') },
  { key: 'web',      base: 'apps/web/src',        exts: ['.ts', '.tsx'],  label: 'Web 전체 (apps/web/src)',
    exclude: (f) => /\.(spec|test)\.tsx?$/.test(f) },
  { key: 'webApp',   base: 'apps/web/src/app',    exts: ['.ts', '.tsx'],  label: 'Web 라우트 (apps/web/src/app) — 화면',
    exclude: (f) => /\.(spec|test)\.tsx?$/.test(f) },
  { key: 'shared',   base: 'packages/shared/src', exts: ['.ts'],          label: 'Shared (packages/shared/src)',
    exclude: (f) => /\.(spec|test)\.ts$/.test(f) },
  { key: 'mobile',   base: 'apps/mobile',         exts: ['.ts', '.tsx'],  label: 'Mobile (apps/mobile)',
    exclude: (f) => /\.(spec|test)\.tsx?$/.test(f) },
  { key: 'homepage', base: 'apps/homepage',       exts: ['.ts', '.tsx'],  label: 'Homepage 앱 (apps/homepage)',
    exclude: (f) => /\.(spec|test)\.tsx?$/.test(f) },
  { key: 'prisma',   base: 'apps/api/prisma',     exts: ['.prisma'],      label: 'Prisma 스키마',
    exclude: () => false },
];

// ───────────────────────────────────────────────────────────────── 수집 유틸

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

function surfaceFiles(s) {
  return walk(join(ROOT, s.base))
    .filter((p) => s.exts.some((e) => p.endsWith(e)))
    .filter((p) => !s.exclude(rel(p)))
    .sort();
}

/**
 * 계수 단위 = **행(line)**. 한 행에 같은 용어가 두 번 나와도 1이다.
 * 🔴 용어끼리는 독립으로 센다 — 한 행에 `본인부담` 과 `산정특례` 가 같이 있으면 **양쪽 모두** 센다.
 *    그래서 부류별 합계는 "행 수" 가 아니라 "용어×행 매칭 수" 다. 합계에 중복이 있다는 사실을 숨기지 않는다.
 *    화면 단위 판정에는 중복 없는 `hitLines`(고유 행 수)를 따로 쓴다.
 */
function scanFile(path) {
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const perTerm = {};
  const hitLineNos = new Set();
  for (const t of TERMS) {
    let n = 0;
    lines.forEach((l, i) => { if (t.re.test(l)) { n++; hitLineNos.add(i); } });
    if (n) perTerm[t.id] = n;
  }
  return { perTerm, hitLines: hitLineNos.size, totalLines: lines.length };
}

function scanSurface(s) {
  const files = surfaceFiles(s);
  const perTerm = {};
  const perTermFiles = {};
  let totalLines = 0, hitLines = 0, hitFiles = 0;
  const fileHits = [];
  for (const f of files) {
    const r = scanFile(f);
    totalLines += r.totalLines;
    if (r.hitLines) {
      hitLines += r.hitLines; hitFiles++;
      fileHits.push({ file: rel(f), hitLines: r.hitLines, terms: r.perTerm });
    }
    for (const [id, n] of Object.entries(r.perTerm)) {
      perTerm[id] = (perTerm[id] || 0) + n;
      perTermFiles[id] = (perTermFiles[id] || 0) + 1;
    }
  }
  return { key: s.key, label: s.label, files: files.length, totalLines, hitFiles, hitLines, perTerm, perTermFiles, fileHits };
}

// ─────────────────────────────────────────────── 대조군: 국가로 갈리는 코드(이미 있는 것)

/**
 * 🔴 이 값이 **분모의 반대편**이다 — "국가를 아는 코드" 가 몇 개인가.
 * 기획서 §1 이 5 라고 적은 자리. 세는 규칙을 여기 못박는다.
 * 포함: `hospital.country` 설정 키를 읽거나, `countries` 배열로 국가를 분기하거나,
 *       CountryCode 타입을 쓰는 파일. 제외: 주소 필드의 `country`(우편 주소는 거버넌스가 아니다).
 */
const COUNTRY_AWARE_RE = /hospital\.country|CountryCode|\bcountries\s*[:?]|COUNTRY_(?:KR|AE|CODES)/;
function countryAwareFiles() {
  const out = [];
  for (const s of SURFACES) {
    for (const f of surfaceFiles(s)) {
      const src = readFileSync(f, 'utf8');
      if (COUNTRY_AWARE_RE.test(src)) out.push(rel(f));
    }
  }
  return [...new Set(out)].sort();
}

// ────────────────────────────────────────────────────────── 화면(page.tsx) 목록

/**
 * "한국 전용 개념을 가진 화면" 의 정본 규칙:
 *   화면 = apps/web/src/app/**\/page.tsx 한 파일.
 *   🔴 **화면 파일만 본다**(같은 디렉터리의 컴포넌트는 세지 않는다) — 기획서 §1 의 34면과
 *      비교 가능하게 하기 위해서다. 컴포넌트까지 넣으면 다른 수가 나오고, 그 사실을 detail 로 밝힌다.
 *   화면의 티어 = 그 화면이 가진 용어들의 **가장 강한 티어**(KR_ONLY > KR_RULE > UNKNOWN).
 *      → KR_ONLY 가 하나라도 있으면 "AE 에서 손대야 하는 화면" 이다.
 */
function screenInventory() {
  const base = join(ROOT, 'apps/web/src/app');
  const pages = walk(base).filter((p) => p.endsWith('page.tsx')).sort();
  const rows = [];
  for (const p of pages) {
    const r = scanFile(p);
    const ids = Object.keys(r.perTerm);
    if (!ids.length) continue;
    const tiers = new Set(ids.map((id) => TERMS.find((t) => t.id === id).tier));
    const clsSet = new Set(ids.map((id) => TERMS.find((t) => t.id === id).cls));
    rows.push({
      screen: relative(base, p).split(sep).join('/').replace(/\/page\.tsx$/, '') || '(root)',
      file: rel(p),
      hitLines: r.hitLines,
      tier: tiers.has('KR_ONLY') ? 'KR_ONLY' : tiers.has('KR_RULE') ? 'KR_RULE' : 'UNKNOWN',
      classes: [...clsSet].sort(),
      terms: r.perTerm,
    });
  }
  rows.sort((a, b) => b.hitLines - a.hitLines || a.screen.localeCompare(b.screen));
  return { pages: pages.length, rows };
}

// ───────────────────────────────────── 🔴 조용한 결합 — 한국어 낱말이 없는 KR 전용 코드

/**
 * 🔴 **용어 스캔이 구조적으로 놓치는 부류다.**
 *
 * G1 화면 조사(2026-09-07)에서 드러났다: 한국 전용인데 **한국어 낱말이 하나도 없어서**
 * 위 용어 레지스트리가 통째로 못 잡는 코드가 있다. 예:
 *   · `/^0\d{1,2}-?\d{3,4}-?\d{4}$/`  ← 한국 전화번호 정규식(환자 등록 폼 검증)
 *   · `toLocaleString('ko-KR')`        ← 로케일 하드코딩
 *   · `'B-1'|'F-4'|'E-9'`              ← 한국 출입국관리법 체류자격 코드
 *   · 초성(ㄱㄴㄷ) 인덱스               ← 한글 이름 전용 UI
 *
 * 🔴 **이 목록을 "전부"라고 말하지 않는다.** 화면 34면을 사람이 읽어 발견한 것이고,
 *    읽지 않은 화면에는 더 있을 수 있다. **분모를 알 수 없는 탐지기**다 —
 *    그래서 위 부류 집계에 **더하지 않고 따로 낸다**(섞으면 합계가 거짓이 된다).
 */
const SILENT_PATTERNS = [
  { id: 'KR 전화번호 정규식', re: /\^0\\d\{1,\s*2\}|\\d\{3,4\}-\?\\d\{4\}/,
    why: '`010-0000-0000` 형태만 통과시키는 검증. AE 번호(+971)가 막힌다.' },
  { id: "로케일 'ko-KR' 하드코딩", re: /['"`]ko-KR['"`]/,
    why: '표시 부품 정본(KDate·Money)을 우회해 날짜·숫자를 한국 서식으로 굳힌다.' },
  { id: '국가번호 +82 하드코딩', re: /\+82/,
    why: '전화번호 표기·안내 문구에 한국 국가번호가 박혀 있다.' },
  { id: '한국 체류자격 코드', re: /['"`](?:[BCDEFGH]-\d{1,2})['"`]\s*,?\s*label|VISA_TYPES/,
    why: '출입국관리법 체류자격(B-1·F-4·E-9…). AE 비자 체계와 대응하지 않는다.' },
  { id: '한글 초성 인덱스', re: /chosung|CHO_LIST|ㄱ.{0,4}ㄴ.{0,4}ㄷ/,
    why: '한글 이름 전용 탐색 UI. 아랍어·라틴 문자 이름에는 의미가 없다.' },
  { id: '한국 카드사 목록', re: /CARD_COMPANIES|삼성카드|신한카드|BC카드/,
    why: '결제수단 마스터가 화면 상수. AE 결제사와 다르다.' },
  { id: 'KRW 통화 코드', re: /['"`]KRW['"`]/,
    why: '통화 코드 하드코딩(L2 이지만 AE 에서 깨진다).' },
];

/**
 * 🔴 표면들은 서로 겹친다 — `apps/web/src` 는 `apps/web/src/app` 을 **포함한다**.
 *    부류 집계는 표면별로 따로 내므로 겹쳐도 되지만, 여기 합계는 저장소 전체 하나의 수라서
 *    **경로로 중복을 제거해야 한다.** (재주입 검증에서 한 파일이 `+2행` 으로 세어져 드러났다.)
 */
function allScannedFiles() {
  const seen = new Map();
  for (const s of SURFACES) for (const f of surfaceFiles(s)) seen.set(rel(f), f);
  return [...seen.values()];
}

function scanSilent() {
  const all = allScannedFiles();
  const rows = [];
  for (const p of SILENT_PATTERNS) {
    let lines = 0; const files = new Set();
    for (const f of all) {
      const n = readFileSync(f, 'utf8').split('\n').filter((l) => p.re.test(l)).length;
      if (n) { lines += n; files.add(rel(f)); }
    }
    rows.push({ id: p.id, why: p.why, lines, files: files.size, sample: [...files].slice(0, 3) });
  }
  rows.sort((a, b) => b.files - a.files);
  return rows;
}

function printSilent(m) {
  console.log(`\n## 7. 🔴 조용한 결합 — 한국어 낱말이 없는 KR 전용 코드\n`);
  console.log(`용어 스캔이 **구조적으로 못 잡는** 부류다. 위 부류 집계에 **더하지 않는다**.`);
  console.log(`🔴 이 목록은 화면 34면을 사람이 읽어 발견한 것이라 **분모를 알 수 없다** — "전부"가 아니다.\n`);
  console.log('| 패턴 | 파일 | 행 | 왜 위험한가 |');
  console.log('|------|-----:|---:|-------------|');
  for (const r of m.silent) console.log(`| ${r.id} | ${r.files} | ${r.lines} | ${r.why} |`);
}

// ────────────────────────────────────────────────────────── 모듈(API) 집계

/**
 * API 도메인 모듈별 집계 — 화면 목록의 뒷면이다.
 * 모듈 = `apps/api/src/modules/<name>` 1단계 디렉터리(system-scale.mjs 와 같은 규칙).
 * 🔴 여기서도 분모를 낸다: 모듈 전체 수 대비 개념을 가진 모듈 수.
 */
function moduleInventory() {
  const base = join(ROOT, 'apps/api/src/modules');
  if (!existsSync(base)) return { total: 0, rows: [] };
  const names = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const rows = [];
  for (const name of names) {
    const files = walk(join(base, name)).filter((p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
    const perTerm = {};
    let hitLines = 0, totalLines = 0;
    for (const f of files) {
      const r = scanFile(f);
      totalLines += r.totalLines; hitLines += r.hitLines;
      for (const [id, n] of Object.entries(r.perTerm)) perTerm[id] = (perTerm[id] || 0) + n;
    }
    if (!hitLines) continue;
    const ids = Object.keys(perTerm);
    const tiers = new Set(ids.map((id) => TERMS.find((t) => t.id === id).tier));
    rows.push({
      module: name, files: files.length, totalLines, hitLines,
      tier: tiers.has('KR_ONLY') ? 'KR_ONLY' : tiers.has('KR_RULE') ? 'KR_RULE' : 'UNKNOWN',
      classes: [...new Set(ids.map((id) => TERMS.find((t) => t.id === id).cls))].sort(),
      terms: perTerm,
    });
  }
  rows.sort((a, b) => b.hitLines - a.hitLines || a.module.localeCompare(b.module));
  return { total: names.length, rows };
}

function printModules(m) {
  const { total, rows } = m.modules;
  console.log(`\n## 6. 한국 전용 개념을 가진 API 모듈\n`);
  console.log(`분모: \`apps/api/src/modules/*\` **${total}개** 중 **${rows.length}개**(${pct(rows.length, total)})`);
  console.log(`- KR_ONLY 포함 **${rows.filter((r) => r.tier === 'KR_ONLY').length}개**`);
  console.log(`- KR_RULE 만 **${rows.filter((r) => r.tier === 'KR_RULE').length}개**`);
  console.log(`- 🔴 UNKNOWN 만 **${rows.filter((r) => r.tier === 'UNKNOWN').length}개**\n`);
  console.log('| # | 모듈 | 티어 | 부류 | 개념 행 | 모듈 행(분모) | 밀도 | 상위 용어 |');
  console.log('|--:|------|------|------|--------:|--------------:|-----:|-----------|');
  rows.forEach((r, i) => {
    const top = Object.entries(r.terms).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(`| ${i + 1} | \`${r.module}\` | ${r.tier === 'UNKNOWN' ? '🔴 UNKNOWN' : r.tier} | ${r.classes.map((c) => CLASSES[c].label).join('·')} | ${r.hitLines} | ${num(r.totalLines)} | ${pct(r.hitLines, r.totalLines)} | ${top} |`);
  });
}

// ─────────────────────────────────────────────────────────────────── 집계

function measureAll() {
  const surfaces = SURFACES.map(scanSurface);
  const screens = screenInventory();
  const modules = moduleInventory();
  const silent = scanSilent();
  const countryAware = countryAwareFiles();

  // 부류별 합계(전 표면 합)
  const byClass = {};
  for (const c of Object.keys(CLASSES)) byClass[c] = { KR_ONLY: 0, KR_RULE: 0, UNKNOWN: 0, total: 0 };
  for (const s of surfaces) {
    for (const [id, n] of Object.entries(s.perTerm)) {
      const t = TERMS.find((x) => x.id === id);
      byClass[t.cls][t.tier] += n;
      byClass[t.cls].total += n;
    }
  }
  const byTier = { KR_ONLY: 0, KR_RULE: 0, UNKNOWN: 0 };
  for (const c of Object.values(byClass)) for (const t of TIERS) byTier[t] += c[t];

  return { surfaces, screens, modules, silent, countryAware, byClass, byTier };
}

// 동결 대상 — 🔴 파일 목록이 아니라 **수치**만 동결한다(경로 리팩터로 깨지지 않게).
function lockValues(m) {
  const v = {
    countryAwareFiles: m.countryAware.length,
    screensWithConcept: m.screens.rows.length,
    screensKrOnly: m.screens.rows.filter((r) => r.tier === 'KR_ONLY').length,
    screensKrRule: m.screens.rows.filter((r) => r.tier === 'KR_RULE').length,
    screensUnknownOnly: m.screens.rows.filter((r) => r.tier === 'UNKNOWN').length,
    modulesWithConcept: m.modules.rows.length,
    modulesKrOnly: m.modules.rows.filter((r) => r.tier === 'KR_ONLY').length,
    silentFiles: m.silent.reduce((n, r) => n + r.files, 0),
    silentLines: m.silent.reduce((n, r) => n + r.lines, 0),
    tier_KR_ONLY: m.byTier.KR_ONLY,
    tier_KR_RULE: m.byTier.KR_RULE,
    tier_UNKNOWN: m.byTier.UNKNOWN,
  };
  for (const [c, x] of Object.entries(m.byClass)) v[`class_${c}`] = x.total;
  for (const s of m.surfaces) { v[`surface_${s.key}_hitLines`] = s.hitLines; v[`surface_${s.key}_hitFiles`] = s.hitFiles; }
  return v;
}

// ──────────────────────────────────────────────────────────────────── 출력

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (a, b) => (b === 0 ? '산출 불가' : `${((a / b) * 100).toFixed(2)}%`);

function printRules() {
  console.log(`# 국가 전용 개념 계수 규칙 (정본: scripts/country-concept-scan.mjs)\n`);
  console.log(`## 계수 단위`);
  console.log(`- 단위는 **행(line)**. 한 행에 같은 용어가 두 번 나와도 1.`);
  console.log(`- 용어끼리는 **독립**으로 센다 → 부류 합계는 "용어×행 매칭 수"이고 **중복을 포함한다**.`);
  console.log(`  화면 단위 판정에는 중복 없는 고유 행 수(hitLines)를 쓴다. 두 수가 다른 것은 정상이다.`);
  console.log(`- 🔴 한글 부분일치 함정: \`수가\` 는 \`실수가·접수가·건수가·다수가\` 에 걸린다.`);
  console.log(`  어절 경계 \`(?<![가-힣])\` 를 건다. 걸지 않으면 200건 넘게 부풀어 오른다.\n`);
  console.log(`## 표면(분모)`);
  for (const s of SURFACES) console.log(`- **${s.label}** — 확장자 ${s.exts.join('/')}, 테스트 파일 제외`);
  console.log(`\n## 화면(page.tsx) 규칙`);
  console.log(`- 화면 = \`apps/web/src/app/**/page.tsx\` 한 파일. 같은 디렉터리의 컴포넌트는 **세지 않는다**.`);
  console.log(`- 화면 티어 = 가진 용어 중 가장 강한 티어(KR_ONLY > KR_RULE > UNKNOWN).\n`);
  console.log(`## 확신도(티어) — 🔴 이걸 흐리면 목록이 쓸모없어진다`);
  console.log(`- **KR_ONLY** — 한국 기관·법령·제도·코드체계의 고유명. AE 에서 **빼거나 대체**.`);
  console.log(`- **KR_RULE** — 개념은 보편, 규칙·값만 KR. AE 에서 **블록은 남고 규칙이 바뀐다**. 빼면 안 된다.`);
  console.log(`- **UNKNOWN** — 기계적으로 안 갈린다(동음이의·문맥 의존). **사람이 읽어야 한다.**\n`);
  console.log(`## 계측하지 않는 것`);
  console.log(`- 운영 DB 행 수(KCD 18,184 · 약품 24,022) — 파일시스템 밖.`);
  console.log(`- "이 코드가 실제로 KR 규칙을 적용하는가" — 문자열 계측은 **결합의 흔적**만 본다.`);
  console.log(`  ex) \`HIRA\` 계수가 큰 것은 개념 밀도가 아니라 모듈 디렉터리명(\`hira/\`) import 때문이다.`);
  console.log(`- 주석·문서 문자열과 실행 코드를 구분하지 않는다(\`의료법\` 대부분이 주석이다).\n`);
}

function printTerms() {
  console.log(`# 용어 레지스트리 (${TERMS.length}개)\n`);
  for (const c of Object.keys(CLASSES)) {
    const ts = TERMS.filter((t) => t.cls === c);
    if (!ts.length) continue;
    console.log(`## ${CLASSES[c].label} [${CLASSES[c].layer}]`);
    console.log(`> 사슬: ${CLASSES[c].chain}\n`);
    for (const t of ts) {
      console.log(`- **${t.id}** \`${t.tier}\` — ${t.why}`);
      console.log(`  - AE: ${t.ae ?? '🔴 **모른다** — 조사되지 않았다(지어내지 않는다)'}`);
    }
    console.log('');
  }
}

function printMain(m) {
  console.log(`# 국가 전용(한국) 개념 실측 — ${new Date().toISOString().slice(0, 10)}\n`);

  console.log(`## 1. 표면별 (분모 병기)\n`);
  console.log('| 표면 | 파일(분모) | 개념 보유 파일 | 비율 | 코드 행(분모) | 개념 행 | 비율 |');
  console.log('|------|-----------:|---------------:|-----:|--------------:|--------:|-----:|');
  for (const s of m.surfaces) {
    console.log(`| ${s.label} | ${num(s.files)} | ${num(s.hitFiles)} | ${pct(s.hitFiles, s.files)} | ${num(s.totalLines)} | ${num(s.hitLines)} | ${pct(s.hitLines, s.totalLines)} |`);
  }

  console.log(`\n## 2. 부류별 × 확신도 (용어×행 매칭 수 · 전 표면 합)\n`);
  console.log('| 부류 | 층 | KR_ONLY | KR_RULE | 🔴 UNKNOWN | 합 |');
  console.log('|------|----|--------:|--------:|-----------:|---:|');
  for (const [c, x] of Object.entries(m.byClass)) {
    console.log(`| ${CLASSES[c].label} | ${CLASSES[c].layer} | ${num(x.KR_ONLY)} | ${num(x.KR_RULE)} | ${num(x.UNKNOWN)} | ${num(x.total)} |`);
  }
  const tot = m.byTier.KR_ONLY + m.byTier.KR_RULE + m.byTier.UNKNOWN;
  console.log(`| **합** | | **${num(m.byTier.KR_ONLY)}** | **${num(m.byTier.KR_RULE)}** | **${num(m.byTier.UNKNOWN)}** | **${num(tot)}** |`);
  console.log(`\n확신도 비중: KR_ONLY ${pct(m.byTier.KR_ONLY, tot)} · KR_RULE ${pct(m.byTier.KR_RULE, tot)} · UNKNOWN ${pct(m.byTier.UNKNOWN, tot)}`);
  console.log(`🔴 UNKNOWN 은 "한국 전용이 아니다" 가 아니라 **"모른다"** 다. 사람이 읽어야 하는 몫.`);

  console.log(`\n## 3. 용어별 (표면 합 · 상위부터)\n`);
  console.log('| 용어 | 부류 | 확신도 | 매칭 행 | 파일 |');
  console.log('|------|------|--------|--------:|-----:|');
  const agg = {};
  for (const s of m.surfaces) for (const [id, n] of Object.entries(s.perTerm)) {
    agg[id] = agg[id] || { n: 0, f: 0 };
    agg[id].n += n; agg[id].f += s.perTermFiles[id] || 0;
  }
  for (const t of TERMS) {
    const a = agg[t.id];
    console.log(`| ${t.id} | ${CLASSES[t.cls].label} | ${t.tier === 'UNKNOWN' ? '🔴 UNKNOWN' : t.tier} | ${a ? num(a.n) : 0} | ${a ? num(a.f) : 0} |`);
  }

  console.log(`\n## 4. 국가를 **이미 아는** 코드 (대조군)\n`);
  console.log(`파일 ${m.countryAware.length}개 — 규칙: \`${COUNTRY_AWARE_RE.source}\``);
  for (const f of m.countryAware) console.log(`  - ${f}`);
  console.log(`\n🔴 이 수가 개념 수(위)보다 압도적으로 작다는 것이 §1 의 결론이다: **KR 이 이름 없는 기본값이다.**`);

  printScreens(m);
  printModules(m);
  printSilent(m);
}

function printScreens(m) {
  const r = m.screens.rows;
  console.log(`\n## 5. 한국 전용 개념을 가진 화면\n`);
  console.log(`분모: \`apps/web/src/app/**/page.tsx\` **${m.screens.pages}면** 중 **${r.length}면**(${pct(r.length, m.screens.pages)})`);
  const ko = r.filter((x) => x.tier === 'KR_ONLY');
  const kr = r.filter((x) => x.tier === 'KR_RULE');
  const un = r.filter((x) => x.tier === 'UNKNOWN');
  console.log(`- KR_ONLY 포함(AE 에서 손대야 함) **${ko.length}면**`);
  console.log(`- KR_RULE 만(블록 유지·규칙 교체) **${kr.length}면**`);
  console.log(`- 🔴 UNKNOWN 만(사람이 읽어야 함) **${un.length}면**\n`);
  console.log('| # | 화면 | 티어 | 부류 | 개념 행 | 용어 |');
  console.log('|--:|------|------|------|--------:|------|');
  r.forEach((x, i) => {
    const terms = Object.entries(x.terms).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(`| ${i + 1} | \`${x.screen}\` | ${x.tier === 'UNKNOWN' ? '🔴 UNKNOWN' : x.tier} | ${x.classes.map((c) => CLASSES[c].label).join('·')} | ${x.hitLines} | ${terms} |`);
  });
}

function printUnknown(m) {
  console.log(`# 🔴 판단이 안 선 것 — 사람이 읽어야 하는 몫\n`);
  console.log(`## 용어(${TERMS.filter((t) => t.tier === 'UNKNOWN').length}개)\n`);
  const agg = {};
  for (const s of m.surfaces) for (const [id, n] of Object.entries(s.perTerm)) agg[id] = (agg[id] || 0) + n;
  for (const t of TERMS.filter((x) => x.tier === 'UNKNOWN')) {
    console.log(`- **${t.id}** (${agg[t.id] || 0}행) — ${t.why}`);
  }
  console.log(`\n## AE 대응이 조사되지 않은 용어(${TERMS.filter((t) => !t.ae).length}개)\n`);
  for (const t of TERMS.filter((x) => !x.ae)) console.log(`- ${t.id} \`${t.tier}\``);
  console.log(`\n🔴 이 목록은 "AE 에서 어떻게 되는지 **조사한 적이 없다**" 는 뜻이다. 추정해서 채우지 않는다.`);
}

// ──────────────────────────────────────────────────────────────────── 실행

const args = new Set(process.argv.slice(2));

if (args.has('--rules')) { printRules(); process.exit(0); }
if (args.has('--terms')) { printTerms(); process.exit(0); }

const m = measureAll();

if (args.has('--json')) {
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString().slice(0, 10),
    classes: CLASSES,
    terms: TERMS.map((t) => ({ id: t.id, cls: t.cls, tier: t.tier, re: t.re.source, why: t.why, ae: t.ae })),
    surfaces: m.surfaces.map((s) => ({ ...s, fileHits: undefined })),
    byClass: m.byClass, byTier: m.byTier,
    countryAware: m.countryAware,
    screens: { total: m.screens.pages, rows: m.screens.rows },
    lock: lockValues(m),
  }, null, 2));
  process.exit(0);
}

if (args.has('--screens')) { printScreens(m); process.exit(0); }
if (args.has('--modules')) { printModules(m); process.exit(0); }
if (args.has('--silent')) { printSilent(m); process.exit(0); }
if (args.has('--unknown')) { printUnknown(m); process.exit(0); }

/**
 * 🔴 동결 시점의 트리 상태를 함께 기록한다 — `system-scale.mjs` 선례.
 *    병렬 작업 중에 동결하면 기준선이 남의 미커밋 변경을 흡수하고,
 *    그 뒤 `--check` 실패가 "결함"인지 "그 작업이 랜딩된 것"인지 구분되지 않는다.
 */
function gitProvenance() {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim();
    return { head, dirty: dirty ? dirty.split('\n').length : 0 };
  } catch { return null; }
}

if (args.has('--freeze')) {
  const prov = gitProvenance();
  writeFileSync(LOCK, JSON.stringify({
    note: 'country-concept-scan.mjs --check 의 동결값. 커지든 작아지든 다르면 실패한다. '
        + 'G1 은 기준선 동결이 목적이다 — 새 한국 전용 개념이 프로파일 없이 들어오면 여기서 걸린다.',
    frozenAt: new Date().toISOString().slice(0, 10),
    gitHead: prov?.head ?? null,
    dirtyFilesAtFreeze: prov?.dirty ?? null,
    dirtyWarning: prov && prov.dirty > 0
      ? '🔴 동결 시점에 미커밋 변경이 ' + prov.dirty + '건 있었다(병렬 작업 중일 수 있음). '
        + '전부 랜딩된 뒤 다시 --freeze 하라 — 그 전까지 --check 실패는 결함이 아니다.'
      : undefined,
    values: lockValues(m),
  }, null, 2) + '\n');
  console.log(`frozen → ${relative(ROOT, LOCK)}`);
  if (prov && prov.dirty > 0) {
    console.log(`🔴 미커밋 변경 ${prov.dirty}건 상태에서 동결했다. 병렬 작업이 랜딩되면 재동결이 필요하다.`);
  }
  process.exit(0);
}

if (args.has('--check')) {
  if (!existsSync(LOCK)) {
    console.error('동결값이 없다. 먼저 `node scripts/country-concept-scan.mjs --freeze` 를 실행하라.');
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const now = lockValues(m);
  const diffs = [];
  for (const k of new Set([...Object.keys(lock.values), ...Object.keys(now)])) {
    const a = lock.values[k], b = now[k];
    if (a === undefined) { diffs.push(`+ ${k}: 동결값에 없는 신규 지표 (현재 ${b})`); continue; }
    if (b === undefined) { diffs.push(`- ${k}: 사라진 지표 (동결 ${a})`); continue; }
    if (b > a) diffs.push(`↑ ${k}: ${a} → ${b} (+${b - a})`);
    else if (b < a) diffs.push(`↓ ${k}: ${a} → ${b} (${b - a})`);
  }
  if (!diffs.length) { console.log(`OK — 동결값(${lock.frozenAt})과 일치한다.`); process.exit(0); }
  console.error(`FAIL — 국가 전용 개념 기준선이 동결값(${lock.frozenAt})과 어긋난다 (${diffs.length}건):\n`);
  for (const d of diffs) console.error('  ' + d);
  console.error('\n늘었다면: 국가 전용 개념이 **프로파일 없이** 새로 들어왔을 수 있다. 목록을 확인하라');
  console.error('  → docs/03-analysis/country-concept-inventory-2026-09-07.md');
  console.error('줄었다면: 슬롯화(G2)의 성과일 수 있다. 확인 후 --freeze 로 재동결하라.');
  process.exit(1);
}

printRules();
printMain(m);
