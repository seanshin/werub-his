import {
  sign as cryptoSign,
  generateKeyPairSync,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type JsonWebKey,
} from 'crypto';
import { deriveAesKey } from './kdf';

// 키 수탁 추상화 — HSM 키 수탁 기획 Phase 1 (docs/01-plan/features/hsm-key-custody.plan.md).
// 목적: 서명·대칭키 획득을 단일 provider 인터페이스 뒤로 모아, 이후 SOFTWARE→KMS/HSM 교체 시
//       호출부(sign-integration·field-encryption 등)를 바꾸지 않게 격리한다.
// Phase 1 기본 = SoftwareKeyCustody(현행 동작 byte-identical). Phase 2/3 에서 provider만 교체.

export type KeyCustodyKind = 'SOFTWARE' | 'KMS' | 'HSM';

/** RS256 키 자료. SOFTWARE 는 privatePem 보관, HSM provider 는 내부 핸들 사용(privatePem 미노출). */
export interface Rs256KeyMaterial {
  kid: string;
  privatePem: string;
  publicJwk: JsonWebKey;
}

export interface KeyCustodyProvider {
  kind(): KeyCustodyKind;
  /** RS256 키쌍 신규 생성(provider 정책에 맞게). */
  generateRs256(): Rs256KeyMaterial;
  /** RS256(RSA-SHA256) 서명 — 개인키는 provider 경계 내에서만 사용, 서명 바이트만 반환. */
  signRs256(key: Rs256KeyMaterial, data: Buffer): Buffer;
  /** 대칭키(AES-256, 32B) 획득 — SOFTWARE=scrypt(secret); 향후 HSM=KEK로 DEK unwrap. */
  getSymmetricKey(secret: string): Buffer;
  /** envelope: DEK 를 KEK 로 wrap(SOFTWARE=마스터 도출 KEK·HSM=하드웨어 KEK). 개인 KEK 비노출. */
  wrapDataKey(dek: Buffer): string;
  /** envelope: wrap된 DEK 를 KEK 로 unwrap. */
  unwrapDataKey(wrapped: string): Buffer;
}

/** 기본 provider — 현행 소프트웨어 암호 연산 그대로(회귀 0). */
export class SoftwareKeyCustody implements KeyCustodyProvider {
  kind(): KeyCustodyKind {
    return 'SOFTWARE';
  }

  generateRs256(): Rs256KeyMaterial {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    // kid = SHA-256(공개 JWK) 앞 16hex — 기존 sign-integration.keypair() 와 동일 산식(호환).
    const kid = createHash('sha256').update(JSON.stringify(publicJwk)).digest('hex').slice(0, 16);
    return { kid, privatePem, publicJwk };
  }

  signRs256(key: Rs256KeyMaterial, data: Buffer): Buffer {
    return cryptoSign('RSA-SHA256', data, key.privatePem);
  }

  getSymmetricKey(secret: string): Buffer {
    return deriveAesKey(secret);
  }

  // KEK — 마스터(ENCRYPTION_KEY)에서 도출. field 키(getSymmetricKey)와 도메인 분리(`:kek`).
  // HSM provider 에선 KEK 가 하드웨어 내부에 상주(이 메서드 미사용).
  private kek(): Buffer {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) throw new Error('ENCRYPTION_KEY 미설정 — KEK 도출 불가');
    return deriveAesKey(`${secret}:kek`);
  }

  wrapDataKey(dek: Buffer): string {
    const iv = randomBytes(16);
    const c = createCipheriv('aes-256-gcm', this.kek(), iv);
    const enc = Buffer.concat([c.update(dek), c.final()]);
    const tag = c.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  unwrapDataKey(wrapped: string): Buffer {
    const [ivHex, tagHex, encHex] = wrapped.split(':');
    const d = createDecipheriv('aes-256-gcm', this.kek(), Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]);
  }
}

// 모듈 싱글톤 — 동기 컨텍스트(field-encryption 모듈 함수)에서도 사용. 부트스트랩에서 setKeyCustody 로 교체.
let provider: KeyCustodyProvider = new SoftwareKeyCustody();

/** 현재 키 수탁 provider. */
export function getKeyCustody(): KeyCustodyProvider {
  return provider;
}

/** provider 교체(Phase 2/3 부트스트랩에서 HSM/KMS 주입). */
export function setKeyCustody(p: KeyCustodyProvider): void {
  provider = p;
}
