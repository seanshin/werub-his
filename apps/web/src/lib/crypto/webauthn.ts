/**
 * WebAuthn helper for biometric authentication (Touch ID, Face ID, Windows Hello)
 *
 * 전략: WebAuthn은 "본인확인 게이트"로만 사용.
 * 개인키는 IndexedDB에 저장 (same-origin 보호).
 * Touch ID 성공 → 키 접근 허용 → 서명 실행.
 *
 * WebAuthn을 키 파생에 사용하지 않음 (매번 다른 signature → 불안정).
 */

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function isPlatformAuthAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration — Touch ID/Face ID 등록
// ---------------------------------------------------------------------------

export async function registerBiometric(
  userId: string,
  userName: string,
): Promise<{ credentialId: string }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(userId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: '위루비병원', id: window.location.hostname },
      user: { id: userIdBytes, name: userName, displayName: userName },
      challenge: challenge.buffer,
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('생체인증 등록이 취소되었습니다.');

  return { credentialId: bufferToBase64url(credential.rawId) };
}

// ---------------------------------------------------------------------------
// Authentication — Touch ID/Face ID 본인확인
// ---------------------------------------------------------------------------

export async function authenticateBiometric(credentialId: string): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge.buffer,
      allowCredentials: [{
        id: base64urlToBuffer(credentialId),
        type: 'public-key',
        transports: ['internal'],
      }],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('생체인증이 취소되었습니다.');
  return true; // 성공 = 본인 확인 완료
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { bufferToBase64url, base64urlToBuffer };
