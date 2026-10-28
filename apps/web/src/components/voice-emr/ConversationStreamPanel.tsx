'use client';
/**
 * 앰비언트 대화 스트림 패널 — 진료 화면 우측(타과협진 아래).
 * 의사·환자 대화를 발화 카드로 실시간 나열(화자 추정↔토글·수정/삭제·NER 칩·갭 마커).
 * 기본 숨김 — VoiceHub '대화 기록' 선택(CustomEvent 'voice:ambient-open') 시 표시·시작.
 * SOAP 반영(단건/전체 분석)은 P1. 기획: voice-emr-ambient-conversation.plan.md §3
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { toast } from '@/stores/toast-store';
import { voiceApi, ambientApi, type AmbientEntities, type AmbientAnalysis, type SoapField } from '@/lib/voice-api';
import RecordingConsentGate from '@/components/scribe/RecordingConsentGate';
import { useAmbientCapture, type AmbientChunkResult, type FinalReason } from './useAmbientCapture';
import { guessSpeaker, type AmbientSpeaker } from './speaker-heuristic';
import { fieldTexts } from './ambient-chip-text';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/** 반영 provenance 기록이 실패한 건 — 텍스트는 이미 SOAP 에 들어갔다(되돌리지 않는다). 재시도 재료. */
interface ProvenanceFailure { field: SoapField; text: string; sourceSeqs?: number[]; engine: 'RULE' | 'AI' }

function int16ToBase64(a: Int16Array): string {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = '';
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(bin);
}

interface Utt {
  seq: number;
  at: string; // HH:MM
  text: string;
  editedText?: string | null;
  speaker: AmbientSpeaker;
  manual?: boolean;
  confidence?: number;
  droppedSec?: number;
  entities?: AmbientEntities | null;
  saveFailed?: boolean;
  forced?: boolean; // 25s 분절 이어짐
}

const FIELD_LABEL: Record<SoapField, string> = { subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' };
const FIELD_NAME: Record<SoapField, string> = { subjective: '주관적 증상', objective: '객관적 소견', assessment: '평가/진단', plan: '치료 계획' };

const SPEAKER_UI: Record<AmbientSpeaker, { label: string; cls: string }> = {
  DOCTOR: { label: '의사', cls: 'bg-indigo-100 text-indigo-700' },
  PATIENT: { label: '환자', cls: 'bg-emerald-100 text-emerald-700' },
  UNKNOWN: { label: '미상', cls: 'bg-gray-100 text-gray-500' },
};
const NEXT_SPEAKER: Record<AmbientSpeaker, AmbientSpeaker> = { UNKNOWN: 'DOCTOR', DOCTOR: 'PATIENT', PATIENT: 'UNKNOWN' };

/** 발화 단건 → [S/O/P에 반영] 버튼(경로 A). O·P 는 환자 발화면 1회 확인(§3.4 오귀속 방어) */
function ApplyButtons({ e, speaker, onApply }: { e: AmbientEntities; speaker: AmbientSpeaker; onApply: (f: SoapField, t: string) => void }) {
  const items = fieldTexts(e);
  if (!items.length) return null;
  const guard = (f: SoapField) => {
    if (speaker === 'PATIENT' && (f === 'objective' || f === 'plan')) {
      return confirm(`환자 발화로 추정된 내용을 ${FIELD_LABEL[f]}(${FIELD_NAME[f]})에 반영합니다.\n환자 진술을 의료진 소견/계획으로 기록하면 임상 왜곡이 될 수 있습니다.\n\n계속하시겠습니까?`);
    }
    return true;
  };
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((it) => (
        <button key={it.field} type="button" onClick={() => { if (guard(it.field)) onApply(it.field, it.text); }}
          title={it.text}
          className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 font-medium">
          {FIELD_LABEL[it.field]}에 반영
        </button>
      ))}
    </div>
  );
}

