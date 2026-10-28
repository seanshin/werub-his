import { isSpecialChoice } from '@hospital-run/shared';
import type { DecisionDef } from './decision.registry';

/**
 * 위원회 의결 → 결정 등록부 기록(2026-10-11).
 *
 * 🔴 발단(실측): 등록부에서 올라간 안건을 위원회가 의결해도 등록부에는 아무것도 남지 않았다.
 *    결정 화면은 그 결정을 계속 "④ 의결 — 아직 기록 안 됨"으로 그렸고, 사람이 의결 번호를 들고
 *    결정 화면에 **같은 결정을 다시 입력**해야 했다(그 순간 정본이 둘이 된다 — 의결은 B안, 입력은 A안일 수 있다).
 *    게다가 결정 화면에서 기록해도 위원회 몫은 집행하지 않으므로, 의결로 생긴 집행 액션(위원회 결정 소속)을
 *    결정 화면이 읽지 못해 ⑥ 집행에 영영 닿지 않았다.
 *
 * 이제 의결이 곧 기록이다 — 고른 선택지 · 의결 번호 · 위원회를 그대로 옮긴다(다시 묻지 않는다).
 * 🔴 수정 의결·선택지 밖 의결은 옮기지 않는다 — 등록부 선택지에 없는 것을 등록부 결정으로 만들면 지어낸 것이다.
 */
export interface CommitteeDecisionLink {
  id: string;
  decisionNo: string;
  committeeCode: string | null;
  committeeName: string;
}

export function committeeResolutionRecord(input: {
  def: DecisionDef;
  chosenValue: string | null | undefined;
  note?: string;
  decision: CommitteeDecisionLink;
  recorderId: string | null;
  at: Date;
}): { ok: true; record: Record<string, unknown> } | { ok: false; reason: 'NO_CHOICE' | 'SPECIAL_CHOICE' | 'NOT_AN_OPTION' } {
  const v = input.chosenValue;
  if (!v) return { ok: false, reason: 'NO_CHOICE' };
  if (isSpecialChoice(v)) return { ok: false, reason: 'SPECIAL_CHOICE' };
  if (!input.def.options.some((o) => o.value === v)) return { ok: false, reason: 'NOT_AN_OPTION' };
  const c = input.decision;
  return {
    ok: true,
    record: {
      choice: v,
      // 근거 = 의결 번호 그 자체(GOV-…) · 권한 = 의결한 위원회 — 문장을 조립하지 않는다
      legalReviewRef: c.decisionNo,
      authorityClaim: c.committeeCode ? `${c.committeeName}(${c.committeeCode})` : c.committeeName,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      // 🔴 기록한 사람(의결을 입력한 계정) — 의결한 사람이 아니다. 의결 주체는 위원회다
      decidedByUserId: input.recorderId ?? 'system:committee-resolution',
      decidedAt: input.at.toISOString(),
      // 🔴 집행은 의결 집행 원장(위원회 결정 소속 액션)이 한다 — 여기서 "반영됨"이라 말하지 않는다
      applied: false,
      appliedDetail: '위원회 의결 — 집행 상태는 의결 집행 원장을 따른다',
      committeeDecision: c,
    },
  };
}
