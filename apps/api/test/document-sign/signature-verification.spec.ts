import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

import {
  verifyDocumentSignature,
  publicKeyProblem,
  storedVerification,
} from '../../src/common/util/signature-verify';
import { DocumentSignService } from '../../src/modules/document-sign/document-sign.service';
import { recordBlockchainSignature, certificateOwnershipProblem } from '../../src/common/util/blockchain-signature';

/** A2 — 서명 대상 내용 해시(서버 정본)는 원장을 읽는다. 여기선 "지금 내용의 해시"를 테스트가 정한다(null = 문서 없음) */
const content = vi.hoisted(() => ({ hash: null as string | null }));
vi.mock('../../src/modules/document-sign/document-content-hash', async (orig) => ({
  ...(await orig<object>()),
  signedContentHash: vi.fn(async (_p: unknown, type: string, id: string) => (content.hash == null ? null : { type, documentId: id, patientId: null, canon: 'test', hash: content.hash })),
}));


/**
 * 전자서명 암호 검증(2026-09-15 N2).
 *
 * 🔴 실측: 서명 행은 `isValid @default(true)` 로 태어났고 서버에 공개키 검증 코드가 없었다 — 아무 문자열이나
 *    "유효 서명"이었다. 포털은 `base64('portal-patient-<시각>')` 를 공개키로 보내 개인키 없는 인증서를 받았다.
 *
 * 🔴 목은 **웹 서명기와 같은 방식**으로 만든다 — WebCrypto(generateKey·exportKey spki·sign(hexToBytes(hash)))로
 *    실제 키와 서명을 만들어 서버 검증기에 넣는다. 내가 가정한 인코딩으로 테스트하면 실서명 전부가 거부돼도 통과한다.
 */
const subtle = webcrypto.subtle;
const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
};
const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

type Made = { pem: string; sign: (hashHex: string) => Promise<string> };
async function makeKey(alg: 'ECDSA-P256' | 'RSA-2048'): Promise<Made> {
  const params = alg === 'ECDSA-P256'
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const kp = await subtle.generateKey(params as never, true, ['sign', 'verify']) as CryptoKeyPair;
  const pem = toPem(await subtle.exportKey('spki', kp.publicKey));
  const signParams = alg === 'ECDSA-P256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  return {
    pem,
    sign: async (hashHex) => Buffer.from(await subtle.sign(signParams as never, kp.privateKey, hexToBytes(hashHex))).toString('base64'),
  };
}

const HASH = createHash('sha256').update('CONSENT:doc-1:동의서').digest('hex');
const OTHER_HASH = createHash('sha256').update('CONSENT:doc-1:다른 문서').digest('hex');
beforeEach(() => { content.hash = HASH; });
const FAKE_PORTAL_KEY = Buffer.from(`portal-patient-${1757900000000}`).toString('base64');

let ec: Made; let rsa: Made;
beforeAll(async () => { ec = await makeKey('ECDSA-P256'); rsa = await makeKey('RSA-2048'); });

describe('검증 정본 — 웹 서명기가 만든 실제 서명', () => {
  it('대조군 — ECDSA-P256 실서명은 VERIFIED', async () => {
    const r = verifyDocumentSignature({ publicKey: ec.pem, certAlgorithm: 'ECDSA-P256', signatureAlgorithm: 'ECDSA-P256', signatureValue: await ec.sign(HASH), documentHash: HASH });
    expect(r).toEqual({ state: 'VERIFIED', reason: null });
  });

  it('대조군 — RSA-2048 실서명은 VERIFIED', async () => {
    const r = verifyDocumentSignature({ publicKey: rsa.pem, certAlgorithm: 'RSA-2048', signatureAlgorithm: 'RSA-2048', signatureValue: await rsa.sign(HASH), documentHash: HASH });
    expect(r.state).toBe('VERIFIED');
  });

  it('🔴 다른 문서 해시에 붙인 서명 → FAILED', async () => {
    const r = verifyDocumentSignature({ publicKey: ec.pem, certAlgorithm: 'ECDSA-P256', signatureAlgorithm: 'ECDSA-P256', signatureValue: await ec.sign(OTHER_HASH), documentHash: HASH });
    expect(r).toEqual({ state: 'FAILED', reason: 'SIGNATURE_MISMATCH' });
  });

  it('🔴 아무 문자열 서명값 → FAILED(유효가 아니다)', () => {
    const r = verifyDocumentSignature({ publicKey: ec.pem, certAlgorithm: 'ECDSA-P256', signatureAlgorithm: 'ECDSA-P256', signatureValue: Buffer.from('홍길동-CONSENT-2026').toString('base64'), documentHash: HASH });
    expect(r.state).toBe('FAILED');
  });

  it('🔴 지어낸 포털 공개키 → NOT_VERIFIABLE(유효라고도 실패라고도 단정하지 않는다)', async () => {
    const r = verifyDocumentSignature({ publicKey: FAKE_PORTAL_KEY, certAlgorithm: 'ECDSA-P256', signatureAlgorithm: 'ECDSA-P256', signatureValue: await ec.sign(HASH), documentHash: HASH });
    expect(r).toEqual({ state: 'NOT_VERIFIABLE', reason: 'PUBLIC_KEY_UNUSABLE' });
  });

  it('모르는 알고리즘을 추정해 검증하지 않는다', () => {
    expect(verifyDocumentSignature({ publicKey: ec.pem, certAlgorithm: 'ECDSA', signatureAlgorithm: 'ECDSA', signatureValue: 'x', documentHash: HASH }).state).toBe('NOT_VERIFIABLE');
  });
});

