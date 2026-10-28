import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceUnavailableException, BadGatewayException, HttpException, HttpStatus } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TelehealthRecordingsService } from '../../src/modules/telehealth/telehealth-recordings.service';
import { msgException } from '../../src/common/msg-exception';
import { serverMsg } from '@hospital-run/shared';
import { SERVER_MESSAGE_SOURCES, sourceKeysOf, unregisteredKeys, composedLines } from '../architecture/server-message-sources';

/**
 * 원격진료 녹화 API 키 — 외부 점검.
 *
 * 무엇이 틀려 있었나: 녹화 화면이 브라우저 공개 환경변수(`NEXT_PUBLIC_…_RECORDINGS_KEY`)로 API 키를 읽어
 * **브라우저에서 직접** Jitsi 녹화 API 를 불렀다. 공개 접두어 변수는 빌드 시 번들에 박히고,
 * '전체 관리 UI' 링크는 `?key=<키>` 로 **URL 에** 키를 실었다 — 역할이 admin/operator 면 삭제까지 가능.
 *
 * 🔴 재주입하면 반드시 실패한다(2026-09-22 main 위에서 실제로 되돌려 확인):
 *   - `assertConfigured()` 를 지우면 → '미설정이면 503' 실패
 *   - 화면에 공개 환경변수 키를 되살리면 → '화면에 키가 없다' 실패
 *   - 실패를 빈 목록으로 번역하면 → '녹화 서버 오류를 목록 0건으로 바꾸지 않는다' 실패
 *   - 🔴 프록시 소스 없이 `raw-egress-guard` 기준선(18→19)만 올리면 → 이 파일의 import 가 깨지고
 *     '서버 프록시 파일이 실제로 fetch 를 한 번 한다' 가 실패한다(기준선과 소스는 한 벌).
 */
