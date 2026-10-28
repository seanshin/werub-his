/**
 * 국가 거버넌스 프로파일 정본 — G0 "이름 붙이기".
 * 기획 `docs/01-plan/features/country-governance-profile.plan.md` §3.1·§3.2·§3.3.
 *
 * 🔴 **이 단계는 순수한 선언이다.** 지금 화면이 하는 일을 그대로 적으면 `KR_PROFILE` 이 나온다.
 *    프로파일을 만든 것만으로 동작이 바뀌면 실패다(성공 기준 = 현행 화면·테스트 diff 0).
 *
 * 🔴 **프로파일은 값을 선언할 뿐 판단하지 않는다.** "이 나라는 지불자 사전승인이 있다"까지가
 *    프로파일이고, "그래서 이 환자는 승인이 필요한가"는 기존 도메인 로직(EligibilityService·
 *    PreAuthGateService·BillingService)이 정한다. **정본을 여기로 옮기지 않는다.**
 *
 * 🔴 **조사한 것만 적는다**(개원 축 `opening.registry.ts` 선례). 법령 조문·수수료·처리기한·
 *    제출 서식 번호는 **넣지 않는다** — 내가 검증할 수 없고, 자주 바뀌고, 시드에 들어가면
 *    그 추정이 정책인 척한다. 각 값 옆에는 **어디서 실측했는지**를 적는다.
 *
 * 🔴 **원내 계약·수가 같은 비공개 값을 담지 않는다**(기획 §3.4). 담아야 할 것이 생기면
 *    프로파일이 아니라 기존 도메인 설정에 둔다.
 */

// ────────────────────────────────────────────────────────────────
// 국가 코드
// ────────────────────────────────────────────────────────────────

/**
 * 🔴 **오늘의 정본은 `apps/api/src/modules/opening/opening.registry.ts` 의 `CountryCode` 다.**
 *    shared 는 api 를 import 할 수 없어 여기에 사본을 둔다 — 같은 사실에 목록이 둘이면 갈라지므로
 *    `test/governance-profile.spec.ts` 가 그 파일을 읽어 **기계 대조**한다(홈페이지 CMS 사본 선례).
 *    G0-b/G3 에서 정본을 shared 로 옮길 때 이 주석과 대조 가드를 함께 걷어낸다.
 */
export const GOVERNANCE_COUNTRIES = ['KR', 'AE'] as const;
export type GovernanceCountryCode = (typeof GOVERNANCE_COUNTRIES)[number];

/** 기관 설정 `hospital.country` 가 없을 때의 국가 — 실측: `config-runtime.service.ts` 기본값 `'KR'`. */
export const DEFAULT_GOVERNANCE_COUNTRY: GovernanceCountryCode = 'KR';

export function isGovernanceCountryCode(v: unknown): v is GovernanceCountryCode {
  return typeof v === 'string' && (GOVERNANCE_COUNTRIES as readonly string[]).includes(v);
}

// ────────────────────────────────────────────────────────────────
// 프로파일 타입
// ────────────────────────────────────────────────────────────────

/** 지불자 구조 — `SINGLE`(단일 지불자) / `MULTI`(다수 보험사, 보험사·플랜 선택이 필요) */
export const PAYER_MODELS = ['SINGLE', 'MULTI'] as const;
export type PayerModel = (typeof PAYER_MODELS)[number];

/** 자격조회 방식 — 전국 단일 조회 / 보험사별 조회 / 조회 자체가 없음 */
export const ELIGIBILITY_CHECK_MODES = ['NATIONAL', 'PER_INSURER', 'NONE'] as const;
export type EligibilityCheckMode = (typeof ELIGIBILITY_CHECK_MODES)[number];

/**
 * 관할(제출처) — 🔴 **길이가 곧 "제출처를 사람이 골라야 하는가"** 다.
 *    하나면 화면이 묻지 않고, 둘 이상이면 물어야 한다(`requiresJurisdictionChoice`).
 * 🔴 조문·수수료·처리기한은 담지 않는다. 담는 것은 **코드·이름·실측 메모**뿐이다.
 */
export interface Jurisdiction {
  /** 기관 약칭 — 실측한 표기 그대로 */
  code: string;
  label: string;
  /** 무엇을 실측했는지 · 어떤 한계가 있는지. 모르면 생략한다(빈 문자열로 아는 척하지 않는다) */
  note?: string;
}

