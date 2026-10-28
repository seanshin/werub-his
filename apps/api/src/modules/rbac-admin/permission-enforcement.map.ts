/**
 * 권한 → **실제 집행점** 대조표 — 🔴 자동 생성(손으로 적지 않는다).
 *
 * 갱신: `UPDATE_ENFORCEMENT_MAP=1 npx vitest run test/rbac` (apps/api)
 * 검증: `test/rbac/permission-enforcement.spec.ts` 가 소스를 재스캔해 mode 를 대조한다.
 *
 * 🔴 원 결함(W8/A1): 역할×권한 매트릭스가 실제 가드와 어긋난 채, 화면은 그 사실을 말하지
 *    않고 토글만 보여줬다 — **켜도 꺼도 아무 API 도 달라지지 않는 권한**이 섞여 있었다.
 *    권한 관리 화면이 자기 자신에 대해 P17(근거 없이 안심시킴)을 저지른 셈이다.
 *    `/admin/rbac` 는 이 표를 그대로 읽어 "이 항목은 집행되지 않습니다"를 말한다.
 *
 * mode:
 *  - matrix      : `@RequirePermission`/`hasPermission` — 이 매트릭스가 실제 판정에 쓰인다
 *  - other-guard : 다른 가드가 판정한다(CredentialGuard=ADMIN∪per-user grant∪기능접근 매트릭스)
 *                  → **이 화면의 토글은 무효**
 *  - none        : 집행점 없음 — 토글해도 달라지는 API 가 없다
 */
export type EnforcementMode = 'matrix' | 'other-guard' | 'none';

export interface EnforcementEntry {
  mode: EnforcementMode;
  /** 집행점 개수(데코레이터/검사 호출 수) */
  count: number;
  /** 집행점이 있는 파일(apps/api/src 기준) */
  files: string[];
}