describe('발급 입구 — 지어낸 공개키 거부', () => {
  it('🔴 base64("portal-patient-…") → PUBLIC_KEY_NOT_SPKI', () => {
    expect(publicKeyProblem(FAKE_PORTAL_KEY, 'ECDSA-P256')).toBe('PUBLIC_KEY_NOT_SPKI');
  });
  it('RSA 키를 ECDSA-P256 이라 선언 → 불일치', () => {
    expect(publicKeyProblem(rsa.pem, 'ECDSA-P256')).toBe('PUBLIC_KEY_ALGORITHM_MISMATCH');
  });
  it('대조군 — 웹이 내보낸 PEM(SPKI) 과 base64 DER 은 통과', async () => {
    expect(publicKeyProblem(ec.pem, 'ECDSA-P256')).toBeNull();
    const der = ec.pem.replace(/-----[^-]+-----|\s/g, '');
    expect(publicKeyProblem(der, 'ECDSA-P256')).toBeNull();
  });
});

const CERT = (over: Record<string, unknown> = {}) => ({
  id: 'cert-1', ownerType: 'STAFF', userId: 'u1', patientId: null, status: 'ACTIVE',
  issuedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01'), revokedAt: null,
  algorithm: 'ECDSA-P256', serialNumber: 'CERT-1', fingerprint: 'fp', publicKey: '', ...over,
});