describe('녹화 API 서버 프록시 (D-27)', () => {
  const env: Record<string, string | undefined> = {};
  const configOf = () => ({ get: (k: string) => env[k] });
  let fetchSpy: any;

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
  });
  afterEach(() => fetchSpy.mockRestore());

  const codeOf = (e: unknown) => ((e as HttpException).getResponse() as { code?: string }).code;

  it('🔴 URL·키 미설정이면 503 으로 말한다 — 빈 목록으로 위장하지 않는다 · 녹화 서버를 부르지도 않는다', async () => {
    const svc = new TelehealthRecordingsService(configOf() as any);
    expect(svc.configured()).toBe(false);
    const err = await svc.list().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(codeOf(err)).toBe('RECORDINGS_NOT_CONFIGURED');
    expect((err.getResponse() as { msg?: { k: string } }).msg?.k).toContain('설정되지 않았습니다');
    expect(fetchSpy).not.toHaveBeenCalled();
    // URL 만 있고 키가 없어도 같다(반쪽 설정을 "설정됨"으로 읽지 않는다)
    env.TELEHEALTH_RECORDINGS_URL = 'http://meet-api:8080';
    await expect(new TelehealthRecordingsService(configOf() as any).remove('r1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // 대조군 — 설정되면 서버가 키를 헤더로 싣고 정상 동작한다
  it('[대조군] 설정되면 서버가 X-API-Key 를 헤더로 싣는다(쿼리가 아니다)', async () => {
    env.TELEHEALTH_RECORDINGS_URL = 'http://meet-api:8080/';
    env.TELEHEALTH_RECORDINGS_KEY = 'server-only-key';
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'r1' }] }), headers: new Headers() } as any);
    const svc = new TelehealthRecordingsService(configOf() as any);
    const out: any = await svc.list('keyword');
    expect(out.data[0].id).toBe('r1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://meet-api:8080/recordings?keyword=keyword'); // 끝의 / 정리
    expect((init.headers as any)['X-API-Key']).toBe('server-only-key');
    expect(String(url)).not.toContain('server-only-key'); // 키가 URL 에 실리지 않는다
  });

  it('🔴 녹화 서버 오류(401 등)를 목록 0건으로 바꾸지 않는다 — 502 · 상태코드는 값으로', async () => {
    env.TELEHEALTH_RECORDINGS_URL = 'http://meet-api:8080';
    env.TELEHEALTH_RECORDINGS_KEY = 'k';
    fetchSpy.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers() } as any);
    const svc = new TelehealthRecordingsService(configOf() as any);
    const err = await svc.list().catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(codeOf(err)).toBe('RECORDINGS_UPSTREAM_ERROR');
    const body = err.getResponse() as { msg?: { k: string; params?: Record<string, unknown> }; status?: number };
    expect(body.msg?.params).toEqual({ 상태: 401 }); // 문장에 녹이지 않고 값으로 내려보낸다
    expect(body.status).toBe(401);
  });

  it('🔴 녹화 서버에 닿지 못하면 503 — 연결 실패를 "없음"으로 번역하지 않는다', async () => {
    env.TELEHEALTH_RECORDINGS_URL = 'http://meet-api:8080';
    env.TELEHEALTH_RECORDINGS_KEY = 'k';
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new TelehealthRecordingsService(configOf() as any);
    const err = await svc.list().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(codeOf(err)).toBe('RECORDINGS_UNAVAILABLE');
  });

  it('🔴 JSON 이 아닌 응답을 성공으로 접지 않는다 — 502 · 빈 본문은 상태코드만 돌려준다', async () => {
    env.TELEHEALTH_RECORDINGS_URL = 'http://meet-api:8080';
    env.TELEHEALTH_RECORDINGS_KEY = 'k';
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>login</html>', headers: new Headers() } as any);
    const svc = new TelehealthRecordingsService(configOf() as any);
    const err = await svc.list().catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(codeOf(err)).toBe('RECORDINGS_BAD_RESPONSE');
    // 대조군 — 204/빈 본문의 DELETE 는 결과를 지어내지 않고 받아들인 사실(상태코드)만 말한다
    fetchSpy.mockResolvedValue({ ok: true, status: 204, text: async () => '', headers: new Headers() } as any);
    expect(await svc.remove('r1')).toEqual({ upstreamStatus: 204 });
    expect(fetchSpy.mock.calls.at(-1)[1].method).toBe('DELETE');
  });

  it('화면 소스에 녹화 API 키·직접 호출이 남아 있지 않다 — 그리고 서버 프록시를 부른다', () => {
    // 🔴 주석은 걷고 본다 — 주석이 문자열 검사에 걸려 "다른 이유로" 실패/통과하는 함정(§3 재주입)
    const page = readFileSync(
      join(__dirname, '../../../web/src/app/(main)/telehealth/recordings/page.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(page).not.toContain('NEXT_PUBLIC_TELEHEALTH_' + 'RECORDINGS_KEY'); // 이 스펙 자체가 문자열 검색에 걸리지 않게 나눈다
    expect(page).not.toContain('X-API-Key');
    expect(page).not.toMatch(/recordings-ui\?key=/);
    expect(page).not.toContain('/meet-api');
    // 대조군 — 화면이 서버 프록시를 부른다(키만 지우고 기능을 죽이지 않았다) · 목록/메모/삭제/다운로드 네 자리
    expect(page.match(/apiClient\.get<[^>]*>\('\/api\/v1\/telehealth\/recordings'/)).not.toBeNull();
    expect(page).toContain("apiClient.patch(`/api/v1/telehealth/recordings/${rid}`");
    expect(page).toContain("apiClient.del(`/api/v1/telehealth/recordings/${rid}`");
    expect(page).toContain('/api/v1/telehealth/recordings/${rid}/download');
    // 🔴 삭제는 서버 @Roles(ADMIN) 과 같은 판정으로 그린다 — 가진 적 없는 권한을 가진 척하지 않는다
    expect(page).toMatch(/const canDelete = useHasRole\('ADMIN'\)/);
    expect(page).toMatch(/\{canDelete \? \(/);
    // 미설정(503)은 재시도 버튼이 아니라 설정할 곳을 말한다
    expect(page).toContain("error.code === 'RECORDINGS_NOT_CONFIGURED'");
  });

  it('서버 프록시 파일이 실제로 fetch 를 한 번 한다 — raw-egress-guard 기준선 +1 은 이 한 줄이다(소스 없는 기준선 상향 = 완화)', () => {
    const svc = readFileSync(join(__dirname, '../../src/modules/telehealth/telehealth-recordings.service.ts'), 'utf8');
    const stripped = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect((stripped.match(/(?<![A-Za-z0-9_$.])fetch\s*\(/g) ?? []).length).toBe(1);
    expect(stripped).toContain("'X-API-Key': this.apiKey");
    expect(stripped).not.toMatch(/\.catch\(\s*\(?\w*\)?\s*=>\s*(?:null|undefined|\[\]|\{\s*\}|0|false)\s*\)/); // 실패를 기본값으로 삼키지 않는다
  });

  it('컨트롤러 — 삭제만 ADMIN · 나머지는 녹화 관리 메뉴 역할(DOCTOR·ADMIN·NURSE)', () => {
    const ctrl = readFileSync(join(__dirname, '../../src/modules/telehealth/telehealth-recordings.controller.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const block = (decorator: string) => { const i = ctrl.indexOf(decorator); expect(i, decorator).toBeGreaterThan(-1); return ctrl.slice(i, i + 300); };
    expect(block("@Delete(':id')")).toMatch(/@Roles\(UserRole\.ADMIN\)\s*\n/);
    for (const d of ['@Get()', "@Patch(':id')", "@Get(':id/download')"]) {
      expect(block(d)).toMatch(/@Roles\(UserRole\.DOCTOR, UserRole\.ADMIN, UserRole\.NURSE\)/);
    }
    expect(ctrl).toContain("@Controller('api/v1/telehealth/recordings')");
    expect(ctrl).toContain('@UseGuards(JwtAuthGuard, RolesGuard)');
  });
});

/** 서버 표시 문장 계약 — 이 프록시의 503/502 문장은 `{ k, params }` 로 나가고 en·ja·ar 에 등재돼 있다 */
describe('녹화 프록시 서버 문장 (servermsg 예외 배치 D-27)', () => {
  const FILES = SERVER_MESSAGE_SOURCES.exceptionTelehealthRecordings;

  it('대조군 — 추출기가 이 파일의 키를 읽는다(4키)', () => {
    expect(sourceKeysOf(FILES).size).toBe(4);
  });

  it('🔴 한글이 든 키는 en·ja·ar 모두 등재', () => {
    expect(unregisteredKeys(sourceKeysOf(FILES))).toEqual([]);
  });

  it('🔴 예외 조립 템플릿 0 · 연결(+) 우회 0 — 서버가 한국어 문장을 조립하지 않는다', () => {
    for (const f of FILES) {
      const { composed, concat } = composedLines(f);
      expect(composed, f).toEqual([]);
      expect(concat, f).toEqual([]);
    }
  });

  it('msgException 정본이 503·502 를 낸다(옆에 약한 사본을 만들지 않았다)', () => {
    const e503 = msgException(HttpStatus.SERVICE_UNAVAILABLE, serverMsg('x'), { code: 'C1' });
    expect(e503).toBeInstanceOf(ServiceUnavailableException);
    expect(e503.getResponse()).toMatchObject({ code: 'C1', message: 'x', msg: { k: 'x' } });
    const e502 = msgException(HttpStatus.BAD_GATEWAY, serverMsg('y {n}', { n: 1 }));
    expect(e502).toBeInstanceOf(BadGatewayException);
    expect(e502.getStatus()).toBe(502);
  });
});
