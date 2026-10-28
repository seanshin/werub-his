/**
 * 서버용 교대 창(2026-09-30) — 근무조 마감·늦은 기록 판정이 실행 환경 시간대에 기대지 않는다.
 * 시각은 전부 UTC 로 적고 KST(+9) 벽시계로 읽는다.
 */
import { describe, it, expect } from 'vitest';
import { shiftWindowAt, isLateNursingEntry, DEFAULT_SHIFT_BOUNDARIES } from '../src/shift';

const kst = (s: string) => new Date(`${s}+09:00`);

describe('shiftWindowAt — 병원 표준시(KST) 기준', () => {
  it('DAY 10:00 → 07~15', () => {
    const w = shiftWindowAt(kst('2026-09-30T10:00:00'));
    expect(w.shift).toBe('DAY');
    expect(w.start).toEqual(kst('2026-09-30T07:00:00'));
    expect(w.end).toEqual(kst('2026-09-30T15:00:00'));
  });
  it('EVENING 경계 15:00 은 EVENING 시작', () => {
    const w = shiftWindowAt(kst('2026-09-30T15:00:00'));
    expect(w.shift).toBe('EVENING');
    expect(w.end).toEqual(kst('2026-09-30T23:00:00'));
  });
  it('NIGHT 23:30 → 당일 23시 ~ 익일 07시', () => {
    const w = shiftWindowAt(kst('2026-09-30T23:30:00'));
    expect(w).toMatchObject({ shift: 'NIGHT' });
    expect(w.start).toEqual(kst('2026-09-30T23:00:00'));
    expect(w.end).toEqual(kst('2026-10-01T07:00:00'));
  });
  it('🔴 NIGHT 자정 이후 03:00 → **전날** 23시 ~ 당일 07시(모레로 넘어가지 않는다)', () => {
    const w = shiftWindowAt(kst('2026-10-01T03:00:00'));
    expect(w.shift).toBe('NIGHT');
    expect(w.start).toEqual(kst('2026-09-30T23:00:00'));
    expect(w.end).toEqual(kst('2026-10-01T07:00:00'));
  });
  it('UTC 자정 근처(KST 08:59)도 KST 로 읽는다 — 환경 getHours 에 기대지 않는다', () => {
    const w = shiftWindowAt(new Date('2026-09-29T23:59:00Z')); // KST 09-30 08:59
    expect(w.shift).toBe('DAY');
    expect(w.start).toEqual(kst('2026-09-30T07:00:00'));
  });
  it('병원 설정 경계(6/14/22)를 따른다', () => {
    const w = shiftWindowAt(kst('2026-09-30T14:30:00'), { day: 6, evening: 14, night: 22 });
    expect(w.shift).toBe('EVENING');
    expect(w.start).toEqual(kst('2026-09-30T14:00:00'));
  });
});

describe('isLateNursingEntry — 근무조가 끝난 뒤에 적은 기록', () => {
  it('근무조 안에서 적으면 늦은 기록이 아니다', () => {
    expect(isLateNursingEntry(kst('2026-09-30T10:00:00'), kst('2026-09-30T14:59:00'))).toBe(false);
  });
  it('🔴 DAY 관찰을 EVENING 에 적으면 늦은 기록', () => {
    expect(isLateNursingEntry(kst('2026-09-30T10:00:00'), kst('2026-09-30T15:00:00'))).toBe(true);
  });
  it('NIGHT 관찰(02:00)을 같은 NIGHT(06:30)에 적으면 아니다', () => {
    expect(isLateNursingEntry(kst('2026-10-01T02:00:00'), kst('2026-10-01T06:30:00'))).toBe(false);
  });
  it('날짜가 깨졌으면 표식하지 않는다(모르는 것을 늦었다고 말하지 않는다)', () => {
    expect(isLateNursingEntry('x', kst('2026-10-01T06:30:00'), DEFAULT_SHIFT_BOUNDARIES)).toBe(false);
  });
});

import { normalizeLateEntryGraceMinutes } from '../src/shift';
describe('늦은 기록 유예(원내 규정 · 2026-10-01)', () => {
  it('유예 30분 — DAY 관찰을 15:20 에 적으면 늦은 기록이 아니다 · 15:30 부터 늦은 기록', () => {
    expect(isLateNursingEntry(kst('2026-09-30T10:00:00'), kst('2026-09-30T15:20:00'), DEFAULT_SHIFT_BOUNDARIES, 30)).toBe(false);
    expect(isLateNursingEntry(kst('2026-09-30T10:00:00'), kst('2026-09-30T15:30:00'), DEFAULT_SHIFT_BOUNDARIES, 30)).toBe(true);
  });
  it('대조군 — 미설정(null)은 유예 0 = 종료 시각 기준', () => {
    expect(isLateNursingEntry(kst('2026-09-30T10:00:00'), kst('2026-09-30T15:00:00'), DEFAULT_SHIFT_BOUNDARIES, null)).toBe(true);
  });
  it('정규화 — 0~720 정수만, 나머지는 미설정(null)', () => {
    expect(normalizeLateEntryGraceMinutes(30)).toBe(30);
    expect(normalizeLateEntryGraceMinutes('60')).toBe(60);
    expect(normalizeLateEntryGraceMinutes(0)).toBe(0);
    for (const bad of [null, undefined, '', -1, 721, 1.5, 'x', {}]) expect(normalizeLateEntryGraceMinutes(bad)).toBeNull();
  });
});

import { vitalNormalRangeText, temperatureStatus, vitalItemFlags, worseVitalFlag, VITALS_THRESHOLDS } from '../src/vitals-thresholds';
describe('활력 임계 정본(shared · 2026-10-01)', () => {
  it('정상 범위 표기 — 화면이 숫자를 따로 적지 않게', () => {
    expect(vitalNormalRangeText(VITALS_THRESHOLDS.systolicBp)).toBe('90–140');
    expect(vitalNormalRangeText(VITALS_THRESHOLDS.spo2)).toBe('>95');
  });
  it('체온 라벨 — 고열/발열/저체온은 임계에서', () => {
    expect(temperatureStatus(38.6, VITALS_THRESHOLDS.temperature)).toBe('HYPERTHERMIA');
    expect(temperatureStatus(37.6, VITALS_THRESHOLDS.temperature)).toBe('FEVER');
    expect(temperatureStatus(34.9, VITALS_THRESHOLDS.temperature)).toBe('HYPOTHERMIA');
    expect(temperatureStatus(null, VITALS_THRESHOLDS.temperature)).toBeNull();
  });
  it('미측정은 null · 더 나쁜 쪽', () => {
    expect(vitalItemFlags({}).heartRate).toBeNull();
    expect(worseVitalFlag('WARNING', 'CRITICAL')).toBe('CRITICAL');
    expect(worseVitalFlag(null, null)).toBeNull();
  });
});
