/**
 * AI 제안(review-pending) 레코드 — FE 헬퍼 정본 (2026-09-09 P1)
 *
 * 서버 정본: apps/api/src/modules/ai-proposal (api/v1/ai/proposals). 생성 EP 는 없다 — 제안은 각 스킬 서버가 만들고
 * 응답에 `proposalId` 를 실어 준다. 화면은 세 가지만 말한다:
 *   ① 실제로 그렸다(presented) ② 사람이 수락/수정/거부했다(decision) ③ 그 사실을 기록하지 못했다(반환값 false)
 * 🔴 기록 실패를 성공처럼 말하지 않는다 — 실패는 반환값으로만 말하고 업무는 막지 않는다.
 */
import { apiClient } from '@/lib/api-client';

export type AiProposalDecision = 'ACCEPTED' | 'EDITED' | 'REJECTED';

/** 스킬 응답(`{proposalId}` 또는 `{data:{proposalId}}`)에서 제안 id 를 꺼낸다 — 없으면 null(지어내지 않음) */
export function proposalIdFrom(data: unknown): string | null {
  const d = data as { proposalId?: unknown; data?: { proposalId?: unknown } } | null | undefined;
  const v = d?.proposalId ?? d?.data?.proposalId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 화면이 제안을 실제로 렌더했을 때 1회 호출(서버가 멱등 처리) */
export async function markProposalPresented(id: string, clientContext?: string): Promise<boolean> {
  try {
    await apiClient.post(`/api/v1/ai/proposals/${encodeURIComponent(id)}/presented`, clientContext ? { clientContext } : {});
    return true;
  } catch {
    return false;
  }
}

/** 사람의 결정 — finalText 는 편집거리 계산에만 쓰이고 서버는 본문을 저장하지 않는다 */
export async function decideProposal(
  id: string,
  input: { decision: AiProposalDecision; finalText?: string; reason?: string; clientContext?: string },
): Promise<{ ok: boolean; editDistance: number | null; notPresented: boolean }> {
  try {
    const r = await apiClient.post<{ data?: { editDistance?: number | null; notPresented?: boolean } }>(
      `/api/v1/ai/proposals/${encodeURIComponent(id)}/decision`,
      input,
    );
    return { ok: true, editDistance: r?.data?.editDistance ?? null, notPresented: !!r?.data?.notPresented };
  } catch {
    return { ok: false, editDistance: null, notPresented: false };
  }
}
