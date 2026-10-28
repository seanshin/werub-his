/**
 * 카탈로그 등록부 — 영역 파일을 여기서 한 번에 등록한다(shared index 가 side-effect import).
 * 🔴 P1/P2 에서 영역 파일이 늘면 이 파일에 한 줄 추가 — 오케스트레이터(CLI)만 수정한다(병렬 충돌 방지).
 */
import { registerCatalog } from '../t';
import { COMMON_MESSAGES } from './common';
import { NAV_MESSAGES, NAV_VERIFIED } from './nav';
import { STATUS_MESSAGES, STATUS_VERIFIED } from './status';

registerCatalog(NAV_MESSAGES, NAV_VERIFIED);
registerCatalog(STATUS_MESSAGES, STATUS_VERIFIED);
// P2 영역 8종(2026-09-07)
import { OUTPATIENT_MESSAGES, OUTPATIENT_VERIFIED } from './outpatient';
import { CHART_MESSAGES, CHART_VERIFIED } from './chart';
import { NURSING_MESSAGES, NURSING_VERIFIED } from './nursing';
import { PHARMLAB_MESSAGES, PHARMLAB_VERIFIED } from './pharmlab';
import { SURGERYER_MESSAGES, SURGERYER_VERIFIED } from './surgeryer';
import { BILLING_MESSAGES, BILLING_VERIFIED } from './billing';
import { ADMINOPS_MESSAGES, ADMINOPS_VERIFIED } from './adminops';
import { WSPORTAL_MESSAGES, WSPORTAL_VERIFIED } from './wsportal';
registerCatalog(OUTPATIENT_MESSAGES, OUTPATIENT_VERIFIED);
registerCatalog(CHART_MESSAGES, CHART_VERIFIED);
registerCatalog(NURSING_MESSAGES, NURSING_VERIFIED);
registerCatalog(PHARMLAB_MESSAGES, PHARMLAB_VERIFIED);
registerCatalog(SURGERYER_MESSAGES, SURGERYER_VERIFIED);
registerCatalog(BILLING_MESSAGES, BILLING_VERIFIED);
registerCatalog(ADMINOPS_MESSAGES, ADMINOPS_VERIFIED);
registerCatalog(WSPORTAL_MESSAGES, WSPORTAL_VERIFIED);

// P2b 영역 8종(2026-09-07)
import { CHART2_MESSAGES, CHART2_VERIFIED } from './chart2';
import { ADMIN2_MESSAGES, ADMIN2_VERIFIED } from './admin2';
import { ADMIN3_MESSAGES, ADMIN3_VERIFIED } from './admin3';
import { COMPONENTS2_MESSAGES, COMPONENTS2_VERIFIED } from './components2';
import { WS2_MESSAGES, WS2_VERIFIED } from './ws2';
import { CHECKUP_MESSAGES, CHECKUP_VERIFIED } from './checkup';
import { CRM2_MESSAGES, CRM2_VERIFIED } from './crm2';
import { WS3_MESSAGES, WS3_VERIFIED } from './ws3';
import { PATIENTS2_MESSAGES, PATIENTS2_VERIFIED } from './patients2';
import { ADMIN4_MESSAGES, ADMIN4_VERIFIED } from './admin4';
registerCatalog(CHART2_MESSAGES, CHART2_VERIFIED);
registerCatalog(ADMIN2_MESSAGES, ADMIN2_VERIFIED);
registerCatalog(ADMIN3_MESSAGES, ADMIN3_VERIFIED);
registerCatalog(COMPONENTS2_MESSAGES, COMPONENTS2_VERIFIED);
registerCatalog(WS2_MESSAGES, WS2_VERIFIED);
registerCatalog(CHECKUP_MESSAGES, CHECKUP_VERIFIED);
registerCatalog(CRM2_MESSAGES, CRM2_VERIFIED);
registerCatalog(WS3_MESSAGES, WS3_VERIFIED);
registerCatalog(PATIENTS2_MESSAGES, PATIENTS2_VERIFIED);
registerCatalog(ADMIN4_MESSAGES, ADMIN4_VERIFIED);

// P2d(2026-09-09) — 통합 상황판·대시보드(위젯 시스템). P2c 뒤에 등재한다 —
// 앞 카탈로그(common~admin4)와 겹치는 원문 24키는 **등재하지 않았다**(dashboard.ts 머리 주석에 목록).
import { DASHBOARD_MESSAGES, DASHBOARD_VERIFIED } from './dashboard';
registerCatalog(DASHBOARD_MESSAGES, DASHBOARD_VERIFIED);

