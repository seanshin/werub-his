'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '@/stores/voice-store';
import { useVoiceCommand } from './useVoiceCommand';
import { int16ToBase64 } from './audio-pcm';
import { VoiceConfirmCard } from './VoiceConfirmCard';
import { MicSettings } from './MicSettings';
import { voiceApi, type VoiceOrderDraft } from '@/lib/voice-api';
import { ApiError } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import type { PatientRef, SoapField, VoiceMode } from './types';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/** 서버 세션 mode(READ·DICTATE·COMMAND) → 스토어 어휘 */
function toVoiceMode(mode: string | undefined): VoiceMode {
  const m = (mode ?? '').toLowerCase();
  return m === 'dictate' || m === 'command' ? m : 'read';
}

/**
 * VoiceEMR 진료 화면 런처 — 세션·PTT 캡처·청크·파싱·확인 카드를 잇는 통합 컨테이너.
 * config voiceEmr.enabled OFF면 start 가 403 → 토스트 후 저하(무영향).
 *
 * 🔴 실 EMR 쓰기(SOAP)는 `onApplySoap` 하나 — **확인 카드 확정 뒤에만** 부른다(구술 포함). 종전엔 `dictate` outcome 을
 *    받는 즉시 `onApplySoap('subjective', text)` 를 불러 확인 카드·환자 신원·게이트를 전부 건너뛰었다
 *    (기획서 voice-emr-ambient-conversation §13.2 P0-1). 부모는 이 콜백을 **append** 로 받는다(덮어쓰기 금지).
 */
