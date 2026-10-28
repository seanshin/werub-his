'use client';

import { localeTagOf } from '@hospital-run/shared';
import { useCallback } from 'react';
import { useUiLocaleStore } from '@/stores/ui-locale-store';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatDateTimeLocale } from '@/lib/ko-day-period';

/**
 * 화면 표시(UX) 공통 단위 설정 — SystemConfig category='ui' 소비(전 직원 읽기).
 * 관리: /admin/ai-settings(시스템 설정) '화면 표시(UX)' 탭에서 무재시작 변경.
 * 공통컴포넌트(KDate·Money·PatientName·usePollInterval)가 이 훅을 통해 일괄 반영한다.
 * 실패/미로딩 시 기본값 폴백 — 렌더 차단·오류 없음.
 */
export interface UiSettings {
  dateStyle: 'dash' | 'ko';
  time24h: boolean;
  currencyStyle: 'won' | 'symbol';
  patientNameMasking: 'OFF' | 'PARTIAL';
  pollFastMs: number;
  pollNormalMs: number;
  pollSlowMs: number;
  /** 수치 정책 소수 자릿수 오버라이드 — { temperature: 2, ... }. 없으면 레지스트리 기본. */
  precision: Record<string, number>;
  /** 접근성 — 본문 글자 배율(ui.a11y.textScale · 채택 0.9~1.6 · 1.0=현행) */
  textScale: number;
  /** 접근성 — 본문 대비(ui.a11y.contrast · HIGH=회색조 어둡게) */
  contrast: 'NORMAL' | 'HIGH';
  /** 접근성 — 상태를 색 외 모양/기호로도 표시(ui.a11y.statusShape · 색만으로 말하지 않는다) */
  statusShape: boolean;
}

export const UI_DEFAULTS: UiSettings = {
  dateStyle: 'dash',
  time24h: true,
  currencyStyle: 'won',
  patientNameMasking: 'OFF',
  pollFastMs: 10000,
  pollNormalMs: 30000,
  pollSlowMs: 60000,
  precision: {},
  // 🔴 접근성 기본값 = **현행 그대로**(배율 1·대비 NORMAL·기호 OFF). 값은 간호부·환자안전위원회가 정한다.
  //    개발이 기본값을 바꾸면 현장 공지 없이 임상 화면이 달라진다 — 여기는 항상 no-op 이어야 한다.
  textScale: 1,
  contrast: 'NORMAL',
  statusShape: false,
};

export interface ConfigRow { key: string; value: unknown }

/**
 * config 행 → 표시 설정 **파싱 정본**.
 * 관대하게 받되(문자열 숫자·미로딩·부분 응답) **모르는 값은 기본값으로 떨어뜨린다** —
 * 잘못 들어간 설정 하나로 임상 화면이 깨지지 않게 하는 것이 목적이다.
 */
export function parseUiSettings(rows: ConfigRow[] | undefined): UiSettings {
  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) && v >= 1000 ? v : d; // 1초 미만 폴링은 오설정으로 간주
  };
  const str = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
    const v = String(map.get(k) ?? '');
    return (allowed as readonly string[]).includes(v) ? (v as T) : d;
  };
  const precision: Record<string, number> = {};
  for (const [k, v] of map) {
    const pm = /^ui\.precision\.(.+)$/.exec(k);
    if (pm) { const n = Number(v); if (Number.isInteger(n) && n >= 0 && n <= 4) precision[pm[1]] = n; }
  }
  return {
    dateStyle: str('ui.dateStyle', ['dash', 'ko'] as const, UI_DEFAULTS.dateStyle),
    time24h: map.get('ui.time24h') !== false && map.get('ui.time24h') !== 'false',
    currencyStyle: str('ui.currencyStyle', ['won', 'symbol'] as const, UI_DEFAULTS.currencyStyle),
    patientNameMasking: str('ui.patientNameMasking', ['OFF', 'PARTIAL'] as const, UI_DEFAULTS.patientNameMasking),
    pollFastMs: num('ui.poll.fastMs', UI_DEFAULTS.pollFastMs),
    pollNormalMs: num('ui.poll.normalMs', UI_DEFAULTS.pollNormalMs),
    pollSlowMs: num('ui.poll.slowMs', UI_DEFAULTS.pollSlowMs),
    precision,
    // 배율은 **범위 안의 수치만** 채택한다. 0.2·5 같은 오설정은 레이아웃을 파괴하므로 기본값으로 떨어뜨린다.
    textScale: (() => {
      const v = Number(map.get('ui.a11y.textScale'));
      return Number.isFinite(v) && v >= 0.9 && v <= 1.6 ? v : UI_DEFAULTS.textScale;
    })(),
    contrast: str('ui.a11y.contrast', ['NORMAL', 'HIGH'] as const, UI_DEFAULTS.contrast),
    // 🔴 문자열 'true' 는 boolean 이 아니다 — 형식이 어긋난 설정을 켜진 것으로 읽지 않는다.
    statusShape: map.get('ui.a11y.statusShape') === true,
  };
}

