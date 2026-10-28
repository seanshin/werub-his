/**
 * 대시보드 위젯 폭 — 순수 로직.
 *
 * 🔴 종전엔 12칸 격자에 **고정 span**(col-span-4/6/8/12)이라 두 방향 모두 깨졌다:
 *    좁은 화면에서는 4칸 위젯이 화면의 1/3(≈125px)로 눌렸고,
 *    넓은 화면에서는 `max-w-7xl` 상한에 걸려 오른쪽이 통째로 비었다.
 *
 * 그래서 폭을 **크기 토큰**으로 두고 화면 폭에 따라 한 행에 들어가는 위젯 수가 늘어나게 한다
 * (늘어나는 것은 위젯의 폭이 아니라 **개수**여야 한다 — 표·차트가 과도하게 넓어지면 읽기 어렵다).
 */

export type WidgetSize = 'sm' | 'md' | 'lg' | 'full' | 'strip';

/**
 * 크기 → 반응형 col-span (12칸 격자 기준·정적 문자열이라 JIT 가 컴파일한다).
 *
 * 🔴 (2026-10-02 실화면) 종전엔 sm=1/4·md=1/3·lg=1/2 처럼 **폭마다 분모가 달랐다**(2xl 기준 3·4·6칸).
 *    한 줄에 3+4+3 처럼 섞이면 끝에 2칸이 남는데, 2칸짜리 위젯은 없으니 dense 배치로도 못 메운다 —
 *    관리자 대시보드가 줄마다 오른쪽이 비고 카드 폭이 제각각이라 "정리가 안 된" 화면이 됐다.
 *    → **폭 단위를 하나로** 둔다: 소형·표(sm·md)는 1단위, 큰 목록(lg)은 2단위, 전폭은 줄 전체.
 *       어느 폭에서든 모든 크기가 단위의 배수라 줄 끝에 메울 수 없는 빈칸이 생기지 않는다.
 *    넓어질수록 늘어나는 것은 위젯의 폭이 아니라 **한 줄에 놓이는 개수**다(1 → 2 → 3 → 4단위).
 */
const UNIT = 'col-span-12 md:col-span-6 2xl:col-span-4 min-[2200px]:col-span-3';
const GRID_CLASS: Record<WidgetSize, string> = {
  sm: UNIT,
  md: UNIT,
  // 큰 표·작업 목록: 2단위(태블릿 폭에서는 2단위 = 줄 전체)
  lg: 'col-span-12 2xl:col-span-8 min-[2200px]:col-span-6',
  // 전폭: 초광폭에서만 2단위(세로로 긴 패널·차트묶음은 나란히 놓는 편이 낫다)
  full: 'col-span-12 min-[2200px]:col-span-6',
  /**
   * 가로 띠 — **항상 한 줄을 통째로 쓴다**.
   *
   * 🔴 KPI 스트립처럼 높이가 100px 남짓인 것을 초광폭에서 절반(`full`)으로 쪼개면,
   *    옆에 오는 세로로 긴 패널이 행 높이를 결정해 **띠 아래가 통째로 빈다**(2026-08-03 제보).
   *    격자는 행 단위로 배치되므로 짧은 칸의 남는 높이는 다른 위젯이 채우지 못한다.
   *    띠를 한 줄로 두면 다음 행에서 긴 패널과 소형 위젯들이 나란히 채워진다.
   */
  strip: 'col-span-12',
};

/** 폭 구간별 한 단위의 칸 수 — 가드가 "모든 크기가 단위의 배수"인지 잰다 */
export const UNIT_SPAN_BY_BREAKPOINT: Record<'base' | 'md' | '2xl' | 'min-[2200px]', number> = {
  base: 12, md: 6, '2xl': 4, 'min-[2200px]': 3,
};