// P3 영역 3종(2026-09-09) — 미배선 화면 282 중 고빈도 우선. 등록만 오케스트레이터가 하고 표는 담당 갈래가 채운다.
import { CLINICAL3_MESSAGES, CLINICAL3_VERIFIED } from './clinical3';
import { OPSFIN_MESSAGES, OPSFIN_VERIFIED } from './opsfin';
import { QUALITY2_MESSAGES, QUALITY2_VERIFIED } from './quality2';
registerCatalog(CLINICAL3_MESSAGES, CLINICAL3_VERIFIED);
registerCatalog(OPSFIN_MESSAGES, OPSFIN_VERIFIED);
registerCatalog(QUALITY2_MESSAGES, QUALITY2_VERIFIED);

// P3 라운드 2 — 영역 4종(2026-09-09)
import { ADMIN5_MESSAGES, ADMIN5_VERIFIED } from './admin5';
import { ADMIN6_MESSAGES, ADMIN6_VERIFIED } from './admin6';
import { CRMCHECKUP_MESSAGES, CRMCHECKUP_VERIFIED } from './crmcheckup';
import { SETTINGS3_MESSAGES, SETTINGS3_VERIFIED } from './settings3';
registerCatalog(ADMIN5_MESSAGES, ADMIN5_VERIFIED);
registerCatalog(ADMIN6_MESSAGES, ADMIN6_VERIFIED);
registerCatalog(CRMCHECKUP_MESSAGES, CRMCHECKUP_VERIFIED);
registerCatalog(SETTINGS3_MESSAGES, SETTINGS3_VERIFIED);

// P3 라운드 3(2026-09-09) — 화면이 아니라 **틀**(레이아웃 크롬·공용 표시 부품). 화면 본문만 번역되고
// 상단바·사이드바 푸터·단위어가 한국어로 남아 "번역이 안 된 것처럼" 보이던 자리(운영 스크린샷 실측).
import { LAYOUTCHROME_MESSAGES, LAYOUTCHROME_VERIFIED } from './layoutchrome';
import { UIPARTS_MESSAGES, UIPARTS_VERIFIED } from './uiparts';
registerCatalog(LAYOUTCHROME_MESSAGES, LAYOUTCHROME_VERIFIED);
registerCatalog(UIPARTS_MESSAGES, UIPARTS_VERIFIED);

