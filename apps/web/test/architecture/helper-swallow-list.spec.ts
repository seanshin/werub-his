/**
 * 🔴 (2026-09-14 P6) 화면의 queryFn·핸들러가 **다른 파일의 헬퍼**를 부르고, 실패는 그 헬퍼 안에서 삼켜지는 모양 —
 *    화면 파일만 보는 스캔(queryfn-catch-default·swallowed-failure-success-claim)이 못 본다.
 *    `apps/web/src/lib`·`hooks` 의 `.catch(() => …)`·`catch {…}` 를 파일별로 동결하고, 이번에 확정 교정한 3곳은 동작으로 못박는다.
 *
 * 교정 3: onboarding(성공 응답 해석 실패를 `{}` 데이터로) · fcm(404 외 인증·서버 오류까지 삼킴) · pacs(검사·환자 지정 실패를 말없이 뷰어 홈으로)
 * 정당(파일별 사유는 아래 표) — 늘거나 줄면 사람이 표와 사유를 같이 고친다(여유 0).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');

/** 파일별 catch 수 동결 + 사유 */
const FROZEN: Record<string, { n: number; why: string }> = {
  'lib/claim-xml-download.ts': { n: 1, why: '2026-10-14 P4-3 실패 응답 본문이 JSON 이 아니면 사유를 HTTP 상태로 말한다(실패는 이미 실패로 돌려준다 — 성공으로 접지 않는다)' },
  'lib/ai-stream-read.ts': { n: 2, why: '2026-10-07 오류 이벤트로 이미 실패 판정한 스트림의 나머지 취소(취소 실패는 결과에 영향 없음 · 실패는 ok:false 로 밝힘) · SOAP 텍스트 JSON 해석 실패는 글 형식으로 읽고 둘 다 없으면 null' },
  'lib/ai-proposal.ts': { n: 2, why: '실패를 ok:false/false 로 **밝혀** 돌려준다(3상태) — 삼킴 아님' },
  'lib/api-client.ts': { n: 5, why: '403 PIN 코드 판별용 오류 본문 파싱 2 · 토큰 갱신 실패=false(재로그인) · 오류 본문 비JSON→NETWORK_ERROR · localStorage 접근 불가' },
  'lib/crypto/key-backup.ts': { n: 2, why: '파싱 실패를 사용자 오류 메시지로 **던진다**' },
  'lib/crypto/webauthn.ts': { n: 1, why: '플랫폼 인증기 지원 여부 조회 — 모르면 미지원(기능 비활성)' },
  'lib/fcm.ts': { n: 2, why: '토큰 등록: 404(미등록 디바이스)만 접고 나머지는 console.warn · 미지원/권한거부=폴링 대체' },
  'lib/i18n/portal-i18n.ts': { n: 2, why: 'localStorage 접근 불가 — 언어 선호 보존 실패는 기본 언어' },
  'lib/onboarding.ts': { n: 1, why: 'JSON 파싱 시도 — 실패는 플래그로 받아 성공 응답이어도 던진다' },
  'lib/pacs.ts': { n: 1, why: '뷰어 폴백은 유지(막으면 방치) — 검사·환자 지정이면 경고 토스트·console.warn' },
  'lib/print.ts': { n: 3, why: 'localStorage 접근 불가 · 인쇄 실패는 toast.error+false 로 밝힘' },
  'lib/public-fetch.ts': { n: 2, why: '2026-09-14 R6: 네트워크 실패·본문 해석 실패 → `UNAVAILABLE`(3상태 `publicFetchResult`) — 목록·상세 소비처 8곳이 실패를 따로 그림 · 종전 `publicFetch`(null) 는 "없음"을 주장하지 않는 6곳만(`public-fetch-three-state.spec.ts` 동결)' },
  'lib/safe-date.ts': { n: 2, why: '날짜 파싱 실패 → null(표시 헬퍼의 계약)' },
  'lib/safe-redirect.ts': { n: 1, why: '디코드 실패 URL → null(열린 리다이렉트 방지 — 안전측)' },
  'lib/sse-signal.ts': { n: 1, why: '스트림 끊김 → 3초 백오프 재연결(실패를 다음 시도로 넘긴다)' },
  'lib/ui-settings.tsx': { n: 1, why: '표시 설정(ui.*) 조회 실패 → 기본 표시 설정 — 사실이 아니라 표시 선호(queryfn-catch-default 정당 목록과 같은 판정)' },
  'lib/upload.ts': { n: 2, why: '오류 본문 파싱(메시지 추출) · 🟡 업로드 성공 응답 비JSON → null(업로드는 이미 됐다 — 재시도 유도하면 중복 첨부)' },
  'lib/werub.ts': { n: 1, why: 'AI 호출 실패 → toast.error(silent 옵션 호출부 0) + null' },
};