// ── 접근성 표면(§4.6) ──────────────────────────────────────────────────────
export interface A11ySettings {
  textScale: number;
  contrast: 'NORMAL' | 'HIGH';
  statusShape: boolean;
}

/** 접근성 접근자(스냅샷) — 훅을 쓸 수 없는 자리용. 정본은 UiSettings 하나다(로컬 재정의 금지). */
export function a11y(): A11ySettings {
  const s = snapshot;
  return { textScale: s.textScale, contrast: s.contrast, statusShape: s.statusShape };
}

/**
 * root 요소에 실을 속성 — **기본값이면 전부 `null`(=아무것도 붙이지 않는다)**.
 * 🔴 배율 1.0 · NORMAL 에서 속성이 붙지 않아야 globals.css 의 어떤 규칙도 매칭되지 않고,
 *    화면이 현행과 픽셀 단위로 동일해진다. `data-text-scale="1"` 을 붙이는 것도 변경이다.
 */
export function a11yRootAttrs(s: UiSettings = snapshot): {
  textScale: string | null;
  contrast: 'HIGH' | null;
  statusShape: boolean;
} {
  const scaled = Number.isFinite(s.textScale) && s.textScale !== 1;
  return {
    textScale: scaled ? String(s.textScale) : null,
    contrast: s.contrast === 'HIGH' ? 'HIGH' : null,
    statusShape: s.statusShape === true,
  };
}

/**
 * root(문서 최상위) 요소에 접근성 표면을 반영한다 — 배선 정본.
 * 소비 규칙은 `globals.css` 의 `[data-text-scale]` / `[data-contrast="HIGH"]` 한 벌뿐이다.
 */
export function applyA11yRoot(el: HTMLElement, s: UiSettings = snapshot): void {
  const a = a11yRootAttrs(s);
  if (a.textScale == null) {
    el.removeAttribute('data-text-scale');
    el.style.removeProperty('--app-text-scale');
  } else {
    el.setAttribute('data-text-scale', a.textScale);
    el.style.setProperty('--app-text-scale', a.textScale);
  }
  if (a.contrast == null) el.removeAttribute('data-contrast');
  else el.setAttribute('data-contrast', a.contrast);
}

/** 스냅샷 기반 정밀도 오버라이드 — 훅 밖(formatTemp 등 모듈 함수)에서 config 반영 */
export function precisionOverride(domain: string): { decimals: number } | undefined {
  const d = snapshot.precision?.[domain];
  return d != null ? { decimals: d } : undefined;
}

/**
 * 모듈 스냅샷 — 훅을 쓸 수 없는 자리(모듈 레벨 포맷 함수·유틸)용.
 * useUiSettings가 마운트된 화면에서 최신값으로 갱신되며, 그 전엔 기본값(현행 표기와 동일)이라 무해.
 */
let snapshot: UiSettings = UI_DEFAULTS;
export function getUiSnapshot(): UiSettings { return snapshot; }

export function useUiSettings(): UiSettings {
  const { data } = useQuery({
    queryKey: ['ui-settings'],
    queryFn: () => apiClient.get<{ data: ConfigRow[] }>('/api/v1/config?category=ui').catch(() => ({ data: [] as ConfigRow[] })),
    staleTime: 5 * 60_000, // 설정 변경은 드묾 — 5분 캐시
    gcTime: 30 * 60_000,
  });
  const rows = Array.isArray(data?.data) ? data.data : ((data?.data as unknown as { data?: ConfigRow[] })?.data ?? []);
  const s = parseUiSettings(rows);
  snapshot = s;
  return s;
}

