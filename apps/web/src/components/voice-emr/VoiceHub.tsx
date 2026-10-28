'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceEmrLauncher } from './VoiceEmrLauncher';
import EncounterScribeSection from '@/components/scribe/EncounterScribeSection';
import type { SoapDraft } from '@/components/scribe/ScribeDraftPanel';
import type { VoiceOrderDraft } from '@/lib/voice-api';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 음성 허브 — 진료 화면 음성 기능의 단일 진입점(비차단).
 * '🎤 음성 ▾' → 컴팩트 메뉴로 도구 선택 → **메뉴가 닫히고 해당 도구가 헤더에 인라인으로 수행**.
 * 큰 설명 팝오버가 차트를 가리지 않게: 상세는 'ⓘ 자세히' 모달로 분리.
 *  · 명령·구술(VoiceEMR): 선택 즉시 자동 시작 + '음성' 옆 실시간 레벨(VU). 하단 오버레이=PTT/자막(비차단).
 *  · 진료 기록(스크라이브): 인라인 녹음 컨트롤(전사는 GPU 대기·준비 중).
 */
/** 이 허브를 지나는 SOAP 쓰기의 출처 — 부모가 provenance(`DraftSource`)를 남길 때 쓴다 */
export type VoiceHubSoapSource = 'SCRIBE' | 'DICTATE';

/**
 * 🔴 `onApplySoap` 은 **append** 계약이다 — 부모(진료 화면)는 이 콜백을 `appendSoap` 정본으로 받는다.
 *    종전엔 부모가 `setSoap(prev => ({...prev, [field]: text}))` 로 **덮어썼다**(§13.2 P0-1·P1-1). 스크라이브 초안 '적용'과
 *    구술 확정이 같은 문을 지나므로, 둘 다 append 가 된다(기획서 §9 "draft 회로 통일").
 */
