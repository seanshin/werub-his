import type { AlertDef } from './alert-registry';

/**
 * 경보 승인 판정(2026-10-09) — 승인은 **그 당시 값**(tier·대상·억제 창·채널)에 대한 것이다.
 * 코드가 그 값을 바꾸면 승인은 더 이상 지금 경보를 가리키지 않는다 → CHANGED(재승인 필요).
 */
export type AlertApprovalStatus = 'UNAPPROVED' | 'APPROVED' | 'CHANGED';

export function alertSnapshot(d: AlertDef) {
  return {
    tier: d.tier,
    targetKind: d.targetKind,
    targetRoles: [...d.targetRoles].sort(),
    fallbackKind: d.fallbackKind ?? null,
    dedupHours: d.dedupHours,
    channel: d.channel ?? 'STAFF',
  };
}

/** 키 순서와 무관한 비교 */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function alertApprovalStatus(d: AlertDef, latest: { snapshot: unknown; revokedAt: Date | null } | null | undefined): AlertApprovalStatus {
  if (!latest || latest.revokedAt) return 'UNAPPROVED';
  return canon(latest.snapshot) === canon(alertSnapshot(d)) ? 'APPROVED' : 'CHANGED';
}
