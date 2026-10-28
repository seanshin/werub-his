import { Injectable } from '@nestjs/common';
import type { RawTranscriptSegment } from './scribe-ai.client';

export type Role = 'DOCTOR' | 'PATIENT' | 'GUARDIAN' | 'OTHER' | 'UNKNOWN';
export interface LabeledSegment extends RawTranscriptSegment {
  role: Role;
  confident: boolean;
}

/** 의사 발화 경향 신호(휴리스틱·C안): 질문 주도·의학용어·명령형. */
const DOCTOR_HINTS = [
  /[?？]/, // 질문
  /(어떠세요|언제부터|어디가|아프|증상|검사|처방|드셨|복용|경과|혈압|초음파|엑스레이|CT|MRI)/,
  /(합시다|하겠습니다|드리겠|처방해|검사해|봅시다)/,
];

function doctorScore(text: string): number {
  return DOCTOR_HINTS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

/**
 * 화자확정 — 특정화자 인식(§4.4(3)).
 * A(EMBEDDING): diarize 응답에 화자 임베딩이 있고 의사 프로파일 존재 시 코사인 대조(권장). — 프로파일 임베딩 준비 후 활성.
 * C(HEURISTIC): 임베딩 없으면 발화 패턴으로 의사 채널 추정 → 나머지 비의사=PATIENT 후보. 항상 동작.
 * 라벨은 의사가 UI에서 최종 확정(confident=false면 검토 유도).
 */
@Injectable()
export class SpeakerResolver {
  /** A안: 세그먼트 임베딩 ↔ 의사 프로파일 임베딩 코사인 유사도. 임계 이상=DOCTOR. */
  resolveByEmbedding(segs: RawTranscriptSegment[], doctorEmbedding: number[], threshold = 0.7): LabeledSegment[] {
    const bySpeaker = this.groupSpeakers(segs);
    const doctorSpeaker = this.bestMatchSpeaker(bySpeaker, doctorEmbedding, threshold);
    // 매칭된 의사 화자가 없으면 확정(confident) 아님 → UI 수동 라벨 유도
    return this.applyDoctorSpeaker(segs, doctorSpeaker, doctorSpeaker !== null);
  }

  /** C안: 화자별 doctorScore 합산 최다 화자 = DOCTOR. 임베딩·등록 불필요. */
  resolveByHeuristic(segs: RawTranscriptSegment[]): LabeledSegment[] {
    if (!segs.length) return [];
    const score = new Map<string, number>();
    for (const s of segs) score.set(s.speaker, (score.get(s.speaker) ?? 0) + doctorScore(s.text));
    const doctorSpeaker = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    // 신뢰도: 최다-차순위 점수차가 있어야 confident
    const sorted = [...score.values()].sort((a, b) => b - a);
    const confident = sorted.length >= 2 ? sorted[0] > sorted[1] : sorted[0] > 0;
    return this.applyDoctorSpeaker(segs, doctorSpeaker, confident);
  }

  private applyDoctorSpeaker(segs: RawTranscriptSegment[], doctorSpeaker: string | null, confident: boolean): LabeledSegment[] {
    // 의사 외 화자 중 발화량(문자 수) 최다 = PATIENT 후보, 나머지 비의사 = OTHER
    const nonDoctor = segs.filter((s) => s.speaker !== doctorSpeaker);
    const charBySpeaker = new Map<string, number>();
    for (const s of nonDoctor) charBySpeaker.set(s.speaker, (charBySpeaker.get(s.speaker) ?? 0) + s.text.length);
    const patientSpeaker = [...charBySpeaker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return segs.map((s) => {
      let role: Role = 'UNKNOWN';
      if (doctorSpeaker && s.speaker === doctorSpeaker) role = 'DOCTOR';
      else if (patientSpeaker && s.speaker === patientSpeaker) role = 'PATIENT';
      else role = 'OTHER';
      return { ...s, role, confident: confident && (role === 'DOCTOR' || role === 'PATIENT') };
    });
  }

  private groupSpeakers(segs: RawTranscriptSegment[]): Map<string, RawTranscriptSegment[]> {
    const m = new Map<string, RawTranscriptSegment[]>();
    for (const s of segs) (m.get(s.speaker) ?? m.set(s.speaker, []).get(s.speaker)!).push(s);
    return m;
  }

  private bestMatchSpeaker(bySpeaker: Map<string, RawTranscriptSegment[]>, target: number[], threshold: number): string | null {
    let best: string | null = null;
    let bestSim = threshold;
    for (const [spk, list] of bySpeaker) {
      const emb = list.find((s) => Array.isArray(s.embedding))?.embedding;
      if (!emb) continue;
      const sim = cosine(emb, target);
      if (sim >= bestSim) {
        bestSim = sim;
        best = spk;
      }
    }
    return best;
  }
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
