import { createHash, createPublicKey, verify as cryptoVerify, X509Certificate } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { APPLE_APP_ATTEST_ROOT_CA_PEM } from './apple-root-ca';

/**
 * Apple App Attest 검증 — attestation(최초 1회)과 assertion(요청마다).
 *
 * 참고: Apple — *Validating apps that connect to your server*.
 *
 * 🔴 이 파일은 **클라이언트가 보낸 어떤 값도 그대로 믿지 않는다.**
 *    - client 가 계산했다는 hash 를 받지 않고, 서버가 canonical client data 를 **다시 만들어** 해시한다
 *    - Bundle ID·environment 문자열은 **요청서에 적힌 주장일 뿐**이고, 최종 판정은 attestation 결과다
 *    - App ID(Team ID + Bundle ID)를 모르면 rpIdHash 를 대조할 수 없다 → **검증한 척하지 않고 거절한다**
 */


/**
 * CBOR 맵을 평범한 객체로 — 🔴 디코더는 CBOR map 을 **`Map` 으로** 돌려준다.
 *    객체처럼 `decoded.signature` 로 읽으면 언제나 `undefined` 라, 검증이
 *    "구성요소가 없습니다" 로 **항상 실패**한다(가드가 이 버그를 잡았다).
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value instanceof Map) return Object.fromEntries(value.entries()) as Record<string, unknown>;
  return (value ?? {}) as Record<string, unknown>;
}

const asBytes = (v: unknown): Buffer | null =>
  v instanceof Uint8Array ? Buffer.from(v) : Buffer.isBuffer(v) ? (v as Buffer) : null;

export class AppAttestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const fail = (code: string, message: string): never => {
  throw new AppAttestError(code, message);
};

const sha256 = (b: Uint8Array | Buffer | string) => createHash('sha256').update(b).digest();

// ── 최소 DER 워커 — credCert 의 nonce 확장을 읽기 위해서만 쓴다 ──
interface Tlv { tag: number; content: Buffer; end: number }

function readTlv(buf: Buffer, offset: number): Tlv {
  const tag = buf[offset];
  let i = offset + 1;
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | buf[i++];
  }
  return { tag, content: buf.subarray(i, i + len), end: i + len };
}

/**
 * credCert 확장 OID `1.2.840.113635.100.8.2` 안의 nonce(32바이트).
 * 구조: OCTET STRING → SEQUENCE → [1] → OCTET STRING(nonce)
 */
function extractAttestationNonce(cert: X509Certificate): Buffer {
  const der = Buffer.from(cert.raw);
  // OID DER 인코딩: 06 0A 2A 86 48 86 F7 63 64 08 02
  const oid = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
  const at = der.indexOf(oid);
  if (at < 0) fail('APP_ATTESTATION_INVALID', 'credCert 에 App Attest nonce 확장이 없습니다.');

  // OID 다음 TLV — critical BOOLEAN 이 끼어 있을 수 있어 OCTET STRING 이 나올 때까지 넘긴다
  let cursor = at + oid.length;
  for (let guard = 0; guard < 4; guard++) {
    const tlv = readTlv(der, cursor);
    if (tlv.tag === 0x04) {
      // OCTET STRING content = SEQUENCE { [1] { OCTET STRING nonce } }
      const seq = readTlv(tlv.content, 0);
      const ctx = readTlv(seq.content, 0);
      const octet = readTlv(ctx.content, 0);
      if (octet.content.length !== 32) {
        fail('APP_ATTESTATION_INVALID', `nonce 길이가 32바이트가 아닙니다(${octet.content.length}).`);
      }
      return Buffer.from(octet.content);
    }
    cursor = tlv.end;
  }
  return fail('APP_ATTESTATION_INVALID', 'nonce 확장 구조를 해석할 수 없습니다.');
}

/** P-256 SPKI 에서 비압축 공개키 포인트(65바이트) — keyIdentifier 계산용 */
function uncompressedPoint(cert: X509Certificate): Buffer {
  const spki = cert.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const point = spki.subarray(spki.length - 65);
  if (point[0] !== 0x04) fail('APP_ATTESTATION_INVALID', '공개키가 비압축 P-256 포인트가 아닙니다.');
  return point;
}

