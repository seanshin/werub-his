'use client';

/**
 * 표시 공통컴포넌트(UX 일관성 검토 2026-07) — "중요한 표현 단위"의 단일 구현.
 * 전부 SystemConfig(ui.*)를 useUiSettings로 소비 → /admin 시스템 설정 '화면 표시(UX)' 탭에서 일괄 조정.
 *
 * - <KDate value mode />        날짜/일시/시각 (raw toLocaleDateString 297곳·변형 5종 대체 대상)
 * - <Money value />             금액 (…원/콤마만/₩/만원 4표기 혼재 대체 대상)
 * - <PatientName ... maskable /> 환자 식별(성+이름+MRN·공용 화면 마스킹 정책)
 * - <EmptyState />              빈 목록 (portal 전용이던 것을 (main) 전역 승격)
 * - <Ratio n d />               비율·완결률 — 항상 `n / N (p%)`, 분모 0·미상이면 '산출 불가'(2026-08-19 §2.1·§3.3)
 *
 * ── BiDi 격리(`<bdi>`) — 아랍어 트랙 R-A0(2026-09-07) ───────────────────────────
 * 🔴 **이것은 "아랍어 지원"이 아니다. 준비다.** RTL 문맥에서 `120/80 mmHg`·`5 mg`·`12 / 15 (80.0%)`·
 *    `2026-09-07 14:30`·`A11800581` 같은 **숫자+단위·코드·구분자 조합**은 주변 텍스트의 방향에 끌려
 *    조각이 재배치된다(숫자는 약한 LTR, `/ . : - ( )` 는 중립이라 상위 문단 방향이 순서를 정한다).
 *    `<bdi>` 는 그 조각을 **주변에서 격리**해 논리 순서를 지킨다.
 *
 * 🔴 `dir="auto"`(<T> 가 쓰는 것)와 **다른 일**이다 — `dir="auto"` 는 문자열 자신의 기저 방향을 정하고,
 *    `<bdi>` 는 주변으로부터 격리한다. 수치·코드에 필요한 것은 후자다. 이중으로 감싸지 않는다.
 *
 * 🔴 **LTR 에서는 no-op** — 바깥 `<span>`(className·title·data-* 전부)은 그대로 두고 **내용만** 감싼다.
 *    한국어·영어·일본어 화면의 텍스트·클래스·바깥 태그는 한 글자도 바뀌지 않는다
 *    (`test/ui/bidi-isolation.spec.tsx` 가 LTR 렌더 문자열을 동결하고 격리 유지를 가드한다).
 *
 * 🔴 이름(PatientName·StaffName)·낱말(Unknown·EmptyState·배지)에는 **넣지 않았다** — 격리가 필요한 것은
 *    중립 문자로 이어 붙인 수치·코드 조합이다. 필요 없는 곳까지 감싸면 무엇이 왜 감싸였는지가 흐려진다.
 *
 * 🔴 **RTL 에서 실제로 올바른지는 이 저장소에서 검증하지 못했다** — 아랍어 화면(`app/(ae)/**`)이 아직 없다.
 *    여기서 증명된 것은 "LTR 이 안 바뀐다"와 "격리가 배선돼 있다" 둘뿐이다(R-A2 이후 사람 시각 검증 필요).
 */

import React from 'react';
import { useUiSettings, formatKDate, formatMoney, maskPatientName, type KDateMode } from '@/lib/ui-settings';
import { splitCurrency, splitValueUnit } from '@/lib/currency-split';
import { patientNameView, stayDays, formatNum, policyOf, ratioOf, ratioText, RATIO_UNAVAILABLE, TERM_EN_UNREGISTERED, localeTagOf, tOf, type RoundMode } from '@hospital-run/shared';
import { useTermLang } from '@/stores/term-lang-store';
import { useUiLocale } from '@/stores/ui-locale-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ── 단위어 조회(UI 크롬 언어 P3 라운드 3 · 2026-09-09) ─────────────────────────
 * 🔴 **맨 키(`건`·`시간`·`원`)를 보지 않는다 — `<단위>@단위` 문맥 키만 본다.**
 *    같은 원문이 앞 카탈로그에 **화면 라벨 뜻**으로 이미 등재돼 있어서다(실행 실측 2026-09-09):
 *      `시간` → `Time`(시각 열 머리글) · `원` → `KRW` · `주` → `Week` · `품목` → `Item`.
 *    맨 키로 폴백했다면 `5시간 52분` 이 **`5Time 52min`** 이 되고, 더 나쁘게는 금액 접미가
 *    `12,340KRW` 로 바뀐다 — 통화 표기는 `NUMERIC_POLICIES` money/copay 가 **locked** 라
 *    표시 언어와 무관하게 불변이어야 한다(CLAUDE.md §수치단위 · Money 주석). 그래서 폴백을 두지 않았다.
 *
 * 🔴 **미등록 단위는 한국어 원문 그대로 두고 티를 달지 않는다.** `<Unit>` 은 0.5em 보조 글자라
 *    위첨자 티가 읽히지 않고, 무엇보다 `원`·`만원`(통화 locked)·`장`(장/매/컷 — 대응어 미확정)은
 *    **의도적으로 등재하지 않은 것**이라 "번역 누락"이라고 말하면 그것이 거짓이 된다.
 *    무엇을 왜 뺐는지는 카탈로그(`messages/uiparts.ts`) 머리 주석에 적혀 있다.
 *
 * 🔴 라틴 문자로 시작하는 번역에는 **분리 공백**을 앞에 넣는다 — 한국어 `5건` 은 붙여 쓰는 것이
 *    맞지만 영어 `5items` 는 틀린 표기다. 일본어(`5件`)는 붙여 쓰므로 넣지 않는다.
 *    ko 경로는 조회 자체를 하지 않아 **DOM·문자열이 한 글자도 바뀌지 않는다**(기존 가드 동결분 보존).
 */
