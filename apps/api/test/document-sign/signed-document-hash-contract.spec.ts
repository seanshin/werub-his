import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';

import { DocumentSignService } from '../../src/modules/document-sign/document-sign.service';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { recordBlockchainSignature } from '../../src/common/util/blockchain-signature';

/** A2 — 서명 대상 내용 해시(서버 정본)는 원장을 읽는다. 여기선 "지금 내용의 해시"를 테스트가 정한다(null = 문서 없음) */
const content = vi.hoisted(() => ({ hash: null as string | null }));
vi.mock('../../src/modules/document-sign/document-content-hash', async (orig) => ({
  ...(await orig<object>()),
  signedContentHash: vi.fn(async (_p: unknown, type: string, id: string) => (content.hash == null ? null : { type, documentId: id, patientId: null, canon: 'test', hash: content.hash })),
}));


/**
 * 서명 검증 입력(= 서명된 메시지)과 `SignedDocument.documentHash` 의 계약 (2026-09-15 P1).
 *
 * 🔴 실측: 동의서는 서명 **전에** `anchorConsentSignature` 가 앵커 페이로드 해시(`CONSENT|id|role|signer|ts`)를
 *    `SignedDocument.documentHash` 에 박아 문서를 만든다. 그 뒤 화면이 만든 식별 해시에 붙인 **실제 서명**이
 *    기록되면, `/verify` 는 문서의 앵커 해시로 재검증해 **정상 서명을 FAILED** 라고 말했다.
 *    (검증은 서명 시점엔 넘어갔다 — 기록은 서명자가 실제로 서명한 해시로 했기 때문이다.)
 *
 * 🔴 정정 재서명은 문서 해시를 새 서명의 해시로 바꾼다. 그러면 **직전 서명**은 현행 해시로 재검증할 수 없다 —
 *    "맞지 않음(FAILED)"이 아니라 "현행 해시로는 검증 불가"다(기록 시점엔 검증됐다는 사실이 `verifiedAt` 에 있다).
 *
 * 목은 실제 WebCrypto 키·서명을 쓴다(내가 가정한 인코딩으로 테스트하면 가드가 헛돈다).
 */
const subtle = webcrypto.subtle;
const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
};
const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

let pem: string;
let sign: (hashHex: string) => Promise<string>;
beforeAll(async () => {
  const kp = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' } as never, true, ['sign', 'verify'])) as CryptoKeyPair;
  pem = toPem(await subtle.exportKey('spki', kp.publicKey));
  sign = async (hashHex) =>
    Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' } as never, kp.privateKey, hexToBytes(hashHex))).toString('base64');
});

const CONSENT_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const DOCTOR_ID = '33333333-3333-4333-8333-333333333333';
const CERT_ID = '44444444-4444-4444-8444-444444444444';
/** 화면(SmartSignButton)이 만드는 서명 대상 식별 해시 */
const SCREEN_HASH = createHash('sha256').update('CONSENT:11111111:수술 동의서').digest('hex');
const AMENDED_HASH = createHash('sha256').update('CONSENT:11111111:수술 동의서(정정)').digest('hex');
beforeEach(() => { content.hash = SCREEN_HASH; });

