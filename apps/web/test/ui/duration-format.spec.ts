import { describe, it, expect } from 'vitest';
import { durationSegments, durationText } from '../../src/components/ui/display';

/**
 * 경과 시간 표기 계약 — 2026-08-12.
 *
 * 🔴 화면마다 로컬 포맷터를 두니 24시간을 일로 바꾸지 못해 **`1815시간 1분`(=75일)** 같은 값이 나왔다
 *    (검사·영상 보드 TAT 실측). 규칙을 한 곳(`durationSegments`)에 두고 JSX(`<Duration>`)와
 *    문자열(`durationText`)이 **같은 조각**을 쓰게 한다 — 따로 구현하면 한쪽만 고쳐져 또 갈라진다.
 */

describe('경과 시간 표기', () => {
  it('60분 미만은 분', () => {
    expect(durationText(0)).toBe('0분');
    expect(durationText(59)).toBe('59분');
  });

  it('60분 이상은 시간+분', () => {
    expect(durationText(60)).toBe('1시간');
    expect(durationText(352)).toBe('5시간 52분'); // 관제 평균 대기 실측값
    expect(durationText(508)).toBe('8시간 28분'); // 원무 보드 실측값
  });

  it('🔴 24시간 이상은 일로 바꾼다 — `1815시간 1분` 이 나오면 안 된다', () => {
    expect(durationText(1815 * 60 + 1)).toBe('75일 15시간');
    expect(durationText(1440)).toBe('1일');
    expect(durationText(1500)).toBe('1일 1시간');
  });

  it('dense 는 분을 생략한다(좁은 칸)', () => {
    expect(durationText(352, '-', true)).toBe('5시간');
  });

  it('값이 없거나 음수면 폴백', () => {
    expect(durationText(null)).toBe('-');
    expect(durationText(undefined)).toBe('-');
    expect(durationText(-1)).toBe('-');
    expect(durationText(NaN)).toBe('-');
    expect(durationText(null, '기록 없음')).toBe('기록 없음');
  });

  it('소수 분은 반올림하고, 경계 판정은 반올림한 값으로 한다', () => {
    expect(durationText(59.4)).toBe('59분');
    expect(durationText(59.6)).toBe('1시간'); // 60 으로 반올림 → 시간 단위로 넘어간다
  });

  it('🔴 문자열과 조각이 같은 규칙을 쓴다(구현 분기 방지)', () => {
    for (const m of [0, 30, 59, 60, 90, 352, 1439, 1440, 1500, 108901]) {
      const seg = durationSegments(m)!;
      expect(durationText(m)).toBe(seg.map((s) => `${s.value}${s.unit}`).join(' '));
    }
  });
});