describe('DocumentSignService.sign — 검증되지 않는 서명은 기록하지 않는다', () => {
  const mk = (cert: Record<string, unknown>) => {
    const prisma: Record<string, unknown> = {
      blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(cert) },
      signedDocument: {
        findFirst: vi.fn().mockResolvedValue({ id: 'sd1', completedSigners: 0, requiredSigners: 1 }),
        create: vi.fn(),
        // 🔴 (G3) 완료 카운트는 증가 결과(1/1)로 판정한다 — 목도 정본이 실제로 읽는 모양을 돌려준다
        update: vi.fn().mockResolvedValue({ id: 'sd1', completedSigners: 1, requiredSigners: 1, signatures: [] }),
      },
      documentSignature: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 's1', ...data })), count: vi.fn().mockResolvedValue(0) },
    };
    // 🔴 (G3) 서명 행 생성과 완료 카운트는 한 트랜잭션 — tx 는 같은 목을 재사용한다
    prisma.$transaction = vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
    );
    return { prisma, svc: new DocumentSignService(prisma as never) };
  };
  const body = (sig: string, hash = HASH) => ({
    documentType: 'ENCOUNTER', documentId: 'doc-1', documentHash: hash, certificateId: 'cert-1', // 동의서는 서명 사건 원장이 센다(U1) — 일반 전자서명 경로로 잰다
    signatureValue: sig, signatureAlgorithm: 'ECDSA-P256', signerRole: 'PRIMARY', signerType: 'STAFF',
  });

  it('🔴 서명 불일치 → 400 SIGNATURE_VERIFICATION_FAILED · 서명 행·완료 카운트 없음', async () => {
    const { prisma, svc } = mk(CERT({ publicKey: ec.pem }));
    await expect(svc.sign(body(await ec.sign(OTHER_HASH)), { userId: 'u1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.documentSignature.create).not.toHaveBeenCalled();
    expect(prisma.signedDocument.update).not.toHaveBeenCalled();
  });

  it('대조군 — 실서명은 기록되고 verifiedAt 이 찍히며 VERIFIED 로 응답', async () => {
    const { prisma, svc } = mk(CERT({ publicKey: ec.pem }));
    const r = await svc.sign(body(await ec.sign(HASH)), { userId: 'u1' });
    expect(prisma.documentSignature.create.mock.calls[0][0].data.verifiedAt).toBeInstanceOf(Date);
    expect(r.signature.verification).toBe('VERIFIED');
  });

  it('🔴 공개키를 읽을 수 없는 인증서 → 기록은 하되 verifiedAt=null · NOT_VERIFIED 로 응답', async () => {
    const { prisma, svc } = mk(CERT({ publicKey: FAKE_PORTAL_KEY }));
    const r = await svc.sign(body(await ec.sign(HASH)), { userId: 'u1' });
    expect(prisma.documentSignature.create.mock.calls[0][0].data.verifiedAt).toBeNull();
    expect(r.signature.verification).toBe('NOT_VERIFIED');
  });
});

describe('DocumentSignService.verify — 저장값(isValid)이 아니라 공개키로 다시 검증', () => {
  const mk = (sigs: unknown[]) => {
    const prisma = { signedDocument: { findUnique: vi.fn().mockResolvedValue({ id: 'sd1', documentHash: HASH, status: 'COMPLETED', signatures: sigs }) } };
    return new DocumentSignService(prisma as never);
  };
  const row = async (over: Record<string, unknown>, certOver: Record<string, unknown> = {}) => ({
    id: 's1', signerRole: 'PRIMARY', signedAt: new Date('2026-09-10'), signatureAlgorithm: 'ECDSA-P256',
    signatureValue: await ec.sign(HASH), isValid: true, certificate: CERT({ publicKey: ec.pem, ...certOver }), ...over,
  });

  it('🔴 isValid=true(기본값) 인데 서명이 맞지 않으면 isValid=false · FAILED', async () => {
    const r = await mk([await row({ signatureValue: await ec.sign(OTHER_HASH) })]).verify('sd1');
    expect(r.signatures[0].verification).toBe('FAILED');
    expect(r.signatures[0].isValid).toBe(false);
    expect(r.allSignaturesValid).toBe(false);
  });

  it('🔴 지어낸 공개키 인증서의 서명은 NOT_VERIFIABLE · 유효 아님', async () => {
    const r = await mk([await row({}, { publicKey: FAKE_PORTAL_KEY })]).verify('sd1');
    expect(r.signatures[0].verification).toBe('NOT_VERIFIABLE');
    expect(r.signatures[0].isValid).toBe(false);
  });

  it('대조군 — 실서명·유효 인증서는 VERIFIED · isValid=true', async () => {
    const r = await mk([await row({})]).verify('sd1');
    expect(r.signatures[0].verification).toBe('VERIFIED');
    expect(r.allSignaturesValid).toBe(true);
  });

  it('🔴 서명 시점에 이미 만료된 인증서(폐기 아님)는 certValid=false — 종전 식은 true', async () => {
    const r = await mk([await row({}, { expiresAt: new Date('2026-09-01') })]).verify('sd1');
    expect(r.signatures[0].certValid).toBe(false);
  });

  it('🔴 서명 **전에** 폐기된 인증서(만료일은 미래)는 certValid=false — 종전 식은 만료일만 보고 true', async () => {
    const r = await mk([await row({}, { status: 'REVOKED', revokedAt: new Date('2026-09-05') })]).verify('sd1');
    expect(r.signatures[0].certValid).toBe(false);
  });

  it('대조군 — 서명 **뒤에** 폐기된 인증서는 서명 시점에 유효', async () => {
    const r = await mk([await row({}, { status: 'REVOKED', revokedAt: new Date('2026-09-12') })]).verify('sd1');
    expect(r.signatures[0].certValid).toBe(true);
  });

  it('서명 0건은 "전부 유효"가 아니다 — null', async () => {
    const r = await mk([]).verify('sd1');
    expect(r.allSignaturesValid).toBeNull();
  });

  it('저장 행 검증 상태 — verifiedAt 없으면 NOT_VERIFIED', () => {
    expect(storedVerification({ verifiedAt: null })).toBe('NOT_VERIFIED');
    expect(storedVerification({ verifiedAt: new Date() })).toBe('VERIFIED');
  });
});

describe('공통 헬퍼 recordBlockchainSignature — 7개 임상 서명 경로', () => {
  const mk = (cert: Record<string, unknown>) => {
    const tx = {
      // (U1) 증가 결과(실제 값)로 완료를 판정한다 — 목도 정본이 읽는 모양을 돌려준다
      signedDocument: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'sd1' }), update: vi.fn().mockResolvedValue({ completedSigners: 1, requiredSigners: 1 }) },
      documentSignature: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = { ...tx, blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(cert) }, $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  };
  const opts = { documentType: 'ENCOUNTER', documentId: 'e1', signerUserId: 'u1' };

  it('🔴 서명 불일치 → false · 기록 없음', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem }));
    const ok = await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(OTHER_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, opts);
    expect(ok).toBe(false);
    expect(tx.documentSignature.create).not.toHaveBeenCalled();
  });

  it('대조군 — 실서명은 기록 · verifiedAt 찍힘', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem }));
    const ok = await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, opts);
    expect(ok).toBe(true);
    expect(tx.documentSignature.create.mock.calls[0][0].data.verifiedAt).toBeInstanceOf(Date);
  });

  // 🔴 (2026-09-15 M1) 소유자 대조 — 종전엔 인증서 id 만 맞으면 누구의 인증서든 기록했다
  it('🔴 남의 직원 인증서(userId 불일치) → false · 기록 없음 — 실서명이어도', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem, userId: 'someone-else' }));
    const ok = await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, opts);
    expect(ok).toBe(false);
    expect(tx.documentSignature.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('🔴 환자 인증서로 직원 서명 경로 → false', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem, ownerType: 'PATIENT', userId: null, patientId: 'p1' }));
    const ok = await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, opts);
    expect(ok).toBe(false);
    expect(tx.documentSignature.create).not.toHaveBeenCalled();
  });

  it('같은 서명이 이미 기록돼 있으면(서명 모달이 먼저 기록) 이중 행·이중 카운트를 만들지 않는다', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem }));
    tx.signedDocument.findFirst.mockResolvedValue({ id: 'sd1' });
    tx.documentSignature.findFirst.mockResolvedValue({ id: 'sig-existing' });
    const ok = await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, opts);
    expect(ok).toBe(true);
    expect(tx.documentSignature.create).not.toHaveBeenCalled();
    expect(tx.signedDocument.update).not.toHaveBeenCalled();
  });

  it('정정 재서명 — 방금 기록된 같은 서명은 무효화하지 않는다(현행본이 0개가 되지 않게)', async () => {
    const { prisma, tx } = mk(CERT({ publicKey: ec.pem }));
    tx.signedDocument.findFirst.mockResolvedValue({ id: 'sd1' });
    tx.signedDocument.update.mockResolvedValue({ id: 'sd1' });
    tx.documentSignature.findFirst.mockResolvedValue({ id: 'sig-new' });
    await recordBlockchainSignature(prisma as never, { certificateId: 'cert-1', signatureValue: await ec.sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH }, { ...opts, amended: true });
    expect(tx.documentSignature.updateMany.mock.calls[0][0].where).toMatchObject({ id: { not: 'sig-new' } });
  });
});

