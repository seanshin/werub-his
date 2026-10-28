'use client';

import { useCallback, type ReactNode } from 'react';
import { isServerMessage, type ServerMessage } from '@hospital-run/shared';
import { Data, T, Tf } from '@/components/ui/i18n-text';
import { useUiLocale } from '@/stores/ui-locale-store';
import { serverMessageText } from '@/lib/server-message-text';

/**
 * 서버 표시 문장 — 서버가 `{ k, params }`(shared `ServerMessage`)로 내려보낸 사유·근거를 카탈로그로 조립한다.
 *
 * 🔴 (2026-09-15) 서버가 값을 끼워 만든 한국어 문장은 화면 언어를 바꿔도 한국어로 남는다. 서버는 키와 값만 주고
 *    여기서 `<Tf>` 로 조립한다. 낱말 조각(`{ k }`)은 `<T>`, 중첩 문장은 재귀. 숫자·코드는 그대로(번역 대상 아님).
 * `fallback` 은 msg 가 없는 **구 응답**(배포 경계)에만 — 서버 원문이라 `<Data>` 로 그린다(거짓 EN× 금지).
 * 설계 `docs/01-plan/features/server-display-text-i18n.plan.md`.
 */
export function ServerText({ msg, fallback, className }: { msg?: ServerMessage | null; fallback?: string | null; className?: string }) {
  if (!msg) return fallback ? <Data className={className}>{fallback}</Data> : null;
  if (!msg.params) return <T k={msg.k} className={className} />;
  const params: Record<string, ReactNode> = {};
  for (const [name, v] of Object.entries(msg.params)) {
    if (typeof v === 'string' || typeof v === 'number') params[name] = v;
    else if (isServerMessage(v) && v.params) params[name] = <ServerText msg={v} />;
    else params[name] = <T k={v.k} />;
  }
  return <Tf k={msg.k} params={params} className={className} />;
}

/**
 * 속성·토스트 자리용 서버 문장 문자열 — 티를 그릴 수 없는 곳(`title`·`toast`). 규칙은 `<ServerText>` 와 같다.
 * msg 가 없으면 서버 원문 `fallback`(구 응답) · 둘 다 없으면 빈 문자열.
 */
export function useServerTextAttr(): (msg?: ServerMessage | null, fallback?: string | null) => string {
  const locale = useUiLocale();
  // 🔴 useTAttr 와 같은 이유로 locale 에만 묶는다(렌더마다 새 함수 = 의존한 effect 무한 재실행)
  return useCallback(
    (msg?: ServerMessage | null, fallback?: string | null) => (msg ? serverMessageText(msg, locale) : fallback ?? ''),
    [locale],
  );
}