function useUnitWord(): (u: string) => string {
  const locale = useUiLocale();
  // 🔴 정체성을 locale 에 묶는다 — `useDurationText()` 가 이 함수를 의존성으로 들고, 호출부가 그
  //    포맷터를 useCallback/useEffect 의존성에 넣으면 렌더마다 새 함수가 되어 조회 루프가 된다
  //    (`useTAttr` 에서 실제로 겪은 것 — `test/ui/tattr-identity-loop.spec.tsx`).
  return React.useCallback((u: string) => {
    if (locale === 'ko' || !u) return u;
    const r = tOf(`${u}@단위`, locale);
    if (r.missing) return u;
    return /^[A-Za-z]/.test(r.text) ? ` ${r.text}` : r.text;
  }, [locale]);
}

export function KDate({ value, mode = 'date', fallback = '-', unknown, className }: {
  value: unknown; mode?: KDateMode; fallback?: string;
  /**
   * 값이 없을 때의 **의미**. 지정하면 `-` 대신 그 사실을 말한다.
   * 시각을 사후 추정하지 않기로 한 이상(취소 시각 미상 63건 등) 화면이 '기록 없음'을 말할 수 있어야 한다.
   */
  unknown?: UnknownKind;
  className?: string;
}) {
  const s = useUiSettings();
  // UI 크롬 언어(P1-C) — 날짜·시각 포맷 로케일. ko 기본이라 종전 화면과 동일, ko 외에서만 표기가 달라진다.
  const localeTag = localeTagOf(useUiLocale());
  const empty = value === null || value === undefined || value === '';
  if (empty && unknown) return <Unknown kind={unknown} className={className} />;
  // BiDi 격리 — 날짜·시각은 `2026-09-07 14:30` 처럼 중립 구분자(`-` `:` `/`)로 이어져 RTL 문맥에서 조각이 뒤집힌다
  return <span className={className}><bdi>{formatKDate(value, s, mode, fallback, localeTag)}</bdi></span>;
}

/**
 * 금액 표시 — **숫자가 주인공, 단위는 보조**.
 * 통화 단위(원·만원·₩)를 0.5em 으로 렌더해 같은 크기로 붙어 있을 때보다 숫자가 먼저 읽히게 한다.
 * 폰트 크기는 부모를 따르므로(em) 어디에 놓아도 비율이 유지된다.
 */
export function Money({ value, fallback = '-', className }: { value: unknown; fallback?: string; className?: string }) {
  const s = useUiSettings();
  // 로케일은 천단위 구분에만 관여 — 🔴 통화 접미(원/₩)는 로케일과 무관하게 불변(formatMoney 정본이 보장)
  const localeTag = localeTagOf(useUiLocale());
  const { amount, unit } = splitCurrency(formatMoney(value, s, fallback, localeTag));
  return (
    <span className={className}>
      {/* BiDi 격리 — 금액+통화는 한 덩어리다(R-A0) */}
      <bdi>
        {amount}
        {unit && <span className="text-[0.5em] font-normal opacity-70">{unit}</span>}
      </bdi>
    </span>
  );
}

/**
 * 값+단위 표시 — **숫자가 주인공, 단위는 보조**(0.5em).
 * 통화(원·만원·₩)뿐 아니라 %·명·건·일·℃·mmHg 등 숫자 뒤 단위 전부에 같은 규칙을 적용한다.
 * 날짜·차트번호처럼 숫자로 끝나는 값은 잘리지 않는다(splitValueUnit 규칙).
 */
export function UnitText({ text, className }: { text: string | number; className?: string }) {
  const { amount, unit } = splitValueUnit(String(text ?? ''));
  /**
   * 🔴 잘라낸 단위도 `<Unit>` 과 **같은 규칙**으로 조회한다 — 이 부품이 `StatCard` 의 문자열 값
   *    (`"12건"`·`"3명"`)을 그리는 길이라, 여기만 빼면 카드 숫자 옆이 한국어로 남는다
   *    (2026-09-09 운영 스크린샷의 증상 그대로). 단위가 아닌 꼬리(`mmHg`·`℃`·`kg`)는
   *    `@단위` 키가 없어 원문 그대로 지나간다.
   */
  const unitWord = useUnitWord();
  return (
    <span className={className}>
      {/* BiDi 격리 — `120/80 mmHg` 는 RTL 문맥에서 `mmHg 80/120` 로 재배치될 수 있다(R-A0) */}
      <bdi>
        {amount}
        {unit && <span className="text-[0.5em] font-normal opacity-70">{unitWord(unit)}</span>}
      </bdi>
    </span>
  );
}

/** 금액 전용 별칭 — 통화 규칙만 적용(호출부 의도를 남겨 둔다) */
export function MoneyText({ text, className }: { text: string; className?: string }) {
  const { amount, unit } = splitCurrency(text);
  return (
    <span className={className}>
      {/* BiDi 격리 — Money 와 같은 규칙(R-A0) */}
      <bdi>
        {amount}
        {unit && <span className="text-[0.5em] font-normal opacity-70">{unit}</span>}
      </bdi>
    </span>
  );
}

/**
 * 환자 식별 표시 — 888곳 인라인 `{familyName}{givenName}` 반복의 단일화.
 * maskable=true(보드·대기열 등 공용 화면)면 ui.patientNameMasking=PARTIAL 시 가운데 글자 마스킹.
 * 차트·처방 등 임상 화면은 maskable 미지정(항상 실명).
 */
