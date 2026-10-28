import { describe, it, expect, vi } from 'vitest';
import { HIS_VERSION } from '@hospital-run/shared';
import { parseBuildInfo, readBuildInfo, buildInfoCandidates } from '../../src/modules/health/build-info';
import { PublicVersionController } from '../../src/modules/health/public-version.controller';

/**
 * 공개 버전 EP · 산출물 기록 판독 (2026-09-13 상용 릴리즈 T1-4·T1-5).
 * 지키는 것: ① 기록이 있으면 그대로 · ② 🔴 없거나 틀리면 **null** — 추정 커밋·현재 시각을 지어내지 않는다
 *            ③ 응답은 화이트리스트 필드만 ④ 실행 중 버전과 기록 버전을 합치지 않는다.
 */
const GOOD = JSON.stringify({ version: '4.19.0', commit: '13fceb9c0123456789abcdef0123456789abcdef', dirty: false, builtAt: '2026-09-13T01:02:03Z', source: 'deploy.sh' });

describe('build-info — 운영 산출물 기록 판독', () => {
  it('① 정상 기록을 그대로 읽는다', () => {
    const b = parseBuildInfo(GOOD);
    expect(b).toEqual({ commit: '13fceb9c0123456789abcdef0123456789abcdef', dirty: false, builtAt: '2026-09-13T01:02:03Z', recordedVersion: '4.19.0', source: 'file' });
  });

  it('② 🔴 파일이 없으면 전 필드 null · unavailable — 지어내지 않는다', () => {
    const b = readBuildInfo({}, '/nowhere', () => { throw new Error('ENOENT'); });
    expect(b).toEqual({ commit: null, dirty: null, builtAt: null, recordedVersion: null, source: 'unavailable' });
  });

  it('② 🔴 형식이 틀린 값은 그 필드만 null(커밋 흉내·시각 문자열 오염)', () => {
    const b = parseBuildInfo(JSON.stringify({ commit: 'HEAD', dirty: 'no', builtAt: 'yesterday', version: 'latest' }));
    expect(b).toEqual({ commit: null, dirty: null, builtAt: null, recordedVersion: null, source: 'file' });
    expect(parseBuildInfo('{깨진 json').source).toBe('unavailable');
  });

  it('후보 경로: BUILD_INFO_PATH 가 먼저 · 첫 번째로 읽힌 파일을 쓴다', () => {
    expect(buildInfoCandidates({ BUILD_INFO_PATH: '/x/B.json' }, '/app')[0]).toBe('/x/B.json');
    const read = vi.fn((p: string) => { if (p === '/app/apps/api/BUILD_INFO.json') return GOOD; throw new Error('ENOENT'); });
    expect(readBuildInfo({}, '/app', read).commit).toMatch(/^13fceb9c/);
  });
});

describe('PublicVersionController — GET /api/v1/public/version', () => {
  it('③ 🔴 화이트리스트 필드만 낸다(호스트·경로·env 없음) · 실행 중 버전과 기록 버전을 따로 낸다', async () => {
    const mode = { effective: vi.fn(async () => 'REHEARSAL') };
    const ctrl = new PublicVersionController(mode as never);
    const res = await ctrl.get();
    expect(Object.keys(res.data).sort()).toEqual(['buildInfo', 'builtAt', 'commit', 'dirty', 'mode', 'recordedVersion', 'version']);
    expect(res.data.version).toBe(HIS_VERSION);
    expect(res.data.mode).toBe('REHEARSAL');
    // 테스트 환경엔 기록이 없다 — null 이어야 한다(현재 커밋을 git 에서 읽어 채우면 거짓이다)
    if (res.data.buildInfo === 'unavailable') expect(res.data.commit).toBeNull();
  });

  it('라우트는 무인증 공개 경로이고 guard 데코레이터가 없다(의도 — 읽기 전용·민감정보 없음)', () => {
    const path = Reflect.getMetadata('path', PublicVersionController);
    expect(path).toBe('api/v1/public/version');
    expect(Reflect.getMetadata('__guards__', PublicVersionController)).toBeUndefined();
  });
});