/** 최소 in-memory prisma — 실제 쓰기 순서(앵커 → 서명)를 그대로 재현한다 */
function makePrisma(certOwner: { userId?: string | null; patientId?: string | null; ownerType: string }) {
  const docs: any[] = [];
  const sigs: any[] = [];
  const anchors: any[] = [];
  const cert = {
    id: CERT_ID, publicKey: pem, algorithm: 'ECDSA-P256', status: 'ACTIVE',
    issuedAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01'), revokedAt: null,
    serialNumber: 'SER-1', fingerprint: 'fp', ownerType: certOwner.ownerType,
    userId: certOwner.userId ?? null, patientId: certOwner.patientId ?? null,
  };
  const withSigs = (d: any) => ({
    ...d,
    signatures: sigs.filter((s) => s.signedDocumentId === d.id).map((s) => ({ ...s, certificate: cert })),
  });
  const client: any = {
    _docs: docs, _sigs: sigs, _anchors: anchors,
    consentForm: { findUnique: vi.fn(async () => ({ id: CONSENT_ID, consentType: 'GENERAL', patientId: PATIENT_ID })) },
    blockchainCertificate: { findUnique: vi.fn(async () => cert) },
    blockchainAnchor: { create: vi.fn(async ({ data }: any) => { anchors.push(data); return data; }) },
    signedDocument: {
      findFirst: vi.fn(async ({ where }: any) => docs.find((d) => d.documentType === where.documentType && d.documentId === where.documentId) ?? null),
      findUnique: vi.fn(async ({ where }: any) => {
        const d = docs.find((x) => x.id === where.id);
        return d ? withSigs(d) : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const d = { id: `doc-${docs.length + 1}`, documentVersion: 1, requiredSigners: 1, completedSigners: 0, ...data };
        docs.push(d);
        return d;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const d = docs.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries<any>(data)) {
          d[k] = v && typeof v === 'object' && 'increment' in v ? (d[k] ?? 0) + v.increment : v;
        }
        return withSigs(d);
      }),
    },
    documentSignature: {
      create: vi.fn(async ({ data }: any) => { const s = { id: `sig-${sigs.length + 1}`, isValid: true, ...data }; sigs.push(s); return s; }),
      count: vi.fn(async ({ where }: any) => sigs.filter((s) => s.signedDocumentId === where.signedDocumentId).length),
      findFirst: vi.fn(async ({ where }: any) => sigs.find((s) => s.signedDocumentId === where.signedDocumentId
        && s.certificateId === where.certificateId && s.signatureValue === where.signatureValue) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        sigs.filter((s) => s.signedDocumentId === where.signedDocumentId && s.isValid === true && (!where.id?.not || s.id !== where.id.not))
          .forEach((s) => Object.assign(s, data));
        return { count: 0 };
      }),
    },
  };
  client.$transaction = async (fn: any) => fn(client);
  return client;
}

const consentServiceWith = (prisma: any) =>
  new ConsentService(prisma, { emit: vi.fn() } as any, { safeLog: vi.fn() } as any, {} as any, {} as any, {} as any) as any;

describe('🔴 동의서 — 앵커가 먼저 만든 문서에 실서명이 붙어도 재검증이 통과한다', () => {
  let prisma: any;
  beforeEach(() => { prisma = makePrisma({ ownerType: 'STAFF', userId: DOCTOR_ID }); });

  it('앵커(페이로드 해시) → 실서명 기록 → /verify 가 VERIFIED (종전: 앵커 해시로 재검증해 FAILED)', async () => {
    const svc = consentServiceWith(prisma);
    // ① 서명자 이벤트: 앵커가 SignedDocument 를 먼저 만든다
    await svc.anchorConsentSignature(CONSENT_ID, PATIENT_ID, 'DOCTOR', DOCTOR_ID);
    expect(prisma._docs).toHaveLength(1);
    // ② 임상 공통 헬퍼로 실제 서명 기록(화면 식별 해시에 붙인 서명)
    const ok = await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(SCREEN_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: SCREEN_HASH },
      { documentType: 'CONSENT', documentId: CONSENT_ID, patientId: PATIENT_ID, signerUserId: DOCTOR_ID },
    );
    expect(ok).toBe(true);
    // ③ 재검증
    const verify = await new DocumentSignService(prisma).verify(prisma._docs[0].id);
    expect(verify.signatures[0].verification).toBe('VERIFIED');
    expect(verify.allSignaturesValid).toBe(true);
  });

  it('대조군 — 변조 서명은 그대로 거부된다(기록 0건)', async () => {
    const svc = consentServiceWith(prisma);
    await svc.anchorConsentSignature(CONSENT_ID, PATIENT_ID, 'DOCTOR', DOCTOR_ID);
    const ok = await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(AMENDED_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: SCREEN_HASH },
      { documentType: 'CONSENT', documentId: CONSENT_ID, patientId: PATIENT_ID, signerUserId: DOCTOR_ID },
    );
    expect(ok).toBe(false);
    expect(prisma._sigs).toHaveLength(0);
  });

  it('🔴 이미 검증된 서명이 있는 문서의 해시는 뒤에 온 다른 해시로 덮이지 않는다', async () => {
    const svc = consentServiceWith(prisma);
    await svc.anchorConsentSignature(CONSENT_ID, PATIENT_ID, 'DOCTOR', DOCTOR_ID);
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(SCREEN_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: SCREEN_HASH },
      { documentType: 'CONSENT', documentId: CONSENT_ID, patientId: PATIENT_ID, signerUserId: DOCTOR_ID },
    );
    // 두 번째 서명자가 (정정 없이) 다른 해시로 서명 → 문서 해시는 그대로여야 첫 서명이 계속 검증된다
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(AMENDED_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: AMENDED_HASH },
      { documentType: 'CONSENT', documentId: CONSENT_ID, patientId: PATIENT_ID, signerUserId: DOCTOR_ID, signerRole: 'WITNESS' },
    );
    expect(prisma._docs[0].documentHash).toBe(SCREEN_HASH);
    const verify = await new DocumentSignService(prisma).verify(prisma._docs[0].id);
    expect(verify.signatures[0].verification).toBe('VERIFIED');
  });
});

