import { createHash } from 'node:crypto';

/**
 * canonical client data — **서버와 앱이 같은 바이트를 만들어야** 서명이 맞는다.
 *
 * 🔴 이 규칙이 문서로만 있으면 반드시 갈라진다(우리 저장소에서 어휘 정본이 갈라진 사례 다수).
 *    그래서 서버가 **직렬화 함수 하나**를 정본으로 두고, 같은 fixture 를 iOS 팀에 준다.
 *
 * 규칙
 *  - 키를 **사전순으로 정렬**한 JSON, 공백 없음
 *  - `undefined`·`null` 필드는 **넣지 않는다**(있으면 `null` 로 넣는 것과 바이트가 달라진다)
 *  - 문자열은 UTF-8, base64url 은 **패딩 없이**
 *  - 🔴 서명 자체(`appProof` 계열 헤더)는 **서명 대상에서 제외**한다 — 넣으면 순환이 된다
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 서명 대상에서 제외하는 헤더성 필드 — 넣으면 서명이 자기 자신을 포함하는 순환이 된다 */
export const UNSIGNED_BODY_FIELDS = ['appProof', 'appAttestAssertion', 'appAssertionChallengeId'];

/** 요청 본문의 서명 대상 해시 — 프록시 필드를 빼고 canonical 직렬화한다 */
export function bodyHashOf(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) return sha256Base64Url(canonicalJson(body));
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const f of UNSIGNED_BODY_FIELDS) delete copy[f];
  if (Object.keys(copy).length === 0) return undefined;
  return sha256Base64Url(canonicalJson(copy));
}

export const base64UrlNoPad = (b: Buffer) => b.toString('base64url');

export const sha256Base64Url = (input: string | Buffer) =>
  base64UrlNoPad(createHash('sha256').update(input).digest());

export interface AttestationClientData {
  app: string;
  bundleId: string;
  installationId: string;
  challenge: string;
}

export interface AssertionClientData {
  challengeId: string;
  challenge: string;
  purpose: string;
  method: string;
  path: string;
  bodySha256?: string;
  installationId: string;
  sessionId?: string;
}

export const attestationClientData = (d: AttestationClientData) =>
  canonicalJson(d as unknown as Record<string, unknown>);

export const assertionClientData = (d: AssertionClientData) =>
  canonicalJson(d as unknown as Record<string, unknown>);
