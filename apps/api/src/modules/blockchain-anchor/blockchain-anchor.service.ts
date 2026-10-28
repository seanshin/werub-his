import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class BlockchainAnchorService {
  constructor(private readonly prisma: PrismaService) {}

  /** 앵커 레코드 생성 */
  async createAnchor(data: {
    anchorType: string;
    referenceId: string;
    dataHash: string;
    chainType: string;
  }) {
    return this.prisma.blockchainAnchor.create({
      data: {
        anchorType: data.anchorType,
        referenceId: data.referenceId,
        dataHash: data.dataHash,
        chainType: data.chainType,
        status: 'PENDING',
      },
    });
  }

  /** txHash로 조회 */
  async getByTxHash(txHash: string) {
    const anchor = await this.prisma.blockchainAnchor.findFirst({
      where: { txHash },
    });
    if (!anchor) throw new NotFoundException('앵커를 찾을 수 없습니다');
    return anchor;
  }

  /**
   * dataHash 로 검증 — 🔴 (2026-10-13 결함 발굴 B4) 세 사실을 따로 말한다:
   *  · `verified` = 이 해시가 앵커 원장에 기록돼 있다(ANCHORED·CONFIRMED) — 감사 무결성 검증이 쓰는 뜻
   *  · `merkleProof` = 저장된 증명이 이 해시를 저장된 루트까지 실제로 올리는가(VALID/INVALID/NONE) — 종전 증명은 엉뚱한 잎에 붙어 있었다
   *  · `externalChain` = 외부 블록체인에 확정됐는가 — 내부 원장(internal)은 언제나 false(종전엔 내부 기록을 CONFIRMED·확정 1 로 그렸다)
   */
  async verifyByDataHash(dataHash: string) {
    const anchor = await this.prisma.blockchainAnchor.findFirst({
      where: { dataHash },
    });
    if (!anchor) {
      return { verified: false, message: '해당 해시의 앵커가 없습니다' };
    }
    const internal = !anchor.chainType || anchor.chainType.toLowerCase() === 'internal';
    const proof = anchor.merkleProof as { path?: Array<{ hash: string; direction: 'left' | 'right' }> } | null;
    const merkleProof: 'VALID' | 'INVALID' | 'NONE' = !anchor.merkleRoot || !proof?.path
      ? 'NONE'
      : verifyMerkleProof(anchor.dataHash, proof.path, anchor.merkleRoot) ? 'VALID' : 'INVALID';

    return {
      verified: anchor.status === 'ANCHORED' || anchor.status === 'CONFIRMED',
      merkleProof,
      externalChain: !internal && anchor.status === 'CONFIRMED',
      chain: internal ? 'INTERNAL' : anchor.chainType,
      message: internal ? '내부 원장에 기록된 해시입니다 — 외부 블록체인에는 기록되지 않았습니다' : undefined,
      anchor: {
        id: anchor.id,
        anchorType: anchor.anchorType,
        dataHash: anchor.dataHash,
        merkleRoot: anchor.merkleRoot,
        merkleProof: anchor.merkleProof,
        txHash: anchor.txHash,
        blockNumber: anchor.blockNumber,
        status: anchor.status,
        anchoredAt: anchor.anchoredAt,
      },
    };
  }

  /** 상태별 통계 */
  async getStats() {
    const results = await this.prisma.blockchainAnchor.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    const stats: Record<string, number> = {};
    for (const r of results) {
      stats[r.status] = r._count.id;
    }
    return stats;
  }

  /** 배치 앵커링 — PENDING 수집, Merkle 트리 생성, 내부 원장 기록(ANCHORED) — 외부 체인이 아니므로 CONFIRMED·확정 수를 쓰지 않는다 */
  async batchAnchor() {
    const pendingAnchors = await this.prisma.blockchainAnchor.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    if (pendingAnchors.length === 0) {
      return { anchored: 0, merkleRoot: null };
    }

    // Merkle 트리 구축
    const hashes = pendingAnchors.map((a) => a.dataHash);
    const { root, proofs } = buildMerkleTree(hashes);

    // 내부 txHash 생성 (실제 블록체인 미연동)
    const txHash = `internal-${randomBytes(16).toString('hex')}`;
    const now = new Date();

    // 각 앵커에 자기 잎의 증명(입력 순서 = proofs 순서) · 🔴 내부 원장 — 외부 확정이 아니다(ANCHORED · 확정 수 없음)
    for (let i = 0; i < pendingAnchors.length; i++) {
      await this.prisma.blockchainAnchor.update({
        where: { id: pendingAnchors[i].id },
        data: {
          status: 'ANCHORED',
          merkleRoot: root,
          merkleProof: proofs[i] as never,
          txHash,
          anchoredAt: now,
        },
      });
    }

    return { anchored: pendingAnchors.length, merkleRoot: root, txHash };
  }

  /** QR 코드 데이터 생성 */
  async generateQrCode(signedDocumentId: string) {
    const doc = await this.prisma.signedDocument.findUnique({
      where: { id: signedDocumentId },
    });
    if (!doc) throw new NotFoundException('서명 문서를 찾을 수 없습니다');

    const verificationUrl = `/api/v1/blockchain-anchor/verify/${doc.documentHash}`;

    return {
      signedDocumentId,
      documentHash: doc.documentHash,
      verificationUrl,
      qrData: JSON.stringify({
        type: 'HOSPITAL_RUN_VERIFY',
        hash: doc.documentHash,
        url: verificationUrl,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // ─── Merkle tree helpers ──────────────────────────────────────
}

/**
 * Merkle 트리 — 🔴 (B4) 종전엔 정렬한 잎으로 트리를 만들고 증명은 정렬 **전** 순서에 붙였으며, 상위 레벨은 "노드마다 잎 2개"로 가정해
 * 저장된 증명이 그 앵커의 해시를 루트까지 올리지 못했다. 이제 입력 순서 그대로 · 잎 i 의 위치를 레벨마다 i>>1 로 따라간다.
 * 홀수 꼬리는 자기 자신과 짝(종전 규칙 유지 — 루트 값 호환).
 */
export function buildMerkleTree(hashes: string[]): {
  root: string;
  proofs: Array<{ path: Array<{ hash: string; direction: 'left' | 'right' }> }>;
} {
  if (hashes.length === 0) return { root: '', proofs: [] };
  const proofs: Array<{ path: Array<{ hash: string; direction: 'left' | 'right' }> }> = hashes.map(() => ({ path: [] }));
  const pos = hashes.map((_, i) => i);
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(createHash('sha256').update(left + right).digest('hex'));
    }
    for (let leaf = 0; leaf < hashes.length; leaf++) {
      const p = pos[leaf];
      const isLeft = p % 2 === 0;
      const sibling = isLeft ? (p + 1 < level.length ? level[p + 1] : level[p]) : level[p - 1];
      proofs[leaf].path.push({ hash: sibling, direction: isLeft ? 'right' : 'left' });
      pos[leaf] = p >> 1;
    }
    level = next;
  }
  return { root: level[0], proofs };
}

/** 증명 검증 — 잎에서 시작해 경로대로 올라가 루트와 같은가 */
export function verifyMerkleProof(leaf: string, path: Array<{ hash: string; direction: 'left' | 'right' }>, root: string): boolean {
  let h = leaf;
  for (const step of path) {
    h = createHash('sha256').update(step.direction === 'right' ? h + step.hash : step.hash + h).digest('hex');
  }
  return h === root;
}
