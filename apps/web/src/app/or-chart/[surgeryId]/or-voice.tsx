'use client';

/**
 * 수술방 구술(VoiceEMR · 수술 단위 세션) — 인식된 문장을 메모 입력칸에 붙이기만 한다.
 *
 * 🔴 저장은 사람이 확인하고 '기록'을 누를 때 — 인식 문장이 곧바로 원장에 들어가지 않는다(초안 ≠ 확정).
 * 🔴 열 수 있는지는 서버가 정한다(수술팀 자리 · 구술 게이트 `voiceEmr.dictate.enabled`) — 막히면 그 이유를 이 자리에 말한다.
 *    조회 모드로 바꿔 게이트를 돌아가지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { ApiError } from '@/lib/api-client';
import { voiceApi } from '@/lib/voice-api';
import { extractErrorMessage } from '@/lib/error-utils';
import { useVoiceCommand } from '@/components/voice-emr/useVoiceCommand';
import { int16ToBase64 } from '@/components/voice-emr/audio-pcm';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 서버가 막은 이유 → 사람 말(코드별) · 모르는 코드는 null(서버 문장 그대로) — 키는 호출부 리터럴(카탈로그 가드가 본다) */
function blockReason(code: string, tAttr: (k: string) => string): string | null {
  switch (code) {
    case 'VOICE_DICTATE_OFF': return tAttr('구술이 관리자 설정에서 꺼져 있습니다(voiceEmr.dictate.enabled).');
    case 'VOICE_EMR_DISABLED': return tAttr('음성 기능이 관리자 설정에서 꺼져 있습니다.');
    case 'VOICE_EMR_NOT_PILOT': return tAttr('음성 기능 시범 사용자로 지정되어 있지 않습니다.');
    case 'SURGERY_TEAM_ONLY': return tAttr('이 수술의 수술팀 자리(집도·보조·마취·소독·순회 간호)에 있는 사람만 씁니다 — 순회 간호라면 먼저 "순회 간호 맡기".');
    default: return null;
  }
}

type State = { kind: 'idle' } | { kind: 'starting' } | { kind: 'live' } | { kind: 'blocked'; reason: string } | { kind: 'error'; reason: string };

export function OrVoiceDictation({ surgeryId, onText }: { surgeryId: string; onText: (text: string) => void }) {
  const tAttr = useTAttr();
  const sidRef = useRef('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);

  const sendChunk = useCallback(async (_u: string, pcm: Int16Array, mode: 'partial' | 'final') => {
    if (!sidRef.current) return {};
    return voiceApi.chunk(sidRef.current, int16ToBase64(pcm), mode);
  }, []);
  const opts = useMemo(() => ({
    enabled: state.kind === 'live',
    ptt: false,
    sendChunk,
    onPartial: (t: string) => setPartial(t),
    onFinal: (_s: string, r: { text?: string }) => { setPartial(''); if (r.text?.trim()) onText(r.text.trim()); },
    onLevel: (l: number) => setLevel(l),
    onError: (e: unknown) => setState({ kind: 'error', reason: extractErrorMessage(e) || tAttr('음성 인식에 실패했습니다.') }),
  }), [state.kind, sendChunk, onText, tAttr]);
  const voice = useVoiceCommand(opts);
  // 캡처는 live 가 그려진 뒤에 연다(훅의 enabled 가 그 렌더에서 참이 된다)
  const voiceRef = useRef(voice); voiceRef.current = voice;
  useEffect(() => { if (state.kind === 'live') void voiceRef.current.begin(); }, [state.kind]);
  // 화면을 떠나면 열린 세션을 닫는다(캡처는 훅이 멈춘다 · 세션은 여기서) — 열린 채 남으면 서버에 활성 세션이 쌓인다
  useEffect(() => () => { if (sidRef.current) { void voiceApi.close(sidRef.current).catch(() => undefined); sidRef.current = ''; } }, []);

  const start = async () => {
    setState({ kind: 'starting' });
    try {
      const s = await voiceApi.startSurgery(surgeryId);
      sidRef.current = s.id;
      setState({ kind: 'live' });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const why = blockReason(code, tAttr);
      if (why) setState({ kind: 'blocked', reason: why });
      else setState({ kind: 'error', reason: extractErrorMessage(e) || tAttr('음성 세션을 열지 못했습니다.') });
    }
  };
  const stop = async () => {
    await voice.end();
    if (sidRef.current) {
      // 세션 닫기 실패는 화면을 막지 않되 숨기지도 않는다(열린 세션이 남는다)
      await voiceApi.close(sidRef.current).catch((e) => setState({ kind: 'error', reason: extractErrorMessage(e) || tAttr('음성 세션을 닫지 못했습니다.') }));
      sidRef.current = '';
    }
    setPartial(''); setLevel(0);
    setState((s) => (s.kind === 'error' ? s : { kind: 'idle' }));
  };

  return (
    <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-xs" data-or-voice={state.kind}>
      <div className="flex flex-wrap items-center gap-2">
        {state.kind === 'live' ? (
          <button type="button" onClick={() => void stop()} className="min-h-[44px] rounded-xl bg-rose-600 px-4 font-semibold text-white">
            ● <T k="음성 입력 멈춤" />
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={state.kind === 'starting'}
            className="min-h-[44px] rounded-xl bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">
            🎙 <T k="음성 입력" />
          </button>
        )}
        {state.kind === 'live' && (
          <span className="h-2 w-24 overflow-hidden rounded bg-violet-100" aria-hidden><span className="block h-full bg-violet-500" style={{ width: `${Math.round(level * 100)}%` }} /></span>
        )}
        <span className="text-[10px] text-violet-700">{AI_ORIGIN_TEXT} · <T k="음성 인식 문장은 입력칸에 붙기만 합니다 — 확인하고 '기록'을 눌러야 저장됩니다." /></span>
      </div>
      {partial && <p className="mt-1 italic text-gray-500">{partial}</p>}
      {state.kind === 'blocked' && <p className="mt-1 text-amber-800" role="status">{state.reason}</p>}
      {state.kind === 'error' && <p className="mt-1 text-rose-700" role="alert">{state.reason}</p>}
    </div>
  );
}
