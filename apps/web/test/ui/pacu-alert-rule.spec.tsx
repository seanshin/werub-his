/** 회복실 활력 경보 기준 표시(2026-10-01) — 숫자는 서버 설정에서만 · 출처 3상태 · 적용 안 된 설정 키를 숨기지 않는다 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const T = { spo2Low: 94, hrLow: 50, hrHigh: 110, rrLow: 8, rrHigh: 24, sbpLow: 90, sbpHigh: 180, tempLow: 35, tempHigh: 38.5 };
beforeEach(() => cleanup());

describe('PACU 활력 경보 기준', () => {
  it('설정 응답의 숫자를 그린다 · 원내 설정이면 그렇게 말한다', async () => {
    const { PacuAlertRule } = await import('@/app/(main)/pacu/PacuAlertRule');
    const { container } = render(<PacuAlertRule s={{ alertThresholds: T, alertSource: 'CONFIG', alertDroppedKeys: [] }} />);
    expect(container.textContent).toContain('SpO2 <94');
    expect(container.textContent).toContain('HR <50/>110');
    expect(container.textContent).toContain('원내 설정');
  });
  it('🔴 미설정은 "기본값 적용"이라 말한다 · 조회 실패는 실패로 · 버린 키를 밝힌다', async () => {
    const { PacuAlertRule } = await import('@/app/(main)/pacu/PacuAlertRule');
    let r = render(<PacuAlertRule s={{ alertThresholds: T, alertSource: 'DEFAULT', alertDroppedKeys: ['spO2Low'] }} />);
    expect(r.container.textContent).toContain('원내 기준 미설정 — 기본값 적용');
    expect(r.container.textContent).toContain('적용되지 않은 설정 키: spO2Low');
    cleanup();
    r = render(<PacuAlertRule s={{ alertThresholds: T, alertSource: 'UNAVAILABLE' }} />);
    expect(r.container.textContent).toContain('설정 조회 실패');
  });
  it('화면에 임계 숫자를 적지 않는다(설정 응답만)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/pacu/PacuAlertRule.tsx'), 'utf8');
    expect(src).not.toMatch(/&lt;\s*\d|&gt;\s*\d|≥\s*\d/);
  });
});
