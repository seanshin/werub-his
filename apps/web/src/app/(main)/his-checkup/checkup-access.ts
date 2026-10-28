'use client';

import { useHasPermission } from '@/lib/permissions';

/**
 * 검진 **방문 생애주기 쓰기**(예약 등록·접수·상태 전이·추적관리 완료)를 화면이 그릴지 판정하는 정본
 * (2026-09-17 · 갈래 L3).
 *
 * ── 왜 여기 있나 ─────────────────────────────────────────────────────────────
 * 🔴 서버는 이 쓰기들을 `@RequirePermission(PATIENT_EDIT, CHECKUP_MANAGE)` 로 막는다.
 *    `RequirePermission` 은 **OR**(`hasAnyPermission`)이고, 두 권한의 보유자는
 *    ADMIN·NURSE·RECEPTIONIST(`patient:edit`)와 ADMIN·CHECKUP(`checkup:manage`)이다.
 *    **의사는 둘 다 없다** — `PATIENT_EDIT` 는 "인적정보 수정(원무 성격)"이라 2026-08 에
 *    의사에게서 명시적으로 뺐고, `CHECKUP_MANAGE` 는 검진 데스크(CHECKUP)를 위해 신설한 권한이다.
 *
 * 🔴 그런데 nav 는 `/his-checkup/{schedule,waiting,follow-ups}` 를 `[...CLINICAL, 'CHECKUP']`,
 *    즉 **의사에게도** 열어 둔다(검진 예약·진행 현황을 보는 것은 진료 업무다). 화면이 쓰기 버튼까지
 *    그대로 그려서, 의사가 '예약 등록'·'접수'·'상태 전이'·'추적 완료'를 누르면 매번 403 이었다.
 *    조회는 그대로 두고 **쓰기 버튼만** 감춘다 — 서버 권한을 넓히지 않는다(권한 정본은 서버다).
 *
 * 🔴 역할이 아니라 **권한으로** 판정한다. `/admin/rbac` 오버라이드가 권한을 넓히는 방향으로
 *    작동하므로(코드 기본값을 이긴다), 역할 목록을 화면에 사본으로 적으면 갈라진다.
 */
export const CHECKUP_VISIT_WRITE_PERMISSIONS = ['patient:edit', 'checkup:manage'] as const;

export function useCanManageCheckupVisit(): boolean {
  const byPatientEdit = useHasPermission(CHECKUP_VISIT_WRITE_PERMISSIONS[0]);
  const byCheckupManage = useHasPermission(CHECKUP_VISIT_WRITE_PERMISSIONS[1]);
  return byPatientEdit || byCheckupManage;
}

/** 쓰기 UI 를 숨긴 자리에 **왜 없는지**를 말한다 — 빈 자리는 "기능이 없다"로 읽힌다 */
export const CHECKUP_WRITE_NOTICE =
  '검진 예약·접수·상태 변경은 검진 데스크(원무·검진) 권한입니다 — 이 계정에서는 조회만 가능합니다.';
