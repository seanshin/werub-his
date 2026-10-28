'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { voiceApi, type EnrollStatus } from '@/lib/voice-api';
import { toast } from '@/stores/toast-store';
import { frameToPcm16 } from './audio-pcm';
import { BiometricConsentModal } from './BiometricConsentModal';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/**
 * 등록 연습 문장 — 음소·임상어휘 커버리지(혈압·처방·검사). 낭독으로 성문 표본 확보.
 * 🔴 **번역하지 않는다**(i18n 배선 제외). 이 문장은 읽는 것이 아니라 **소리 내어 말하는 것**이고,
 *    성문/STT 는 한국어 음소를 기준으로 표본을 만든다. 번역문을 읽으면 등록된 성문이 달라진다.
 */
const PROMPTS = [
  '안녕하세요, 저는 담당 의료진입니다. 지금부터 음성 등록을 시작하겠습니다.',
  '환자분의 혈압은 백이십에 팔십, 맥박은 분당 칠십이 회입니다.',
  '타이레놀 오백 밀리그램, 하루 세 번, 식후 삼십 분에 복용하십시오.',
  '흉부 엑스레이와 심전도 검사를 오더 내겠습니다.',
  '특이사항 없으며, 경과 관찰 후 재평가하겠습니다.',
];

const MAX_MS = 6000; // 표본 자동 종료
const int16ToBase64 = (a: Int16Array) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