// P3 라운드 4(2026-09-09) — 전수 스캔(954 tsx) 후 배선 0 파일 443개 회수분.
import { ADMIN7_MESSAGES, ADMIN7_VERIFIED } from './admin7';
import { ADMIN8_MESSAGES, ADMIN8_VERIFIED } from './admin8';
import { I18NREVIEW_MESSAGES, I18NREVIEW_VERIFIED } from './i18nreview';
import { CLINICAL4_MESSAGES, CLINICAL4_VERIFIED } from './clinical4';
import { COMP1_MESSAGES, COMP1_VERIFIED } from './comp1';
import { COMP2_MESSAGES, COMP2_VERIFIED } from './comp2';
import { ADMIN9_MESSAGES, ADMIN9_VERIFIED } from './admin9';
import { ADMIN10_MESSAGES, ADMIN10_VERIFIED } from './admin10';
import { COMP3_MESSAGES, COMP3_VERIFIED } from './comp3';
import { ADMIN11_MESSAGES, ADMIN11_VERIFIED } from './admin11';
import { STAFFDASH_MESSAGES, STAFFDASH_VERIFIED } from './staffdash';
import { COMP4_MESSAGES, COMP4_VERIFIED } from './comp4';
import { OPS12_MESSAGES, OPS12_VERIFIED } from './ops12';
import { COLLAB2_MESSAGES, COLLAB2_VERIFIED } from './collab2';
import { CLINICAL5_MESSAGES, CLINICAL5_VERIFIED } from './clinical5';
// §12 잔여(2026-09-12) — 어느 카탈로그도 갖지 않던 23화면(간호 보드·영상·약국·접수·차트 보드·공개 안내·오류)
import { CLINICAL6_MESSAGES, CLINICAL6_VERIFIED } from './clinical6';
// 상용 릴리즈 T10-7(2026-09-13) — 법적 보존명령 관제. 배선은 돼 있었는데 키가 어디에도 없던 28키
import { LEGALHOLD_MESSAGES, LEGALHOLD_VERIFIED } from './legalhold';
// 2026-09-14 — 환자 메시지함(환자↔담당의 메시지 직원 측 수신처가 없었다)
import { PATIENTMESSAGE_MESSAGES, PATIENTMESSAGE_VERIFIED } from './patientmessage';
// 2026-09-15 I1 — 서버가 조립하던 표시 문장을 `{ k, params }` 로(배치 1 go-live) · 설계 server-display-text-i18n.plan.md
import { SERVERMSG_MESSAGES, SERVERMSG_VERIFIED } from './servermsg';
registerCatalog(ADMIN7_MESSAGES, ADMIN7_VERIFIED);
registerCatalog(ADMIN8_MESSAGES, ADMIN8_VERIFIED);
registerCatalog(I18NREVIEW_MESSAGES, I18NREVIEW_VERIFIED);
registerCatalog(CLINICAL4_MESSAGES, CLINICAL4_VERIFIED);
registerCatalog(COMP1_MESSAGES, COMP1_VERIFIED);
registerCatalog(COMP2_MESSAGES, COMP2_VERIFIED);
registerCatalog(ADMIN9_MESSAGES, ADMIN9_VERIFIED);
registerCatalog(ADMIN10_MESSAGES, ADMIN10_VERIFIED);
registerCatalog(COMP3_MESSAGES, COMP3_VERIFIED);
registerCatalog(ADMIN11_MESSAGES, ADMIN11_VERIFIED);
registerCatalog(STAFFDASH_MESSAGES, STAFFDASH_VERIFIED);
registerCatalog(COMP4_MESSAGES, COMP4_VERIFIED);
registerCatalog(OPS12_MESSAGES, OPS12_VERIFIED);
registerCatalog(COLLAB2_MESSAGES, COLLAB2_VERIFIED);
registerCatalog(CLINICAL5_MESSAGES, CLINICAL5_VERIFIED);
registerCatalog(CLINICAL6_MESSAGES, CLINICAL6_VERIFIED);
registerCatalog(LEGALHOLD_MESSAGES, LEGALHOLD_VERIFIED);
registerCatalog(PATIENTMESSAGE_MESSAGES, PATIENTMESSAGE_VERIFIED);
registerCatalog(SERVERMSG_MESSAGES, SERVERMSG_VERIFIED);

/* ── 빌트인 팩 조립 (2026-09-07) ────────────────────────────────────────────
 * 영역 카탈로그(en/ja/ar)를 **언어별 팩으로 합쳐** 등록한다. 기존 데이터·우선순위
 * (먼저 등록된 영역이 이김)는 그대로 유지되고, 소비자는 팩 하나만 보면 된다.
 * 🔴 새 언어는 이 파일을 건드리지 않는다 — `packs/<code>.ts` 를 만들고 `packs/index.ts`
 *    에 한 줄 등재하면 끝이다(언어 추가가 영역 파일 11개를 열지 않게 하는 것이 목적). */
import { registerLocalePack, type LocalePackStatus } from '../pack';
import { CATALOG_LOCALES, CATALOG_LOCALE_LABEL, DEFERRED_LOCALES } from '../locale';

/**
 * 영역 카탈로그 등록 순서 = **우선순위 정본**(먼저 등록된 영역이 이긴다).
 *
 * 🔴 **export 하는 이유**: 이 배열을 가드가 수기로 베껴 적었더니 P2b 에서 추가된 8종
 *    (chart2·admin2·admin3·components2·ws2·portal2·checkup·crm2)이 가드 목록에서 빠져
 *    **교차 충돌 가드가 새 카탈로그를 아예 보지 않았다**(2026-09-07 재주입에서 발각 —
 *    새 충돌을 넣었는데 가드가 통과했다). 수기 목록은 낡는다 — 소비처는 여기서 파생한다.
 */
