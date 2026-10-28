/**
 * 동의서 서명 수는 서명 사건 원장이 센다(2026-10-13 결함 발굴 U1).
 *  · 🔴 종전: 의사가 서명 모달로 전자서명(+1) 하고 의사 서명 사건(+1)이 또 세어 환자 서명 전에 2/2·COMPLETED
 *  · 🔴 종전: recordBlockchainSignature 가 필요 서명 수와 무관하게 COMPLETED 로 덮었다
 *  · 이제: 동의서 전자서명은 문서에 붙되 수를 올리지 않는다 · 그 밖의 문서는 증가된 실제 값으로 판정
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { DocumentSignService } from '../../src/modules/document-sign/document-sign.service';
import { recordBlockchainSignature } from '../../src/common/util/blockchain-signature';

const content = vi.hoisted(() => ({ hash: 'a'.repeat(64) }));
vi.mock('../../src/modules/document-sign/document-content-hash', async (orig) => ({
  ...(await orig<object>()),
  signedContentHash: vi.fn(async (_p: unknown, type: string, id: string) => ({ type, documentId: id, patientId: null, canon: 't', hash: content.hash })),
}));

let pem = ''; let sign: (h: string) => Promise<string>;
beforeAll(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const b64 = Buffer.from(await webcrypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  pem = `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
  sign = async (h) => Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Uint8Array.from(Buffer.from(h, 'hex')))).toString('base64');
});
const CERT = () => ({ id: 'cert-1', ownerType: 'STAFF', userId: 'u1', patientId: null, status: 'ACTIVE', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2099-01-01'), revokedAt: null, algorithm: 'ECDSA-P256', publicKey: pem });

function world(type: string, required = 2) {
  const doc: any = { id: 'sd1', documentType: type, documentId: 'd1', documentHash: content.hash, completedSigners: 1, requiredSigners: required, status: 'PENDING' };
  const sigs: any[] = [];
  const p: any = {
    blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(CERT()) },
    signedDocument: {
      findFirst: vi.fn(async () => doc), findUnique: vi.fn(async () => ({ ...doc, signatures: sigs })),
      create: vi.fn(), update: vi.fn(async ({ data, select }: any) => { if (data.completedSigners?.increment) doc.completedSigners += 1; else Object.assign(doc, data); return select ? { completedSigners: doc.completedSigners, requiredSigners: doc.requiredSigners } : { ...doc, signatures: sigs }; }),
    },
    documentSignature: { create: vi.fn(async ({ data }: any) => { sigs.push(data); return { id: 's1', ...data }; }), findFirst: vi.fn(async () => null), count: vi.fn(async () => sigs.length), updateMany: vi.fn() },
  };
  p.$transaction = vi.fn(async (fn: any) => fn(p));
  return { p, doc, sigs };
}
const body = async (type: string) => ({ documentType: type, documentId: 'd1', documentHash: content.hash, certificateId: 'cert-1', signatureValue: await sign(content.hash), signatureAlgorithm: 'ECDSA-P256', signerRole: 'PRIMARY', signerType: 'STAFF' });

describe('🔴 동의서 — 전자서명이 서명 수를 올리지 않는다', () => {
  it('서명 모달 경로: 의사 사건 1/2 에서 전자서명 → 그대로 1/2 · PENDING · 서명 행은 붙는다', async () => {
    const { p, doc, sigs } = world('CONSENT');
    await new DocumentSignService(p).sign(await body('CONSENT'), { userId: 'u1' });
    expect(doc).toMatchObject({ completedSigners: 1, status: 'PENDING' });
    expect(sigs).toHaveLength(1);
  });
  it('임상 공통 경로도 동의서는 수를 올리지 않는다', async () => {
    const { p, doc } = world('CONSENT');
    await recordBlockchainSignature(p, { certificateId: 'cert-1', signatureValue: await sign(content.hash), signatureAlgorithm: 'ECDSA-P256', documentHash: content.hash }, { documentType: 'CONSENT', documentId: 'd1', signerUserId: 'u1' });
    expect(doc).toMatchObject({ completedSigners: 1, status: 'PENDING' });
  });
  it('🔴 그 밖의 문서 — 필요 2 중 첫 전자서명(0→1)은 COMPLETED 가 아니다 · 대조군: 1→2 면 COMPLETED', async () => {
    const a = world('ENCOUNTER'); a.doc.completedSigners = 0;
    await recordBlockchainSignature(a.p, { certificateId: 'cert-1', signatureValue: await sign(content.hash), signatureAlgorithm: 'ECDSA-P256', documentHash: content.hash }, { documentType: 'ENCOUNTER', documentId: 'd1', signerUserId: 'u1' });
    expect(a.doc).toMatchObject({ completedSigners: 1, status: 'PENDING' });
    const b = world('ENCOUNTER');
    await recordBlockchainSignature(b.p, { certificateId: 'cert-1', signatureValue: await sign(content.hash), signatureAlgorithm: 'ECDSA-P256', documentHash: content.hash }, { documentType: 'ENCOUNTER', documentId: 'd1', signerUserId: 'u1' });
    expect(b.doc).toMatchObject({ completedSigners: 2, status: 'COMPLETED' });
  });
});
