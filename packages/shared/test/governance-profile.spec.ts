/**
 * 국가 거버넌스 프로파일 가드 — 기획 §6 중 G0 에 해당하는 것.
 *
 * 🔴 이 파일의 가드는 전부 **재주입 역검증**을 거쳤다(보고에 결과 기재).
 *    통과하는 테스트가 아무것도 보증하지 않을 수 있으므로, 결함을 주입해 실패하는 것까지 확인한다.
 * 🔴 **대조군**을 함께 둔다 — "성공하면 실패로 말하지 않는다".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  GOVERNANCE_COUNTRIES,
  DEFAULT_GOVERNANCE_COUNTRY,
  isGovernanceCountryCode,
  KR_PROFILE,
  GOVERNANCE_TEMPLATES,
  GOVERNANCE_OVERRIDE_KEYS,
  GOVERNANCE_CONFIG_PREFIX,
  configKeyOf,
  isGovernanceOverrideKey,
  effectiveProfile,
  governanceItems,
  requiresJurisdictionChoice,
  PROFILE_SOURCES,
  PROFILE_SOURCE_LABEL,
  PAYER_MODELS,
  ELIGIBILITY_CHECK_MODES,
  type GovernanceOverrides,
  type GovernanceOverrideKey,
  type GovernanceProfile,
} from '../src/governance/profile';

const PROFILE_SRC = join(__dirname, '../src/governance/profile.ts');
const OPENING_REGISTRY = join(__dirname, '../../../apps/api/src/modules/opening/opening.registry.ts');
const PRISMA_SCHEMA = join(__dirname, '../../../apps/api/prisma/schema.prisma');
const HOLIDAY_SERVICE = join(__dirname, '../../../apps/api/src/modules/holiday/holiday.service.ts');

// ────────────────────────────────────────────────────────────────
// 1. 조사 안 한 값을 넣지 않는다 (기획 §6 · 개원 축 선례)
// ────────────────────────────────────────────────────────────────

/**
 * 프로파일이 담아서는 안 되는 것 — 법령 조문·수수료·처리기한.
 * 🔴 검증할 수 없고 자주 바뀌며, 시드에 들어가면 그 추정이 정책인 척한다.
 */
const FORBIDDEN_FIELD_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '법령 조문', re: /^(statute|article|clause|legalBasis|lawRef|조문|법령)/i },
  { label: '수수료', re: /^(fee|fees|cost|price|charge|수수료)/i },
  { label: '처리기한', re: /^(deadline|processingDays|leadTime|slaDays|dueDays|처리기한)/i },
];