export function PatientName({ familyName, givenName, name, koreanName, mrn, maskable, showMrn = true, className }: {
  familyName?: string | null; givenName?: string | null;
  /** 이미 합쳐진 이름 문자열(BE 조립 응답용) — familyName/givenName보다 우선 낮음 */
  name?: string | null;
  /** 외국인 환자의 한국식 호칭(`Patient.koreanName`) — 원어가 한글이 아니면 원어 옆에 함께 보인다(shared patientNameView) */
  koreanName?: string | null;
  mrn?: string | null;
  maskable?: boolean; showMrn?: boolean; className?: string;
}) {
  const s = useUiSettings();
  // 🔴 성+이름은 정본(joinPatientName)으로 — 외국 이름을 붙여 쓰면 `SmithJohn` 이 된다
  const v = patientNameView({ familyName, givenName, name, koreanName });
  const raw = v.primary || '-';
  const mask = maskable && s.patientNameMasking === 'PARTIAL';
  const display = mask ? maskPatientName(raw) : raw;
  const ko = v.korean ? (mask ? maskPatientName(v.korean) : v.korean) : null;
  return (
    <span className={className}>
      {display}
      {ko ? <span className="ml-1 text-[0.85em] font-normal text-gray-500" data-patient-korean-name>({ko})</span> : null}
      {showMrn && mrn ? <span className="text-[10px] text-gray-400 ml-1">{mrn}</span> : null}
    </span>
  );
}

/**
 * 직원 표시 — 의료진·수행자·서명자·취소자 이름의 단일화.
 * 환자(PatientName)와 달리 **마스킹하지 않는다**(직원 이름은 PHI 가 아니고, 누가 했는지가 기록의 핵심).
 * 직함(선생님·간호사)은 화면 맥락마다 달라 `suffix` 로 받는다.
 *
 * 값이 없을 때 `-` 로 뭉개지 않는다 — "기록이 없다"와 "해당 없음"은 다른 사실이다(Unknown 참조).
 */
export function StaffName({ familyName, givenName, name, department, role, suffix, unknown = 'UNRECORDED', className }: {
  familyName?: string | null; givenName?: string | null;
  /** 이미 합쳐진 이름(BE 조립 응답용) */
  name?: string | null;
  department?: string | null;
  /** 직함/역할 배지 — '판독의', '조제' 등 수행 역할 */
  role?: string | null;
  /** '선생님' 처럼 이름 뒤에 붙는 호칭 */
  suffix?: string;
  unknown?: UnknownKind;
  className?: string;
}) {
  const raw = (`${familyName ?? ''}${givenName ?? ''}`.trim() || name?.trim() || '');
  if (!raw) return <Unknown kind={unknown} className={className} />;
  return (
    <span className={className}>
      {raw}{suffix ?? ''}
      {role ? <span className="ml-1 text-[10px] text-gray-400">{role}</span> : null}
      {department ? <span className="ml-1 text-[10px] text-gray-400">{department}</span> : null}
    </span>
  );
}

/**
 * 값이 없다는 사실의 표기 — **'모른다'와 '해당 없음'을 구분한다**.
 *
 * 🔴 종전엔 전부 `-` 였다. 그래서 "취소 시각이 기록되지 않았다"(추정 금지 대상)와
 *    "아직 취소되지 않았다"(정상)가 화면에서 같아 보였다. 시각·행위자를 추정하지 않기로 한 이상
 *    화면은 **모른다는 사실 자체를 말할 수 있어야** 한다(2026-08-03 데이터 정합성 스캔).
 */
export type UnknownKind =
  /** 기록되지 않음 — 그 시점에 남기지 않아 지금은 알 수 없다(사후 추정 금지) */
  | 'UNRECORDED'
  /** 해당 없음 — 애초에 값이 생기지 않는 경우 */
  | 'NA'
  /** 아직 없음 — 진행 중이라 앞으로 생길 값 */
  | 'PENDING';

const UNKNOWN_TEXT: Record<UnknownKind, { text: string; title: string }> = {
  UNRECORDED: { text: '기록 없음', title: '그 시점에 기록되지 않아 알 수 없습니다(사후 추정하지 않습니다)' },
  NA: { text: '해당 없음', title: '이 항목이 적용되지 않습니다' },
  PENDING: { text: '아직 없음', title: '진행 중입니다' },
};

export function Unknown({ kind = 'UNRECORDED', className = '' }: { kind?: UnknownKind; className?: string }) {
  /**
   * 🔴 세 어휘는 **서로 다른 사실**이다(기록 없음 ≠ 해당 없음 ≠ 아직 없음). 번역이 셋을 하나로
   *    뭉개면 화면이 거짓말을 한다 — 그래서 카탈로그에서 **사람 검수 대상**으로 열거해 두었다
   *    (`messages/uiparts.ts` 머리 주석 ④). 지금은 AI 초안이라 초안 티가 붙는다.
   */
  /**
   * 🔴 여기만 `<T>` 가 아니라 `tAttr` 이다 — **DOM 구조를 유지하려고**.
   *    `<T>` 는 span 을 하나 더 만드는데, 이 부품의 계약은 "보이는 낱말을 가진 요소가 곧
   *    **툴팁(title)을 가진 요소**"다(가드 `display-parts.spec.tsx` 가 `getByText('기록 없음')` 의
   *    title 을 읽는다 — 중첩되면 안쪽 span 에는 title 이 없어 `null` 이 된다).
   *    가드를 고치는 대신 구조를 지켰다(기획 §10 규약 4 — 배선이 가드를 죽이면 배선을 바꾼다).
   *    잃는 것은 초안 티뿐인데, 이 자리의 title 은 이미 "왜 모르는지"를 말하는 데 쓰여
   *    초안 툴팁을 덧씌울 자리가 애초에 없다. 세 낱말은 모두 카탈로그에 등재돼 있다(미등록 티 불필요).
   */
  const tAttr = useTAttr();
  const { text, title } = UNKNOWN_TEXT[kind];
  return <span className={`text-gray-400 ${className}`} title={tAttr(title)}>{tAttr(text)}</span>;
}

