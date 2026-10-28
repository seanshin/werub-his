import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseBuildTs, formatBuildTs, buildTsAge, buildTsAgeMs } from '../../src/lib/build-status';

/**
 * 홈페이지 빌드 상태 시각 — 압축 형식도 읽는다.
 *
 * 🔴 2026-09-02 운영 실측: 상태 파일이 `{"status":"deploy_triggered","ts":"20260617-1748"}` 였다.
 *    `ts` 는 아티팩트 파일명(`homepage-20260617-1748.tgz`)과 같은 형식이라 `new Date()` 가
 *    **Invalid Date** 를 낸다 → 화면은 "Invalid Date" 를 그렸고, 경과 시간·상태 만료 판정이 통째로
 *    죽어 **6월 트리거가 77일 동안 '배포 전환 중 … 잠시 후 반영'** 으로 보였다.
 */
afterEach(() => vi.useRealTimers());

describe('빌드 상태 시각 파싱', () => {
  it('🔴 압축 형식(YYYYMMDD-HHMM)을 읽는다 — 운영에 실제로 있는 값', () => {
    const d = parseBuildTs('20260617-1748');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-06-17T08:48:00.000Z'); // KST 17:48
  });

  it('오프셋 포함 ISO(이후 빌드가 남기는 at)도 읽는다', () => {
    const d = parseBuildTs('2026-09-02T11:05:00+09:00');
    expect(d!.toISOString()).toBe('2026-09-02T02:05:00.000Z');
  });

  it('🔴 못 읽는 값은 지어내지 않는다 — 원문을 그대로 보이고 경과는 비운다', () => {
    expect(parseBuildTs('알 수 없음')).toBeNull();
    expect(formatBuildTs('알 수 없음')).toBe('알 수 없음');
    expect(buildTsAge('알 수 없음')).toBe('');
    expect(buildTsAgeMs('알 수 없음')).toBeNull();
    expect(formatBuildTs(undefined)).toBe('');
  });

  it('🔴 압축 형식에서 경과 시간이 나온다(종전엔 빈 값이라 아무도 낡은 줄 몰랐다)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T01:00:00Z'));
    expect(buildTsAge('20260617-1748')).toBe('76일 전');
    expect(buildTsAgeMs('20260617-1748')!).toBeGreaterThan(70 * 24 * 3600 * 1000);
  });

  it('대조군: 방금 만든 기록은 낡았다고 말하지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T01:00:00Z'));
    expect(buildTsAge('2026-09-02T10:00:00+09:00')).toBe('방금');   // 같은 시각 = 0분
    expect(buildTsAge('2026-09-02T09:30:00+09:00')).toBe('30분 전');
  });
});

describe('배포 화면이 그 정본을 쓴다', () => {
  it('화면이 new Date(ts) 를 직접 쓰지 않는다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'app', '(main)', 'admin', 'homepage', 'deploy', 'page.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('formatBuildTs');
    expect(src).toContain('buildTsAge');
    expect(src, '직접 파싱하면 압축 형식에서 다시 Invalid Date 가 된다').not.toMatch(/new Date\((?!\))/);
  });
});
