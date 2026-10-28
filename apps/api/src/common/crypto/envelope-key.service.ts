import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { getKeyCustody } from './key-custody';

// 봉투 암호화(envelope) DEK 관리 — HSM 기획 Phase 3.
// DEK(데이터 암호화 키)를 KEK(provider 수탁)로 wrap 해 EncryptionKeyRegistry 에 보관.
// KEK 회전 = DEK 재-wrap만(전 PHI 재암호화 불필요), DEK 회전 = 신규 ACTIVE 발급.
// ⚠️ 현재는 키 관리 계층만 — field-encryption 소비(활성화)는 HSM 도입 + PHI 백필 게이트 후.
//    (활성화 시: 신규 암호화는 ACTIVE DEK·keyId 를 ciphertext 에 기록, 복호는 keyId 의 DEK 사용,
//     레거시 ENCRYPTION_KEY 직접 암호문은 기존 경로로 폴백 — field-encryption 멱등 전략 동일.)

@Injectable()
export class EnvelopeKeyService {
  private readonly logger = new Logger(EnvelopeKeyService.name);
  private readonly cache = new Map<string, Buffer>(); // keyId → 평문 DEK(메모리 일시)

  constructor(private readonly prisma: PrismaService) {}

  private unwrapCached(keyId: string, wrapped: string): Buffer {
    let dek = this.cache.get(keyId);
    if (!dek) {
      dek = getKeyCustody().unwrapDataKey(wrapped);
      this.cache.set(keyId, dek);
    }
    return dek;
  }

  /** 현재 ACTIVE DEK — 없으면 생성. 신규 암호화에 사용. */
  async ensureActiveDek(): Promise<{ keyId: string; dek: Buffer }> {
    const active = await this.prisma.encryptionKeyRegistry.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return { keyId: active.keyId, dek: this.unwrapCached(active.keyId, active.wrappedDek) };
    return this.generateDek();
  }

  /** keyId 의 DEK 획득(복호용). 캐시 우선. */
  async getDek(keyId: string): Promise<Buffer> {
    const cached = this.cache.get(keyId);
    if (cached) return cached;
    const row = await this.prisma.encryptionKeyRegistry.findUnique({ where: { keyId } });
    if (!row) throw new Error(`envelope DEK 없음: ${keyId}`);
    return this.unwrapCached(keyId, row.wrappedDek);
  }

  private async generateDek(): Promise<{ keyId: string; dek: Buffer }> {
    const dek = randomBytes(32); // AES-256 DEK
    const keyId = randomBytes(8).toString('hex'); // 16hex
    const wrappedDek = getKeyCustody().wrapDataKey(dek);
    await this.prisma.encryptionKeyRegistry.create({
      data: { keyId, wrappedDek, kekKind: getKeyCustody().kind(), status: 'ACTIVE' },
    });
    this.cache.set(keyId, dek);
    this.logger.log(`envelope DEK 생성 keyId=${keyId} kek=${getKeyCustody().kind()}`);
    return { keyId, dek };
  }

  /** DEK 회전 — 현 ACTIVE 은퇴(RETIRED), 새 ACTIVE 발급. 기존 데이터는 자기 keyId DEK 로 계속 복호. */
  async rotateDek(): Promise<{ keyId: string }> {
    await this.prisma.encryptionKeyRegistry.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'RETIRED', retiredAt: new Date() },
    });
    const { keyId } = await this.generateDek();
    this.logger.warn(`envelope DEK 회전 — 새 ACTIVE keyId=${keyId}`);
    return { keyId };
  }

  /** 봉투 암호화 준비 상태(DRY-RUN). field-encryption 미연동(consumed=false) = 활성화 게이트 전. */
  async status() {
    const [active, total, retired] = await Promise.all([
      this.prisma.encryptionKeyRegistry.findFirst({
        where: { status: 'ACTIVE' },
        select: { keyId: true, kekKind: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.encryptionKeyRegistry.count(),
      this.prisma.encryptionKeyRegistry.count({ where: { status: 'RETIRED' } }),
    ]);
    return {
      kekKind: getKeyCustody().kind(),
      activeKeyId: active?.keyId ?? null,
      totalDeks: total,
      retiredDeks: retired,
      consumed: false, // field-encryption 미연동 — 활성화는 HSM 도입+백필 게이트 후
    };
  }
}