/**
 * 재원일수 표시 — 산식은 입원료 청구와 같은 정본(shared stayDays)을 쓴다.
 * 화면마다 floor/ceil 이 갈리면 청구서(3일)와 화면(2일)이 다른 일수를 보여준다.
 */
const ROUND_MODE_LABEL: Record<RoundMode, string> = {
  round: '반올림', floor: '버림', ceil: '올림', bankers: '은행가반올림',
};

/**
 * 수치 표시 정본 — 정책(도메인)대로 자릿수·반올림·단위를 적용한다.
 *   <Num value={t} domain="temperature" />        → "38.2℃"(단위 0.5em 보조)
 *   <Num value={n} domain="copay" />               → "12,340원"(원단위 절사)
 *
 * `showPolicy` 면 현재 적용 기준을 title 로 노출한다(투명성 §3.8) — "체온 · 소수 1자리 · 반올림 · FHIR/UCUM".
 * config 오버라이드(ui.precision.*) 배선은 P3 — 지금은 레지스트리 기본을 쓴다.
 */
export function Num({ value, domain, unit = true, showPolicy = false, className }: {
  value: number | null | undefined;
  domain: string;
  unit?: boolean;
  showPolicy?: boolean;
  className?: string;
}) {
  const s = useUiSettings();
  const ov = s.precision[domain];
  // 로케일 무전달(의도) — shared formatNum 은 toFixed 기반·천단위 구분 없음이라 어느 로케일에서도 동일하고
  // (nu-latn 방침과 일치), 수치 정책은 locked 라 로케일이 자릿수·반올림을 바꿔서도 안 된다.
  const text = formatNum(value, domain, { unit, override: ov != null ? { decimals: ov } : undefined });
  const p = policyOf(domain);
  let tip: string | undefined;
  if (showPolicy && p) {
    const prec = p.decimals != null ? `소수 ${p.decimals}자리` : p.sigFigs != null ? `유효숫자 ${p.sigFigs}` : '정수';
    tip = `${p.label} · ${prec} · ${ROUND_MODE_LABEL[p.mode]}${p.standard ? ` · ${p.standard}` : ''}`;
  }
  // BiDi 격리(R-A0) — `5 mg`·`38.3℃` 처럼 값+단위가 붙은 표기는 RTL 에서 순서가 뒤집힌다
  if (!unit) return <span className={className} title={tip}><bdi>{text}</bdi></span>;
  const { amount, unit: u } = splitValueUnit(text);
  return (
    <span className={className} title={tip}>
      <bdi>
        {amount}
        {u && <span className="text-[0.5em] font-normal opacity-70">{u}</span>}
      </bdi>
    </span>
  );
}

/**
 * 비율·완결률 정본 — **분모와 함께** 낸다. 정본 계산은 shared `ratioOf`/`ratioText`.
 *
 * 🔴 분모 0이면 완결률은 100% 가 되고, 표본 부재를 `0%`·`-` 로 그리면 "안 잰 것"과 "진짜 0"이 같아 보인다
 *    (손위생 준수율 관찰 0건이 `-`, ICU NEWS2 산출 불가가 `0점`). 그래서 비율은 한 덩어리로 그린다:
 *      <Ratio numerator={qiMet} denominator={qiJudged} />          → "12 / 15 (80.0%)"
 *      <Ratio numerator={0} denominator={0} />                    → "산출 불가" (title: 분모 0)
 *      <Ratio numerator={n} denominator={d} pctOnly />            → "80.0%" — 그래도 title 에 n/N 을 남긴다
 *      <Ratio ... unavailableHint="이 기간 관찰 기록 없음" />        → 산출 불가 옆에 왜 없는지
 */