/**
 * 환자 등록 폼의 신원 필드 구성.
 * 🔴 `required` 는 **현행 폼이 실제로 강제하는가**를 실측해 적는다 — "법이 요구하는가"가 아니다.
 *    (필수로 강제하면 거짓 데이터가 된다는 규칙이 이미 있다. G0 은 현행을 옮겨 적을 뿐이다.)
 */
export interface IdentityField {
  /** 폼/모델 필드 이름 — 실측한 이름 그대로 */
  key: string;
  label: string;
  /** 현행 등록 폼이 비어 있으면 막는가(실측) */
  required: boolean;
  /** 어느 등록 화면에 있는가 — 내국인 폼 / 외국인 폼 */
  form: 'RESIDENT' | 'FOREIGN';
  note?: string;
}

export interface GovernanceProfile {
  country: GovernanceCountryCode;
  label: string;
  payer: {
    model: PayerModel;
    eligibilityCheck: EligibilityCheckMode;
    /**
     * **지불자(보험자) 사전승인** 블록이 접수·청구 화면에 필요한가.
     * 🔴 원내 발행 게이트(`pre-auth` 모듈 — 마약류·수혈·항암·고가검사)와 **다른 개념이다.**
     *    그쪽은 지불자와 무관한 원내 승인이고 `preauth.enforce` 설정이 정한다.
     */
    priorAuth: boolean;
  };
  jurisdictions: Jurisdiction[];
  coding: {
    /** 진단 코드 체계 */
    diagnosis: string;
    /** 처치·수가 코드 체계 */
    procedure: string;
  };
  identity: IdentityField[];
  forms: {
    /** 그 나라 법정 서식으로 고정된 인쇄면이 있는가 */
    statutoryPrint: boolean;
  };
  calendar: {
    /** 주말 요일 — `Date#getDay()` 값(0=일 … 6=토) */
    weekend: number[];
    /** 병기하는 보조 역법 — 없으면 `null`(모른다가 아니라 **없다**는 실측) */
    secondaryEra: string | null;
  };
}

// ────────────────────────────────────────────────────────────────
// KR 프로파일 — 실측(2026-09-07)
// ────────────────────────────────────────────────────────────────

/**
 * 🔴 **지금 코드가 하는 일을 그대로 옮겨 적은 것이다.** 새 정책을 정하지 않았다.
 *    필드마다 실측 출처를 달아 뒀다 — 출처를 못 단 값은 넣지 않았다.
 */