export const PERMISSION_ENFORCEMENT: Record<string, EnforcementEntry> = {
  'patient:view': { mode: 'matrix', count: 76, files: ['modules/admission/admission.controller.ts', 'modules/bed/bed.controller.ts', 'modules/checkup/checkup-protocol.controller.ts', 'modules/checkup/checkup.controller.ts', 'modules/emergency/emergency.controller.ts', 'modules/imaging/imaging.controller.ts', 'modules/infection-control/infection-control.controller.ts', 'modules/insurance-claim/insurance-claim.controller.ts', 'modules/lab/lab.controller.ts', 'modules/patient/patient.controller.ts', 'modules/workstation/workstation.controller.ts'] },
  'patient:view:contact': { mode: 'matrix', count: 3, files: ['modules/patient/patient.controller.ts'] },
  'patient:view:identity': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:create': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:edit': { mode: 'matrix', count: 15, files: ['modules/bed/bed.controller.ts', 'modules/checkup/checkup.controller.ts', 'modules/patient/patient.controller.ts'] },
  'patient:relation:edit': { mode: 'matrix', count: 5, files: ['modules/patient/patient.controller.ts'] },
  'patient:deceased': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:delete': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:merge': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:import': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'patient:export': { mode: 'matrix', count: 1, files: ['modules/patient/patient.controller.ts'] },
  'prescription:view': { mode: 'matrix', count: 3, files: ['modules/medical-terminology/medical-terminology.controller.ts'] },
  'prescription:create': { mode: 'none', count: 0, files: [] },
  'prescription:edit': { mode: 'none', count: 0, files: [] },
  'prescription:delete': { mode: 'none', count: 0, files: [] },
  'order:view': { mode: 'matrix', count: 34, files: ['modules/imaging/imaging.controller.ts', 'modules/lab/lab.controller.ts', 'modules/order-sign-log/order-sign-log.controller.ts', 'modules/pharmacy/pharmacy.controller.ts', 'modules/workstation/workstation.controller.ts'] },
  'order:create': { mode: 'matrix', count: 1, files: ['modules/workstation/workstation.controller.ts'] },
  'order:edit': { mode: 'matrix', count: 36, files: ['modules/imaging/imaging.controller.ts', 'modules/lab/lab.controller.ts', 'modules/pharmacy/pharmacy.controller.ts', 'modules/workstation/workstation.controller.ts'] },
  'order:delete': { mode: 'none', count: 0, files: [] },
  'billing:view': { mode: 'matrix', count: 2, files: ['modules/insurance-claim/insurance-claim.controller.ts'] },
  'billing:create': { mode: 'none', count: 0, files: [] },
  'billing:edit': { mode: 'matrix', count: 5, files: ['modules/insurance-claim/insurance-claim.controller.ts'] },
  'billing:delete': { mode: 'none', count: 0, files: [] },
  'encounter:view': { mode: 'none', count: 0, files: [] },
  'encounter:create': { mode: 'matrix', count: 5, files: ['modules/checkup/checkup.controller.ts', 'modules/workstation/workstation.controller.ts'] },
  'encounter:edit': { mode: 'matrix', count: 32, files: ['modules/admission/admission.controller.ts', 'modules/checkup/checkup.controller.ts', 'modules/emergency/emergency.controller.ts', 'modules/infection-control/infection-control.controller.ts'] },
  'encounter:delete': { mode: 'none', count: 0, files: [] },
  'user:view': { mode: 'none', count: 0, files: [] },
  'user:create': { mode: 'none', count: 0, files: [] },
  'user:edit': { mode: 'none', count: 0, files: [] },
  'user:delete': { mode: 'none', count: 0, files: [] },
  'audit:view': { mode: 'matrix', count: 7, files: ['modules/infection-control/infection-control.controller.ts', 'modules/order-sign-log/order-sign-log.controller.ts'] },
  'audit:export': { mode: 'none', count: 0, files: [] },
  'system:manage': { mode: 'matrix', count: 21, files: ['modules/checkup/checkup-protocol.controller.ts', 'modules/checkup/checkup.controller.ts', 'modules/order-sign-log/order-sign-log.controller.ts'] },
  'code:manage': { mode: 'matrix', count: 12, files: ['modules/medical-terminology/medical-terminology.controller.ts'] },
  'dashboard:view': { mode: 'matrix', count: 27, files: ['modules/checkup/checkup.controller.ts', 'modules/dashboard/dashboard.controller.ts', 'modules/emergency/emergency.controller.ts', 'modules/operational-stats/operational-stats.controller.ts'] },
  'pacs:study:view': { mode: 'matrix', count: 4, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:report:view': { mode: 'matrix', count: 3, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:report:create': { mode: 'matrix', count: 2, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:report:sign': { mode: 'matrix', count: 1, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:viewer:access': { mode: 'matrix', count: 1, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:worklist:manage': { mode: 'matrix', count: 1, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:order:create': { mode: 'matrix', count: 1, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:ai:inference': { mode: 'matrix', count: 1, files: ['modules/pacs-proxy/pacs-proxy.controller.ts'] },
  'pacs:admin': { mode: 'none', count: 0, files: [] },
  'cred:device:manage': { mode: 'other-guard', count: 3, files: ['modules/credential-admin/device.controller.ts', 'modules/credential-admin/lifecycle-admin.controller.ts', 'modules/credential-admin/staff360.controller.ts'] },
  'cred:cert:issue': { mode: 'other-guard', count: 5, files: ['modules/credential-admin/cert-admin.controller.ts'] },
  'cred:cert:revoke': { mode: 'other-guard', count: 2, files: ['modules/credential-admin/cert-admin.controller.ts', 'modules/credential-admin/lifecycle-admin.controller.ts'] },
  'cred:recovery:approve': { mode: 'other-guard', count: 1, files: ['modules/credential-admin/recovery-queue.controller.ts'] },
  'cred:policy:manage': { mode: 'other-guard', count: 5, files: ['modules/credential-admin/approval.controller.ts', 'modules/credential-admin/bulk.controller.ts', 'modules/credential-admin/grant.controller.ts', 'modules/credential-admin/policy.controller.ts'] },
  'cred:audit:read': { mode: 'other-guard', count: 8, files: ['modules/credential-admin/approval.controller.ts', 'modules/credential-admin/cert-admin.controller.ts', 'modules/credential-admin/staff360.controller.ts'] },
  'terminal:manage': { mode: 'matrix', count: 2, files: ['modules/terminal/terminal.controller.ts'] },
  'terminal:override': { mode: 'matrix', count: 1, files: ['modules/terminal/terminal.controller.ts'] },
  'terminal:kill': { mode: 'matrix', count: 1, files: ['modules/terminal/terminal.controller.ts'] },
  'retention:manage': { mode: 'matrix', count: 1, files: ['modules/retention/retention.controller.ts'] },
  'staff:exposure:report': { mode: 'matrix', count: 3, files: ['modules/infection-control/infection-control.controller.ts'] },
  'staff:exposure:manage': { mode: 'matrix', count: 2, files: ['modules/infection-control/infection-control.controller.ts'] },
  'qi:measure:write': { mode: 'matrix', count: 2, files: ['modules/quality/quality.controller.ts'] },
  'qi:measure:void': { mode: 'matrix', count: 1, files: ['modules/quality/quality.controller.ts'] },
  'safety:incident:report': { mode: 'matrix', count: 3, files: ['modules/patient-safety/patient-safety.controller.ts'] },
  'safety:incident:review': { mode: 'matrix', count: 8, files: ['modules/patient-safety/patient-safety.controller.ts'] },
  'checkup:manage': { mode: 'matrix', count: 15, files: ['modules/checkup/checkup.controller.ts'] },
  'checkup:followup:complete': { mode: 'matrix', count: 1, files: ['modules/checkup/checkup.controller.ts'] },
};

/** 이 매트릭스가 판정하지 않는 권한(토글 무효) — 화면이 그대로 표기한다 */
export function ineffectivePermissions(): string[] {
  return Object.entries(PERMISSION_ENFORCEMENT).filter(([, e]) => e.mode !== 'matrix').map(([k]) => k);
}
