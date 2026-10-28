/**
 * 🔴 의뢰서·MDT 화면이 **제안 원장(AiProposal)에 사실대로 보고하는가** — P1-④(2026-09-09).
 *
 * 정본: `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1 ·
 *       FE 헬퍼 `src/lib/ai-proposal.ts` · 배너 `src/components/ai/DraftBanner.tsx`.
 *
 * 이 가드가 지키는 것은 "제안 id 를 넘겨라"가 아니라 **"언제 무엇을 보고하느냐"** 다.
 * 이 축에서 틀리기 쉬운 자리가 셋이고, 전부 테스트는 초록인 채로 거짓이 된다:
 *
 *  ① **초안을 만든 시점에 결정(ACCEPTED)을 남기는 것** — 사람이 읽기도 전에 "무수정 수용"이 원장에 박힌다
 *     (P16: 실행하지 않고 성공 상태만 기록). 수용률·검토시간 지표가 통째로 거짓이 된다.
 *     그래서 `generateAiDraft` 안의 `recordDraftApplied` 에는 `proposalId` 가 **없어야** 한다
 *     (헬퍼가 `proposalId` 를 받으면 그 자리에서 `decideProposal(ACCEPTED)` 를 부른다).
 *  ② **고쳐 놓고 ACCEPTED 로 남기는 것** — 결정은 원본과 최종본을 비교해 갈라야 한다.
 *     상수 `'ACCEPTED'` 를 박으면 수정률이 0% 가 된다.
 *  ③ **초안을 버렸는데 아무것도 남기지 않는 것** — 그 제안은 나중에 `EXPIRED` 가 되어
 *     "사람이 보지도 않았다"로 읽힌다(거부와 만료는 다른 사실이다).
 *
 * 재주입(2026-09-09 실행 · 각 1건씩 되살려 실패 확인 후 복원):
 *   · `generateAiDraft` 의 `recordDraftApplied` 에 `proposalId` 를 다시 넣으면 → ① 실패
 *   · 전송 시 `decision` 을 `'ACCEPTED'` 상수로 되돌리면 → ② 실패
 *   · `markProposalPresented(` 호출 삭제 → 노출 보고 검사 실패
 *   · `discardSummaryDraft` 의 `decideProposal(` 삭제 → ③ 실패
 *   · 버리기 버튼에 `disabled={!rejectReason}` 를 달면 → 사유 강제 금지 검사 실패
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REFERRAL = join(__dirname, '..', '..', 'src', 'app', '(main)', 'patients', '[id]', 'components', 'ReferralTab.tsx');
const MDT = join(__dirname, '..', '..', 'src', 'app', '(main)', 'mdt', 'page.tsx');

const read = (p: string) => readFileSync(p, 'utf8');

/**
 * 마커 다음의 첫 `{` 부터 짝이 맞는 `}` 까지. 🔴 잘라낸 조각이 파일 전체이거나 비어 있으면
 * 이 가드는 "다른 이유로" 통과한다 — 그래서 아래 파서 자기점검 테스트를 함께 둔다.
 */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  const open = src.indexOf('{', at + marker.length - 1);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return '';
}

/** `<button ...>…</button>` 한 덩어리 */
function buttonAt(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  const start = src.lastIndexOf('<button', at);
  const end = src.indexOf('</button>', at);
  return start < 0 || end < 0 ? '' : src.slice(start, end);
}

