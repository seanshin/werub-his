'use client';

import { useEffect, useRef } from 'react';
import type { AiChatContextPayload } from '@hospital-run/shared';
import { useAiChatStore, type AiAssistantContext } from '@/stores/ai-chat-store';

/**
 * 화면이 어시스턴트에 환자 맥락을 건다 — 화면을 떠나면 그 화면이 건 맥락만 푼다.
 * `soap` 를 주면 보내는 순간의 값을 읽는다(최신 값을 ref 로 들고 있어 타자마다 스토어를 바꾸지 않는다).
 */
export function useAiAssistantContext(
  ctx: AiAssistantContext | null,
  soap?: AiChatContextPayload['soap'] | null,
) {
  const setContext = useAiChatStore((s) => s.setContext);
  const releaseContext = useAiChatStore((s) => s.releaseContext);
  const soapRef = useRef(soap);
  soapRef.current = soap;
  const hasSoap = soap !== undefined;
  const key = ctx ? `${ctx.patientId}|${ctx.patientName}|${ctx.encounterId ?? ''}|${ctx.department ?? ''}|${ctx.surface}` : '';

  useEffect(() => {
    if (!ctx) return;
    setContext(ctx, hasSoap ? () => ({ ...(soapRef.current ?? {}) }) : null);
    return () => releaseContext(ctx.patientId, ctx.surface);
    // ctx 객체 동일성이 아니라 내용(key)으로 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasSoap, setContext, releaseContext]);
}
