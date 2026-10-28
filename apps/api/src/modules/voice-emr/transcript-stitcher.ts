/**
 * VoiceEMR — 전사 스티칭 (프로토타입·순수 로직·미배선)
 *
 * 실시간 STT 는 발화 단위 final 을 반환하고 30초 초과분을 폐기(Q9)한다. 장문 구술은
 * HIS 가 연속 final 을 이어붙여(stitching) 전체 노트를 재구성한다.
 * 규약: ①final 만 append(partial=누적 재인식이라 저장 시 중복) ②강제 final 경계 1초 겹침
 * → 어절 n-gram 중복 제거 ③dropped_s>0 = 앞부분 유실 → 갭 마커+불완전 플래그(G5).
 * 설계: docs/02-design/voice-emr-pipeline-design.md §1.4
 */

export interface FinalChunk { text: string; dropped_s?: number; session_max_s?: number; confidence?: number }
export interface StitchResult { applied: boolean; held?: boolean; note: string; incomplete: boolean; gaps: number[] }

const CONF_HOLD = 0.5;
const GAP_MARK = ' [⚠일부 누락] ';

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/**
 * prev 말미 어절 n-gram(nMax..1)이 cur 머리와 일치하면 cur 에서 제거(경계 1초 겹침 dedup).
 * 1어절 일치는 오제거 방지 위해 **어절 길이 ≥3**(기능어 네/음/그 등 제외)일 때만.
 */
export function stripOverlap(prev: string, cur: string, nMax = 5): string {
  const p = words(prev);
  const c = words(cur);
  const maxN = Math.min(nMax, p.length, c.length);
  for (let n = maxN; n >= 1; n--) {
    if (p.slice(-n).join(' ') === c.slice(0, n).join(' ')) {
      if (n === 1 && c[0].length < 3) continue; // 단어절 짧은 기능어는 dedup 안 함
      return c.slice(n).join(' ');
    }
  }
  return cur;
}

/** 진료 세션 단위 스티처(상태 보유). partial 은 절대 넣지 않는다 — final 만. */
export class TranscriptStitcher {
  private note = '';
  private incomplete = false;
  private gaps: number[] = [];

  onFinal(f: FinalChunk): StitchResult {
    // 저신뢰 → 보류(append 안 함·재발화 요청 신호)
    if (f.confidence !== undefined && f.confidence < CONF_HOLD) {
      return { applied: false, held: true, note: this.note, incomplete: this.incomplete, gaps: [...this.gaps] };
    }
    // 앞부분 유실(30초 초과 폐기·G5)
    if (f.dropped_s && f.dropped_s > 0) {
      this.gaps.push(f.dropped_s);
      this.incomplete = true;
      this.note += (this.note ? '' : '') + GAP_MARK;
    }
    let t = (f.text ?? '').trim();
    if (t) {
      if (this.note && !this.note.endsWith(GAP_MARK)) t = stripOverlap(this.note, t);
      this.note = this.note ? `${this.note} ${t}`.replace(/\s+/g, ' ').trim() : t;
    }
    return { applied: !!t, note: this.note, incomplete: this.incomplete, gaps: [...this.gaps] };
  }

  /** 서명 가능? 전사 누락 있으면 재구술 전까지 차단(G5) */
  canSign(): boolean { return !this.incomplete; }
  getNote(): string { return this.note; }
  reset(): void { this.note = ''; this.incomplete = false; this.gaps = []; }
}
