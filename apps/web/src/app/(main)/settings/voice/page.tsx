'use client';

import { useEffect, useState, useCallback } from 'react';
import { VoiceSettingsPanel, type Phrase, type PhraseType, type VoicePrefs } from '@/components/voice-emr/VoiceSettingsPanel';
import { MicSettings } from '@/components/voice-emr/MicSettings';
import { SpeakerEnrollment } from '@/components/voice-emr/SpeakerEnrollment';
import { DiarizationTest } from '@/components/voice-emr/DiarizationTest';
import { voiceApi } from '@/lib/voice-api';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * VoiceEMR 개인화 설정 — /settings/voice (self-service).
 * 섹션: 마이크·화자 음성 등록(성문·SpeakerEnrollment)·다자간 화자분리 테스트·맞춤 설정(문구+기본설정).
 */
export default function VoiceSettingsPage() {
  const tAttr = useTAttr();
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [loading, setLoading] = useState(true);
  // 🔴 종전: 문구 조회 실패는 catch 무시(→ "항목 없음"), 설정 조회 실패는 prefs=null(→ 영원히 "불러오는 중…").
  //    실패를 '없음'/'로딩중'으로 흡수하지 않는다 — 무엇이 실패했는지 말하고 재시도를 준다.
  const [phrasesError, setPhrasesError] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await voiceApi.listPhrases();
      setPhrases(rows.map((p) => ({ id: p.id, type: p.type as PhraseType, pattern: p.pattern, detail: describe(p), enabled: p.enabled, hitCount: p.hitCount })));
      setPhrasesError(null);
    } catch (e) {
      setPhrasesError(e instanceof Error ? e.message : tAttr('맞춤 문구를 불러오지 못했습니다'));
    } finally { setLoading(false); }
  }, []);
  const loadPrefs = useCallback(async () => {
    try {
      const p = (await voiceApi.getProfile()) as Partial<VoicePrefs>;
      setPrefs({ defaultMode: p.defaultMode ?? 'READ', pttEnabled: p.pttEnabled ?? true, speakerGateEnabled: p.speakerGateEnabled ?? false, language: p.language ?? 'ko' });
      setPrefsError(null);
    } catch (e) {
      setPrefs(null);
      setPrefsError(e instanceof Error ? e.message : tAttr('기본 설정을 불러오지 못했습니다'));
    }
  }, []);
  useEffect(() => { void load(); void loadPrefs(); }, [load, loadPrefs]);

  const onUpdatePrefs = async (patch: Partial<VoicePrefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur)); // 낙관적
    try { await voiceApi.updateProfile(patch); } catch { toast.error(tAttr('설정 저장 실패')); void loadPrefs(); }
  };

  const onAdd = async (type: PhraseType) => {
    const pattern = window.prompt(`${tAttr(LABEL[type])} — ${tAttr('발화(패턴) 입력')}`);
    if (!pattern?.trim()) return;
    let action: object = {};
    if (type === 'HABIT') { const c = window.prompt(tAttr('표준어/코드(canonical)')); if (!c) return; action = { canonical: c }; }
    else if (type === 'ALIAS') { const ref = window.prompt(tAttr('동작 대상 ref(order-set/template/query id)')); if (!ref) return; action = { kind: 'query', ref }; }
    else if (type === 'MACRO') { const body = window.prompt(tAttr('매크로 본문')); if (!body) return; action = { body }; }
    try { await voiceApi.addPhrase({ type, pattern: pattern.trim(), action }); toast.success(tAttr('추가됨')); void load(); }
    catch (e) { toast.error(`${tAttr('추가 실패')}: ${e instanceof Error ? e.message : ''}`); }
  };
  const onToggle = async (id: string) => {
    const p = phrases.find((x) => x.id === id); if (!p) return;
    try { await voiceApi.togglePhrase(id, !p.enabled); void load(); } catch { toast.error(tAttr('변경 실패')); }
  };
  const onDelete = async (id: string) => {
    if (!window.confirm(tAttr('삭제할까요?'))) return;
    try { await voiceApi.deletePhrase(id); void load(); } catch { toast.error(tAttr('삭제 실패')); }
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1"><T k="음성 설정 (VoiceEMR)" /></h1>
      {/* 🔴 <b> 가 한국어 조사(‘…를’) 안쪽을 가르는 문장 — 조각내면 어느 언어에서도 문장이 되지 않아 원문 유지 */}
      <p className="text-sm text-gray-500 mb-4">진료 중 음성 명령/구술의 개인 맞춤 설정. 음성 인식은 <b>마이크 분리(지향성/헤드셋)</b>를 권장합니다.</p>

      <section className="mb-6 max-w-3xl">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">🎙️ <T k="마이크" /></h2>
        <MicSettings />
      </section>

      <section className="mb-6 max-w-3xl">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">🗣️ <T k="화자 음성 등록 (특정화자 인식)" /></h2>
        <SpeakerEnrollment />
      </section>

      <section className="mb-6 max-w-3xl">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">👥 <T k="다자간 화자분리 테스트" /></h2>
        <DiarizationTest />
      </section>

      <h2 className="text-sm font-semibold text-gray-700 mb-2"><T k="맞춤 설정" /></h2>
      {(phrasesError || prefsError) && (
        <div className="max-w-3xl mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          {phrasesError && <p>맞춤 문구를 불러오지 못했습니다 — 아래 목록은 <b>비어 있는 것이 아니라 조회 실패</b> 상태입니다. ({phrasesError})</p>}
          {prefsError && <p>기본 설정을 불러오지 못했습니다 — 설정 탭의 값은 표시할 수 없습니다. ({prefsError})</p>}
          <button
            type="button"
            onClick={() => { if (phrasesError) void load(); if (prefsError) void loadPrefs(); }}
            className="mt-1 rounded-full border border-rose-300 bg-white px-3 py-1 text-[12px]"
          >
            <T k="다시 시도" />
          </button>
        </div>
      )}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm"><T k="불러오는 중…" /></div>
      ) : (
        <VoiceSettingsPanel
          phrases={phrases}
          prefs={prefs}
          prefsError={!!prefsError}
          phrasesError={!!phrasesError}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={onAdd}
          onUpdatePrefs={onUpdatePrefs}
        />
      )}
    </div>
  );
}

const LABEL: Record<PhraseType, string> = { ALIAS: '맞춤 명령', HABIT: '습관 보정', VOCAB: '개인 어휘', MACRO: '매크로' };
function describe(p: { type: string; action: unknown }): string {
  const a = (p.action ?? {}) as Record<string, unknown>;
  if (p.type === 'HABIT') return `→ ${a.canonical ?? ''}`;
  if (p.type === 'ALIAS') return `→ ${a.kind ?? ''}:${a.ref ?? ''}`;
  if (p.type === 'MACRO') return '템플릿';
  return '';
}
