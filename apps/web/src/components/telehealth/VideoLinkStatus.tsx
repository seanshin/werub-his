'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * 원격진료 영상 연결 상태 — 기획 telehealth-enhancement T3-4 "네트워크 품질 모니터".
 *
 * 🔴 (2026-09-14) 영상은 Jitsi 를 **별도 창(직원: window.open)** 또는 **내장 프레임(포털: iframe)** 으로 연다.
 *    HIS 화면은 그 안의 RTCPeerConnection 에 닿지 못해 `getStats()` 의 대역폭·지연·패킷 손실을 **읽을 수 없다.**
 *    그래서 연결 품질은 "측정 불가"로 말한다 — 초록·"양호"를 지어내지 않는다(판정 규칙 P17).
 *    SDK 가 실측 등급을 주는 연동이 생기면 `sdkQuality` 로 넘긴다(등급 문자열·출처를 그대로 표시, 임계값을 만들지 않는다).
 *
 * HIS 가 **실제로 아는 것**만 상태로 쓴다:
 *  - 브라우저 네트워크 끊김(`navigator.onLine` + online/offline 이벤트) — 영상 매체 경로의 품질이 아니라 이 기기의 연결 여부다.
 *  - 직원 영상 창 핸들: 열리지 않음(팝업 차단)·열림·닫힘. 🔴 종전 화면은 `window.open` 을 불렀다는 사실만으로
 *    초록 "화상 진료 진행 중"을 그렸다(창이 막혔거나 닫혀도·영상 서버가 없어도 초록).
 */

export type VideoWindowState = 'NOT_OPENED' | 'BLOCKED' | 'OPEN' | 'CLOSED' | 'EMBEDDED';

export interface SdkQuality {
  /** SDK 가 준 등급 문자열 그대로 */
  level: string;
  /** 어느 SDK·이벤트에서 왔는지 */
  source: string;
}

export type VideoLinkTone = 'danger' | 'warn' | 'neutral' | 'muted';

export interface VideoLinkView {
  /** 창·네트워크 상태 문장 키(없으면 표시 안 함) */
  statusKey: string | null;
  tone: VideoLinkTone;
  /** 품질 — null 이면 측정 불가 */
  quality: SdkQuality | null;
}

/** 순수 판정 — 우선순위: 오프라인 > 창 막힘 > 창 닫힘 > 창 열림/내장 > 시작 전 */
export function deriveVideoLinkView(input: { online: boolean | null; window: VideoWindowState; sdkQuality?: SdkQuality | null }): VideoLinkView {
  const quality = input.sdkQuality && input.sdkQuality.level ? input.sdkQuality : null;
  if (input.online === false) return { statusKey: '네트워크 끊김 — 브라우저가 오프라인입니다', tone: 'danger', quality };
  switch (input.window) {
    case 'BLOCKED': return { statusKey: '영상 창이 열리지 않았습니다 — 팝업 차단을 확인하세요', tone: 'warn', quality };
    case 'CLOSED': return { statusKey: '영상 창이 닫혔습니다', tone: 'muted', quality };
    case 'OPEN': return { statusKey: '영상 창 열림', tone: 'neutral', quality };
    case 'EMBEDDED': return { statusKey: null, tone: 'neutral', quality };
    default: return { statusKey: '화상 연결을 시작하세요', tone: 'muted', quality };
  }
}

/** 브라우저 온라인 여부 — SSR·미지원이면 null(모름) */
export function useBrowserOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return;
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

/** 직원 영상 창 핸들 감시 — window.open 반환값(null=막힘)을 넘기면 닫힘을 1초 간격으로 확인 */
export function usePopupWindowState(handle: Window | null | undefined, opened: boolean): VideoWindowState {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setClosed(false);
    if (!opened || !handle) return;
    const id = window.setInterval(() => { if (handle.closed) setClosed(true); }, 1000);
    return () => window.clearInterval(id);
  }, [handle, opened]);
  if (!opened) return 'NOT_OPENED';
  if (!handle) return 'BLOCKED';
  return closed ? 'CLOSED' : 'OPEN';
}

const TONE_DARK: Record<VideoLinkTone, string> = {
  danger: 'text-red-400',
  warn: 'text-amber-400',
  neutral: 'text-gray-200',
  muted: 'text-gray-400',
};
const TONE_LIGHT: Record<VideoLinkTone, string> = {
  danger: 'text-red-600',
  warn: 'text-amber-600',
  neutral: 'text-gray-700',
  muted: 'text-gray-500',
};

/** 표시 — 문장 렌더는 호출 화면의 번역 부품(직원 `T`·포털 `PT`)을 넘겨받는다 */
export function VideoLinkStatus({ view, text, dark = true }: { view: VideoLinkView; text: (k: string) => ReactNode; dark?: boolean }) {
  const tone = dark ? TONE_DARK : TONE_LIGHT;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="video-link-status">
      {view.statusKey && (
        <span className={`font-medium ${tone[view.tone]}`} data-tone={view.tone}>{text(view.statusKey)}</span>
      )}
      {view.quality ? (
        <span className={tone.neutral} data-quality="sdk">
          {text('연결 품질')}: {view.quality.level} <span className="opacity-60">({view.quality.source})</span>
        </span>
      ) : (
        <span className="text-gray-500" data-quality="unmeasured">
          {text('연결 품질: 측정 불가')} · {text('HIS 화면은 영상 연결 통계를 읽지 못합니다')}
        </span>
      )}
    </div>
  );
}