export function SpeakerEnrollment() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  /**
   * 🔴 `useTAttr()` 는 렌더마다 **새 함수**를 돌려준다. 그것을 `load` 의 의존성에 넣으면
   *    `load` 가 렌더마다 바뀌고 → `useEffect([load])` 가 렌더마다 다시 돌아 → 조회 → `setSt(새 객체)`
   *    → 재렌더 → … **등록 현황 조회가 끝없이 반복됐다**(녹음 중엔 레벨 미터가 초당 수십 번 렌더한다).
   *    라운드 4 배선이 `[]` 를 `[tAttr]` 로 바꾸며 생긴 회귀다. 조회 함수는 ref 로 최신 번역만 읽는다.
   */
  const tAttrRef = useRef(tAttr);
  tAttrRef.current = tAttr;
  const [st, setSt] = useState<EnrollStatus | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [promptIdx, setPromptIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const rec = useRef<{ ctx: AudioContext; stream: MediaStream; proc: ScriptProcessorNode; frames: Int16Array[]; timer: ReturnType<typeof setTimeout> } | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    // 🔴 실패를 조용히 삼키면 화면이 영원히 '불러오는 중…' 이었다 — 실패는 실패라고 말한다.
    try { setSt(await voiceApi.enrollStatus()); setLoadError(null); }
    catch (e) {
      const tAttr = tAttrRef.current; // 렌더마다 새 함수 — 의존성에 넣지 않고 ref 로 최신 로케일만 읽는다
      setLoadError(e instanceof Error ? e.message : tAttr('등록 현황을 불러오지 못했습니다'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const teardown = useCallback(() => {
    const r = rec.current; rec.current = null;
    if (!r) return null;
    clearTimeout(r.timer);
    r.proc.disconnect();
    const total = r.frames.reduce((n, f) => n + f.length, 0);
    const pcm = new Int16Array(total);
    let off = 0; for (const f of r.frames) { pcm.set(f, off); off += f.length; }
    r.ctx.close().catch(() => {});
    r.stream.getTracks().forEach((t) => t.stop());
    return pcm;
  }, []);

  const stopAndSubmit = useCallback(async () => {
    setRecording(false); setLevel(0);
    const pcm = teardown();
    if (!pcm || pcm.length < 16000 * 1.2) { toast.info(tAttr('표본이 너무 짧습니다 — 문장을 끝까지 읽어주세요.')); return; }
    setBusy(true);
    try {
      const r = await voiceApi.enrollSample(int16ToBase64(pcm), 16000, `p${promptIdx}`);
      // 🔴 종전엔 서버가 표본을 받지 못해도 "표본 N개 저장됨" 이라 알렸다 — 저장된 곳이 없었다.
      if (!r.accepted) toast.error(r.message ?? tAttr('성문 서버가 표본을 받지 못했습니다 — 저장되지 않았습니다.'));
      else toast.success(tfAttr('표본 {현재}/{최소} 등록됨', { 현재: String(r.sampleCount), 최소: String(r.minSamples) }));
      setPromptIdx((i) => (i + 1) % PROMPTS.length);
      await load();
    } catch (e) {
      toast.error(tfAttr('표본 등록 실패: {사유}', { 사유: e instanceof Error ? e.message : '' }));
    } finally { setBusy(false); }
  }, [teardown, promptIdx, load, tAttr, tfAttr]);

  const startRecording = useCallback(async () => {
    if (recording || busy) return;
    try {
      const deviceId = localStorage.getItem('voice.micDeviceId') || undefined;
      const gain = Number(localStorage.getItem('voice.micGain')) || 1;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const frames: Int16Array[] = [];
      let peak = 0;
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        frames.push(frameToPcm16(ch, ctx.sampleRate));
        let sum = 0, p = 0; for (let i = 0; i < ch.length; i++) { const v = ch[i]; sum += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
        peak = Math.max(peak * 0.85, p);
        setLevel(Math.min(1, (Math.pow(Math.sqrt(sum / ch.length), 0.5) * 2.4 + peak * 0.6) * gain));
      };
      src.connect(proc); proc.connect(ctx.destination);
      const timer = setTimeout(() => { void stopAndSubmit(); }, MAX_MS);
      rec.current = { ctx, stream, proc, frames, timer };
      setRecording(true);
    } catch { toast.error(tAttr('마이크를 사용할 수 없습니다. 권한/장치를 확인하세요.')); }
  }, [recording, busy, stopAndSubmit, tAttr]);

  useEffect(() => () => { teardown(); }, [teardown]);

  const agree = useCallback(async () => {
    setShowConsent(false);
    try { setSt(await voiceApi.enrollConsent(true, st?.requiredConsentVersion)); toast.success(tAttr('동의 완료 — 문장을 읽어 등록을 진행하세요.')); }
    catch (e) { toast.error(tfAttr('동의 처리 실패: {사유}', { 사유: e instanceof Error ? e.message : '' })); }
  }, [st, tAttr, tfAttr]);

  /**
   * 철회 실행 — 🔴 **철회 ≠ 파기.** 동의 철회는 로컬에서 끝나지만 AI 서버 성문이 지워졌는지는 다른 사실이다.
   * 종전엔 서버 결과를 보지 않고 무조건 '철회·삭제 완료' 를 띄웠다. 파기 미완료면 그대로 말하고 재시도를 남긴다.
   */
  const applyRevoke = useCallback(async (retry: boolean) => {
    try {
      const next = await voiceApi.enrollRevoke();
      setSt(next);
      setPromptIdx(0);
      if (next.remotePurgePending) toast.error(tAttr('동의는 철회했지만 AI 서버의 성문 파기는 확인되지 않았습니다 — 다시 시도해주세요.'));
      else toast.success(retry ? tAttr('성문 파기 완료') : tAttr('철회·삭제 완료'));
    } catch (e) { toast.error(tfAttr('철회 실패: {사유}', { 사유: e instanceof Error ? e.message : '' })); }
  }, [tAttr, tfAttr]);

  const revoke = useCallback(async () => {
    if (!window.confirm(tAttr('음성 등록을 철회하고 성문·표본을 삭제할까요? (되돌릴 수 없음)'))) return;
    await applyRevoke(false);
  }, [applyRevoke, tAttr]);

  const complete = useCallback(async () => {
    try { setSt(await voiceApi.enrollComplete()); toast.success(tAttr('음성 등록 완료 🎉')); }
    catch (e) { toast.error(tfAttr('완료 실패: {사유}', { 사유: e instanceof Error ? e.message : '' })); }
  }, [tAttr, tfAttr]);

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <T k="등록 현황을 불러오지 못했습니다" /> — <span className="text-[12px] text-rose-500">{loadError}</span>
        <button type="button" onClick={() => void load()} className="ml-2 rounded-full border border-rose-300 bg-white px-3 py-1 text-[12px]"><T k="다시 시도" /></button>
      </div>
    );
  }
  if (!st) return <div className="rounded-2xl border p-4 text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  const enrolled = st.status === 'enrolled';
  // 성문이 서버에 없으면 완료할 수 없다(서버도 ENROLL_NO_VOICEPRINT 로 거절) — 누를 수 있게 두지 않는다.
  const canComplete = st.consented && st.sampleCount >= st.minSamples && !enrolled && st.voiceprintPresent !== false;
  const pct = Math.min(100, Math.round((st.sampleCount / st.minSamples) * 100));

  return (
    <div className="rounded-2xl border p-4 space-y-4">
      {/* 상태 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900"><T k="화자 음성 등록 (성문)" /></span>
            {enrolled ? <span className="rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold px-2 py-0.5">● <T k="등록됨" /></span>
              : st.status === 'pending' ? <span className="rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5"><T k="진행 중" /></span>
              : <span className="rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold px-2 py-0.5"><T k="미등록" /></span>}
          </div>
          <p className="text-[12px] text-gray-500 mt-0.5"><T k="본인 음성을 등록하면 다인 환경에서" /> <b><T k="내 음성만" /></b> <T k="선별 인식합니다. 미등록 시 마이크 분리 방식으로 이용됩니다." /></p>
        </div>
      </div>

      {/* 🔴 과거 fail-open 흔적 — 표본만 쌓이고 성문은 서버에 없는 상태. '등록됨'이라 말하지 않고 이유를 밝힌다. */}
      {st.voiceprintMissing && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <T k="이전에" /> <b><T k="등록 완료로 기록" /></b><T k="되었으나, 성문(음성 지문)이 AI 서버에 없습니다 —" /> <b><T k="화자 인식은 동작하지 않습니다." /></b>
          <Tf k="표본 {개수}개는 등록 시도 기록일 뿐 성문이 아닙니다. 성문 서버 연동 후 다시 등록해주세요." params={{ 개수: st.sampleCount }} />
        </div>
      )}
      {/* 🔴 철회는 됐는데 원격 파기가 확인되지 않은 상태 — 파기의무 경로라 침묵하지 않고 재시도를 남긴다. */}
      {st.remotePurgePending && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          <b><T k="동의는 철회되었습니다" /></b>{' — '}<T k="화자 인식은 중지되었습니다. 다만 AI 서버의 성문 파기는 확인되지 않았습니다." />
          <div className="mt-2">
            <button type="button" onClick={() => void applyRevoke(true)} className="min-h-[44px] rounded-full border border-rose-300 bg-white px-3 py-1 text-[12px] font-semibold text-rose-700">
              <T k="성문 파기 다시 시도" />
            </button>
          </div>
        </div>
      )}
      {st.voiceprintPresent === false && !st.voiceprintMissing && st.sampleCount > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <T k="아직 서버에 성문이 없습니다 — 등록을 완료해야 화자 인식이 동작합니다." />
        </div>
      )}

      {enrolled ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[13px] text-emerald-800">
          {st.enrolledAt
            ? <Tf k="표본 {개수}개로 등록 완료 · {날짜}." params={{ 개수: st.sampleCount, 날짜: new Date(st.enrolledAt).toLocaleDateString('ko-KR') }} />
            : <Tf k="표본 {개수}개로 등록 완료." params={{ 개수: st.sampleCount }} />}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { setPromptIdx(0); void voiceApi.enrollStatus().then(setSt); }} className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-[12px] text-emerald-700"><T k="표본 추가" /></button>
            <button type="button" onClick={revoke} className="rounded-full border border-rose-300 bg-white px-3 py-1 text-[12px] text-rose-600"><T k="철회 및 삭제" /></button>
          </div>
        </div>
      ) : !st.consented ? (
        <div>
          <button type="button" onClick={() => setShowConsent(true)} className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">🎙️ <T k="음성 등록 시작 (동의 필요)" /></button>
          <p className="mt-1 text-[11px] text-gray-400"><T k="음성 성문은 민감정보입니다 — 시작 시 법정 동의 화면이 표시됩니다." /></p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 진행률 */}
          <div>
            <div className="flex items-center justify-between text-[12px] text-gray-500 mb-1">
              {st.sampleCount > st.minSamples
                ? <Tf k="표본 {현재} / 최소 {최소} (최대 {최대})" params={{ 현재: st.sampleCount, 최소: st.minSamples, 최대: String(st.maxSamples) }} />
                : <Tf k="표본 {현재} / 최소 {최소}" params={{ 현재: st.sampleCount, 최소: st.minSamples }} />}
              <span>{pct}<Unit>%</Unit></span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${pct}%` }} /></div>
          </div>

          {/* 연습 문장 */}
          <div className="rounded-xl bg-gray-50 border px-3 py-3">
            <p className="text-[11px] text-gray-400 mb-1"><Tf k="문장 {번호} / {전체} — 아래 문장을 또박또박 읽어주세요" params={{ 번호: promptIdx + 1, 전체: PROMPTS.length }} /></p>
            <p className="text-[15px] font-medium text-gray-800 leading-relaxed">{PROMPTS[promptIdx]}</p>
          </div>

          {/* VU 미터 + 녹음 버튼 */}
          <div className="flex items-center gap-3">
            <div className="flex items-end gap-[2px] h-6 flex-1">
              {Array.from({ length: 28 }).map((_, i) => {
                const shape = 0.4 + 0.6 * Math.sin((i / 27) * Math.PI);
                const h = recording ? Math.max(2, Math.min(24, level * 24 * shape)) : 2;
                const hot = recording && level * shape > 0.45;
                return <span key={i} style={{ height: `${h}px` }} className={`w-[3px] rounded-full transition-[height] duration-75 ${hot ? 'bg-rose-500' : recording ? 'bg-rose-300' : 'bg-gray-200'}`} />;
              })}
            </div>
            {recording
              ? <button type="button" onClick={stopAndSubmit} className="rounded-full bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white">■ <T k="녹음 종료" /></button>
              : <button type="button" disabled={busy} onClick={startRecording} className="rounded-full bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? tAttr('처리 중…') : tAttr('● 녹음 시작')}</button>}
          </div>
          <p className="text-[11px] text-gray-400"><T k="녹음은 최대 6초 후 자동 종료됩니다. 조용한 곳에서 마이크에 가깝게 말하세요." /></p>

          <div className="flex items-center gap-2">
            <button type="button" disabled={!canComplete} onClick={complete}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold text-white ${canComplete ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'}`}>
              <T k="등록 완료" />
            </button>
            <button type="button" onClick={revoke} className="rounded-full border border-rose-300 px-3 py-1.5 text-[12px] text-rose-600"><T k="철회 및 삭제" /></button>
          </div>
        </div>
      )}

      {showConsent && <BiometricConsentModal version={st.requiredConsentVersion} onAgree={agree} onClose={() => setShowConsent(false)} />}
    </div>
  );
}
