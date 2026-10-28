/** DUR 강제 게이트 판정(순수) — 차단 여부. */
export function durGateDecision(params: { hasWarnings: boolean; overridden: boolean; overrideReason?: string; gateEnforced: boolean }): 'PASS' | 'RECORD_OVERRIDE' | 'BLOCK' {
  if (!params.hasWarnings || params.overridden) return 'PASS';
  if (params.overrideReason && params.overrideReason.trim()) return 'RECORD_OVERRIDE';
  return params.gateEnforced ? 'BLOCK' : 'PASS';
}