/** 스냅샷 기반 편의 포맷터 — 모듈 레벨 헬퍼 대체용(예: billing formatCurrency 위임) */
export function money(v: unknown, fallback = '-'): string { return formatMoney(v, snapshot, fallback); }
/**
 * 🔴 (2026-09-12) 로케일 태그를 **UI 언어 스토어에서 읽는다** — 종전엔 'ko-KR' 고정이라 `<KDate>`(JSX)는 UI 언어를
 *    따르고 문자열 경로만 안 따랐다(`durationText` 와 같은 구조 결함). 운영 정책(`ui.dateStyle=dash`·`ui.time24h=true`)
 *    에서는 출력이 로케일 중립(`2026-09-12 09:05`)이라 화면 변화는 없고, 관리자가 ko 표기·12시간제로 바꿨을 때만 갈린다.
 *    렌더 중 호출이면 언어 전환에 즉시 따라가는 `useKdate()` 를 쓴다(이 함수는 스냅샷 — 다음 렌더에 반영).
 *    🔴 환자 포털은 **다른 언어 축**(`portal-i18n`)이라 이 함수를 쓰지 않는다.
 */
export function kdate(v: unknown, mode: KDateMode = 'date', fallback = '-'): string {
  return formatKDate(v, snapshot, mode, fallback, localeTagOf(useUiLocaleStore.getState().locale));
}
/** 렌더 바운드 날짜 포맷터 — 설정·UI 언어가 바뀌면 리렌더된다. 문자열이 필요한 자리(title·템플릿)용 */
export function useKdate(): (v: unknown, mode?: KDateMode, fallback?: string) => string {
  const s = useUiSettings();
  const tag = localeTagOf(useUiLocaleStore((st) => st.locale));
  return useCallback((v: unknown, mode: KDateMode = 'date', fallback = '-') => formatKDate(v, s, mode, fallback, tag), [s, tag]);
}

/**
 * 폴링 주기(스냅샷) — refetchInterval 숫자 리터럴의 일괄 대체용. 훅 규칙 제약 없음(어디서나 호출 가능).
 * usePollInterval과 달리 설정 변경 시 즉시 리렌더는 안 되지만, 화면 재진입/쿼리 재생성 시 반영(폴링 주기 특성상 충분).
 */
export function pollMs(speed: 'fast' | 'normal' | 'slow' = 'normal'): number {
  return speed === 'fast' ? snapshot.pollFastMs : speed === 'slow' ? snapshot.pollSlowMs : snapshot.pollNormalMs;
}

/** 폴링 주기 훅 — refetchInterval 값 14종 난립(8000~60000)을 3단 표준으로. 관리 화면에서 병원 정책으로 일괄 조정 */
export function usePollInterval(speed: 'fast' | 'normal' | 'slow' = 'normal'): number {
  const s = useUiSettings();
  return speed === 'fast' ? s.pollFastMs : speed === 'slow' ? s.pollSlowMs : s.pollNormalMs;
}

// ── 순수 포맷터(설정 주입형 — 컴포넌트 밖·테이블 셀 문자열 조립 등에서 사용) ──

/**
 * @param localeTag BCP-47 태그(UI 크롬 언어 — shared `UI_LOCALE_TAG` 값). 기본 'ko-KR' 라 기존 호출부 무파괴.
 *                  숫자는 어느 로케일에서도 서구 아라비아 숫자(ar 은 `-u-nu-latn` 태그가 보장 — 임상 수치 오독 방지).
 */
/**
 * 표시 모드 — 🔴 (2026-09-12) 화면들이 정본 밖에서 `toLocale*('ko-KR', { month:'long', weekday:'short' … })` 로 직접 그리던
 * 다섯 모양을 모드로 흡수했다(37곳/33파일). 그 자리는 어떤 UI 언어에서도 `9월 12일 (금)`·`오전 09:05` 를 그렸고,
 * 관리자 표기 정책(`ui.dateStyle`·`ui.time24h`)도 우회했다.
 *  - `monthDay`         월·일만(입원일·진료일 열) — dash `09-12` · ko식 `9월 12일` · 비-ko 는 로케일 월 이름(`Sep 12`)
 *  - `monthDayWeekday`  월·일·요일(오늘 표시·회진·치료 일정) — 요일 이름은 **로케일이 정한다**(ko `(금)` · en `Fri`)
 *  - `dateWeekday`      연·월·일·요일(대시보드 머리) — 위와 같되 연도 포함
 *  - `datetimeShort`    월·일 시:분(이력·인계·동기화 시각 열) — 연도 생략, 시각은 `time` 규칙(24h 설정) 그대로
 *  - `timeSec`          시:분:초(승인 이력 등 초 단위가 뜻을 갖는 자리)
 *  - `datetimeSec`      연·월·일 시:분:초 — 🔴 (2026-09-13) 서명·수납·동의 철회·오더 단계 시각처럼 **초가 사실의 일부인 자리**.
 *                       옵션 없는 `toLocaleString('ko')` 가 초까지 찍던 곳을 `datetime`(분)으로 옮기면 정보가 준다 — 그래서 모드를 따로 둔다.
 *  - `dateShortYear`    두 자리 연도 날짜(`26-09-12`) — 폭이 좁은 차트 축·비교 표 전용. 연도 두 자리는 **dash·ko 모두** 같은 모양(ko식 `26. 9. 12.`)
 * 🔴 ko 밖에서는 dash 계열이 ISO 조각(`09-12`)으로 떨어진다 — `date` 와 같은 이유(일-월 순서 오독 방지).
 */