/** 클래스 문자열 → 폭 구간별 실제 칸 수(접두사 없는 값이 아래 구간으로 이어진다) */
export function spansByBreakpoint(cls: string): Record<keyof typeof UNIT_SPAN_BY_BREAKPOINT, number> {
  const order = ['base', 'md', '2xl', 'min-[2200px]'] as const;
  const found: Partial<Record<(typeof order)[number], number>> = {};
  for (const tok of cls.split(/\s+/)) {
    const m = tok.match(/^(?:(md|2xl|min-\[2200px\]):)?col-span-(\d+)$/);
    if (m) found[(m[1] ?? 'base') as (typeof order)[number]] = Number(m[2]);
  }
  const out = {} as Record<(typeof order)[number], number>;
  let cur = found.base ?? 12;
  for (const bp of order) { cur = found[bp] ?? cur; out[bp] = cur; }
  return out;
}

export function allGridClasses(): Record<WidgetSize, string> {
  return { ...GRID_CLASS };
}

/** 위젯별 크기 — 종전 고정 span 을 그대로 옮긴 정본(12=full·8=lg·6=md·4=sm) */
const WIDGET_SIZE: Record<string, WidgetSize> = {
  // 한 줄짜리 지표 띠 — 절반으로 쪼개면 옆의 긴 패널 때문에 아래가 통째로 빈다(strip 주석 참조)
  'stat-bar': 'strip',
  'census': 'full',
  'charts': 'full',
  'lab-results': 'full',
  'nurse-panel': 'full',
  'admin-panel': 'full',
  // 2026-10-02 — 목록을 대기열 위젯에 맡기고 단계 요약만 남아 2단위(옆에 바로가기)
  'pharma-panel': 'lg',
  'lab-panel': 'lg',
  'icu-dashboard': 'full',
  // 바로가기 4개는 한 단위면 충분하다 — 2/3 폭에 아이콘 4개를 흩어 놓으면 빈 카드처럼 보였다(2026-10-02)
  'quick-actions': 'sm',
  'pharmacy-queue': 'lg',
  // 수납 대기열은 환자·진료과·금액·경과 4열 작업 목록이다(2026-10-02)
  'cashier-queue': 'lg',
  'schedule': 'sm',
  'draft-charts': 'sm',
  'my-queue': 'sm',
  'handoff': 'sm',
  'session-info': 'sm',
  'revenue-today': 'sm',
  'claims': 'sm',
  'daily-settlement': 'sm',
  'finance-benchmark': 'sm',
  'lab-stats': 'sm',
  'low-stock': 'sm',
  'my-today': 'sm',
  'my-pay-snapshot': 'sm',
  'inpatients': 'md',
  'surgery': 'md',
  'appointments': 'md',
  'patient-flow': 'md',
  'notifications': 'md',
  'admission-trend': 'md',
  'satisfaction': 'md',
  'qi-dashboard': 'md',
  'ipsg-summary': 'md',
  'bed-status': 'md',
  'bed-by-ward': 'md',
  'isolation-list': 'md',
  'staff-exposure': 'sm',
  'ews-high-risk': 'md',
  'er-status': 'md',
  'er-queue': 'md',
  'icu-alerts': 'md',
  'infection-dashboard': 'md',
  'safety-incidents': 'md',
  'hospital-pulse': 'md',
  'hospital-status': 'md',
  'safety-alerts': 'md',
  'expiring-drugs': 'md',
  'blood-bank': 'md',
  'adr-stats': 'md',
  'billing-review-queue': 'md',
  'lab-queue': 'md',
  'imaging-queue': 'md',
  'system-health': 'md',
  'chart-hourly': 'md',
  'chart-weekly': 'md',
  'chart-dept': 'md',
  'chart-beds': 'md',
  'chart-top-dx': 'md',
  'chart-infection': 'md',
  // 🔴 종전 폭 표에 없어 기본값(md)으로 떨어지던 위젯 — 테스트가 잡아 명시 등재
  'consult-inbox': 'md',
  'reception-queue': 'md',
  'executive-summary': 'md',
  'executive-claims': 'md',
};

export function widgetSize(id: string): WidgetSize {
  return WIDGET_SIZE[id] ?? 'md';
}

export function widgetGridClass(id: string): string {
  return GRID_CLASS[widgetSize(id)];
}

/** 크기가 등록되지 않은 위젯 — 있으면 md 로 떨어지므로 테스트로 감시 */
export function unsizedWidgets(ids: string[]): string[] {
  return ids.filter((id) => !(id in WIDGET_SIZE));
}