export const AREA_CATALOGS = [
  // 🔴 common 은 t.ts 가 직접 등록하므로 여기 빠지기 쉽다 — 빠뜨리면 팩만 보는 소비처
  //    (검수 관제·외부 조회)가 공통 어휘 65키를 못 본다(2026-09-07 조립 실측에서 잡음).
  { area: 'common', c: COMMON_MESSAGES, v: new Set<string>() },
  { area: 'nav', c: NAV_MESSAGES, v: NAV_VERIFIED }, { area: 'status', c: STATUS_MESSAGES, v: STATUS_VERIFIED },
  { area: 'outpatient', c: OUTPATIENT_MESSAGES, v: OUTPATIENT_VERIFIED }, { area: 'chart', c: CHART_MESSAGES, v: CHART_VERIFIED },
  { area: 'nursing', c: NURSING_MESSAGES, v: NURSING_VERIFIED }, { area: 'pharmlab', c: PHARMLAB_MESSAGES, v: PHARMLAB_VERIFIED },
  { area: 'surgeryer', c: SURGERYER_MESSAGES, v: SURGERYER_VERIFIED }, { area: 'billing', c: BILLING_MESSAGES, v: BILLING_VERIFIED },
  { area: 'adminops', c: ADMINOPS_MESSAGES, v: ADMINOPS_VERIFIED }, { area: 'wsportal', c: WSPORTAL_MESSAGES, v: WSPORTAL_VERIFIED },
  { area: 'chart2', c: CHART2_MESSAGES, v: CHART2_VERIFIED },
  { area: 'admin2', c: ADMIN2_MESSAGES, v: ADMIN2_VERIFIED },
  { area: 'admin3', c: ADMIN3_MESSAGES, v: ADMIN3_VERIFIED },
  { area: 'components2', c: COMPONENTS2_MESSAGES, v: COMPONENTS2_VERIFIED },
  { area: 'ws2', c: WS2_MESSAGES, v: WS2_VERIFIED },
  // 🔴 portal2 제거(2026-09-07): 포털은 **환자 축**(`apps/web/src/lib/i18n/portal-i18n.ts` 의
  //    `trOf`)을 쓴다 — shared 직원 축(`tOf`)이 아니다. 그래서 P2b·P2c 담당이 모두 이 카탈로그를
  //    쓰지 않았고 **스텁(en 0키)이 등록만 된 채 남아 있었다**(정본 파생 가드로 바꾸자 드러났다).
  //    여기 채우면 포털 화면은 그 값을 영원히 못 보고 죽은 키만 는다. 포털 어휘는 저쪽에 넣는다.
  { area: 'checkup', c: CHECKUP_MESSAGES, v: CHECKUP_VERIFIED },
  { area: 'crm2', c: CRM2_MESSAGES, v: CRM2_VERIFIED },
  // P2c(2026-09-07) — 워크스테이션 잔여 2차. **맨 끝**이라 우선순위가 가장 낮다(중복은 전부 걸러 등재).
  { area: 'ws3', c: WS3_MESSAGES, v: WS3_VERIFIED },
  { area: 'patients2', c: PATIENTS2_MESSAGES, v: PATIENTS2_VERIFIED },
  // P2c-3(2026-09-07) — 관리(admin) 상위 20파일. **맨 끝**이라 우선순위 최하(중복은 전부 걸러 등재)
  { area: 'admin4', c: ADMIN4_MESSAGES, v: ADMIN4_VERIFIED },
  // P2d(2026-09-09) — command-center + dashboard. 앞 카탈로그와 겹치는 24키는 등재하지 않았다(dashboard.ts 머리 주석)
  { area: 'dashboard', c: DASHBOARD_MESSAGES, v: DASHBOARD_VERIFIED },
  // P3(2026-09-09) — 미배선 282화면 회수 라운드. **맨 끝**이라 우선순위 최하(중복은 전부 걸러 등재).
  // 🔴 registerCatalog 만 하고 이 배열에 넣지 않으면 화면(tOf)은 되는데 **언어 팩 조립·검수 관제·
  //    교차 충돌 가드의 시야 밖**이 된다(§9.3 "조립 누락은 조용하다"). 2026-09-09 라운드에서 실제로
  //    7종이 그 상태였고 담당 갈래 둘이 각각 실측해 보고했다 — 등록과 조립은 **함께** 한다.
  { area: 'clinical3', c: CLINICAL3_MESSAGES, v: CLINICAL3_VERIFIED },
  { area: 'opsfin', c: OPSFIN_MESSAGES, v: OPSFIN_VERIFIED },
  { area: 'quality2', c: QUALITY2_MESSAGES, v: QUALITY2_VERIFIED },
  { area: 'admin5', c: ADMIN5_MESSAGES, v: ADMIN5_VERIFIED },
  { area: 'admin6', c: ADMIN6_MESSAGES, v: ADMIN6_VERIFIED },
  { area: 'crmcheckup', c: CRMCHECKUP_MESSAGES, v: CRMCHECKUP_VERIFIED },
  { area: 'settings3', c: SETTINGS3_MESSAGES, v: SETTINGS3_VERIFIED },
  // P3 라운드 3 — 틀(레이아웃·공용 부품). 맨 끝이라 우선순위 최하.
  { area: 'layoutchrome', c: LAYOUTCHROME_MESSAGES, v: LAYOUTCHROME_VERIFIED },
  { area: 'uiparts', c: UIPARTS_MESSAGES, v: UIPARTS_VERIFIED },
  { area: 'admin7', c: ADMIN7_MESSAGES, v: ADMIN7_VERIFIED },
  { area: 'admin8', c: ADMIN8_MESSAGES, v: ADMIN8_VERIFIED },
  { area: 'i18nreview', c: I18NREVIEW_MESSAGES, v: I18NREVIEW_VERIFIED },
  { area: 'clinical4', c: CLINICAL4_MESSAGES, v: CLINICAL4_VERIFIED },
  { area: 'comp1', c: COMP1_MESSAGES, v: COMP1_VERIFIED },
  { area: 'comp2', c: COMP2_MESSAGES, v: COMP2_VERIFIED },
  // §12-B(2026-09-11) — 운영·행정 토스트·조각 회수. 맨 끝이라 우선순위 최하(중복은 걸러 등재).
  { area: 'admin9', c: ADMIN9_MESSAGES, v: ADMIN9_VERIFIED },
  { area: 'admin10', c: ADMIN10_MESSAGES, v: ADMIN10_VERIFIED },
  { area: 'comp3', c: COMP3_MESSAGES, v: COMP3_VERIFIED },
  // §12 잔여(2026-09-11 오후) — 배선 0 화면 회수. 맨 끝이라 우선순위 최하.
  { area: 'admin11', c: ADMIN11_MESSAGES, v: ADMIN11_VERIFIED },
  { area: 'staffdash', c: STAFFDASH_MESSAGES, v: STAFFDASH_VERIFIED },
  { area: 'comp4', c: COMP4_MESSAGES, v: COMP4_VERIFIED },
  // §12 잔여 2차(2026-09-11 저녁) — (main) 배선 0 화면 회수. 맨 끝이라 우선순위 최하.
  { area: 'ops12', c: OPS12_MESSAGES, v: OPS12_VERIFIED },
  { area: 'collab2', c: COLLAB2_MESSAGES, v: COLLAB2_VERIFIED },
  { area: 'clinical5', c: CLINICAL5_MESSAGES, v: CLINICAL5_VERIFIED },
  { area: 'clinical6', c: CLINICAL6_MESSAGES, v: CLINICAL6_VERIFIED },
  { area: 'legalhold', c: LEGALHOLD_MESSAGES, v: LEGALHOLD_VERIFIED },
  { area: 'patientmessage', c: PATIENTMESSAGE_MESSAGES, v: PATIENTMESSAGE_VERIFIED },
  { area: 'servermsg', c: SERVERMSG_MESSAGES, v: SERVERMSG_VERIFIED },
];

