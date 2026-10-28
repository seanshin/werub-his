/**
 * 간호 질관리 잔여(2026-10-26) — 화면 쪽.
 *  · 🔴 워크스테이션 활력 입력이 측정 시각을 보내지 않아 전부 '측정 시각 미상'이던 것 → 플로시트와 같은 변환 · 비우면 보내지 않는다(지금으로 지어내지 않음)
 *  · 🔴 Morse·Braden 등급은 shared 정본 — 워크스테이션·차트 렌더러에 숫자 경계 사본 없음 · 차트 렌더러 Braden 4단계(15~18 경위험·19+ 정상) 회수
 *  · 🔴 보호대 화면 '점검 권장 2시간마다' 고정 문구 → 서버가 준 간격·출처 · 처방 기한 경과와 점검 지연을 가른다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { localInputToIso, toFlowsheetBody } from '@/lib/flowsheet-form';

const SRC = join(__dirname, '../../src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('측정 시각', () => {
  it('비우면 undefined(지어내지 않음) · 잘못된 값 undefined · 값은 ISO · 플로시트도 같은 변환', () => {
    expect(localInputToIso('')).toBeUndefined();
    expect(localInputToIso(undefined)).toBeUndefined();
    expect(localInputToIso('nope')).toBeUndefined();
    expect(localInputToIso('2026-10-26T09:30')).toBe(new Date('2026-10-26T09:30').toISOString());
    expect(toFlowsheetBody({ heartRate: 80, recordedAtLocal: '2026-10-26T09:30' }).recordedAt).toBe(new Date('2026-10-26T09:30').toISOString());
    expect(toFlowsheetBody({ heartRate: 80 })).not.toHaveProperty('recordedAt');
  });
  it('🔴 워크스테이션 활력 저장이 측정 시각을 같은 변환으로 보낸다 · 입력 칸 · 비었다는 안내', () => {
    const s = code('app/(main)/workstation/nursing/page.tsx');
    expect(s).toMatch(/recordedAt: localInputToIso\(form\.measuredAtLocal\)/);
    expect(s).toMatch(/data-ws-measured-at/);
    expect(s).toMatch(/data-ws-measured-at-empty/);
  });
});

describe('🔴 위험 등급 정본', () => {
  it('워크스테이션·차트 렌더러에 Morse·Braden 숫자 경계 사본 없음 · 정본 함수 사용', () => {
    const ws = code('app/(main)/workstation/nursing/page.tsx');
    expect(ws).not.toMatch(/morseTotal\s*>=\s*(45|25)/);
    expect(ws).toMatch(/morseRiskLevel\(morseTotal\)/);
    const cr = code('components/chart/ChartRenderer.tsx');
    expect(cr).not.toMatch(/total\s*>=\s*45 \? \{ label: '고위험'/);
    expect(cr).not.toMatch(/경위험/);
    expect(cr).toMatch(/morseRiskLevel\(total\)/);
    expect(cr).toMatch(/bradenRiskLevel\(total\)/);
  });
});

describe('🔴 보호대 점검 간격', () => {
  it('고정 "2시간마다" 문구 없음 · 서버 간격·출처 · 처방 기한 경과 따로 · 점검 기록 없음', () => {
    const s = code('app/(main)/safety/page.tsx');
    expect(s).not.toMatch(/2시간마다/);
    expect(s).toMatch(/checkIntervalMinutes/);
    expect(s).toMatch(/checkIntervalSource === 'CODE_DEFAULT'/);
    expect(s).toMatch(/data-restraint-expired/);
    expect(s).toMatch(/⏰ 점검 기록 없음/);
  });
});
