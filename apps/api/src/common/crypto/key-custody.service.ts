import { Injectable, Logger } from '@nestjs/common';
import { type JsonWebKey } from 'crypto';
import { ConfigRuntimeService } from '../../modules/config/config-runtime.service';
import { getKeyCustody, type Rs256KeyMaterial } from './key-custody';
import { decryptField, encryptField, isEncrypted } from './field-encryption';

// 비대칭(RS256) 키 라이프사이클을 provider 경계 안으로 이동 — HSM 기획 Phase 1.
// 호출부(sign-integration)는 개인키 PEM 을 직접 다루지 않고 keyRef 로 서명/공개키만 요청한다.
// SOFTWARE: 키쌍을 config-runtime(SystemConfig)에 보관(현행 sign-integration.keypair() 와 동일 키·동작).
// HSM(Phase 2): ensureRs256 내부만 교체 → 호출부 무변경.
//
// keyRef 규약: config 키 = `${keyRef}Kid` · `${keyRef}PrivateSecret` · `${keyRef}PublicJwk`.
//   예) keyRef='sign.jwks' → sign.jwksKid / sign.jwksPrivateSecret / sign.jwksPublicJwk (기존 키 재사용).

@Injectable()
export class KeyCustodyService {
  private readonly logger = new Logger(KeyCustodyService.name);
  /** 평문 보관 경고는 한 번만(부팅 로그를 덮지 않게) */
  private warnedPlaintext = false;

  constructor(private readonly config: ConfigRuntimeService) {}

  /**
   * 🔴 개인키는 **저장 시 암호화한다**.
   *
   * 종전엔 `sign.jwksPrivateSecret` 에 **평문 PEM** 이 들어갔다. `system_configs` 를 읽을 수 있는 사람이나
   * DB 백업을 가진 사람이 **직원 서명 토큰(aud=sign)을 위조**할 수 있는 구조였다(상대 팀이 따라가기 DB 조회로 확인).
   * ENCRYPTION_KEY 가 있으면 AES-256-GCM 으로 감싸고(`field-encryption`), 없으면 **종전대로 저장하되 경고**한다
   * (없다고 서명을 멈추면 설치가 죽는다 — 다만 조용히 넘어가지는 않는다).
   *
   * 🔴 키를 바꿔 끼우는 경우: `scripts/rotate-encryption-key.mjs` 가 `system_configs` 의 `*PrivateSecret` 도
   *    함께 다시 감싼다. 감싸기를 풀지 못하면 **여기서 분명히 실패한다** — `decryptField` 는 실패 시 원본을
   *    돌려주므로(정본 주석), 그 값을 PEM 이라고 서명기에 넘기면 "키가 바뀌었다"가 서명 오류로 둔갑한다.
   */
  private encryptionKeyPresent(): boolean {
    return typeof process.env.ENCRYPTION_KEY === 'string' && process.env.ENCRYPTION_KEY.trim() !== '';
  }

  /** 저장값 → PEM. 감싸져 있으면 풀고, 풀리지 않으면 **던진다**(조용한 통과 금지). */
  private unwrapPrivatePem(keyRef: string, stored: string): string {
    if (!isEncrypted(stored)) return stored; // 레거시 평문
    const plain = decryptField(stored);
    if (typeof plain !== 'string' || plain === stored || !plain.includes('PRIVATE KEY')) {
      // 🔴 값(keyRef)은 로그로 내려보내고 문장은 조립하지 않는다(가드 `server-composed-display-text`).
      this.logger.error(`개인키 복호 실패 keyRef=${keyRef} custody=${getKeyCustody().kind()}`);
      throw new Error('개인키를 ENCRYPTION_KEY 로 풀지 못했다 — 키가 바뀌었는지 확인하라(scripts/rotate-encryption-key.mjs).');
    }
    return plain;
  }

  /** PEM → 저장값. ENCRYPTION_KEY 가 있으면 감싸고, 없으면 평문 + 경고. */
  private wrapPrivatePem(pem: string): string {
    if (!this.encryptionKeyPresent()) {
      if (!this.warnedPlaintext) {
        this.warnedPlaintext = true;
        this.logger.warn('ENCRYPTION_KEY 미설정 — RS256 개인키를 평문으로 보관한다(설정 테이블·DB 백업을 가진 사람이 직원 토큰을 위조할 수 있다)');
      }
      return pem;
    }
    return encryptField(pem) as string;
  }

  kind() {
    return getKeyCustody().kind();
  }

