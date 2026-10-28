/**
 * Document signing utilities using Web Crypto API.
 */

import type { KeyAlgorithm } from './key-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferFromHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

function base64FromBuffer(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function bufferFromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of content string. Returns hex-encoded hash.
 */
export async function hashDocument(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return hexFromBuffer(hashBuffer);
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

function getSignAlgorithm(algorithm: KeyAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (algorithm === 'ECDSA-P256') {
    return { name: 'ECDSA', hash: 'SHA-256' };
  }
  return { name: 'RSASSA-PKCS1-v1_5' };
}

/**
 * Sign a hex-encoded hash with the given private key. Returns base64-encoded signature.
 */
export async function signHash(
  privateKey: CryptoKey,
  hash: string,
  algorithm: KeyAlgorithm,
): Promise<string> {
  const data = bufferFromHex(hash);
  const signature = await crypto.subtle.sign(getSignAlgorithm(algorithm), privateKey, data);
  return base64FromBuffer(signature);
}

// ---------------------------------------------------------------------------
// Verify (client-side, for testing)
// ---------------------------------------------------------------------------

/**
 * Verify a base64-encoded signature against a hex-encoded hash.
 */
export async function verifySignature(
  publicKey: CryptoKey,
  signature: string,
  hash: string,
  algorithm: KeyAlgorithm,
): Promise<boolean> {
  const sigBuffer = bufferFromBase64(signature);
  const hashBuffer = bufferFromHex(hash);
  return crypto.subtle.verify(getSignAlgorithm(algorithm), publicKey, sigBuffer, hashBuffer);
}
