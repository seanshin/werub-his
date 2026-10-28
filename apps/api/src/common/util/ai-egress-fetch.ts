/**
 * 🔴 AI egress 단일 호출 경로 — 목적지 검증 + 경계 통과 감사 를 **한 곳에서** 한다.
 *
 * 왜 새로 만들었나(정본이 둘이 되지 않게 먼저 찾아본 결과):
 *   - 목적지 검증 정본은 이미 있다 → `ai-egress-url.ts` 의 `assertAiServerUrl`.
 *   - 감사 로그 정본은 **없었다.** `medical-ai.service.ts` 의 private `aiFetch` 안에
 *     `{ t: 'AI_EGRESS', ... }` 한 줄이 인라인으로 박혀 있을 뿐이라 다른 모듈이 쓸 수 없다.
 *   - 실측(2026-08-20): `ai.server.url`(SystemConfig=DB·관리화면에서 바꿀 수 있는 값)을 읽어
 *     raw `fetch` 로 나가는 클라이언트가 **9곳 중 7곳**은 검증도 감사도 없었다.
 *     (formulary · gld/governance · voc/voc-ai · portal/drug-explain · i18n/translation ·
 *      scribe/scribe-ai · voice-emr/stt-chunk — 뒤 둘은 **진료 녹취 원음**을 보낸다.)
 *   → 이 파일은 그 둘(검증+감사)을 묶은 **최소한의** 래퍼다. 검증 로직은 복사하지 않고
 *     `assertAiServerUrl` 을 그대로 부른다.
 *
 * 🔴 2026-08-20 수렴: `medical-ai.service.ts` 의 private `aiFetch`(정본이 둘이던 나머지 한쪽)를
 *   여기로 합쳤다. 그쪽이 더 엄격했던 것(항상 타임아웃을 건다·감사에 `timeoutMs` 를 남긴다)은
 *   **더 엄격한 쪽에 맞춰** 이 파일로 올렸고, medical-ai 고유 정책(kill switch·API 키 헤더·
 *   미설정/차단 구분 503)은 egress 정책이 아니므로 그 모듈의 얇은 래퍼에 남겼다.
 *   이제 AI 목적지로 나가는 raw `fetch` 는 이 파일의 마지막 줄 하나뿐이다(구조 가드로 동결).
 *
 * 🔴 2026-09-09 (P0-A): `AI_EGRESS_ALLOWED_HOSTS` 미설정 = **외부 호스트 전면 차단**(fail-closed).
 *   종전에는 "호스트 제한 없음 + 경고 1회"였다. 이제 미설정이면 공개 호스트로는 한 바이트도 나가지 않고
 *   `AiEgressHostsUnsetError`(code `AI_EGRESS_HOSTS_UNSET`)가 올라온다 — 호출부는 3상태로 접는다.
 *   원내 사설망/loopback 목적지는 목록 없이도 종전대로 나간다(`ai-egress-url.ts` 참조).
 *
 * 왜 `safeFetch` 가 아닌가:
 *   `safeFetch` 는 DNS 해석 결과가 사설 대역이면 차단한다. **AI 서버가 가야 할 곳이 원내 사설망(GPU)**
 *   이라 그 차단은 폐쇄망 전환을 막는다. AI 목적지에서 막을 것은 사설망 접근이 아니라
 *   **임의 호스트로의 재지정**이고, 그것이 `assertAiServerUrl`(allowPrivate:true + 호스트 화이트리스트)이다.
 *   외부(ERP 웹훅·콜백 등) 목적지는 이 파일이 아니라 `safeFetch` 를 쓴다.
 *
 * ⚠️ 리다이렉트: 기존 `aiFetch` 정본과 동일하게 기본(follow) 이다. `redirect:'manual'` 로 바꾸면
 *    끝 슬래시 리다이렉트를 쓰는 EP 가 즉시 실패하므로 여기서 바꾸지 않는다(회귀 0 우선).
 *    잔여 위험 = **허용 호스트가 다른 호스트로 302 하는 경우**(목록에 없는 곳으로 리다이렉트되면
 *    이 파일은 막지 못한다). 미지정 시의 구멍은 위 P0-A 로 닫혔지만, 이 리다이렉트 구멍은 남아 있다.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { HIS_MODE_FALLBACK, parseHisMode, type HisMode } from '@hospital-run/shared';
import { assertAiServerUrl } from './ai-egress-url';
import { clampTag, emitAiCallLog } from './ai-call-log-sink';

/** 경계 통과 감사 — 메타만 남긴다(PHI 본문 기록 금지·감사로그 자기위반 방지). */
const egressAudit = new Logger('AiEgressAudit');