function EntityChips({ e }: { e: AmbientEntities }) {
  const chips: { label: string; cls: string }[] = [];
  e.symptoms.forEach((s) => chips.push({ label: `증상 ${s.term}${s.negated ? ' [부정]' : ''}`, cls: s.negated ? 'bg-gray-100 text-gray-500' : 'bg-rose-50 text-rose-700' }));
  e.vitals.forEach((v) => chips.push({ label: `활력 ${v.type} ${v.value.join('/')}`, cls: 'bg-sky-50 text-sky-700' }));
  e.medications.forEach((m) => chips.push({ label: `약물 ${m.name}`, cls: 'bg-amber-50 text-amber-700' }));
  e.plan.forEach((p) => chips.push({ label: `계획 ${p.text.length > 14 ? p.text.slice(0, 14) + '…' : p.text}`, cls: 'bg-violet-50 text-violet-700' }));
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((c, i) => (
        <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${c.cls}`}>🔎 {c.label}</span>
      ))}
    </div>
  );
}

export interface ConversationStreamPanelProps {
  encounterId: string;
  /** SOAP 필드 말미 append(덮어쓰기 금지) — 반영은 의사 탭으로만(DRAFT-only) */
  onAppendSoap?: (field: SoapField, text: string) => void;
  /** G5 — 전사 누락 미확인 시 서명 차단 신호 */
  onGateChange?: (gate: { blocked: boolean; reason?: string }) => void;
}

export default function ConversationStreamPanel({ encounterId, onAppendSoap, onGateChange }: ConversationStreamPanelProps) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'closed'>('idle');
  const [showConsent, setShowConsent] = useState(false);
  const [patientRef, setPatientRef] = useState<{ name: string; mrn: string } | null>(null);
  const [utts, setUtts] = useState<Utt[]>([]);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'CONSENT' | null>(null); // CONSENT=동의 접수 화면 링크를 함께 그린다
  const [provenanceFailed, setProvenanceFailed] = useState<ProvenanceFailure[]>([]); // 반영 출처 기록 실패분(재시도 목록)
  const [retryingProvenance, setRetryingProvenance] = useState(false);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [analysis, setAnalysis] = useState<AmbientAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]); // 건너뛴 제안 키
  const [dropAck, setDropAck] = useState(false);            // 전사 누락 확인(G5)
  const [highlightSeqs, setHighlightSeqs] = useState<number[]>([]);
  const sidRef = useRef<string | null>(null);      // ambient(ScribeSession)
  const voiceSidRef = useRef<string | null>(null); // STT(VoiceCommandSession)
  const stopRef = useRef<(() => Promise<void>) | null>(null); // 킬스위치 발화 시 캡처 자동 종료(onFinal 은 [] deps)
  const seqRef = useRef(0);
  const lastPartialRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);

  const sendChunk = useCallback(async (mode: 'partial' | 'final', pcm: Int16Array): Promise<AmbientChunkResult> => {
    if (!voiceSidRef.current) return {};
    return voiceApi.chunk(voiceSidRef.current, int16ToBase64(pcm), mode);
  }, []);

  const onFinal = useCallback((r: AmbientChunkResult, reason: FinalReason) => {
    const text = (r.text || lastPartialRef.current || '').trim();
    lastPartialRef.current = '';
    setPartial('');
    if (!text || !sidRef.current) return;
    const seq = seqRef.current++;
    const speaker = guessSpeaker(text);
    const utt: Utt = {
      seq,
      at: kdate(new Date(), 'time'),
      text,
      speaker,
      confidence: r.confidence,
      droppedSec: r.dropped_s && r.dropped_s > 0 ? r.dropped_s : undefined,
      forced: reason === 'forced',
    };
    setUtts((prev) => [...prev, utt]);
    ambientApi
      .addUtterance(sidRef.current, { seq, text, speaker, confidence: r.confidence, droppedSec: utt.droppedSec })
      .then((res) => setUtts((prev) => prev.map((u) => (u.seq === seq ? { ...u, entities: res.entities } : u))))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('AMBIENT_DISABLED') || msg.includes('AMBIENT_NOT_PILOT')) {
          // 마스터 킬스위치 발화 — 즉시 녹음 종료(프라이버시). 저장 실패분은 표시 유지.
          setError(tAttr('대화 기록이 관리자 설정으로 중단되었습니다. 녹음을 종료합니다.'));
          setUtts((prev) => prev.map((u) => (u.seq === seq ? { ...u, saveFailed: true } : u)));
          void stopRef.current?.();
        } else {
          setUtts((prev) => prev.map((u) => (u.seq === seq ? { ...u, saveFailed: true } : u)));
        }
      });
  }, []);

  const capture = useAmbientCapture({
    sendChunk,
    onFinal,
    onPartial: (t) => { lastPartialRef.current = t; setPartial(t); },
    onError: () => setError(tAttr('음성 인식 오류 — 네트워크/STT 상태를 확인하세요.')),
  });
  const captureRef = useRef(capture); captureRef.current = capture;

  // 새 발화 시 자동 스크롤
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [utts.length, partial]);

  const start = useCallback(async () => {
    setError(null);
    setErrorKind(null);
    setPhase('starting');
    try {
      const s = await ambientApi.start(encounterId);
      sidRef.current = s.id;
      setPatientRef(s.patient ?? null);
      const v = await voiceApi.start(encounterId, 'read'); // STT 세션(warm 포함) 재사용
      voiceSidRef.current = v.id;
      await captureRef.current.begin();
      setPhase('recording');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('RECORDING_CONSENT_REQUIRED')) {
        setError(tAttr('진료 녹음 전용 동의(전자동의서)가 필요합니다. 동의 접수 후 다시 시작하세요.'));
        setErrorKind('CONSENT'); // 접수할 곳을 같이 가리킨다 — "접수 후 다시 시작하세요"만 있고 접수 화면이 없던 자리(§13.2 P0-2)
        toast.error(tAttr('녹음 동의가 필요합니다.'));
      } else if (msg.includes('AMBIENT_DISABLED')) {
        setError(tAttr('대화 기록 기능이 비활성 상태입니다(관리자 설정).'));
      } else if (msg.includes('AMBIENT_NOT_PILOT')) {
        setError(tAttr('대화 기록 파일럿 대상이 아닙니다.'));
      } else {
        setError(tAttr('대화 기록 시작 실패 — 잠시 후 다시 시도하세요.'));
      }
      setPhase('idle');
    }
  }, [encounterId, tAttr]);

  // VoiceHub '대화 기록' 진입(동의 UI 게이트 선행)
  useEffect(() => {
    const onOpen = () => { setVisible(true); if (phase === 'idle' || phase === 'closed') setShowConsent(true); };
    window.addEventListener('voice:ambient-open', onOpen);
    return () => window.removeEventListener('voice:ambient-open', onOpen);
  }, [phase]);

  // 언마운트(환자/화면 전환) 시 정리 — G3: 세션은 encounter 결속
  useEffect(() => () => { void captureRef.current.stop(); }, []);

  const pause = () => { capture.setPaused(true); setPhase('paused'); };
  const resume = () => { capture.setPaused(false); setPhase('recording'); };

  const stop = async () => {
    await capture.stop();
    const sid = sidRef.current;
    let saved = 0;
    if (sid) {
      try {
        const r = await ambientApi.close(sid);
        saved = r.utteranceCount;
        toast.success(`대화 기록 종료 — 발화 ${r.utteranceCount}건 저장`);
      } catch { toast.error(tAttr('세션 종료 저장 실패')); }
    }
    if (voiceSidRef.current) { void voiceApi.close(voiceSidRef.current); voiceSidRef.current = null; }
    setPhase('closed');
    if (saved > 0) void runAnalyze(); // 종료 시 제안 카드 1회 자동 제시(강제 아님·닫기 가능)
  };
  stopRef.current = stop; // onFinal(killswitch) 이 최신 stop 을 참조

  /**
   * 🔴 D7 — 아래 세 쓰기(화자 토글·삭제·반영 provenance)는 종전에 `.catch(() => {})` 였다(§13.2 P1-2).
   *    실패가 화면에서 사라지면: 삭제는 "지워진 척"(서버 `deleted=false`), 반영은 `aiScribed`·`appliedFields` 가 비어
   *    서명 시 편집거리가 영원히 null. 실패는 **되돌리고 말한다** — 낙관적 갱신은 유지하되 실패 시 이전 상태로.
   */
  const toggleSpeaker = (u: Utt) => {
    const next = NEXT_SPEAKER[u.speaker];
    const prevSpeaker = u.speaker;
    const prevManual = u.manual;
    setUtts((prev) => prev.map((x) => (x.seq === u.seq ? { ...x, speaker: next, manual: true } : x)));
    if (sidRef.current) {
      void ambientApi.patchUtterance(sidRef.current, u.seq, { speaker: next }).catch(() => {
        setUtts((prev) => prev.map((x) => (x.seq === u.seq ? { ...x, speaker: prevSpeaker, manual: prevManual } : x)));
        toast.error(tAttr('화자 변경이 서버에 저장되지 않았습니다 — 이전 화자로 되돌렸습니다.'));
      });
    }
  };

  const removeUtt = (u: Utt) => {
    const snapshot = u;
    setUtts((prev) => prev.filter((x) => x.seq !== u.seq));
    if (sidRef.current) {
      void ambientApi.patchUtterance(sidRef.current, u.seq, { deleted: true }).catch(() => {
        // 서버에는 남아 있다 — 화면에서만 지워진 상태를 두지 않는다(환자가 "지워 달라" 한 구간일 수 있다)
        setUtts((prev) => (prev.some((x) => x.seq === snapshot.seq) ? prev : [...prev, snapshot].sort((a, b) => a.seq - b.seq)));
        toast.error(tAttr('서버에서 삭제되지 않았습니다 — 발화가 기록에 남아 있어 카드를 복원했습니다.'));
      });
    }
  };

  // 반영(경로 A/B 공용) — 필드 append + provenance 기록(감사·Encounter aiScribed)
  const applyToSoap = useCallback((field: SoapField, text: string, sourceSeqs?: number[], engine: 'RULE' | 'AI' = 'RULE') => {
    if (!onAppendSoap) { toast.warning(tAttr('이 화면에서는 SOAP 자동 반영을 지원하지 않습니다.')); return; }
    onAppendSoap(field, text);
    toast.success(tfAttr('{항목}({영문})에 반영했습니다 — 검토 후 서명하세요.', { 항목: FIELD_LABEL[field], 영문: FIELD_NAME[field] }));
    if (sidRef.current) {
      const item: ProvenanceFailure = { field, text, sourceSeqs, engine };
      // 텍스트는 이미 SOAP 에 들어갔다 — 되돌리지 않고, 출처 기록이 빠졌다는 사실을 배너로 남긴다(재시도 목록)
      void ambientApi.apply(sidRef.current, item).catch(() => setProvenanceFailed((p) => [...p, item]));
    }
  }, [onAppendSoap, tAttr]);

  const retryProvenance = useCallback(async () => {
    const sid = sidRef.current;
    if (!sid || retryingProvenance) return;
    setRetryingProvenance(true);
    const pending = provenanceFailed;
    const stillFailed: ProvenanceFailure[] = [];
    for (const item of pending) {
      try { await ambientApi.apply(sid, item); } catch { stillFailed.push(item); }
    }
    setProvenanceFailed(stillFailed);
    setRetryingProvenance(false);
    if (stillFailed.length) toast.error(tfAttr('출처 기록 재시도 실패 — {건}건이 여전히 기록되지 않았습니다.', { 건: stillFailed.length }));
    else toast.success(tAttr('반영 출처가 서버에 기록되었습니다.'));
  }, [provenanceFailed, retryingProvenance, tAttr, tfAttr]);

  const runAnalyze = useCallback(async () => {
    if (!sidRef.current) return;
    setAnalyzing(true);
    try {
      const a = await ambientApi.analyze(sidRef.current);
      setAnalysis(a);
      if (!a.suggestions.length) toast.info(tAttr('분석 결과 제안할 항목이 없습니다.'));
    } catch {
      toast.error(tAttr('대화 분석에 실패했습니다.'));
    } finally { setAnalyzing(false); }
  }, [tAttr]);

  const saveEdit = (u: Utt) => {
    const t = editText.trim();
    setEditingSeq(null);
    if (!t || t === (u.editedText ?? u.text)) return;
    setUtts((prev) => prev.map((x) => (x.seq === u.seq ? { ...x, editedText: t } : x)));
    if (sidRef.current) {
      void ambientApi.patchUtterance(sidRef.current, u.seq, { text: t })
        .then((res) => setUtts((prev) => prev.map((x) => (x.seq === u.seq ? { ...x, entities: res.entities } : x))))
        .catch(() => toast.error(tAttr('발화 수정 저장 실패')));
    }
  };

  const droppedTotal = utts.reduce((n, u) => n + (u.droppedSec ?? 0), 0);
  const recording = phase === 'recording';

  // G5 — 전사 누락이 있으면 확인 전까지 서명 차단(누락 구간을 모르고 서명하는 것 방지)
  useEffect(() => {
    const blocked = droppedTotal > 0 && !dropAck;
    // 🔴 서명 차단 사유는 상위 게이트로 넘어가 **화면에 그대로 그려진다** — 로케일을 타야 한다
    onGateChange?.({
      blocked,
      reason: blocked
        ? tfAttr('대화 전사 누락 {초}초 — 진료 대화 패널에서 확인이 필요합니다', { 초: droppedTotal.toFixed(1) })
        : undefined,
    });
  }, [droppedTotal, dropAck, onGateChange, tfAttr]);

  if (!visible) return null;

  return (
    <div className="mt-4 pt-4 border-t" data-testid="conversation-stream">
      {showConsent && (
        <RecordingConsentGate
          onConsent={() => { setShowConsent(false); void start(); }}
          onClose={() => setShowConsent(false)}
        />
      )}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          💬 <T k="진료 대화" /> <span className="text-[10px] font-normal text-gray-400"><T k="(음성)" /></span>
          {recording && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> <T k="기록 중" />
            </span>
          )}
          {phase === 'paused' && <span className="text-[10px] font-bold text-amber-600"><T k="일시정지" /></span>}
          {phase === 'closed' && <span className="text-[10px] text-gray-400"><T k="종료됨" /></span>}
        </h4>
        <div className="flex items-center gap-1.5">
          {utts.length > 0 && <span className="text-[10px] text-gray-400">{utts.length}발화</span>}
          {recording && <button type="button" onClick={pause} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">∥ <T k="일시정지" /></button>}
          {phase === 'paused' && <button type="button" onClick={resume} className="text-[11px] px-2 py-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-700">▶ <T k="재개" /></button>}
          {utts.length > 0 && (
            <button type="button" onClick={runAnalyze} disabled={analyzing}
              className="text-[11px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {analyzing ? <T k="분석 중…" /> : <>▶ <T k="SOAP 분석" /></>}
            </button>
          )}
          {(recording || phase === 'paused') && <button type="button" onClick={stop} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-900 text-white hover:bg-gray-700">■ <T k="종료@녹음" /></button>}
          {(phase === 'idle' || phase === 'closed') && <button type="button" onClick={() => setShowConsent(true)} className="text-[11px] px-2 py-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-700">🎙️ {phase === 'closed' ? <T k="새 기록@녹음" /> : <T k="시작" />}</button>}
          <button type="button" onClick={() => setVisible(false)} className="text-gray-300 hover:text-gray-500 text-xs" title={tAttr('패널 숨기기')}>✕</button>
        </div>
      </div>

      {/* G3 — 환자 신원 고정 표기 */}
      {patientRef && (
        <p className="text-[10px] text-gray-400 mb-2"><T k="환자" /> <b className="text-gray-600">{patientRef.name}</b> · {patientRef.mrn} — <T k="대화가 이 환자 기록에 저장됩니다" /></p>
      )}
      {error && (
        <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
          {error}
          {errorKind === 'CONSENT' && (
            <>
              {' '}
              <Link href="/workstation/consent" className="underline font-semibold text-amber-800 hover:text-amber-900" data-testid="consent-workstation-link">
                <T k="동의서 접수 화면으로 이동(녹음 동의)" />
              </Link>
            </>
          )}
        </p>
      )}
      {provenanceFailed.length > 0 && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mb-2 flex items-start justify-between gap-2" data-testid="provenance-failed">
          <span>
            ⚠ <Tf k="출처 기록 실패 {건}건 — 서명 시 수정량을 계측하지 못합니다(텍스트는 SOAP에 남아 있습니다)." params={{ 건: provenanceFailed.length }} />
          </span>
          <button type="button" onClick={() => void retryProvenance()} disabled={retryingProvenance}
            className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
            <T k="출처 다시 기록" />
          </button>
        </div>
      )}
      {droppedTotal > 0 && (
        <div className={`text-[11px] rounded-lg px-2.5 py-1.5 mb-2 flex items-start justify-between gap-2 ${dropAck ? 'text-gray-500 bg-gray-50 border border-gray-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>
          <span>⚠ <T k="전사 누락" /> {droppedTotal.toFixed(1)}<Unit>초</Unit> — <T k="해당 구간 내용을 확인하세요" />{dropAck ? <> <T k="(확인됨)" /></> : <> <T k="(확인 전 서명 차단)" /></>}</span>
          {!dropAck && (
            <button type="button" onClick={() => setDropAck(true)} className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-600 text-white hover:bg-amber-700"><T k="확인했습니다" /></button>
          )}
        </div>
      )}

      {(utts.length > 0 || partial || recording) && (
        <div ref={listRef} className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
          {utts.map((u) => {
            const sp = SPEAKER_UI[u.speaker];
            const low = (u.confidence ?? 1) < 0.5;
            return (
              <div key={u.seq} className={`group rounded-lg border px-2.5 py-1.5 transition ${highlightSeqs.includes(u.seq) ? 'border-indigo-300 bg-indigo-50/70 ring-1 ring-indigo-200' : u.saveFailed ? 'border-rose-200 bg-rose-50/50' : 'border-gray-100 bg-gray-50/60'}`}>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-gray-400 pt-0.5 shrink-0 tabular-nums">{u.at}</span>
                  <button type="button" onClick={() => toggleSpeaker(u)} title={tAttr('화자 정정(탭)')}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${sp.cls} hover:ring-1 hover:ring-gray-300`}>
                    <T k={sp.label} />{u.manual ? '' : '↔'}
                  </button>
                  {editingSeq === u.seq ? (
                    <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => saveEdit(u)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(u); } }}
                      className="flex-1 text-xs border rounded-md px-1.5 py-1 resize-none" rows={2} />
                  ) : (
                    <p className={`flex-1 text-xs leading-relaxed ${low ? 'text-gray-400' : 'text-gray-800'}`}>
                      {u.editedText ?? u.text}
                      {u.editedText && <span className="text-[9px] text-gray-400 ml-1"><T k="(수정됨)" /></span>}
                      {u.forced && <span className="text-[9px] text-gray-400 ml-1"><T k="(이어짐)" /></span>}
                      {u.saveFailed && <span className="text-[9px] text-rose-500 ml-1"><T k="저장 실패" /></span>}
                    </p>
                  )}
                  <span className="opacity-0 group-hover:opacity-100 transition flex gap-1 shrink-0">
                    <button type="button" onClick={() => { setEditingSeq(u.seq); setEditText(u.editedText ?? u.text); }} className="text-gray-300 hover:text-gray-600 text-[11px]" title={tAttr('수정@동작')}>✏️</button>
                    <button type="button" onClick={() => removeUtt(u)} className="text-gray-300 hover:text-rose-500 text-[11px]" title={tAttr('삭제(기록 제외)')}>🗑</button>
                  </span>
                </div>
                {u.droppedSec ? <p className="text-[10px] text-amber-600 mt-0.5 ml-9">⚠ <T k="직전" /> {u.droppedSec.toFixed(1)}<Unit>초</Unit> <T k="전사 누락" /></p> : null}
                {u.entities && (
                  <div className="ml-9">
                    <EntityChips e={u.entities} />
                    <ApplyButtons e={u.entities} speaker={u.speaker} onApply={(f, t) => applyToSoap(f, t, [u.seq], 'RULE')} />
                  </div>
                )}
              </div>
            );
          })}
          {partial && (
            <p className="text-xs text-gray-400 italic px-2.5">{partial} …</p>
          )}
          {recording && !partial && utts.length === 0 && (
            <p className="text-[11px] text-gray-400 px-2.5 py-2"><T k="대화를 시작하세요 — 발화가 여기에 실시간으로 기록됩니다." /></p>
          )}
        </div>
      )}
      {/* 경로 B — 전체 분석 제안 카드(필드별 diff·출처 역추적·항상 사람 확정) */}
      {analysis && (
        <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-indigo-900">
              🤖 <T k="SOAP 초안 제안" />{' '}
              <span className="font-normal text-indigo-500">
                {/* D2 — 분모 병기: 0발화는 "0발화 중 0발화"가 아니라 산출 불가(CLAUDE.md §1) */}
                {analysis.coverage.utterances > 0 ? (
                  <Tf k="({전체}발화 중 {제안}발화에서 제안 · {엔진})" params={{ 전체: analysis.coverage.utterances, 제안: analysis.coverage.withEntities, 엔진: analysis.engine === 'RULE+AI' ? `${AI_ORIGIN_TEXT}+규칙` : '규칙' }} />
                ) : (
                  <T k="(산출 불가 · 발화 없음)" />
                )}
              </span>
            </span>
            <button type="button" onClick={() => setAnalysis(null)} className="text-indigo-300 hover:text-indigo-500 text-xs" title={tAttr('닫기')}>✕</button>
          </div>

          {analysis.suggestions.filter((s) => !dismissed.includes(`${s.field}|${s.engine}|${s.text}`)).length === 0 ? (
            <p className="text-[11px] text-gray-500"><T k="반영할 제안이 없습니다." /></p>
          ) : (
            <div className="space-y-1.5">
              {analysis.suggestions
                .filter((s) => !dismissed.includes(`${s.field}|${s.engine}|${s.text}`))
                .map((s) => {
                  const k = `${s.field}|${s.engine}|${s.text}`;
                  return (
                    <div key={k} className="rounded-lg bg-white border border-indigo-100 px-2 py-1.5"
                      onMouseEnter={() => setHighlightSeqs(s.sourceSeqs)} onMouseLeave={() => setHighlightSeqs([])}>
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0">{FIELD_LABEL[s.field]}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-800 whitespace-pre-wrap break-words">{s.text}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {s.engine === 'AI' ? <T k="AI 제안" /> : <T k="규칙 추출" />}
                            {s.sourceSeqs.length > 0 && ` · 출처 발화 ${s.sourceSeqs.map((n) => n + 1).join(', ')}`}
                            {s.note && ` · ${s.note}`}
                          </p>
                        </div>
                        <span className="flex gap-1 shrink-0">
                          <button type="button" onClick={() => { applyToSoap(s.field, s.text, s.sourceSeqs, s.engine); setDismissed((p) => [...p, k]); }}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-700"><T k="반영" /></button>
                          <button type="button" onClick={() => setDismissed((p) => [...p, k])}
                            className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"><T k="건너뛰기" /></button>
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-gray-400">
              <T k="반영은 기존 내용" /> <b><T k="뒤에 덧붙여집니다" /></b><T k="(덮어쓰기 없음). 검토·수정 후 서명하세요." />
              {analysis.coverage.lowConfidence > 0 && ` · 저신뢰 발화 ${analysis.coverage.lowConfidence}건 분석 제외`}
              {analysis.skipped.length > 0 && ` · 환자 발화 수치/계획 ${analysis.skipped.length}건은 자동 제안에서 제외(칩으로 직접 반영 가능)`}
              {/* D5 — AI 로 나간 텍스트에서 무엇을 얼마나 지웠는지(null=보내지 않았다 · 0=지울 것이 없었다) */}
              {analysis.redacted && (
                <span data-testid="ai-redacted"> · <Tf k="AI 전송 전 비식별 — 이름 {이름}건 · 식별자 {식별자}건 치환" params={{ 이름: analysis.redacted.names, 식별자: analysis.redacted.ids }} /></span>
              )}
              {analysis.aiSkipped === 'NAMES_UNAVAILABLE' && <span data-testid="ai-skipped"> · <T k="AI 제안 생략 — 환자·의료진 이름을 조회하지 못해 비식별 없이 보내지 않았습니다." /></span>}
              {analysis.aiSkipped === 'AI_ERROR' && <span data-testid="ai-skipped"> · <T k="AI 제안 생략 — AI 서버 호출 실패(규칙 제안만)." /></span>}
            </p>
            {analysis.suggestions.filter((s) => !dismissed.includes(`${s.field}|${s.engine}|${s.text}`)).length > 1 && (
              <button type="button"
                onClick={() => {
                  const live = analysis.suggestions.filter((s) => !dismissed.includes(`${s.field}|${s.engine}|${s.text}`));
                  live.forEach((s) => applyToSoap(s.field, s.text, s.sourceSeqs, s.engine));
                  setDismissed((p) => [...p, ...live.map((s) => `${s.field}|${s.engine}|${s.text}`)]);
                }}
                className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-white hover:bg-gray-700"><T k="모두 반영" /></button>
            )}
          </div>
        </div>
      )}

      {phase === 'closed' && utts.length > 0 && !analysis && (
        <p className="text-[10px] text-gray-400 mt-2"><T k="기록이 저장되었습니다. [SOAP 분석]으로 초안 제안을 다시 볼 수 있습니다." /></p>
      )}
    </div>
  );
}
