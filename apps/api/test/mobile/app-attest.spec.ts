import { describe, it, expect } from 'vitest';
import { createHash, createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import {
  APPLE_APP_ATTEST_ROOT_CA_PEM,
  APPLE_APP_ATTEST_ROOT_CA_FINGERPRINT256,
} from '../../src/modules/mobile/app-key/apple-root-ca';
import { verifyAssertion, AppAttestError } from '../../src/modules/mobile/app-key/app-attest.verifier';
import { canonicalJson, bodyHashOf } from '../../src/modules/mobile/app-key/app-key.canonical';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

describe('Apple 루트 CA — 동봉한 것이 진짜인가', () => {
  /**
   * 🔴 이 PEM 이 조용히 바뀌면 **체인 검증이 통째로 무의미해지는데 아무 화면도 그 사실을 말하지 않는다.**
   *    Apple 공개값과 지문을 대조해 못박는다.
   */
  it('subject 와 SHA-256 지문이 Apple 공개값과 일치한다', () => {
    const cert = new X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);
    expect(cert.subject).toContain('Apple App Attestation Root CA');
    expect(cert.fingerprint256).toBe(APPLE_APP_ATTEST_ROOT_CA_FINGERPRINT256);
  });

  it('아직 유효하다(만료된 루트를 들고 있으면 전건 실패한다)', () => {
    const cert = new X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('canonical client data — 서버와 앱이 같은 바이트를 만든다', () => {
  it('키를 사전순으로 정렬하고 공백을 넣지 않는다', () => {
    expect(canonicalJson({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
  });

  it('null·undefined 필드는 넣지 않는다 (넣는 것과 바이트가 달라진다)', () => {
    expect(canonicalJson({ a: 1, b: null, c: undefined })).toBe('{"a":1}');
  });

  it('중첩 객체도 정렬한다 (얕은 정렬이면 서명이 갈린다)', () => {
    expect(canonicalJson({ z: { b: 2, a: 1 } })).toBe('{"z":{"a":1,"b":2}}');
  });

  it('🔴 서명 필드는 본문 해시에서 제외한다 (넣으면 순환이 된다)', () => {
    const a = bodyHashOf({ x: 1, appAttestAssertion: 'AAA', appAssertionChallengeId: 'c1' });
    const b = bodyHashOf({ x: 1 });
    expect(a).toBe(b);
  });

  it('본문이 다르면 해시도 다르다 (대조군 — 무조건 같으면 결합이 무의미하다)', () => {
    expect(bodyHashOf({ x: 1 })).not.toBe(bodyHashOf({ x: 2 }));
  });
});

/**
 * assertion 종단 검증 — **실제 P-256 키로 서명해서** 통과/거절을 확인한다.
 *
 * 🔴 목으로 서명 검증을 흉내내면 "검증한 척하는 코드"를 테스트하게 된다(v4.2.0 유형).
 *    여기서는 키를 직접 만들고, Apple 이 만드는 것과 같은 구조의 authenticatorData 를 구성한다.
 */
describe('App Attest assertion 검증', () => {
  const appId = 'TEAM123456.kr.co.weve.his.staff';
  const clientData = canonicalJson({ challenge: 'abc', purpose: 'STAFF_PASSWORD_LOGIN' });

  const makeAuthData = (counter: number, rpId = appId) => {
    const buf = Buffer.alloc(37);
    sha256(rpId).copy(buf, 0);
    buf[32] = 0x40;
    buf.writeUInt32BE(counter, 33);
    return buf;
  };

  const sign = (authData: Buffer, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) => {
    const nonce = sha256(Buffer.concat([authData, sha256(clientData)]));
    const signer = createSign('sha256');
    signer.update(nonce);
    signer.end();
    return signer.sign(privateKey);
  };

  const makeAssertion = (authData: Buffer, signature: Buffer) =>
    Buffer.from(isoCBOR.encode(new Map<string, unknown>([
      ['signature', new Uint8Array(signature)],
      ['authenticatorData', new Uint8Array(authData)],
    ]))).toString('base64');

  const keyPair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    return { privateKey, point: spki.subarray(spki.length - 65) };
  };

  it('정상 assertion 을 통과시키고 counter 를 돌려준다', () => {
    const { privateKey, point } = keyPair();
    const authData = makeAuthData(7);
    const result = verifyAssertion({
      assertion: makeAssertion(authData, sign(authData, privateKey)),
      canonicalClientData: clientData,
      appId,
      publicKey: point,
      storedCounter: 6,
    });
    expect(result.counter).toBe(7);
  });

  it('🔴 다른 키로 서명하면 거절한다', () => {
    const signer = keyPair();
    const other = keyPair();
    const authData = makeAuthData(7);
    expect(() =>
      verifyAssertion({
        assertion: makeAssertion(authData, sign(authData, signer.privateKey)),
        canonicalClientData: clientData,
        appId,
        publicKey: other.point,
        storedCounter: 6,
      }),
    ).toThrowError(AppAttestError);
  });

  it('🔴 client data 가 바뀌면 거절한다 (다른 요청에 전용 불가)', () => {
    const { privateKey, point } = keyPair();
    const authData = makeAuthData(7);
    expect(() =>
      verifyAssertion({
        assertion: makeAssertion(authData, sign(authData, privateKey)),
        canonicalClientData: canonicalJson({ challenge: 'abc', purpose: 'OTHER_PURPOSE' }),
        appId,
        publicKey: point,
        storedCounter: 6,
      }),
    ).toThrowError(AppAttestError);
  });

  it('🔴 App ID 가 다르면 거절한다 (다른 앱의 assertion 을 받지 않는다)', () => {
    const { privateKey, point } = keyPair();
    const authData = makeAuthData(7, 'TEAM123456.kr.co.weve.his.patient');
    let code = '';
    try {
      verifyAssertion({
        assertion: makeAssertion(authData, sign(authData, privateKey)),
        canonicalClientData: clientData,
        appId,
        publicKey: point,
        storedCounter: 6,
      });
    } catch (e) {
      code = (e as AppAttestError).code;
    }
    expect(code).toBe('APP_ASSERTION_INVALID');
  });

  it('🔴 counter 가 역행하면 replay 로 본다', () => {
    const { privateKey, point } = keyPair();
    const authData = makeAuthData(5);
    let code = '';
    try {
      verifyAssertion({
        assertion: makeAssertion(authData, sign(authData, privateKey)),
        canonicalClientData: clientData,
        appId,
        publicKey: point,
        storedCounter: 5,
      });
    } catch (e) {
      code = (e as AppAttestError).code;
    }
    expect(code).toBe('APP_ASSERTION_REPLAYED');
  });
});