describe('서명 문서 없음은 코드로 말한다 — 인쇄물이 미서명과 조회 실패를 가를 근거', () => {
  it('getSignedDocument 404 에 SIGNED_DOCUMENT_NOT_FOUND 코드', async () => {
    const svc = new DocumentSignService({ signedDocument: { findFirst: vi.fn().mockResolvedValue(null) } } as never);
    const err = (await svc.getSignedDocument('PRESCRIPTION', 'rx-1').catch((e: unknown) => e)) as { getStatus: () => number; getResponse: () => { code?: string } };
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().code).toBe('SIGNED_DOCUMENT_NOT_FOUND');
  });
});

describe('🔴 정정 재서명 — 대체된 직전 서명을 "맞지 않음"이라 말하지 않는다', () => {
  it('직전 서명은 NOT_VERIFIABLE(SUPERSEDED_DOCUMENT_HASH) · 현행 서명은 VERIFIED', async () => {
    const prisma = makePrisma({ ownerType: 'STAFF', userId: DOCTOR_ID });
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(SCREEN_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: SCREEN_HASH },
      { documentType: 'ENCOUNTER', documentId: CONSENT_ID, signerUserId: DOCTOR_ID },
    );
    content.hash = AMENDED_HASH; // 정정으로 내용이 바뀌었다
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(AMENDED_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: AMENDED_HASH },
      { documentType: 'ENCOUNTER', documentId: CONSENT_ID, signerUserId: DOCTOR_ID, amended: true },
    );
    const verify = await new DocumentSignService(prisma).verify(prisma._docs[0].id);
    const superseded = verify.signatures.find((s: any) => !s.current)!;
    const current = verify.signatures.find((s: any) => s.current)!;
    expect(superseded.verification).toBe('NOT_VERIFIABLE');
    expect(superseded.verificationReason).toBe('SUPERSEDED_DOCUMENT_HASH');
    expect(current.verification).toBe('VERIFIED');
  });

  it('대조군 — 기록 시 검증되지 않은(verifiedAt 없는) 대체 서명은 승격하지 않는다', async () => {
    const prisma = makePrisma({ ownerType: 'STAFF', userId: DOCTOR_ID });
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(SCREEN_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: SCREEN_HASH },
      { documentType: 'ENCOUNTER', documentId: CONSENT_ID, signerUserId: DOCTOR_ID },
    );
    prisma._sigs[0].verifiedAt = null; // 기록 시 미검증이었던 서명
    content.hash = AMENDED_HASH; // 정정으로 내용이 바뀌었다
    await recordBlockchainSignature(
      prisma,
      { certificateId: CERT_ID, signatureValue: await sign(AMENDED_HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: AMENDED_HASH },
      { documentType: 'ENCOUNTER', documentId: CONSENT_ID, signerUserId: DOCTOR_ID, amended: true },
    );
    const verify = await new DocumentSignService(prisma).verify(prisma._docs[0].id);
    const superseded = verify.signatures.find((s: any) => !s.current)!;
    expect(superseded.verification).toBe('FAILED');
    expect(superseded.isValid).toBe(false);
  });
});
