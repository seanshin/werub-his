import { describe, it, expect } from 'vitest';
import { VadSegmenter } from './vad-segmenter';
import { guessSpeaker } from './speaker-heuristic';

/** 앰비언트 P0 순수 로직 골든 — 발화 경계·화자 휴리스틱 */

describe('VadSegmenter — 발화 경계', () => {
  it('연속 2프레임 유성에서 onset(단발 스파이크는 무시)', () => {
    const seg = new VadSegmenter({ onsetFrames: 2 });
    expect(seg.feed(true, 0)).toBe('none');    // 1프레임 — 아직
    expect(seg.feed(true, 85)).toBe('onset');  // 2연속 — 시작
    expect(seg.active).toBe(true);
  });

  it('스파이크 1프레임 후 무성이면 시작하지 않음', () => {
    const seg = new VadSegmenter({ onsetFrames: 2 });
    expect(seg.feed(true, 0)).toBe('none');
    expect(seg.feed(false, 85)).toBe('none'); // run 리셋
    expect(seg.feed(true, 170)).toBe('none'); // 다시 1부터
    expect(seg.active).toBe(false);
  });

  it('무성 1200ms 지속 시 offset(조기 final)', () => {
    const seg = new VadSegmenter({ silenceMs: 1200 });
    seg.feed(true, 0); seg.feed(true, 85);
    expect(seg.feed(false, 500)).toBe('none');   // 415ms — 유지
    expect(seg.feed(false, 1000)).toBe('none');  // 915ms — 유지
    expect(seg.feed(false, 1300)).toBe('offset'); // ≥1200ms — 종료
    expect(seg.active).toBe(false);
  });

  it('짧은 숨고르기(<1200ms)는 발화 유지', () => {
    const seg = new VadSegmenter({ silenceMs: 1200 });
    seg.feed(true, 0); seg.feed(true, 85);
    seg.feed(false, 500);
    expect(seg.feed(true, 900)).toBe('none'); // 재발화 — 유지(추가 onset 없음)
    expect(seg.active).toBe(true);
    expect(seg.feed(false, 2000)).toBe('none'); // lastSpeech=900 → 1100ms — 아직
    expect(seg.feed(false, 2200)).toBe('offset'); // 1300ms — 종료
  });

  it('offset 후 재발화는 새 onset', () => {
    const seg = new VadSegmenter({ onsetFrames: 2, silenceMs: 1200 });
    seg.feed(true, 0); seg.feed(true, 85);
    seg.feed(false, 100); seg.feed(false, 1400); // offset
    expect(seg.feed(true, 2000)).toBe('none');
    expect(seg.feed(true, 2085)).toBe('onset');
  });
});

describe('guessSpeaker — 화자 휴리스틱 골든', () => {
  // 의사 — 질문형
  it.each([
    '어디가 불편해서 오셨어요?',
    '언제부터 아프셨나요',
    '요즘 잠은 잘 주무세요?',
    '약은 잘 드세요?',
  ])('의사(질문): %s', (t) => expect(guessSpeaker(t)).toBe('DOCTOR'));

  // 의사 — 지시/계획
  it.each([
    '흉부 엑스레이 찍고 항생제 삼일 처방할게요',
    '혈액 검사 해드릴게요',
    '일주일 경과를 보겠습니다',
  ])('의사(지시): %s', (t) => expect(guessSpeaker(t)).toBe('DOCTOR'));

  // 환자 — 1인칭 증상
  it.each([
    '삼일 전부터 기침이 심하고 밤에 열이 나요',
    '머리가 지끈지끈 아파요',
    '가슴 통증은 없어요',
    '속이 메스껍고 어지러워요',
    '혈압약은 아침에 먹고 있어요',
  ])('환자(증상): %s', (t) => expect(guessSpeaker(t)).toBe('PATIENT'));

  // 신호 없음 — UNKNOWN(억지 귀속 금지)
  it.each(['네', '알겠습니다', '오늘 날씨가 춥네요'])('미상: %s', (t) => expect(guessSpeaker(t)).toBe('UNKNOWN'));

  // 혼합 신호 — 질문/지시 우선(의사도 증상 어휘로 되물음)
  it('혼합: "기침이 언제부터 있으세요?" → 의사', () => {
    expect(guessSpeaker('기침이 언제부터 있으세요?')).toBe('DOCTOR');
  });
});