export interface ParsedAuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  aaguid: string;
  credentialId: Buffer | null;
}

export function parseAppAttestAuthData(authData: Buffer): ParsedAuthData {
  if (authData.length < 37) fail('APP_ATTESTATION_INVALID', 'authenticatorData 가 너무 짧습니다.');
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  let aaguid = '';
  let credentialId: Buffer | null = null;
  if (authData.length >= 55) {
    aaguid = authData.subarray(37, 53).toString('utf8').replace(/\0+$/, '');
    const credIdLen = authData.readUInt16BE(53);
    credentialId = authData.subarray(55, 55 + credIdLen);
  }
  return { rpIdHash, flags, counter, aaguid, credentialId };
}

export interface AttestationInput {
  /** base64 CBOR — Apple `attestKey` 결과 */
  attestationObject: string;
  /** Apple `generateKey` 가 준 keyId(base64) */
  keyId: string;
  /** 서버가 canonical 로 다시 만든 client data(문자열) */
  canonicalClientData: string;
  /** `TEAMID.BUNDLEID` — 모르면 호출부가 여기까지 오지 않는다 */
  appId: string;
  /** 허용 환경 — 운영 빌드가 development attestation 을 들고 오면 거절 */
  allowedEnvironments: Array<'DEVELOPMENT' | 'PRODUCTION'>;
}

export interface AttestationResult {
  publicKey: Buffer;
  publicKeyFingerprint: string;
  receipt: Buffer | null;
  environment: 'DEVELOPMENT' | 'PRODUCTION';
  counter: number;
}

const AAGUID_ENV: Record<string, 'DEVELOPMENT' | 'PRODUCTION'> = {
  appattestdevelop: 'DEVELOPMENT',
  appattest: 'PRODUCTION',
};

export function verifyAttestation(input: AttestationInput): AttestationResult {
  let decoded: Record<string, unknown>;
  try {
    decoded = asRecord(isoCBOR.decodeFirst(new Uint8Array(Buffer.from(input.attestationObject, 'base64'))));
  } catch {
    return fail('APP_ATTESTATION_INVALID', 'attestationObject 를 해석할 수 없습니다(CBOR).');
  }

  if (decoded.fmt !== 'apple-appattest') {
    fail('APP_ATTESTATION_INVALID', `지원하지 않는 attestation 형식입니다(${String(decoded.fmt)}).`);
  }
  const attStmt = asRecord(decoded.attStmt);
  const x5c = (attStmt.x5c as Uint8Array[] | undefined) ?? undefined;
  const authData = asBytes(decoded.authData);
  if (!x5c?.length || !authData) fail('APP_ATTESTATION_INVALID', 'attestation 구성요소가 없습니다.');

  // ① 인증서 체인 — credCert → intermediate → Apple 루트
  const certs = x5c!.map((c) => new X509Certificate(Buffer.from(c)));
  const root = new X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);
  const now = Date.now();
  for (const c of certs) {
    if (new Date(c.validFrom).getTime() > now || new Date(c.validTo).getTime() < now) {
      fail('APP_ATTESTATION_INVALID', '인증서 유효기간을 벗어났습니다.');
    }
  }
  const chain = [...certs, root];
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) {
      fail('APP_ATTESTATION_INVALID', 'Apple 루트까지의 인증서 체인 검증에 실패했습니다.');
    }
  }

  const credCert = certs[0];

  // ② nonce — 서버가 만든 client data 로 다시 계산해 대조(클라이언트가 준 hash 를 믿지 않는다)
  const clientDataHash = sha256(input.canonicalClientData);
  const expectedNonce = sha256(Buffer.concat([authData!, clientDataHash]));
  const certNonce = extractAttestationNonce(credCert);
  if (!expectedNonce.equals(certNonce)) {
    fail('APP_ATTESTATION_INVALID', 'attestation nonce 가 서버 challenge 와 일치하지 않습니다.');
  }

  // ③ keyId = SHA256(공개키 비압축 포인트)
  const point = uncompressedPoint(credCert);
  const keyIdentifier = sha256(point);
  if (!keyIdentifier.equals(Buffer.from(input.keyId, 'base64'))) {
    fail('APP_ATTESTATION_INVALID', 'keyId 가 인증서 공개키와 일치하지 않습니다.');
  }

  // ④ authData — App ID 해시·counter·aaguid·credentialId
  const parsed = parseAppAttestAuthData(authData!);
  if (!parsed.rpIdHash.equals(sha256(input.appId))) {
    fail('APP_ATTESTATION_INVALID', 'App ID 해시가 일치하지 않습니다(Team ID·Bundle ID 확인).');
  }
  if (parsed.counter !== 0) fail('APP_ATTESTATION_INVALID', 'attestation counter 는 0이어야 합니다.');

  const env = AAGUID_ENV[parsed.aaguid];
  if (!env) fail('APP_ATTESTATION_INVALID', `알 수 없는 attestation 환경입니다(${parsed.aaguid}).`);
  if (!input.allowedEnvironments.includes(env)) {
    fail('APP_ATTESTATION_INVALID', `허용되지 않은 attestation 환경입니다(${env}).`);
  }
  if (!parsed.credentialId || !parsed.credentialId.equals(Buffer.from(input.keyId, 'base64'))) {
    fail('APP_ATTESTATION_INVALID', 'credentialId 가 keyId 와 일치하지 않습니다.');
  }

  return {
    publicKey: point,
    publicKeyFingerprint: keyIdentifier.toString('hex'),
    receipt: asBytes(attStmt.receipt),
    environment: env,
    counter: parsed.counter,
  };
}

