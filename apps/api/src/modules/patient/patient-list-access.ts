/**
 * 🔴 환자 목록 능력표 — 순수 로직(2026-10-20 환자 목록 세련화 P0 · `patients-list-refinement-2026-10.plan.md` A1).
 *
 * 종전엔 화면이 역할 권한을 **세 곳**에서 따로 정했다 — 화면 로컬 표 · 역할 데이터 접근 설정(실패는 삼킴) · 서버 RBAC.
 * 그래서 의사 배너는 "연락처 마스킹"이라 말했지만 서버는 원문을 보냈고(화면이 열만 숨김), 등록 권한이 있는 간호사·의사에겐
 * 등록 버튼이 없었다. 이제 서버가 능력을 정하고 **응답도 그 능력대로 가린다** — 화면은 받아서 그리기만 한다.
 *
 * 규칙:
 *  - 기준은 RBAC(`Permission`) — 새 정본을 만들지 않는다.
 *  - 역할 데이터 접근 설정(`access.role.*`)은 **좁히기만** 한다(연락처·등록). 넓히는 값은 무시한다.
 *    좁히기는 **목록·스마트 목록 응답**에 적용된다 — 환자 상세는 RBAC 그대로(그 사실을 `narrowing.scope` 로 밝힌다).
 *  - 범위: 역할별 환자 범위 제한은 없다(`scope = 'ALL'`) — 거는 것은 사람 결정(`patient.listScopeByRole` 예정).
 *  - 보험 '유형'은 민감정보가 아니다(`patient-field-mask` 원칙) — 목록에 남긴다. 보험 '번호'는 신원 권한.
 */
import { canReadAllergyStatus } from '@hospital-run/shared';
import { maskListItem } from './patient-field-mask';
import { STALE_DRAFT_DAYS } from './patient-list-enrich';

export interface ListRbac {
  contact: boolean;
  identity: boolean;
  create: boolean;
  import: boolean;
  merge: boolean;
  export: boolean;
}

export interface ListAccess {
  /** 역할별 범위 제한 없음 — 등록된 전체 환자 */
  scope: 'ALL';
  /** 목록 응답의 전화번호 — FULL=원문 · MASKED=`010-****-5678` */
  contact: 'FULL' | 'MASKED';
  /** MASKED 의 이유 — RBAC 에 연락처 권한이 없음 / 역할 데이터 접근 설정이 좁힘 */
  contactReason: 'RBAC' | 'SETTING' | null;
  identity: boolean;
  /** 전화번호로 찾기 — 연락처를 원문으로 받는 경우만(가려진 번호로 찾으면 "이 번호의 환자가 있다"가 드러난다) */
  phoneSearch: boolean;
  canRegister: boolean;
  canImport: boolean;
  canMerge: boolean;
  canExport: boolean;
  /** 중복 검토·데이터 품질 — 서버 EP 가 관리자 전용(@Roles ADMIN) */
  canReviewDuplicates: boolean;
  canViewQuality: boolean;
  /** 목록 알레르기 확인 상태 칸 — 단건 조회와 같은 역할 정본(ALLERGY_STATUS_ROLES) · 아니면 응답에 칸이 없다 */
  allergyStatus: boolean;
  /** "내 환자" 범위 필터 — 진료·담당 입원·예약이 의사에게 묶여 있어 의사만(다른 직종은 묶는 원장이 없다) */
  myScope: boolean;
  /**
   * 오래된 작성 중 기록 신호(P4 B6) — MINE = 의사 본인이 작성한 것만 · ALL = 관리자(수만) · null = 칸 없음.
   * 작성 중 기록은 서명 전 미완결 기록이라 작성자 본인이 할 일이다 — 다른 직종에게 남의 미서명 수를 보이지 않는다.
   */
  staleDrafts: 'MINE' | 'ALL' | null;
  /** "오래됐다"의 기준(일) — 화면이 숫자를 박지 않게 서버가 함께 준다 */
  staleDraftDays: number;
  /** 역할 데이터 접근 설정이 실제로 좁힌 항목(없으면 null) */
  narrowing: { source: string; fields: Array<'showPhone' | 'canRegister'>; scope: 'LIST' } | null;
}

export function resolveListAccess(
  rbac: ListRbac,
  role: string,
  narrow: { values: Record<string, boolean>; source: string } | null,
): ListAccess {
  const fields: Array<'showPhone' | 'canRegister'> = [];
  let contact = rbac.contact;
  if (contact && narrow?.values.showPhone === false) { contact = false; fields.push('showPhone'); }
  let canRegister = rbac.create;
  if (canRegister && narrow?.values.canRegister === false) { canRegister = false; fields.push('canRegister'); }
  const isAdmin = role === 'ADMIN';
  return {
    scope: 'ALL',
    contact: contact ? 'FULL' : 'MASKED',
    contactReason: contact ? null : rbac.contact ? 'SETTING' : 'RBAC',
    identity: rbac.identity,
    phoneSearch: contact,
    canRegister,
    canImport: rbac.import,
    canMerge: rbac.merge,
    canExport: rbac.export,
    canReviewDuplicates: isAdmin,
    canViewQuality: isAdmin,
    allergyStatus: canReadAllergyStatus(role),
    myScope: role === 'DOCTOR',
    staleDrafts: role === 'DOCTOR' ? 'MINE' : isAdmin ? 'ALL' : null,
    staleDraftDays: STALE_DRAFT_DAYS,
    narrowing: fields.length && narrow ? { source: narrow.source, fields, scope: 'LIST' } : null,
  };
}

/** 목록 항목을 능력표대로 가린다 — 화면이 열을 숨기는 것에 기대지 않는다 */
export function maskForListAccess<T extends Record<string, unknown>>(item: T, a: ListAccess): T {
  return maskListItem(item, { contact: a.contact === 'FULL', identity: a.identity });
}

/** 숫자·하이픈·공백·+ 로만 된 3자 이상 — 전화번호를 찾으려는 입력으로 본다 */
export function looksLikePhoneQuery(q: string | null | undefined): boolean {
  if (!q) return false;
  const t = q.trim();
  return /^[\d\-\s+]+$/.test(t) && t.replace(/\D/g, '').length >= 3;
}
