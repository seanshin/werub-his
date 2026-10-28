import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';

/**
 * 전자서명 암호 검증 정본 (2026-09-15 N2).
 *
 * 🔴 실측: 서명 행은 `isValid @default(true)` 로 태어났고, 서명값을 인증서 공개키로 검증하는 코드가
 *    **서버 어디에도 없었다**. `/document-sign/verify` 는 `sha256(signatureValue)` 를 "서명값 해시 검증"이라
 *    부르며 `sig.isValid && 인증서 상태` 만 돌려줬다 — 아무 문자열이나 넣어도 "유효 서명"이었다.
 *    포털은 `base64('portal-patient-<시각>')` 를 공개키라며 인증서를 발급받았다(개인키가 존재하지 않는 인증서).
 *
 * 알고리즘은 **웹 서명기(`apps/web/src/lib/crypto/signer.ts`)가 실제로 만드는 두 가지만** 받는다 —
 * 모르는 알고리즘을 추정해 검증하지 않는다(`NOT_VERIFIABLE`).
 *   - `ECDSA-P256`: WebCrypto ECDSA(SHA-256) — 서명은 IEEE P1363(r||s) 인코딩
 *   - `RSA-2048`  : WebCrypto RSASSA-PKCS1-v1_5(SHA-256)
 * 서명 대상은 **documentHash(hex) 를 바이트로 푼 값**이다(`signHash` 가 `bufferFromHex(hash)` 를 서명).
 *
 * 상태 3가지 — 저장 계층 표현(스키마 변경 없음):
 *   - `VERIFIED`       공개키로 검증 통과 → 행 `verifiedAt` 에 시각
 *   - `FAILED`         공개키는 읽었는데 서명이 맞지 않음 → **서명으로 기록하지 않는다**(쓰기 경로에서 거부)
 *   - `NOT_VERIFIABLE` 공개키를 읽을 수 없거나 알고리즘 미지원 → 기록은 하되 `verifiedAt=null`(= 미검증)
 */
export type SignatureVerification = 'VERIFIED' | 'FAILED' | 'NOT_VERIFIABLE';

export const SUPPORTED_SIGNATURE_ALGORITHMS = ['ECDSA-P256', 'RSA-2048'] as const;
export type SupportedSignatureAlgorithm = (typeof SUPPORTED_SIGNATURE_ALGORITHMS)[number];

const isSupported = (a: string): a is SupportedSignatureAlgorithm =>
  (SUPPORTED_SIGNATURE_ALGORITHMS as readonly string[]).includes(a);

/** PEM(SPKI) 또는 base64 DER(SPKI) — 둘 다 아니면 null */
export function parseSpkiPublicKey(publicKey: string): KeyObject | null {
  if (typeof publicKey !== 'string' || publicKey.trim() === '') return null;
  const s = publicKey.trim();
  try {
    if (s.startsWith('-----BEGIN PUBLIC KEY-----')) return createPublicKey({ key: s, format: 'pem' });
    if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) return null;
    return createPublicKey({ key: Buffer.from(s.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** 공개키가 선언한 알고리즘의 키인가 — 곡선·키 길이까지 */
export function keyMatchesAlgorithm(key: KeyObject, algorithm: string): boolean {
  const d = key.asymmetricKeyDetails ?? {};
  if (algorithm === 'ECDSA-P256') return key.asymmetricKeyType === 'ec' && d.namedCurve === 'prime256v1';
  if (algorithm === 'RSA-2048') return key.asymmetricKeyType === 'rsa' && (d.modulusLength ?? 0) >= 2048;
  return false;
}

/**
 * 발급 입구 검증 — 지어낸 공개키(`base64('portal-patient-…')`)·알고리즘 불일치를 사유와 함께 돌려준다.
 * null = 통과.
 */
export function publicKeyProblem(publicKey: string, algorithm: string): string | null {
  if (!isSupported(algorithm)) return 'UNSUPPORTED_ALGORITHM';
  const key = parseSpkiPublicKey(publicKey);
  if (!key) return 'PUBLIC_KEY_NOT_SPKI';
  if (!keyMatchesAlgorithm(key, algorithm)) return 'PUBLIC_KEY_ALGORITHM_MISMATCH';
  return null;
}

export function verifyDocumentSignature(input: {
  publicKey: string;
  certAlgorithm: string;
  signatureAlgorithm: string;
  signatureValue: string;
  documentHash: string;
}): { state: SignatureVerification; reason: string | null } {
  const { publicKey, certAlgorithm, signatureAlgorithm, signatureValue, documentHash } = input;
  if (!isSupported(certAlgorithm)) return { state: 'NOT_VERIFIABLE', reason: 'UNSUPPORTED_ALGORITHM' };
  const key = parseSpkiPublicKey(publicKey);
  if (!key || !keyMatchesAlgorithm(key, certAlgorithm)) return { state: 'NOT_VERIFIABLE', reason: 'PUBLIC_KEY_UNUSABLE' };
  // 공개키는 읽었다 — 여기부터의 불일치는 "모름"이 아니라 "맞지 않음"이다
  if (signatureAlgorithm !== certAlgorithm) return { state: 'FAILED', reason: 'ALGORITHM_MISMATCH' };
  if (typeof documentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(documentHash)) return { state: 'FAILED', reason: 'DOCUMENT_HASH_INVALID' };
  if (typeof signatureValue !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(signatureValue)) return { state: 'FAILED', reason: 'SIGNATURE_ENCODING_INVALID' };
  const data = Buffer.from(documentHash, 'hex');
  const sig = Buffer.from(signatureValue, 'base64');
  let ok = false;
  try {
    ok = certAlgorithm === 'ECDSA-P256'
      ? cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      : cryptoVerify('sha256', data, key, sig);
  } catch {
    ok = false;
  }
  return ok ? { state: 'VERIFIED', reason: null } : { state: 'FAILED', reason: 'SIGNATURE_MISMATCH' };
}

/**
 * 저장된 행의 검증 상태(읽기 쪽). FAILED 는 쓰기에서 거부하므로 저장 행에는 없다.
 * 🔴 `isValid` 는 "현행본인가(정정으로 대체되지 않았는가)"이지 암호 검증 결과가 아니다 — 섞지 않는다.
 */
export function storedVerification(sig: { verifiedAt: Date | null }): 'VERIFIED' | 'NOT_VERIFIED' {
  return sig.verifiedAt ? 'VERIFIED' : 'NOT_VERIFIED';
}
