/**
 * VoiceEMR — 개인화 관리 패널 (/settings/voice self-service)
 *
 * 맞춤 명령/습관/어휘/매크로(B.3~B.4) + 기본 설정(기본 모드·PTT·화자 게이트·언어).
 * ※ 화자 음성 등록(성문)은 상위 페이지의 전용 섹션(SpeakerEnrollment)에서 관리 — 여기서 제외(중복 방지).
 * 설계: voice-emr-personalization-design.md §B.3
 */
'use client';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

export type PhraseType = 'ALIAS' | 'HABIT' | 'VOCAB' | 'MACRO';
export interface Phrase { id: string; type: PhraseType; pattern: string; detail: string; enabled: boolean; hitCount: number }
export interface VoicePrefs { defaultMode: string; pttEnabled: boolean; speakerGateEnabled: boolean; language: string }

const TABS: { key: PhraseType | 'PREFS'; label: string }[] = [
  { key: 'ALIAS', label: '맞춤 명령' }, { key: 'HABIT', label: '습관 보정' },
  { key: 'VOCAB', label: '개인 어휘' }, { key: 'MACRO', label: '매크로' }, { key: 'PREFS', label: '설정' },
];
const VOCAB_MAX = 200;

export interface VoiceSettingsPanelProps {
  phrases: Phrase[];
  prefs: VoicePrefs | null;
  /** 🔴 조회 실패를 '없음'/'로딩 중'으로 흡수하지 않기 위한 구분(P1) */
  prefsError?: boolean;
  phrasesError?: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (type: PhraseType) => void;
  onUpdatePrefs: (patch: Partial<VoicePrefs>) => void;
}

export function VoiceSettingsPanel(p: VoiceSettingsPanelProps) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('ALIAS');
  const vocabCount = p.phrases.filter((x) => x.type === 'VOCAB' && x.enabled).length;

  return (
    <div className="max-w-3xl">
      <div className="flex gap-1 border-b border-gray-100 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-2 whitespace-nowrap ${tab === t.key ? 'border-b-2 border-gray-900 font-semibold text-gray-900' : 'text-gray-500'}`}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {(tab === 'ALIAS' || tab === 'HABIT' || tab === 'VOCAB' || tab === 'MACRO') && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400">
              {tab === 'VOCAB' && <span><Tf k="개인 어휘 {개수} / {상한} (바이어싱 상한)" params={{ 개수: vocabCount, 상한: VOCAB_MAX }} /></span>}
              {tab === 'ALIAS' && <span><T k="⚠ 오더 연계 명령도 실행 시 환자 확인·DUR·명시 확정이 필요합니다." /></span>}
              {/* 🔴 MACRO 는 파이프라인 소비처가 없다(등록만 됨) — 적용되는 것처럼 보이지 않게 밝힌다. */}
              {tab === 'MACRO' && <span><T k="⚠ 매크로는 아직 음성 파이프라인이 사용하지 않습니다 — 등록만 보관됩니다(적중수 0은 미사용 때문)." /></span>}
            </div>
            <button type="button" onClick={() => p.onAdd(tab)} className="text-xs px-3 py-1.5 rounded-full bg-gray-900 text-white">+ <T k="추가" /></button>
          </div>
          <div className="rounded-2xl border divide-y">
            {p.phrases.filter((x) => x.type === tab).length === 0 && (
              p.phrasesError
                ? <EmptyState icon="⚠️" title="목록을 불러오지 못했습니다" hint="등록된 항목이 없는 것이 아니라 조회 실패" />
                : <EmptyState icon="📋" title="등록된 항목이 없습니다" />
            )}
            {p.phrases.filter((x) => x.type === tab).map((ph) => (
              <div key={ph.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-gray-800">{ph.pattern}</span>
                <span className="text-gray-400 text-xs">{ph.detail}</span>
                <span className="text-gray-300 text-xs ml-auto">{ph.hitCount}</span>
                <button type="button" onClick={() => p.onToggle(ph.id)} className={`text-xs px-2 py-0.5 rounded-full ${ph.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{ph.enabled ? 'on' : 'off'}</button>
                <button type="button" onClick={() => p.onDelete(ph.id)} className="text-gray-300 hover:text-rose-500 text-xs"><T k="삭제" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'PREFS' && (
        <div className="rounded-2xl border p-4 space-y-4">
          {p.prefsError ? (
            /* 🔴 조회 실패를 '불러오는 중…' 으로 두면 영원히 로딩처럼 보인다 */
            <p className="text-sm text-rose-600"><T k="기본 설정을 불러오지 못했습니다 — 값을 표시할 수 없습니다. 위의 ‘다시 시도’를 눌러주세요." /></p>
          ) : !p.prefs ? (
            <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>
          ) : (
            <>
              <Row label={tAttr('기본 모드')} hint={tAttr('음성 세션을 모드 지정 없이 시작할 때 적용됩니다(조회/구술/명령).')}>
                <select value={p.prefs.defaultMode} onChange={(e) => p.onUpdatePrefs({ defaultMode: e.target.value })} className="rounded-lg border px-2 py-1.5 text-sm">
                  <option value="READ">{tAttr('조회')}</option>
                  <option value="DICTATE">{tAttr('구술')}</option>
                  <option value="COMMAND">{tAttr('명령')}</option>
                </select>
              </Row>
              {/* 🔴 PTT 는 저장만 되고 읽는 곳이 없다(마이크 동작은 화면별 구현) — 동작하는 토글인 척하지 않는다. */}
              <Row label={tAttr('PTT (눌러서 말하기)')} hint={tAttr('저장만 됩니다 — 현재 음성 화면이 이 값을 읽지 않습니다(적용 대기).')}>
                <Toggle on={p.prefs.pttEnabled} onClick={() => p.onUpdatePrefs({ pttEnabled: !p.prefs!.pttEnabled })} />
              </Row>
              <Row label={tAttr('화자 게이트 (내 음성만)')} hint={tfAttr('성문 등록 후 내 음성만 인식. {출처} 성문 계약 확정 시 적용(현재 대기).', { 출처: AI_ORIGIN_TEXT })}>
                <Toggle on={p.prefs.speakerGateEnabled} onClick={() => p.onUpdatePrefs({ speakerGateEnabled: !p.prefs!.speakerGateEnabled })} />
              </Row>
              <Row label={tAttr('언어')} hint={tAttr('다음 음성 세션부터 STT 인식 언어로 적용됩니다.')}>
                <select value={p.prefs.language} onChange={(e) => p.onUpdatePrefs({ language: e.target.value })} className="rounded-lg border px-2 py-1.5 text-sm">
                  <option value="ko">{tAttr('한국어')}</option>
                  <option value="en">English</option>
                </select>
              </Row>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-gray-800">{label}</div>
        {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-gray-200'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
