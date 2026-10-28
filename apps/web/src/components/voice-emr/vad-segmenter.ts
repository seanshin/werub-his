/**
 * VoiceEMR 앰비언트 — VAD 발화 경계 세그먼터 (순수 로직·테스트 가능)
 *
 * 오픈마이크 프레임별 유성 여부(pcmHasSpeech)를 받아 발화 onset/offset 을 판정.
 * - onset: 유성 프레임이 onsetFrames 연속(클릭/스파이크 오시작 방지)
 * - offset: 발화 중 무성이 silenceMs 지속(진료 대화 턴 교대 = 조기 final·Q9 25s 강제 final 과 별개)
 * 기획: voice-emr-ambient-conversation.plan.md §4
 */

export interface SegmenterConfig {
  silenceMs?: number;   // 무성 지속 → 발화 종료(기본 1200 — config voiceEmr.ambient.silenceFinalizeMs)
  onsetFrames?: number; // 연속 유성 프레임 수 → 발화 시작(기본 2 ≈ 170ms)
}

export type SegEvent = 'onset' | 'offset' | 'none';

export class VadSegmenter {
  private readonly silenceMs: number;
  private readonly onsetFrames: number;
  private speaking = false;
  private speechRun = 0;
  private lastSpeechAt = 0;

  constructor(cfg: SegmenterConfig = {}) {
    this.silenceMs = Math.max(300, cfg.silenceMs ?? 1200);
    this.onsetFrames = Math.max(1, cfg.onsetFrames ?? 2);
  }

  /** 프레임마다 호출 — 상태 전이 이벤트 반환 */
  feed(hasSpeech: boolean, now: number): SegEvent {
    if (hasSpeech) {
      this.lastSpeechAt = now;
      this.speechRun++;
      if (!this.speaking && this.speechRun >= this.onsetFrames) {
        this.speaking = true;
        return 'onset';
      }
      return 'none';
    }
    this.speechRun = 0;
    if (this.speaking && now - this.lastSpeechAt >= this.silenceMs) {
      this.speaking = false;
      return 'offset';
    }
    return 'none';
  }

  get active(): boolean {
    return this.speaking;
  }

  /** 강제 종료(세션 stop 등) — 상태 초기화 */
  reset(): void {
    this.speaking = false;
    this.speechRun = 0;
    this.lastSpeechAt = 0;
  }
}
