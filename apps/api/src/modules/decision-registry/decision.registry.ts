/**
 * 🔴 중요 사람 결정 등록부 — **결정을 화면에서 기록하되, 권한 없는 적용은 하지 않는다.**
 *
 * 사람 지시(2026-08-20): "중요 사람 결정사항은 모두 다이얼로그로 설정하는 기능으로 표현해야 하고,
 * 허가권을 가진 사람이 **법적 검토 후에** 진행되어야 한다."
 *
 * ## 🔴🔴 고정 원칙 — 세 층을 섞지 않는다 (2026-08-20 사람 결정 · 변경 불가)
 *
 * | 층 | 무엇을 정하나 | 주체 |
 * |---|---|---|
 * | `LICENSE_HOLDER` | **병원 설립·법적 운영 요건** — 법령·인허가·위탁계약 | 개설자·원장·CPO·CISO(법적 책임 주체) |
 * | `INTERNAL_COMMITTEE` | **원내 운영 정책** — 법적 요건이 충족된 **범위 안에서** | 원내 위원회 |
 * | `STAFF` | **건별 현장 판단** — 이 환자에게 지금 보낼 것인가 | 담당 직원(업무 화면의 승인 다이얼로그) |
 *
 * 🔴 **하위 층이 상위 층을 대체하지 못한다.**
 *  · 위원회가 아무리 의결해도 **법적 요건이 충족되지 않으면 그 행위는 불가**하다.
 *  · 직원이 아무리 승인해도 **위원회 정책·설정이 꺼져 있으면 나가지 않는다**.
 * 그래서 한 사안에 두 층이 걸리면 **항목을 나누고**, 하위 항목이 `dependsOn` 으로 상위를 가리킨다.
 * 상위가 미결이면 하위는 **기록될 수 있어도 적용되지 않는다**(심의는 하되 앞지르지 못한다).
 *
 * 🔴 이 등록부는 **결정을 대신하지 않는다.** 무엇을 결정해야 하는지, 무엇을 검토해야 하는지,
 * 누가 결정할 수 있는지를 적어 둘 뿐이다.
 */

import type { EnactmentKind } from '../../common/enactment-kinds';
import { DECISION_BATCH_2026_09_A } from './decision.registry.batch-2026-09-a';
import { DECISION_BATCH_2026_09_B } from './decision.registry.batch-2026-09-b';
import { DECISION_BATCH_2026_09_C } from './decision.registry.batch-2026-09-c';
import { DECISION_BATCH_2026_09_D } from './decision.registry.batch-2026-09-d';
import { DECISION_BATCH_2026_09_E } from './decision.registry.batch-2026-09-e';
import { DECISION_BATCH_2026_09_F } from './decision.registry.batch-2026-09-f';
import { DECISION_BATCH_2026_09_G } from './decision.registry.batch-2026-09-g';
import { DECISION_BATCH_2026_09_H } from './decision.registry.batch-2026-09-h';
import { DECISION_BATCH_2026_09_I } from './decision.registry.batch-2026-09-i';
import { DECISION_BATCH_2026_09_J } from './decision.registry.batch-2026-09-j';
import { DECISION_BATCH_2026_09_K } from './decision.registry.batch-2026-09-k';
import { DECISION_BATCH_2026_09_L } from './decision.registry.batch-2026-09-l';
import { DECISION_BATCH_2026_09_M } from './decision.registry.batch-2026-09-m';
import { DECISION_BATCH_2026_09_N } from './decision.registry.batch-2026-09-n';
import { DECISION_BATCH_2026_09_O } from './decision.registry.batch-2026-09-o';
import { DECISION_BATCH_2026_09_P } from './decision.registry.batch-2026-09-p';
import { DECISION_BATCH_2026_09_Q } from './decision.registry.batch-2026-09-q';
import { DECISION_BATCH_2026_09_R } from './decision.registry.batch-2026-09-r';
import { DECISION_BATCH_2026_09_S } from './decision.registry.batch-2026-09-s';
import { DECISION_BATCH_2026_10_A } from './decision.registry.batch-2026-10-a';
import { DECISION_BATCH_2026_10_B } from './decision.registry.batch-2026-10-b';
import { DECISION_BATCH_2026_10_C } from './decision.registry.batch-2026-10-c';
import { DECISION_BATCH_2026_10_D } from './decision.registry.batch-2026-10-d';
import { DECISION_BATCH_2026_10_E } from './decision.registry.batch-2026-10-e';
import { DECISION_BATCH_2026_10_F } from './decision.registry.batch-2026-10-f';
import { DECISION_BATCH_2026_10_G } from './decision.registry.batch-2026-10-g';
import { DECISION_BATCH_2026_10_H } from './decision.registry.batch-2026-10-h';
import { DECISION_BATCH_2026_10_I } from './decision.registry.batch-2026-10-i';
import { DECISION_BATCH_2026_10_J } from './decision.registry.batch-2026-10-j';
import { DECISION_BATCH_2026_10_K } from './decision.registry.batch-2026-10-k';
import { DECISION_BATCH_2026_10_L } from './decision.registry.batch-2026-10-l';

/** 🔴 결정 층 — 고정 축. 섞지 않는다 */
export type DecisionLayer = 'LICENSE_HOLDER' | 'INTERNAL_COMMITTEE' | 'STAFF';

/** 층 서열 — 숫자가 클수록 상위(하위는 상위를 대체할 수 없다) */
export const LAYER_RANK: Record<DecisionLayer, number> = {
  STAFF: 1,
  INTERNAL_COMMITTEE: 2,
  LICENSE_HOLDER: 3,
};

export const LAYER_META: Record<DecisionLayer, { label: string; scope: string; cannot: string }> = {
  LICENSE_HOLDER: {
    label: '허가권자 — 법적 운영 요건',
    scope: '법령·인허가·위탁계약이 정하는 것. 병원 설립과 실제 법적 운영의 조건이다.',
    cannot: '🔴 원내 위원회 의결로 대체할 수 없다. 위원회가 의결해도 법적 요건이 없으면 그 행위는 불가하다.',
  },
  INTERNAL_COMMITTEE: {
    label: '원내 위원회 — 운영 정책',
    scope: '법적 요건이 충족된 범위 안에서 병원이 정하는 운영 정책.',
    cannot: '🔴 법적 요건을 앞지르지 못한다. 선행 법적 항목이 미결이면 의결해도 적용되지 않는다.',
  },
  STAFF: {
    label: '직원 — 건별 현장 판단',
    scope: '이 환자에게 지금 보낼 것인가 같은 개별 건 판단. 업무 화면의 승인 다이얼로그에서 이뤄진다.',
    cannot: '🔴 설정을 바꾸지 못한다. 위원회 정책·설정이 꺼져 있으면 직원이 승인해도 나가지 않는다.',
  },
};

/**
 * 🔴 결정 **축(track)** — 층(누가 정하는가)과 다른 물음이다: **무엇에 관한 결정인가**.
 *
 * 항목이 늘면 층 세 개만으로는 찾을 수 없다(2026-09-08 실측: 38 → 56). 그렇다고 층을 쪼개면
 * 고정 원칙이 흔들리므로, **직교하는 축**을 따로 둔다. 화면은 층으로 나누고 축으로 거른다.
 *
 * 🔴 여기 없는 축을 항목이 지어내지 못한다(타입이 막고 가드가 재확인한다).
 */
export const DECISION_TRACKS = {
  BILLING: '청구·수가',
  CLINICAL: '임상 안전·기록',
  DRAFT: '임상 기록 초안',
  QUALITY: '의료 질·지표',
  MASTER: '코드·마스터',
  AI: 'AI 운영',
  PRIVACY: '개인정보·처리 경계',
  SECURITY: '보안·키',
  NOTIFY: '알림·대외 발신',
  GOVERNANCE: '거버넌스·의결',
  PLATFORM: '플랫폼·운영',
  I18N: '언어·번역',
  COUNTRY: '국가 거버넌스',
  AE: 'AE 에디션',
} as const;

export type DecisionTrack = keyof typeof DECISION_TRACKS;

export type ApprovalPath =
  /** 해당 층의 권한자가 법적 검토 근거와 함께 기록하면 적용된다 */
  | 'AUTHORIZED_ROLE'
  /** 🔴 위원회 의결 사항 — 이 화면은 안건만 만들고 적용하지 않는다 */
  | 'COMMITTEE'
  /** 🔴 코드·스키마 변경이라 화면으로 적용할 수 없다 — 결정만 기록하고 개발이 반영한다 */
  | 'CODE_CHANGE'
  /** 🔴 이 화면에서 결정하지 않는다 — 업무 화면의 승인 다이얼로그에서 건별로 이뤄진다 */
  | 'PER_EVENT_DIALOG';

export interface DecisionOption {
  value: string;
  label: string;
  /** 이 선택이 무엇을 뜻하는가 — 화면이 그대로 보여준다(사람이 고르기 전에 결과를 알아야 한다) */
  effect: string;
  /**
   * 🔴 이 선택이 시스템에서 **무엇을 바꾸는가**(집행 엔진 `DecisionAction.target`).
   *
   *    `enactKind` 가 있으면 **모든 선택지에 이 필드가 있어야 한다** — 가드가 강제한다.
   *    `null` 은 "이 선택은 아무것도 바꾸지 않는다"는 **명시**이며 빠뜨린 것과 다른 사실이다.
   *    실제로 그랬다 — `billing.institutionType` 은 `configKey` 가 있는데 선택지→값 매핑이
   *    `configValueFor()` 에 **손으로 나열**돼 있어 거기 빠진 결정은 기록만 되고 적용되지 않았다.
   */
  enact?: Record<string, unknown> | null;
}

export interface DecisionDef {
  key: string;
  title: string;
  /** 🔴 어느 층의 결정인가 — 섞지 않는다 */
  layer: DecisionLayer;
  /** 무엇에 관한 결정인가(층과 직교) — 화면 필터의 정본 */
  track: DecisionTrack;
  /** 왜 결정이 필요한가 — 실측 근거를 그대로 */
  why: string;
  /** 🔴 결정 전에 반드시 검토해야 하는 법적·규제 항목 */
  legalReview: string[];
  approvalPath: ApprovalPath;
  /** 허가권 — 누가 결정할 수 있는가(사람 이름이 아니라 역할·직책) */
  authority: string;
  options: DecisionOption[];
  /**
   * 🔴 선행 조건. **하위 층을 가리킬 수 없다**(하위가 상위의 조건이 될 수 없으므로).
   * 같은 층 안의 순서 의존은 정당하다(채택 → 승격 절차처럼).
   * 미결이거나 부정 결정이면 기록은 되어도 **적용되지 않는다**.
   */
  dependsOn?: string[];
  /** 적용 대상 config 키(있으면 AUTHORIZED_ROLE 경로에서 기록 후 적용) */
  configKey?: string;
  /**
   * 🔴 집행 바인딩 — 어휘는 `common/enactment-kinds.ts` 정본에서 온다(여기서 지어내지 않는다).
   *    있으면 결정 기록 시 `DecisionAction(registryKey = 이 결정의 key)` 이 생기고 엔진이 반영한다.
   *    없으면 자동 반영 대상이 아니다(기록만 · 이행은 사람).
   */
  enactKind?: EnactmentKind;
  /** 근거를 확인하러 갈 화면 */
  drillDown?: string;
  /** 이 결정이 막고 있는 것 */
  blocks?: string;

  // ── 설명자료(브리핑) 필드 — 2026-08-21 ────────────────────────────────
  // 🔴 이 화면을 읽는 사람은 개발자가 아니다. 허가권자·위원은 "무엇을 결정하는가"만으로는
  //    움직일 수 없다 — **지금 무슨 일이 일어나고 있는지**, **결정하면 무엇이 열리는지**,
  //    **기록 후에도 남는 일이 무엇인지**, **이 주장을 어떻게 직접 확인하는지**가 있어야 한다.

  /** 🔴 지금(미결) 상태에서 **실제로 일어나고 있는 일**. "결정하지 않는 것도 결정이다" */
  statusQuo: string;
  /** 이 결정이 나면 구체적으로 무엇이 가능해지는가 */
  opens?: string[];
  /** 🔴 실측 재현 방법 — 브리핑을 받는 사람이 **직접 확인**할 수 있어야 한다(믿으라고 하지 않는다) */
  verifyHow?: string[];
  /**
   * 🔴 기록 후에도 **남는 일**. 이 화면의 기록은 결정의 증빙이지 실행이 아니다 —
   * 개발·계약·문서화가 남으면 그것을 여기 적는다(기록≠적용).
   */
  afterDecision?: string;
  /** 실서비스 개시와의 관계 — go-live 관제와 같은 축으로 읽히게 한다 */
  goLive: 'REQUIRED_BEFORE' | 'CAN_FOLLOW' | 'NOT_RELATED';

  /**
   * 🔴 누가 들고 있는가 — **사람 이름이 아니라 역할·부서**로 적는다.
   *    이름으로 적으면 그 사람이 바뀌는 순간 담당이 사라지고, 아무도 자기 일이라고 생각하지 않는다.
   *    (`authority` 는 *결정할 수 있는 사람*, `owner` 는 *진행시킬 사람* — 다른 축이다)
   */
  owner: string;
  /**
   * 🔴 언제까지인가 — **절대 날짜가 아니라 개시 기준 상대 표현**.
   *    운영 개시일이 아직 정해지지 않았는데 날짜를 박으면 그 날짜가 곧 거짓이 된다.
   */
  dueBy: 'BEFORE_GO_LIVE' | 'WITHIN_30D' | 'NONE';
}

/**
 * 🔴 목록에 없는 결정을 이 화면에서 하지 않는다. 새 결정이 생기면 **여기 등재부터** 한다
 * (등재하지 않고 config 를 직접 바꾸면 근거가 남지 않는다).
 */
