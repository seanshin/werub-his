import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { getKeyCustody } from '../../../common/crypto/key-custody';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {
    // 보안 P0: 하드코딩 기본키 폴백 제거 — 미설정 시 부팅 실패(fail-fast)
    const secret = this.config.get<string>('ENCRYPTION_KEY');
    if (!secret) {
      throw new Error('ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. 운영/배포 환경에서 반드시 .env에 설정하세요.');
    }
    this.key = getKeyCustody().getSymmetricKey(secret);
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encrypted: string): string {
    const [ivHex, authTagHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /** 주민등록번호 마스킹 (720108-1******) */
  maskNationalId(encrypted: string): string {
    try {
      const plain = this.decrypt(encrypted);
      return plain.length >= 7 ? `${plain.slice(0, 6)}-${plain[6]}******` : '******-*******';
    } catch {
      return '******-*******';
    }
  }

  /** 주민번호 유효성 검증 (체크섬) */
  validateNationalId(id: string): boolean {
    const clean = id.replace(/-/g, '');
    if (clean.length !== 13) return false;
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(clean[i]) * weights[i];
    const check = (11 - (sum % 11)) % 10;
    return check === parseInt(clean[12]);
  }
}