/** 객체 트리의 모든 **키 이름**을 모은다(값은 보지 않는다 — 금지된 것은 필드다). */
function collectKeys(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => collectKeys(n, acc));
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      acc.push(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

function forbiddenKeysIn(node: unknown): string[] {
  return collectKeys(node).filter((k) => FORBIDDEN_FIELD_PATTERNS.some((p) => p.re.test(k)));
}

describe('§6 프로파일에 조사 안 한 값을 넣지 않는다', () => {
  it('KR_PROFILE 에 법령 조문·수수료·처리기한 필드가 없다', () => {
    expect(forbiddenKeysIn(KR_PROFILE)).toEqual([]);
  });

  it('선언된 모든 국가 템플릿에 대해 성립한다(AE 가 붙어도 같은 가드가 건다)', () => {
    for (const [country, tpl] of Object.entries(GOVERNANCE_TEMPLATES)) {
      expect(forbiddenKeysIn(tpl), `${country} 템플릿에 금지 필드`).toEqual([]);
    }
  });

  it('profile.ts 의 필드 선언 어디에도 금지 이름이 없다 — 타입 자리·값 선언 둘 다 본다', () => {
    // 🔴 런타임 스캐너(위)는 **값이 들어간 것**만 잡는다. `fee?: number` 처럼 타입에 자리만
    //    만들어 둔 것은 못 잡는다 — 자리를 만들면 곧 채워지므로 소스도 함께 본다.
    const src = readFileSync(PROFILE_SRC, 'utf8');
    // `이름:` / `이름?:` 형태만 본다(주석·문장에 나오는 한국어 단어는 제외).
    const declared = [...src.matchAll(/^\s{2,}(['"]?)([A-Za-z][A-Za-z0-9_.]*)\1\??:\s/gm)].map((m) => m[2]);
    const bad = declared.filter((k) => FORBIDDEN_FIELD_PATTERNS.some((p) => p.re.test(k)));
    expect(bad).toEqual([]);
  });

  it('🔴 대조군 — 스캐너가 실제로 탐지한다(전부 통과라고만 말하는 죽은 가드가 아니다)', () => {
    expect(forbiddenKeysIn({ jurisdictions: [{ code: 'X', fee: 30000 }] })).toEqual(['fee']);
    expect(forbiddenKeysIn({ payer: { legalBasis: '의료법 제33조' } })).toEqual(['legalBasis']);
    expect(forbiddenKeysIn({ forms: { processingDays: 14 } })).toEqual(['processingDays']);
    // 정상 필드를 오탐하지 않는다
    expect(forbiddenKeysIn({ coding: { diagnosis: 'KCD-8' }, calendar: { weekend: [0, 6] } })).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// 2. 국가 코드가 개원 축 정본과 갈라지지 않는다 (기계 대조)
// ────────────────────────────────────────────────────────────────

describe('국가 코드 — 개원 레지스트리 정본과 기계 대조', () => {
  it('opening.registry.ts 의 CountryCode·DEFAULT_COUNTRY 와 일치한다', () => {
    // 🔴 파일이 없으면 **실패한다**. 조용히 skip 하면 대조가 죽은 줄도 모른다.
    expect(existsSync(OPENING_REGISTRY), `개원 레지스트리를 찾지 못함: ${OPENING_REGISTRY}`).toBe(true);
    const src = readFileSync(OPENING_REGISTRY, 'utf8');

    const codes = src.match(/export type CountryCode\s*=\s*([^;]+);/);
    expect(codes, 'CountryCode 선언을 못 읽었다 — 정본이 옮겨졌는지 확인하라').toBeTruthy();
    const apiCodes = [...(codes as RegExpMatchArray)[1].matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]).sort();
    expect([...GOVERNANCE_COUNTRIES].sort()).toEqual(apiCodes);

    const def = src.match(/export const DEFAULT_COUNTRY:\s*CountryCode\s*=\s*'([A-Z]{2})'/);
    expect(def, 'DEFAULT_COUNTRY 선언을 못 읽었다').toBeTruthy();
    expect(DEFAULT_GOVERNANCE_COUNTRY).toBe((def as RegExpMatchArray)[1]);
  });

  it('타입가드가 목록과 같은 답을 낸다', () => {
    for (const c of GOVERNANCE_COUNTRIES) expect(isGovernanceCountryCode(c)).toBe(true);
    expect(isGovernanceCountryCode('ZZ')).toBe(false);
    expect(isGovernanceCountryCode(undefined)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. KR 프로파일이 **실측을 옮긴 것**인지 — 기계로 확인 가능한 것만
// ────────────────────────────────────────────────────────────────

describe('KR_PROFILE 은 현행 코드를 옮겨 적은 것이다(G0 동작 불변)', () => {
  it('coding.diagnosis 가 DiagnosisCode.codeSystem 기본값과 같다', () => {
    expect(existsSync(PRISMA_SCHEMA)).toBe(true);
    const schema = readFileSync(PRISMA_SCHEMA, 'utf8');
    const model = schema.match(/model DiagnosisCode \{[\s\S]*?\n\}/);
    expect(model, 'DiagnosisCode 모델을 못 읽었다').toBeTruthy();
    const def = (model as RegExpMatchArray)[0].match(/codeSystem\s+String\s+@default\("([^"]+)"\)/);
    expect(def, 'codeSystem 기본값을 못 읽었다').toBeTruthy();
    expect(KR_PROFILE.coding.diagnosis).toBe((def as RegExpMatchArray)[1]);
  });

  it('calendar.weekend 가 영업일 계산(HolidayService)이 건너뛰는 요일과 같다', () => {
    expect(existsSync(HOLIDAY_SERVICE)).toBe(true);
    const src = readFileSync(HOLIDAY_SERVICE, 'utf8');
    const days = new Set(
      [...src.matchAll(/day\s*[=!]==\s*([0-6])/g)].map((m) => Number(m[1])),
    );
    expect(days.size, '주말 판정 코드를 못 읽었다 — HolidayService 가 바뀌었는지 확인하라').toBeGreaterThan(0);
    expect([...KR_PROFILE.calendar.weekend].sort()).toEqual([...days].sort());
  });

  it('지불자 사전승인 블록은 없다 — 원내 발행 게이트(pre-auth)와 다른 개념이다', () => {
    // 🔴 "한국에 사전승인 제도가 있는가"를 판정한 것이 아니다. **현행 화면에 그 블록이 없다**는 선언이다.
    expect(KR_PROFILE.payer.priorAuth).toBe(false);
  });

  it('제출처가 하나라서 화면이 묻지 않는다', () => {
    expect(KR_PROFILE.jurisdictions).toHaveLength(1);
    expect(requiresJurisdictionChoice(effectiveProfile(KR_PROFILE))).toBe(false);
  });

  it('어휘가 선언된 집합 안에 있다', () => {
    expect(PAYER_MODELS).toContain(KR_PROFILE.payer.model);
    expect(ELIGIBILITY_CHECK_MODES).toContain(KR_PROFILE.payer.eligibilityCheck);
    expect(KR_PROFILE.country).toBe('KR');
    expect(GOVERNANCE_TEMPLATES.KR).toBe(KR_PROFILE);
  });

  it('신원 필드는 현행 폼대로 전부 선택 입력이다(필수로 강제하면 거짓 데이터가 된다)', () => {
    expect(KR_PROFILE.identity.length).toBeGreaterThan(0);
    expect(KR_PROFILE.identity.every((f) => f.required === false)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. 출처가 보인다 (기획 §6)
// ────────────────────────────────────────────────────────────────

describe('§6 출처가 보인다 — 조용히 기본값으로 떨어지지 않는다', () => {
  it('항목 목록의 키 집합이 조정 가능 키 집합과 정확히 같다', () => {
    const listed = governanceItems(effectiveProfile(KR_PROFILE)).map((i) => i.key).sort();
    expect(listed).toEqual([...GOVERNANCE_OVERRIDE_KEYS].sort());
    // 중복 등재도 막는다(같은 항목이 두 배지로 그려지면 그 자체가 거짓말)
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('조정이 없으면 전 항목이 국가 기본으로 표시된다', () => {
    for (const { key, item } of governanceItems(effectiveProfile(KR_PROFILE))) {
      expect(item.source, key).toBe('COUNTRY_DEFAULT');
      expect(item.matchesCountryDefault, key).toBeNull();
      expect(item.value, key).toEqual(item.countryDefault);
      expect(PROFILE_SOURCES).toContain(item.source);
      expect(PROFILE_SOURCE_LABEL[item.source]).toBeTruthy();
    }
  });

  it('모든 항목이 출처와 국가 기본값을 함께 든다(둘 중 하나만 있으면 "무엇에서 바뀌었나"를 못 말한다)', () => {
    const items = governanceItems(effectiveProfile(KR_PROFILE, { 'payer.priorAuth': true }));
    for (const { key, item } of items) {
      expect(Object.prototype.hasOwnProperty.call(item, 'source'), key).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'countryDefault'), key).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'matchesCountryDefault'), key).toBe(true);
    }
  });

  it('SystemConfig 키는 gov. 네임스페이스 하나다', () => {
    for (const k of GOVERNANCE_OVERRIDE_KEYS) {
      expect(configKeyOf(k)).toBe(`${GOVERNANCE_CONFIG_PREFIX}${k}`);
      expect(isGovernanceOverrideKey(k)).toBe(true);
    }
    expect(isGovernanceOverrideKey('payer.somethingNew')).toBe(false);
    expect(isGovernanceOverrideKey('country')).toBe(false); // 국가는 hospital.country 가 정한다
  });
});

// ────────────────────────────────────────────────────────────────
// 5. 기관 조정이 실제로 이긴다 (기획 §6 — 가짜 다이얼 방지)
// ────────────────────────────────────────────────────────────────

/** 항목마다 **국가 기본과 다른** 값 하나. 🔴 키가 늘면 여기도 늘어야 한다(가드가 강제한다). */
const DIFFERENT_VALUE: Record<GovernanceOverrideKey, unknown> = {
  'payer.model': 'MULTI',
  'payer.eligibilityCheck': 'PER_INSURER',
  'payer.priorAuth': true,
  jurisdictions: [
    { code: 'A', label: '관할 A' },
    { code: 'B', label: '관할 B' },
  ],
  'coding.diagnosis': 'ICD-10-AM',
  'coding.procedure': 'CPT',
  identity: [{ key: 'emiratesId', label: 'Emirates ID', required: true, form: 'RESIDENT' }],
  'forms.statutoryPrint': false,
  'calendar.weekend': [5, 6],
  'calendar.secondaryEra': 'HIJRI',
};

function itemByKey(eff: ReturnType<typeof effectiveProfile>, key: GovernanceOverrideKey) {
  const found = governanceItems(eff).find((i) => i.key === key);
  if (!found) throw new Error(`항목 목록에 ${key} 가 없다`);
  return found.item;
}

describe('§6 기관 조정이 실제로 이긴다', () => {
  it('조정 대상 키가 전부 다른 값 표를 갖는다(새 키를 넣고 검증을 빠뜨릴 수 없다)', () => {
    expect(Object.keys(DIFFERENT_VALUE).sort()).toEqual([...GOVERNANCE_OVERRIDE_KEYS].sort());
  });

  it.each(GOVERNANCE_OVERRIDE_KEYS)('%s — 조정치가 템플릿을 덮는다', (key) => {
    const override = { [key]: DIFFERENT_VALUE[key] } as GovernanceOverrides;
    const eff = effectiveProfile(KR_PROFILE, override);
    const it0 = itemByKey(eff, key);

    expect(it0.value, `${key} 조정치가 반영되지 않았다 — 가짜 다이얼이다`).toEqual(DIFFERENT_VALUE[key]);
    expect(it0.source).toBe('INSTITUTION');
    expect(it0.matchesCountryDefault).toBe(false);
    expect(it0.value).not.toEqual(it0.countryDefault);

    // 옆 항목은 건드리지 않는다 — 하나를 조정했는데 다른 것이 따라 바뀌면 그것도 결함이다
    for (const other of GOVERNANCE_OVERRIDE_KEYS) {
      if (other === key) continue;
      expect(itemByKey(eff, other).source, `${key} 조정이 ${other} 를 건드렸다`).toBe('COUNTRY_DEFAULT');
    }
  });

  it('여러 항목을 동시에 조정해도 전부 이긴다', () => {
    const all = Object.fromEntries(
      GOVERNANCE_OVERRIDE_KEYS.map((k) => [k, DIFFERENT_VALUE[k]]),
    ) as GovernanceOverrides;
    const eff = effectiveProfile(KR_PROFILE, all);
    for (const { key, item } of governanceItems(eff)) {
      expect(item.source, key).toBe('INSTITUTION');
      expect(item.value, key).toEqual(DIFFERENT_VALUE[key]);
    }
  });

  it('제출처를 둘로 조정하면 "선택 필요"가 파생된다(선언이 실제로 무언가를 바꾼다)', () => {
    expect(requiresJurisdictionChoice(effectiveProfile(KR_PROFILE))).toBe(false);
    const eff = effectiveProfile(KR_PROFILE, { jurisdictions: DIFFERENT_VALUE.jurisdictions as never });
    expect(requiresJurisdictionChoice(eff)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 6. "조정 없음" 과 "같은 값으로 명시 조정" 은 다른 사실이다
// ────────────────────────────────────────────────────────────────

describe('조정 없음 ≠ 같은 값으로 명시 조정', () => {
  it('같은 값으로 조정하면 INSTITUTION + matchesCountryDefault=true 로 남는다', () => {
    const eff = effectiveProfile(KR_PROFILE, { 'payer.priorAuth': KR_PROFILE.payer.priorAuth });
    const i = eff.payer.priorAuth;
    expect(i.value).toBe(KR_PROFILE.payer.priorAuth);
    expect(i.source).toBe('INSTITUTION');
    expect(i.matchesCountryDefault).toBe(true); // 🔴 조정 없음(null)과 구분된다
  });

  it('배열·객체 항목도 값 비교로 판정한다(참조가 달라도 같은 값이면 같다고 말한다)', () => {
    const clone = JSON.parse(JSON.stringify(KR_PROFILE.jurisdictions));
    const eff = effectiveProfile(KR_PROFILE, { jurisdictions: clone });
    expect(eff.jurisdictions.source).toBe('INSTITUTION');
    expect(eff.jurisdictions.matchesCountryDefault).toBe(true);

    const changed = effectiveProfile(KR_PROFILE, {
      jurisdictions: [{ ...KR_PROFILE.jurisdictions[0], label: '다른 이름' }],
    });
    expect(changed.jurisdictions.matchesCountryDefault).toBe(false);
  });

  it('undefined 는 조정 없음, null 은 값이다', () => {
    const undef = effectiveProfile(KR_PROFILE, { 'calendar.secondaryEra': undefined });
    expect(undef.calendar.secondaryEra.source).toBe('COUNTRY_DEFAULT');
    expect(undef.calendar.secondaryEra.matchesCountryDefault).toBeNull();

    // 국가 기본이 이미 null 이므로 "명시적으로 없다고 조정"과 "조정 안 함"이 갈린다
    const explicitNull = effectiveProfile(KR_PROFILE, { 'calendar.secondaryEra': null });
    expect(explicitNull.calendar.secondaryEra.source).toBe('INSTITUTION');
    expect(explicitNull.calendar.secondaryEra.matchesCountryDefault).toBe(true);
    expect(explicitNull.calendar.secondaryEra.value).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// 7. 순수 함수 · 대조군
// ────────────────────────────────────────────────────────────────

describe('effectiveProfile 은 순수하다', () => {
  it('템플릿과 조정치를 변형하지 않는다', () => {
    const tplBefore = JSON.stringify(KR_PROFILE);
    const overrides: GovernanceOverrides = { 'payer.model': 'MULTI', 'calendar.weekend': [5, 6] };
    const ovBefore = JSON.stringify(overrides);
    effectiveProfile(KR_PROFILE, overrides);
    expect(JSON.stringify(KR_PROFILE)).toBe(tplBefore);
    expect(JSON.stringify(overrides)).toBe(ovBefore);
  });

  it('조정치를 생략해도 동작한다(호출부가 빈 설정을 특별히 다루지 않아도 된다)', () => {
    expect(effectiveProfile(KR_PROFILE).payer.model.value).toBe(KR_PROFILE.payer.model);
  });

  it('🔴 대조군 — 다른 템플릿을 넣으면 다른 유효 프로파일이 나온다(입력을 무시하는 함수가 아니다)', () => {
    const other: GovernanceProfile = {
      ...KR_PROFILE,
      country: 'AE',
      label: '테스트 템플릿',
      payer: { model: 'MULTI', eligibilityCheck: 'PER_INSURER', priorAuth: true },
    };
    const eff = effectiveProfile(other);
    expect(eff.country).toBe('AE');
    expect(eff.payer.model.value).toBe('MULTI');
    expect(eff.payer.priorAuth.value).toBe(true);
    expect(eff.payer.priorAuth.source).toBe('COUNTRY_DEFAULT'); // 템플릿에서 온 값이다
  });
});