export const DECISION_REGISTRY: DecisionDef[] = [
  // ────────────────────────────────────────────────────────────────────────
  // ① 허가권자 — 법적 운영 요건 (원내 의결로 대체 불가)
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'billing.institutionType',
    title: '우리 기관의 요양기관 종별은 무엇인가 (수가 단가를 정한다)',
    track: 'BILLING',
    layer: 'LICENSE_HOLDER',
    why: '🔴 요양기관 종별은 **개설 허가가 정하는 사실**이지 원내에서 고를 수 있는 것이 아니다. 그런데 시스템에는 종별 설정이 아예 없었고, 운영 수가 단가 166,643건 중 **164,704건(98.8%)이 의원(CLINIC) 단가**와 일치했다 — 병원급 단가와 일치한 것은 2,491건뿐이다. 고시 실측상 의원단가 ≠ 병원급이상단가인 코드가 419,024 중 **408,196건(97.4%)** 이라, 종별을 잘못 고르면 **거의 모든 청구 금액이 한 방향으로 틀린다.**',
    legalReview: [
      '의료법 — 개설 허가상 의료기관 종별(상급종합·종합병원·병원·의원·치과·한방)',
      '국민건강보험 요양급여의 기준에 관한 규칙 — 종별 가산율 및 환산지수 적용 대상',
      '요양기관 현황 신고 내용과 시스템 설정의 일치 여부(신고와 다르면 부당청구가 된다)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 원무(보험)팀장',
    options: [
      { value: 'UNSET', label: '아직 확인하지 않았다', effect: '수가 조회가 금액 대신 `TIER_UNKNOWN`(판정 불가)을 답한다. 🔴 기본 종별을 끼워 넣지 않는다 — 추정이 청구 정책이 되면 안 된다.', enact: null },
      { value: 'CLINIC', label: '의원', effect: '진찰료 AA154·AA254 · 청구 단가 = 고시 의원 단가 · 의료급여 1종 정액 의원 값.', enact: { key: 'billing.institution.grade', newValue: 'CLINIC' } },
      { value: 'HOSPITAL', label: '병원(병원·정신병원·요양병원 등)', effect: '진찰료 AA155·AA255 · 청구 단가 = 고시 병원급이상 단가(그 종별 미산정 코드는 단가 없음으로 청구 경고) · 의료급여 정액 병원 값. 🔴 병원급에서만 산정되는 코드 245,961건은 수가 마스터에 없어 처방할 수 없다 — 별도 반영 필요.', enact: { key: 'billing.institution.grade', newValue: 'HOSPITAL' } },
      { value: 'GENERAL', label: '종합병원', effect: '진찰료 AA156·AA256 · 청구 단가 = 고시 병원급이상 단가 · 의료급여 정액 종합병원 값.', enact: { key: 'billing.institution.grade', newValue: 'GENERAL' } },
      { value: 'TERTIARY', label: '상급종합병원', effect: '진찰료 AA157·AA257 · 청구 단가 = 고시 병원급이상 단가 · 의료급여 정액 상급종합 값. 🔴 상급종합 진찰료 전액 본인부담 같은 세부 규칙은 아직 반영되지 않는다.', enact: { key: 'billing.institution.grade', newValue: 'TERTIARY' } },
      { value: 'OTHER', label: '그 밖(치과·한방·보건기관·조산원·요양/정신)', effect: '해당 종별 단가로 판정한다. 어느 것인지 함께 기록해야 한다.', enact: null },
    ],
    configKey: 'billing.institution.grade',
    enactKind: 'CONFIG_CHANGE',
    drillDown: '/admin/billing-calc',
    blocks: '시점·종별 수가 조회 전반(`POST /api/v1/codes/procedure-fees/on`) · 종별에 맞는 수가 마스터 정비',
    statusQuo: '🔴 종별이 **미설정**이라 수가 조회가 금액을 말하지 못한다. 한편 기존 `procedure_codes.unit_price` 는 그대로 쓰이고 있고 **그 값이 어느 종별인지 아무 데도 기록이 없다**(실측상 의원 단가로 보인다). 또한 `unit_price = 0` 인 코드 5,004건 중 **2,898건은 병원급에서 실제 금액이 있는 항목**이라, 지금 0 은 "무료"가 아니라 "그 종별 미산정"이었다.',
    opens: [
      '`procedure-fees/on` 이 그 시점·그 종별의 금액을 답할 수 있게 된다',
      '종별에서만 산정되는 코드(병원급 전용 245,961건)를 마스터에 반영할지 판단할 수 있게 된다',
      '본인부담률 특례(50/80/90) 표시가 고시 근거를 갖게 된다 — 현재 운영은 166,744건 중 55건에만 값이 있다',
    ],
    verifyHow: [
      '`SELECT count(*) FROM system_configs WHERE key = \'billing.institution.grade\'` → 0행이면 미설정이고, 코드가 `?? \'CLINIC\'` 으로 떨어져 **의원으로 청구된다**',
      '`POST /api/v1/codes/procedure-fees/on` 에 아무 코드나 넣으면 `basis: "TIER_UNKNOWN"` 이 온다',
      '개설 허가증·요양기관 현황 신고서의 종별과 대조한다(시스템 값이 근거가 아니다)',
    ],
    afterDecision: '🔴 (2026-10-20) 기록하면 **새로 만드는 청구부터** 진찰료 코드·청구 단가(고시 종별 열)·의료급여 정액·ERP 종별가산이 이 종별을 따른다. 수가 마스터 `procedure_codes.unit_price` 166,744건은 덮어쓰지 않는다(청구 때 고시 단가로 바꿔 끼운다 — 종별을 비우면 종전 마스터 단가로 돌아간다). 이미 만든 청구는 소급하지 않는다. 화면: /admin/billing-calc 「요양기관 종별」.',
    owner: '원무·보험팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'legal.patientPush.consentScope',
    title: '환자 앱 알림 발송의 적법 근거를 확인했는가',
    track: 'NOTIFY',
    layer: 'LICENSE_HOLDER',
    why: '환자 단말로 진료 정보를 발송하는 행위의 적법성은 **법령이 정한다** — 원내 정책으로 만들 수 없다. 현재 발송은 전부 꺼져 있다.',
    legalReview: [
      '개인정보보호법 — 알림 수신에 대한 정보주체 동의 범위(가입 시 동의로 충분한가)',
      '의료법 — 진료 정보(검사 결과·조제 완료)를 앱 알림으로 고지할 수 있는 범위',
      '정보통신망법 — 광고성 정보가 아님(진료 안내 예외) 및 야간 발송 제한 적용 여부',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 개인정보보호책임자(CPO) · 법무',
    options: [
      { value: 'NOT_REVIEWED', label: '아직 확인하지 않았다', effect: '환자 알림을 켤 수 없다. 원내 위원회가 의결해도 적용되지 않는다.' },
      { value: 'CLEARED', label: '적법 근거를 확인했다', effect: '원내 정책(어떤 알림을 켤 것인가)을 정할 수 있게 된다. 🔴 이 확인만으로 발송되지는 않는다.' },
    ],
    blocks: '환자 알림 전반(원내 정책 결정의 선행 조건)',
    statusQuo: '환자 앱 알림은 **전부 꺼져 있고 한 건도 나가지 않는다**. 코드·승인 다이얼로그·설정은 준비돼 있으나 적법 근거가 확인되지 않아 켤 수 없다. 환자는 진료 호출·조제 완료·검사 결과·수납 대기를 앱으로 받지 못한다.',
    opens: ['원내 위원회가 \'어떤 알림을 켤 것인가\'(policy.patientPush.enable)를 의결할 수 있게 된다', '의결 후 마스터 토글 → 타입별 토글 → 직원 건별 승인 순으로 열린다'],
    verifyHow: ['`/admin/outbound-channels`(2413) 에서 환자 푸시 채널 상태가 \'설정 OFF\' 로 표시되는지 확인', '운영 `notification.patientPush.enabled` = 미설정(기본 false)'],
    afterDecision: '이 확인만으로는 발송되지 않는다. 위원회 의결 + 마스터/타입별 설정 + 직원 건별 승인이 모두 있어야 한 건이 나간다.',
    owner: '개인정보보호팀(CPO)',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'legal.sms.entrustment',
    title: 'SMS 개인정보 처리위탁 계약을 체결했는가',
    track: 'NOTIFY',
    layer: 'LICENSE_HOLDER',
    why: '🔴 `CrmChannelService` 에 SMS 제공자가 없어 환자 로그인 OTP 인증번호가 **서버 로그에만** 남는다. 위탁계약은 법령 사항이라 원내 결정으로 대체할 수 없다.',
    legalReview: [
      '개인정보 처리위탁 계약(수탁자·재위탁 금지·국외이전 여부)',
      '전화번호 위탁 범위와 보유기간',
      '문자 발송 실패 시 로그인 대체 수단(개시 후 로그 노출은 불가)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 개인정보보호책임자(CPO) · 법무',
    options: [
      { value: 'NOT_CONTRACTED', label: '미체결(현행)', effect: '실환자 개시 불가 — OTP 가 계속 로그에만 남는다.' },
      { value: 'CONTRACTED', label: '체결 완료', effect: '결정을 기록한다. 🔴 제공자 코드 구현은 개발 작업이며 이 화면이 켜지 못한다.' },
    ],
    drillDown: '/admin/outbound-channels',
    blocks: '환자 앱 로그인(실환자)',
    statusQuo: '🔴 SMS 제공자 코드가 없어 **환자 로그인 OTP 인증번호가 서버 로그에만 남는다**. 실환자를 받으면 인증번호가 문자로 가지 않아 환자가 앱에 로그인할 수 없고, 동시에 인증번호가 로그에 평문으로 쌓인다.',
    opens: ['환자 앱 로그인을 실환자에게 열 수 있다', '예약 알림 등 다른 문자 채널 논의의 전제가 갖춰진다'],
    verifyHow: ['`/admin/outbound-channels`(2413) SMS 채널 = \'미구현\' 표시', '운영 `sms.provider`·`sms.senderNumber` 미설정'],
    afterDecision: '🔴 계약 체결만으로 문자가 나가지 않는다. `CrmChannelService` 에 제공자 어댑터를 구현하는 **개발 작업**이 남는다.',
    owner: '전산·구매팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'legal.ai.deviceClassification',
    title: 'AI 자동실행이 의료기기(SaMD)에 해당하는지 확인했는가',
    track: 'AI',
    layer: 'LICENSE_HOLDER',
    why: 'AI 자동실행 범위는 규제 해당 여부를 바꿀 수 있다. 이는 법령·인허가 사항이라 **원내 위원회가 판단할 수 없다** — 위원회는 그 결과 안에서 운영 정책만 정한다.',
    legalReview: [
      '의료기기법 — 자동 실행 범위가 소프트웨어 의료기기 해당 여부를 바꾸는가',
      'AI기본법 §31 — 고지·표시 의무 범위',
      '의료법 — 최종 판단 책임 주체(의사)와 자동 실행의 경계',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 법무 · 규제 자문',
    options: [
      { value: 'NOT_REVIEWED', label: '아직 확인하지 않았다', effect: '자동실행 범위를 원내에서 정할 수 없다.' },
      { value: 'CLEARED_NON_DEVICE', label: '해당 범위는 의료기기 아님으로 확인', effect: '그 범위 안에서 위원회가 운영 정책을 정할 수 있다.' },
      { value: 'DEVICE_APPLIES', label: '의료기기에 해당한다', effect: '🔴 인허가 절차가 선행되어야 한다 — 원내 의결로 진행할 수 없다.' },
    ],
    drillDown: '/admin/gld',
    blocks: 'AI 자동실행 범위(원내 정책의 선행 조건)',
    statusQuo: 'AI 자동실행은 **기본 금지**다. 모든 AI 산출은 초안이고 사람이 적용한다. 규제 해당 여부가 확인되지 않아 원내에서 자동실행 범위를 논의할 수 없다.',
    opens: ['원내 위원회가 자동실행 범위(policy.ai.autonomyScope)를 정할 수 있게 된다', '경보 자동 강등·진료 보조 자율성 상향 논의가 열린다'],
    verifyHow: ['`/admin/gld`(2406) 거버넌스 대장에서 AI 항목 상태 확인', 'AI 산출은 전부 초안 배너(`DraftBanner`)와 함께 표시되며 적용 시 감사 원장(`AiDraftApply`)에 남는다'],
    afterDecision: '\'의료기기에 해당한다\'로 판단되면 **인허가 절차가 선행**되어야 하며 원내 의결로 진행할 수 없다.',
    owner: '의료정보팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'legal.aiEgress.transferScope',
    title: '임상데이터 전송 목적지·경로를 법적으로 한정했는가',
    track: 'AI',
    layer: 'LICENSE_HOLDER',
    why: '2026-09-09 이전(P0-A)까지 운영 `.env` 에 `AI_EGRESS_ALLOWED_HOSTS` 가 없었고 그때는 호스트 제한이 걸리지 않았다. 이제 코드는 **목록이 비면 공개 호스트 전송을 차단**(fail-closed)하고, 운영에는 `example.org`(AI 서버·같은 기계)이 등재돼 있다. 그러나 어느 목적지가 법적으로 허용되는가는 여전히 사람 결정이다 — 코드는 목록을 강제할 뿐 목록의 정당성을 모른다.',
    legalReview: [
      '개인정보 안전성 확보조치 — 전송 목적지 한정',
      '🔴 현재 `example.org` 은 Cloudflare 를 경유한다 — air-gap 을 요건으로 삼는지 별도 판단',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '정보보호책임자(CISO) · 법무 · 전산',
    options: [
      { value: 'UNSET', label: '법적 한정을 결정하지 않았다(현행 — 기술 목록은 example.org 1건)', effect: '🔴 코드가 목록 밖·목록 부재 전송을 차단하지만, 목록에 있는 목적지가 법적으로 허용된 곳인지는 아무도 확인하지 않은 상태다.' },
      { value: 'SCOPED', label: '허용 목적지를 확정했다', effect: '결정을 기록한다. 값은 배포(환경변수)로만 반영된다 — 이 화면이 바꾸지 않는다.' },
    ],
    statusQuo: '운영 환경변수 `AI_EGRESS_ALLOWED_HOSTS=example.org`(2026-09-09 등재). 코드는 목록이 비면 공개 호스트 전송을 차단하고 부팅 시 1회 ERROR 로 말한다(P0-A). 즉 기술적 한정은 걸렸으나 **법적 한정(이 목적지가 허용된 처리자인가·위탁 계약)은 미결**이며, 전송 로그의 `mode` 는 빌드 상한이라 실효 모드와 다를 수 있다.',
    opens: ['허용 목적지 목록의 법적 정당성이 확인된다(위탁 계약·처리 위치)', '결정된 목적지와 운영 `.env` 목록을 기계 대조할 수 있게 된다'],
    verifyHow: ['HIS 서버 `.env` 의 `AI_EGRESS_ALLOWED_HOSTS` 값(현재 example.org)이 결정된 목적지와 같은지', '부팅 로그에 `[AiEgressPolicy]` ERROR 가 없는지(있으면 목록 부재=전송 차단 중)', '전송 감사 라인 `AI_EGRESS` 의 host 가 목록 안인지'],
    afterDecision: '🔴 값은 **배포(환경변수)로만** 반영된다 — 이 화면이 바꾸지 않는다. 폐쇄망(air-gap)을 요건으로 삼을지는 별도 판단이며, 현재 `example.org` 은 Cloudflare 를 경유한다.',
    owner: '개인정보보호팀(CPO)',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'legal.claimStatusAccuracy',
    title: '청구 상태 표기의 정확성을 법적으로 검토했는가',
    track: 'BILLING',
    layer: 'LICENSE_HOLDER',
    why: '🔴 `ClaimStatus` enum 에 미전송 상태가 없어 **전송하지 않은 청구가 "제출"로 남는다**(화면은 표식으로 보완 중). 청구 기록의 정확성은 법적 사안이다.',
    legalReview: [
      '허위 청구 표기 위험 — 전송하지 않은 건이 "제출"로 기록되는 것의 법적 평가',
      '의무기록 보존·정정 규정 — 기존 행의 상태 재해석 범위',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '개설자·원장 · 법무 · 원무',
    options: [
      { value: 'NOT_REVIEWED', label: '아직 검토하지 않았다', effect: '현행 유지 — 미전송 청구가 "제출"로 읽히는 상태가 계속된다.' },
      { value: 'CLEARED_SCHEMA_CHANGE', label: '스키마 변경으로 정정하기로 했다', effect: '결정을 기록한다. 마이그레이션은 개발이 반영하며 이 화면이 실행하지 않는다.' },
    ],
    drillDown: '/admin/agency-integrations',
    statusQuo: '🔴 `ClaimStatus` 에 \'미전송\' 상태가 없어 **전송하지 않은 청구가 \'제출\'로 남는다**. 화면은 표식으로 보완하고 있으나 원장 자체는 그대로다.',
    opens: ['청구 상태 어휘를 정정하는 스키마 변경에 착수할 수 있다', '청구 화면이 표식 없이도 사실을 말할 수 있게 된다'],
    verifyHow: ['`/admin/agency-integrations`(2414) 에서 심평원 EDI 채널 = 미구현 확인', '청구 목록에서 \'제출\' 상태 건의 실제 전송 기록 유무 대조'],
    afterDecision: '마이그레이션(기존 행의 상태 재해석 포함)은 **개발이 반영**하며 이 화면이 실행하지 않는다.',
    owner: '원무·보험팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },

  // ────────────────────────────────────────────────────────────────────────
  // ② 원내 위원회 — 운영 정책 (법적 요건이 충족된 범위 안에서)
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'policy.copay.rounding',
    title: '본인부담금 10원 미만 절사를 실제 청구에 적용할 것인가',
    track: 'BILLING',
    layer: 'INTERNAL_COMMITTEE',
    why: '🔴 수치 정책 정본(`NUMERIC_POLICIES`)은 `copay` 를 **`mode:\'floor\', step:10, locked:true`**(10원 미만 절사·국민건강보험법 시행령)로 못박고 있는데, **그 정책을 부르는 코드가 한 곳도 없다**(전 저장소 `roundBy(v,\'copay\')` 호출 **0건**). 실청구는 `Math.round` 로만 계산된다(`billing.service.ts` `computePatientCopay` · `telehealth.service.ts` · `billing-advanced.service.ts`). 게다가 **사전 견적(`billing.service.ts:2268`)은 절사하되 별도 설정 `billing.rounding` 을 본다** — 견적과 실청구가 서로 다른 규칙으로 계산된다.',
    legalReview: [
      '국민건강보험법 시행령 — 본인일부부담금 단수 처리(10원 미만 절사) 근거 확인',
      '적용 시점 — 소급 여부(이미 수납된 청구는 일어난 사실이다)',
      '견적과 실청구의 규칙이 달랐던 기간의 정정 필요 여부(원무 판단)',
    ],
    approvalPath: 'COMMITTEE',
    authority: '원무·보험팀 · 의무기록위원회(수치 잠금 도메인 변경)',
    options: [
      { value: 'DEFER', label: '아직 정하지 않았다(현행 유지)', effect: '실청구는 계속 `Math.round`, 견적은 `billing.rounding` 을 본다. **두 규칙이 계속 다르다.**', enact: null },
      { value: 'APPLY_FLOOR10', label: '정본대로 10원 절사를 실청구에 적용', effect: '실청구·견적이 모두 `roundBy(v,\'copay\')` 를 지난다. 🔴 **청구 금액이 건당 최대 9원 낮아진다** — 적용 시점 이후 청구부터. 기존 청구는 소급하지 않는다.', enact: null },
      { value: 'KEEP_ROUND', label: '반올림을 정책으로 확정(정본을 고친다)', effect: '🔴 잠금 도메인 `copay` 의 정책을 바꾸는 것이다 — `NUMERIC_POLICIES` 를 의결로 개정하고 견적도 같은 규칙으로 맞춘다.', enact: null },
    ],
    // 🔴 바인딩(configKey·enactKind)을 붙이지 않는다 — **위원회 경로는 자동 집행 대상이 아니다.**
    //    붙이면 등록부가 의결을 대신하게 된다(가드가 이것을 강제한다). 적용은 코드 변경으로 따라간다.
    drillDown: '/admin/billing-calc',
    blocks: '본인부담 산정 정본화 · 견적↔실청구 일치',
    statusQuo: '🔴 **정책은 있는데 아무도 부르지 않는다.** `NUMERIC_POLICIES.copay` 는 `locked: true` 로 잠겨 있고 설명에 "10원 미만 절사(국민건강보험법 시행령)"라 적혀 있다. 실제 실청구 3경로는 전부 `Math.round`, 사전 견적만 절사하되 다른 설정을 본다. 잠금 6도메인(money·copay·labValue·bsa·stayDays·age) **전부 `roundBy` 호출 0건**이다.',
    opens: [
      '견적과 실청구가 같은 규칙으로 계산된다(지금은 다르다)',
      '잠금 도메인 정본이 "선언만 있는 것"에서 "실제로 부르는 것"으로 바뀐다',
    ],
    verifyHow: [
      "`grep -rn \"roundBy(\" apps/api/src apps/web/src | wc -l` → 15곳뿐이고 그중 copay·money 는 0이다",
      "`billing.service.ts` 의 `computePatientCopay` 를 읽으면 `Math.round` 만 있다",
      '같은 진료로 견적(`/billing/estimate`)과 실청구 금액을 비교하면 1원 단위에서 갈린다',
    ],
    afterDecision: '🔴 **의결해도 기존 청구는 바뀌지 않는다.** 이미 수납된 것은 일어난 사실이고, 정정 여부는 원무 판단이다(v4.10.0 산정특례 과다청구 때와 같은 원칙). 적용은 코드 변경이 따라야 한다 — **의결만으로 금액이 바뀌지 않는다**(그래서 이 결정에는 자동 반영 바인딩을 붙이지 않았다).',
    owner: '원무·보험팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'policy.patientPush.enable',
    title: '환자 앱 알림을 실제로 켤 것인가(마스터)',
    track: 'NOTIFY',
    layer: 'INTERNAL_COMMITTEE',
    why: '코드·승인 다이얼로그·설정이 준비됐고 FCM 자격도 있다. 지금 전부 OFF 라 한 건도 나가지 않는다.',
    legalReview: [],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '진료부장 · 간호부장 · 원무',
    dependsOn: ['legal.patientPush.consentScope'],
    options: [
      { value: 'OFF', label: '켜지 않는다(현행)', effect: '환자에게 아무 알림도 가지 않는다. 직원 화면 업무는 그대로다.', enact: { key: 'notification.patientPush.enabled', newValue: false } },
      { value: 'ON', label: '켠다(마스터)', effect: '마스터가 켜진다. 🔴 타입별 토글과 **직원 승인**이 추가로 필요하다.', enact: { key: 'notification.patientPush.enabled', newValue: true } },
    ],
    configKey: 'notification.patientPush.enabled',
    enactKind: 'CONFIG_CHANGE',
    drillDown: '/admin/outbound-channels',
    blocks: '진료 호출·조제 완료·검사 결과·수납 대기 알림 4종',
    statusQuo: '마스터가 꺼져 있어 **환자에게 아무 알림도 가지 않는다**. 직원 화면 업무는 영향이 없다.',
    opens: ['진료 호출·조제 완료·검사 결과·수납 대기 알림 4종의 타입별 토글이 열린다'],
    verifyHow: ['`/admin/outbound-channels`(2413) 환자 푸시 3조건 체크리스트', '운영 `notification.patientPush.enabled` 값'],
    afterDecision: '🔴 마스터를 켜도 **타입별 토글과 직원 건별 승인**이 추가로 필요하다. 마스터만으로는 나가지 않는다.',
    owner: '의료정보팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.criticalValue.patientNotify',
    title: '위급 검사값을 환자에게도 알릴 것인가',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why: '현재 위급값 포함 결과는 환자 푸시를 **보류**한다. 통보 정본은 IPSG.2 read-back 이고, 환자 알림이 앞지르면 임상 맥락 없이 수치를 먼저 보거나 통보 경로가 뒤집힌다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '환자안전위원회 · 진료부',
    dependsOn: ['legal.patientPush.consentScope'],
    options: [
      { value: 'WITHHOLD', label: '보류 유지(현행)', effect: '환자 알림만 막힌다. 결과 조회는 종전대로 가능하다.' },
      { value: 'NOTIFY_AFTER_READBACK', label: 'read-back 완료 후 알림', effect: '🔴 read-back 완료 시점을 발화 지점으로 배선하는 개발이 필요하다.' },
    ],
    drillDown: '/admin/outbound-channels',
    statusQuo: '위급값이 포함된 결과는 환자 푸시를 **보류**한다. 통보 정본은 IPSG.2 read-back(구두 복창)이며, 환자가 결과를 직접 조회하는 것은 종전대로 가능하다.',
    opens: ['read-back 완료 시점을 발화 지점으로 삼는 환자 통보 경로가 열린다'],
    verifyHow: ['검사 결과 알림 코드에서 `payload.hasCritical` 인 건이 제외되는 것', '위급값 통보 원장(read-back) 기록'],
    afterDecision: '🔴 \'read-back 완료 후 알림\'을 택하면 **그 시점을 발화 지점으로 배선하는 개발**이 필요하다. 의결만으로 동작하지 않는다.',
    owner: '진료부·간호부',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.ai.autonomyScope',
    title: 'AI 자동실행 범위(원내 운영)',
    track: 'AI',
    layer: 'INTERNAL_COMMITTEE',
    why: '경보 자동 강등과 진료 보조 자율성 상향이 이 결정에 종속돼 있다. 현재 자동실행은 기본 금지다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '의료기기·AI 거버넌스 위원회',
    dependsOn: ['legal.ai.deviceClassification'],
    options: [
      { value: 'NONE', label: '자동실행 없음(현행)', effect: '모든 AI 산출은 초안이며 사람이 적용한다.' },
      { value: 'LOW_RISK_ONLY', label: '저위험 항목만 자동', effect: '🔴 무엇이 저위험인지 목록을 의결로 확정해야 한다.' },
    ],
    drillDown: '/admin/gld',
    blocks: 'alert-registry P2 · chart-ai P3',
    statusQuo: '자동실행이 없어 모든 AI 산출은 **초안**이고 사람이 적용한다. 적용 시 프로비넌스가 이전되고 감사 원장에 남는다.',
    opens: ['저위험 항목의 자동 적용', '경보 자동 강등(alert-registry P2)', '진료 보조 자율성 상향(chart-ai P3)'],
    verifyHow: ['AI 화면의 초안 배너와 \'적용\' 버튼', '`/api/v1/ai/draft-applied` → AuditLog `AiDraftApply` 기록'],
    afterDecision: '🔴 \'저위험만 자동\'을 택하면 **무엇이 저위험인지 목록을 의결로 확정**해야 한다. 범위 없는 승인은 적용되지 않는다.',
    owner: '의료정보팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.alertRouting',
    title: '경보 라우팅표·tier 를 승인할 것인가',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why: '경보 등록부의 모든 항목이 `approvedBy: UNAPPROVED` 다. 승인 전에는 tier·수신 역할이 초안이다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '환자안전위원회 · 진료부 · 간호부 · 약제부',
    options: [
      { value: 'DRAFT', label: '초안 유지(현행)', effect: '경보는 현행대로 발화하되 등록부 상 미승인으로 표시된다.' },
      { value: 'APPROVED', label: '승인한다', effect: '🔴 라우팅표대로 수신 대상이 바뀐다 — 잘못 승인하면 경보가 엉뚱한 사람에게 간다.' },
    ],
    drillDown: '/admin/safety-gates',
    statusQuo: '경보 등록부 66종이 전부 `UNAPPROVED` 다. 경보는 현행대로 발화하되 tier·수신 역할이 **초안 상태**로 표시된다. 🔴 운영 180일 실측에서 **읽음 0건인 코드가 대다수**였다(CRITICAL_VALUE 4건 발화·읽음 0).',
    opens: ['라우팅표대로 수신 대상이 확정된다', '미승인 표시가 사라지고 tier 기반 억제·승격이 근거를 갖는다'],
    verifyHow: ['`/admin/safety-gates`(2408) 경보 등록부 패널 — 승인 상태와 180일 발화·읽음 실측', '`GET /api/v1/notifications/registry`'],
    afterDecision: '🔴 **잘못 승인하면 경보가 엉뚱한 사람에게 간다.** 승인 전에 수신 역할을 실제 근무 체계와 대조해야 한다.',
    owner: '간호부·진료부',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.labResult.staffNotify',
    title: '직원 검사 결과 알림을 살릴 것인가',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why: '🔴 리스너는 `lab.result_completed`(밑줄)를 구독하는데 실제 발행은 `lab.result.completed`(점)다. **개통 이래 한 번도 발화하지 않았다.** 고치는 것은 글자 하나지만, 그 순간 모든 검사 완료마다 주치의+처방의에게 알림이 나간다.',
    legalReview: [],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '진료부장 · 간호부장',
    options: [
      { value: 'KEEP_OFF', label: '살리지 않는다', effect: '현행 유지 — 직원 검사 알림은 계속 발화하지 않는다.', enact: { key: 'notification.staffLabResult.enabled', newValue: false } },
      { value: 'ENABLE_WITH_GATE', label: '게이트·억제와 함께 살린다', effect: '설정을 켠다. 🔴 위급값 결과는 제외되고(위급 경로가 담당) 같은 오더는 60분 억제된다.', enact: { key: 'notification.staffLabResult.enabled', newValue: true } },
    ],
    configKey: 'notification.staffLabResult.enabled',
    enactKind: 'CONFIG_CHANGE',
    blocks: '검사 결과 직원 알림',
    statusQuo: '🔴 어휘 불일치(`lab.result_completed` vs `lab.result.completed`)로 **개통 이래 한 번도 발화하지 않았다**. 지금 고쳐져 게이트 뒤에 있으나 기본 OFF 다 — 즉 직원은 검사 완료 알림을 받지 못한다.',
    opens: ['검사 완료 시 주치의·처방의에게 알림이 간다(위급값은 제외 — 위급 경로가 담당)'],
    verifyHow: ['운영 `notification.staffLabResult.enabled` 값', '`notifications` 원장에 `LAB_RESULT` 타입 행 유무'],
    afterDecision: '🔴 켜는 순간 **모든 검사 완료마다** 알림이 나간다. 같은 오더는 60분 억제되고 위급값은 제외되지만, 물량을 먼저 가늠해야 한다.',
    owner: '진단검사의학과',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },

  {
    key: 'policy.loopspec.adopt',
    title: 'LoopSpec(루프 선언 플랫폼)을 채택할 것인가 · 어디까지',
    track: 'PLATFORM',
    layer: 'INTERNAL_COMMITTEE',
    why: 'L0·L1 역기술 파일럿 완료. 판정은 **보완 후 채택 가능 · 범위 = AI 루프 한정 · L2~L3, L4 조건부**다. 🔴 L5 런타임과 검증 파이프라인 자동 생성은 **채택 부적합**(생성물이 현행 코드보다 약하다 — 검증 규칙이 이름만 남아 실측 결함 2건이 재현된다).',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '의료기기·AI 거버넌스 위원회 · 전산',
    options: [
      { value: 'NOT_ADOPT', label: '채택하지 않는다', effect: '현행 코드 정본을 유지한다. 🔴 "못 담으면 채택하지 않는 것도 결론"이다.' },
      { value: 'ADOPT_L2_L4', label: 'L2~L4 범위로 채택(런타임 제외)', effect: '카탈로그·린트·문서팩까지 도입한다. 🔴 L5 런타임은 제외 — 도입하면 정본이 둘이 된다.' },
    ],
    drillDown: '/admin/gld',
    blocks: 'LoopSpec L2 착수 전체',
    statusQuo: '현행 코드 정본으로 운영 중이며 LoopSpec 은 도입되지 않았다. L0·L1 역기술 파일럿만 완료됐다.',
    opens: ['L2 카탈로그·L3 린트·L4 문서팩 착수'],
    verifyHow: ['`docs/01-plan/features/loop-platform-adoption.plan.md` §4-L0 파일럿 결과(ajv 재현 run A FAIL 6 / run B PASS)'],
    afterDecision: '🔴 **L5 런타임·검증 파이프라인 자동 생성은 채택 부적합**이다 — 생성물이 현행보다 약해 실측 결함 2건이 재현된다. 도입 범위를 L2~L4 로 명시해야 정본이 둘이 되지 않는다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'policy.loopspec.lifecycleAuthority',
    title: '루프 라이프사이클(shadow→limited→general) 승격 권한과 절차',
    track: 'PLATFORM',
    layer: 'INTERNAL_COMMITTEE',
    why: '🔴 이 개념 자체가 지금 저장소에 **없다**. 누가 어떤 근거로 승격하는지 정하지 않으면, 도입해도 승격이 임의로 이뤄진다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '의료기기·AI 거버넌스 위원회',
    dependsOn: ['policy.loopspec.adopt'],
    options: [
      { value: 'UNDEFINED', label: '아직 정하지 않았다', effect: 'L2 이후로 갈 수 없다 — 승격 절차 없이는 shadow 를 벗어날 근거가 없다.' },
      { value: 'DEFINED', label: '권한·절차를 의결했다', effect: '결정을 기록한다. 🔴 절차 자체는 문서로 남겨야 하며 이 화면이 만들지 않는다.' },
    ],
    drillDown: '/admin/gld',
    statusQuo: '🔴 이 개념 자체가 저장소에 **없다**. 승격 권한·절차가 정의되지 않아 도입해도 shadow 를 벗어날 근거가 없다.',
    opens: ['루프를 shadow → limited → general 로 승격할 수 있게 된다'],
    verifyHow: ['저장소에 라이프사이클 상태를 담는 필드·테이블이 없음'],
    afterDecision: '🔴 절차 자체는 **문서로 남겨야** 하며 이 화면이 만들지 않는다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'policy.catalogOwnership',
    title: '카탈로그 소유·분모 정의를 누가 맡을 것인가',
    track: 'MASTER',
    layer: 'INTERNAL_COMMITTEE',
    why: '🔴 저장소에 CODEOWNERS 가 없고, 약물추천은 오너가 둘로 갈린다. Metric Catalog 는 **분모 정의**가 없으면 그대로 "분모 0이면 완결률 100%" 로 간다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '진료부 · 약제부 · 데이터팀 · 전산',
    dependsOn: ['policy.loopspec.adopt'],
    options: [
      { value: 'UNASSIGNED', label: '미배정(현행)', effect: '카탈로그를 시드해도 관리 주체가 없어 드리프트가 방치된다.' },
      { value: 'ASSIGNED', label: '오너를 배정했다', effect: '결정을 기록한다. Rule·Tool·Metric 별 오너와 분모 정의 책임이 정해진다.' },
    ],
    statusQuo: '🔴 저장소에 CODEOWNERS 가 없고 약물추천은 오너가 둘로 갈린다. 카탈로그를 시드해도 **관리 주체가 없어 드리프트가 방치**된다.',
    opens: ['Rule·Tool·Metric 별 오너와 분모 정의 책임이 정해진다'],
    verifyHow: ['저장소 루트에 CODEOWNERS 파일 부재'],
    afterDecision: '🔴 **분모 정의**가 없으면 \'분모 0이면 완결률 100%\' 가 그대로 재현된다 — 오너 배정과 함께 분모를 문서화해야 한다.',
    owner: '의무기록팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'policy.aiQualityThreshold',
    title: 'AI 스킬 품질 임계값을 확정할 것인가',
    track: 'AI',
    layer: 'INTERNAL_COMMITTEE',
    why: '관리 화면(`/admin` 품질 다이얼로그)은 배선돼 있으나 **값이 정해지지 않았다**. 임계가 없으면 품질 저하를 판정할 기준이 없다. 🔴 임계는 감이 아니라 그 축의 과거 실측(p95)에서 와야 한다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '진료부 · 의료기기·AI 거버넌스 위원회',
    options: [
      { value: 'UNSET', label: '정하지 않았다(현행)', effect: '품질 게이트가 판정하지 않는다 — 저하가 있어도 화면이 말하지 않는다.' },
      { value: 'SET_FROM_BASELINE', label: '과거 실측 기반으로 확정', effect: '🔴 baseline 실측이 선행되어야 한다. 감으로 정하면 거짓 경보가 진짜 경보를 죽인다.' },
    ],
    statusQuo: '임계값이 정해지지 않아 **품질 게이트가 판정하지 않는다**. 저하가 있어도 화면이 말하지 않는다(관리 다이얼로그는 배선돼 있다).',
    opens: ['AI 스킬 품질 저하 판정과 경보가 근거를 갖는다'],
    verifyHow: ['`/admin/ai-settings`(3113) 품질 임계 다이얼로그 — 값 미설정 상태'],
    afterDecision: '🔴 **baseline 실측이 선행**되어야 한다. 임계는 감이 아니라 그 축의 과거 실측(p95)에서 와야 한다 — 감으로 정하면 거짓 경보가 진짜 경보를 죽인다.',
    owner: '의료정보팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'policy.vitalsSourceMeta',
    title: '활력 출처 메타·PACU 통합을 위한 스키마 변경을 승인할 것인가',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why: '① 활력 출처(기기·신뢰도)를 저장할 자리가 없다 ② PACU 활력이 `pacuRecord.vitalSigns` JSON 에 따로 쌓여 **환자 활력 시계열에 나타나지 않는다**.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회 · 간호부 · 전산',
    options: [
      { value: 'PENDING', label: '아직 승인하지 않았다', effect: '현행 유지 — 출처는 런타임 판정으로만 전달되고 PACU 활력은 시계열에서 빠진다.' },
      { value: 'APPROVED', label: '승인한다', effect: '결정을 기록한다. 마이그레이션은 개발이 반영하며 이 화면이 실행하지 않는다.' },
    ],
    drillDown: '/admin/outbound-channels',
    statusQuo: '① 활력 **출처(기기·신뢰도)를 저장할 자리가 없어** 런타임 판정으로만 전달된다 ② PACU 활력이 `pacuRecord.vitalSigns` JSON 에 따로 쌓여 **환자 활력 시계열에 나타나지 않는다**.',
    opens: ['활력 출처가 원장에 남고 기기 연동의 신뢰도 표기가 가능해진다', 'PACU 활력이 환자 시계열에 통합된다'],
    verifyHow: ['환자 활력 시계열에서 PACU 구간이 비어 있는 것', '`vital_signs` 테이블에 출처 컬럼 부재'],
    afterDecision: '마이그레이션은 **개발이 반영**하며 이 화면이 실행하지 않는다.',
    owner: '간호부·전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    // 🔴 2026-08-25 등재 — 기획서에만 있던 사람 결정을 화면으로 올린다.
    //    `tier-split-appliance.plan.md` §7 의 4건은 2026-07-15부터 미결이고, 그중 #2 가
    //    AgentEMR 2단계 전체를 막고 있다(등재하지 않으면 문서 안에서만 늙는다).
    key: 'legal.phiBoundary.gpuTier',
    title: '🔴 임상데이터 처리 경계 — 원내 GPU 도입인가 위탁 유지인가',
    track: 'PRIVACY',
    layer: 'LICENSE_HOLDER',
    why: '🔴 **2026-07-15부터 미결**(40일+). 이 저장소에서 가장 오래 막혀 있는 결정이며, 두 적법성 논리가 **양립하지 않는다**: (A) 폐쇄망 — `ARCHITECTURE-INVARIANTS.md` INV-PHI-03(BLOCKER, "임상 콘텐츠는 경계를 벗어나지 않는다")은 현재 **FAIL** 판정이다. (B) 위탁+비저장 확인 — 이 경우 INV-PHI-03 자체를 **개정**해야 한다. 규범을 위반한 채로 두는 것이 가장 나쁘다.',
    legalReview: [
      '의료법·개인정보보호법 — 임상정보 국외/외부 처리의 위탁 요건(수탁자 관리·감독)',
      '🔴 INV-PHI-03(BLOCKER) 위반 상태를 유지할 것인지, 규범을 개정할 것인지 — 둘 중 하나는 선택해야 한다',
      '수탁 유지 시: 위수탁계약(DPA)·비저장 확인·재식별 위험 평가',
      'CSAP·N2SF 등 규제 축 적용 여부(비교안 참조)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '개설자·원장 · 정보보호책임자(CISO) · 법무 · 전산',
    options: [
      { value: 'UNDECIDED', label: '아직 결정하지 않았다(현행)', effect: '🔴 현행 유지 — INV-PHI-03 이 FAIL 인 채로 남고, AgentEMR 2단계·어플라이언스 구성이 계속 막힌다.' },
      { value: 'ON_PREM_GPU', label: '원내 GPU 도입(폐쇄망 A안)', effect: 'INV-PHI-03 을 충족하는 방향. 결정을 기록한다 — GPU 조달·이관은 별도 사업이며 이 화면이 실행하지 않는다.' },
      { value: 'ENTRUSTED_KEEP', label: '위탁 유지(B안) + INV-PHI-03 개정', effect: '🔴 규범 개정이 **동반 필수**다. 개정 없이 이 값만 기록하면 위반을 승인한 것이 된다.' },
    ],
    drillDown: '/admin/decisions',
    blocks: 'AgentEMR 2단계 전체 · Phase 1 어플라이언스 구성 · LoopSpec L2(S3 종속)',
    statusQuo: '🔴 운영 서버에 **GPU 0장**(`lspci` = QEMU VGA) · `pgvector` 미설치 · 벡터 컬럼 0. 즉 사실상 위탁(B) 상태로 돌고 있는데 **규범(INV-PHI-03)은 폐쇄망(A)을 요구**한다. 결정하지 않는 동안 그 불일치가 유지된다 — **결정하지 않는 것도 결정이다.**',
    opens: ['AgentEMR 2단계(클로즈드루프·추적 레지스트리·경보 예산) 착수', 'Phase 1 어플라이언스 구성 확정', 'LoopSpec L2 카탈로그(S3 선행 조건 해소)'],
    verifyHow: [
      '`docs/05-reference/ARCHITECTURE-INVARIANTS.md` 의 INV-PHI-03 조항',
      '`docs/03-analysis/architecture-invariants-audit-20260715.analysis.md` 의 FAIL 판정(2026-07-15 · 오늘도 유효)',
      '운영 서버에서 `lspci | grep -i vga` — GPU 부재 확인',
    ],
    afterDecision: '🔴 **기록≠실행이다.** ON_PREM_GPU 는 조달·설치·이관 사업이 남고, ENTRUSTED_KEEP 은 **INV-PHI-03 개정 문서 작업**이 반드시 남는다(개정 없이 두면 규범 위반 상태가 승인된 것으로 굳는다).',
    owner: '전산·정보보호팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'legal.erpMrn.pseudonymization',
    title: 'ERP 로 나가는 환자번호(MRN)를 가명화할 것인가',
    track: 'PRIVACY',
    layer: 'LICENSE_HOLDER',
    why: '`tier-split-appliance.plan.md` §7-1(2026-07-15 미결). 가명화 채택 vs 위수탁계약(DPA)으로 원본 유지 — **재식별 위험 적정성은 법무 판단**이며 시스템이 정할 수 없다.',
    legalReview: [
      '개인정보보호법 — 가명정보 처리 요건 및 재식별 금지',
      '위수탁계약(DPA)으로 원본 MRN 을 유지할 경우의 수탁자 관리·감독 의무',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '정보보호책임자(CISO) · 법무 · 원무',
    options: [
      { value: 'UNDECIDED', label: '아직 결정하지 않았다(현행)', effect: '구현은 OFF 로 선행 가능하나 config ON 시점이 계속 막힌다.' },
      { value: 'PSEUDONYMIZE', label: '가명화 채택', effect: '결정을 기록한다. 매핑 테이블·복원 권한 설계가 개발로 남는다.' },
      { value: 'KEEP_WITH_DPA', label: '원본 유지 + 위수탁계약', effect: '결정을 기록한다. 🔴 DPA 체결·수탁자 감독 절차가 남는다(계약이 없으면 이 선택은 성립하지 않는다).' },
    ],
    blocks: 'ERP 연동 P0-1 config ON 시점',
    statusQuo: 'ERP 로 환자 매칭키(MRN)가 나가는 경로가 구현돼 있고 **config 는 꺼져 있다**. 결정 전까지 켤 수 없다 — 켜면 어느 쪽 근거도 없이 원본이 나간다.',
    verifyHow: ['`docs/01-plan/features/tier-split-appliance.plan.md` §7 표', 'ERP outbox 페이로드에 `chartNo`(MRN)가 실리는 코드 경로'],
    afterDecision: '🔴 값은 배포·계약으로 반영된다 — 이 화면은 결정만 기록한다.',
    owner: '전산·개인정보보호팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'legal.regulatoryAxis.review',
    title: '규제 축(의료법 고시·CSAP·N2SF) 적용 범위를 법무가 확인했는가',
    track: 'SECURITY',
    layer: 'LICENSE_HOLDER',
    why: '`tier-split-appliance.plan.md` §7-3(2026-07-15 미결). 어느 규제가 이 시스템에 적용되는지 확정되지 않으면 Phase 2 설계가 근거 없이 진행된다.',
    legalReview: [
      '의료법 관련 고시 — 전자의무기록 시스템 인증·보관 요건',
      'CSAP(클라우드 보안인증) 적용 대상 여부',
      'N2SF(국가 네트워크 보안 프레임워크) 적용 여부',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '법무 · 정보보호책임자(CISO)',
    options: [
      { value: 'NOT_REVIEWED', label: '아직 확인하지 않았다(현행)', effect: 'Phase 2 착수가 막힌 상태가 유지된다.' },
      { value: 'REVIEWED', label: '적용 범위를 확인했다', effect: '결정을 기록한다. 확인 결과 문서를 근거로 첨부해야 한다.' },
    ],
    blocks: 'tier-split Phase 2 착수',
    statusQuo: '적용 규제가 확정되지 않은 채 설계가 멈춰 있다. 🔴 **모르는 상태로 만들면 나중에 전부 다시 만든다.**',
    verifyHow: ['`docs/03-analysis/tier-split-options-comparison.analysis.md` §2 비교표'],
    afterDecision: '확인 결과에 따라 아키텍처 요건이 달라진다 — 개발은 그 뒤에 시작한다.',
    owner: '정보보호팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.metrics.upstreamScope',
    title: '상향 전송을 허용할 비식별 메트릭의 범위',
    track: 'PLATFORM',
    layer: 'INTERNAL_COMMITTEE',
    why: '`tier-split-appliance.plan.md` §7-4(2026-07-15 미결). 비식별이라도 **무엇을 얼마나 올릴지**는 원내 정책이다.',
    legalReview: ['비식별 조치 적정성 — 재식별 가능성 평가', '전송 항목 최소화 원칙'],
    approvalPath: 'COMMITTEE',
    authority: '정보보호위원회 · 의료정보위원회',
    options: [
      { value: 'UNSET', label: '정하지 않았다(현행)', effect: 'Phase 2-2 가 막힌 상태가 유지된다.' },
      { value: 'SCOPED', label: '허용 범위를 의결했다', effect: '🔴 위원회 의결 사항이라 이 화면은 적용하지 않는다 — 안건으로 올려야 한다.' },
    ],
    dependsOn: ['legal.phiBoundary.gpuTier'],
    blocks: 'tier-split Phase 2-2',
    statusQuo: '상향 메트릭 범위가 정해지지 않았다. 처리 경계 결정(위 항목)이 선행이다 — 경계가 정해지지 않으면 무엇이 "상향"인지도 정의되지 않는다.',
    afterDecision: '🔴 위원회 의결이 기록돼도 적용은 별도다(설정·개발).',
    owner: '정보보호팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'legal.appointmentNotify.adapter',
    title: '예약 알림 SMS/카카오 채널을 도입할 것인가',
    track: 'NOTIFY',
    layer: 'LICENSE_HOLDER',
    why: '🔴 `APPOINTMENT_NOTIFY_ADAPTER.implemented === false` 라 **예약 확정·취소·노쇼·대기자 안내가 한 건도 나가지 않는다**(로그만 남는다). 채널 도입은 위탁계약·발송 규제가 걸린 사안이다.',
    legalReview: [
      '개인정보 처리위탁 계약(문자·카카오 채널 수탁자)',
      '정보통신망법 — 진료 안내 문자의 광고성 여부 및 야간 발송 제한',
      '수신 거부 처리 절차',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 개인정보보호책임자(CPO) · 원무',
    options: [
      { value: 'NOT_ADOPTED', label: '도입하지 않는다(현행)', effect: '예약 안내는 유선으로만 이뤄진다. 🔴 화면·로그가 "발송하지 않았다"고 정직하게 말하는 상태가 유지된다.' },
      { value: 'ADOPTED', label: '도입한다', effect: '결정을 기록한다. 🔴 어댑터 구현은 개발 작업이며 이 화면이 켜지 못한다.' },
    ],
    blocks: '예약 확정·취소·노쇼·대기자 안내 전부',
    statusQuo: '🔴 예약 알림 어댑터가 미구현이라 **예약 확정·취소·노쇼·대기자 안내가 한 건도 나가지 않는다**(로그만 남는다). 예약 안내는 현재 유선으로만 이뤄진다.',
    opens: ['예약 4종 안내를 문자·카카오로 보낼 수 있게 된다(구현 후)'],
    verifyHow: ['`/admin/outbound-channels`(2413) 예약 알림 채널 = \'미구현\'', '예약 확정 후 `notifications` 원장에 발송 기록이 없는 것'],
    afterDecision: '🔴 도입을 결정해도 **어댑터 구현은 개발 작업**이며 이 화면이 켜지 못한다. 수신 거부 처리 절차도 함께 갖춰야 한다.',
    owner: '고객지원팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },

  // ────────────────────────────────────────────────────────────────────────
  // ③ 직원 — 건별 현장 판단 (이 화면에서 결정하지 않는다)
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'staff.patientPush.perEvent',
    title: '이 환자에게 지금 알림을 보낼 것인가(건별)',
    track: 'NOTIFY',
    layer: 'STAFF',
    why: '진료 호출·조제 완료·수납 대기는 **직원이 누르는 순간** 발생한다. 그래서 건별 승인은 업무 화면의 다이얼로그에서 이뤄진다 — 관리 화면에서 미리 정할 수 없다.',
    legalReview: [],
    approvalPath: 'PER_EVENT_DIALOG',
    authority: '담당 직원(외래 간호·약사·원무)',
    dependsOn: ['policy.patientPush.enable'],
    options: [
      { value: 'IN_WORKFLOW', label: '업무 화면에서 건별로 판단', effect: '🔴 이 화면은 이 층을 결정하지 않는다. 대기열·약국 화면의 승인 다이얼로그가 그 자리다.' },
    ],
    drillDown: '/clinic-queue',
    blocks: '없음(정책이 켜진 뒤에만 의미가 있다)',
    statusQuo: '상위 정책이 꺼져 있어 **이 판단이 아직 의미를 갖지 못한다**. 정책이 켜지면 대기열·약국·수납 화면의 승인 다이얼로그에서 건별로 이뤄진다.',
    opens: ['직원이 화면에서 건별로 발송 여부를 판단하게 된다(옵트인 방식 — 기본은 보내지 않음)'],
    verifyHow: ['`/clinic-queue`(1002) 호출 버튼의 승인 다이얼로그', '발송 결과가 `{attempted, sent, reason}` 로 정직하게 표시되는 것'],
    afterDecision: '🔴 이 층은 관리 화면에서 미리 정할 수 없다 — 업무 화면의 다이얼로그가 그 자리다.',
    owner: '진료 담당 직원',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },

  // ────────────────────────────────────────────────────────────────────────
  // 임상 기록 초안(임시저장) 축 — 기획서 docs/01-plan/features/clinical-draft-authoring.plan.md
  // 🔴 P0(사라지던 값 봉합)은 결정 없이 완료됐다(2026-08-26). 아래는 P1 이후를 막고 있는 것들이다.
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'draft.cacheTtl',
    title: '작성 중 임시 보관(암호화 캐시)의 보관 시간과 허용 범위',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '의료진이 쓰다 만 임상 기록을 서버에 잠시 보관해 창을 닫아도 날아가지 않게 하려 한다. 보관 대상은 **환자 정보가 들어간 작성 중 문장**이라 보관 시간이 곧 노출 범위다. 현재 기본값은 30분(`terminal.draft.ttlSec`)이며 **아무 화면도 이 기능을 쓰고 있지 않다**.',
    legalReview: [
      '개인정보보호법 — 보관 기간 최소화 원칙에 비추어 몇 분이 타당한가',
      '작성 중 내용도 진료기록의 일부로 볼 것인가(보존 의무가 생기는가)',
      '암호화·소유자 전용 접근으로 충분한가(추가 통제가 필요한가)',
    ],
    approvalPath: 'COMMITTEE',
    authority: '정보보호책임자(CPO)·의무기록위원회',
    options: [
      { value: 'TTL_30M', label: '30분 유지(현행 기본값)', effect: '교대·이석 정도는 방어된다. 점심시간을 넘기면 사라진다.' },
      { value: 'TTL_4H', label: '4시간', effect: '반나절 진료를 덮는다. 그만큼 서버에 남아 있는 시간이 길어진다.' },
      { value: 'TTL_OFF', label: '쓰지 않는다', effect: '지금과 같다 — 창을 닫으면 쓰던 내용이 사라진다.' },
    ],
    // 🔴 `configKey` 를 달지 않는다 — 위원회 결정은 이 화면이 **기록만** 하고 적용하지 않는다.
    //    값의 자리는 아래 drillDown 으로 안내한다(기록≠적용).
    drillDown: '/admin/ai-settings',
    blocks: '초안 유실 방어(L1)를 임상 쓰기 화면에 배선하는 일',
    statusQuo: '🔴 기능은 만들어져 있으나 **부르는 화면이 하나도 없다.** 그래서 지금은 수술기록·간호기록·판독소견을 쓰다 창을 닫으면 **그대로 사라진다**(수술기록은 자유 입력이 12칸이다).',
    opens: ['임상 쓰기 화면에서 작성 중 내용이 잠시 보관되고, 다시 들어오면 "불러오기/버리기"를 묻게 된다'],
    verifyHow: [
      '`/admin/ai-settings` 시스템 설정에서 `terminal.draft.ttlSec` 값 확인(현재 미설정 = 기본 1800초)',
      '수술기록 화면에서 몇 글자 입력 후 창을 닫았다 다시 열어 보기 — 지금은 아무것도 남지 않는다',
    ],
    afterDecision: '🔴 기록만으로는 켜지지 않는다. 캐시 키를 환자·기록 단위로 나누는 작업(별도 결정)과 화면 배선이 남는다.',
    owner: '전산·의무기록팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.cacheKeyScope',
    title: '임시 보관 캐시를 환자·기록 단위로 나눌 것인가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '🔴 현재 구현은 **직원 한 명당 보관함이 하나**다(`draft:{userId}`). 이대로 화면에 붙이면 A환자 기록을 쓰다 B환자로 옮겼을 때 **B의 화면에 A의 문장이 복원될 수 있다.** 실제 사고가 나기 전에 키 구조를 바꿔야 한다.',
    legalReview: [
      '다른 환자의 작성 중 내용이 화면에 뜨는 것이 개인정보 유출에 해당하는가',
      '캐시 키 자체가 로그·모니터링에 남는 점을 고려해 환자 식별자를 키에 넣지 않는 설계가 타당한가',
    ],
    approvalPath: 'COMMITTEE',
    authority: '정보보호책임자(CPO)·전산',
    options: [
      { value: 'SCOPED', label: '기록 단위로 나눈다(권장)', effect: '진료·입원·수술 등 기록별로 보관함이 분리된다. 환자가 섞이지 않는다.' },
      { value: 'KEEP', label: '현행 유지', effect: '🔴 화면에 붙이는 순간 다른 환자 내용이 복원될 수 있다.' },
    ],
    drillDown: '/admin/ai-settings',
    blocks: '초안 유실 방어(L1) 배선 — 이것이 정해지기 전에는 붙이지 않는다',
    statusQuo: '기능이 배선돼 있지 않아 지금 당장 사고가 나지는 않는다. 다만 **배선하는 순간 문제가 된다.**',
    verifyHow: ['`apps/api/src/modules/terminal/terminal-draft.service.ts` 의 저장 키가 `draft:{userId}` 하나인 것'],
    afterDecision: '개발 작업(키 구조 변경 + 구 보관분 폐기)이 남는다. 구 보관분은 살리지 않고 버린다 — 섞인 내용을 복원하는 것이 곧 사고다.',
    owner: '전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.visibility',
    title: '확정 전 초안을 누가 볼 수 있는가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '초안은 아직 서명되지 않은 임상 내용이다. 작성자 본인만 보게 하면 **대진·교대 때 이어받을 수 없고**, 넓히면 미확정 내용이 다른 직원에게 사실처럼 읽힌다.',
    legalReview: [
      '의료법 §21 — 미완성 기록의 열람 범위를 어디까지로 볼 것인가',
      '최소권한 원칙과 진료 연속성 사이의 균형',
    ],
    approvalPath: 'COMMITTEE',
    authority: '진료부·간호부·의무기록위원회',
    options: [
      { value: 'AUTHOR_ONLY', label: '작성자 본인만', effect: '가장 좁다. 대진·교대 시 앞사람이 쓰던 것을 이어받지 못한다.' },
      { value: 'SAME_TEAM', label: '같은 진료과·근무조', effect: '이어받을 수 있다. 미확정 내용이 팀 안에서 보인다(초안 표시는 유지).' },
      { value: 'CARE_TEAM', label: '그 환자의 담당 임상진', effect: '가장 넓다. 환자 단위 연속성은 좋아지나 열람 범위가 커진다.' },
    ],
    blocks: '초안 목록·이어쓰기 화면(L2)의 권한 설계',
    statusQuo: '초안이 도달 가능한 기록이 사실상 진료기록뿐이라 이 질문이 아직 드러나지 않았다. 간호기록은 초안 저장이 **코드에는 있으나 화면이 부르지 않는다**.',
    verifyHow: ['`/dashboard` 미완료 차트 위젯이 지금은 본인 것만 보여주는 것(2026-08-26 봉합)'],
    afterDecision: '권한 규칙을 각 기록의 조회 EP 에 배선하는 작업이 남는다.',
    owner: '진료부·의무기록팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.retention',
    title: '확정되지 않은 초안을 언제까지 두는가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '서명되지 않은 초안이 계속 쌓이면 무엇이 처리해야 할 일인지 알 수 없게 된다. 반대로 **조용히 지우면 임상 기록을 지우는 일**이 될 수 있다.',
    legalReview: [
      '의료법 시행규칙 — 미서명 기록의 보존 의무 여부',
      '자동 삭제가 기록 폐기에 해당하는지(폐기 절차·대장이 필요한가)',
    ],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회',
    options: [
      { value: 'NOTIFY_ONLY', label: '알림만 — 자동 삭제 없음(권장)', effect: '오래된 초안이 작성자 목록에 남는다. 사람이 처리하거나 지운다.' },
      { value: 'AUTO_90D', label: '90일 후 자동 삭제', effect: '목록이 깨끗해진다. 🔴 미완성이어도 임상 내용이 사라진다.' },
      { value: 'KEEP_FOREVER', label: '무기한 보관', effect: '아무것도 사라지지 않는다. 오래된 초안이 계속 쌓인다.' },
    ],
    blocks: '초안 목록 화면의 만료 처리',
    statusQuo: '초안 보존 규칙이 없다. 빈 진료기록 초안은 관리자 실행 정리 기능으로 사후에 지우고 있다.',
    verifyHow: ['`/dashboard` 미완료 차트 위젯에 남아 있는 항목들'],
    afterDecision: '만료 알림·목록 화면 개발이 남는다. 자동 삭제를 고르면 폐기 대장 설계가 함께 필요하다.',
    owner: '의무기록팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.certificatePrewrite',
    title: '증명서를 환자 신청 전에 미리 작성해 둘 수 있게 할 것인가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '지금은 환자가 창구에서 요청한 뒤에야 의사가 진단서를 처음 쓴다. 진료 중에 미리 써 두면 대기가 줄지만, **미리 쓴 내용이 발급 시점의 사실과 다를 수 있다.**',
    legalReview: [
      '의료법 §17 — 진단서는 진료한 의사가 작성한다는 요건이 미리 작성에서도 지켜지는가',
      '작성 시점과 발급 시점이 다른 문서의 유효성',
    ],
    approvalPath: 'COMMITTEE',
    authority: '진료부·의무기록위원회',
    options: [
      { value: 'ALLOW', label: '허용한다', effect: '진료 중 초안을 저장하고 나중에 발급한다. 발급 시 진단이 바뀌었으면 화면이 차이를 보여준다.' },
      { value: 'DENY', label: '허용하지 않는다', effect: '지금과 같다 — 요청이 온 뒤에 작성한다.' },
    ],
    drillDown: '/workstation/certificates',
    blocks: '증명서 미리 작성(L3)',
    statusQuo: '증명서 작성·서명·발급 절차는 이미 있으나 **환자 신청 건에서만** 시작할 수 있다. 진료 중 진단서 화면에서 쓴 내용은 저장되지 않고 창을 닫으면 사라진다.',
    opens: ['진료 중 진단서 초안 저장', '증명서 워크스테이션에서 내 초안 이어쓰기'],
    verifyHow: ['환자 상세 → 진료 이력 → 진단서 화면에서 용도·향후 소견을 입력하고 닫았다 다시 열어 보기'],
    afterDecision: '개발이 남는다(원내 발의 상태 추가 + 발급 시 원천 재대조). 🔴 재대조는 막지 않고 차이만 보여주는 방식이다.',
    owner: '원무팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.staffInitiatedFee',
    title: '원내에서 먼저 만든 증명서 건에 수수료·처리기한을 적용할 것인가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '증명서 절차는 **환자 신청**을 전제로 수수료와 처리기한이 붙어 있다. 의료진이 미리 만든 건에 그대로 적용되면 신청하지도 않은 건에 요금·기한이 생긴다.',
    legalReview: ['의료기관 제증명수수료 고시 — 발급 전 단계에 수수료가 발생하는지'],
    approvalPath: 'COMMITTEE',
    authority: '원무팀·진료부',
    options: [
      { value: 'EXEMPT', label: '적용하지 않는다(권장)', effect: '초안 단계에는 수수료·기한이 없다. 환자가 실제로 신청하면 그때 붙는다.' },
      { value: 'APPLY', label: '동일하게 적용한다', effect: '신청되지 않은 건에도 수수료·처리기한이 계산된다.' },
    ],
    dependsOn: ['draft.certificatePrewrite'],
    blocks: '증명서 미리 작성(L3) 배선',
    statusQuo: '원내 발의 개념 자체가 없어 이 상황이 아직 생기지 않는다.',
    afterDecision: '수수료·기한 계산이 신청 건에만 걸리는지 코드로 확인하는 작업이 남는다.',
    owner: '원무팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.phraseSharing',
    title: '개인 상용구를 진료과 공용으로 올리는 권한을 누가 갖는가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '의료진이 자주 쓰는 문구를 저장해 두는 기능이 **코드에는 있으나 만들 화면이 없다.** 화면을 열면 개인 문구를 과 전체가 쓰도록 올릴 수 있는데, 임상 문장이 검토 없이 퍼지면 잘못된 표현이 그대로 반복된다.',
    legalReview: ['임상 기록에 들어가는 정형 문구의 검토 책임 소재'],
    approvalPath: 'COMMITTEE',
    authority: '진료부·간호부',
    options: [
      { value: 'DEPT_HEAD', label: '과장·수간호사가 승인', effect: '현장에서 빠르게 정리된다. 검토 깊이는 부서마다 다를 수 있다.' },
      { value: 'COMMITTEE', label: '위원회 심의', effect: '검토가 균일해진다. 반영이 느려진다.' },
      { value: 'PERSONAL_ONLY', label: '공용 없이 개인만', effect: '퍼지지 않는다. 같은 문구를 각자 따로 만든다.' },
    ],
    blocks: '작성 지원 편집기(개인 상용구·공용 승격)',
    statusQuo: '🔴 개인 상용구 저장 기능은 서버에 있는데 **화면이 없어 아무도 쓰지 못한다.** 간호는 그 자리를 브라우저 저장으로 메워, 단말을 바꾸면 사라지고 공유되지도 않는다.',
    verifyHow: ['간호 스테이션 화면의 상용구가 다른 컴퓨터에서 보이지 않는 것'],
    afterDecision: '편집기 화면 개발이 남는다. 🔴 상용구에 환자 정보를 넣지 못하게 막는 규칙도 함께 만든다.',
    owner: '진료부',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.personalLayout',
    title: '의료진이 기록 화면 구성을 개인별로 바꿀 수 있는 범위',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '자주 쓰는 항목을 앞으로 당기면 작성이 빨라진다. 그러나 개인이 항목을 숨길 수 있으면 **반드시 써야 하는 항목이 화면에서 사라진다.**',
    legalReview: ['의무기록 필수 기재사항이 화면 구성과 무관하게 강제되는지'],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회',
    options: [
      { value: 'ORDER_ONLY', label: '순서·접힘만 허용(권장)', effect: '필수 항목은 항상 남는다. 개인은 배치만 바꾼다.' },
      { value: 'HIDE_OPTIONAL', label: '선택 항목 숨김까지 허용', effect: '화면이 더 단순해진다. 선택 항목 기재율이 떨어질 수 있다.' },
      { value: 'FIXED', label: '개인 변경 없음', effect: '모두 같은 화면을 본다. 개인화 이득이 없다.' },
    ],
    blocks: '작성 지원 편집기(개인 기본 양식·구성)',
    statusQuo: '개인 화면 설정을 담는 자리는 있으나 **읽는 곳도 쓰는 곳도 없다.** 모두 같은 구성을 쓴다.',
    afterDecision: '편집기 개발과 필수 항목 강제 가드가 남는다.',
    owner: '의료정보팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'draft.sampleApproval',
    title: '초안 견본(파트별 기본 서식)을 누가 원내 표준으로 승인하는가',
    track: 'DRAFT',
    layer: 'INTERNAL_COMMITTEE',
    why: '진료과·수술·간호·판독별로 무엇을 어떤 순서로 쓰는지 견본을 제공하려 한다. 🔴 **처음 넣는 견본이 검토 없이 "원내 표준"으로 읽히면, 개발이 넣은 것이 병원 정책이 되어 버린다.**',
    legalReview: ['기록 서식이 의무기록 필수 기재사항을 충족하는지 검토 주체'],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회·진료부',
    options: [
      { value: 'REVIEW_FIRST', label: '검토 전 표시로 제공하고 승인분만 표준(권장)', effect: '초기 견본은 "검토 전"으로 보인다. 위원회가 승인한 것만 표준이 된다.' },
      { value: 'AS_IS', label: '제공분을 바로 표준으로', effect: '빠르다. 🔴 검토되지 않은 서식이 표준이 된다.' },
      { value: 'NONE', label: '견본을 제공하지 않는다', effect: '빈 화면에서 시작한다. 빠뜨리는 항목이 사람마다 다르다.' },
    ],
    dependsOn: ['draft.personalLayout'],
    blocks: '파트별 초안 견본 세트',
    statusQuo: '견본이 없어 각자 기억으로 쓴다. 원내 표준 차트 서식 편집기는 이미 있다.',
    verifyHow: ['`/admin/chart-editor` 에 등록된 서식 목록'],
    afterDecision: '견본 작성(임상), 검토 전 표시, 승인 절차 배선이 남는다. 🔴 견본에는 임상 값을 넣지 않는다 — 빈칸과 순서만 담는다.',
    owner: '진료부·의무기록팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'codes.newCodeApproval',
    title: '코드 마스터에 코드를 **새로 만드는 것**을 누가 승인하는가',
    track: 'MASTER',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '지금은 관리자가 화면에서 바로 만든다(2026-08-26 실측). 🔴 **진단·수가 코드는 만들면 청구와 통계에 바로 들어간다** — ' +
      '고시에 없는 코드로 청구하면 삭감되고, 임의 진단 코드는 통계·보고를 오염시킨다. ' +
      '🔴 승인자를 정하지 않은 채 승인 화면만 만들면 **화면만 늘고 아무도 누르지 않는다** — 그래서 먼저 묻는다.',
    legalReview: ['원내 코드로 청구할 수 있는 범위(급여·비급여) 확인 주체'],
    approvalPath: 'COMMITTEE',
    authority: '진료부·원무팀(청구)·의무기록위원회',
    options: [
      {
        value: 'TWO_STEP',
        label: '전산이 등록하고 원무·진료부가 승인해야 사용(권장)',
        effect:
          '등록과 사용이 갈린다. 승인 전 코드는 처방·청구에서 고를 수 없다. 🔴 승인이 늦으면 현장이 기다린다.',
      },
      {
        value: 'ADMIN_ONLY',
        label: '지금처럼 관리자가 바로 만든다',
        effect: '빠르다. 🔴 잘못 만든 코드가 그날 바로 청구에 들어간다. 되돌리려면 폐지+후속 지정이 필요하다.',
      },
      {
        value: 'NO_LOCAL',
        label: '원내 코드를 만들지 않는다(고시 코드만)',
        effect:
          '오염이 없다. 🔴 고시에 없는 원내 검사·처치를 기록할 자리가 없어 자유 텍스트로 남는다(집계 불가).',
      },
    ],
    blocks: '코드 신설 승인 워크플로(F7)',
    statusQuo:
      '관리자가 `/admin/codes` 에서 바로 만들고 즉시 사용된다. 만든 코드에는 출처 `LOCAL` 이 찍히고 ' +
      '고시 반영 미리보기가 그것을 폐지 후보에서 갈라 준다(2026-08-26). 승인 단계는 없다.',
    verifyHow: [
      '`/admin/codes` → 출처 필터 [원내 등록] — 지금까지 화면에서 만든 코드 목록',
      '`/admin/codes` → [동의어·약어] 탭의 검토 전/사용 중 — 같은 형태의 승인 흐름이 이미 돌고 있다',
    ],
    afterDecision:
      '승인 상태 컬럼·승인 화면·처방/청구 선택기에서 미승인 코드 제외가 남는다. ' +
      '🔴 기존 원내 코드를 일괄 승인으로 볼지 미승인으로 볼지도 함께 정해야 한다(지금 0건이라 지금이 정할 때다).',
    owner: '원무·보험팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'qi.waitThresholdUnify',
    title: '"너무 오래 기다렸다"의 기준을 **하나로 할 것인가** — 관제 30분 vs 현장 20/60분',
    track: 'QUALITY',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '같은 사실에 기준이 둘이다(2026-08-26 실측). 관제(`/journey-console`)는 `qi.targets.opdWaitMinutes` 로 지연을 판정하는데 ' +
      '🔴 **운영 DB 에 그 키가 없어 코드 기본값 30분**을 쓰고 있고, 원무 화면(`/reception`)은 원내가 실제로 설정한 ' +
      '`clinical.queue.*`(경고 20분·위험 60분)로 색을 칠한다. 🔴 **같은 환자가 화면에 따라 지연이었다 아니었다 한다** — ' +
      '관리자가 "접수 지연 194건"을 보고 원무에 연락하면 원무 화면에는 다른 수가 보인다. ' +
      '🔴 통일은 **언제 현장이 빨개지는가**를 바꾸는 일이라 시스템이 정할 수 없다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '진료부·원무팀·QI위원회',
    options: [
      {
        value: 'ONE_CANON',
        label: '기준을 하나로 통일한다(권장)',
        effect:
          '관제와 현장이 같은 순간에 같은 것을 본다. 🔴 어느 값으로 통일하는지에 따라 현장 화면이 빨개지는 시점이 바뀐다.',
      },
      {
        value: 'SET_QI_ONLY',
        label: '두 축을 유지하되 관제 기준을 원내 값으로 설정한다',
        effect:
          '관제가 코드 기본값을 쓰는 상태만 없앤다. 두 화면은 여전히 다른 기준을 쓰고, 화면이 그 사실을 말한다.',
      },
      {
        value: 'KEEP',
        label: '지금처럼 둔다',
        effect:
          '🔴 관제의 30분이 원내가 정한 값이 아닌 채로 남는다. 화면이 "원내 미설정·기본값"이라 밝히지만, 지연 건수는 그 값으로 세어진다.',
      },
    ],
    blocks: '관제 지연 판정의 근거',
    statusQuo:
      '관제는 코드 기본값 30분으로 판정한다(운영 미설정). 현장은 20/60분. 관제 화면이 두 값을 함께 보여주고 ' +
      '"원내 미설정 · 기본값"이라 표시한다(2026-08-26). 관제는 **관리 화면**이고 조치는 현장 화면에서 한다(사람 결정).',
    verifyHow: [
      '`/journey-console` 상단 임계 표기 — "(원내 미설정 · 기본값)" 이 붙어 있는지',
      '`/admin` 시스템 설정에서 `qi.targets.opdWaitMinutes` 와 `clinical.queue.waitWarningMinutes` 를 나란히 확인',
    ],
    afterDecision:
      '설정값 입력 또는 한쪽 키로 수렴하는 코드 변경이 남는다. 🔴 통일을 고르면 **현장 화면의 색이 바뀌므로** 현장에 먼저 알린다.',
    owner: '질향상팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'pharmacy.splitDispensingSchema',
    title: '분할조제 회차를 **어디에 담을 것인가** — 지금 스키마로는 2회차가 원리적으로 불가능하다',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 `dispensings.order_id` 에 **UNIQUE 제약**(`dispensings_order_id_key`)이 걸려 있는데 ' +
      '`dispenseSplitNext` 는 **같은 orderId 로 새 행**을 만든다 — 2회차는 항상 P2002 다. ' +
      '운영 실측(2026-08-26): `dispensings` 330행 중 `split_seq_no > 1` **0건**, `split_of_id` 는 어디서도 채워지지 않는다. ' +
      '🔴 EP·컬럼·서비스가 다 있는데 **개통 이래 한 번도 성립한 적이 없다.** ' +
      '화면을 붙이면 100% 실패하는 버튼이 생기므로 배선하지 않았다 — **실패하는 버튼은 기능이 아니라 거짓말**이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '약제부·전산',
    options: [
      {
        value: 'SEPARATE_TABLE',
        label: '회차를 별도 테이블로 분리(권장)',
        effect:
          '조제 원장은 오더당 1행을 유지하고 회차는 자식 행으로 쌓는다. 🔴 기존 330행을 건드리지 않는다. 코드 변경 범위가 가장 크다.',
      },
      {
        value: 'DROP_UNIQUE',
        label: '`order_id` UNIQUE 를 풀고 `(order_id, split_seq_no)` 로 바꾼다',
        effect:
          '🔴 **코드 변경이 작지 않다**(2026-08-27 소비처 전수 확인 결과). `Order.dispensing` 이 ' +
          '`Dispensing?`(1:1)이라 UNIQUE 를 풀면 Prisma 가 **배열로 바꾸라고 요구**하고, ' +
          '관계를 타는 자리가 **전부 컴파일 에러**가 된다 — BE 6·FE 15. ' +
          '특히 `dispensing: { is: ... }`·`dispensing: { status: ... }` 같은 **1:1 필터 문법**은 ' +
          '`some:` 으로 바꿔야 하는데, 그때 "어느 회차를 보는가"가 새 질문으로 생긴다 ' +
          '(대기 목록이 1회차 완료를 보고 "조제됨"이라 말할 수 있다).',
      },
      {
        value: 'DROP_FEATURE',
        label: '분할조제를 쓰지 않기로 하고 EP·컬럼을 폐지한다',
        effect: '있는데 안 되는 것을 없앤다. 🔴 장기 처방 분할이 필요해지면 다시 만들어야 한다.',
      },
    ],
    blocks: '분할조제 화면 배선',
    statusQuo:
      'EP 3종(`split-dispensing`·`/next`·`GET /:orderId`)과 컬럼 2개가 있으나 **호출부 0**이고 2회차는 P2002 로 실패한다. ' +
      '화면은 붙이지 않았고, 서비스에 사실을 적고 가드로 못박았다(2026-08-26).',
    verifyHow: [
      "psql: `select indexname from pg_indexes where tablename='dispensings' and indexdef like '%UNIQUE%'` — `dispensings_order_id_key` 존재(2026-08-27 재확인)",
      'psql: `select count(*) total, count(*) filter (where split_seq_no > 1), count(split_of_id) from dispensings` — 330 / 0 / 0',
      "🔴 소비처: `grep -rn \"dispensing: { is:\\|dispensing: { status:\\|o.dispensing\" apps/api/src` — BE 6곳",
      "🔴 FE: `grep -rn \"\\.dispensing\\b\" apps/web/src` — 15곳(약국 화면 10·차트 5). `order.dispensing?.id ?? order.dispensingId` 처럼 **평탄화 필드와 관계를 함께** 읽는 자리가 있어 둘 다 봐야 한다",
      'schema: `Order.dispensing Dispensing?` — 1:1. 배열로 바뀌면 위 21곳이 전부 타입 에러가 된다(조용히 깨지지는 않는다)',
    ],
    afterDecision:
      '스키마 변경 → 소비처 수정(BE 6·FE 15) → 서비스 수정 → 화면 배선 순서다. ' +
      '✅ **소비처 전수 확인은 끝났다**(2026-08-27 · `verifyHow` 에 재현 명령 포함) — 이 결정을 막던 선행 조사는 해소됐다. ' +
      '🔴 다만 조사 결과가 선택지를 바꿨다: `DROP_UNIQUE` 는 "코드 변경이 작다"가 **아니다**. ' +
      '어느 쪽을 고르든 **"대기 목록이 어느 회차를 보는가"** 를 함께 정해야 한다 — ' +
      '지금 목록은 `dispensing.status` 하나를 보므로, 회차가 생기면 1회차 완료를 보고 "조제됨"이라 말할 수 있다.',
    owner: '약제부·전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },

  /**
   * 🔴 2026-08-27 등재 — **화면도 계획서도 아는데 결정 체계만 몰랐던 항목.**
   *
   * 워크스테이션 간호 화면은 이미 정직하게 말하고 있다:
   *   "욕창(Braden) 점수는 이 시스템에 저장할 정본 표가 아직 없습니다 — 계산만 하고 기록되지 않습니다."
   * 그런데 이 등록부에는 없었다(grep 0건). 그래서 **누구도 이 결정이 언제까지 누구 손에 있는지
   * 볼 수 없었다.** 결정 경로 엔진 계획서(§1.4)의 첫 사례로 등재한다.
   */
  /**
   * 🔴 2026-08-28 P1-b 등재 — **한 번도 물어본 적 없는 결정.**
   *
   * 실측: `voiceEmr.ambient.enabled = true` 로 **진료 원음이 수집되고 있다.**
   * 건별 환자 동의(`ConsentType.RECORDING`)는 검증하지만(`ambient.service.ts:63`),
   * **기관 차원의 적법근거는 등록부에 없었다**(음성·녹음으로 grep 0건).
   * `legal.patientPush.consentScope`(환자 알림 적법근거)와 **같은 층의 항목이 빠져 있었다.**
   */
  {
    key: 'legal.voiceRecording.basis',
    title: '진료 음성 녹음·보관의 적법 근거를 확인했는가',
    track: 'PRIVACY',
    layer: 'LICENSE_HOLDER',
    why:
      '앰비언트 스크라이브(`voiceEmr.ambient.enabled`)가 **켜져 있어 진료 원음이 수집된다.** ' +
      '건별 환자 동의는 받고 있으나, **의료인의 음성도 함께 담기고**(동의 주체가 환자만이 아니다) ' +
      '녹음물의 보관 기간·파기·제3자 제공 범위는 기관이 법적으로 정해야 하는 사항이다. ' +
      '🔴 원음은 `assertAiServerUrl` 이 검증하는 목적지로 전송되기도 한다(진료 원음 PCM·성문 표본).',
    legalReview: [
      '개인정보보호법 — 음성정보 수집·이용 동의의 범위와 별도 동의 필요 여부',
      '통신비밀보호법 — 대화 당사자 동의 요건(의료인 음성 포함 여부)',
      '의료법 §21·§22 — 녹음물이 진료기록에 해당하는지, 해당한다면 보존 기간',
      '개인정보보호법 — 보관 기간 경과 시 파기 의무와 그 증빙',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · CPO · 법무',
    options: [
      {
        value: 'NOT_REVIEWED',
        label: '아직 확인하지 않았다(현행)',
        effect: '🔴 확인되지 않은 상태로 원음이 수집되고 있다. 위원회는 이 위에서 운영 정책을 정할 수 없다.',
        enact: null,
      },
      {
        value: 'CLEARED_WITH_CONSENT',
        label: '환자·의료인 동의를 갖춘 범위에서 적법함을 확인',
        effect: '그 범위 안에서 위원회가 보관 기간·전송 범위를 정할 수 있다. 🔴 확인된 범위를 문서로 남긴다.',
        enact: null,
      },
      {
        value: 'SUSPEND_UNTIL_REVIEW',
        label: '검토가 끝날 때까지 원음 수집을 중단한다',
        effect: '🔴 `voiceEmr.ambient.enabled` 를 끈다. 스크라이브 초안 기능이 멈춘다.',
        enact: null,
      },
    ],
    configKey: 'voiceEmr.ambient.enabled',
    drillDown: '/admin/ai-settings',
    blocks: '앰비언트 스크라이브 운영 정책 · 녹음물 보관·파기 규정',
    statusQuo:
      '🔴 **원음이 수집되고 있다**(`voiceEmr.ambient.enabled=true`). 건별 환자 동의는 검증하지만 ' +
      '기관 차원의 적법근거·보관 기간·파기 규정은 정해진 적이 없다.',
    opens: ['녹음물 보관 기간·파기 규정 제정', '원음 전송 목적지 범위 확정(legal.aiEgress.transferScope 와 연결)'],
    verifyHow: [
      "config: `select value from system_configs where key='voiceEmr.ambient.enabled'` — true",
      "코드: `grep -n 'ConsentType.RECORDING' apps/api/src/modules/scribe/ambient.service.ts` — 건별 동의 검증은 있다",
      "등록부: `grep -n '녹음\\|원음' decision.registry.ts` — 이 항목 이전에는 0건이었다",
    ],
    afterDecision:
      '🔴 **기록만으로는 아무 일도 일어나지 않는다.** 보관 기간·파기 규정은 위원회가 별도로 정하고, ' +
      '`SUSPEND_UNTIL_REVIEW` 를 택하면 설정을 끄는 것은 사람이 한다(이 화면은 설정을 바꾸지 않는다).',
    owner: 'CPO·의료정보팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },

  /**
   * 🔴 2026-08-28 P1-b 등재 — 기존 `policy.ai.autonomyScope` 는 **자동실행 범위**이지
   *    "AI 임상 기능을 켤 것인가"가 아니다. 그 질문은 등재된 적이 없는데 **여섯 개가 이미 켜져 있다.**
   */
  {
    key: 'policy.ai.clinicalFeatureScope',
    title: 'AI 임상 기능을 어디까지 켤 것인가 (지금 6개가 켜져 있다)',
    track: 'AI',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '실측(2026-08-28): `ai.server.enabled`·`scribe.enabled`·`voiceEmr.enabled`·' +
      '`voiceEmr.ambient.enabled`·`voiceEmr.ambient.aiDraft.enabled`·`nursing.aiAssist.enabled` 가 ' +
      '**전부 켜진 채 운영되고 있으나 누가 켰는지도, 무슨 근거인지도 없다.** ' +
      '기존 `policy.ai.autonomyScope` 는 자동실행(사람 없이 적용) 범위를 정하는 것이고, ' +
      '**"이 기능을 쓸 것인가"는 다른 질문**이다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '의료기기·AI 거버넌스 위원회',
    dependsOn: ['legal.ai.deviceClassification', 'legal.phiBoundary.gpuTier', 'legal.voiceRecording.basis'],
    options: [
      { value: 'KEEP_ALL', label: '현행 유지(6개 모두)', effect: '지금 상태를 위원회가 **명시적으로 승인**한다. 근거가 기록된다.', enact: null },
      { value: 'DRAFT_ONLY', label: '초안 생성까지만 — 원음 수집은 중단', effect: '🔴 `voiceEmr.ambient.enabled` 를 끈다. 텍스트 기반 보조는 유지된다.', enact: null },
      { value: 'SUSPEND_ALL', label: '선행 결정이 날 때까지 전부 중단', effect: '🔴 AI 임상 보조가 멈춘다. 진료 흐름에 영향이 있으므로 대체 절차를 함께 정해야 한다.', enact: null },
    ],
    drillDown: '/admin/ai-settings',
    blocks: 'AI 임상 기능의 근거 확보',
    statusQuo:
      '🔴 **6개 기능이 켜진 채로 운영 중이고 담당도 근거도 없었다**(2026-08-28 담당만 QPS 로 등재). ' +
      '화면은 이것을 정책인 것처럼 보여준다.',
    opens: ['AI 임상 기능의 운영 근거 확보', 'AI 자동실행 범위(policy.ai.autonomyScope) 논의의 전제 정리'],
    verifyHow: [
      "`/admin/governance/standards` 와 `/admin/safety-gates` — 해당 키의 근거 배지",
      "psql: `select key, value from system_configs where key in ('ai.server.enabled','scribe.enabled','voiceEmr.enabled','voiceEmr.ambient.enabled','voiceEmr.ambient.aiDraft.enabled','nursing.aiAssist.enabled')`",
    ],
    afterDecision: '🔴 선행 3건(의료기기 해당 여부·처리 경계·음성 적법근거)이 미결이면 **의결해도 적용되지 않는다.**',
    owner: '의료정보팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },

  {
    key: 'schema.pressureUlcer.reassessment',
    title: '욕창(Braden) 재평가를 어디에 저장할 것인가',
    track: 'CLINICAL',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '낙상은 `FallRiskAssessment`(환자 스코프·반복 측정 정본 표)가 있는데 **욕창은 ' +
      '`NursingAssessment.bradenScore`(입원 초기평가의 컬럼 하나)뿐**이라 재평가를 담을 곳이 없다. ' +
      '워크스테이션의 Braden 도구는 점수를 계산하고 **저장하지 않는다**(화면이 그 사실을 밝히고 있다). ' +
      '🔴 개통 이래 Morse/Braden 저장이 100% 실패하던 것을 2026-08-25 에 봉합할 때, ' +
      '낙상은 정본 EP 로 배선했지만 욕창은 **저장할 표가 없어 저장하는 척하지 않기로** 남겨 둔 자리다.',
    legalReview: [
      '의료법 §22(진료기록부 등) — 간호기록의 보존 대상 여부',
      '의료기관 인증 Ver.5.0 — 욕창 위험도 평가·재평가 주기 요구사항 확인',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부장 + 질향상·환자안전위원회(QPS)',
    options: [
      {
        value: 'NEW_TABLE',
        label: '낙상과 같은 모양으로 `PressureUlcerAssessment` 표를 신설한다',
        effect:
          '환자 스코프·반복 측정·`assessedAt` 을 갖는 표를 만든다. 낙상(`FallRiskAssessment`)과 ' +
          '**같은 모양**이라 재평가 스케줄러·지표·워크리스트가 한 벌로 붙는다. ' +
          '🔴 스키마 추가이므로 `deploy.sh --schema` 가 필요하다.',
        enact: null, // 🔴 코드·스키마 변경이라 설정으로 반영할 수 있는 것이 없다(명시)
      },
      {
        value: 'REUSE_NURSING_ASSESSMENT',
        label: '`NursingAssessment` 를 다건 허용으로 바꿔 재평가도 그 표에 쌓는다',
        effect:
          '새 표를 만들지 않는다. 🔴 그러나 그 표는 **입원 초기평가**의 의미를 갖고 있고 ' +
          '`admissionId` 스코프다 — 다건이 되면 "초기평가"가 무엇인지 모호해지고, ' +
          '초기평가 미실시 지표(`nursing.initialAssessmentMissing`)의 분모가 흔들린다.',
        enact: null,
      },
      {
        value: 'NOT_STORED',
        label: '저장하지 않기로 확정하고, 화면에서 Braden 도구를 내린다',
        effect:
          '🔴 계산만 하고 버리는 지금 상태를 **의도된 것으로 확정**한다. 그러면 화면에 ' +
          '도구를 남겨 둘 이유가 없다(누르면 사라지는 입력은 사람을 속인다). ' +
          '욕창 위험도 평가를 종이로 한다는 뜻이므로 인증 대응을 따로 세워야 한다.',
        enact: null,
      },
    ],
    blocks: '욕창 재평가 기록·재평가 스케줄·욕창 지표',
    statusQuo:
      '2026-10-10 부터 Braden 재평가는 기존 임상 도구 결과표(`ClinicalChartResult` · chartId BRADEN)에 저장된다 — 아래 선택지 어디에도 딱 맞지 않는 경로다(종전 서술 "계산만·저장 안 함"은 낡았다 · 판정표 `docs/05-reference/decision-dev-apply-baseline.md`). ' +
      '전용 표·재평가 일정과의 연결은 정해지지 않았다.',
    opens: [
      '욕창 재평가 기록과 주기 관리',
      '욕창 관련 질지표(발생률·재평가 이행률)의 분모 확보',
      '간호 워크리스트에 "욕창 재평가 대상" 을 올릴 수 있게 된다',
    ],
    verifyHow: [
      "schema: `grep -n 'bradenScore' apps/api/prisma/schema.prisma` — `NursingAssessment` 한 곳뿐(재평가 표 없음)",
      "schema: `grep -n 'model FallRiskAssessment' -A 15 apps/api/prisma/schema.prisma` — 낙상은 환자 스코프 별도 표",
      "화면: `grep -n '저장할 정본 표' apps/web/src/app/(main)/workstation/nursing/page.tsx` — 화면이 밝히는 문장",
    ],
    afterDecision:
      '🔴 **기록만으로는 아무 일도 일어나지 않는다.** `NEW_TABLE`·`REUSE_NURSING_ASSESSMENT` 는 ' +
      '스키마 변경 → 저장 EP → 화면 배선 → (선택) 재평가 스케줄 순서로 개발이 남는다. ' +
      '`NOT_STORED` 는 화면에서 도구를 내리는 것이 남는다.',
    owner: '간호부·전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  // ────────────────────────────────────────────────────────────────────────
  // ⑤ 언어·번역 축 (v4.16.0 §6 — 문서 안에서만 늙던 것을 화면으로)
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'i18n.reviewOwnership',
    track: 'I18N',
    title: '번역 6,177키의 검수를 누가 하는가 — 의료 용어와 일반 UI 를 가를 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 화면 언어 카탈로그는 코어 6,177키(en·ja 100%)+추가 팩 6종인데 **사람이 검수한 키가 0** 이다. ' +
      '전량 AI 초안이고 화면은 그 사실을 초안 티로 밝힌다. 그러나 티는 "아무도 안 봤다"를 정직하게 ' +
      '표시할 뿐 **아무것도 개선하지 않는다** — 규모가 커질수록 그 상태가 굳는다. ' +
      '실제로 이 라운드에서 뜻이 달라지는 오역 9종과 **언어팩 임상 위해 3건**이 나왔다' +
      '(태국어 처치결정대기가 입원 결정 환자를 퇴원 대기로 읽게 했다).',
    legalReview: [
      '의료기관 인증 — 환자·보호자 대상 표기와 안내문의 정확성 책임 주체',
      '의료법 §22(진료기록부 등) — 기록·법정 서식은 번역 대상이 아님을 확인(현재 print 는 불변)',
      'AI기본법 §31 — AI 가 생성한 문구의 표기 의무 범위(초안 티가 그 요건을 충족하는가)',
    ],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS) · 진료부(임상 용어) · 원무·홍보(일반 UI)',
    options: [
      {
        value: 'SPLIT_CLINICAL_ADMIN',
        label: '의료 용어는 임상이, 일반 UI 는 행정이 검수한다(분리)',
        effect:
          '키를 두 갈래로 분류하고 각각 검수 주체를 둔다. 🔴 분류 자체가 판단이다 — ' +
          '안전 문구를 일반 UI 로 분류하면 임상 검수를 건너뛴다.',
      },
      {
        value: 'SINGLE_OWNER',
        label: '한 주체가 전량을 검수한다',
        effect: '분류 논쟁이 없다. 대신 6,177키 전량이 한 부서의 부하가 된다(속도가 늦으면 초안 상태가 길어진다).',
      },
      {
        value: 'EXTERNAL_VENDOR',
        label: '외부 번역·검수에 위탁한다',
        effect:
          '속도를 산다. 🔴 개인정보가 없는 UI 문구에 한정해야 하고, 임상 안전 문구는 ' +
          '원내 임상 검수를 별도로 거쳐야 한다(위탁 계약 범위를 함께 정한다).',
      },
      {
        value: 'KEEP_DRAFT_ONLY',
        label: '검수하지 않고 초안 표시를 유지한다(현행 확정)',
        effect:
          '🔴 지금 상태를 **의도된 것으로 확정**한다. 그러면 초안 티는 영구 표시가 되고, ' +
          '검수 승격 수단(verified)을 만들 이유가 없어진다. 정직하지만 개선되지 않는다.',
      },
    ],
    drillDown: '/admin/ui-locale',
    blocks: '검수 승격 경로(verified 집합을 올리는 수단) · safetyCritical 키 분류',
    statusQuo:
      '🔴 **전 언어 검수 0**(2026-09-08 재실측). en 6,177/6,177·ja 6,177/6,177 은 번역률이지 검수율이 아니다. ' +
      '추가 팩 6종은 11.8~20.9%. 화면 200여 면이 이 카탈로그를 쓰고 있고, 미등록 키는 한국어 원문+티로 나온다.',
    opens: [
      'verified 승격 수단(누가·무엇을 근거로 올리는가)을 만들 수 있다',
      'safetyCritical 분류를 도입해 안전 문구만 다른 규칙으로 다룰 수 있다',
      '언어팩 ACTIVE 기준(i18n.packActivationCriteria) 판단의 전제가 갖춰진다',
    ],
    verifyHow: [
      '`node scripts/i18n-pack-coverage.mjs` — 검수 열이 전 언어 0 인지 확인',
      '`/admin/ui-locale`(3409) 에서 초안 티와 영역별 커버리지 확인',
      '`node scripts/i18n-dead-definition-scan.mjs` — 등재된 정의가 실제 화면에 도달하는지(A/B/C/D)',
    ],
    afterDecision:
      '🔴 **의결만으로 키가 검수되지 않는다.** verified 집합을 올리는 수단(승격 EP·검수 화면)이 개발로 남고, ' +
      '검수 자체는 사람이 키를 읽는 작업이다. 이 화면의 기록은 "누가 읽을 것인가"까지다.',
    owner: '전산팀 + 질향상팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'i18n.safetyStringTranslation',
    track: 'I18N',
    title: '안전 축 문구(BCMA·고위험·MAR·위급값·부분 실패)를 번역할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '병렬 번역 라운드에서 각 에이전트가 **개별 판단으로** 안전 문구를 미등재로 남겼다. 결과적으로 ' +
      '영어·일본어 화면에서 안전 문구만 한국어로 남는다. 🔴 문제는 화면이 **"일부러 뺀 것"과 ' +
      '"아무도 안 한 것"을 구분해 말하지 못한다**는 점이다 — v4.16.0 에서 무해 키(취소)가 생한글인 것을 ' +
      '반증으로 삼아 그 화면이 의도적 제외가 아니라 미배선임을 갈라냈다. ' +
      '🔴 일률 규칙이 위험하다: 한국어를 못 읽는 사용자에게는 한국어로 남은 안전 문구가 **덜 안전**하고, ' +
      '오역된 안전 문구는 **더 위험**하다(태국어 사례).',
    legalReview: [
      '의료기관 인증 — 투약·수혈 등 고위험 행위의 확인 절차 표기 요건',
      '환자안전법 — 안전 관련 고지의 정확성 책임',
      'AI기본법 §31 — AI 초안 번역을 안전 문구에 쓸 때의 표기 의무',
    ],
    approvalPath: 'COMMITTEE',
    authority: '질향상·환자안전위원회(QPS) · 간호부 · 약제부',
    options: [
      {
        value: 'KEEP_KOREAN',
        label: '안전 문구는 번역하지 않고 한국어 원문을 유지한다',
        effect:
          '오역 위험이 0 이 된다. 🔴 대신 한국어를 못 읽는 사용자에게는 안전 문구가 읽히지 않는다 — ' +
          '이 선택은 "그 화면을 한국어 사용자만 쓴다"는 전제를 함께 확정하는 것이다.',
      },
      {
        value: 'VERIFIED_ONLY',
        label: '임상 검수를 통과한 번역만 노출하고, 미검수는 원문으로 둔다',
        effect:
          '안전 문구에만 verified 게이트를 건다. 🔴 검수 주체(i18n.reviewOwnership)가 정해져야 실행 가능하고, ' +
          '검수 전까지는 KEEP_KOREAN 과 같은 상태다.',
      },
      {
        value: 'TRANSLATE_ALL',
        label: '초안 번역을 포함해 전부 번역한다',
        effect:
          '🔴 이 라운드에서 **임상 위해 3건**이 실제로 나왔다(입원 결정 환자를 퇴원 대기로 읽게 한 오역 등). ' +
          '초안 티만으로 그 위험이 상쇄되지 않는다.',
      },
    ],
    dependsOn: ['i18n.reviewOwnership'],
    drillDown: '/admin/ui-locale',
    blocks: '안전 문구 키의 카탈로그 등재 여부 · safetyCritical 분류 설계',
    statusQuo:
      '🔴 안전 문구는 전 영역에서 **의도적 미등재**로 남아 있다(기획서에 그렇게 기록돼 있다). ' +
      '화면에서는 그 키들이 한국어 원문 + 미등록 티로 나온다 — 즉 **의도적 제외와 미배선이 같은 모양**이다.',
    opens: [
      'safetyCritical 키를 분류해 다른 규칙(검수 필수·번역 금지)을 걸 수 있다',
      '미배선과 의도적 제외를 화면이 구분해 말할 수 있게 된다',
    ],
    verifyHow: [
      '화면 언어를 en 으로 바꾸고 투약 확인(BCMA)·MAR 화면을 열면 안전 문구만 한국어인 것이 보인다',
      '`docs/01-plan/features/ui-locale-i18n.plan.md` §P2 — 안전 문구 의도적 미등재 기록',
      '`node scripts/i18n-dead-definition-scan.mjs --list C` — 정의는 있으나 화면이 생한글인 키',
    ],
    afterDecision:
      '🔴 의결 후에도 **키를 카탈로그에 넣는 작업과 검수가 남는다.** VERIFIED_ONLY 를 고르면 ' +
      'safetyCritical 분류와 게이트가 개발로 남는다(지금 그 분류 자체가 없다).',
    owner: '질향상팀 + 전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'i18n.packActivationCriteria',
    track: 'I18N',
    title: '몇 %부터 언어를 선택지에 올릴 것인가 — 지금은 기준이 없다',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측이 역전을 보여준다: 아랍어는 **88.2%** 인데 선택지에서 내려가 있고(DEFERRED), ' +
      '베트남어 11.8%·몽골어 16.9%·카자흐어 17.1%·러시아어 17.4%·중국어 20.9%·태국어 20.9% 는 ' +
      '**선택 가능(ACTIVE)** 하다. 아랍어가 내려간 것은 커버리지 때문이 아니라 RTL 레이아웃·검수자 부재라는 ' +
      '**다른 이유**였다 — 즉 커버리지 기준은 애초에 존재한 적이 없다. ' +
      '17% 언어를 고른 사용자는 화면의 대부분을 한국어 원문으로 보게 된다.',
    legalReview: [
      '외국인 환자 진료 안내 — 기관이 특정 언어를 제공한다고 표시할 때의 책임 범위',
      '의료기관 인증 — 언어별 안내 제공 수준에 대한 요구사항 확인',
    ],
    approvalPath: 'COMMITTEE',
    authority: '국제진료센터 · 원무팀 · 질향상·환자안전위원회(QPS)',
    options: [
      {
        value: 'THRESHOLD_HIGH',
        label: '코어 커버리지 기준(예: 80%) 미만은 선택지에서 내린다',
        effect:
          '지금 기준이면 **추가 팩 6종이 전부 내려간다**(11.8~20.9%). 고른 언어는 대체로 그 언어로 보인다는 ' +
          '약속이 지켜진다. 🔴 대신 그 언어 사용자는 한국어·영어로 써야 한다.',
      },
      {
        value: 'THRESHOLD_LOW',
        label: '부분 번역도 선택지에 둔다(미등록은 원문+티)',
        effect:
          '현행 유지. 사용자가 일부라도 자기 언어로 볼 수 있다. 🔴 대신 "이 언어를 지원한다"는 인상이 ' +
          '실제 커버리지보다 크게 읽힌다 — 선택 화면에 커버리지를 함께 표시해야 정직하다.',
      },
      {
        value: 'CASE_BY_CASE',
        label: '언어별로 개별 판단하고 사유를 남긴다',
        effect:
          '아랍어처럼 커버리지 외 사유(레이아웃·검수자)가 있는 경우를 다룰 수 있다. ' +
          '🔴 사유를 남기지 않으면 지금과 같은 설명 불가 상태로 돌아간다.',
      },
    ],
    drillDown: '/admin/ui-locale',
    blocks: '추가 언어팩 6종의 선택지 노출 · 신규 언어 추가 시 판단 기준',
    statusQuo:
      '선택지 8종(ko 포함)이 노출 중이고 그중 6종이 코어의 20% 이하다. 아랍어(88.2%)만 별도 트랙 배지로 ' +
      '제외돼 있다. 🔴 어느 쪽도 기준에 따른 결과가 아니다 — 각각 다른 시점의 개별 판단이었다.',
    opens: [
      '신규 언어를 추가할 때 "언제 켜는가"를 매번 다시 논쟁하지 않아도 된다',
      '언어 선택 화면에 커버리지를 함께 낼 근거가 생긴다',
    ],
    verifyHow: [
      '`node scripts/i18n-pack-coverage.mjs` — 언어별 번역/전집·상태(ACTIVE·DEFERRED)',
      '`/admin/ui-locale`(3409) 언어 목록에서 현재 선택 가능한 언어 확인',
    ],
    afterDecision:
      '🔴 팩의 `status` 는 코드(`packages/shared/src/i18n/packs/<code>.ts`)에 있다 — ' +
      '**배포로만 반영된다.** 이 화면의 기록은 기준을 정한 것이고, 어느 팩을 내릴지는 그 기준의 적용이다.',
    owner: '국제진료센터 + 전산팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'i18n.unwiredScreenScope',
    track: 'I18N',
    title: '번역 배선이 없는 화면을 어디까지 채울 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '실측(2026-09-08): 직원 화면 축은 등재 6,177키 중 화면이 실제로 쓰는 것 5,544(89.8%)이고, ' +
      '**정의는 있는데 화면이 한국어를 그대로 출력하는 키가 208**, 정적으로 판정 불가한 동적 경로가 421 이다. ' +
      '환자 포털 축은 분모 482 중 미도달 37·원문조차 없는 키 10 이며, **잔여 탭 17파일이 통째로 미배선**이다. ' +
      '🔴 "전부 채운다"는 선택은 비용이 크고, "여기서 멈춘다"는 선택은 그 화면들이 영구히 한국어로 남는다는 뜻이다.',
    legalReview: [
      '외국인 환자 대상 화면(포털)의 안내 언어 제공 범위 — 기관이 약속한 수준과 일치하는가',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장 · 국제진료센터',
    options: [
      {
        value: 'HIGH_TRAFFIC_ONLY',
        label: '고빈도 화면만 채우고 나머지는 원문+티로 둔다',
        effect: '비용이 통제된다. 🔴 어느 화면이 고빈도인지의 근거를 함께 정해야 한다(추정으로 고르면 다음에 또 논쟁이 된다).',
        enact: null,
      },
      {
        value: 'PORTAL_FIRST',
        label: '환자 포털 잔여 17파일을 먼저 채운다',
        effect: '외부 사용자(환자·외국인)가 보는 화면을 우선한다. 직원 화면의 미배선 208키는 뒤로 밀린다.',
        enact: null,
      },
      {
        value: 'FULL',
        label: '전부 채운다',
        effect: '🔴 잔여 규모가 크다(직원 208 + 동적 421 + 포털 17파일). 동적 경로는 정적으로 못 가르므로 **화면을 눌러 확인**해야 한다.',
        enact: null,
      },
      {
        value: 'STOP_HERE',
        label: '여기서 동결한다',
        effect: '🔴 남은 화면은 영구히 한국어 원문 + 티로 나온다는 것을 확정한다. 그 사실을 언어 선택 화면이 말해야 한다.',
        enact: null,
      },
    ],
    drillDown: '/admin/ui-locale',
    blocks: '포털 경량 i18n 이관 · 직원 화면 잔여 배선',
    statusQuo:
      '직원 축 89.8% 도달, 포털 축 83.8% 도달. 🔴 미도달 키는 **한국어 원문 + 미등록 티**로 나온다 — ' +
      '조용한 폴백은 아니지만, 티가 계속 보인다는 것은 아무도 채우지 않고 있다는 뜻이다.',
    opens: ['잔여 범위가 확정되면 병렬 라운드로 나눌 수 있다(축 분할 설계는 이미 있다)'],
    verifyHow: [
      '`node scripts/i18n-dead-definition-scan.mjs` — A/B/C/D 판정과 영역별 분해',
      '`apps/web/src/lib/i18n/portal-i18n.ts` 주석 — 잔여 탭 목록(_care·_health·_services·_profile·_more·_auth·imaging)',
    ],
    afterDecision: '🔴 범위를 정해도 배선은 개발 작업이다. 이 화면의 기록은 "어디까지"까지다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  // ────────────────────────────────────────────────────────────────────────
  // ⑥ 국가 거버넌스 축 — KR 이 이름 없는 기본값으로 박혀 있다
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'country.institutionProfile',
    track: 'COUNTRY',
    title: '이 설치본은 어느 나라 기관인가 (지금은 아무도 정하지 않아도 KR 로 동작한다)',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 `hospital.country` 는 기본값이 KR 이라 **기록이 없어도 KR 로 동작한다** — 기본값이 결정 행세를 한다. ' +
      '실측(2026-09-08): 국가로 갈리는 코드는 개원 모듈 5파일뿐인데, 한국 전용 개념은 API 1,634행·Web 1,129행이고 ' +
      '화면 448면 중 **97면(21.65%)** 이 한국 전용 개념을 갖는다(한국 고유 68면·규칙만 한국 17면·판정 불가 12면). ' +
      '즉 진료·청구·자격은 "한국이 유일한 세계"라고 가정하는데 **그 가정이 코드에 적혀 있지 않다.**',
    legalReview: [
      '개설 허가 국가와 관할(대한민국 / UAE 는 DHA·DoH·MOHAP 중 어디인지)',
      '해당 국가의 의료정보 보관·국외이전 규정(설치본이 어디에서 운영되는가)',
      '요양기관 신고·등록 체계가 그 국가에 존재하는가(청구 축의 전제)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 국제사업 책임자',
    options: [
      {
        value: 'KR',
        label: '대한민국(KR)',
        effect: '개원·운영 단계 항목이 KR 45건으로 걸러지고, 거버넌스 프로파일이 KR 템플릿에서 파생된다. 현행 동작과 같다.',
        enact: { key: 'hospital.country', newValue: 'KR' },
      },
      {
        value: 'AE',
        label: '아랍에미리트(AE)',
        effect:
          '개원 항목이 AE 48건으로 바뀐다. 🔴 청구·자격·코드체계는 **아직 한국 전용**이라 ' +
          '이 값만 바꾸면 화면 97면이 한국 개념을 그대로 보여준다(슬롯화 결정이 선행돼야 한다).',
        enact: { key: 'hospital.country', newValue: 'AE' },
      },
    ],
    configKey: 'hospital.country',
    enactKind: 'CONFIG_CHANGE',
    drillDown: '/admin/opening',
    blocks: '개원·운영 단계 항목의 국가 필터 · 거버넌스 프로파일 파생 · AE 에디션 판단',
    statusQuo:
      '🔴 기록이 없다. 설정 기본값 KR 이 그대로 쓰이고 있고, 화면·리포트는 그것이 **결정된 값인지 기본값인지 말하지 않는다.** ' +
      '개원 축은 이 값으로 항목을 거르고 있으므로, 지금 보이는 개원 체크리스트는 "KR 이라고 가정한 결과"다.',
    opens: [
      '거버넌스 프로파일(국가 템플릿 ⊕ 기관 조정)이 근거를 갖는다',
      '국가 전용 개념 태깅(G1)의 기준점이 생긴다',
      'AE 에디션 착수 여부를 판단할 수 있다',
    ],
    verifyHow: [
      '`/admin/config` 에서 `hospital.country` 를 찾는다 — 기록이 없어도 KR 이 표시된다(기본값)',
      '`node scripts/country-concept-scan.mjs` §5 — 448면 중 97면이 한국 전용 개념 보유',
      '`packages/shared/src/governance/profile.ts` — KR 템플릿이 어떤 값을 선언하는지',
    ],
    afterDecision:
      '🔴 값을 기록해도 **화면이 바뀌지 않는다.** 지금 국가로 갈리는 코드는 개원 모듈뿐이다 — ' +
      '청구·자격·코드체계·서식은 국가 분기가 0 이다. 무엇을 갈라야 하는지는 슬롯화 범위 결정이 정한다.',
    owner: '경영기획 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'country.slotScope',
    track: 'COUNTRY',
    title: '국가별로 갈라야 할 화면을 어디까지 슬롯으로 만들 것인가 (97면 중)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '실측: 한국 전용 개념을 가진 화면 97면 = 한국 고유 68 · 규칙만 한국 17 · 판정 불가 12. ' +
      '개념 밀도는 청구·본인부담(1,609)과 청구·제출(1,365)에 몰려 있다. ' +
      '🔴 전부 슬롯화하면 KR 화면이 추상화로 뒤덮이고, 하나도 안 하면 다른 나라에서 화면을 **복제**하게 된다 — ' +
      '복제하면 KR 개선이 그 나라에 영원히 가지 않는다.',
    legalReview: [
      '국가별 청구·자격 규칙의 차이가 화면 구조까지 바꾸는가(블록 유지 vs 제거)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장 · 원무·보험팀장 · 국제사업',
    options: [
      {
        value: 'KR_ONLY_68',
        label: '한국 고유 개념을 가진 68면을 슬롯화한다',
        effect: '가장 넓은 범위. 🔴 규칙만 다른 17면은 블록을 유지해야 하므로 슬롯이 아니라 값 교체로 다뤄야 한다.',
        enact: null,
      },
      {
        value: 'BILLING_FIRST',
        label: '청구·자격 축부터 슬롯화한다',
        effect: '개념이 가장 몰린 축을 먼저 연다. 나머지 화면은 그대로 KR 전용으로 남는다(그 사실을 화면이 밝혀야 한다).',
        enact: null,
      },
      {
        value: 'NONE_EDITION',
        label: '슬롯화하지 않고 국가별 에디션으로 복제한다',
        effect:
          '🔴 초기 속도는 빠르다. 대신 KR 개선이 타국 에디션에 자동으로 가지 않는다 — ' +
          '두 벌이 갈라지는 것을 관측할 수단을 함께 정해야 한다.',
        enact: null,
      },
    ],
    dependsOn: ['country.institutionProfile'],
    drillDown: '/admin/opening',
    blocks: '거버넌스 슬롯 도입(G2) · AE 화면 목록 도출',
    statusQuo:
      '슬롯이 하나도 없다. 프로파일은 값만 선언하고(G0 완료·현행 화면 diff 0), 화면은 아직 아무것도 프로파일에서 읽지 않는다.',
    opens: ['"AE 에서 무엇을 빼는가"의 목록이 코드에서 나온다(지금은 사람이 눈으로 읽어야 한다)'],
    verifyHow: [
      '`node scripts/country-concept-scan.mjs` §5 — 화면별 티어와 개념 행 수',
      '`packages/shared/src/governance/profile.ts` — 프로파일이 지금 무엇을 선언하는가',
    ],
    afterDecision: '🔴 범위를 정해도 슬롯화는 개발 작업이다(화면마다 프로파일에서 읽도록 바꾼다).',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'country.settingExposure',
    track: 'COUNTRY',
    title: '기관 세팅 화면에 거버넌스 항목을 얼마나 노출할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '설계는 두 층이다 — 국가 템플릿(코드) ⊕ 기관 조정치(설정). 🔴 **조정할 수 있다는 것은 잘못 조정할 수 있다는 뜻이다.** ' +
      '전례가 둘 있다: 설정 다이얼 388개 중 **50개가 아무 데도 배선되지 않아** 바꿔도 아무 일이 없었고, ' +
      '시드 잔재가 정책을 정해버려 **운영 관리자를 시스템에서 잠근** 적이 있다. ' +
      '다이얼이 많을수록 잘못 세팅될 자리가 는다.',
    legalReview: [
      '기관이 조정할 수 있는 값과 국가 규정이 정하는 값의 경계(조정하면 안 되는 항목이 있는가)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장 · 원무팀장',
    options: [
      {
        value: 'ALL_FIELDS',
        label: '프로파일 전 항목을 노출한다',
        effect: '유연하다. 🔴 대신 국가 규정이 정한 값까지 기관이 바꿀 수 있게 된다(가드로 막지 않으면 조용히 어긋난다).',
        enact: null,
      },
      {
        value: 'CHANGES_ONLY',
        label: '국가 간에 실제로 값이 다른 항목만 노출한다',
        effect: '다이얼 수가 최소가 된다. 🔴 "다른 항목"을 무엇으로 판정할지가 함께 정해져야 한다(템플릿 간 diff).',
        enact: null,
      },
      {
        value: 'NONE_CODE_ONLY',
        label: '세팅 화면을 두지 않고 코드 템플릿만 쓴다',
        effect: '오설정 위험이 0 이다. 대신 기관마다 다른 값이 필요할 때 **배포가 필요하다**.',
        enact: null,
      },
    ],
    dependsOn: ['country.institutionProfile'],
    drillDown: '/admin/opening',
    blocks: '기관 세팅 화면(G0-b) 신설',
    statusQuo:
      '세팅 화면이 아직 없다. 프로파일은 국가 템플릿만으로 파생되고 기관 조정 경로는 데이터 층에만 있다' +
      '(조정이 템플릿을 이기는지·출처가 보이는지는 가드로 확인돼 있다).',
    opens: ['개원 축에 기관 세팅 화면을 붙일 수 있다(출처 배지·발효 시점 포함)'],
    verifyHow: [
      '`packages/shared/src/governance/profile.ts` — 유효 프로파일 파생(템플릿 ⊕ 조정)',
      '`/admin/ai-settings`(시스템 설정) — 지금 조정 가능한 값이 어디에 있는지',
    ],
    afterDecision: '🔴 노출 범위를 정해도 화면은 개발로 만든다. 발효 시점(과거를 다시 쓰지 않는다) 설계가 함께 남는다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'country.procedureCodeSystem',
    track: 'COUNTRY',
    title: '처치·수가 코드의 체계 이름을 무엇으로 적을 것인가 (근거가 주석뿐이다)',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 실측: `DiagnosisCode` 에는 `codeSystem @default("KCD-8")` 컬럼이 있는데 ' +
      '**`ProcedureCode` 에는 그 컬럼이 없다.** 지금 거버넌스 프로파일이 적어 둔 이름(HIRA-EDI)의 근거는 ' +
      '`origin:"HIRA"`·`gazetteClass`(고시 분류번호)·소스 주석뿐이라 **DB 실측이 아니다** — ' +
      '프로파일 안에서 이 필드만 기계 대조 가드가 없다. 이름을 잘못 적으면 대외 문서·연동 규격이 그 이름을 따라간다.',
    legalReview: [
      '요양급여비용 청구에 쓰는 코드 체계의 공식 명칭(고시·전송 규격 문서상의 표기)',
      '요양기관 현황 신고·EDI 전송 규격에서 쓰는 코드 체계명과 일치하는가',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '원무·보험팀장 · 개설자',
    options: [
      {
        value: 'CONFIRM_CURRENT',
        label: '현재 이름이 맞다고 확인한다',
        effect: '프로파일 값을 확정하고 근거(고시·규격 문서)를 함께 기록한다. 🔴 그 근거가 없으면 확인이 아니라 추정이다.',
        enact: null,
      },
      {
        value: 'RENAME',
        label: '다른 공식 명칭으로 바꾼다',
        effect: '프로파일 문자열을 바꾼다. 대외 문서·연동 규격 표기도 함께 바꿔야 한다.',
        enact: null,
      },
      {
        value: 'ADD_COLUMN',
        label: '`ProcedureCode` 에 `codeSystem` 컬럼을 만들어 DB 를 정본으로 삼는다',
        effect:
          '진단 코드와 같은 모양이 된다(기계 대조 가드가 가능해진다). 🔴 스키마 변경이라 배포가 필요하고, ' +
          '기존 166,744건에 어떤 값을 넣을지도 이 결정에 포함된다.',
        enact: null,
      },
    ],
    drillDown: '/admin/codes',
    blocks: '프로파일 coding.procedure 값의 기계 대조 가드',
    statusQuo:
      '프로파일에 이름이 적혀 있고 주석이 **"이 프로파일이 처음 붙이는 이름"** 이라고 밝히고 있다. ' +
      '화면·리포트는 그 이름을 그대로 쓴다.',
    opens: ['프로파일 값이 소스와 갈라지지 않는지 기계로 확인할 수 있게 된다'],
    verifyHow: [
      "`grep -n 'model ProcedureCode' -A 18 apps/api/prisma/schema.prisma` — codeSystem 컬럼이 없다",
      "`grep -n 'codeSystem' apps/api/prisma/schema.prisma` — DiagnosisCode 에만 있다",
      "`packages/shared/src/governance/profile.ts` coding.procedure 주석",
    ],
    afterDecision: '🔴 확인을 기록해도 컬럼이 생기지 않는다. ADD_COLUMN 을 고르면 스키마 변경·백필이 개발로 남는다.',
    owner: '원무·보험팀 + 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'country.codeCanonLocation',
    track: 'COUNTRY',
    title: '`CountryCode` 정본을 shared 로 옮길 것인가 (지금은 사본 + 대조 가드)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '국가 코드 정본은 개원 레지스트리(api)에 있는데 shared 는 api 를 import 할 수 없다. ' +
      '그래서 shared 에 **사본**을 두고 기계 대조 가드로 받쳤다(CMS 스타일 사본과 같은 방식). ' +
      '🔴 사본이 남아 있는 한 갈라질 자리다 — 가드가 있으니 조용히 갈라지지는 않지만, 두 곳을 함께 고쳐야 한다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '전산팀장',
    options: [
      {
        value: 'MOVE_TO_SHARED',
        label: '정본을 shared 로 옮기고 개원 레지스트리가 참조한다',
        effect: '사본이 사라진다. 🔴 개원 레지스트리의 국가 어휘를 쓰는 소비처를 **전역으로** 바꿔야 한다(한 곳만 고치면 갈라진다).',
        enact: null,
      },
      {
        value: 'KEEP_COPY_GUARD',
        label: '사본 + 대조 가드를 유지한다',
        effect: '지금 상태를 확정한다. 가드가 갈라짐을 잡지만, 새 국가를 추가할 때 두 곳을 고쳐야 한다는 사실이 남는다.',
        enact: null,
      },
    ],
    drillDown: '/admin/opening',
    blocks: 'AE 프로파일 도입 시 국가 어휘 확장',
    statusQuo: 'shared 프로파일이 사본을 들고 있고, 주석이 "오늘의 정본은 개원 레지스트리"라고 밝히고 있다.',
    opens: ['국가 어휘를 한 곳에서만 늘릴 수 있게 된다'],
    verifyHow: [
      "`grep -n 'CountryCode' packages/shared/src/governance/profile.ts` — 사본과 정본 위치 주석",
      "`grep -n 'countries' apps/api/src/modules/opening/opening.registry.ts` — 정본 선언",
    ],
    afterDecision: '🔴 결정만으로 옮겨지지 않는다 — 이동은 개발 작업이고, 소비처 전역 확인이 함께 필요하다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  // ────────────────────────────────────────────────────────────────────────
  // ⑦ AE 에디션 축 — 이 기관의 개시와는 무관하다(그 사실을 goLive 로 밝힌다)
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'ae.targetScope',
    track: 'AE',
    title: 'AE 에디션의 대상 기관과 화면 목록을 확정한다 (이 트랙의 시작점)',
    layer: 'LICENSE_HOLDER',
    why:
      'AE 에디션은 좌우를 뒤집는 일이 아니라 **업무가 다른 화면을 따로 만드는 일**로 결정돼 있다' +
      '(민간보험 중심·관할 셋·다른 코드 체계·다른 서식). 🔴 그런데 **대상 기관과 화면 목록이 없다** — ' +
      '목록 없이 시작하면 한국 화면 448면을 1:1 로 대응시키게 되고, 그것이 이 트랙이 명시적으로 금지한 방식이다. ' +
      '아랍어 번역 자산 5,449키는 이미 있으나 선택지에서는 내려가 있다(레이아웃·검수자 부재).',
    legalReview: [
      'UAE 관할 — DHA(두바이)·DoH(아부다비)·MOHAP(연방) 중 어느 관할의 기관인가',
      '해당 관할의 의료정보 보관·국외이전 규정(설치본 위치)',
      '현지 의료기관 인허가와 시스템 요건(전자의무기록 요구사항)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '개설자·경영진 · 국제사업 책임자',
    options: [
      {
        value: 'MINIMAL_EDITION',
        label: '최소 에디션(핵심 동선 10~15면)부터 만든다',
        effect: '접수-보험확인-진료-오더-청구-수납의 한 줄기만 연다. 나머지는 KR 화면을 쓰지 않는다(막는다).',
        enact: null,
      },
      {
        value: 'FULL_EDITION',
        label: '전 화면을 AE 용으로 만든다',
        effect: '🔴 448면 규모다. KR 개선이 두 벌로 갈라지는 비용을 계속 부담한다.',
        enact: null,
      },
      {
        value: 'HOLD',
        label: '착수하지 않는다(자산은 보존)',
        effect:
          '아랍어 팩·BiDi 격리 등 이미 만든 무해한 것은 남긴다. 🔴 그러면 아랍어는 계속 선택지에서 내려간 상태이고, ' +
          '그 사유를 화면이 계속 밝혀야 한다.',
        enact: null,
      },
    ],
    dependsOn: ['country.institutionProfile'],
    drillDown: '/admin/ui-locale',
    blocks: 'AE 프로파일 선언 · AE 화면 재구성 · 아랍어 선택지 승격',
    statusQuo:
      '착수 전이다. 무해한 선행 작업만 끝나 있다(수치·날짜 부품 방향 격리, 아랍어 팩 보존). ' +
      '🔴 아랍어는 88.2% 번역돼 있으나 **선택지에 없다** — 레이아웃과 검수자가 없어서다.',
    opens: ['AE 프로파일 선언과 화면 목록 도출', '아랍어 검수자·역법·서식 등 후속 결정들이 의미를 갖는다'],
    verifyHow: [
      '`node scripts/i18n-pack-coverage.mjs` — ar 88.2%·DEFERRED',
      '`docs/01-plan/features/arabic-rtl-track.plan.md` — 트랙 설계와 사람 결정 표',
    ],
    afterDecision: '🔴 목록을 정해도 화면은 개발로 만든다. 이 기록은 "무엇을 만들 것인가"까지다.',
    owner: '국제사업 + 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'ae.claimJurisdiction',
    track: 'AE',
    title: 'AE 청구·보험 규격을 어느 관할부터 맞출 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 UAE 는 관할이 셋이다(DHA·DoH·MOHAP) — 제출처를 하나로 단정하면 틀린다. ' +
      '청구·자격 코드는 지금 전부 한국 것이고(본인부담·요양급여·심평원 EDI), 국가 분기가 **0** 이다. ' +
      '어느 관할의 규격을 먼저 맞출지가 정해져야 청구 축을 열 수 있다.',
    legalReview: [
      '대상 기관이 속한 관할의 청구 규격·코드 체계(조사한 것만 적는다 — 확인 전에는 레지스트리에 넣지 않는다)',
      '민간보험사·플랜 구조와 사전승인 절차',
      '환자 본인부담 산정 규칙(한국의 급여/비급여 구분과 대응되지 않는다)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '개설자·경영진 · 원무·보험 책임자',
    options: [
      { value: 'DHA_FIRST', label: 'DHA(두바이) 규격부터', effect: '해당 관할의 청구·코드 규격을 먼저 구현한다. 다른 관할은 이후 확장한다.', enact: null },
      { value: 'DOH_FIRST', label: 'DoH(아부다비) 규격부터', effect: '해당 관할의 청구·코드 규격을 먼저 구현한다.', enact: null },
      { value: 'MOHAP_FIRST', label: 'MOHAP(연방) 규격부터', effect: '해당 관할의 청구·코드 규격을 먼저 구현한다.', enact: null },
      { value: 'DEFER', label: '청구는 뒤로 미루고 진료 동선만 먼저 연다', effect: '🔴 청구 없이 운영할 수 있는 범위를 함께 정해야 한다(수납이 없는 화면은 반쪽이다).', enact: null },
    ],
    dependsOn: ['ae.targetScope'],
    blocks: 'AE 청구·자격 모듈 설계',
    statusQuo: '청구·자격·결정 등록부의 국가 분기가 각각 0 이다. AE 규격 조사는 착수 전이다.',
    opens: ['AE 청구 화면·코드 마스터 설계 착수'],
    verifyHow: [
      '`node scripts/country-concept-scan.mjs` §2 — 청구·제출 1,365 · 지불자·본인부담 1,609 매칭이 전부 한국 개념',
      '`grep -rn "country" apps/api/src/modules/billing apps/api/src/modules/eligibility` — 국가 분기 부재 확인',
    ],
    afterDecision: '🔴 관할을 정해도 규격 조사가 남는다. **조사한 것만 적는다** — 확인하지 못한 조문·수수료는 레지스트리에 넣지 않는다.',
    owner: '국제사업 + 원무·보험팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  // ────────────────────────────────────────────────────────────────────────
  // ⑧ 나머지 축 — 백로그에만 있던 사람 판단을 화면으로
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'qi.measurementSource',
    track: 'QUALITY',
    title: '질지표 측정값의 출처(자동 산출·수기 입력)를 원장에 남길 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: `QiMeasurement` 에는 분자·분모·값·달성여부는 있어도 **출처 컬럼이 없다.** ' +
      '그래서 질 대시보드가 손위생 98.48% 달성으로 그리는 동안, 같은 시각 감염관리 보드는 원내 관찰 0건(산출 불가)이었다. ' +
      '만족도 84.62% ↔ 설문 0행, 낙상 월 분자 7 ↔ 사고 원장 전 기간 12 도 같은 부류다. ' +
      '대조 근거(원장 실측을 나란히 보여주는 것)는 붙였지만, **어느 값이 어떻게 만들어졌는지는 여전히 남지 않는다.**',
    legalReview: [
      '의료기관 인증 — 지표 측정값의 근거 보존 요구(수기 입력값의 소명 가능성)',
      '대외 보고(인증·평가)에 제출하는 값의 출처 표기 의무',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '질향상·환자안전위원회(QPS) · 간호부 · 감염관리실',
    options: [
      {
        value: 'ADD_SOURCE_COLUMN',
        label: '출처 컬럼을 만들고 입력 경로마다 기록한다',
        effect:
          '자동 산출·수기 입력·외부 보고를 갈라 볼 수 있다. 🔴 스키마 변경이라 배포가 필요하고, ' +
          '기존 측정값의 출처는 **알 수 없다**(소급해 채우면 그것이 날조다 — 미상으로 둔다).',
        enact: null,
      },
      {
        value: 'KEEP_LEDGER_ONLY',
        label: '현행 유지 — 원장 대조 근거만 나란히 보여준다',
        effect: '스키마를 건드리지 않는다. 대조 근거가 없는 지표는 계속 출처를 말하지 못한다.',
        enact: null,
      },
      {
        value: 'AUTO_ONLY',
        label: '자동 산출만 허용하고 수기 입력을 막는다',
        effect:
          '🔴 지금 자동 산출이 가능한 지표는 일부다 — 막으면 나머지 지표가 **아예 측정되지 않는다**(굶는 쪽으로 작동한다).',
        enact: null,
      },
    ],
    drillDown: '/admin/quality',
    blocks: '지표 값의 출처 구분 · 자동 산출 확대 판단',
    statusQuo:
      '2026-10-08 QI 흐름(QI-FLOW-001) — 출처는 **사실 기록으로** 남기 시작했다(`qi_measurements.source`: 화면 입력 MANUAL · 월 마감 AUTO · 처방 원장 CPOE · 시드 SEED). ' +
      '그 이전 행의 출처는 미상(null)으로 둔다(소급해 채우면 날조다). 같은 달 수기·자동은 칸이 달라 **나란히** 남는다. ' +
      '🔴 남은 판단은 정책이다 — 어느 값을 정본으로 볼지는 `qi.autoManual.precedence`, 수기 입력을 막을지(AUTO_ONLY)는 이 결정의 몫이다.',
    opens: ['자동 산출 확대의 우선순위를 근거로 정할 수 있다', '인증·평가 제출값의 소명 경로가 생긴다'],
    verifyHow: [
      "`grep -n 'model QiMeasurement' -A 30 apps/api/prisma/schema.prisma` — source·sourceKey·computedBy·evidence 컬럼(2026-10-08)",
      '`/quality` 와 감염관리 보드를 같은 기간으로 열어 값을 대조한다',
    ],
    afterDecision:
      '🔴 컬럼을 만들어도 **집계 기준 정의가 선행하지 않으면 값이 또 갈린다** — ' +
      '무엇을 "자동 산출"이라 부를지(분모·기간·제외 규칙)를 먼저 정해야 한다.',
    owner: '질향상팀',
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'security.keyDerivationUnify',
    track: 'SECURITY',
    title: '키 파생 두 갈래를 통일하고 키 로테이션을 언제 실행할 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 실측: 같은 `ENCRYPTION_KEY` 인데 파생이 **두 갈래**다 — 환자 서비스는 원시 바이트로, ' +
      '그 밖은 scrypt 로 파생한다. 두 갈래가 **같은 컬럼(`patients.national_id`)에 쓴다** ' +
      '(직원 등록 경로 = 원시 · 포털 가입 경로 = scrypt). ' +
      '게다가 블라인드 인덱스(`national_id_hash`)는 원시 키 HMAC 이라, 키를 바꾸면 ' +
      '중복확인·환자 병합 점수가 **조용히** 안 맞게 된다. ' +
      '운영 `ENCRYPTION_KEY` 가 all-zeros 인 것은 별도로 개시 관제가 적발해 두고 있다.',
    legalReview: [
      '개인정보보호법 안전성 확보조치 기준 — 고유식별정보 암호화·키 관리 요구',
      '재암호화 중 서비스 중단 범위와 백업본의 키 정합(백업을 옛 키로 복원하면 못 읽는다)',
      '키 위탁·보관 주체(HSM 도입 여부와의 관계)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '정보보호책임자(CISO) · 개인정보보호책임자(CPO) · 개설자',
    options: [
      {
        value: 'WITH_SEED_CLEANUP',
        label: '시드 데이터 정리와 함께 실행한다',
        effect:
          '가상 환자 시드를 걷어내는 시점에 재암호화한다 — 대상 행이 줄어 위험이 작다. ' +
          '🔴 실환자 최초 등록 **전**이어야 한다.',
      },
      {
        value: 'NOW',
        label: '지금 실행한다',
        effect: '시드가 남은 상태로 전 행을 재암호화한다. 복호 안 되는 행이 하나라도 있으면 도구가 변환을 거부한다(부분 성공이 최악이다).',
      },
      {
        value: 'DEFER_UNTIL_REAL_PATIENT',
        label: '실환자 등록 직전까지 보류한다',
        effect: '🔴 보류 자체는 결정이다 — 그 사이에 들어온 데이터는 지금 키로 쌓인다.',
      },
    ],
    drillDown: '/admin/go-live',
    blocks: '실환자 최초 등록(키를 바꾸려면 전 행 재암호화가 선행) · 파생 통일',
    statusQuo:
      '🔴 두 갈래가 그대로 살아 있다. 로테이션 도구는 있고 **기본이 읽기 전용(dry-run)** 이며, ' +
      '행마다 신·구 키 × 두 파생 = 4조합을 시도해 복호에 성공한 파생 그대로 재암호화하도록 만들어져 있다. ' +
      '아직 실행된 적은 없다.',
    opens: ['키 파생 통일 · HSM 키 수탁 논의의 전제', '실환자 데이터 이관 일정'],
    verifyHow: [
      "`grep -n \"Buffer.from(keyHex\" apps/api/src/modules/patient/patient.service.ts` — 원시 파생",
      "`grep -n 'scryptSync' apps/api/src/common/crypto/kdf.ts` — scrypt 파생",
      '`ROTATE_OLD_KEY=… ROTATE_NEW_KEY=… node scripts/rotate-encryption-key.mjs` (기본 dry-run) — 판정 4상태 확인',
    ],
    afterDecision:
      '🔴 **기록만으로 한 행도 재암호화되지 않는다.** 실행은 사람이 `--apply` 로 하는 운영 작업이고, ' +
      '같은 트랜잭션에서 블라인드 인덱스를 재계산해야 한다. 파생 통일은 로테이션과 **별개 과제**다' +
      '(한 번에 한 변수만 바꾼다).',
    owner: '정보보호팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'mobile.appStoreRelease',
    track: 'PLATFORM',
    title: '환자 앱을 스토어에 배포할 것인가 (배포 없이는 만든 화면이 실기기에 없다)',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 모바일 앱은 서버 배포 스크립트와 **무관하다**. 만성질환 추이·검진 비교·접근 이력 같은 화면을 붙여도 ' +
      '실기기에 반영되는 경로는 앱 빌드와 스토어 심사뿐이다 — 즉 **개발이 끝나도 사용자에게는 없다.** ' +
      '이 경계는 개발 결정으로 넘을 수 없다(사업자 계정·심사·개인정보 처리방침 고지 주체가 기관이다).',
    legalReview: [
      '앱 스토어 개인정보 처리방침 고지 주체와 수집 항목의 일치',
      '의료 관련 앱 심사 요건(진료 정보 표시 범위)',
      '앱에서 수집·표시하는 항목의 동의 범위(포털 동의로 충분한가)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 개인정보보호책임자(CPO)',
    options: [
      { value: 'PUBLIC_STORE', label: '공개 스토어에 배포한다', effect: '환자가 스토어에서 받는다. 심사 주기와 갱신 절차가 생긴다.', },
      { value: 'INTERNAL_DISTRIBUTION', label: '사내·제한 배포로 먼저 검증한다', effect: '실기기 검증은 가능하고 공개 심사는 없다. 일반 환자는 여전히 앱을 쓸 수 없다.', },
      { value: 'HOLD_PORTAL_ONLY', label: '배포하지 않고 웹 포털만 쓴다', effect: '🔴 앱 전용으로 만든 화면은 **아무도 볼 수 없다** — 그러면 그 화면을 계속 유지할 이유가 있는지 함께 판단해야 한다.', },
    ],
    drillDown: '/admin/go-live',
    blocks: '환자 앱 화면의 실사용 · 앱 기반 알림 수신',
    statusQuo:
      '앱 화면은 저장소에 있고 서버 EP 도 준비돼 있으나 **스토어 배포는 없다**. ' +
      '운영 실증도 불가능하다(서버 배포와 경로가 다르다).',
    opens: ['환자 앱 화면의 실사용', '앱 푸시 도달 검증(알림 적법 근거 결정과 별개로 경로가 필요하다)'],
    verifyHow: [
      '`./infra/scripts/deploy.sh` 옵션에 모바일이 없다는 것을 확인한다',
      '`apps/mobile` 의 빌드·배포 경로가 저장소 밖(스토어)임을 확인한다',
    ],
    afterDecision: '🔴 결정 후에도 빌드·심사·계정 준비가 남는다. 이 화면은 그중 어느 것도 하지 못한다.',
    owner: '전산팀 · 홍보팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'billing.paymentRefReconciliation',
    track: 'BILLING',
    title: '입금 참조번호를 실입금과 대사할 것인가 (지금은 사람의 단언이다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 선결제가 필요한 거래에서 `paymentRef` **문자열이 있기만 하면** 요건을 통과시키고 ' +
      '결제 시각을 그 순간으로 찍는다. 입금 사실을 확인하는 코드는 없다 — ' +
      '즉 원장에 남는 "결제됨"은 시스템이 확인한 사실이 아니라 **입력한 사람의 단언**이다. ' +
      '코드 주석도 그렇게 적혀 있다.',
    legalReview: [
      '수납·정산 기록의 증빙 요건(내부 회계 규정과 외부 감사)',
      '실입금 대사 없이 이행 처리된 거래의 책임 소재',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '원무팀장 · 재무·회계 책임자',
    options: [
      {
        value: 'RECONCILE_REQUIRED',
        label: '대사 전에는 이행 완료로 넘기지 않는다',
        effect: '🔴 입금 확인이 늦으면 업무가 멈춘다 — 대사 경로(은행·PG 연동 또는 수기 확인 화면)가 함께 필요하다.',
        enact: null,
      },
      {
        value: 'KEEP_ASSERTION',
        label: '현행 유지 — 화면이 "사람의 단언"임을 밝힌다',
        effect: '업무 속도를 지킨다. 대신 화면이 그 값을 **확인된 입금처럼 보이게 하면 안 된다**(표기를 함께 고친다).',
        enact: null,
      },
      {
        value: 'ERP_HANDOFF',
        label: '대사를 ERP 로 넘긴다',
        effect: '회계 정본이 있는 쪽에서 대사한다. 🔴 넘긴다는 사실과 넘어간 뒤의 상태를 이 시스템이 표시할 수 있어야 한다.',
        enact: null,
      },
    ],
    drillDown: '/admin/voucher/dashboard',
    blocks: '수납·검진권 거래의 입금 확인 표기',
    statusQuo: '참조번호가 있으면 결제 시각이 즉시 기록되고 거래가 이행 완료로 넘어간다. 대사는 어디에서도 하지 않는다.',
    opens: ['입금 확인 표기를 사실대로 그릴 수 있다', 'ERP 대사 연동 범위 판단'],
    verifyHow: [
      "`grep -n 'paymentRef' apps/api/src/modules/voucher/voucher-trade.service.ts` — 존재만 보고 통과시키는 분기",
      '검진권 거래 화면에서 임의 문자열을 참조번호로 넣어 본다(운영 DB 는 가상 시드다)',
    ],
    afterDecision: '🔴 결정 후 대사 경로가 개발로 남는다. KEEP_ASSERTION 을 골라도 **표기 수정**은 남는다.',
    owner: '원무팀 · 재무팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.evidenceExtract.enable',
    track: 'AI',
    title: '행정 증빙 문서 AI 판독을 켤 것인가 (첨부 이미지가 AI 서버로 나간다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '개설신고증·계약서 같은 행정 증빙을 AI 가 읽어 초안을 만드는 기능이 있고 **기본 OFF** 다. ' +
      '켜면 **첨부 이미지가 AI 서버로 전송된다** — 임상 데이터는 아니지만 기관 문서이고, ' +
      '전송 목적지·경로의 법적 한정(상위 결정)이 먼저 있어야 한다. ' +
      '결과는 초안이고 저장되지 않으며, PDF 는 판독하지 않는다(읽는 척하지 않는다).',
    legalReview: [
      '행정 문서의 외부 전송이 위탁 계약 범위에 포함되는가',
      '문서에 개인정보가 포함될 경우의 처리(계약서·신고증에 개인 서명·주민등록번호가 있을 수 있다)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개인정보보호책임자(CPO) · 총무·행정 책임자',
    options: [
      {
        value: 'ON',
        label: '켠다',
        effect: '첨부 이미지가 AI 서버로 전송되어 판독 초안이 만들어진다. 결과는 저장되지 않고 사람이 옮겨 적는다.',
        enact: { key: 'ai.evidenceExtract.enabled', newValue: true },
      },
      {
        value: 'OFF',
        label: '끈다(현행)',
        effect: '판독 버튼이 동작하지 않는다. 증빙은 사람이 읽고 입력한다.',
        enact: { key: 'ai.evidenceExtract.enabled', newValue: false },
      },
    ],
    dependsOn: ['legal.aiEgress.transferScope'],
    configKey: 'ai.evidenceExtract.enabled',
    enactKind: 'CONFIG_CHANGE',
    drillDown: '/admin/opening',
    blocks: '개원·결정 증빙 첨부의 판독 초안 기능',
    statusQuo: '기본 OFF 로 꺼져 있다. 개원 축과 결정 등록부의 첨부 판독 버튼은 있으나 동작하지 않는다.',
    opens: ['증빙 입력 시간 단축(초안 제시)'],
    verifyHow: [
      '`/admin/config` 에서 `ai.evidenceExtract.enabled` 확인(기본 false)',
      '결정 항목의 첨부에서 판독을 눌러 본다 — 꺼져 있으면 거부된다',
    ],
    afterDecision: '설정이 즉시 반영된다. 🔴 판독 결과는 **초안이고 저장되지 않는다** — 사람이 확인해 옮겨 적어야 한다.',
    owner: '총무팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'governance.quorumRosterGate',
    track: 'GOVERNANCE',
    title: '위원회 의결 시 위원 명부 대조를 어디까지 강제할 것인가 (지금 경고)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 정족수가 **문자 다섯 개로 충족되던** 자리가 있었다(위원 명부가 비어 있어도 의결이 통과했다). ' +
      '그래서 참석자를 위원 명부와 대조하는 게이트를 넣었는데 기본이 **경고(WARN)** 다 — ' +
      '위반이 기록되지만 의결은 그대로 성립한다. 차단(BLOCK)으로 올리면 명부가 비어 있는 회의는 의결 자체가 막힌다.',
    legalReview: [
      '의료기관 인증 — 위원회 구성·정족수 요건과 기록 보존',
      '위원 임명 절차가 문서로 존재하는가(명부의 근거)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '병원장 · 각 위원회 위원장',
    options: [
      { value: 'OFF', label: '대조하지 않는다', effect: '🔴 위원 명부 없이도 의결이 성립한다 — 종전에 실제로 그랬다.', enact: { key: 'governance.quorumRosterGate', newValue: 'OFF' } },
      { value: 'WARN', label: '경고만 남긴다(현행)', effect: '위반이 기록되고 화면에 뜨지만 의결은 성립한다. 명부를 채울 시간을 벌되 방치될 수 있다.', enact: { key: 'governance.quorumRosterGate', newValue: 'WARN' } },
      { value: 'BLOCK', label: '차단한다', effect: '🔴 명부가 비어 있거나 참석 위원이 정족수 미만이면 **의결이 막힌다**. 위원 임명이 선행돼야 한다.', enact: { key: 'governance.quorumRosterGate', newValue: 'BLOCK' } },
    ],
    configKey: 'governance.quorumRosterGate',
    enactKind: 'CONFIG_CHANGE',
    drillDown: '/admin/safety-gates',
    blocks: '위원회 의결의 명부 대조 강도',
    statusQuo: '경고 단계다. 참석자 신원을 읽을 수 없는 회의는 평가하지 않는다(없는 위반을 만들지 않는다).',
    opens: ['위원 임명이 끝난 뒤 차단으로 승격할 수 있다'],
    verifyHow: [
      '`/admin/safety-gates` 에서 게이트 상태와 위반 통계 확인',
      '`/admin/governance` 에서 위원 명부가 채워져 있는지 확인',
    ],
    afterDecision: '설정이 즉시 반영된다. 🔴 차단으로 올리기 전에 **위원 임명**이 실제로 끝나 있어야 한다(막으면 의결이 멈춘다).',
    owner: '기획·총무팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    /**
     * 🔴 키 이름에 설정 키(`pharmacy.rxValidDays`)를 **부분 문자열로 넣지 않는다** —
     *    미배선 설정 스캐너가 이 등록부의 언급을 "소비처"로 세어 **안 먹는 다이얼을 배선됨으로** 오판했다
     *    (2026-09-08 실측). 등록부는 결정을 적어 둘 뿐 설정을 읽는 코드가 아니다.
     */
    key: 'pharmacy.prescriptionValidityBasis',
    track: 'CLINICAL',
    title: '원외 처방전 유효기간 3일 — 근거는 무엇이고, 설정으로 뺄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 만료 처리 코드가 **3일을 그대로 박아** 쓴다(`pharmacy.service.ts` 의 만료 배치 · ' +
      '원격진료 안내 문구도 "유효기간: 3일" 을 문자열로 적는다). ' +
      '설정 카탈로그에 유효일수 키가 있긴 하지만 **읽는 코드가 없다** — 관리자가 그 값을 바꿔도 ' +
      '아무 일도 일어나지 않는다(안 먹는 다이얼). 화면은 그 사실을 이미 고지하고 있다. ' +
      '즉 지금 상태는 "3일이 정책"이 아니라 **"3일이 코드"** 다. 그 값이 법정 기한인지 원내 정책인지도 확인된 바 없다.',
    legalReview: [
      '의료법령상 처방전 사용기간 규정과 예외(의사가 따로 정할 수 있는 범위)',
      '기간이 지난 처방의 조제 가능 여부와 책임 소재',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '약제부장 · 진료부장',
    options: [
      {
        value: 'CONFIRM_HARDCODED',
        label: '3일이 맞다 — 코드 고정을 유지하고 안 먹는 다이얼은 없앤다',
        effect:
          '근거를 기록하고 설정 항목을 내린다. 🔴 다이얼을 남겨 두면 다음 사람이 그것을 정책이라고 믿는다.',
        enact: null,
      },
      {
        value: 'MAKE_CONFIGURABLE',
        label: '기관이 정할 수 있게 설정을 실제로 배선한다',
        effect:
          '만료 배치와 안내 문구가 설정값을 읽게 바꾼다. 🔴 안내 문구의 "3일" 문자열도 함께 바꿔야 한다 — ' +
          '한쪽만 고치면 화면이 말하는 기간과 실제 만료가 어긋난다.',
        enact: null,
      },
      {
        value: 'CHANGE_VALUE',
        label: '3일이 아닌 다른 기간이어야 한다',
        effect: '🔴 며칠인지와 그 근거를 함께 기록해야 한다. 코드 두 곳(만료 배치·안내 문구)을 같은 배포에서 바꾼다.',
        enact: null,
      },
    ],
    drillDown: '/admin/ai-settings',
    blocks: '원외 처방전 만료 판정 · 환자 안내 문구',
    statusQuo:
      '🔴 만료 배치가 **3일 고정**으로 돌고, 설정 카탈로그의 유효일수 키는 **소비처가 없다**. ' +
      '설정 화면은 "저장되나 쓰이지 않습니다"라고 정직하게 고지하고 있다 — ' +
      '즉 관리자가 값을 바꿔도 만료 시점은 그대로다.',
    opens: ['만료 기간의 근거가 남는다', '안 먹는 다이얼을 정리하거나 실제로 배선할 수 있다'],
    verifyHow: [
      "`grep -n 'threeDaysAgo' apps/api/src/modules/pharmacy/pharmacy.service.ts` — 만료 판정이 3일 고정",
      "`grep -rn '처방전 유효기간: 3일' apps/api/src` — 안내 문구도 문자열로 고정",
      '설정 화면(안 먹는 다이얼 고지 목록)에서 유효일수 항목의 경고 문구 확인',
    ],
    afterDecision:
      '🔴 어느 선택이든 **코드 변경이 남는다** — 다이얼을 내리든, 배선하든, 값을 바꾸든. ' +
      '이 화면의 기록만으로는 만료 기간이 바뀌지 않는다.',
    owner: '약제부 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  // ────────────────────────────────────────────────────────────────────────
  // 기관 정체성(2026-09-11 · 기획 hospital-identity-canon.plan.md) — 병원명 하드코딩 전수 실측에서 나온 사람 몫
  // ────────────────────────────────────────────────────────────────────────
  {
    key: 'identity.legalNameSplit',
    track: 'COUNTRY',
    title: '법정 서식에 찍을 기관명은 "등록 명칭"인가 "표시명"인가 (둘을 나눌 것인가)',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 발급 서식 11종이 설정을 **전혀 읽지 않고** 데모 상수(요양기관기호 `WRB-DEMO-0001`·사업자번호 `000-00-00000`·' +
      '대표자 `대표원장`·`(데모 주소)`)를 찍는다(2026-09-11 실측 · 운영 발급 11건). 고치려면 무엇을 찍을지가 먼저다 — ' +
      '지금 설정에는 `hospital.name`(표시명) 하나뿐이고, 개설 허가·요양기관 신고상의 **등록 명칭**을 담을 자리가 없다. ' +
      '표시명(간판·홈페이지)과 등록 명칭이 다른 기관이 흔하다.',
    legalReview: [
      '의료법 — 의료기관 명칭 표시 규정(개설 허가상 명칭과 표시 명칭)',
      '진단서 등 서식 규칙(의료법 시행규칙 서식) — 발급 기관명 기재 요건',
      '요양기관 현황 신고 명칭과 청구 서식의 일치(다르면 청구 반려·부당 표시 소지)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '개설자·원장 · 의무기록(HIM) 책임자',
    options: [
      { value: 'SPLIT', label: '나눈다 — 법정 서식은 등록 명칭(`hospital.legalName` 신설), 화면·안내는 표시명', effect: '서식 헤더·진위검증 응답·청구 서식이 등록 명칭을 찍는다. 설정 키 신설과 서식 11종 배선이 필요하다(개발). 등록 명칭이 미설정이면 서식이 "기관 등록 명칭 미설정"을 그대로 말한다(지어내지 않는다).', enact: null },
      { value: 'SINGLE', label: '나누지 않는다 — 표시명(`hospital.name`) 하나를 모든 곳에 쓴다', effect: '설정 키가 하나라 단순하다. 🔴 표시명이 등록 명칭과 다르면 **법정 서식에 등록되지 않은 이름**이 찍힌다 — 그 차이가 없다는 것을 이 선택이 함께 확정한다.', enact: null },
    ],
    drillDown: '/admin/ai-settings',
    blocks: '서식 11종의 데모 상수 제거(P1) · 진위검증 응답의 병원명 하드코딩 제거',
    statusQuo:
      '🔴 `/print/[issueNo]` 의 서식 11종(진단서·소견서·입퇴원확인서·사망진단서·출생증명서·처방전·검사결과지·기록사본·세부내역서·영수증·계약서)이 데모 상수를 찍는다. 서버 PDF(browserless)가 같은 페이지를 렌더하므로 **포털 다운로드·전자서명 경로도 같은 값**을 받는다. ' +
      '공개 진위검증 응답의 병원명도 코드에 박혀 있다.',
    opens: ['서식 11종을 설정에서 읽게 바꾸는 개발(P1)의 명세가 확정된다', '진위검증·청구 서식이 같은 명칭을 쓴다'],
    verifyHow: [
      '`apps/web/src/components/document/lib/hospitalProfile.ts` — `DEV_HOSPITAL_PROFILE` 상수와 그것을 import 하는 서식 수',
      '`/print/<발급번호>` 를 아무 발급 건으로 열어 헤더의 요양기관기호·사업자번호를 본다',
      '`SELECT key, value FROM system_configs WHERE key LIKE \'hospital.%\'` — 등록 명칭을 담을 키가 없다',
    ],
    afterDecision: '🔴 어느 쪽이든 **개발이 남는다** — 서식 11종 배선·(SPLIT 이면) 설정 키 신설. 기록만으로 서식은 바뀌지 않는다.',
    owner: '의무기록팀 · 원무팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'identity.documentSnapshot',
    track: 'CLINICAL',
    title: '발급된 서식의 기관 정보는 "발급 당시 값"을 보존하는가, 볼 때마다 "현재 값"을 읽는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 발급 원장 스냅샷에 **기관 정보가 없다**(2026-09-11 실측). 서식이 설정을 읽게 바뀌는 순간, 주소·대표자·명칭이 바뀌면 ' +
      '**이미 발급한 진단서의 재출력이 다른 기관 정보로 찍힌다** — 발급 사실이 사후에 바뀌는 셈이다. ' +
      '기존 발급 11건에는 발급 당시 값이 남아 있지 않으므로 어느 쪽을 골라도 그 11건은 "미보존"이다.',
    legalReview: [
      '의료법 — 진료기록·증명서 사본 발급 시 원본과의 동일성',
      '전자문서 및 전자거래 기본법 — 전자문서의 원본성(발급 후 내용 불변)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회',
    dependsOn: ['identity.legalNameSplit'],
    options: [
      { value: 'SNAPSHOT', label: '발급 당시 값을 스냅샷에 담아 재출력도 그 값으로 찍는다', effect: '발급 사실이 사후에 바뀌지 않는다. 발급 시 기관 정보를 원장에 함께 저장하는 개발이 필요하다. 🔴 기존 11건은 "발급 당시 기관정보 미보존"으로 표시한다(지금 값으로 채우지 않는다 — 소급하지 않는다).', enact: null },
      { value: 'CURRENT', label: '볼 때마다 현재 설정값을 읽는다', effect: '개발이 단순하다. 🔴 기관 정보가 바뀌면 과거 발급분의 재출력이 새 정보로 찍힌다 — 원본과 사본이 달라질 수 있음을 이 선택이 함께 받아들인다.', enact: null },
    ],
    drillDown: '/admin/decisions',
    blocks: '서식 설정 배선(P1)의 저장 구조',
    statusQuo: '🔴 발급 원장에 기관 정보 칸이 없다. 지금은 서식이 데모 상수를 찍어 문제가 가려져 있다 — 상수를 걷는 순간 이 결정이 필요해진다.',
    opens: ['P1 개발에서 발급 원장 스키마(스냅샷 필드) 여부가 확정된다'],
    verifyHow: [
      '`apps/api/src/modules/document/document.service.ts` 의 issue() — 스냅샷에 담기는 필드 목록',
      '운영 발급 건수: `SELECT count(*) FROM issued_documents`(표 이름은 스키마에서 확인)',
    ],
    afterDecision: '🔴 SNAPSHOT 이면 스키마 변경(`--schema` 배포)이 남는다. 어느 쪽이든 기존 11건은 소급 보정하지 않는다.',
    owner: '의무기록팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'identity.canonSource',
    track: 'COUNTRY',
    title: '기관 정체성(이름·주소·전화)의 정본은 어디인가 — 세 곳이 각자 들고 있다',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 같은 사실의 정본이 셋이다(2026-09-11 실측 · P12): ① `system_configs hospital.*`(설정) ② `organizations`(isSelf 행 — 전원·HIE 가 읽는다) ' +
      '③ CMS `GENERAL/directions` 의 연락처(포털 오시는 길이 읽는다). 여기에 코드 하드코딩이 **115파일**(한국어명 기준) 더 있다. ' +
      '영문명도 네 갈래로 갈라져 있다(`Weruby…`·`Weruby…`·`Weruby Weruby…`·설정값 `WERUBYHOSP (Weruby Weruby…)`).',
    legalReview: ['대외 교류(HIE·전원·청구)에 쓰는 기관 식별 정보의 일치 — 기관마다 다르게 보내면 대외 기록이 갈라진다'],
    approvalPath: 'CODE_CHANGE',
    authority: '전산위원회 · 경영기획',
    options: [
      { value: 'CONFIG', label: '설정(`hospital.*`)을 정본으로 — organizations·CMS 는 설정에서 파생', effect: '관리 화면(/admin/ai-settings 시스템 설정)에서 한 번 바꾸면 전부 따라온다. organizations isSelf 행·CMS 연락처는 동기화(또는 읽기 전환) 개발이 남는다.', enact: null },
      { value: 'ORGANIZATION', label: '`organizations` isSelf 행을 정본으로 — 설정은 거기서 파생', effect: '대외 교류(HIE·전원)가 이미 이 행을 읽으므로 대외 쪽이 안정적이다. 설정 화면·AI 프롬프트·서식이 이 행을 읽게 바꾸는 개발이 크다.', enact: null },
      { value: 'SPLIT_BY_USE', label: '용도별로 둔다 — 대외는 organizations, 화면·서식은 설정, 안내는 CMS', effect: '지금 구조를 인정한다. 🔴 셋이 갈라지는 것을 막는 **기계 대조 가드**가 대신 필요하다(값이 다르면 경보).', enact: null },
    ],
    drillDown: '/admin/ai-settings',
    blocks: '공개 기관 정체성 EP·`useHospitalIdentity()` 훅(P0)의 읽는 곳',
    statusQuo: '🔴 세 정본이 각자 값을 들고 있고 서로 대조하지 않는다. 운영 설정에는 이름·영문명·주소·전화 6키만 있고 요양기관기호·사업자번호·대표자는 **행이 없어 기본값(플레이스홀더)** 으로 떨어진다.',
    opens: ['P0 정본 접근자(서버 `getHospitalIdentity()`·공개 EP·웹 훅)의 출처가 확정된다', '하드코딩 115파일 회수의 기준점'],
    verifyHow: [
      '`SELECT key, value FROM system_configs WHERE key LIKE \'hospital.%\'`',
      '`SELECT code, name, phone FROM organizations WHERE is_self`(컬럼명은 스키마에서 확인)',
      '`/admin/config` 에서 hospital.* 의 출처 배지(설정됨/기본값)',
    ],
    afterDecision: '🔴 어느 쪽이든 **개발이 남는다** — 정본 접근자 신설과 하드코딩 회수. 기록은 방향을 정할 뿐이다.',
    owner: '경영기획 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'identity.foreignNames',
    track: 'COUNTRY',
    title: '공식 영문·일문·중문 기관명은 무엇인가 (기관이 확정해야 한다 — 시스템이 지어내지 않는다)',
    layer: 'LICENSE_HOLDER',
    why:
      '🔴 영문명이 코드와 설정에 **네 가지로** 흩어져 있다(2026-09-11 실측) — 번역 카탈로그(AI 초안)에도 `Weruby Hospital` 이 들어가 있다. ' +
      '영문 영수증·국제진료 화면·공개 사이트가 서로 다른 이름을 찍는다. 공식 외국어 명칭은 **기관이 정하는 사실**이지 번역이 아니다.',
    legalReview: ['외국인환자 유치 등록·해외 제휴 문서의 기관 영문 명칭과의 일치', '상표·도메인(hospital.example.org)과의 관계'],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 국제사업 책임자',
    options: [
      { value: 'CONFIRMED', label: '확정 명칭을 기록한다(영문 필수 · 일문/중문은 있으면)', effect: '관리 화면에서 `hospital.nameEn` 등에 확정 명칭을 넣고, 코드·카탈로그의 다른 표기를 회수하는 개발이 따른다. 일문·중문 키가 없으므로 필요하면 키 신설(개발)이 남는다.', enact: null },
      { value: 'KOREAN_ONLY', label: '외국어 공식 명칭을 두지 않는다 — 모든 언어에서 한국어명을 쓴다', effect: '지어낸 번역이 사라진다. 🔴 영문 영수증·국제진료 화면에 한국어명이 찍힌다(외국인 환자가 읽지 못할 수 있다).', enact: null },
    ],
    drillDown: '/admin/ai-settings',
    blocks: '영문 영수증·국제진료·공개 사이트의 기관명 회수',
    statusQuo: '🔴 영문명 4종이 화면마다 다르게 찍힌다. 설정값(`WERUBYHOSP (Weruby Hospital)`)을 읽는 곳과 코드 상수를 쓰는 곳이 섞여 있다.',
    opens: ['영문명 회수 개발의 기준값', '번역 카탈로그의 기관명 키를 보간(`<Tf>`)으로 빼는 작업'],
    verifyHow: [
      '`git grep -n "Weruby\\|Woori Deul"` — 표기 4종',
      '`SELECT value FROM system_configs WHERE key = \'hospital.nameEn\'`',
    ],
    afterDecision: '🔴 확정 명칭을 기록해도 **코드 상수·카탈로그 표기는 그대로다** — 회수 개발이 남는다(하드코딩 가드로 추적).',
    owner: '국제사업팀 · 홍보팀 · 전산팀',
    // 🔴 (2026-09-13) 종전 `dueBy: BEFORE_GO_LIVE` ↔ `goLive: CAN_FOLLOW` 가 서로 다른 말을 했다(등록부 61건 중 유일).
    //    판정: 개시에 걸리지 않는다 — 기획서 `hospital-identity-canon.plan.md` §4 에서 이 결정의 선행 대상은
    //    P3(HIS 화면 표기)뿐이고 P1 법정 서식(한국어)은 아니며, 선택지 KOREAN_ONLY 도 개시를 막지 않는다.
    //    그래서 goLive 가 맞고 dueBy 를 WITHIN_30D 로 맞췄다. 두 필드 일치는 `decision-golive-dueby-consistency.spec.ts` 가 지킨다.
    dueBy: 'WITHIN_30D',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'identity.unsetIssuance',
    track: 'CLINICAL',
    title: '기관 정보(등록 명칭·요양기관기호 등)가 미설정일 때 법정 서식 발급을 막는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 운영 설정에 요양기관기호·사업자번호·대표자 행이 **없다** — 기본값(플레이스홀더 `12345678` 등)으로 떨어진다(2026-09-11 실측). ' +
      '서식이 설정을 읽게 바뀌면 "미설정"이 드러나는데, 그때 발급을 막을지 경고만 할지가 정해져 있지 않다. ' +
      '막으면 개시 직후 진단서가 안 나가고, 막지 않으면 플레이스홀더가 찍힌 법정 서식이 나간다.',
    legalReview: ['의료법 — 진단서 등 교부 의무(정당한 사유 없는 거부 금지)', '허위 기재 서식 발급의 책임'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회 · 원무팀장',
    dependsOn: ['identity.legalNameSplit'],
    options: [
      { value: 'BLOCK_IN_REAL', label: '리얼 모드에서는 막는다(개발·리허설은 경고)', effect: '플레이스홀더가 찍힌 법정 서식이 실환자에게 나가지 않는다. 🔴 개시 전 기관 정보 입력이 go-live 필수 항목이 된다.', enact: null },
      { value: 'WARN', label: '막지 않고 서식에 "기관 정보 미설정"을 그대로 찍는다', effect: '발급 거부는 없다. 🔴 미설정 표기가 든 법정 서식이 나갈 수 있다 — 지어낸 값은 찍히지 않는다.', enact: null },
    ],
    drillDown: '/admin/go-live',
    blocks: 'P1 서식 배선의 미설정 처리',
    statusQuo: '🔴 지금은 서식이 설정을 읽지 않아 이 질문이 가려져 있다 — 데모 상수가 "설정된 것처럼" 찍힌다.',
    opens: ['go-live 에 기관 정보 항목을 둘지(BLOCK_IN_REAL 이면 필수)'],
    verifyHow: [
      '`SELECT key FROM system_configs WHERE key IN (\'hospital.code\', \'hospital.bizNo\', \'hospital.ceo\')` — 0행',
      '`/admin/config` 에서 해당 키의 출처 배지가 "기본값"',
    ],
    afterDecision: '🔴 어느 쪽이든 P1 개발에서 미설정 분기를 구현해야 한다. BLOCK_IN_REAL 이면 go-live 항목 등재가 함께 남는다.',
    owner: '의무기록팀 · 원무팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },

  // ── 첫 상용 패키지 릴리즈 — Phase 0 범위 선언(2026-09-13 · 기획 `docs/01-plan/features/commercial-release-v1-freeze.plan.md` §1) ──
  // 🔴 기획서의 S1~S7 표는 정본이 아니다 — 여기 등재돼 **고를 수 있는 모양**이어야 한다. S1 은 `country.institutionProfile`,
  //    S3 는 `policy.ai.clinicalFeatureScope` 가 이미 있어 새로 만들지 않았다(같은 사실에 결정이 둘이면 갈라진다).
  // 🔴 goLive 는 NOT_RELATED — 이 결정들이 막는 것은 **판매 산출물의 릴리즈 게이트(G1)** 이지 이 기관의 실서비스 개시가 아니다.
  //    개시 필수로 올리면 go-live 관제에 무관한 빨간 항목이 5개 늘어 진짜 경보가 묻힌다(AE 트랙 선례와 같은 판단).
  {
    key: 'release.deploymentForm',
    track: 'PLATFORM',
    title: '첫 상용 패키지는 고객이 직접 설치하는가, 우리가 운영을 대행하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 설치 재현성이 없다(2026-09-13 실측) — 운영 DB 에 `_prisma_migrations` 가 없고 스키마는 `db push` + 순서 불명 SQL 128개, ' +
      '약품 마스터는 수동 CSV 적재, 배포 원천은 로컬 working tree rsync 다. 고객 설치형이면 이것이 **판매 차단**이고, ' +
      '운영 대행이면 권장 과제로 내려간다. 어느 쪽인지 정해지지 않으면 릴리즈 게이트(G9)의 차단 여부가 정해지지 않는다.',
    legalReview: [
      '의료법 — 전자의무기록 보관·관리 주체(설치형이면 기관, 대행이면 위탁 관계)',
      '개인정보보호법 §26 — 운영 대행 시 처리위탁 계약·수탁자 감독',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '경영진 · 제품 책임자',
    options: [
      { value: 'ON_PREMISE', label: '고객 설치형(온프렘) — 고객 서버에 설치 패키지로 납품', effect: '빈 DB 설치 스크립트·migrate 이력·필수 마스터 동봉·고객 설치 가이드가 판매 차단 게이트가 된다(기획 T2·T8). 업그레이드 절차도 제품이 책임진다.', enact: null },
      { value: 'MANAGED', label: '운영 대행(단일 테넌트) — 우리가 기관별 서버를 운영', effect: '설치 재현성은 판매 차단에서 내려가고, 대신 처리위탁 계약·운영 책임 범위·기관별 격리가 먼저다. 지금의 단일 서버 배포 구조와 가깝다.', enact: null },
    ],
    drillDown: '/admin/decisions',
    blocks: '상용 릴리즈 게이트 G9(빈 DB 설치 리허설)의 차단 여부 · 트랙 T2 우선순위',
    statusQuo: '🔴 정해지지 않았다. 지금 시스템은 한 서버에서 한 가상 병원을 운영하는 구조이고, 다른 서버에 빈 상태로 설치해 본 기록이 없다.',
    opens: ['T2(설치 재현성)를 차단으로 할지 권장으로 할지 확정', '고객 설치 가이드(T8-1)와 운영 매뉴얼(T8-2) 중 무엇을 먼저 쓸지'],
    verifyHow: [
      '운영 DB: `SELECT to_regclass(\'_prisma_migrations\')` — NULL',
      '`infra/scripts/deploy.sh` 머리 주석 — "로컬 working tree → rsync → 서버 빌드 뿐"',
      '`ls apps/api/prisma/migrations` — 정식 마이그레이션 2개뿐',
    ],
    afterDecision: '🔴 기록은 방향만 정한다 — ON_PREMISE 면 migrate 기준선·설치 스크립트·마스터 매니페스트 개발이, MANAGED 면 위탁 계약·운영 책임 문서가 남는다.',
    owner: '제품 책임자 · 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'release.externalTransmitScope',
    track: 'BILLING',
    title: '첫 상용 패키지에 기관 전송(HIRA 청구·감염병 신고 등)을 포함하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 기관 전송 7종(KCDC·KONIS·HIRA 청구·HIE·KCCR·NIMS·KIDS)이 **전부 `implemented:false`** 다(2026-09-13 실측 · ' +
      '`outbound-channel.registry.ts`). 지금은 원내에 `LOCAL_RECORDED` 로 기록만 한다. 한국 병원 상용에서 청구 전송 미구축은 ' +
      '치명적일 수 있으나, 판매 범위를 "청구 파일 생성까지"로 선언하는 것도 사실에 맞는 선택이다.',
    legalReview: [
      '국민건강보험법 — 요양급여비용 청구 방식(전자청구 요건)',
      '감염병예방법 — 신고 의무 주체와 방법(시스템이 전송하지 않으면 기관이 다른 경로로 신고)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '경영진 · 제품 책임자 · 원무 책임자',
    options: [
      { value: 'INCLUDE_HIRA', label: 'HIRA 청구 전송까지 포함한다', effect: '청구 전송 구현·심평원 연계 인증이 판매 차단 게이트가 된다. 나머지 6종은 별도로 고른다.', enact: null },
      { value: 'LOCAL_ONLY', label: '원내 기록·파일 생성까지만 판매한다(전송은 기관이 다른 경로로)', effect: '구현 부담 없이 사실대로 판매한다. 🔴 판매 문서의 "알려진 제한"에 전송 미지원을 명시해야 하고, 화면은 이미 `LOCAL_RECORDED` 로 말한다.', enact: null },
    ],
    drillDown: '/admin/outbound-channels',
    blocks: '상용 릴리즈 게이트 G1 · 알려진 제한 §5-2 문안',
    statusQuo: '🔴 7종 전부 미구현이고 원내 기록만 남는다. 판매 범위에 전송이 들어가는지 정해지지 않아 판매 문서에 무엇을 적을지도 정해지지 않았다.',
    opens: ['전송 구현 트랙을 판매 전 과제로 둘지 확정', '알려진 제한 문안 확정'],
    verifyHow: [
      '`grep -n "implemented" apps/api/src/modules/outbound-channel/outbound-channel.registry.ts`',
      '`/admin/outbound-channels` — 채널별 구현/설정/승인 3조건 상태',
    ],
    afterDecision: '🔴 INCLUDE_HIRA 면 전송 구현·연계 인증이, LOCAL_ONLY 면 판매 문서의 제한 명시가 남는다. 어느 쪽이든 대외 발신 3조건(구현+설정 OFF 기본+승인)은 유지된다.',
    owner: '원무팀 · 제품 책임자 · 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'release.emrCertification',
    track: 'GOVERNANCE',
    title: '첫 상용 패키지를 전자의무기록 시스템 인증 제품으로 파는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 인증기준 대응 관제 화면(`/admin/emr-cert`)은 있지만 **실제 인증 취득 기록은 저장소에 없다**(2026-09-13 실측). ' +
      '인증 제품으로 판매하려면 인증 절차가 판매 전 과제가 되고, 비인증으로 판매하면 그 사실을 판매 문서가 말해야 한다.',
    legalReview: ['의료법 §23의2 — 전자의무기록시스템 인증(인증 표시·광고 제한)'],
    approvalPath: 'CODE_CHANGE',
    authority: '경영진 · 인증 담당 책임자',
    options: [
      { value: 'CERTIFIED', label: '인증 취득을 전제로 판매한다', effect: '인증기준 대응 항목의 실검증과 인증 신청이 판매 전 과제가 된다. 인증 전에는 "인증 제품"이라 표시하지 않는다.', enact: null },
      { value: 'UNCERTIFIED', label: '비인증 제품으로 판매한다', effect: '인증 절차 없이 판매한다. 🔴 판매 문서·화면이 인증 제품인 것처럼 말하지 않게 문안을 점검해야 한다.', enact: null },
    ],
    drillDown: '/admin/emr-cert',
    blocks: '상용 릴리즈 게이트 G1 · 판매 문서의 인증 표기',
    statusQuo: '🔴 관제 화면만 있고 인증 취득·신청 기록이 없다. 어느 쪽으로 팔지 정해지지 않았다.',
    opens: ['인증 대응 트랙을 판매 전 과제로 둘지 확정'],
    verifyHow: ['`/admin/emr-cert` — 인증기준 대응 관제(자가 점검)', '`git grep -n "인증번호\\|인증 취득" docs` — 취득 기록 부재 확인'],
    afterDecision: '🔴 CERTIFIED 면 인증기준 실검증·신청 준비가, UNCERTIFIED 면 문안 점검이 남는다.',
    owner: '제품 책임자 · 인증 대응팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'release.versionScheme',
    track: 'PLATFORM',
    title: '첫 상용 패키지의 버전 번호를 어떻게 매기는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 버전이 고정돼 있지 않다(2026-09-13 실측) — 화면·`/health` 는 `HIS_VERSION` v4.19.0 인데 `main` 은 그 뒤로 20커밋 이상 쌓였고, ' +
      '워크스페이스 `package.json` 6개가 1.0.0·1.5.0·0.1.0 으로 제각각이며, git 태그는 v3.46.0 에서 멈춰 있다. ' +
      '판매 산출물에 붙일 번호 체계가 정해져야 태그·CHANGELOG·릴리즈 노트를 고정할 수 있다.',
    legalReview: ['계약·납품 문서의 제품 버전 표기(유지보수 범위의 기준)'],
    approvalPath: 'CODE_CHANGE',
    authority: '제품 책임자 · 전산팀',
    options: [
      { value: 'CONTINUE_V5', label: '내부 릴리즈 번호를 잇는다 — 첫 상용은 v5.0.0', effect: '릴리즈 문서 108개·`HIS_VERSION` 체계와 이어진다. 내부 이력과 판매 버전이 한 줄로 읽힌다.', enact: null },
      { value: 'RESET_V1', label: '제품 번호를 새로 시작한다 — 첫 상용은 v1.0.0', effect: '고객에게는 첫 제품으로 읽힌다. 🔴 내부 릴리즈 문서(v4.x)와 번호가 끊기므로 대응표가 필요하다.', enact: null },
    ],
    drillDown: '/admin/decisions',
    blocks: '상용 릴리즈 게이트 G7(버전·태그·CHANGELOG 일치)',
    statusQuo: '표시 버전(HIS_VERSION)·패키지 버전·git 태그는 `scripts/sync-version.mjs`·`tag-releases.mjs` 로 맞춰져 있다(2026-10-12 v4.72.0 · 종전 서술 "서로 다르다"는 낡았다). 번호 체계(무엇을 올리면 주·부·수 번호인가)는 정해지지 않았다.',
    opens: ['`HIS_VERSION`·package.json·태그 동기화의 목표값', 'CHANGELOG 첫 절의 번호'],
    verifyHow: [
      '`grep -n "HIS_VERSION" packages/shared/src/constants.ts`',
      '`git tag --sort=-v:refname | head -3`',
      '각 워크스페이스 `package.json` 의 `version`',
    ],
    afterDecision: '🔴 기록 후 버전 동기 스크립트·태그·CHANGELOG 작업이 남는다(기획 T1).',
    owner: '제품 책임자 · 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'release.saleLanguages',
    track: 'I18N',
    title: '첫 상용 패키지를 어떤 화면 언어로 판매하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 UI 크롬 번역 14,060키가 **전량 AI 초안이고 사람 검수는 0** 이다(2026-09-13 실측 · 화면에 AI 초안 표식이 붙는다). ' +
      '영어를 판매 언어에 넣으면 검수가 판매 차단 과제가 되고, 한국어만 팔면 번역은 "참고용 초안"으로 남는다.',
    legalReview: ['인공지능기본법 §31 — AI 생성물 표기(초안 번역을 판매 언어로 제공할 때)', '의료기기·의약품 표시 관련 — 안전 문구의 오역 책임'],
    approvalPath: 'CODE_CHANGE',
    authority: '경영진 · 제품 책임자 · 의료질 책임자',
    options: [
      { value: 'KO_ONLY', label: '한국어만 판매 언어로 한다(다른 언어는 AI 초안 미리보기)', effect: '검수 없이 판매할 수 있다. 🔴 다른 언어를 고르면 AI 초안이라는 사실을 계속 화면이 말해야 한다(지금 표식 유지).', enact: null },
      { value: 'KO_EN', label: '한국어와 영어를 판매 언어로 한다', effect: '영어 사람 검수(최소 안전 축·임상 판정문)가 판매 차단 과제가 된다. 태블릿 안전 문구 결정(`i18n.safetyStringTranslation`)도 함께 필요하다.', enact: null },
    ],
    drillDown: '/admin/ui-locale',
    blocks: '상용 릴리즈 게이트 G1 · 알려진 제한 §5-1 문안',
    statusQuo: '🔴 전 언어 검수 0. 판매 언어가 정해지지 않아 검수를 판매 전 과제로 둘지 정해지지 않았다.',
    opens: ['검수 범위와 검수자 지정(`/admin/ui-locale`) 착수 여부'],
    verifyHow: ['`/admin/ui-locale` — 언어별 커버리지와 검수 수', '`/admin/ui-locale/review` — 검수 큐'],
    afterDecision: '🔴 KO_EN 이면 검수자 지정·검수 작업이, KO_ONLY 면 판매 문서의 제한 명시가 남는다.',
    owner: '제품 책임자 · 의료질팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  // 증분 A(2026-09-15) — 기획서 전체 검토·세션 산출 사람 결정 D01~D17
  ...DECISION_BATCH_2026_09_A,
  // 2026-09 등재 갈래 B(초안 D18~D34) — 문서에만 있던 결정을 화면에서 고를 수 있게
  ...DECISION_BATCH_2026_09_B,
  // 🔴 배치 등재(2026-09-15) — 기획서 전체 검토 초안·세션 신규. 배치 파일은 이 파일의 타입만 import 한다(순환 없음).
  ...DECISION_BATCH_2026_09_C,
  // 2026-09-15 등재 갈래 D — DTO 배치가 막지 않고 기록한 절차 우회(9건 → 3결정)
  ...DECISION_BATCH_2026_09_D,
  // 2026-09-15 등재 갈래 E — DTO 5차 배치(B5)가 막지 않고 기록한 절차 우회(4건 → 2결정)
  ...DECISION_BATCH_2026_09_E,
  // 2026-09-23 등재 갈래 F — 운영 모드·시드 축에서 코드로 닫을 수 없던 3건(시드 기본 기능·리허설 ERP 조회·전환 시 아웃박스 대기 건)
  ...DECISION_BATCH_2026_09_F,
  ...DECISION_BATCH_2026_09_G,
  // 2026-09-28 등재 갈래 H — 재시도·멱등 축 재판정(워크트리 a13360)에서 코드로 닫을 수 없던 2건
  ...DECISION_BATCH_2026_09_H,
  ...DECISION_BATCH_2026_09_I,
  ...DECISION_BATCH_2026_09_J,
  ...DECISION_BATCH_2026_09_K,
  ...DECISION_BATCH_2026_09_L,
  ...DECISION_BATCH_2026_09_M,
  ...DECISION_BATCH_2026_09_N,
  ...DECISION_BATCH_2026_09_O,
  ...DECISION_BATCH_2026_09_P,
  ...DECISION_BATCH_2026_09_Q,
  ...DECISION_BATCH_2026_09_R,
  ...DECISION_BATCH_2026_09_S,
  ...DECISION_BATCH_2026_10_A,
  // 2026-10-01 등재 갈래 10-B — 문서에만 있던 사람 결정 4건(직원 유휴 만료·판독의 원천·결재 미전달 과거분·LIS 패널 EDI 매핑)
  ...DECISION_BATCH_2026_10_B,
  ...DECISION_BATCH_2026_10_C,
  ...DECISION_BATCH_2026_10_D,
  // 2026-10-09 무선 AP 위치 — 수집(허가권자)·동의 방식·교정 정책
  ...DECISION_BATCH_2026_10_E,
  ...DECISION_BATCH_2026_10_F,
  ...DECISION_BATCH_2026_10_G,
  ...DECISION_BATCH_2026_10_H,
  ...DECISION_BATCH_2026_10_I,
  ...DECISION_BATCH_2026_10_J,
  ...DECISION_BATCH_2026_10_K,
  ...DECISION_BATCH_2026_10_L,
];