describe('certificateOwnershipProblem — 소유 대조 정본', () => {
  const staff = { ownerType: 'STAFF', userId: 'u1', patientId: null };
  const patient = { ownerType: 'PATIENT', userId: null, patientId: 'p1' };
  it('대조군 — 본인 직원 인증서 · 그 환자 인증서는 통과', () => {
    expect(certificateOwnershipProblem(staff, { signerType: 'STAFF', signerUserId: 'u1' })).toBeNull();
    expect(certificateOwnershipProblem(patient, { signerType: 'PATIENT', signerPatientId: 'p1' })).toBeNull();
  });
  it('불일치·유형 교차·서명자 미상은 거부', () => {
    expect(certificateOwnershipProblem(staff, { signerType: 'STAFF', signerUserId: 'u2' })).toBe('SIGN_CERT_NOT_OWNED');
    expect(certificateOwnershipProblem(patient, { signerType: 'STAFF', signerUserId: 'u1' })).toBe('SIGN_CERT_NOT_OWNED');
    expect(certificateOwnershipProblem(staff, { signerType: 'PATIENT', signerPatientId: 'p1' })).toBe('SIGN_CERT_NOT_OWNED');
    expect(certificateOwnershipProblem(staff, { signerType: 'STAFF' })).toBe('SIGNER_UNKNOWN');
    expect(certificateOwnershipProblem(staff, { signerType: 'X', signerUserId: 'u1' })).toBe('SIGN_SIGNER_TYPE_INVALID');
  });
});