export interface AssertionInput {
  /** base64 CBOR — Apple `generateAssertion` 결과 */
  assertion: string;
  canonicalClientData: string;
  appId: string;
  /** 등록 시 저장한 비압축 P-256 포인트 */
  publicKey: Buffer;
  storedCounter: number;
}

export interface AssertionResult {
  counter: number;
}

export function verifyAssertion(input: AssertionInput): AssertionResult {
  let decoded: Record<string, unknown>;
  try {
    decoded = asRecord(isoCBOR.decodeFirst(new Uint8Array(Buffer.from(input.assertion, 'base64'))));
  } catch {
    return fail('APP_ASSERTION_INVALID', 'assertion 을 해석할 수 없습니다(CBOR).');
  }
  const signature = asBytes(decoded.signature);
  const authData = asBytes(decoded.authenticatorData);
  if (!signature || !authData) fail('APP_ASSERTION_INVALID', 'assertion 구성요소가 없습니다.');

  const parsed = parseAppAttestAuthData(authData!);
  if (!parsed.rpIdHash.equals(sha256(input.appId))) {
    fail('APP_ASSERTION_INVALID', 'App ID 해시가 일치하지 않습니다.');
  }

  const clientDataHash = sha256(input.canonicalClientData);
  const nonce = sha256(Buffer.concat([authData!, clientDataHash]));

  // SPKI 로 감싸 공개키 복원(저장값은 원시 EC 포인트)
  const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, input.publicKey]),
    format: 'der',
    type: 'spki',
  });
  if (!cryptoVerify('sha256', nonce, key, signature!)) {
    fail('APP_ASSERTION_INVALID', 'assertion 서명 검증에 실패했습니다.');
  }

  // 🔴 counter 는 **1차 방어가 아니다.** challenge 1회 소비가 replay 를 막고,
  //    counter 는 역행(복제 의심) 신호로 쓴다 — 동시 요청에서 순서가 뒤집힐 수 있기 때문이다.
  if (parsed.counter <= input.storedCounter) {
    fail('APP_ASSERTION_REPLAYED', `assertion counter 가 역행했습니다(${parsed.counter} ≤ ${input.storedCounter}).`);
  }

  return { counter: parsed.counter };
}