export const KR_PROFILE: GovernanceProfile = {
  country: 'KR',
  label: '대한민국',
  payer: {
    // 실측: `InsuranceType` enum 5종(NHI·MEDICAID·INDUSTRIAL·AUTO·SELF_PAY)은 **제도 구분**이지
    //       경쟁 보험사가 아니다. 접수·수납 화면 어디에도 보험사·플랜 선택 UI 가 없다
    //       (grep: 임상/원무 화면의 `보험사` 는 동의문·홈페이지 문구뿐).
    model: 'SINGLE',
    // 실측: `modules/eligibility/nhis.provider.ts` 한 곳이 전국 단일 조회를 담당하고,
    //       화면은 `reception/components/EligibilityVerifyModal.tsx` 에서 1회 호출한다.
    eligibilityCheck: 'NATIONAL',
    // 실측: `priorAuth`/`priorAuthorization` 식별자가 apps/api·apps/web 소스에 **0곳**.
    //       원내 `pre-auth` 모듈은 발행 게이트(`preauth.enforce`)라 지불자 승인이 아니다.
    // 🔴 "한국 건보에 사전승인 제도가 있는가"를 적은 것이 아니다 — **현행 화면에 그 블록이 없다**는 실측이다.
    priorAuth: false,
  },
  jurisdictions: [
    {
      code: 'KR',
      label: '대한민국(단일 제출처)',
      note:
        '보고·청구의 제출처가 종류마다 하나로 고정돼 화면이 제출처를 묻지 않는다. '
        + '실측: 청구 EDI 는 심평원 하나(`/admin/hira-edi`·go-live `integ.hiraSubmit`·개원 `open.insurance.hiraEdi`), '
        + '법정감염병은 질병관리청·KONIS 로 고정(`infection-control/external-reporting.ts` — 두 채널 모두 `implemented:false`). '
        + '자격은 건보공단(`nhis.provider.ts`). 🔴 기관 목록이 아니라 **제출처 선택이 필요 없다**는 사실을 적은 것이다.',
    },
  ],
  coding: {
    // 실측: `DiagnosisCode.codeSystem @default("KCD-8")` — 문자열 그대로 옮겼다.
    diagnosis: 'KCD-8',
    // 실측: `ProcedureCode` 에는 codeSystem 컬럼이 **없다**. 코드는 심평원 고시 EDI 수가코드이며
    //       `origin:'HIRA'`·`gazetteClass`(고시 분류번호 원문)가 그 사실을 든다
    //       (`workstation.service.ts` 주석: "`E6591`(HbA1c) 같은 **EDI 수가코드**").
    //       🔴 코드 체계 이름이 DB 에 없으므로 여기 문자열은 **이 프로파일이 처음 붙이는 이름**이다.
    procedure: 'HIRA-EDI',
  },
  identity: [
    {
      key: 'residentNumber',
      label: '주민등록번호',
      // 실측: `patients/new/page.tsx` zod 스키마가 `.optional()` — 비어 있어도 등록된다.
      required: false,
      form: 'RESIDENT',
      note: '체크디짓 검증 후 생년월일·성별 자동 채움. 저장은 `Patient.nationalId`(AES-256-GCM)+`nationalIdHash`.',
    },
    {
      key: 'insuranceNumber',
      label: '건강보험증번호',
      required: false, // 실측: 같은 폼에서 `.optional()`
      form: 'RESIDENT',
      note: '`Patient.insuranceNumber` 암호화 저장.',
    },
    {
      key: 'passportNumber',
      label: '여권번호',
      required: false, // 실측: `patients/register/foreign/page.tsx` — 값이 있을 때만 body 에 실린다
      form: 'FOREIGN',
    },
    {
      key: 'alienRegistrationNo',
      label: '외국인등록번호',
      required: false, // 실측: 같은 화면 · 조건부 전송
      form: 'FOREIGN',
    },
  ],
  // 실측: 법정 인쇄면 6(`/print/[issueNo]` + `(main)/print/{opinion,prescription,receipt,consent,diagnosis}`)이
  //       전부 한국 서식이다(인쇄 차단 규약의 불변 대상).
  forms: { statutoryPrint: true },
  calendar: {
    // 실측: `holiday.service.ts` 가 `day === 0 || day === 6` 을 주말로 건너뛴다(영업일 계산 정본).
    weekend: [0, 6],
    // 실측: 병기하는 보조 역법이 화면·서비스에 없다. 공휴일은 `HolidayService` 가 날짜 집합으로 갖는다.
    secondaryEra: null,
  },
};

/** 국가 템플릿 등록부 — 🔴 AE 는 아직 **조사되지 않았다**. 추정으로 채우지 않는다(G3 에서 선언한다). */
export const GOVERNANCE_TEMPLATES: Partial<Record<GovernanceCountryCode, GovernanceProfile>> = {
  KR: KR_PROFILE,
};

// ────────────────────────────────────────────────────────────────
// 기관 조정치(SystemConfig `gov.*`)
// ────────────────────────────────────────────────────────────────

/**
 * 기관이 덮을 수 있는 항목 — 🔴 **이 목록이 곧 세팅 화면의 다이얼 목록**이다.
 *    여기 없는 키는 조정할 수 없다(정본에 없는 키를 조용히 받지 않는다).
 *    `country`·`label` 은 국가 선택(`hospital.country`)이 정하므로 조정 대상이 아니다.
 */
export const GOVERNANCE_OVERRIDE_KEYS = [
  'payer.model',
  'payer.eligibilityCheck',
  'payer.priorAuth',
  'jurisdictions',
  'coding.diagnosis',
  'coding.procedure',
  'identity',
  'forms.statutoryPrint',
  'calendar.weekend',
  'calendar.secondaryEra',
] as const;

export type GovernanceOverrideKey = (typeof GOVERNANCE_OVERRIDE_KEYS)[number];