export function Ratio({ numerator, denominator, pctOnly = false, decimals, unavailableHint, className }: {
  numerator: number | null | undefined;
  denominator: number | null | undefined;
  /** 백분율만 보이게(공간이 좁을 때) — n/N 은 title 로 남는다 */
  pctOnly?: boolean;
  decimals?: number;
  /**
   * 산출 불가일 때 덧붙일 사유(무엇이 없어서 못 세는지).
   * 🔴 문자열=카탈로그 키 · 노드=그대로. **서버가 만든 사유**(`report?.reason` 등)는 `<Data>` 로 감싼다 —
   *    맨 문자열로 넘기면 "번역 미등록" 티가 붙어 화면이 거짓을 말한다(2026-09-12 실측 3곳).
   */
  unavailableHint?: React.ReactNode;
  className?: string;
}) {
  const tAttr = useTAttr();
  const r = ratioOf(numerator, denominator);
  if (r.pct == null) {
    const why = r.unavailableReason === 'NO_NUMERATOR' ? '분자 미집계' : r.unavailableReason === 'NO_DENOMINATOR' ? '분모 미상' : '분모 0(대상 없음)';
    /**
     * 🔴 **사유를 값 옆에 붙이면 값 줄이 길어져 카드가 접힌다**(2026-09-03).
     *    `산출 불가 (등록 병상 없음)` 이 통계 카드(최소폭 150px)에서 2~3줄로 접히고,
     *    그 카드 하나가 grid 한 줄 전체를 높여 나머지 카드가 위로 쏠렸다.
     *    사유는 **버리지 않되**(왜 못 세는지가 이 표시의 핵심이다) 아래 줄로 내린다 —
     *    `inline-flex flex-col` 이라 문장 안에서도, 카드 안에서도 값 줄을 넓히지 않는다.
     */
    return (
      <span
        className={`inline-flex flex-col items-start leading-tight text-gray-500 ${className ?? ''}`}
        title={`${tAttr(why)}${typeof unavailableHint === 'string' ? ` — ${tAttr(unavailableHint)}` : ''}`}
        data-ratio="unavailable"
      >
        <span className="whitespace-nowrap"><T k={RATIO_UNAVAILABLE} /></span>
        {unavailableHint && <span className="text-[11px] font-normal text-gray-400">{typeof unavailableHint === 'string' ? <T k={unavailableHint} /> : unavailableHint}</span>}
      </span>
    );
  }
  const full = ratioText(numerator, denominator, { decimals });
  // BiDi 격리(R-A0) — `12 / 15 (80.0%)` 는 슬래시·괄호가 전부 중립이라 RTL 문맥에서 분자·분모가 뒤바뀐다.
  // 🔴 '산출 불가' 분기(위)는 낱말이라 감싸지 않는다.
  if (pctOnly) {
    return <span className={className} title={full}><bdi>{ratioText(numerator, denominator, { pctOnly: true, decimals })}</bdi></span>;
  }
  return <span className={className}><bdi>{full}</bdi></span>;
}

export function StayDays({ admit, discharge, className }: {
  admit: string | Date | null | undefined;
  /** 미지정=재원 중(지금까지) — '진행중' 표기가 붙는다 */
  discharge?: string | Date | null;
  className?: string;
}) {
  const days = stayDays(admit, discharge);
  if (days === null) return <Unknown kind="UNRECORDED" className={className} />;
  return (
    <span className={className}>
      {/* BiDi 격리(R-A0) — 값+단위만. '진행중'은 낱말이라 밖에 둔다 */}
      <bdi>{days}<Unit>일</Unit></bdi>
      {!discharge && <span className="ml-1 text-[10px] text-gray-400"><T k="진행중" /></span>}
    </span>
  );
}

/**
 * 작성 가능성 배지 — "이 화면에서 지금 쓸 수 있는가"를 조용히 말한다(lib/capabilities 정본).
 * 세련됨의 규칙: 숨기지 않고(무엇이 가능한지 배우게), 소리치지 않고(작은 pill),
 * 이유를 갖게(hover 툴팁 — 작성은 어디서·누가 하는지).
 *
 * §4.6 관점: 이 배지는 **이미 색 외 채널을 항상 갖고 있다**(●/◐/🔒 가 모드마다 다르다) —
 * 그래서 `ui.a11y.statusShape` 대상이 아니다. 색만으로 구분하는 배지는 `shape` 를 받는다(StatusShapeMark 참조).
 */