export function VoiceEmrLauncher({ encounterId, onApplySoap, onOrderDraft, autoStart, onExit }: { encounterId: string; onApplySoap?: (field: SoapField, text: string) => void; onOrderDraft?: (draft: VoiceOrderDraft) => void; autoStart?: boolean; onExit?: () => void }) {
  const store = useVoiceStore();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const sidRef = useRef<string>('');
  const [active, setActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const micBoxRef = useRef<HTMLSpanElement>(null);
  // 🔴 컨테이너(main) 밖으로 뻗어 잘리지 않게 — 정본 하나(useEdgeSafeAlign)
  const { alignClass: micAlignClass } = useEdgeSafeAlign(settingsOpen, 330, micBoxRef);
  const startedRef = useRef(false);
  const errToastRef = useRef(0);

  const sendChunk = useCallback(async (_uSid: string, pcm: Int16Array, mode: 'partial' | 'final') => {
    if (!sidRef.current) return {};
    return voiceApi.chunk(sidRef.current, int16ToBase64(pcm), mode);
  }, []);

  const onFinal = useCallback(async (_uSid: string, r: { text?: string; confidence?: number }) => {
    store.appendNote(r.text ?? '');
    if (r.text) store.setPartial(r.text, r.confidence); // 인식된 텍스트를 자막에 노출(사용자 확인)
    if (!r.text || !sidRef.current) return;
    try {
      const outcomes = await voiceApi.parse(sidRef.current, r.text, r.confidence);
      const o = outcomes[0];
      if (!o) return;
      /**
       * 🔴 조회는 **인식까지만** 동작한다 — 결과를 띄우는 배선이 없다. 종전 토스트 `조회: <대상>` 은
       *    무언가 조회된 것처럼 보였다(아무것도 표시되지 않는다). 여는 것은 사람 결정(`policy.voice.readOpen`).
       */
      if (o.kind === 'read') {
        toast.info(o.target
          ? tfAttr('조회 명령 인식됨: {대상} — 결과는 표시되지 않습니다(조회 연동 미개방)', { 대상: o.target })
          : tAttr('조회 명령으로 인식됨 — 결과는 표시되지 않습니다(조회 연동 미개방)'));
        return;
      }
      if (o.kind === 'hold') {
        // 🔴 hold 의 사유는 둘이다 — 신뢰도 낮음(파서) / 구술 게이트 OFF(서버 gateDictate). 둘을 한 문장으로 말하지 않는다.
        //    DICTATE_OFF 는 "다시 말하면 된다"가 아니라 "이 발화는 기록되지 않았다"다.
        if (o.reason === 'DICTATE_OFF') toast.info(tAttr('구술이 관리자 설정에서 비활성 상태입니다 — 이 발화는 기록되지 않았습니다'));
        else toast.info(tAttr('인식 신뢰도 낮음 — 다시 말씀해 주세요'));
        return;
      }
      if (o.kind === 'system') return;
      store.requireConfirm(o); // vital·order-*·alias·dictate(ConfirmCard) — 구술도 확인 카드를 지난다
    } catch (e) { toast.error(`파싱 실패: ${e instanceof Error ? e.message : ''}`); }
  }, [store, tAttr, tfAttr]);

  // 인식 실패 표면화(진단) — 스트리밍 중 반복 방지 위해 4초 스로틀
  const onSttError = useCallback((e: unknown) => {
    store.fail();
    const now = Date.now();
    if (now - errToastRef.current > 4000) {
      errToastRef.current = now;
      const msg = e instanceof Error ? e.message : '';
      toast.error(`음성 인식 오류${msg ? `: ${msg}` : ' — 마이크·네트워크 확인'}`);
    }
  }, [store]);

  const voice = useVoiceCommand({ enabled: active, ptt: true, sendChunk, onPartial: (t, c) => store.setPartial(t, c), onFinal, onLevel: (l) => store.setLevel(l), onError: onSttError });

  const start = useCallback(async () => {
    try {
      // mode 를 지정하지 않는다 — 서버가 **개인 기본 모드**(설정 패널 '기본 모드')를, 없으면 READ 를 쓴다.
      // 🔴 종전엔 항상 'read' 를 박아 보냈다. 그 위에서 dictate outcome 이 게이트 없이 화면으로 나갔고(§13.2 P0-1),
      //    이제 서버 parse 는 세션 mode≠DICTATE 이면 구술을 hold 로 바꾸므로 구술을 쓰려면 세션이 DICTATE 여야 한다.
      //    기본 모드가 구술/명령인데 그 게이트가 OFF 면(403) READ 로 다시 시작하고 **그 사실을 말한다** — 조회는 전 의료진 개방이다.
      let s: Awaited<ReturnType<typeof voiceApi.start>>;
      try {
        s = await voiceApi.start(encounterId);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : '';
        if (code !== 'VOICE_DICTATE_OFF' && code !== 'VOICE_ORDER_OFF') throw e;
        toast.info(code === 'VOICE_DICTATE_OFF'
          ? tAttr('구술이 관리자 설정에서 비활성 상태입니다 — 조회 명령 인식 모드로 시작합니다(결과는 표시되지 않습니다)')
          : tAttr('음성 오더가 관리자 설정에서 비활성 상태입니다 — 조회 명령 인식 모드로 시작합니다(결과는 표시되지 않습니다)'));
        s = await voiceApi.start(encounterId, 'read');
      }
      sidRef.current = s.id;
      store.startSession({ id: s.id, encounterId, patient: s.patient as PatientRef }, toVoiceMode(s.mode));
      store.setWarm(true);
      setActive(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/DISABLED|비활성|403|Forbidden|PILOT/i.test(msg)) toast.info(tAttr('음성 기능이 비활성 상태입니다(관리자 설정 대기).'));
      else toast.error(`음성 세션 시작 실패: ${msg || tAttr('알 수 없는 오류')}`);
    }
  }, [encounterId, store, tAttr]);

  const stop = useCallback(async () => {
    setActive(false);
    await voice.end();
    if (sidRef.current) { void voiceApi.close(sidRef.current).catch(() => undefined); sidRef.current = ''; }
    store.endSession();
    onExit?.();
  }, [voice, store, onExit]);

  // 허브에서 '명령·구술' 선택 시 자동 시작(1회) — 팝오버 닫히고 인라인으로 수행
  useEffect(() => {
    if (autoStart && !startedRef.current) { startedRef.current = true; void start(); }
  }, [autoStart, start]);

  const doConfirm = useCallback(async () => {
    const card = store.confirm;
    if (!card || !sidRef.current) return;
    // 구술: 필드 미선택·빈 본문이면 확정하지 않는다(카드 버튼도 막지만, 스토어 경로로 들어와도 같은 판정).
    if (card.kind === 'dictate' && (!card.field || !(card.editedText ?? card.text).trim())) return;
    try {
      const r = await voiceApi.confirm(sidRef.current, { intent: card.kind, slots: card as unknown as object, resultKind: `${card.kind}_draft` });
      // T1 활력: 서버가 정본에 기록 완료. T3 오더: 정본 CPOE EP 로 제출해야 함(step-up·DUR 강제) —
      // 자동 제출하지 않고 안내만(오더는 처방 화면에서 확정하는 것이 안전 규약).
      // T2 구술: 서버는 게이트 재확인+로그만 — SOAP 반영은 여기서 **append** 콜백으로(부모가 정본 appendSoap 를 댄다).
      if (card.kind === 'dictate' && card.field) {
        onApplySoap?.(card.field, (card.editedText ?? card.text).trim());
        toast.success(tAttr('구술을 반영했습니다 — 검토 후 서명하세요.'));
      }
      else if (r?.written?.kind === 'VITALS') toast.success(r.idempotent ? tAttr('이미 기록된 활력입니다.') : tAttr('활력을 기록했습니다.'));
      else if (r?.handoff) {
        // 파싱된 오더를 처방 폼으로 넘겨 프리필(코드→ID·DUR·step-up 은 처방 폼/정본 EP 에서 강제).
        if (onOrderDraft) onOrderDraft(r.handoff.payload);
        else toast.info(tAttr('오더는 처방 입력에서 확정하세요(DUR·승인 절차 적용).'));
      }
      else toast.success(tAttr('확정(초안)'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'VOICE_DICTATE_OFF') toast.warning(tAttr('구술이 관리자 설정에서 비활성 상태입니다 — 이 발화는 기록되지 않았습니다'));
      else if (msg.includes('VOICE_WRITE_OFF')) toast.warning(tAttr('음성 활력 입력이 관리자 설정에서 비활성 상태입니다.'));
      else if (msg.includes('VOICE_ORDER_OFF')) toast.warning(tAttr('음성 오더가 관리자 설정에서 비활성 상태입니다.'));
      else if (msg.includes('VOICE_VITAL_UNSUPPORTED')) toast.warning(tAttr('음성으로 기록할 수 없는 항목입니다(혈당 등은 해당 화면에서 입력).'));
      else toast.error(`확정 실패: ${msg}`);
    }
    store.confirmAction();
    store.cancel();
  }, [store, onOrderDraft, onApplySoap, tAttr]);

  const capturing = store.state === 'capturing';
  const lowConf = store.confidence !== null && store.confidence < 0.5;
  // 토글 방식 — 한 번 탭하면 말하기 시작, 다시 탭하면 종료(눌러-홀드 아님).
  const toggleTalk = () => {
    if (store.state === 'capturing') { void voice.end(); store.endCapture(); }
    else if (store.state === 'listening') { store.beginCapture(); void voice.begin(); }
  };
  return (
    <>
      {!active ? (
        <button type="button" onClick={start} className="rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap bg-gray-900 text-white hover:bg-gray-700 transition">
          🎤 <T k="음성 시작" />
        </button>
      ) : (
        // 상단 인라인 통합 — VU 레벨 + 눌러 말하기(PTT) + 자막 + 마이크설정 + 종료. 하단 오버레이 제거(비차단).
        <span ref={micBoxRef} className="relative inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 whitespace-nowrap">
          <span className="text-[11px] font-semibold text-indigo-700">🎤 <T k="음성" /></span>
          <span className="flex items-end gap-[2px] h-4" aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => {
              const shape = 0.4 + 0.6 * Math.sin((i / 11) * Math.PI);
              const h = capturing ? Math.max(2, Math.min(16, store.level * 16 * shape)) : 2;
              const hot = capturing && store.level * shape > 0.45;
              return <span key={i} style={{ height: `${h}px` }} className={`w-[2px] rounded-full transition-[height] duration-75 ${hot ? 'bg-rose-500' : capturing ? 'bg-indigo-400' : 'bg-indigo-200'}`} />;
            })}
          </span>
          <span className="text-[10px] tabular-nums text-indigo-400 w-7 text-right">{capturing ? `${Math.round(store.level * 100)}%` : store.state === 'warming' ? tAttr('준비') : tAttr('대기')}</span>

          {/* 말하기 토글 — 탭하여 시작/종료 */}
          <button type="button" onClick={toggleTalk} disabled={store.state === 'warming'}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${capturing ? 'bg-rose-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'}`}>
            {capturing ? tAttr('● 말하는 중 · 탭하여 종료') : tAttr('🎙️ 탭하여 말하기')}
          </button>

          {/* 마이크 설정 */}
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} className={`text-xs ${settingsOpen ? 'text-indigo-700' : 'text-indigo-400 hover:text-indigo-600'}`} title={tAttr('마이크 설정')}>⚙</button>
          <button type="button" onClick={stop} className="text-indigo-400 hover:text-rose-500 text-xs" title={tAttr('음성 종료')}>✕</button>

          {/* 라이브 자막(비차단·아래 드롭다운) */}
          {(store.partial || capturing || lowConf) && (
            <div className="absolute left-0 top-full mt-1.5 w-[min(520px,78vw)] rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur px-3 py-2 z-50 text-left whitespace-normal">
              {store.partial ? (
                <p aria-live="polite" className="text-sm text-gray-800 leading-relaxed">{store.partial}</p>
              ) : (
                <p className="text-xs text-gray-400">{capturing ? tAttr('듣는 중…') : tAttr('눌러서 말하면 인식됩니다')}</p>
              )}
              {lowConf && <p className="text-[11px] text-amber-600 mt-1"><T k="인식 신뢰도 낮음 — 또박또박 다시 말씀해 주세요" /></p>}
            </div>
          )}

          {/* 마이크 설정 팝오버 */}
          {settingsOpen && (
            <div className={`absolute ${micAlignClass} top-full mt-1.5 w-[330px] z-50`} onClick={(e) => e.stopPropagation()}>
              <MicSettings />
            </div>
          )}
        </span>
      )}

      {store.confirm && (
        <VoiceConfirmCard
          card={store.confirm}
          onSelect={(code, li) => store.selectCandidate(code, li)}
          onAckHighAlert={(v) => store.ackHighAlert(v)}
          onDictateField={(f) => store.setDictateField(f)}
          onDictateText={(t) => store.setDictateText(t)}
          onConfirm={doConfirm}
          onCancel={() => store.cancel()}
        />
      )}
    </>
  );
}