export interface AiEgressFetchOptions {
  /** 호출 주체(모듈/클라이언트 이름) — 감사 로그에 남는다. */
  client: string;
  /** 요청 타임아웃(ms). init.signal 이 주어지면 그것이 우선. */
  timeoutMs?: number;
}

/**
 * 🔴 감사 로그 형식 정본 — 운영 로그 파서가 갈라지지 않게 **한 형식만** 쓴다.
 * `{ t:'AI_EGRESS', client, host, path, method, bytes, timeoutMs, mode }`
 *   - 2026-08-20 통합: medical-ai 의 인라인 로그가 갖던 `timeoutMs` 를 여기로 합쳤고(합집합),
 *     medical-ai 쪽 인라인 로그는 제거했다(정본이 둘이면 갈라진다).
 *   - `bytes` = -1 → 측정 불가(FormData/stream). 0 은 "본문 없음"이라는 다른 사실이다.
 *   - `timeoutMs` = null → 이 호출에 타임아웃을 걸지 않았거나, 호출부가 자기 signal 로 관리한다
 *     (모르는 것을 숫자로 지어내지 않는다).
 *   - `mode` = 2026-09-09 추가. **운영 모드(HisMode)의 빌드 상한**이다 — 아래 `buildHisMode` 주석 참조.
 *   - 🔴 **본문은 절대 남기지 않는다**(PHI). 남기는 것은 위 메타 8키뿐 — 키를 늘리려면 PHI 여부를 먼저 본다.
 */
export interface AiEgressAuditLine {
  t: 'AI_EGRESS';
  client: string;
  host: string;
  path: string;
  method: string;
  bytes: number;
  timeoutMs: number | null;
  /** 운영 모드 — **빌드 상한**(런타임 토글은 여기서 보이지 않는다. `buildHisMode` 주석 참조) */
  mode: HisMode;
}

/**
 * 🔴 운영 모드 — 이 자리는 **빌드 상한만** 안다.
 *
 *   실효 모드 정본은 `HisModeService`(= 빌드 상한 `process.env.HIS_MODE` ⊓ 런타임 토글 SystemConfig
 *   `mode.current`) 이지만, 그것은 DI(ConfigRuntimeService)와 DB 조회를 요구한다. 이 파일은 10개 모듈이
 *   부르는 **순수 함수**이고 전송 직전 동기 경로라 DI 를 가질 수 없다.
 *   그래서 여기서는 `HisModeService.buildMode()` 와 **같은 정본 함수**(shared `parseHisMode` ·
 *   `HIS_MODE_FALLBACK`)로 빌드 상한만 읽는다 — 파싱 규칙 사본을 만들지 않는다.
 *
 *   🔴 한계를 그대로 적는다: 런타임 토글은 **좁히기만** 하므로(`resolveHisMode`), 실효 모드는
 *   여기 적힌 값보다 **더 제한적일 수는 있어도 덜 제한적일 수는 없다.** 즉 이 값은 상한이지
 *   "지금 화면이 보고 있는 모드"와 항상 같지는 않다. 정확한 실효 모드를 남기려면 `HisModeService` 가
 *   실효 모드를 이 파일에 밀어 넣어야 한다(미배선 — 사람 결정으로 남긴다).
 */
function buildHisMode(): HisMode {
  return parseHisMode(process.env.HIS_MODE) ?? HIS_MODE_FALLBACK;
}