function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.spec\./.test(e.name)) acc.push(p);
  }
  return acc;
}

function countCatches(src: string): number {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  return (s.match(/\.catch\(\s*\(\s*[\w$]*\s*(?::\s*\w+)?\s*\)\s*=>/g) ?? []).length
    + (s.match(/\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{/g) ?? []).length;
}

describe('web lib·hooks 헬퍼의 catch — 파일별 동결', () => {
  it('대조군 — 탐지기가 세 모양을 세고 주석은 세지 않는다', () => {
    expect(countCatches('a.catch(() => null); try {} catch { x } try {} catch (e) { y } // .catch(() => 1)')).toBe(3);
  });

  it('동결 표와 실트리가 정확히 같다(늘면 사유를 먼저 쓴다)', () => {
    const actual: Record<string, number> = {};
    for (const dir of ['lib', 'hooks']) {
      const abs = path.join(SRC, dir);
      if (!fs.existsSync(abs)) continue;
      for (const f of walk(abs)) {
        const n = countCatches(fs.readFileSync(f, 'utf8'));
        if (n) actual[path.relative(SRC, f)] = n;
      }
    }
    expect(actual).toEqual(Object.fromEntries(Object.entries(FROZEN).map(([k, v]) => [k, v.n])));
    for (const [k, v] of Object.entries(FROZEN)) expect(v.why.trim().length, k).toBeGreaterThan(0);
  });
});

describe('확정 교정 3곳 — 동작', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('@/stores/toast-store');
    vi.doUnmock('@/lib/api-client');
  });

  it('onboarding: 성공 응답을 해석 못 하면 {} 가 아니라 실패로 던진다 · 빈 본문은 null · 정상은 data', async () => {
    const respond = (status: number, body: string) =>
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body || null, { status })));
    respond(200, '<html>gateway</html>');
    const { onboardingApi } = await import('@/lib/onboarding');
    const err = await onboardingApi.view('t').then(() => null, (e: unknown) => e as Error);
    expect(err?.message).toMatch(/해석하지 못했습니다/);
    respond(204, '');
    await expect(onboardingApi.ackWelcome('t')).resolves.toBeNull();
    respond(200, JSON.stringify({ data: { name: 'x' } }));
    await expect(onboardingApi.view('t')).resolves.toEqual({ name: 'x' });
  });

  it('pacs: 검사 지정 열기가 실패하면 경고를 띄우고 뷰어 홈으로 폴백한다 · 대조군 — 성공이면 경고 없음', async () => {
    const warning = vi.fn();
    vi.doMock('@/stores/toast-store', () => ({ toast: { warning, error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
    const get = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'ERR_FORBIDDEN' }));
    vi.doMock('@/lib/api-client', () => ({ apiClient: { get, post: vi.fn() } }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { openPacsViewer } = await import('@/lib/pacs');
    await openPacsViewer('1.2.3');
    expect(warning).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/viewer/', '_blank', 'noopener,noreferrer');

    get.mockResolvedValueOnce({ data: { url: '/viewer/?StudyInstanceUIDs=1.2.3&token=t' } });
    warning.mockClear();
    await openPacsViewer('1.2.3');
    expect(warning).not.toHaveBeenCalled();
  });

  it('fcm: 토큰 등록 catch 는 404 만 접는다(무조건 삼키는 모양이 아니다)', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib/fcm.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/fcm-token'[^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*undefined\s*\)/);
    expect(src).toMatch(/ERR_NOT_FOUND/);
    expect(src).toMatch(/console\.warn\(/);
  });
});
