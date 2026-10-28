import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getKeyCustody } from '../../common/crypto/key-custody';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

// Atomic Draft Caching (terminal-zero-trust 설계 §6.4 / D2)
// 전환·이탈·잠금 시 작성 중 스냅샷을 Redis에 암호화 저장 → 교대 중 데이터 유실 방어.
// PHI 격리(§6.4.1): 암호화·짧은 TTL·소유자 전용. (encryption.service AES-256-GCM 패턴 동일)

@Injectable()
export class TerminalDraftService {
  private readonly key: Buffer;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly configRuntime: ConfigRuntimeService,
  ) {
    const secret = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = getKeyCustody().getSymmetricKey(secret);
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }
  private decrypt(payload: string): string {
    const [ivHex, tagHex, encHex] = payload.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  }

  // 작성 중 스냅샷 저장(소유자 전용, 암호화, 짧은 TTL)
  async save(userId: string, snapshot: unknown): Promise<{ savedAt: string }> {
    const ttl = Number((await this.configRuntime.get('terminal.draft.ttlSec')) ?? 1800);
    await this.redis.set(`draft:${userId}`, this.encrypt(JSON.stringify(snapshot)), 'EX', ttl);
    return { savedAt: new Date().toISOString() };
  }

  // 복원(본인만) — 평문은 메모리에서만, 복원 후 즉시 사용
  async restore(userId: string): Promise<unknown | null> {
    const raw = await this.redis.get(`draft:${userId}`);
    if (!raw) return null;
    try {
      return JSON.parse(this.decrypt(raw));
    } catch {
      return null;
    }
  }

  async clear(userId: string): Promise<void> {
    await this.redis.del(`draft:${userId}`);
  }
}
