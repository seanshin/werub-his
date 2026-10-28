import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainAnchorController } from '../../src/modules/blockchain-anchor/blockchain-anchor.controller';

describe('BlockchainAnchorController', () => {
  let controller: BlockchainAnchorController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getStats: vi.fn(),
      verifyByDataHash: vi.fn(),
      getByTxHash: vi.fn(),
      batchAnchor: vi.fn(),
      generateQrCode: vi.fn(),
    };
    controller = new BlockchainAnchorController(mockService);
  });

  it('getStats should return { data: result }', async () => {
    const stats = { PENDING: 5, CONFIRMED: 20 };
    mockService.getStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(result).toEqual({ data: stats });
  });

  it('verifyByDataHash should return { data: result }', async () => {
    const verifyResult = { verified: true, anchor: { id: 'a1', status: 'CONFIRMED' } };
    mockService.verifyByDataHash.mockResolvedValue(verifyResult);

    const result = await controller.verifyByDataHash('datahash-abc');

    expect(result).toEqual({ data: verifyResult });
    expect(mockService.verifyByDataHash).toHaveBeenCalledWith('datahash-abc');
  });

  it('getByTxHash should return { data: result }', async () => {
    const anchor = { id: 'a1', txHash: 'tx-123' };
    mockService.getByTxHash.mockResolvedValue(anchor);

    const result = await controller.getByTxHash('tx-123');

    expect(result).toEqual({ data: anchor });
    expect(mockService.getByTxHash).toHaveBeenCalledWith('tx-123');
  });

  it('batchAnchor should return { data: result }', async () => {
    const batchResult = { anchored: 5, merkleRoot: 'root-abc', txHash: 'tx-456' };
    mockService.batchAnchor.mockResolvedValue(batchResult);

    const result = await controller.batchAnchor();

    expect(result).toEqual({ data: batchResult });
  });

  it('generateQrCode should return { data: result }', async () => {
    const qrResult = { signedDocumentId: 'sdoc-1', qrData: '{}' };
    mockService.generateQrCode.mockResolvedValue(qrResult);

    const result = await controller.generateQrCode('sdoc-1');

    expect(result).toEqual({ data: qrResult });
    expect(mockService.generateQrCode).toHaveBeenCalledWith('sdoc-1');
  });
});
