import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainAnchorService } from '../../src/modules/blockchain-anchor/blockchain-anchor.service';
import { NotFoundException } from '@nestjs/common';

describe('BlockchainAnchorService', () => {
  let service: BlockchainAnchorService;
  let mockPrisma: any;

  const baseAnchor = {
    id: 'anchor-1',
    anchorType: 'DOCUMENT',
    referenceId: 'ref-1',
    dataHash: 'datahash-abc',
    chainType: 'INTERNAL',
    status: 'PENDING',
    merkleRoot: null,
    merkleProof: null,
    txHash: null,
    blockNumber: null,
    anchoredAt: null,
    confirmations: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseSignedDoc = {
    id: 'sdoc-1',
    documentHash: 'doc-hash-xyz',
    documentType: 'CONSENT',
    documentId: 'doc-1',
  };

  beforeEach(() => {
    mockPrisma = {
      blockchainAnchor: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
      },
      signedDocument: {
        findUnique: vi.fn(),
      },
    };
    service = new BlockchainAnchorService(mockPrisma);
  });

  // ─── createAnchor ─────────────────────────────────────────────

  describe('createAnchor', () => {
    it('should create anchor with PENDING status', async () => {
      mockPrisma.blockchainAnchor.create.mockResolvedValue(baseAnchor);

      const result = await service.createAnchor({
        anchorType: 'DOCUMENT',
        referenceId: 'ref-1',
        dataHash: 'datahash-abc',
        chainType: 'INTERNAL',
      });

      expect(result.status).toBe('PENDING');
      const createArg = mockPrisma.blockchainAnchor.create.mock.calls[0][0].data;
      expect(createArg.status).toBe('PENDING');
    });

    it('should pass all fields to prisma create', async () => {
      mockPrisma.blockchainAnchor.create.mockResolvedValue(baseAnchor);

      await service.createAnchor({
        anchorType: 'SIGNATURE',
        referenceId: 'ref-2',
        dataHash: 'datahash-def',
        chainType: 'ETHEREUM',
      });

      const createArg = mockPrisma.blockchainAnchor.create.mock.calls[0][0].data;
      expect(createArg.anchorType).toBe('SIGNATURE');
      expect(createArg.referenceId).toBe('ref-2');
      expect(createArg.dataHash).toBe('datahash-def');
      expect(createArg.chainType).toBe('ETHEREUM');
    });
  });

  // ─── getByTxHash ──────────────────────────────────────────────

  describe('getByTxHash', () => {
    it('should return anchor when found', async () => {
      const anchor = { ...baseAnchor, txHash: 'tx-123', status: 'CONFIRMED' };
      mockPrisma.blockchainAnchor.findFirst.mockResolvedValue(anchor);

      const result = await service.getByTxHash('tx-123');

      expect(result.txHash).toBe('tx-123');
      expect(mockPrisma.blockchainAnchor.findFirst).toHaveBeenCalledWith({ where: { txHash: 'tx-123' } });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.blockchainAnchor.findFirst.mockResolvedValue(null);

      await expect(service.getByTxHash('tx-unknown')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── verifyByDataHash ─────────────────────────────────────────

  describe('verifyByDataHash', () => {
    it('should return verified=true for CONFIRMED anchor', async () => {
      mockPrisma.blockchainAnchor.findFirst.mockResolvedValue({
        ...baseAnchor,
        status: 'CONFIRMED',
        merkleRoot: 'root-abc',
        txHash: 'tx-123',
      });

      const result = await service.verifyByDataHash('datahash-abc');

      expect(result.verified).toBe(true);
      expect(result.anchor).toBeDefined();
      expect(result.anchor!.status).toBe('CONFIRMED');
    });

    it('should return verified=false for PENDING anchor', async () => {
      mockPrisma.blockchainAnchor.findFirst.mockResolvedValue({
        ...baseAnchor,
        status: 'PENDING',
      });

      const result = await service.verifyByDataHash('datahash-abc');

      expect(result.verified).toBe(false);
      expect(result.anchor).toBeDefined();
    });

    it('should return verified=false when not found', async () => {
      mockPrisma.blockchainAnchor.findFirst.mockResolvedValue(null);

      const result = await service.verifyByDataHash('unknown-hash');

      expect(result.verified).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  // ─── getStats ─────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return grouped stats by status', async () => {
      mockPrisma.blockchainAnchor.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: { id: 5 } },
        { status: 'CONFIRMED', _count: { id: 20 } },
      ]);

      const result = await service.getStats();

      expect(result).toEqual({ PENDING: 5, CONFIRMED: 20 });
    });
  });

  // ─── batchAnchor ──────────────────────────────────────────────

  describe('batchAnchor', () => {
    it('should process PENDING anchors and mark as CONFIRMED', async () => {
      const pendingAnchors = [
        { ...baseAnchor, id: 'a1', dataHash: 'hash-1' },
        { ...baseAnchor, id: 'a2', dataHash: 'hash-2' },
      ];
      mockPrisma.blockchainAnchor.findMany.mockResolvedValue(pendingAnchors);
      mockPrisma.blockchainAnchor.update.mockResolvedValue({});

      const result = await service.batchAnchor();

      expect(result.anchored).toBe(2);
      expect(result.merkleRoot).toBeDefined();
      expect(result.txHash).toMatch(/^internal-/);
    });

    it('should assign merkle proofs to each anchor', async () => {
      const pendingAnchors = [
        { ...baseAnchor, id: 'a1', dataHash: 'hash-a' },
        { ...baseAnchor, id: 'a2', dataHash: 'hash-b' },
        { ...baseAnchor, id: 'a3', dataHash: 'hash-c' },
      ];
      mockPrisma.blockchainAnchor.findMany.mockResolvedValue(pendingAnchors);
      mockPrisma.blockchainAnchor.update.mockResolvedValue({});

      await service.batchAnchor();

      // Should update each anchor with merkle data
      expect(mockPrisma.blockchainAnchor.update).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) {
        const updateArg = mockPrisma.blockchainAnchor.update.mock.calls[i][0].data;
        // 🔴 (B4) 내부 원장 — 외부 확정(CONFIRMED)·확정 수를 지어내지 않는다
        expect(updateArg.status).toBe('ANCHORED');
        expect(updateArg.merkleRoot).toBeDefined();
        expect(updateArg.merkleProof).toBeDefined();
        expect(updateArg.txHash).toBeDefined();
        expect(updateArg.anchoredAt).toBeInstanceOf(Date);
        expect(updateArg.confirmations).toBeUndefined();
      }
    });

    it('should set all anchors to same merkleRoot and txHash', async () => {
      const pendingAnchors = [
        { ...baseAnchor, id: 'a1', dataHash: 'hash-x' },
        { ...baseAnchor, id: 'a2', dataHash: 'hash-y' },
      ];
      mockPrisma.blockchainAnchor.findMany.mockResolvedValue(pendingAnchors);
      mockPrisma.blockchainAnchor.update.mockResolvedValue({});

      await service.batchAnchor();

      const root1 = mockPrisma.blockchainAnchor.update.mock.calls[0][0].data.merkleRoot;
      const root2 = mockPrisma.blockchainAnchor.update.mock.calls[1][0].data.merkleRoot;
      const tx1 = mockPrisma.blockchainAnchor.update.mock.calls[0][0].data.txHash;
      const tx2 = mockPrisma.blockchainAnchor.update.mock.calls[1][0].data.txHash;
      expect(root1).toBe(root2);
      expect(tx1).toBe(tx2);
    });

    it('should return anchored=0 when no pending anchors', async () => {
      mockPrisma.blockchainAnchor.findMany.mockResolvedValue([]);

      const result = await service.batchAnchor();

      expect(result.anchored).toBe(0);
      expect(result.merkleRoot).toBeNull();
      expect(mockPrisma.blockchainAnchor.update).not.toHaveBeenCalled();
    });
  });

  // ─── generateQrCode ───────────────────────────────────────────

  describe('generateQrCode', () => {
    it('should create verification URL and qrData', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue(baseSignedDoc);

      const result = await service.generateQrCode('sdoc-1');

      expect(result.signedDocumentId).toBe('sdoc-1');
      expect(result.documentHash).toBe('doc-hash-xyz');
      expect(result.verificationUrl).toContain('/api/v1/blockchain-anchor/verify/');
      expect(result.qrData).toBeDefined();
      const qrParsed = JSON.parse(result.qrData);
      expect(qrParsed.type).toBe('HOSPITAL_RUN_VERIFY');
      expect(qrParsed.hash).toBe('doc-hash-xyz');
    });

    it('should throw NotFoundException when signed document not found', async () => {
      mockPrisma.signedDocument.findUnique.mockResolvedValue(null);

      await expect(service.generateQrCode('not-exist')).rejects.toThrow(NotFoundException);
    });
  });
});
