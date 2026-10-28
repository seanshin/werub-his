'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AI_CHAT_COMMANDS,
  AI_CHAT_GROUP_LABEL,
  AI_CHAT_REASON_TEXT,
  AI_DEFAULT_DISCLAIMER,
  AI_ORIGIN_TEXT,
  canUseAiChatCommand,
  parseAiChatInput,
  type AiChatCommandDef,
  type AiChatContextPayload,
  type AiChatReason,
  type AiChatSource,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { useAiChatStore, type AiAssistantContext } from '@/stores/ai-chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { AiResultView, copyableText } from './assistant/AiResultView';

/** 서버 응답 봉투(`AiChatEnvelope` — medical-ai.service) */
export interface AiChatEnvelope {
  cmd: string | null;
  type: string;
  source: AiChatSource | null;
  reason?: AiChatReason;
  detail?: string;
  draft: boolean;
  data: unknown;
  disclaimer?: string;
  basis?: Record<string, unknown>;
  unknownCommand?: string;
  /** 초안 명령의 제안 원장 결과(서버 SkillProposalResult) — 초안이 아니면 없다 */
  proposal?: { proposalId: string | null; proposalSkipped?: string; proposalError?: string };
}

/** 제안 원장에 남았는가 — 남지 않았으면 왜인지(실패 ≠ 만들지 않음) */
const PROPOSAL_NOTE: Record<string, string> = {
  CREATED: '제안 원장에 기록됨',
  KIND_UNMAPPED: '이 초안 종류는 제안 원장 분류가 없어 남기지 않았습니다',
  TARGET_UNIDENTIFIED: '대상 진료·입원을 알 수 없어 제안 원장에 남기지 않았습니다',
  EMPTY_DRAFT: '빈 초안이라 제안 원장에 남기지 않았습니다',
  UNAVAILABLE: '산출물이 없어 제안 원장에 남기지 않았습니다',
  LEDGER_UNAVAILABLE: '제안 원장을 쓸 수 없어 남기지 못했습니다',
  PROPOSAL_CREATE_FAILED: '제안 원장 기록에 실패했습니다',
};

type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'ai'; env: AiChatEnvelope }
  | { id: number; role: 'failed'; message: string }
  | { id: number; role: 'system'; text: string };
type NewMessage = ChatMessage extends infer M ? (M extends ChatMessage ? Omit<M, 'id'> : never) : never;

/** 상황에 따라 그 명령을 지금 쓸 수 없는 이유(화면이 미리 말한다 — 서버도 같은 이유로 거절한다) */
export function commandBlockedReason(
  def: AiChatCommandDef,
  role: string | null | undefined,
  ctx: { hasPatient: boolean; hasSoap: boolean },
): AiChatReason | null {
  if (!canUseAiChatCommand(def, role)) return 'ROLE_NOT_ALLOWED';
  if (def.needs.includes('SOAP') && !ctx.hasSoap) return 'SOAP_REQUIRED';
  if (def.needs.includes('PATIENT') && !ctx.hasPatient) return 'PATIENT_REQUIRED';
  return null;
}