const PACK_META: Record<string, { dir: 'ltr' | 'rtl'; tag: string; note?: string }> = {
  en: { dir: 'ltr', tag: 'en-US' },
  ja: { dir: 'ltr', tag: 'ja-JP' },
  // 🔴 아랍어: 자산 보존·선택지 제외(레이아웃 RTL·검수자 미비 — 정본 §8)
  ar: { dir: 'rtl', tag: 'ar-AE-u-nu-latn', note: 'RTL 레이아웃·아랍어 검수 미비로 별도 트랙(§8) — 자산만 보존' },
};

for (const code of CATALOG_LOCALES) {
  const messages: Record<string, string> = {};
  const verified = new Set<string>();
  // 뒤 영역이 앞을 덮지 않게 역순으로 채운다(= 먼저 등록된 영역이 최종 승자)
  for (const { c, v } of [...AREA_CATALOGS].reverse()) {
    for (const [k, val] of Object.entries(c[code] ?? {})) if (val) messages[k] = val;
    for (const k of v) verified.add(k);
  }
  registerLocalePack({
    code,
    label: CATALOG_LOCALE_LABEL[code],
    dir: PACK_META[code].dir,
    tag: PACK_META[code].tag,
    status: ((DEFERRED_LOCALES as readonly string[]).includes(code) ? 'DEFERRED' : 'ACTIVE') as LocalePackStatus,
    messages,
    verified,
    note: PACK_META[code].note ?? '빌트인 팩(영역 카탈로그 조립) — 전량 AI 초안(사람 검수 전)',
  });
}
