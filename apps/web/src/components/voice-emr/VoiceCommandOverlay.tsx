/**
 * VoiceEMR — 명령 오버레이 (프로토타입·미배선·프레젠테이션)
 *
 * 진료 화면 하단 고정. mode 배지·라이브 자막(replace)·PTT 버튼·상태 칩.
 * 어떤 route/page 에도 아직 import 하지 않는다(런타임 무영향). 배선은 승인 후.
 * 설계: voice-emr-pipeline-design.md §1.2 · implementation-spec.md §C.1
 */
'use client';
import type { VoiceMode, VoiceState } from './types';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 🔴 read 는 '조회'가 아니라 **조회 명령 인식**까지다 — 결과를 띄우는 배선이 없다(사람 결정 `policy.voice.readOpen`).
//    '조회'라고만 적으면 화면이 하지 못하는 일을 한다고 말한다.
const MODE_LABEL: Record<VoiceMode, string> = { read: '조회 명령 인식', dictate: '구술', command: '명령' };
const MODE_COLOR: Record<VoiceMode, string> = {
  read: 'bg-sky-100 text-sky-700', dictate: 'bg-violet-100 text-violet-700', command: 'bg-rose-100 text-rose-700',
};

export interface VoiceCommandOverlayProps {
  mode: VoiceMode;
  state: VoiceState;
  partial: string;
  confidence: number | null;
  level?: number;               // 마이크 입력 레벨 0~1(VU 미터)
  ptt: boolean;                 // PTT 모드(활력/명령)
  onPressStart: () => void;     // PTT down
  onPressEnd: () => void;       // PTT up
  onClose: () => void;
}

/** VU 미터 — 마이크 볼륨/음성 높낮이 시각화(바) */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const N = 20;
  return (
    <div className="flex items-center gap-[2px] h-5" aria-hidden>
      {Array.from({ length: N }).map((_, i) => {
        // 가운데가 높은 파형 형태 + 레벨 스케일. 비활성 시 최소 높이.
        const shape = 0.4 + 0.6 * Math.sin((i / (N - 1)) * Math.PI);
        const h = active ? Math.max(2, Math.min(20, level * 20 * shape * (0.7 + 0.6 * Math.random()))) : 2;
        const hot = active && level * shape > 0.45;
        return <span key={i} style={{ height: `${h}px` }} className={`w-[3px] rounded-full transition-[height] duration-75 ${hot ? 'bg-rose-500' : active ? 'bg-rose-300' : 'bg-gray-200'}`} />;
      })}
    </div>
  );
}

export function VoiceCommandOverlay(p: VoiceCommandOverlayProps) {
  const tAttr = useTAttr();
  const warming = p.state === 'warming';
  const lowConf = p.confidence !== null && p.confidence < 0.5;
  const capturing = p.state === 'capturing';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(680px,92vw)] rounded-2xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${MODE_COLOR[p.mode]}`}><T k={MODE_LABEL[p.mode]} /></span>

        {/* 상태 칩 */}
        <span className="text-xs text-gray-400">
          {warming ? tAttr('준비 중… (최대 18초)') : p.state === 'listening' ? tAttr('대기') : capturing ? tAttr('듣는 중…') : p.state === 'error' ? tAttr('음성 사용 불가 — 키보드로 입력') : ''}
        </span>

        {/* 마이크 볼륨·음성 레벨(VU 미터) */}
        <LevelMeter level={p.level ?? 0} active={capturing} />
        {capturing && <span className="text-[10px] tabular-nums text-gray-400 w-8">{Math.round((p.level ?? 0) * 100)}<Unit>%</Unit></span>}

        {lowConf && <span className="text-xs text-amber-600"><T k="인식 신뢰도 낮음 — 다시 말씀해 주세요" /></span>}

        <div className="ml-auto flex items-center gap-2">
          {/* PTT 버튼(활력/명령) 또는 오픈마이크 표시(구술) */}
          {p.ptt ? (
            <button
              type="button"
              onMouseDown={p.onPressStart} onMouseUp={p.onPressEnd}
              onTouchStart={p.onPressStart} onTouchEnd={p.onPressEnd}
              disabled={warming || p.state === 'error'}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${p.state === 'capturing' ? 'bg-rose-600 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'} disabled:opacity-40`}
            >
              {p.state === 'capturing' ? tAttr('● 말하는 중') : tAttr('🎙️ 눌러서 말하기')}
            </button>
          ) : (
            <span className={`text-xs px-2 py-1 rounded-full ${p.state === 'capturing' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-500'}`}>
              {p.state === 'capturing' ? tAttr('● 구술 중') : tAttr('오픈 마이크')}
            </span>
          )}
          <button type="button" onClick={p.onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>
      </div>

      {/* 라이브 자막(partial=replace) */}
      {p.partial && (
        <p aria-live="polite" className="mt-2 text-sm text-gray-800 leading-relaxed">{p.partial}</p>
      )}
    </div>
  );
}
