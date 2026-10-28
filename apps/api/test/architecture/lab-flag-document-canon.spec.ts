import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCriticalFlag, isAbnormalFlag } from '@hospital-run/shared';

/**
 * 🔴 **발급 문서·설명이 검사 flag 를 부분 매칭(H/L 만)하면 위급값(HH/LL/AA)이 정상처럼 샌다** (2026-09-01 · 발굴).
 *
 * 의무기록 사본 PDF 가 `flag === 'H' || 'L' || 'A'` 만 빨강으로 칠해, HH/LL/AA/CRITICAL 위급값이
 * 강조 없이 정상처럼 보였다. 정본 `isCriticalFlag`/`isAbnormalFlag`(lab-flags.ts)로 수렴.
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');

describe('🔴 정본 오라클(위급값이 정상으로 새지 않는다)', () => {
  it('위급 flag 는 abnormal 이자 critical 이다', () => {
    for (const f of ['HH', 'LL', 'AA', 'CRITICAL', 'PANIC']) {
      expect(isCriticalFlag(f), `${f} critical`).toBe(true);
      expect(isAbnormalFlag(f), `${f} abnormal`).toBe(true);
    }
    expect(isAbnormalFlag('N')).toBe(false);
    expect(isAbnormalFlag('NORMAL')).toBe(false);
  });
});

describe('🔴 발급 문서가 정본을 쓴다(회귀 잠금)', () => {
  it('pdf-generation — 하드코딩 H/L/A 만 빨강이 재발하지 않는다', () => {
    const s = src('medical-record-copy/pdf-generation.service.ts');
    // 검진 PDF 가 판정 정본 finding 을 읽도록 바뀜(2026-09-03) — 위급 판별이 정본 헬퍼를 지나는지가 계약
    expect(s).toMatch(/isCriticalFlag\((flag|finding)\)/);
    expect(s, "flag === 'H' || 'L' || 'A' 만 보는 하드코딩 재발")
      .not.toMatch(/flag === 'H' \|\| flag === 'L' \|\| flag === 'A' \|\| flag === '이상' \? 'color:red/);
  });
  it('record-issues — HH/LL 방향을 정본으로(H/L 만 보지 않는다)', () => {
    const s = src('record-timeline/record-issues.ts');
    expect(s).toMatch(/isHighFlag\(r\.flag\)/);
    expect(s).not.toMatch(/r\.flag === 'H' \? '상회' : r\.flag === 'L' \? '하회'/);
  });
});
