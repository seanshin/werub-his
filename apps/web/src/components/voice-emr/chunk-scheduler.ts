/**
 * VoiceEMR — 청크/발화 세션 스케줄러 (프로토타입·순수 로직·미배선·테스트 가능)
 *
 * Q1/Q2/Q9 계약 구현: partial 청크 ≥1500ms 주기·**25초 내 강제 final**(30초 상한−마진·초과
 * 폐기 방지)·강제 final 시 **발화 세션 id 신규 발급**(180s TTL·30s 상한은 발화 단위).
 * 시각·id 를 주입해 결정적 테스트. 브라우저 API 불필요.
 * 설계: voice-emr-pipeline-design.md §1.3
 */

export interface SchedulerConfig {
  chunkMs?: number;      // partial 청크 주기(≥1500)
  forceFinalMs?: number; // 강제 final(≤25000)
  newId?: () => string;  // 발화 세션 id 발급(주입·테스트 결정성)
}

export type TickAction =
  | { type: 'none' }
  | { type: 'partial'; sid: string }
  | { type: 'final'; sid: string; reason: 'forced'; nextSid: string }; // 강제 final → 즉시 새 sid 로 이어감

let _seq = 0;
const defaultNewId = () => `u${++_seq}`;

export class ChunkScheduler {
  private chunkMs: number;
  private forceFinalMs: number;
  private newId: () => string;
  private sid = '';
  private utteranceStart = 0;
  private lastChunk = 0;

  constructor(cfg: SchedulerConfig = {}) {
    this.chunkMs = Math.max(1500, cfg.chunkMs ?? 1500); // 하한 1.5s(과세분 금지·Q2)
    this.forceFinalMs = Math.min(25000, cfg.forceFinalMs ?? 25000);
    this.newId = cfg.newId ?? defaultNewId;
  }

  /** PTT down / VAD onset — 발화 세션 시작 */
  start(now: number): string {
    this.sid = this.newId();
    this.utteranceStart = now;
    this.lastChunk = now;
    return this.sid;
  }

  get currentSid(): string { return this.sid; }

  /** 주기 호출 — 청크 emit 결정 */
  tick(now: number): TickAction {
    if (!this.sid) return { type: 'none' };
    // 25초 도달 → 강제 final + 즉시 새 sid(폐기 방지·연속 구술 이어감)
    if (now - this.utteranceStart >= this.forceFinalMs) {
      const finishedSid = this.sid;
      const nextSid = this.newId();
      this.sid = nextSid;
      this.utteranceStart = now;
      this.lastChunk = now;
      return { type: 'final', sid: finishedSid, reason: 'forced', nextSid };
    }
    if (now - this.lastChunk >= this.chunkMs) {
      this.lastChunk = now;
      return { type: 'partial', sid: this.sid };
    }
    return { type: 'none' };
  }

  /** PTT up / VAD offset / silence — 발화 종료 */
  end(): { type: 'final'; sid: string; reason: 'end' } | { type: 'none' } {
    if (!this.sid) return { type: 'none' };
    const sid = this.sid;
    this.sid = '';
    return { type: 'final', sid, reason: 'end' };
  }
}