/** 전송 바이트 수(측정 불가면 -1 — 모르는 것을 0 으로 적지 않는다). */
function bodyBytes(body: RequestInit['body']): number {
  if (body == null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body.length;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return -1; // FormData/Blob/Stream — 여기서는 알 수 없다
}

/* ── AI 호출 원장(`AiCallLog`) 계측 — 기획서 §2.2 ────────────────────────────────
 *
 * 🔴 감사 로그 라인과 **다른 원장**이다. 로그 라인(8키)은 "경계를 넘었다"는 사실을,
 *    여기 원장은 "어느 모델이 언제 무엇을 했는가"를 남긴다. 로그 라인 키 집합은 손대지 않는다.
 *
 * 🔴 **본문은 저장하지 않는다.** 응답에서 뽑는 것은 모델 태그 하나(`model`/`model_used`)뿐이고,
 *    그 추출조차 `res.clone()` 으로 한다 — 호출부가 받는 Response 는 소비되지 않는다.
 *    `content-type` 이 JSON 일 때만 읽는다(스트리밍 응답은 건드리지 않는다 — 만지면 스트림이 죽는다).
 *
 * 🔴 실패는 호출을 막지 않는다. 여기서 던지는 것은 아무것도 없다.
 */

/** 요청 본문이 JSON 문자열이고 `model` 이 문자열일 때만 — 아니면 null(추측하지 않는다). */
function extractRequestedModel(body: RequestInit['body']): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    return clampTag(rec.model, 64);
  } catch {
    return null; // JSON 이 아니다 — 모르는 것을 적지 않는다
  }
}

/** 응답 JSON 이 스스로 보고한 태그. `model` → `model_used` 순. 문자열만. */
function extractModelRef(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  return clampTag(rec.model, 64) ?? clampTag(rec.model_used, 64);
}

/**
 * 🔴 **`json` 이 들어간 MIME 을 전부 JSON 으로 읽으면 스트림을 건드린다.**
 *    첫 구현은 `/json/i.test(ct)` 였고 `application/x-ndjson`(medical-ai 의 스트리밍 응답 · scribe)이
 *    여기에 걸렸다 — 스트림을 clone 해서 **끝까지 버퍼링**했을 것이다(응답이 끝날 때까지 원장도 안 남는다).
 *    재주입 역검증 중에 드러났다: 스트리밍 케이스가 "JSON 파싱 실패"라는 **다른 이유로** 통과하고 있었다.
 *    그래서 정확한 MIME 만 통과시킨다(`application/json` · `text/json` · `…+json`).
 */
function isJsonMime(contentType: string): boolean {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return mime === 'application/json' || mime === 'text/json' || mime.endsWith('+json');
}

function headerOf(res: Response, name: string): string | null {
  const get = (res as { headers?: { get?: (n: string) => string | null } })?.headers?.get;
  if (typeof get !== 'function') return null; // 목·비표준 응답 — 없는 것을 지어내지 않는다
  try {
    return res.headers.get(name);
  } catch {
    return null;
  }
}

/**
 * 호출 계측의 기능 단위(2026-10-02) — 같은 클라이언트(`medical-ai`) 안에서 **어느 기능이 부른 호출인가**.
 * 🔴 종전 `skill` 은 클라이언트 이름 그대로라 어시스턴트의 `/감별`·`/요약`·자유 질문이 한 덩어리였다.
 * 호출부가 `withAiSkill('chat.ddx', fn)` 으로 감싸면 그 안의 모든 상류 호출이 `medical-ai:chat.ddx` 로 남는다.
 * 감싸지 않은 호출은 종전 그대로(클라이언트 이름) — 지어내지 않는다.
 */
const skillScope = new AsyncLocalStorage<string>();

export function withAiSkill<T>(skill: string, fn: () => Promise<T>): Promise<T> {
  return skillScope.run(skill, fn);
}

/** 원장 `skill` 값 — 범위가 있으면 `<client>:<범위>` */
export function aiSkillTag(client: string): string {
  const scope = skillScope.getStore();
  const raw = scope ? `${client}:${scope}` : client;
  return clampTag(raw, 80) ?? raw;
}

interface AiCallMeta {
  client: string;
  /** 호출 시점에 확정한 skill — 응답 본문을 비동기로 읽는 동안 범위가 바뀌어도 흔들리지 않게 */
  skill: string;
  requestedModel: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
  mode: HisMode;
}

