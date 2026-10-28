/**
 * 앵커 Merkle 증명·검증 정직성(2026-10-13 결함 발굴 B4).
 *  · 🔴 종전: 정렬한 잎으로 트리를 만들고 증명은 정렬 전 순서에 붙임 · 상위 레벨은 "노드마다 잎 2개" 가정 → 저장된 증명이 루트를 못 만듦
 *  · 🔴 종전: 내부 원장 기록을 CONFIRMED·확정 1·verified:true 로 — 외부 체인에 쓰지 않았다
 *  · 이제: 잎마다 자기 증명(1~9개·홀수 꼬리 포함) · 검증 응답이 기록됨/증명/외부 체인을 따로 말한다
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BlockchainAnchorService, buildMerkleTree, verifyMerkleProof } from '../../src/modules/blockchain-anchor/blockchain-anchor.service';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

describe('🔴 Merkle 증명 — 잎마다 자기 증명이 루트에 닿는다', () => {
  it('잎 1~9개 전부(정렬되지 않은 입력 · 홀수 꼬리)', () => {
    for (let n = 1; n <= 9; n++) {
      const leaves = Array.from({ length: n }, (_, i) => h(`z${n - i}`)); // 일부러 정렬 안 된 순서
      const { root, proofs } = buildMerkleTree(leaves);
      leaves.forEach((leaf, i) => expect(verifyMerkleProof(leaf, proofs[i].path, root), `n=${n} i=${i}`).toBe(true));
    }
  });
  it('대조군 — 남의 증명·다른 잎은 실패한다', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'].map(h);
    const { root, proofs } = buildMerkleTree(leaves);
    expect(verifyMerkleProof(leaves[0], proofs[1].path, root)).toBe(false);
    expect(verifyMerkleProof(h('x'), proofs[0].path, root)).toBe(false);
  });
});

describe('🔴 검증 응답 — 기록됨·증명·외부 체인을 따로', () => {
  const svc = (anchor: unknown) => new BlockchainAnchorService({ blockchainAnchor: { findFirst: vi.fn().mockResolvedValue(anchor) } } as never);
  it('내부 원장 — 기록됨 true · 외부 체인 false · 증명 VALID / 엉뚱한 증명 INVALID', async () => {
    const leaves = ['a', 'b', 'c'].map(h);
    const { root, proofs } = buildMerkleTree(leaves);
    const base = { id: '1', anchorType: 'AUDIT', dataHash: leaves[2], merkleRoot: root, chainType: 'INTERNAL', status: 'ANCHORED', txHash: 'internal-x', blockNumber: null, anchoredAt: new Date() };
    const ok = await svc({ ...base, merkleProof: proofs[2] }).verifyByDataHash(leaves[2]);
    expect(ok).toMatchObject({ verified: true, merkleProof: 'VALID', externalChain: false, chain: 'INTERNAL' });
    expect((await svc({ ...base, merkleProof: proofs[0] }).verifyByDataHash(leaves[2])).merkleProof).toBe('INVALID');
    // 종전 데이터(CONFIRMED·internal)도 외부 체인이라 말하지 않는다
    expect((await svc({ ...base, status: 'CONFIRMED', merkleProof: proofs[2] }).verifyByDataHash(leaves[2])).externalChain).toBe(false);
  });
  it('대조군 — 외부 체인에 확정된 앵커만 externalChain true · 증명 없는 단건 앵커는 NONE', async () => {
    const r = await svc({ id: '1', anchorType: 'X', dataHash: 'd', merkleRoot: null, merkleProof: null, chainType: 'POLYGON', status: 'CONFIRMED', txHash: '0xabc', blockNumber: 1, anchoredAt: new Date() }).verifyByDataHash('d');
    expect(r).toMatchObject({ verified: true, externalChain: true, merkleProof: 'NONE' });
  });
});