/**
 * 기관 조정치. 키 모양이 곧 SystemConfig 키다 — `gov.` + 항목 키(`configKeyOf`).
 * 🔴 **키가 없는 것**과 **명시적으로 조정한 것**은 다른 사실이다. 값이 `undefined` 면
 *    "조정 없음"으로 읽고, `null` 은 `calendar.secondaryEra` 에서 **"없다"는 명시 조정**이다.
 */
export interface GovernanceOverrides {
  'payer.model'?: PayerModel;
  'payer.eligibilityCheck'?: EligibilityCheckMode;
  'payer.priorAuth'?: boolean;
  jurisdictions?: Jurisdiction[];
  'coding.diagnosis'?: string;
  'coding.procedure'?: string;
  identity?: IdentityField[];
  'forms.statutoryPrint'?: boolean;
  'calendar.weekend'?: number[];
  'calendar.secondaryEra'?: string | null;
}

/** SystemConfig 키 — 조정치는 전부 `gov.` 네임스페이스에 산다(개원 축 `inst.` 선례). */
export const GOVERNANCE_CONFIG_PREFIX = 'gov.';

export function configKeyOf(key: GovernanceOverrideKey): string {
  return `${GOVERNANCE_CONFIG_PREFIX}${key}`;
}

export function isGovernanceOverrideKey(v: unknown): v is GovernanceOverrideKey {
  return typeof v === 'string' && (GOVERNANCE_OVERRIDE_KEYS as readonly string[]).includes(v);
}

// ────────────────────────────────────────────────────────────────
// 유효 프로파일 — 템플릿 ⊕ 기관 조정
// ────────────────────────────────────────────────────────────────

/** 값이 어디서 왔는가 — 🔴 조용히 기본값으로 떨어지지 않게 하는 것이 이 필드의 목적이다. */
export const PROFILE_SOURCES = ['COUNTRY_DEFAULT', 'INSTITUTION'] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

export const PROFILE_SOURCE_LABEL: Record<ProfileSource, string> = {
  COUNTRY_DEFAULT: '국가 기본',
  INSTITUTION: '기관 조정',
};

/**
 * 값 하나 + 출처.
 *
 * 🔴 **조정하지 않은 것**(`source:'COUNTRY_DEFAULT'` · `matchesCountryDefault:null`)과
 *    **같은 값으로 명시 조정한 것**(`source:'INSTITUTION'` · `matchesCountryDefault:true`)은
 *    다른 사실이다. 둘을 같은 배지로 그리면 "기관이 검토하고 그대로 두기로 했다"는 기록이 사라진다.
 */
export interface ProfileItem<T> {
  value: T;
  source: ProfileSource;
  /** 국가 템플릿 값 — 무엇에서 바뀌었는지 화면이 말할 수 있게 함께 낸다 */
  countryDefault: T;
  /** 기관 조정이 국가 기본과 같은 값인가. 조정이 없으면 `null`(해당 없음) */
  matchesCountryDefault: boolean | null;
}

export interface EffectiveGovernanceProfile {
  country: GovernanceCountryCode;
  label: string;
  payer: {
    model: ProfileItem<PayerModel>;
    eligibilityCheck: ProfileItem<EligibilityCheckMode>;
    priorAuth: ProfileItem<boolean>;
  };
  jurisdictions: ProfileItem<Jurisdiction[]>;
  coding: {
    diagnosis: ProfileItem<string>;
    procedure: ProfileItem<string>;
  };
  identity: ProfileItem<IdentityField[]>;
  forms: {
    statutoryPrint: ProfileItem<boolean>;
  };
  calendar: {
    weekend: ProfileItem<number[]>;
    secondaryEra: ProfileItem<string | null>;
  };
}

/** 값 비교 — 배열·객체 항목(jurisdictions·identity·weekend)까지 같은 규칙으로 본다. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k)
      && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function item<T>(countryDefault: T, override: T | undefined, provided: boolean): ProfileItem<T> {
  if (!provided) {
    return { value: countryDefault, source: 'COUNTRY_DEFAULT', countryDefault, matchesCountryDefault: null };
  }
  const value = override as T;
  return {
    value,
    source: 'INSTITUTION',
    countryDefault,
    matchesCountryDefault: deepEqual(value, countryDefault),
  };
}

/**
 * 조정치가 그 키를 **실제로 들고 있는가.**
 * 🔴 `undefined` 는 "조정 없음"이다(SystemConfig 에 키가 없으면 그 모양으로 온다).
 *    `null` 은 값이다 — `calendar.secondaryEra: null` 은 "보조 역법 없음"이라는 명시 조정이다.
 */