/** 응답에서 모델 태그·바이트를 뽑아 원장에 1행. **비동기·fire-and-forget** — 응답 반환을 늦추지 않는다. */
function reportAiCall(res: Response, meta: AiCallMeta): void {
  const lenRaw = Number(headerOf(res, 'content-length'));
  const headerBytes = Number.isFinite(lenRaw) && lenRaw >= 0 ? lenRaw : null;
  const base = {
    skill: meta.skill,
    client: clampTag(meta.client, 60) ?? meta.client,
    requestedModel: meta.requestedModel,
    latencyMs: meta.latencyMs,
    httpStatus: meta.httpStatus,
    mode: meta.mode as string,
  };
  const ct = headerOf(res, 'content-type') ?? '';
  const canClone = typeof (res as { clone?: unknown }).clone === 'function';
  if (!isJsonMime(ct) || !canClone) {
    // 스트리밍·비 JSON·목 응답 — 상류가 보고한 태그를 **모른다**. 요청 태그로 대신 채우지 않는다.
    emitAiCallLog({ ...base, modelRef: null, bytes: headerBytes });
    return;
  }
  let clone: Response;
  try {
    clone = res.clone(); // 🔴 원 응답을 소비하지 않는 유일한 방법
  } catch {
    emitAiCallLog({ ...base, modelRef: null, bytes: headerBytes });
    return;
  }
  void clone
    .text()
    .then((txt) => {
      let modelRef: string | null = null;
      try {
        modelRef = extractModelRef(JSON.parse(txt));
      } catch {
        modelRef = null; // JSON 이라 했지만 아니었다 — 그것도 "모른다"다
      }
      emitAiCallLog({ ...base, modelRef, bytes: headerBytes ?? Buffer.byteLength(txt) });
    })
    .catch(() => {
      // 본문을 못 읽었다 = 모델을 모른다. 호출이 없었던 것처럼 만들지 않고 행은 남긴다.
      emitAiCallLog({ ...base, modelRef: null, bytes: headerBytes });
    });
}

/**
 * AI 서버 호출. `base` 는 `ai.server.url` 등 **설정에서 온 목적지**, `path` 는 코드 상수.
 *
 * 던지는 것:
 *  - `EgressBlockedError` — 목적지가 허용되지 않음. **호출부가 삼키면 안 된다**(빈 결과로 덮지 말 것).
 *    사용자에게는 503 등 정직한 실패로 올린다.
 *  - `AiEgressHostsUnsetError`(위의 하위형 · `code='AI_EGRESS_HOSTS_UNSET'`) — 허용 목록 미설정이라
 *    외부 호스트로 나가지 않음. 목적지가 나쁜 것이 아니라 **설정이 없는 것**이다(운영자에게 다른 사실).
 *  - fetch 자체의 네트워크/타임아웃 오류 — 그대로 전파(기존 동작 유지).
 */
export async function aiEgressFetch(
  base: string,
  path: string,
  init: RequestInit = {},
  opts: AiEgressFetchOptions,
): Promise<Response> {
  const u = assertAiServerUrl(base); // 위반이면 여기서 throw — 나가기 전에 멈춘다
  const target = `${u.toString().replace(/\/$/, '')}${path}`;
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  const bytes = bodyBytes(init.body);
  // 호출부가 자기 signal 을 주면 타임아웃은 그쪽 소관 — 우리가 아는 값이 없으므로 null 로 적는다.
  const timeoutMs = init.signal ? null : (opts.timeoutMs ?? null);
  const line: AiEgressAuditLine = {
    t: 'AI_EGRESS',
    client: opts.client,
    host: u.hostname,
    path,
    method,
    bytes,
    timeoutMs,
    mode: buildHisMode(),
  };
  egressAudit.log(JSON.stringify(line));
  const signal =
    init.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined);
  const requestedModel = extractRequestedModel(init.body);
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(target, { ...init, ...(signal ? { signal } : {}) });
  } catch (e) {
    // 🔴 전송 실패도 "어느 모델을 부르려다 실패했는가"라는 사실이다 — 원장에 남기고 그대로 던진다.
    emitAiCallLog({
      skill: aiSkillTag(opts.client),
      client: clampTag(opts.client, 60) ?? opts.client,
      requestedModel,
      modelRef: null,
      latencyMs: Date.now() - startedAt,
      httpStatus: null, // 응답이 없었다 — 0 이나 500 으로 지어내지 않는다
      bytes: null,
      mode: line.mode,
    });
    throw e;
  }
  reportAiCall(res, {
    client: opts.client,
    skill: aiSkillTag(opts.client),
    requestedModel,
    latencyMs: Date.now() - startedAt,
    httpStatus: typeof res?.status === 'number' ? res.status : null,
    mode: line.mode,
  });
  return res;
}