  /** keyRef 의 RS256 키를 보장(없으면 생성·persist). 개인키는 외부로 반환하지 않는 내부 헬퍼. */
  private async ensureRs256(keyRef: string): Promise<Rs256KeyMaterial> {
    const kid = (await this.config.get(`${keyRef}Kid`)) as string | undefined;
    const privatePem = (await this.config.get(`${keyRef}PrivateSecret`)) as string | undefined;
    const publicJwkRaw = (await this.config.get(`${keyRef}PublicJwk`)) as JsonWebKey | string | undefined;
    if (kid && privatePem && publicJwkRaw) {
      const publicJwk = typeof publicJwkRaw === 'string' ? JSON.parse(publicJwkRaw) : publicJwkRaw;
      const pem = this.unwrapPrivatePem(keyRef, privatePem);
      // 평문으로 있던 키는 **그 자리에서 감싼다**(R15) — 마이그레이션 스크립트를 따로 돌리지 않아도 올라온다.
      if (!isEncrypted(privatePem) && this.encryptionKeyPresent()) {
        await this.config.set(`${keyRef}PrivateSecret`, this.wrapPrivatePem(pem));
        this.logger.warn(`RS256 개인키를 암호화 보관으로 전환(keyRef=${keyRef} kid=${kid})`);
      }
      return { kid, privatePem: pem, publicJwk };
    }
    const key = getKeyCustody().generateRs256();
    await this.config.set(`${keyRef}Kid`, key.kid);
    await this.config.set(`${keyRef}PrivateSecret`, this.wrapPrivatePem(key.privatePem));
    await this.config.set(`${keyRef}PublicJwk`, key.publicJwk as unknown as Record<string, unknown>);
    this.logger.log(`RS256 키쌍 생성(keyRef=${keyRef} kid=${key.kid} custody=${getKeyCustody().kind()})`);
    return key;
  }

  /** keyRef 의 kid (JWT 헤더용). */
  async kid(keyRef: string): Promise<string> {
    return (await this.ensureRs256(keyRef)).kid;
  }

  /** keyRef 의 공개 JWKS(검증용). 개인키 미노출. 회전 윈도우 중에는 직전 키도 함께 게시(무중단). */
  async publicJwks(keyRef: string): Promise<{ keys: Array<Record<string, unknown>> }> {
    const { kid, publicJwk } = await this.ensureRs256(keyRef);
    const keys: Array<Record<string, unknown>> = [
      { ...(publicJwk as unknown as Record<string, unknown>), kid, use: 'sig', alg: 'RS256' },
    ];
    // 직전 키(회전 윈도우) — 아직 만료 안 된 구키 서명 JWT 검증용. 개인키는 보관하지 않음.
    const prevKid = (await this.config.get(`${keyRef}PrevKid`)) as string | undefined;
    const prevPubRaw = (await this.config.get(`${keyRef}PrevPublicJwk`)) as JsonWebKey | string | undefined;
    if (prevKid && prevPubRaw) {
      const prevPub = typeof prevPubRaw === 'string' ? JSON.parse(prevPubRaw) : prevPubRaw;
      keys.push({ ...(prevPub as Record<string, unknown>), kid: prevKid, use: 'sig', alg: 'RS256' });
    }
    return { keys };
  }

  /**
   * RS256 키 무중단 회전 — HSM 기획 Phase 2.
   * 현재 키를 직전(prev)으로 보존(JWKS 양키 게시 → 구키 서명 JWT 검증 유지), 새 키를 current 로.
   * 서명은 항상 current(새 키)로만. 구키 만료(staff-token TTL 10분) 경과 후 dropPreviousRs256 로 정리.
   * provider 무관(SOFTWARE 현재·HSM 도입 시 generateRs256 만 HSM 내부 생성으로 교체).
   */
  async rotateRs256(keyRef: string): Promise<{ newKid: string; prevKid: string }> {
    const cur = await this.ensureRs256(keyRef);
    // 현재 공개키를 prev 슬롯에 보존(개인키 불필요 — 검증만)
    await this.config.set(`${keyRef}PrevKid`, cur.kid);
    await this.config.set(`${keyRef}PrevPublicJwk`, cur.publicJwk as unknown as Record<string, unknown>);
    // 새 키 생성·current 교체
    const next = getKeyCustody().generateRs256();
    await this.config.set(`${keyRef}Kid`, next.kid);
    await this.config.set(`${keyRef}PrivateSecret`, this.wrapPrivatePem(next.privatePem));
    await this.config.set(`${keyRef}PublicJwk`, next.publicJwk as unknown as Record<string, unknown>);
    this.logger.warn(
      `RS256 키 회전(keyRef=${keyRef}) new=${next.kid} prev=${cur.kid} custody=${getKeyCustody().kind()} — JWKS 양키 게시. 윈도우(≥10분) 후 dropPreviousRs256 권장.`,
    );
    return { newKid: next.kid, prevKid: cur.kid };
  }

  /** 회전 윈도우 종료 — 직전 키를 JWKS 에서 제거. */
  async dropPreviousRs256(keyRef: string): Promise<{ dropped: string | null }> {
    const prevKid = (await this.config.get(`${keyRef}PrevKid`)) as string | undefined;
    await this.config.set(`${keyRef}PrevKid`, null);
    await this.config.set(`${keyRef}PrevPublicJwk`, null);
    this.logger.log(`RS256 직전 키 제거(keyRef=${keyRef}) dropped=${prevKid ?? '-'}`);
    return { dropped: prevKid ?? null };
  }

  /** RS256 서명 — 개인키는 provider 경계 내에서만 사용, 서명 바이트 반환. */
  async signRs256(keyRef: string, data: Buffer): Promise<Buffer> {
    const key = await this.ensureRs256(keyRef);
    return getKeyCustody().signRs256(key, data);
  }
}