function provided(overrides: GovernanceOverrides, key: GovernanceOverrideKey): boolean {
  const v = (overrides as Record<string, unknown>)[key];
  return Object.prototype.hasOwnProperty.call(overrides, key) && v !== undefined;
}

/**
 * 국가 템플릿 ⊕ 기관 조정치 → 유효 프로파일. **순수 함수**(입력을 변형하지 않는다).
 *
 * 🔴 값을 **검증하지 않는다.** 조정치가 형식에 맞는지는 값을 받는 쪽(G0-b 세팅 화면)이 본다.
 *    여기서 조용히 버리면 "저장했는데 아무것도 안 바뀌는" 가짜 다이얼이 된다.
 */
export function effectiveProfile(
  template: GovernanceProfile,
  overrides: GovernanceOverrides = {},
): EffectiveGovernanceProfile {
  return {
    country: template.country,
    label: template.label,
    payer: {
      model: item(template.payer.model, overrides['payer.model'], provided(overrides, 'payer.model')),
      eligibilityCheck: item(
        template.payer.eligibilityCheck,
        overrides['payer.eligibilityCheck'],
        provided(overrides, 'payer.eligibilityCheck'),
      ),
      priorAuth: item(template.payer.priorAuth, overrides['payer.priorAuth'], provided(overrides, 'payer.priorAuth')),
    },
    jurisdictions: item(template.jurisdictions, overrides.jurisdictions, provided(overrides, 'jurisdictions')),
    coding: {
      diagnosis: item(template.coding.diagnosis, overrides['coding.diagnosis'], provided(overrides, 'coding.diagnosis')),
      procedure: item(template.coding.procedure, overrides['coding.procedure'], provided(overrides, 'coding.procedure')),
    },
    identity: item(template.identity, overrides.identity, provided(overrides, 'identity')),
    forms: {
      statutoryPrint: item(
        template.forms.statutoryPrint,
        overrides['forms.statutoryPrint'],
        provided(overrides, 'forms.statutoryPrint'),
      ),
    },
    calendar: {
      weekend: item(template.calendar.weekend, overrides['calendar.weekend'], provided(overrides, 'calendar.weekend')),
      secondaryEra: item(
        template.calendar.secondaryEra,
        overrides['calendar.secondaryEra'],
        provided(overrides, 'calendar.secondaryEra'),
      ),
    },
  };
}

/**
 * 유효 프로파일을 **항목 목록**으로 편다 — 출처 배지 화면(G0-b)이 이걸 순회한다.
 * 🔴 새 항목을 프로파일에 넣고 여기 등재를 잊으면 그 항목만 출처를 못 말한다.
 *    가드가 `GOVERNANCE_OVERRIDE_KEYS` 와 이 목록의 키 집합 일치를 강제한다.
 */
export function governanceItems(
  eff: EffectiveGovernanceProfile,
): ReadonlyArray<{ key: GovernanceOverrideKey; item: ProfileItem<unknown> }> {
  return [
    { key: 'payer.model', item: eff.payer.model },
    { key: 'payer.eligibilityCheck', item: eff.payer.eligibilityCheck },
    { key: 'payer.priorAuth', item: eff.payer.priorAuth },
    { key: 'jurisdictions', item: eff.jurisdictions },
    { key: 'coding.diagnosis', item: eff.coding.diagnosis },
    { key: 'coding.procedure', item: eff.coding.procedure },
    { key: 'identity', item: eff.identity },
    { key: 'forms.statutoryPrint', item: eff.forms.statutoryPrint },
    { key: 'calendar.weekend', item: eff.calendar.weekend },
    { key: 'calendar.secondaryEra', item: eff.calendar.secondaryEra },
  ];
}

/**
 * 제출처를 사람이 골라야 하는가 — 🔴 **판단이 아니라 선언의 파생이다.**
 *    "이 보고를 어디에 내야 하는가"는 여전히 도메인이 정한다.
 */
export function requiresJurisdictionChoice(eff: EffectiveGovernanceProfile): boolean {
  return eff.jurisdictions.value.length > 1;
}