export type KDateMode = 'date' | 'datetime' | 'time' | 'monthDay' | 'monthDayWeekday' | 'dateWeekday' | 'datetimeShort' | 'timeSec' | 'datetimeSec' | 'dateShortYear';

export function formatKDate(v: unknown, s: UiSettings, mode: KDateMode = 'date', fallback = '-', localeTag: string = 'ko-KR'): string {
  if (v == null || v === '') return fallback;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return fallback;
  const pad = (n: number) => String(n).padStart(2, '0');
  const koStyle = s.dateStyle === 'ko' && localeTag.startsWith('ko');
  const isKo = localeTag.startsWith('ko');
  // 요일 이름은 어휘라 로케일에 맡긴다 — 한국어 `(금)` 을 다른 언어에 그대로 내보내지 않는다
  const weekday = (len: 'short' | 'long') => d.toLocaleDateString(localeTag, { weekday: len });
  if (mode === 'monthDay' || mode === 'monthDayWeekday') {
    const md = koStyle ? `${d.getMonth() + 1}월 ${d.getDate()}일`
      : isKo ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' });
    return mode === 'monthDay' ? md : (isKo ? `${md} (${weekday('short')})` : `${md} ${weekday('short')}`);
  }
  const timeSec = () => (s.time24h
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : formatDateTimeLocale(d, localeTag, { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
  if (mode === 'timeSec') return timeSec();
  if (mode === 'dateShortYear') {
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    return koStyle ? `${yy}. ${d.getMonth() + 1}. ${d.getDate()}.` : `${yy}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // dateStyle 'ko'(한국식 `2026. 9. 7.` 년월일 표기)는 ko 로케일에서만 의미가 있다 —
  // 타 로케일에서 그 표기를 흉내내거나 로케일별 자국식 표기로 바꾸면(en `9/7/2026` 등)
  // 화면마다 일-월 순서가 갈려 오독 위험이 생기므로, ko 밖에서는 ISO dash 형식으로 폴백한다.
  const date = s.dateStyle === 'ko' && localeTag.startsWith('ko')
    ? d.toLocaleDateString('ko-KR')
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = s.time24h
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : formatDateTimeLocale(d, localeTag, { hour: 'numeric', minute: '2-digit' });
  if (mode === 'dateWeekday') return isKo ? `${date} (${weekday('long')})` : `${date} ${weekday('long')}`;
  if (mode === 'datetimeShort') {
    const md = koStyle ? `${d.getMonth() + 1}월 ${d.getDate()}일`
      : isKo ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' });
    return `${md} ${time}`;
  }
  if (mode === 'datetimeSec') return `${date} ${timeSec()}`;
  return mode === 'date' ? date : mode === 'time' ? time : `${date} ${time}`;
}

/**
 * @param localeTag BCP-47 태그 — 천단위 구분 기호에만 쓰인다(기본 'ko-KR' — 기존 호출부 무파괴).
 * 🔴 통화 접미(원/₩)는 로케일과 무관하게 **불변**(건보법 locked — 표기 언어가 통화를 바꾸지 않는다).
 */
export function formatMoney(v: unknown, s: UiSettings, fallback = '-', localeTag: string = 'ko-KR'): string {
  // 🔴 (2026-10-02) `Number(null)`·`Number('')` 은 0 이다 — 산정되지 않은 금액(null)이 "0원"으로 그려졌다(모름 ≠ 0)
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = n.toLocaleString(localeTag);
  return s.currencyStyle === 'symbol' ? `₩${t}` : `${t}원`;
}

/** 환자명 마스킹(PARTIAL) — 가운데 글자 * 처리(2자면 뒷글자). 공용 화면(maskable) 전용 정책 */
export function maskPatientName(name: string): string {
  const t = name.trim();
  if (t.length <= 1) return t;
  if (t.length === 2) return `${t[0]}*`;
  return `${t[0]}${'*'.repeat(t.length - 2)}${t[t.length - 1]}`;
}
