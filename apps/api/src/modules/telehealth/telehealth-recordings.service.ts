import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { serverMsg } from '@hospital-run/shared';
import { msgException } from '../../common/msg-exception';

/**
 * 원격진료 녹화 API(Jitsi 부가 API) **서버 프록시** — 외부 점검.
 *
 * 🔴 무엇이 틀려 있었나: 녹화 화면(`/telehealth/recordings`)이 브라우저 공개 환경변수로 녹화 API 키를 읽어
 *    **브라우저에서 직접** `/meet-api/recordings*` 를 불렀다. 공개 접두어(`NEXT_PUBLIC_*`) 변수는 빌드 시
 *    번들에 박히므로 그 화면에 닿을 수 있는 사람이면 누구나 키 값을 읽을 수 있고, '전체 관리 UI' 링크는
 *    아예 `?key=<키>` 로 **URL 쿼리에** 실려 브라우저 기록·프록시 로그·Referer 에 남았다.
 *    키 역할이 admin/operator 면 그 키로 **녹화 삭제까지** 된다.
 *
 * 🔴 이제 키는 서버에만 있다(`TELEHEALTH_RECORDINGS_KEY`). 화면은 HIS EP 를 부르고, HIS 가 RBAC·감사를
 *    걸어서 중계한다. **미설정이면 열지 않는다** — 조용히 빈 목록을 돌려주지 않고 503 으로 말한다
 *    ("녹화가 없는 것"과 "연동이 설정되지 않은 것"은 다른 사실이다).
 * 🔴 실패를 기본값으로 삼키지 않는다 — 연결 실패 503 · 녹화 서버 거부 502 · 응답 해석 실패 502. 전부 `msg`
 *    (`{ k, params }`)로 실어 화면이 카탈로그로 조립한다(서버가 한국어 문장을 조립하지 않는다).
 */
@Injectable()
export class TelehealthRecordingsService {
  private readonly logger = new Logger(TelehealthRecordingsService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    // 예) http://jitsi-api:8080 · https://<원내 호스트>/meet-api — 끝의 `/` 는 떼고 보관
    this.baseUrl = (this.config.get<string>('TELEHEALTH_RECORDINGS_URL') ?? '').trim().replace(/\/+$/, '');
    this.apiKey = (this.config.get<string>('TELEHEALTH_RECORDINGS_KEY') ?? '').trim();
    if (!this.configured()) {
      this.logger.warn(
        '원격진료 녹화 연동 비활성 — TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY 가 설정되지 않았습니다. ' +
          '녹화 EP 는 503 RECORDINGS_NOT_CONFIGURED 로 응답합니다(빈 목록으로 위장하지 않습니다).',
      );
    }
  }

  configured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  private assertConfigured() {
    if (!this.configured()) {
      throw msgException(
        HttpStatus.SERVICE_UNAVAILABLE,
        serverMsg('원격진료 녹화 서버 연동이 설정되지 않았습니다(TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY) — 녹화가 없는 것이 아닙니다'),
        { code: 'RECORDINGS_NOT_CONFIGURED' },
      );
    }
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    this.assertConfigured();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), 'X-API-Key': this.apiKey }, // 🔴 키는 헤더로만 — URL 에 싣지 않는다
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      // 🔴 닿지 못한 것을 "없음"으로 번역하지 않는다 — 503 으로 말한다(원인은 details 로)
      this.logger.warn(`녹화 서버에 닿지 못했습니다: ${(e as Error)?.message ?? e}`);
      throw msgException(
        HttpStatus.SERVICE_UNAVAILABLE,
        serverMsg('녹화 서버에 연결하지 못했습니다 — 녹화가 없는 것이 아닙니다'),
        { code: 'RECORDINGS_UNAVAILABLE', cause: String((e as Error)?.message ?? e).slice(0, 200) },
      );
    }
    if (!res.ok) {
      // 🔴 401/403/5xx 를 목록 0건으로 바꾸지 않는다 — 상태코드는 값(params·details)으로 내려보내고 화면이 문장을 조립한다.
      this.logger.warn(`녹화 서버 오류: ${res.status} ${res.statusText} (${path})`);
      throw msgException(
        HttpStatus.BAD_GATEWAY,
        serverMsg('녹화 서버가 요청을 거부했습니다(HTTP {상태}) — 녹화가 없는 것이 아닙니다', { 상태: res.status }),
        { code: 'RECORDINGS_UPSTREAM_ERROR', status: res.status },
      );
    }
    return res;
  }

  /** 본문을 JSON 으로 읽는다 — 비어 있으면 `null`, JSON 이 아니면 502(해석 실패를 성공으로 접지 않는다) */
  private async readJson(res: Response, path: string): Promise<unknown> {
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      this.logger.warn(`녹화 서버 응답이 JSON 이 아닙니다: ${res.status} (${path})`);
      throw msgException(
        HttpStatus.BAD_GATEWAY,
        serverMsg('녹화 서버 응답을 해석하지 못했습니다(HTTP {상태})', { 상태: res.status }),
        { code: 'RECORDINGS_BAD_RESPONSE', status: res.status },
      );
    }
  }

  async list(keyword?: string): Promise<unknown> {
    const path = `/recordings${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`;
    return this.readJson(await this.call(path), path);
  }

  async update(id: string, body: { memo?: string; tags?: string }): Promise<unknown> {
    const path = `/recordings/${encodeURIComponent(id)}`;
    const res = await this.call(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 본문이 없으면 녹화 서버가 받아들였다는 사실(상태코드)만 돌려준다 — 결과를 지어내지 않는다
    return (await this.readJson(res, path)) ?? { upstreamStatus: res.status };
  }

  async remove(id: string): Promise<unknown> {
    const path = `/recordings/${encodeURIComponent(id)}`;
    const res = await this.call(path, { method: 'DELETE' });
    return (await this.readJson(res, path)) ?? { upstreamStatus: res.status };
  }

  /** 다운로드 중계 — 바이트를 그대로 흘린다(브라우저가 키 없이 받을 수 있게). */
  async download(id: string): Promise<{ contentType: string; fileName?: string; body: Buffer }> {
    const res = await this.call(`/recordings/${encodeURIComponent(id)}/download`);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const disposition = res.headers.get('content-disposition') ?? undefined;
    const fileName = disposition?.match(/filename="?([^";]+)"?/)?.[1];
    return { contentType, fileName, body: Buffer.from(await res.arrayBuffer()) };
  }
}
