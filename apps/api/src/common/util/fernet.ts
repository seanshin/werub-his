import * as crypto from 'crypto';

/**
 * Fernet 대칭 복호 (spec: https://github.com/fernet/spec) — 무 npm 의존.
 * PACS patient-export 패키지(Fernet 암호화 ZIP)를 서버측에서 복호.
 *
 * 토큰: base64url( 0x80 | timestamp(8) | iv(16) | ciphertext | hmac(32) )
 * 키:   base64url(32B) = signingKey(16) || encryptionKey(16)
 * HMAC: SHA256(signingKey, version|timestamp|iv|ciphertext)
 * 암호: AES-128-CBC(encryptionKey, iv), PKCS7 패딩.
 */

function b64urlToBuf(s: string): Buffer {
  // Fernet 키/토큰은 url-safe base64. 표준 base64로 환원 후 디코드.
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(std, 'base64');
}

export class FernetError extends Error {}

/**
 * @param token Fernet 토큰(base64url 문자열)
 * @param key   base64url 인코딩된 32바이트 키
 * @param ttlSeconds 선택. 지정 시 timestamp가 now-ttl 보다 오래되면 거부.
 * @returns 복호된 평문 Buffer
 */
export function fernetDecrypt(token: string, key: string, ttlSeconds?: number): Buffer {
  const k = b64urlToBuf(key);
  if (k.length !== 32) throw new FernetError('Fernet 키 길이 오류(32B 필요)');
  const signingKey = k.subarray(0, 16);
  const encKey = k.subarray(16, 32);

  const data = b64urlToBuf(token);
  if (data.length < 1 + 8 + 16 + 32) throw new FernetError('Fernet 토큰 길이 오류');
  if (data[0] !== 0x80) throw new FernetError('Fernet 버전 불일치');

  const hmacGiven = data.subarray(data.length - 32);
  const signed = data.subarray(0, data.length - 32); // version|ts|iv|ciphertext
  const hmacCalc = crypto.createHmac('sha256', signingKey).update(signed).digest();
  if (hmacGiven.length !== hmacCalc.length || !crypto.timingSafeEqual(hmacGiven, hmacCalc)) {
    throw new FernetError('Fernet HMAC 검증 실패(위변조)');
  }

  if (ttlSeconds != null) {
    const ts = Number(data.readBigUInt64BE(1));
    const now = Math.floor(Date.now() / 1000);
    if (ts + ttlSeconds < now) throw new FernetError('Fernet 토큰 만료');
  }

  const iv = signed.subarray(9, 25);
  const ciphertext = signed.subarray(25);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new FernetError('Fernet 암호문 블록 오류');
  }

  const decipher = crypto.createDecipheriv('aes-128-cbc', encKey, iv);
  decipher.setAutoPadding(true); // PKCS7
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
