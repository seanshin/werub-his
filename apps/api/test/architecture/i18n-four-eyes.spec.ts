import { describe, it, expect } from 'vitest';
import { TranslationOverrideStatus } from '@prisma/client';
import { emptyState, makeService, overrideRow, realTranslatedKey } from './i18n-review-fixture';

/**
 * 🔴 **4-eyes — 제안자 = 승인자면 그 사실이 응답·전이 원장·목록에 남는다**
 *    (정본 `i18n-human-review.plan.md` §2.3 · §4).
 *
 * 🔴 **막지 않는다**는 것이 이 설계의 핵심이다: 검수자가 한 명인 언어에서 자기 승인을 막으면
 *    아무것도 승인할 수 없고, 그러면 두 번째 계정으로 우회한다(이 저장소의 "막으면 방치된다").
 *    봉쇄가 아니라 **기록과 가시화**가 답이다 — 그래서 가드는 "막혔는가"가 아니라
 *    **"사실이 남았는가"** 를 본다. 남지 않으면 화면은 4-eyes 를 지킨 것처럼 보인다(P17).
 */
const LOCALE = 'en';

function stateWithProposal(proposedBy: string | null) {
  const { key } = realTranslatedKey(LOCALE);
  return {
    key,
    state: emptyState({
      reviewersConfig: { [LOCALE]: ['reviewer-1', 'reviewer-2'] },
      overrides: [
        overrideRow({
          id: '00000000-0000-4000-9000-000000000001',
          locale: LOCALE,
          key,
          status: TranslationOverrideStatus.PROPOSED,
          proposedBy,
          note: '제안자가 적은 근거',
        }),
      ],
    }),
  };
}

describe('🔴 4-eyes — 자기 승인을 막지 않고 드러낸다', () => {
  it('제안자 = 승인자면 응답이 그 사실을 말한다', async () => {
    const { state } = stateWithProposal('reviewer-1');
    const svc = makeService(state);
    const r = await svc.decide({ id: 'reviewer-1', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'APPROVED', '내가 직접 확인함');
    expect(r.status).toBe(TranslationOverrideStatus.APPROVED); // 막지 않는다
    expect(r.fourEyes.selfApproved).toBe(true);
    expect(r.fourEyes.satisfied).toBe(false);
    expect(r.fourEyes.message).toContain('제안자와 승인자가 같습니다');
  });

  it('그 사실이 전이 원장(append-only)에도 남는다 — 응답만 말하면 나중에 셀 수 없다', async () => {
    const { state } = stateWithProposal('reviewer-1');
    await makeService(state).decide({ id: 'reviewer-1', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'APPROVED', '사유');
    const tr = state.transitions.at(-1)!;
    expect(tr.toStatus).toBe(TranslationOverrideStatus.APPROVED);
    expect(tr.actorId).toBe('reviewer-1');
    expect(tr.reason).toContain('[SELF_REVIEW]');
    expect(tr.reason).toContain('사유'); // 사람이 적은 사유를 지우지 않는다
  });

  it('목록도 selfApproved 를 그대로 싣는다(화면이 배지를 그릴 수 있게)', async () => {
    const { key, state } = stateWithProposal('reviewer-1');
    await makeService(state).decide({ id: 'reviewer-1', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'APPROVED');
    const row = (await makeService(state).review({ id: 'reviewer-2', role: 'DOCTOR' }, { locale: LOCALE, q: key })).rows.find((r) => r.key === key)!;
    expect(row.selfApproved).toBe(true);
  });

  it('대조군 — 제안자와 승인자가 다르면 자기 승인이라 말하지 않는다', async () => {
    const { key, state } = stateWithProposal('reviewer-1');
    const r = await makeService(state).decide({ id: 'reviewer-2', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'APPROVED', '검토함');
    expect(r.fourEyes.selfApproved).toBe(false);
    expect(r.fourEyes.satisfied).toBe(true);
    expect(state.transitions.at(-1)!.reason).not.toContain('[SELF_REVIEW]');
    const row = (await makeService(state).review({ id: 'reviewer-2', role: 'DOCTOR' }, { locale: LOCALE, q: key })).rows.find((r2) => r2.key === key)!;
    expect(row.selfApproved).toBe(false);
  });

  it('제안자를 모르면(익명 제안) 자기 승인이라 단정하지 않는다', async () => {
    const { state } = stateWithProposal(null);
    const r = await makeService(state).decide({ id: 'reviewer-1', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'APPROVED');
    expect(r.fourEyes.selfApproved).toBe(false);
  });

  it('🔴 승인·반려 사유가 제안자의 근거를 덮지 않는다(되돌릴 수 없는 소실)', async () => {
    const { key, state } = stateWithProposal('reviewer-1');
    await makeService(state).decide({ id: 'reviewer-2', role: 'DOCTOR' }, '00000000-0000-4000-9000-000000000001', 'REJECTED', '원문+티로 두는 편이 안전');
    expect(state.overrides[0].note).toBe('제안자가 적은 근거');
    const row = (await makeService(state).review({ id: 'reviewer-2', role: 'DOCTOR' }, { locale: LOCALE, q: key })).rows.find((r) => r.key === key)!;
    expect(row.note).toBe('제안자가 적은 근거');
    expect(row.decisionReason).toBe('원문+티로 두는 편이 안전'); // 결정 사유는 전이 원장에서 온다
  });
});