export function CapabilityBadge({ mode, label, reason, className = '' }: {
  mode: 'write' | 'delegated' | 'readonly';
  label: string;
  reason: string;
  className?: string;
}) {
  const tAttr = useTAttr();
  const tone = mode === 'write'
    ? 'bg-emerald-50 text-emerald-700'
    : mode === 'delegated'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-500';
  const dot = mode === 'write' ? '\u25cf' : mode === 'delegated' ? '\u25d0' : '\ud83d\udd12';
  return (
    <span
      title={tAttr(reason)}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone} ${className}`}
    >
      <span aria-hidden="true" className={mode === 'readonly' ? 'text-[9px]' : 'text-[8px]'}>{dot}</span>
      <T k={label} />
    </span>
  );
}


/**
 * 빈 목록 상태 — 658곳/384파일의 인라인 "…없습니다" 표준화((main) 전역판).
 *
 * `compact`: 대시보드 위젯처럼 **카드가 작을 때** 쓴다. 기본형(py-12 + 큰 아이콘)을 그대로 넣으면
 * "없다"는 한 줄 정보가 카드 높이의 대부분을 차지해, 데이터가 있는 옆 카드와 균형이 깨진다
 * (2026-08-03 피드백 — 빈 상태가 공간을 너무 먹는다).
 */
export function EmptyState({ icon, title, hint, compact = false, className = '' }: {
  icon?: string; title: React.ReactNode; hint?: React.ReactNode; compact?: boolean; className?: string;
}) {
  /**
   * 🔴 `title`/`hint` 는 **생문자열로 렌더되고 있었다** — 호출부가 `tAttr` 로 번역해 넘겨도
   *    이 부품은 그것을 그냥 찍을 뿐이라 **미등록 티를 그릴 방법이 없었다**(호출부 658곳/384파일).
   *    `<T>` 로 감싸면 카탈로그 히트 시 번역되고, 미스면 한국어 원문 + `EN×`/`JA×` 티가 뜬다
   *    ("없다"를 조용히 번역된 것처럼 보이게 하지 않는다 · P1-D 문자열 prop 규약).
   *
   * 🔴 **그런데 그 규약이 서버 데이터에는 거짓말을 했다**(2026-09-12 실측). `list.unavailableReason`·
   *    `report?.reason`·`zeroMeaning` 처럼 **서버가 만든 정직성 문구**가 들어오면 카탈로그에 있을 리
   *    없어 `EN×`("번역 미등록")가 붙었다 — 그 문장은 등재 대상이 아니라 그 순간의 사실이고,
   *    하필 "왜 셀 수 없는지"를 말하려고 서버가 만든 것이었다.
   *    계약을 **문자열=카탈로그 키 · 노드=그대로**로 나눈다. 서버 문자열은 호출부가 `<Data>` 로 감싼다.
   */
  const asText = (v: React.ReactNode) => (typeof v === 'string' ? <T k={v} /> : v);
  if (compact) {
    return (
      <p className={`flex items-center justify-center gap-1.5 py-3 text-xs text-gray-400 ${className}`}>
        {icon && <span aria-hidden="true" className="opacity-60">{icon}</span>}
        <span>{asText(title)}</span>
        {hint && <span className="text-gray-300">· {asText(hint)}</span>}
      </p>
    );
  }
  return (
    <div className={`py-12 text-center ${className}`}>
      {icon && <div className="text-2xl mb-2">{icon}</div>}
      <p className="text-sm text-gray-400">{asText(title)}</p>
      {hint && <p className="text-xs text-gray-300 mt-1">{asText(hint)}</p>}
    </div>
  );
}

/**
 * 경과 시간 — **분 단위 원시값을 사람이 읽는 형태로**(`352` → `5시간 52분`).
 *
 * 🔴 관제·대기 화면이 `449분`·`1418분` 을 그대로 찍고 있었다. 관제자는 그것을 머릿속에서
 *    시간으로 환산해야 했고, "얼마나 심각한지"가 한눈에 안 들어왔다(2026-08-10 관제 실측).
 *    같은 표기를 여러 화면이 각자 만들지 않도록 여기(표시 정본)에 둔다.
 *
 * `dense` 는 카드처럼 폭이 좁을 때 — `5h52m` 대신 한국어 축약 `5시간 52분` 을 유지하되 '분' 을 생략.
 */
/**
 * 경과 시간 조각 — 값·단어를 한 곳에서 만든다.
 * 🔴 `<Duration>`(JSX)과 `durationText`(문자열)가 **같은 규칙**을 쓰게 하려는 것.
 *    따로 구현하면 한쪽만 고쳐져 화면마다 다른 값이 보인다(로컬 포맷터가 그랬다).
 */
export function durationSegments(minutes: number | null | undefined, dense = false): { value: number; unit: string }[] | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const m = Math.round(minutes);
  if (m < 60) return [{ value: m, unit: '분' }];
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh > 0 ? [{ value: d, unit: '일' }, { value: hh, unit: '시간' }] : [{ value: d, unit: '일' }];
  }
  return rest > 0 && !dense ? [{ value: h, unit: '시간' }, { value: rest, unit: '분' }] : [{ value: h, unit: '시간' }];
}

/**
 * 경과 시간 **문자열(한국어 단위 고정)** — 🔴 **화면에서 직접 부르지 않는다. `useDurationText()` 를 쓴다.**
 *
 * 단위 낱말이 박혀 있어 영어·일본어 화면에서도 `5시간 52분` 이 그대로 남는다(2026-09-12 실측).
 * 남겨 둔 이유는 둘뿐이다 — ① `useDurationText()` 와 `<Duration>` 이 공유하는 **조각 규칙의 ko 기준선**을
 * 테스트가 동결하는 자리(`test/ui/duration-format.spec.ts`) ② 훅을 쓸 수 없는 비-React 문맥.
 * `app/**` 에서의 직접 호출은 **0 으로 동결**한다(`test/ui/duration-locale-guard.spec.ts`).
 *
 * 🔴 화면마다 로컬 포맷터를 두면 24시간을 일로 못 바꿔 `1815시간 1분`(=75일) 같은 값이 나온다.
 */
export function durationText(minutes: number | null | undefined, fallback = '-', dense = false): string {
  const seg = durationSegments(minutes, dense);
  if (!seg) return fallback;
  return seg.map((s) => `${s.value}${s.unit}`).join(' ');
}

/**
 * 경과 시간 문자열 — **UI 언어를 따른다**(`5시간 52분` → `5 hours 52 min` → `5時間52分`).
 *
 * 🔴 `durationText()` 는 단위 낱말(`분`·`시간`·`일`)을 **박아서** 돌려준다. `<Duration>` 은
 *    `<Unit>` → `useUnitWord()` 를 지나 번역되지만 **문자열 경로는 그 길을 안 지나서**,
 *    영어·일본어 화면에서도 `Arrived 5분` 처럼 한국어 단위가 남아 있었다(2026-09-12 실측
 *    호출부 38곳/24파일 — ER 베드보드·PACU·분만보드·환자흐름·전광판 포함).
 *    문자열이 필요한 자리(템플릿·title 속성·`<Tf params>`)는 **이 훅**을 쓴다.
 *
 * 🔴 단위어 조회 규칙은 `<Unit>` 과 **같은 것 하나**다(`useUnitWord` — `<단위>@단위` 문맥 키만 보고
 *    미등록이면 한국어 원문을 그대로 둔다). 여기서 따로 구현하면 `<Duration>` 과 갈라진다.
 *
 * 🔴 **ko 는 한 글자도 바뀌지 않는다** — `useUnitWord` 가 ko 에서 조회 자체를 하지 않으므로
 *    `useDurationText()(m)` 과 `durationText(m)` 의 출력이 동일하다(가드가 동결한다).
 */
export function useDurationText(): (minutes: number | null | undefined, fallback?: string, dense?: boolean) => string {
  const unitWord = useUnitWord();
  return React.useCallback((minutes: number | null | undefined, fallback = '-', dense = false) => {
    const seg = durationSegments(minutes, dense);
    if (!seg) return fallback;
    return seg.map((s) => `${s.value}${unitWord(s.unit)}`).join(' ');
  }, [unitWord]);
}

export function Duration({ minutes, fallback = '-', dense = false, className }: {
  minutes: number | null | undefined; fallback?: string; dense?: boolean; className?: string;
}) {
  const seg = durationSegments(minutes, dense);
  if (!seg) return <span className={className}>{fallback}</span>;
  return (
    <span className={className}>
      {/* BiDi 격리(R-A0) — `5시간 52분` 은 값·단위가 번갈아 나와 RTL 에서 조각 순서가 무너진다 */}
      <bdi>
        {seg.map((s, i) => (
          <span key={s.unit}>{i > 0 && ' '}{s.value}<Unit>{s.unit}</Unit></span>
        ))}
      </bdi>
    </span>
  );
}

/**
 * 단위 조각 — 숫자 뒤에 바로 붙는 단위(건·명·원·%·일…)를 0.5em 으로.
 * `{n}건` 처럼 JSX 텍스트에 직접 쓰인 단위를 감싸는 용도(문자열을 파싱하지 않아 안전하다).
 */
export function Unit({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const unitWord = useUnitWord();
  /**
   * 🔴 **문자열 children 일 때만** 조회한다. 이미 `<Unit><T k="일@단위" /></Unit>` 로 배선된
   *    호출부(2026-09-09 실측 2곳)가 있어서 — 노드를 다시 번역하려 들면 이중 처리가 된다.
   *    그 외(숫자·조각 노드)는 손대지 않고 그대로 흘린다.
   */
  const body = typeof children === 'string' ? unitWord(children) : children;
  return <span className={`text-[0.5em] font-normal opacity-70 ${className}`}>{body}</span>;
}

/* ── 좁은 폭 자동 축약(2026-08-04) ────────────────────────────────────────────
 * 좁은 화면에서 한글 배지가 글자 단위로 세로 꺾이던 것의 정본 해법.
 * 판정은 globals.css 의 .adaptive-label/.adaptive-compact —
 * 기본은 뷰포트(900px)라 어느 화면이든 브라우저 크기 조절에 그대로 반응하고,
 * 조상에 @container 를 선언한 곳(환자 목록 2열 등)에선 그 컨테이너 폭(56rem)이 우선한다.
 * 🔴 Tailwind @[..] 변형은 조상 컨테이너가 없으면 항상 불일치(뷰포트 폴백 없음 — 실측)라 전역 부품엔 부적합.
 */

/* ── 색 외 보조 채널(임상 UX 규약 §4.6 "색만으로 말하지 않는다") ──────────────
 * 남성 색각이상 유병률·야간 근무 조도 때문에 **색은 보조 채널**이어야 한다.
 * 병원 정책(SystemConfig `ui.a11y.statusShape`)이 켜지면 상태 배지가 색 외에 **모양**을 함께 낸다.
 *
 * 🔴 지금 범위는 **부품 하나(AdaptiveBadge)+길**까지다. 전 화면 일괄 적용은 다음 단계(§10 P3).
 * 사용법 — 상태를 색으로만 구분하던 배지에 `shape` 를 넘긴다:
 *     <AdaptiveBadge icon={…} label="격리" tone="bg-red-50 text-red-700" shape="danger" />
 * 다른 부품(로컬 배지 등)에는 `<StatusShapeMark shape="warn" />` 를 라벨 앞에 놓으면 된다.
 * 🔴 `shape` 를 **주지 않으면 아무것도 하지 않는다** — 색 클래스에서 의미를 추측해 지어내지 않는다.
 */
export type StatusShape = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const STATUS_SHAPE: Record<StatusShape, { symbol: string; word: string }> = {
  ok: { symbol: '●', word: '정상' },       // ●
  warn: { symbol: '▲', word: '주의' },      // ▲
  danger: { symbol: '■', word: '위험' },    // ■
  info: { symbol: '◆', word: '정보' },      // ◆
  neutral: { symbol: '○', word: '해당 없음' }, // ○
};

/** 상태 기호 — `ui.a11y.statusShape` 가 켜졌을 때만 그린다(꺼져 있으면 현행 그대로 아무것도 렌더하지 않는다) */
export function StatusShapeMark({ shape, className = '' }: { shape?: StatusShape; className?: string }) {
  const s = useUiSettings();
  const tAttr = useTAttr();
  if (!shape || !s.statusShape) return null;
  const { symbol, word } = STATUS_SHAPE[shape];
  return (
    <span data-status-shape={shape} title={tAttr(word)} className={`text-[9px] leading-none ${className}`}>
      {symbol}
    </span>
  );
}

/** 자동 축약 배지 — 넓으면 아이콘+라벨, 좁으면 아이콘만(툴팁으로 라벨 유지) */
export function AdaptiveBadge({ icon, label, tone = 'bg-gray-100 text-gray-600', shape, className = '' }: {
  icon: React.ReactNode;
  label: string;
  /** 배경·글자색 클래스 조합(bg-… text-…) */
  tone?: string;
  /** 색 외 보조 채널 — `ui.a11y.statusShape` 가 켜졌을 때만 기호로 나온다(§4.6) */
  shape?: StatusShape;
  className?: string;
}) {
  const tAttr = useTAttr();
  return (
    <span title={tAttr(label)}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tone} ${className}`}>
      <StatusShapeMark shape={shape} />
      <span aria-hidden="true" className="inline-flex">{icon}</span>
      {/* `.adaptive-label` 은 자기 자신에 `display:none` 을 걸므로 안쪽 <T> 의 span 이 배치를 바꾸지 않는다 */}
      <span className="adaptive-label"><T k={label} /></span>
    </span>
  );
}

/** 미니 라인 아이콘(현재 색 상속) — AdaptiveBadge 용 14px SVG */
function MiniIcon({ d }: { d: string }) {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/** 보험 유형 아이콘 경로(heroicons outline) — 건보=방패 · 급여=하트 · 산재=빌딩 · 자동차=트럭 · 자비=카드 */
const INSURANCE_ICON_PATH: Record<string, string> = {
  NHI: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z',
  MEDICAID: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z',
  INDUSTRIAL: 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  AUTO: 'M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
  SELF_PAY: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
};

/** 보험 유형 배지 — 라벨/아이콘/색 한 벌(shared INSURANCE_LABEL 정본) */
export function InsuranceBadge({ type, label, tone, className }: {
  type: string;
  /** 표시 라벨(미지정 시 type 그대로) — 호출부에서 INSURANCE_LABEL[type] 전달 */
  label?: string;
  tone?: string;
  className?: string;
}) {
  return (
    <AdaptiveBadge
      icon={<MiniIcon d={INSURANCE_ICON_PATH[type] ?? INSURANCE_ICON_PATH.SELF_PAY} />}
      label={label ?? type}
      tone={tone}
      className={className}
    />
  );
}

/** 태그 칩 — 넓으면 전체 텍스트, 좁으면 첫 글자 원형(툴팁으로 전체) */
export function TagChip({ tag, bg = 'bg-gray-100', text = 'text-gray-600', className = '' }: {
  tag: string;
  bg?: string;
  text?: string;
  className?: string;
}) {
  return (
    <span title={tag} className={`text-[10px] font-medium rounded-full whitespace-nowrap ${bg} ${text} px-1.5 py-0.5 ${className}`}>
      <span className="adaptive-compact w-4 h-4 items-center justify-center font-bold">{tag[0]}</span>
      <span className="adaptive-label">{tag}</span>
    </span>
  );
}

/** 약물명 폴백 정본(한/영 병용 P2·D3) — nameKo → nameEn → code → '-'. 문자열 맥락용 */
export function drugNameOf(d: { nameKo?: string | null; nameEn?: string | null; code?: string | null } | null | undefined, fallback = '-') {
  return d?.nameKo || d?.nameEn || d?.code || fallback;
}

/**
 * 약물명 표시 정본(한/영 병용 P2·D3 + 용어 토글 P0) — 화면마다 제각각이던 인라인 폴백 체인을 이관.
 *
 * - bilingual: 처방전·**대외 문서 강제 병기**(`nameKo (nameEn)` — 둘 다 있을 때만).
 *   🔴 bilingual 이면 사용자 표시 모드를 **무시**한다 — 표기 선호가 대외 문서를 바꾸면 안 된다.
 * - 그 외에는 사용자 용어 모드(useTermLang)를 따른다(medical-term-display-toggle.plan.md §2.1):
 *   EN = 상품명(nameEn) → 라틴 시작 성분(ingredient) → 한글+'영문명 미등록' 티.
 *   🔴 로마자 자동변환 금지 — 없는 영문명은 없다고 말한다.
 */
export function DrugName({ nameKo, nameEn, ingredient, code, bilingual, className }: {
  nameKo?: string | null;
  nameEn?: string | null;
  /** EN 표시의 실탄 — 운영 실측 98.2% 채움(상품명 nameEn 은 0.2%뿐) */
  ingredient?: string | null;
  code?: string | null;
  bilingual?: boolean;
  className?: string;
}) {
  const mode = useTermLang();
  if (bilingual) {
    const primary = drugNameOf({ nameKo, nameEn, code });
    const showEn = !!nameKo && !!nameEn;
    return (
      <span className={className}>
        {/* BiDi 격리(R-A0) — 약물명은 `500mg`·괄호 병기·코드가 섞여 RTL 문맥에서 조각이 재배치된다 */}
        <bdi>
          {primary}
          {showEn && <span className="text-gray-400"> ({nameEn})</span>}
        </bdi>
      </span>
    );
  }
  const latinIngredient = ingredient && /^[A-Za-z]/.test(ingredient.trim()) ? ingredient.trim() : '';
  const en = nameEn?.trim() || latinIngredient;
  const ko = nameKo?.trim() || '';
  if (mode === 'EN') {
    if (en) return <span className={className}><bdi>{en}</bdi></span>;
    const primary = ko || code || '-';
    return (
      <span className={className} title={ko ? TERM_EN_UNREGISTERED : undefined}>
        <bdi>
          {primary}
          {!!ko && <sup className="ml-0.5 select-none text-[9px] text-gray-400" aria-label={TERM_EN_UNREGISTERED}>EN×</sup>}
        </bdi>
      </span>
    );
  }
  if (mode === 'BOTH' && ko && en) {
    return (
      <span className={className}>
        <bdi>
          {ko}
          <span className="text-gray-400"> ({en})</span>
        </bdi>
      </span>
    );
  }
  return <span className={className}><bdi>{drugNameOf({ nameKo, nameEn, code })}</bdi></span>;
}

/**
 * 성별 표기는 **shared 정본**을 그대로 쓴다.
 *
 * 🔴 2026-08-12: 여기에 `genderText` 를 새로 만들었는데, shared `GENDER_LABEL` 에 이미
 *    정본이 있었다(그쪽이 `OTHER`·`UNKNOWN` 까지 다뤄 더 완전하다). 정본을 둘로 만든 것은
 *    이날 P12 로 이름 붙인 바로 그 잘못이다 — 즉시 합쳤다.
 */
export { genderText, genderCode } from '@hospital-run/shared';