export function VoiceHub({ encounterId, onApplySoap, onOrderDraft }: { encounterId: string; onApplySoap: (field: keyof SoapDraft, text: string, source: VoiceHubSoapSource) => void; onOrderDraft?: (draft: VoiceOrderDraft) => void }) {
  const tAttr = useTAttr();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tool, setTool] = useState<null | 'scribe' | 'voice'>(null);
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 🔴 컨테이너(main) 밖으로 뻗어 잘리지 않게 여는 방향을 정한다 — 정본 하나(useEdgeSafeAlign)
  const { alignClass } = useEdgeSafeAlign(menuOpen && !tool, 248, ref);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      {/* 인라인 수행 도구 */}
      {tool === 'voice' && (
        <VoiceEmrLauncher encounterId={encounterId} autoStart onExit={() => setTool(null)} onApplySoap={(f, t) => onApplySoap(f, t, 'DICTATE')} onOrderDraft={onOrderDraft} />
      )}
      {tool === 'scribe' && (
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-50 border border-neutral-200 px-2.5 py-1">
          <span className="text-[11px] font-semibold text-neutral-600">📝 <T k="기록" /></span>
          <EncounterScribeSection encounterId={encounterId} onApplySoap={(f, t) => onApplySoap(f, t, 'SCRIBE')} />
          <button type="button" onClick={() => setTool(null)} className="text-neutral-400 hover:text-rose-500 text-xs" title={tAttr('닫기')}>✕</button>
        </span>
      )}

      {/* 진입 버튼(도구 비활성일 때만) */}
      {!tool && (
        <button type="button" onClick={() => setMenuOpen((o) => !o)}
          aria-label={tAttr('음성 기능')}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium transition ${menuOpen ? 'border-indigo-300 bg-indigo-100 text-indigo-800' : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
          🎤 <span className="hidden xl:inline"><T k="음성" /></span> ▾
        </button>
      )}

      {/* 컴팩트 선택 메뉴 */}
      {menuOpen && !tool && (
        <div className={`absolute ${alignClass} top-full mt-2 w-[248px] rounded-xl border border-gray-200 bg-white shadow-lg z-50 p-1.5`}>
          <button type="button" onClick={() => { setTool('voice'); setMenuOpen(false); }}
            className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-indigo-50 transition">
            <div className="text-[13px] font-semibold text-gray-900">⌨️ <T k="명령·구술 (VoiceEMR)" /></div>
            <div className="text-[11px] text-gray-400"><T k="눌러서 말하기로 활력·오더 기록 지시" /></div>
          </button>
          <button type="button" onClick={() => { setTool('scribe'); setMenuOpen(false); }}
            className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-neutral-50 transition">
            <div className="text-[13px] font-semibold text-gray-900">📝 <T k="진료 기록 (스크라이브)" /></div>
            <div className="text-[11px] text-gray-400"><T k="대화 녹음 → SOAP 초안" /> <span className="text-amber-500">· <T k="전사 준비 중" /></span></div>
          </button>
          <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('voice:ambient-open')); setMenuOpen(false); }}
            className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-rose-50 transition">
            <div className="text-[13px] font-semibold text-gray-900">💬 <T k="대화 기록 (실시간)" /></div>
            <div className="text-[11px] text-gray-400"><T k="대화가 텍스트로 실시간 기록 — 우측 패널" /></div>
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button type="button" onClick={() => { setHelp(true); setMenuOpen(false); }}
            className="w-full text-left rounded-lg px-2.5 py-1.5 text-[11px] text-gray-400 hover:bg-gray-50">ⓘ <T k="자세히 보기" /></button>
        </div>
      )}

      {/* 상세 도움말 모달(기본 숨김 — 차트 비차단) */}
      {help && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900"><T k="음성 기능 안내" /></h3>
              <button type="button" onClick={() => setHelp(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="text-[12px] text-gray-500"><T k="진료 중 음성을 두 방식으로 사용합니다." /> <b className="text-gray-700"><T k="기록" /></b><T k="=대화를 남기는 문서화," /> <b className="text-gray-700"><T k="명령" /></b><T k="=시스템에 지시. 함께 써도 됩니다." /></p>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">📝 <T k="진료 기록 (스크라이브)" /></div>
              <p className="text-[12px] text-gray-500 mt-1"><T k="환자와 나눈 대화 전체를 녹음하면 화자별로 나눠 전사하고 SOAP 초안을 자동 생성합니다. 초안은 의사가 검토·수정 후 서명합니다." /></p>
              <p className="text-[11px] text-amber-600 mt-1"><T k="※ 전사(STT)는 현재 준비 중(GPU 대기)입니다. 녹음은 가능하나 전사는 추후 제공됩니다." /></p>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">💬 <T k="대화 기록 (실시간)" /></div>
              <p className="text-[12px] text-gray-500 mt-1"><T k="진료 대화가 우측 패널에 발화 단위 텍스트로 실시간 기록됩니다. 화자(의사/환자)는 추정 표시이며 탭으로 정정, 발화는 수정·삭제할 수 있습니다. 환자의 녹음 전용 동의가 선행됩니다." /></p>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">⌨️ <T k="명령·구술 (VoiceEMR)" /></div>
              {/* 🔴 발화 예시("최근 검사 보여줘"·"혈압 120에 80 기록")는 **한국어로 말해야 인식된다** — STT 인식 언어와
                  같은 문자열이라 번역하면 화면이 안 되는 말을 시킨다. 앞 두 문장만 배선하고 예시는 원문으로 남긴다. */}
              <p className="text-[12px] text-gray-500 mt-1"><T k="눌러서 말하기(PTT)로 활력 기록·오더 등을 지시합니다. 안전을 위해 확인 카드로 검토 후 확정됩니다." /> 예: &quot;혈압 120에 80 기록&quot;(활력).</p>
              {/* 🔴 조회는 **명령 인식까지만** 동작한다(파서가 read 로 판정하고 끝 — 결과를 띄우는 화면 배선이 없다).
                  종전 문구는 예시로 "최근 검사 보여줘"(조회)를 들고 "현재 조회 중심"이라 말해, 되지 않는 것을
                  되는 것처럼 안내했다. 여는 것은 사람 결정(`policy.voice.readOpen`)이고, 그 전까지는 사실대로 말한다. */}
              <p className="text-[11px] text-gray-400 mt-1"><T k="※ 조회 명령은 인식까지만 동작합니다 — 결과는 화면에 표시되지 않습니다(조회 연동 미개방)." /></p>
              <p className="text-[11px] text-gray-400 mt-1"><T k="※ 오더·구술 등 쓰기 기능은 관리자 설정에 따라 순차 개방." /></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
