import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';

import { ConsentService } from '../../src/modules/consent/consent.service';

/** A2 — 서명 대상 내용 해시(서버 정본)는 원장을 읽는다. 여기선 "지금 내용의 해시"를 테스트가 정한다(null = 문서 없음) */
const content = vi.hoisted(() => ({ hash: null as string | null }));
vi.mock('../../src/modules/document-sign/document-content-hash', async (orig) => ({
  ...(await orig<object>()),
  signedContentHash: vi.fn(async (_p: unknown, type: string, id: string) => (content.hash == null ? null : { type, documentId: id, patientId: null, canon: 'test', hash: content.hash })),
}));


/**
 * 동의서 전자서명 — 인증서 소유 대조(2026-09-15 M1).
 *
 * 🔴 실측: `signerUserId: data.signerUserId ?? cert.userId` — 본문 DTO 에 signerUserId 가 없어(whitelist 로 지워짐)
 *    항상 **인증서 주인** 이름으로 기록됐다. 직원이 남의 인증서 id 를 넘기면 서명이 그 사람 이름으로 남았다.
 * 목 서명은 웹 서명기와 같은 방식(WebCrypto ECDSA P-256 · P1363)으로 실제로 만든다.
 */
const subtle = webcrypto.subtle;
const HASH = createHash('sha256').update('CONSENT:c1:동의서').digest('hex');
let pem = '';
let sign: (h: string) => Promise<string>;

beforeAll(async () => {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const b64 = Buffer.from(await subtle.exportKey('spki', kp.publicKey)).toString('base64');
  pem = `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`;
  sign = async (h) => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Uint8Array.from(Buffer.from(h, 'hex')))).toString('base64');
});

const mk = (cert: Record<string, unknown>) => {
  const prisma: any = {
    consentForm: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'PENDING', consentType: 'GENERAL', patientId: 'p1', doctorId: 'd1' }),
      update: vi.fn().mockResolvedValue({ id: 'c1', status: 'SIGNED' }),
    },
    blockchainCertificate: { findUnique: vi.fn().mockResolvedValue(cert) },
    signedDocument: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'sd1' }),
      update: vi.fn().mockResolvedValue({ id: 'sd1', completedSigners: 1, requiredSigners: 1, status: 'COMPLETED' }),
    },
    documentSignature: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    blockchainAnchor: { create: vi.fn() },
  };
  // 🔴 (G3) 서명 행 생성과 완료 카운트는 한 트랜잭션 — tx 는 같은 목을 재사용한다
  prisma.$transaction = vi.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  const svc = new ConsentService(prisma);
  vi.spyOn(svc as any, 'finalizeIfComplete').mockResolvedValue({ id: 'c1', status: 'SIGNED' });
  vi.spyOn(svc as any, 'anchorConsentSignature').mockResolvedValue(undefined);
  return { svc, prisma };
};
const CERT = (over: Record<string, unknown> = {}) => ({
  id: 'cert-1', ownerType: 'STAFF', userId: 'staff-1', patientId: null, status: 'ACTIVE',
  expiresAt: new Date('2099-01-01'), algorithm: 'ECDSA-P256', publicKey: pem, ...over,
});
/** A1 — 환자 서명 증거(서명패드 이미지)·서명자 이름은 이제 필수 */
beforeEach(() => { content.hash = HASH; });
const PAD = { patientSignedBy: '환자', patientSignature: 'data:image/png;base64,iVBORw0KGgo=' };
const bs = async () => ({ certificateId: 'cert-1', signatureValue: await sign(HASH), signatureAlgorithm: 'ECDSA-P256', documentHash: HASH });

describe('동의서 전자서명 — 인증서 소유 대조', () => {
  it('🔴 남의 직원 인증서 → 서명 행을 만들지 않는다(실서명이어도)', async () => {
    const { svc, prisma } = mk(CERT({ userId: 'someone-else' }));
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() }, { userId: 'staff-1' });
    expect(prisma.documentSignature.create).not.toHaveBeenCalled();
  });

  it('🔴 호출자 미상(actor 없음) + 직원 인증서 → 기록하지 않는다(인증서 주인으로 대신 적지 않는다)', async () => {
    const { svc, prisma } = mk(CERT());
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() });
    expect(prisma.documentSignature.create).not.toHaveBeenCalled();
  });

  it('🔴 다른 환자의 환자 인증서 → 기록하지 않는다', async () => {
    const { svc, prisma } = mk(CERT({ ownerType: 'PATIENT', userId: null, patientId: 'p-other' }));
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() }, { userId: 'staff-1' });
    expect(prisma.documentSignature.create).not.toHaveBeenCalled();
  });

  it('대조군 — 본인 직원 인증서면 서명자 = 로그인 직원으로 기록', async () => {
    const { svc, prisma } = mk(CERT());
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() }, { userId: 'staff-1' });
    expect(prisma.documentSignature.create).toHaveBeenCalledTimes(1);
    expect(prisma.documentSignature.create.mock.calls[0][0].data).toMatchObject({ signerType: 'STAFF', signerUserId: 'staff-1' });
  });

  it('대조군 — 이 동의서 환자의 인증서면 환자 서명으로 기록', async () => {
    const { svc, prisma } = mk(CERT({ ownerType: 'PATIENT', userId: null, patientId: 'p1' }));
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() }, { userId: 'staff-1' });
    expect(prisma.documentSignature.create.mock.calls[0][0].data).toMatchObject({ signerType: 'PATIENT', signerPatientId: 'p1' });
  });

  it('같은 서명이 이미 있으면(서명 모달이 먼저 기록) 이중 행을 만들지 않는다', async () => {
    const { svc, prisma } = mk(CERT());
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig-existing' });
    await svc.sign('c1', { ...PAD, blockchainSignature: await bs() }, { userId: 'staff-1' });
    expect(prisma.documentSignature.create).not.toHaveBeenCalled();
    expect(prisma.signedDocument.update).not.toHaveBeenCalled();
  });
});
