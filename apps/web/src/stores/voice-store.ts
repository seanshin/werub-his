/**
 * VoiceEMR — 클라이언트 상태기계 스토어 (순수 상태)
 *
 * 🔴 2026-08-27 — 머리말이 오래 '미배선'이라 적고 있었으나 `VoiceEmrLauncher` 가 배선되어 있다.
 *    '미배선' 표기는 결함을 런타임 무영향으로 오판하게 만든다(확인 카드 렌더 크래시가 그렇게 묻혔다).
 *
 * 오디오 캡처/네트워크는 useVoiceCommand 훅이 담당하고, 이 스토어는 **순수 상태 전이**만
 * 소유한다(테스트 가능). 확인 카드에는 세션 시작 시 로드한 **환자 신원(G3)** 을 항상 주입.
 * 설계: docs/02-design/voice-emr-implementation-spec.md §C.2·C.3
 */
import { create } from 'zustand';
import type { VoiceMode, VoiceState, PatientRef, ConfirmCard, SoapField } from '@/components/voice-emr/types';

interface VoiceStore {
  state: VoiceState;
  mode: VoiceMode;
  session: { id: string; encounterId: string; patient: PatientRef } | null;
  partial: string;         // 라이브 자막(replace)
  noteText: string;        // 스티칭된 전체 노트(dictate)
  dropped: boolean;        // dropped_s>0 (전사 누락·서명 차단 G5)
  confidence: number | null;
  level: number;           // 마이크 입력 레벨 0~1(RMS·VU 미터)
  confirm: ConfirmCard | null;

  // actions
  startSession: (session: { id: string; encounterId: string; patient: PatientRef }, mode: VoiceMode) => void;
  setWarm: (loaded: boolean) => void;
  beginCapture: () => void;                    // PTT down / VAD onset
  endCapture: () => void;                       // PTT up / VAD offset → listening 복귀(다음 발화 준비)
  setLevel: (level: number) => void;           // 마이크 레벨(RMS)
  setPartial: (text: string, confidence?: number) => void; // partial=replace
  appendNote: (text: string, dropped?: boolean) => void;   // final 스티칭 결과
  toParsing: () => void;
  requireConfirm: (card: ConfirmCard) => void; // write/command → 확인 대기
  selectCandidate: (code: string, labIndex?: number) => void;
  /**
   * 고위험 재확인 체크 — **카드 안에** 담는다.
   * 🔴 로컬 state 로 두면 확정 버튼만 막고 서버엔 아무것도 남지 않는다(가짜 게이트).
   *    확정 시 `slots` 로 넘어가 `VoiceCommandLog` 에 저장된다.
   */
  ackHighAlert: (ack: boolean) => void;
  /** 구술 카드 — 반영할 SOAP 필드(초기값 미선택) · 본문 편집. 카드에 담겨 확정 시 `slots` 로 서버 로그에 남는다. */
  setDictateField: (field: SoapField) => void;
  setDictateText: (text: string) => void;
  confirmAction: () => void;                    // 명시 확정 → executing
  cancel: () => void;                           // 확인 취소 → listening
  fail: () => void;                             // kill-switch/연속실패 → error(키보드 폴백)
  endSession: () => void;
  reset: () => void;
}

const INIT = {
  state: 'idle' as VoiceState, mode: 'read' as VoiceMode, session: null,
  partial: '', noteText: '', dropped: false, confidence: null, level: 0, confirm: null,
};

export const useVoiceStore = create<VoiceStore>((set) => ({
  ...INIT,

  startSession: (session, mode) => set({ session, mode, state: 'warming', partial: '', noteText: '', dropped: false, confirm: null }),
  setWarm: (loaded) => set((s) => (s.state === 'warming' && loaded ? { state: 'listening' } : {})),
  beginCapture: () => set((s) => (s.state === 'listening' ? { state: 'capturing', partial: '', level: 0 } : {})),
  // PTT 릴리즈 → capturing 에서 listening 으로 복귀(다음 발화 준비). confirming/executing/error 는 유지.
  endCapture: () => set((s) => (s.state === 'capturing' ? { state: 'listening', level: 0 } : {})),
  setLevel: (level) => set({ level }),
  setPartial: (text, confidence) => set({ partial: text, confidence: confidence ?? null }),

  appendNote: (text, dropped) => set((s) => ({
    noteText: s.noteText ? `${s.noteText} ${text}`.trim() : text,
    dropped: s.dropped || !!dropped,
    partial: '',
  })),

  toParsing: () => set({ state: 'parsing' }),
  requireConfirm: (card) => set({ state: 'confirming', confirm: card }),

  selectCandidate: (code, labIndex) => set((s) => {
    if (!s.confirm) return {};
    if (s.confirm.kind === 'order-rx') return { confirm: { ...s.confirm, selectedCode: code } };
    if (s.confirm.kind === 'order-lab' && labIndex !== undefined) {
      const labs = s.confirm.labs.map((l, i) => (i === labIndex ? { ...l, selectedCode: code } : l));
      return { confirm: { ...s.confirm, labs } };
    }
    return {};
  }),

  ackHighAlert: (ack) => set((s) => (
    s.confirm?.kind === 'order-rx' ? { confirm: { ...s.confirm, highAlertAck: ack } } : {}
  )),

  setDictateField: (field) => set((s) => (
    s.confirm?.kind === 'dictate' ? { confirm: { ...s.confirm, field } } : {}
  )),
  setDictateText: (text) => set((s) => (
    s.confirm?.kind === 'dictate' ? { confirm: { ...s.confirm, editedText: text } } : {}
  )),

  confirmAction: () => set((s) => (s.state === 'confirming' ? { state: 'executing' } : {})),
  cancel: () => set({ state: 'listening', confirm: null, partial: '' }),
  fail: () => set({ state: 'error', confirm: null }),
  endSession: () => set({ ...INIT }),
  reset: () => set({ ...INIT }),
}));

/** dropped_s>0 이면 서명 차단(G5) — 노트 완결성 판정 */
export function canSignNote(store: Pick<VoiceStore, 'dropped'>): boolean {
  return !store.dropped;
}