const SOURCE_STYLE: Record<AiChatSource, { label: string; cls: string }> = {
  AI: { label: 'AI 생성', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  FALLBACK: { label: '규칙 대체', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  UNAVAILABLE: { label: '받지 못함', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const SURFACE_LABEL: Record<AiAssistantContext['surface'], string> = {
  PATIENT: '환자 화면',
  ENCOUNTER: '진료 작성',
  INPATIENT: '입원 환자',
};

/**
 * AI(WeRU.B) 어시스턴트 패널 — 2026-10-02 재구성.
 *
 * 관계 모드: **보조·초안** — 답을 보여주고 초안은 복사만 한다. 차트에 쓰거나 실행하는 경로는 없다(자동 실행 없음).
 * 🔴 종전 결함(조사 실측):
 *    · 왼쪽 232px 고정 — 사이드바가 접히거나(64px) 서랍일 때 빈 띠·좁은 화면에서 잘림 · 상단 바를 덮음
 *    · 환자 맥락을 보내는 화면이 없어 `/요약`·`/재입원` 은 늘 실패 · "환자 컨텍스트 연결됨" 문구 도달 불가
 *    · 출처(FALLBACK·UNAVAILABLE)를 읽지 않아 실패가 빈 답으로 보임 · `**` 평문 · JSON 덤프 · 칩 6/19
 * 이제 오른쪽에 붙는 패널 · 명령 팔레트(정본 `AI_CHAT_COMMANDS` · 역할·맥락으로 미리 막음) · 출처 배지 ·
 * 초안 표지 · 환자가 바뀌면 대화를 새로 시작한다(다른 환자의 대화를 섞지 않는다).
 */
export function AiChatBar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const tAttr = useTAttr();
  const role = useAuthStore((s) => s.user?.role);
  const ctx = useAiChatStore((s) => s.context);
  const soapGetter = useAiChatStore((s) => s.soapGetter);
  const wide = useAiChatStore((s) => s.wide);
  const toggleWide = useAiChatStore((s) => s.toggleWide);
  const consumePendingQuestion = useAiChatStore((s) => s.consumePendingQuestion);

  const [input, setInput] = useState('');
  const [useCtx, setUseCtx] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const push = (m: NewMessage) => setMessages((prev) => [...prev, { ...m, id: ++seq.current } as ChatMessage]);

  const activeCtx = useCtx ? ctx : null;
  const hasPatient = !!activeCtx;
  const hasSoap = !!activeCtx && !!soapGetter;

  // 🔴 환자가 바뀌면 대화를 새로 — 이전 환자의 답을 새 환자 화면에 남기지 않는다
  const lastPatient = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const pid = ctx?.patientId ?? null;
    if (lastPatient.current !== undefined && lastPatient.current !== pid && messages.length) {
      setMessages([{ id: ++seq.current, role: 'system', text: '환자 맥락이 바뀌어 새 대화를 시작했습니다' }]);
    }
    lastPatient.current = pid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.patientId]);

  const chatMut = useMutation({
    mutationFn: (message: string) => {
      const context: AiChatContextPayload | undefined = activeCtx
        ? {
          patientId: activeCtx.patientId,
          ...(activeCtx.encounterId ? { encounterId: activeCtx.encounterId } : {}),
          ...(activeCtx.department ? { department: activeCtx.department } : {}),
          ...(soapGetter ? { soap: soapGetter() } : {}),
        }
        : undefined;
      return apiClient.post<{ data: AiChatEnvelope }>('/api/v1/ai/chat', { message, ...(context ? { context } : {}) });
    },
    onSuccess: (res) => push({ role: 'ai', env: res.data }),
    // 요청 자체가 실패(권한·네트워크·서버 오류) — AI 의 답이 아니므로 AI 면책 문구를 붙이지 않는다
    onError: (err: unknown) => push({ role: 'failed', message: extractErrorMessage(err) }),
  });

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || chatMut.isPending) return;
    push({ role: 'user', text });
    chatMut.mutate(text);
    setInput('');
  };

  // 옴니박스에서 넘어온 질의 — 패널이 열리면 한 번 소비해 바로 묻는다("묻기"를 누른 것이 곧 전송 의도)
  useEffect(() => {
    if (!isOpen) return;
    const q = consumePendingQuestion();
    if (q) send(q);
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chatMut.isPending]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const pick = (cmd: string) => {
    const def = AI_CHAT_COMMANDS.find((c) => c.cmd === cmd);
    if (def && def.needs.length === 0) { send(cmd); return; }
    if (def && !def.needs.includes('ARG')) { send(cmd); return; } // SOAP·환자만 필요한 명령은 바로 보낸다
    setInput(`${cmd} `);
    inputRef.current?.focus();
  };

  // 입력 중인 명령 — 인자 자리 표시·막힘 이유를 미리 보여 준다
  const typed = useMemo(() => parseAiChatInput(input), [input]);
  const typedBlocked = typed.cmd ? commandBlockedReason(typed.cmd, role, { hasPatient, hasSoap }) : null;
  const suggestions = input.startsWith('/') && !input.includes(' ')
    ? AI_CHAT_COMMANDS.filter((c) => c.cmd.startsWith(input) || c.aliases?.some((a) => a.startsWith(input))).slice(0, 8)
    : [];

  if (!isOpen) return null;

  const groups = (['RECORD', 'CLINICAL', 'REFERENCE'] as const).map((g) => ({
    g,
    items: AI_CHAT_COMMANDS.filter((c) => c.group === g && canUseAiChatCommand(c, role)),
  })).filter((x) => x.items.length);

  return (
    <aside
      role="complementary"
      aria-label={tAttr('AI 어시스턴트')}
      data-ai-assistant
      data-wide={wide ? '1' : '0'}
      className={`fixed bottom-0 right-0 top-0 z-40 flex w-full flex-col border-l border-gray-200 bg-white shadow-2xl sm:top-14 ${wide ? 'sm:w-[640px]' : 'sm:w-[420px]'}`}
    >
      {/* 머리 — 이름·관계 모드·도구 */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-slate-800 px-3 py-2 text-white">
        <svg className="h-5 w-5 flex-shrink-0 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{AI_ORIGIN_TEXT} <T k="어시스턴트" /></p>
          <p className="truncate text-[10px] text-slate-300" data-ai-mode><T k="보조·초안 — 기록에 쓰거나 실행하지 않습니다" /></p>
        </div>
        <button type="button" onClick={() => setMessages([])} disabled={!messages.length} title={tAttr('새 대화')} aria-label={tAttr('새 대화')}
          className="rounded p-1.5 hover:bg-white/10 disabled:opacity-40">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
        <button type="button" onClick={toggleWide} title={tAttr(wide ? '좁게 보기' : '넓게 보기')} aria-label={tAttr(wide ? '좁게 보기' : '넓게 보기')}
          className="hidden rounded p-1.5 hover:bg-white/10 sm:block">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={wide ? 'M13 5l7 7-7 7M5 5l7 7-7 7' : 'M11 19l-7-7 7-7m8 14l-7-7 7-7'} /></svg>
        </button>
        <button type="button" onClick={onClose} title={tAttr('닫기')} aria-label={tAttr('닫기')} className="rounded p-1.5 hover:bg-white/10">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </header>

      {/* 맥락 — 무엇이 서버로 가는지 말한다 */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[12px]" data-ai-context>
        {ctx ? (
          <>
            <span className={`rounded-full border px-2 py-0.5 ${useCtx ? 'border-indigo-200 bg-white text-indigo-700' : 'border-gray-200 text-gray-400 line-through'}`}>
              <T k="환자" />: <span data-ai-context-patient>{ctx.patientName}</span> · <T k={SURFACE_LABEL[ctx.surface]} />
              {soapGetter && useCtx && <> · <T k="작성 중 SOAP 연결" /></>}
            </span>
            <button type="button" onClick={() => setUseCtx((v) => !v)} className="text-gray-500 underline-offset-2 hover:underline">
              <T k={useCtx ? '맥락 빼고 묻기' : '맥락 다시 넣기'} />
            </button>
          </>
        ) : (
          <span className="text-gray-500"><T k="환자 맥락 없음 — 환자·진료 화면에서 열면 그 환자가 연결됩니다" /></span>
        )}
      </div>

      {/* 대화 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" data-ai-messages>
        {messages.length === 0 && (
          <div className="space-y-3" data-ai-palette>
            <p className="text-[12px] text-gray-500"><T k="명령을 고르거나 질문을 입력하세요. 명령 없이 입력하면 의학 참고자료에서 찾아 답합니다." /></p>
            {groups.map(({ g, items }) => (
              <div key={g} className="space-y-1">
                <p className="text-[11px] font-semibold text-gray-500"><T k={AI_CHAT_GROUP_LABEL[g]} /></p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((c) => {
                    const blocked = commandBlockedReason(c, role, { hasPatient, hasSoap });
                    return (
                      <button key={c.cmd} type="button" data-ai-cmd={c.cmd} disabled={!!blocked} onClick={() => pick(c.cmd)}
                        title={blocked ? tAttr(AI_CHAT_REASON_TEXT[blocked]) : tAttr(c.desc)}
                        className="min-h-[44px] rounded-lg border border-gray-200 px-2 py-1.5 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-45">
                        <span className="block text-[12px] font-medium text-gray-800"><T k={c.label} /></span>
                        <span className="block font-mono text-[10px] text-gray-400">{c.cmd}{c.draft ? ' · ' : ''}{c.draft && <T k="초안" />}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white">{m.text}</div>
              </div>
            );
          }
          if (m.role === 'system') {
            return <p key={m.id} className="text-center text-[11px] text-gray-400"><T k={m.text} /></p>;
          }
          if (m.role === 'failed') {
            return (
              <div key={m.id} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" data-ai-failed>
                <p className="font-medium"><T k="요청이 실패했습니다" /></p>
                <p className="text-[12px]">{m.message}</p>
              </div>
            );
          }
          return <AiMessage key={m.id} env={m.env} onPick={pick} />;
        })}

        {chatMut.isPending && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500">
            <span className="animate-pulse"><Tf k="{ai}가 응답을 만들고 있습니다…" params={{ ai: AI_ORIGIN_TEXT }} /></span>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="flex-shrink-0 border-t border-gray-200 p-3">
        {suggestions.length > 0 && (
          <ul className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 text-[12px]" data-ai-suggest>
            {suggestions.map((c) => {
              const blocked = commandBlockedReason(c, role, { hasPatient, hasSoap });
              return (
                <li key={c.cmd}>
                  <button type="button" disabled={!!blocked} onClick={() => pick(c.cmd)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-indigo-50 disabled:opacity-45">
                    <code className="font-mono">{c.cmd}</code>
                    <span className="truncate text-gray-500"><T k={blocked ? AI_CHAT_REASON_TEXT[blocked] : c.desc} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {typed.cmd && (
          <p className={`mb-1 text-[11px] ${typedBlocked ? 'text-amber-700' : 'text-gray-500'}`} data-ai-typed-hint>
            {typedBlocked
              ? <T k={AI_CHAT_REASON_TEXT[typedBlocked]} />
              : <><T k={typed.cmd.label} />{typed.cmd.argHint && <> — <span className="font-mono">{typed.cmd.argHint}</span></>}{typed.cmd.sendsPatientData && hasPatient && <> · <T k="환자 정보가 AI 로 전송됩니다" /></>}</>}
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
            }}
            placeholder={tAttr('질문 또는 / 로 명령 (Shift+Enter 줄바꿈)')}
            aria-label={tAttr('어시스턴트에게 보낼 내용')}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
          />
          <button type="button" onClick={() => send(input)} disabled={chatMut.isPending || !input.trim() || !!typedBlocked}
            className="min-h-[44px] rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            <T k="보내기" />
          </button>
        </div>
      </div>
    </aside>
  );
}

/** AI 응답 한 건 — 출처 배지·초안 표지·근거·복사·면책 */
function AiMessage({ env, onPick }: { env: AiChatEnvelope; onPick: (cmd: string) => void }) {
  const tAttr = useTAttr();
  const def = env.cmd ? AI_CHAT_COMMANDS.find((c) => c.cmd === env.cmd) : null;

  // AI 를 부르지 않았다 — 이유만 말한다(AI 면책 문구를 붙이지 않는다)
  if (env.source === null && env.type !== 'help') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-ai-notice={env.reason}>
        {def && <p className="text-[11px] font-semibold"><T k={def.label} /> · <T k="AI 를 부르지 않았습니다" /></p>}
        <p>{env.reason ? <T k={AI_CHAT_REASON_TEXT[env.reason]} /> : <T k="AI 를 부르지 않았습니다" />}</p>
        {env.reason === 'ARG_REQUIRED' && def?.argHint && <p className="font-mono text-[11px]">{def.cmd} {def.argHint}</p>}
      </div>
    );
  }
  if (env.type === 'help') {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <AiResultView type="help" data={env.data} onPick={onPick} />
      </div>
    );
  }

  const src = SOURCE_STYLE[env.source ?? 'UNAVAILABLE'];
  const copy = env.source === 'AI' || env.source === 'FALLBACK' ? copyableText(env.type, env.data) : null;
  const doCopy = async () => {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy);
      toast.success(tAttr('초안을 복사했습니다 — 기록 화면에서 확인 후 붙여 넣으세요'));
    } catch {
      toast.error(tAttr('복사하지 못했습니다'));
    }
  };

  return (
    <article className="rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800" data-ai-message={env.type} data-ai-source={env.source ?? ''}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 px-3 py-1.5">
        <span className="text-[12px] font-semibold text-gray-700">{def ? <T k={def.label} /> : <T k="참고자료 답변" />}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${src.cls}`}><T k={src.label} /></span>
        {env.draft && env.source !== 'UNAVAILABLE' && (
          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700" data-ai-draft><T k="초안 · 확정 아님" /></span>
        )}
        {env.proposal && (() => {
          const code = env.proposal.proposalId ? 'CREATED' : env.proposal.proposalError ?? env.proposal.proposalSkipped ?? '';
          const text = PROPOSAL_NOTE[code];
          return text ? (
            <span data-ai-proposal={code}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${code === 'CREATED' ? 'border-slate-200 bg-white text-slate-500' : code === 'PROPOSAL_CREATE_FAILED' || code === 'LEDGER_UNAVAILABLE' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-400'}`}>
              <T k={text} />
            </span>
          ) : null;
        })()}
        {env.unknownCommand && (
          <span className="text-[10px] text-gray-500"><Tf k="{cmd} 는 없는 명령이라 참고자료 검색으로 처리했습니다" params={{ cmd: env.unknownCommand }} /></span>
        )}
      </div>
      <div className="px-3 py-2">
        {env.source === 'UNAVAILABLE' ? (
          <div className="text-rose-800" data-ai-unavailable>
            <p>{env.reason ? <T k={AI_CHAT_REASON_TEXT[env.reason]} /> : <T k={AI_CHAT_REASON_TEXT.UPSTREAM_ERROR} />}</p>
            {env.detail && <p className="font-mono text-[11px] text-rose-600">{env.detail}</p>}
          </div>
        ) : (
          <>
            {env.source === 'FALLBACK' && (
              <p className="mb-1.5 text-[12px] text-amber-800"><T k="AI 서버 대신 규칙으로 만든 결과입니다 — AI 답이 아닙니다" />{env.detail && <span className="ml-1 font-mono text-[11px]">({env.detail})</span>}</p>
            )}
            <AiResultView type={env.type} data={env.data} onPick={onPick} />
          </>
        )}
        {env.basis && (
          <p className="mt-2 text-[11px] text-gray-500" data-ai-basis>
            <T k="환자 원장에서 읽은 값" />:{' '}
            {[
              typeof env.basis.age === 'number' ? `${tAttr('나이')} ${env.basis.age}` : null,
              typeof env.basis.sex === 'string' ? `${tAttr('성별')} ${env.basis.sex}` : null,
              typeof env.basis.lengthOfStay === 'number' ? `${tAttr('재원일수')} ${env.basis.lengthOfStay}` : null,
            ].filter(Boolean).join(' · ') || '-'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 px-3 py-1.5">
        <p className="flex-1 text-[10px] leading-snug text-gray-400">{env.disclaimer || AI_DEFAULT_DISCLAIMER}</p>
        {copy && (
          <button type="button" onClick={doCopy} className="min-h-[32px] rounded border border-gray-200 bg-white px-2 text-[11px] text-gray-600 hover:bg-gray-100">
            <T k="복사" />
          </button>
        )}
      </div>
    </article>
  );
}