describe('의뢰서(ReferralTab) — 제안 원장 배선', () => {
  const src = read(REFERRAL);
  const generate = blockAfter(src, 'const generateAiDraft = async () => {');
  const onCreated = blockAfter(src, 'onSuccess: async (_res, vars) => {');

  it('파서 자기점검: 두 영역을 실제로 잘랐다(헛돌면 아래 검사가 전부 무의미하다)', () => {
    expect(generate.length).toBeGreaterThan(200);
    expect(generate.length).toBeLessThan(src.length);
    expect(generate).toContain('/api/v1/referral-letters/generate');
    expect(onCreated.length).toBeGreaterThan(200);
    expect(onCreated).toContain("qc.invalidateQueries({ queryKey: ['consultations'");
  });

  it('제안 어휘는 정본 헬퍼에서만 온다(화면이 자기 EP 를 부르지 않는다)', () => {
    expect(src).toMatch(/from '@\/lib\/ai-proposal'/);
    expect(src).not.toContain('/api/v1/ai/proposals');
  });

  it('🔴 초안을 화면에 그린 시점에 노출(presented)을 보고한다', () => {
    expect(generate).toContain('proposalIdFrom(');
    expect(generate).toContain('markProposalPresented(');
  });

  it('🔴 초안을 만든 시점에는 결정을 남기지 않는다 (읽기 전 "무수정 수용" 금지)', () => {
    const applied = blockAfter(generate, 'await recordDraftApplied({');
    expect(applied, 'generateAiDraft 안의 recordDraftApplied 를 찾지 못했다 — 파서가 헛돈다').not.toBe('');
    expect(applied).not.toContain('proposalId');
    expect(applied).not.toContain('decision');
  });

  it('🔴 사람이 협진을 전송하는 시점에 결정을 남긴다(최종본과 함께)', () => {
    const applied = blockAfter(onCreated, 'await recordDraftApplied({');
    expect(applied, '전송 시 recordDraftApplied 를 찾지 못했다').not.toBe('');
    expect(applied).toContain('proposalId: draftProposalId');
    expect(applied).toContain('finalText: vars.reason');
  });

  it('🔴 결정을 상수로 박지 않는다 — AI 원본과 최종본을 비교해 ACCEPTED/EDITED 를 가른다', () => {
    expect(onCreated).toMatch(/decision:\s*vars\.reason === aiDraft \? 'ACCEPTED' : 'EDITED'/);
  });

  it('서명·전송 응답의 원장 기록 실패를 성공처럼 말하지 않는다', () => {
    const sign = blockAfter(src, 'const signAndSend = useMutation({');
    expect(sign).toContain('recorded === false');
  });
});

describe('MDT(page) — 제안 원장 배선', () => {
  const src = read(MDT);
  const summary = blockAfter(src, 'const aiSummaryMut = useMutation({');
  const save = blockAfter(src, 'const saveSummaryMut = useMutation({');
  const discard = blockAfter(src, 'const discardSummaryDraft = async () => {');

  it('파서 자기점검: 세 영역을 실제로 잘랐다', () => {
    expect(summary).toContain('/auto-summary');
    expect(save).toContain('/api/v1/mdt/cases/');
    expect(discard.length).toBeGreaterThan(100);
    for (const b of [summary, save, discard]) expect(b.length).toBeLessThan(src.length);
  });

  it('제안 어휘는 정본 헬퍼에서만 온다', () => {
    expect(src).toMatch(/from '@\/lib\/ai-proposal'/);
    expect(src).not.toContain('/api/v1/ai/proposals');
  });

  it('🔴 초안을 그린 시점에 노출(presented)을 보고한다', () => {
    expect(summary).toContain('proposalIdFrom(');
    expect(summary).toContain('markProposalPresented(');
  });

  it('🔴 산출 불가(UNAVAILABLE)에는 제안 id 가 없다 — 지어내지 않는다', () => {
    const unavailable = blockAfter(summary, "if (source !== 'AI' || !draft) {");
    expect(unavailable, 'UNAVAILABLE 분기를 찾지 못했다').not.toBe('');
    expect(unavailable).toContain('proposalId: null');
  });

  it('🔴 사람이 정본에 저장하는 시점에만 결정을 남긴다(최종본과 함께)', () => {
    const applied = blockAfter(save, 'await recordDraftApplied({');
    expect(applied, '저장 시 recordDraftApplied 를 찾지 못했다').not.toBe('');
    expect(applied).toContain('proposalId: d.proposalId');
    expect(applied).toContain('finalText: vars.clinicalSummary');
  });

  it('🔴 결정을 상수로 박지 않는다 — AI 원문(originalText)과 저장본을 비교한다', () => {
    expect(save).toMatch(/decision:\s*vars\.clinicalSummary === d\.originalText \? 'ACCEPTED' : 'EDITED'/);
    // 원문을 따로 들고 있어야 비교가 가능하다(편집 중 text 를 덮어쓰기 때문)
    expect(src).toContain('originalText');
  });

  it('🔴 초안을 버리면 거부로 남는다(만료로 흘려보내지 않는다)', () => {
    expect(discard).toContain('decideProposal(');
    expect(discard).toContain("decision: 'REJECTED'");
    const button = buttonAt(src, 'onClick={() => discardSummaryDraft()}');
    expect(button, '버리기 버튼을 찾지 못했다').not.toBe('');
    expect(button).toContain('discardSummaryDraft');
  });

  it('🔴 거부 사유를 강제하지 않는다(강제하면 거짓 사유가 쌓인다)', () => {
    const button = buttonAt(src, 'onClick={() => discardSummaryDraft()}');
    expect(button).not.toContain('disabled');
    // 사유는 빈 값이면 아예 보내지 않는다(빈 문자열을 사유로 남기지 않는다)
    expect(discard).toContain('rejectReason.trim() ?');
  });

  it('기록 실패를 성공처럼 말하지 않는다', () => {
    expect(discard).toContain('if (!r.ok)');
  });
});
