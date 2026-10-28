// SSRF 방지 공용 유틸 (security-governance G2 / FR-S3)
// 외부 URL 호출 전 프로토콜·사설/loopback/메타데이터 IP 차단·호스트 화이트리스트 검증.
// 기존 erp-eapproval.isCallbackUrlSafe 로직을 일반화·공용화.

import { lookup } from 'dns/promises';
import { isIP } from 'net';

export class EgressBlockedError extends Error {
  constructor(reason: string) {
    super(`Egress blocked: ${reason}`);
    this.name = 'EgressBlockedError';
  }
}

// 사설/loopback/링크로컬/메타데이터 대역(IP 리터럴 호스트 1차 차단용)
const BLOCKED_HOST =
  /^(localhost|0\.0\.0\.0|::1|\[::1\]|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|fc00:|fd[0-9a-f]{2}:|fe80:)/i;

/** 숫자 IP(IPv4/IPv6)가 사설·loopback·링크로컬·메타데이터·CGNAT 대역인지 — DNS 해석 결과 검증용. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) → 내장 IPv4로 재검증
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIpv4(mapped[1]);
    if (lower === '::' || lower === '::1') return true; // unspecified·loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true; // link-local·ULA
    if (lower.startsWith('ff')) return true; // multicast(ff00::/8)
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 — 내장 IPv4로 우회 가능
    return false;
  }
  return true; // IP 형식이 아니면 보수적으로 차단
}

function isBlockedIpv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0 || a === 127 || a === 10) return true; // unspecified·loopback·private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + 메타데이터(169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast(224-239)·예약(240-254)·broadcast(255)
  return false;
}

export interface AssertEgressOptions {
  allowedHosts?: string[]; // 비어있지 않으면 화이트리스트 강제
  allowPrivate?: boolean; // 내부망(PACS 등) 의도적 허용 시
}

/** 외부 호출 전 URL 안전성 검증(동기·리터럴). 위반 시 EgressBlockedError throw. 통과 시 URL 반환. */
export function assertEgressUrl(raw: string, opts: AssertEgressOptions = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EgressBlockedError('invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new EgressBlockedError(`protocol ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  // 🔴 2026-08-20: IPv6 리터럴의 `hostname` 은 **대괄호를 유지한다**(`[fd00::1]`).
  //    BLOCKED_HOST 는 `^fd..:` 로 시작을 보므로 대괄호가 붙는 순간 전부 통과했다
  //    (`[fd00::1]`·`[fe80::1]`·`[fc00::1]` — 명시 리터럴인 `[::1]` 만 우연히 막혔다).
  //    `assertEgressResolved` 는 이 자리를 벗겨서 봤지만, **동기 검증만 쓰는 호출부**
  //    (웹훅 등록 `createWebhook`·ERP 콜백 등록)는 그대로 사설 IPv6 를 등록할 수 있었다.
  const bare = host.replace(/^\[|\]$/g, '');
  if (!opts.allowPrivate) {
    if (BLOCKED_HOST.test(host) || BLOCKED_HOST.test(bare)) {
      throw new EgressBlockedError(`private/loopback host ${host}`);
    }
    // IP 리터럴은 문자열 접두 대신 대역 판정 정본으로 본다(8진/축약 표기 우회 차단).
    if (isIP(bare) && isBlockedIp(bare)) {
      throw new EgressBlockedError(`private/loopback ip ${host}`);
    }
  }
  const allow = (opts.allowedHosts ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(host)) {
    throw new EgressBlockedError(`host ${host} not in allowlist`);
  }
  return u;
}

/**
 * URL을 검증하고 호스트명을 DNS 해석해 해석된 IP가 사설/메타데이터 대역이면 차단(비동기).
 * 공개 호스트명이 사설 IP로 해석되는 SSRF/DNS-rebinding 1차 방어.
 * 잔여 TOCTOU: 검증 시점과 fetch 시점의 해석 결과가 다를 수 있음 — 완전 차단은 IP 핀잉(커스텀
 *   dispatcher) 필요. 여기서는 의존성 없이 해석 결과 검증까지 수행.
 */
export async function assertEgressResolved(raw: string, opts: AssertEgressOptions = {}): Promise<URL> {
  const u = assertEgressUrl(raw, opts);
  if (opts.allowPrivate) return u; // 내부망 의도적 허용은 해석 검증 생략
  const host = u.hostname.replace(/^\[|\]$/g, ''); // IPv6 대괄호 제거
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new EgressBlockedError(`private/loopback ip ${host}`);
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new EgressBlockedError(`dns lookup failed for ${host}`);
  }
  if (!addrs.length) throw new EgressBlockedError(`no dns record for ${host}`);
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new EgressBlockedError(`host ${host} resolves to private ip ${address}`);
    }
  }
  return u;
}

export interface SafeFetchOptions extends AssertEgressOptions {
  timeoutMs?: number; // 기본 10s
}

/** SSRF 검증(DNS 해석 포함) + 타임아웃을 적용한 fetch 래퍼. 리다이렉트는 manual(우회 차단). */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  await assertEgressResolved(url, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual', // 리다이렉트로 내부망 우회 방지
      signal: init.signal ?? controller.signal,
    });
    // 리다이렉트 응답은 Location을 재검증(해석 포함) 없이 따라가지 않음
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) await assertEgressResolved(new URL(loc, url).toString(), opts);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
