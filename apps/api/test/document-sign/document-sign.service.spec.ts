import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentSignService } from '../../src/modules/document-sign/document-sign.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

/** A2 — 서명 대상 내용 해시(서버 정본)는 원장을 읽는다. 여기선 "지금 내용의 해시"를 테스트가 정한다(null = 문서 없음) */
const content = vi.hoisted(() => ({ hash: null as string | null }));
vi.mock('../../src/modules/document-sign/document-content-hash', async (orig) => ({
  ...(await orig<object>()),
  signedContentHash: vi.fn(async (_p: unknown, type: string, id: string) => (content.hash == null ? null : { type, documentId: id, patientId: null, canon: 'test', hash: content.hash })),
}));


describe('DocumentSignService', () => {
  let service: DocumentSignService;
  let mockPrisma: any;

  const baseCert = {
    id: 'cert-1',
    ownerType: 'STAFF',
    userId: 'user-1',
    patientId: null,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    serialNumber: 'CERT-001',
    fingerprint: 'fp-001',
  };

  const baseSignedDoc = {
    id: 'sdoc-1',
    documentType: 'ENCOUNTER', // 동의서는 서명 사건 원장이 센다(U1) — 일반 경로로 잰다
    documentId: 'doc-1',
    patientId: 'patient-1',
    documentHash: 'hash-abc',
    status: 'PENDING',
    requiredSigners: 1,
    completedSigners: 0,
    timeoutAt: null,
    merkleRoot: null,
    blockchainTxId: null,
    documentVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseSignature = {
    id: 'sig-1',
    signedDocumentId: 'sdoc-1',
    certificateId: 'cert-1',
    signatureValue: 'sig-val-abc',
    signatureAlgorithm: 'RSA-SHA256',
    signedAt: new Date(),
    signerRole: 'DOCTOR',
    signerType: 'STAFF',
    signerUserId: 'user-1',
    signerPatientId: null,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    isValid: true,
  };

  beforeEach(() => {
    content.hash = 'hash-abc';
    mockPrisma = {
      blockchainCertificate: {
        findUnique: vi.fn(),
      },
      signedDocument: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      documentSignature: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      // 🔴 (G3) 서명 행 생성과 완료 카운트는 한 트랜잭션이다 — 목은 **정본의 실제 호출 모양**을 쓴다
      //    (tx 는 같은 목을 재사용 · 저장소 표준 형태)
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };
    service = new DocumentSignService(mockPrisma);
  });

  // ─── sign ─────────────────────────────────────────────────────

  describe('sign', () => {
    const signData = {
      documentType: 'ENCOUNTER', // 동의서는 서명 사건 원장이 센다(U1) — 일반 경로로 잰다
      documentId: 'doc-1',
      patientId: 'patient-1',
      documentHash: 'hash-abc',
      certificateId: 'cert-1',
      signatureValue: 'sig-val',
      signatureAlgorithm: 'RSA-SHA256',
      signerRole: 'DOCTOR',
      signerType: 'STAFF',
      signerUserId: 'user-1',
    };
    const actor = { userId: 'user-1', ipAddress: '10.0.0.1', userAgent: 'vitest' };

    it('🔴 (B7) 직원 서명 — 남의 인증서면 403 · 서명자·증빙은 본문이 아니라 actor', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, userId: 'someone-else' });
      await expect(service.sign(signData, actor)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.documentSignature.create).not.toHaveBeenCalled();

      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, ownerType: 'PATIENT', userId: null, patientId: 'patient-1' });
      await expect(service.sign(signData, actor)).rejects.toThrow(ForbiddenException);

      // 대조군 — 본인 인증서면 서명되고, 본문 signerUserId 가 달라도 기록은 인증 주체
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue(baseSignedDoc);
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, signatures: [] });
      await service.sign({ ...signData, signerUserId: 'forged' } as typeof signData, actor);
      const created = mockPrisma.documentSignature.create.mock.calls[0][0].data;
      expect(created.signerUserId).toBe('user-1');
      expect(created.ipAddress).toBe('10.0.0.1');
      expect(created.userAgent).toBe('vitest');
      expect(created.signerPatientId).toBeNull();
    });

    it('🔴 (B7) 환자 서명(대면) — 그 환자 소유 환자 인증서만 · signerUserId 는 비운다', async () => {
      const patientSign = { ...signData, signerType: 'PATIENT', signerPatientId: 'patient-1' };
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, ownerType: 'PATIENT', userId: null, patientId: 'patient-2' });
      await expect(service.sign(patientSign, actor)).rejects.toThrow(ForbiddenException);
      await expect(service.sign({ ...patientSign, signerPatientId: undefined }, actor)).rejects.toThrow(ForbiddenException);

      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, ownerType: 'PATIENT', userId: null, patientId: 'patient-1' });
      mockPrisma.signedDocument.findFirst.mockResolvedValue(baseSignedDoc);
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, signatures: [] });
      await service.sign(patientSign, actor);
      const created = mockPrisma.documentSignature.create.mock.calls[0][0].data;
      expect(created.signerPatientId).toBe('patient-1');
      expect(created.signerUserId).toBeNull();
    });

    it('서명자 유형이 어휘 밖이면 400', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      await expect(service.sign({ ...signData, signerType: 'ROBOT' }, actor)).rejects.toThrow(BadRequestException);
    });

    it('should create SignedDocument and DocumentSignature', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue(null);
      mockPrisma.signedDocument.create.mockResolvedValue(baseSignedDoc);
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      mockPrisma.signedDocument.update.mockResolvedValue({
        ...baseSignedDoc,
        completedSigners: 1,
        status: 'COMPLETED',
        signatures: [baseSignature],
      });

      const result = await service.sign(signData, actor);

      expect(result.signedDocument).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(mockPrisma.signedDocument.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.documentSignature.create).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException if cert not found', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(null);

      await expect(service.sign(signData, actor)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if cert not ACTIVE', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'SUSPENDED' });

      await expect(service.sign(signData, actor)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if cert expired', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({
        ...baseCert,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(service.sign(signData, actor)).rejects.toThrow(BadRequestException);
    });

    it('should reuse existing SignedDocument for same documentType+documentId', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue(baseSignedDoc);
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      mockPrisma.signedDocument.update.mockResolvedValue({
        ...baseSignedDoc,
        completedSigners: 1,
        status: 'COMPLETED',
        signatures: [baseSignature],
      });

      await service.sign(signData, actor);

      expect(mockPrisma.signedDocument.create).not.toHaveBeenCalled();
    });

    it('should increment completedSigners count', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue(baseSignedDoc);
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, completedSigners: 1 });

      await service.sign(signData, actor);

      const updateArg = mockPrisma.signedDocument.update.mock.calls[0][0].data;
      expect(updateArg.completedSigners).toEqual({ increment: 1 });
    });

    /**
     * 🔴 (G3) 완료 판정은 **증가된 실제 값**으로 한다 — 그래서 update 가 둘로 나뉜다(증가 → 상태).
     *    목은 증가 결과를 돌려주고, 단언은 **상태를 쓰는 호출**을 겨눈다(첫 호출이 아니다).
     */
    const statusUpdateArg = () => {
      const call = mockPrisma.signedDocument.update.mock.calls.find((c: any) => c[0]?.data?.status !== undefined);
      expect(call, '상태를 쓰는 update 호출이 없다').toBeTruthy();
      return call[0].data;
    };

    it('should set COMPLETED when single signer completes (requiredSigners=1)', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 1, completedSigners: 0 });
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      // 증가 결과: 1/1 → COMPLETED
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 1, completedSigners: 1, status: 'COMPLETED', signatures: [] });

      await service.sign(signData, actor);

      expect(statusUpdateArg().status).toBe('COMPLETED');
    });

    it('should stay PENDING when multi-signers not all complete', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 3, completedSigners: 0 });
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      // 증가 결과: 1/3 → PENDING
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 3, completedSigners: 1, status: 'PENDING', signatures: [] });

      await service.sign(signData, actor);

      expect(statusUpdateArg().status).toBe('PENDING');
    });

    /**
     * 🔴 (G3) 동시 서명 — 두 서명자가 같은 옛 값(0)을 읽어도, 증가된 실제 값이 필수 인원을 채우면 COMPLETED 다.
     *    종전 옛값 판정(`signedDoc.completedSigners + 1`)이면 이 상황에서 PENDING 이 나온다(채우고도 미완결).
     */
    it('🔴 동시 서명 — 읽어둔 값은 0이어도 증가 결과가 2/2 면 COMPLETED', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.signedDocument.findFirst.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 2, completedSigners: 0 });
      mockPrisma.documentSignature.create.mockResolvedValue(baseSignature);
      // 먼저 커밋된 서명이 이미 1 을 올려, 이 서명의 증가 결과는 2 다
      mockPrisma.signedDocument.update.mockResolvedValue({ ...baseSignedDoc, requiredSigners: 2, completedSigners: 2, status: 'COMPLETED', signatures: [] });

      await service.sign(signData, actor);

      expect(statusUpdateArg().status).toBe('COMPLETED');
    });
  });

  // ─── verify ───────────────────────────────────────────────────

  describe('verify', () => {
    it('should return allSignaturesValid=true for valid signatures', async () => {
      // 🔴 (2026-09-15 N2) 종전 픽스처는 서명값 'sig-val-abc'·공개키 없음으로 "전부 유효"를 기대했다 —
      //    검증 코드가 없다는 사실을 테스트가 못박고 있었다. 이제 실제 키로 서명한 값만 유효다.
      const { generateKeyPairSync, sign, createHash } = await import('node:crypto');
      const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const hash = createHash('sha256').update('doc').digest('hex');
      mockPrisma.signedDocument.findUnique.mockResolvedValue({
        ...baseSignedDoc,
        documentHash: hash,
        signatures: [{
          ...baseSignature,
          signatureAlgorithm: 'RSA-2048',
          signatureValue: sign('sha256', Buffer.from(hash, 'hex'), kp.privateKey).toString('base64'),
          signedAt: new Date(Date.now() - 1000),
          isValid: true,
          certificate: {
            ...baseCert, status: 'ACTIVE', algorithm: 'RSA-2048', issuedAt: new Date('2026-01-01'), revokedAt: null,
            publicKey: kp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          },
        }],
      });

      const result = await service.verify('sdoc-1');

      expect(result.allSignaturesValid).toBe(true);
      expect(result.signatures).toHaveLength(1);
    });

    it('should detect tampered hash (isValid=false)', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue({
        ...baseSignedDoc,
        signatures: [{
          ...baseSignature,
          isValid: false,
          certificate: { ...baseCert, status: 'ACTIVE' },
        }],
      });

      const result = await service.verify('sdoc-1');

      expect(result.allSignaturesValid).toBe(false);
    });

    it('should detect expired cert at sign time', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue({
        ...baseSignedDoc,
        signatures: [{
          ...baseSignature,
          isValid: true,
          signedAt: new Date('2028-01-01'),
          certificate: { ...baseCert, status: 'REVOKED', expiresAt: new Date('2025-01-01') },
        }],
      });

      const result = await service.verify('sdoc-1');

      expect(result.allSignaturesValid).toBe(false);
    });

    it('should throw NotFoundException when doc not found', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue(null);

      await expect(service.verify('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getSignedDocument ────────────────────────────────────────

  describe('getSignedDocument', () => {
    it('should return document with signatures', async () => {
      const doc = { ...baseSignedDoc, signatures: [baseSignature] };
      mockPrisma.signedDocument.findFirst.mockResolvedValue(doc);

      const result = await service.getSignedDocument('CONSENT', 'doc-1');

      expect(result.id).toBe('sdoc-1');
      expect(result.signatures).toHaveLength(1);
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.signedDocument.findFirst.mockResolvedValue(null);

      await expect(service.getSignedDocument('CONSENT', 'not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getSignHistory ───────────────────────────────────────────

  describe('getSignHistory', () => {
    it('should return signatures by userId', async () => {
      const sigs = [baseSignature];
      mockPrisma.documentSignature.findMany.mockResolvedValue(sigs);

      const result = await service.getSignHistory('user-1');

      expect(result).toHaveLength(1);
      const where = mockPrisma.documentSignature.findMany.mock.calls[0][0].where;
      expect(where.signerUserId).toBe('user-1');
    });

    it('should return signatures by patientId', async () => {
      mockPrisma.documentSignature.findMany.mockResolvedValue([]);

      await service.getSignHistory(undefined, 'patient-1');

      const where = mockPrisma.documentSignature.findMany.mock.calls[0][0].where;
      expect(where.signerPatientId).toBe('patient-1');
    });
  });

  // ─── initMultiSign ────────────────────────────────────────────

  describe('initMultiSign', () => {
    it('should create with requiredSigners and PENDING status', async () => {
      const multiDoc = { ...baseSignedDoc, requiredSigners: 3 };
      mockPrisma.signedDocument.create.mockResolvedValue(multiDoc);

      const result = await service.initMultiSign({
        documentType: 'CONSENT',
        documentId: 'doc-2',
        documentHash: 'hash-xyz',
        requiredSigners: 3,
      });

      expect(result.requiredSigners).toBe(3);
      const createArg = mockPrisma.signedDocument.create.mock.calls[0][0].data;
      expect(createArg.status).toBe('PENDING');
    });

    it('should set timeoutAt based on timeoutMinutes', async () => {
      mockPrisma.signedDocument.create.mockImplementation(({ data }: any) => data);

      const result = await service.initMultiSign({
        documentType: 'CONSENT',
        documentId: 'doc-2',
        documentHash: 'hash-xyz',
        requiredSigners: 2,
        timeoutMinutes: 60,
      });

      expect(result.timeoutAt).toBeInstanceOf(Date);
      const diff = result.timeoutAt.getTime() - Date.now();
      // Should be ~60 minutes (allow 5 second tolerance)
      expect(diff).toBeGreaterThan(59 * 60 * 1000);
      expect(diff).toBeLessThan(61 * 60 * 1000);
    });

    it('should reject if requiredSigners < 2', async () => {
      await expect(
        service.initMultiSign({
          documentType: 'CONSENT',
          documentId: 'doc-2',
          documentHash: 'hash-xyz',
          requiredSigners: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getMultiSignStatus ───────────────────────────────────────

  describe('getMultiSignStatus', () => {
    it('should return status with remaining count and isTimedOut', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue({
        ...baseSignedDoc,
        requiredSigners: 3,
        completedSigners: 1,
        timeoutAt: new Date(Date.now() + 60 * 60 * 1000),
        signatures: [{ id: 'sig-1', signerRole: 'DOCTOR', signedAt: new Date() }],
      });

      const result = await service.getMultiSignStatus('sdoc-1');

      expect(result.remaining).toBe(2);
      expect(result.isTimedOut).toBe(false);
      expect(result.signatures).toHaveLength(1);
    });
  });

  // ─── getEnvelope ──────────────────────────────────────────────

  describe('getEnvelope', () => {
    it('should return envelope bundle', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue({
        ...baseSignedDoc,
        patient: { id: 'p1', familyName: '김', givenName: '환자', mrn: 'MRN-001' },
        signatures: [{
          signatureValue: 'sig-val',
          signatureAlgorithm: 'RSA-SHA256',
          signedAt: new Date(),
          signerRole: 'DOCTOR',
          certificate: {
            id: 'cert-1',
            serialNumber: 'CERT-001',
            subjectDn: 'CN=김의사',
            publicKey: 'pk',
            algorithm: 'RSA-2048',
            fingerprint: 'fp',
            issuedAt: new Date(),
            expiresAt: new Date(),
          },
        }],
      });

      const result = await service.getEnvelope('sdoc-1');

      expect(result.envelope).toBeDefined();
      expect(result.envelope.documentHash).toBe('hash-abc');
      expect(result.envelope.signatures).toHaveLength(1);
      expect(result.envelope.patient).toBeDefined();
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue(null);

      await expect(service.getEnvelope('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── checkTimeouts ────────────────────────────────────────────

  describe('checkTimeouts', () => {
    it('should mark expired multi-sign docs as VOIDED', async () => {
      const expired = [
        { id: 'sdoc-1' },
        { id: 'sdoc-2' },
      ];
      mockPrisma.signedDocument.findMany.mockResolvedValue(expired);
      mockPrisma.signedDocument.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.checkTimeouts();

      expect(result.voided).toBe(2);
      expect(result.ids).toEqual(['sdoc-1', 'sdoc-2']);
      expect(mockPrisma.signedDocument.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sdoc-1', 'sdoc-2'] } },
        data: { status: 'VOIDED' },
      });
    });

    it('should return voided=0 when no expired docs', async () => {
      mockPrisma.signedDocument.findMany.mockResolvedValue([]);

      const result = await service.checkTimeouts();

      expect(result.voided).toBe(0);
      expect(mockPrisma.signedDocument.updateMany).not.toHaveBeenCalled();
    });
  });
});
