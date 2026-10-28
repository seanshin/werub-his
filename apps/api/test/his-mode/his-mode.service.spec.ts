import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HisModeService } from '../../src/common/his-mode/his-mode.service';

/**
 * 🔴 이 서비스가 하는 일은 하나다: **런타임이 빌드보다 넓히지 못하게 하는 것.**
 *    넓혀지면 화면은 "리허설"이라 말하는데 대외 발신 차단이 풀리거나,
 *    반대로 리얼 배포본이 "개발"이라 말하면서 없는 시드 로그인을 약속하게 된다.
 */
const cfg = (value: unknown, throws = false) =>
  ({ get: vi.fn().mockImplementation(async () => { if (throws) throw new Error('DB down'); return value; }) }) as any;

describe('HisModeService — 빌드 상한과 런타임 토글', () => {
  const ORIGINAL = process.env.HIS_MODE;
  beforeEach(() => { delete process.env.HIS_MODE; });
  afterEach(() => { if (ORIGINAL === undefined) delete process.env.HIS_MODE; else process.env.HIS_MODE = ORIGINAL; });

  it('🔴 HIS_MODE 미설정이면 REAL 이다(설정돼 있겠지 싶은 변수에 안전을 걸지 않는다)', async () => {
    const s = await new HisModeService(cfg(null)).state();
    expect(s.build).toBe('REAL');
    expect(s.effective).toBe('REAL');
  });

  it('해석 불가한 값도 REAL 로 접힌다', async () => {
    process.env.HIS_MODE = 'staging';
    expect(new HisModeService(cfg(null)).buildMode()).toBe('REAL');
  });

  it('🔴 리얼 빌드에서 런타임이 DEV 여도 넓어지지 않고, 넓히려 했다는 사실을 밖으로 알린다', async () => {
    process.env.HIS_MODE = 'REAL';
    const s = await new HisModeService(cfg('DEV')).state();
    expect(s.effective).toBe('REAL');
    expect(s.runtimeEffective).toBe(false);
  });

  it('리허설 빌드에서 런타임 REAL 은 그대로 좁혀 적용된다', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    const s = await new HisModeService(cfg('REAL')).state();
    expect(s.effective).toBe('REAL');
    expect(s.runtimeEffective).toBe(true);
  });

  it('대조군 — 리허설 빌드 + 런타임 미설정이면 리허설이다(빌드 모드를 그대로 쓴다)', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    const s = await new HisModeService(cfg(null)).state();
    expect(s.effective).toBe('REHEARSAL');
    expect(s.runtime).toBeNull();
  });

  it('🔴 설정 조회가 실패해도 모드가 넓어지지 않는다(장애가 게이트를 열지 않는다)', async () => {
    process.env.HIS_MODE = 'REAL';
    const s = await new HisModeService(cfg(null, true)).state();
    expect(s.effective).toBe('REAL');
  });

  it('조회 실패 시 리허설 빌드는 리허설로 남는다(실패를 REAL 로도 번역하지 않는다)', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    const s = await new HisModeService(cfg(null, true)).state();
    expect(s.effective).toBe('REHEARSAL');
  });
});
