import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **보안 대시보드의 SMART 접근 카운트가 실패를 0으로 삼키지 않는다** (2026-08-31 · 발굴).
 *
 * `getAccessStats` 의 Promise.all 안에서 형제 카운트(auditLog·breakTheGlass·patientFlag)는
 * 실패를 전파하는데 smartAccessLog.count 3개만 `.catch(() => 0)` 였다 → smartAccessLog 조회가
 * 특정하게 실패하면 외부 앱 접근을 **0으로 undercount**(실제보다 덜 위험하게). SmartAccessLog 는
 * 표준 모델이라 항상 존재한다 → 형제처럼 전파한다.
 * 규약: *".catch(() => 기본값) 은 실패를 없음으로 번역하는 코드다 — 전파하거나 3상태로 말한다"*
 */
const src = readFileSync(
  join(process.cwd(), 'src/modules/audit-enhanced/anomaly-detection.service.ts'),
  'utf8',
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 SMART 접근 카운트 정직성', () => {
  it('smartAccessLog.count 가 실패를 0 으로 삼키지 않는다(코드에서)', () => {
    // 주석을 지운 실코드에 smartAccessLog...catch(() => 0) 패턴이 없어야 한다
    const bad = /smartAccessLog[\s\S]{0,120}?\.catch\(\s*\(\)\s*=>\s*0\s*\)/.test(code);
    expect(bad, 'smartAccessLog.count(...).catch(() => 0) 재발 — 형제처럼 전파해야 한다').toBe(false);
  });

  it('smartAccessLog 카운트가 살아 있다(대조군 — 지우면 지표가 사라진다)', () => {
    expect(code).toMatch(/smartAccessLog\s*\.?\s*\n?\s*\.count/);
    expect(code).toContain('smartAccess,'); // 반환에 포함
  });

  it('형제 카운트는 원래 catch 가 없다(대조군 — 이 파일의 규범)', () => {
    expect(code).toMatch(/auditLog\.count\(\{ where \}\),/);
    expect(code, '형제에 catch 가 없어야 비대칭이 결함이었음이 성립').not.toMatch(/auditLog\.count[\s\S]{0,60}?\.catch/);
  });
});
