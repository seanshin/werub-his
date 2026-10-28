import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';

const FRESHNESS_MS = 5 * 60 * 1000; // ±5분

/**
 * ERP 연동 인증 — 키 클래스 분리(S-1).
 * 단일 erp.integrationKey가 쓰기 웹훅 + PII 조회를 동시 인증하던 폭발반경을 축소.
 *  - 쓰기 웹훅/콜백 = erp.integrationKey (기존)
 *  - PII 조회(급여/직원/환자 청구) = erp.piiReadKey (신규, 전용)
 *
 * 무중단 마이그레이션: erp.piiReadKey 미설정이거나 erp.piiReadStrict 미설정 시
 * 레거시 erp.integrationKey 도 PII 조회에 허용(ERP가 새 키 채택 전). ERP 채택 후
 * erp.piiReadStrict=true 로 플립하면 PII 조회는 piiReadKey 만 허용.
 */
@Injectable()
export class IntegrationAuthService {
  constructor(private readonly config: ConfigRuntimeService) {}

  /** 쓰기 웹훅/콜백 — erp.integrationKey */
  async assertWebhookKey(key?: string): Promise<void> {
    const expected = (await this.config.get('erp.integrationKey')) as string | undefined;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  /** e-sign #6 — ERP 계약 서명 발의 전용 키(erp.signOriginationKey). 신규 인바운드라 레거시 폴백 없음(strict). */
  async assertSignOriginationKey(key?: string): Promise<void> {
    const expected = (await this.config.get('erp.signOriginationKey')) as string | undefined;
    if (!expected) throw new UnauthorizedException('서명 발의 키 미구성');
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('서명 발의 키가 올바르지 않습니다');
  }

  /** edu(교육/SQE) 서비스 전용 키(edu.integrationKey). 미구성 시 fail-closed(활성화=운영 시크릿 주입). */
  async assertEduKey(key?: string): Promise<void> {
    const expected = (await this.config.get('edu.integrationKey')) as string | undefined;
    if (!expected) throw new UnauthorizedException('edu 연동 키 미구성');
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('edu 연동 키가 올바르지 않습니다');
  }

  /** 119/이송기관 사전통보 수신 키(emergency.emsKey). 신규 인바운드 — 미구성 시 fail-closed. */
  async assertEmsKey(key?: string): Promise<void> {
    const expected = (await this.config.get('emergency.emsKey')) as string | undefined;
    if (!expected) throw new UnauthorizedException('EMS 연동 키 미구성');
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('EMS 연동 키가 올바르지 않습니다');
  }

  /** LIS 서비스계정 read-only 참조 키(lis.integrationKey). 결재참조·수혈동의 조회 전용. 미구성 시 fail-closed. */
  async assertLisKey(key?: string): Promise<void> {
    const expected = (await this.config.get('lis.integrationKey')) as string | undefined;
    if (!expected) throw new UnauthorizedException('LIS 연동 키 미구성');
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('LIS 연동 키가 올바르지 않습니다');
  }

  /** PACS(OpenPACS) 웹훅 수신 키(pacs.webhookSecret · env PACS_WEBHOOK_SECRET 폴백). 미구성 시 fail-closed. */
  async assertPacsWebhookKey(key?: string): Promise<void> {
    const cfg = (await this.config.get('pacs.webhookSecret')) as string | undefined;
    const expected = cfg || process.env.PACS_WEBHOOK_SECRET;
    if (!expected) throw new UnauthorizedException('PACS 웹훅 키 미구성');
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('PACS 웹훅 키가 올바르지 않습니다');
  }

  /** PII 조회 전용 — erp.piiReadKey(+레거시 폴백, strict 아닐 때) */
  async assertPiiReadKey(key?: string): Promise<void> {
    const [pii, main, strictRaw] = await Promise.all([
      this.config.get('erp.piiReadKey') as Promise<string | undefined>,
      this.config.get('erp.integrationKey') as Promise<string | undefined>,
      this.config.get('erp.piiReadStrict') as Promise<unknown>,
    ]);
    const strict = strictRaw === true || strictRaw === 'true';
    if (pii && secureKeyEqual(key, pii)) return;            // 전용 PII 키
    if (!strict && main && secureKeyEqual(key, main)) return; // 레거시 폴백(비strict)
    throw new UnauthorizedException('PII 조회 키가 올바르지 않습니다');
  }

  /**
   * S-2 재무 인바운드 웹훅 — 키 + 본문 HMAC(X-Signature: sha256=HMAC-SHA256(rawBody)) + 타임스탬프 신선도.
   * 무중단: erp.financeWebhookEnforce≠true 이고 서명 미동봉 시 키만으로 통과(ERP 채택 전 레거시).
   * enforce=true 면 서명+신선 타임스탬프 강제.
   */
  async assertFinanceWebhook(opts: { key?: string; rawBody?: Buffer; signature?: string; timestamp?: string }): Promise<void> {
    await this.assertWebhookKey(opts.key); // 키는 항상(심층방어)
    const enforceRaw = await this.config.get('erp.financeWebhookEnforce');
    const enforce = enforceRaw === true || enforceRaw === 'true';

    // 레거시 무중단: 강제 아니고 서명 미동봉 → 키 검증만으로 통과
    if (!enforce && !opts.signature) return;

    // 타임스탬프 신선도(재전송 차단)
    if (!opts.timestamp) throw new UnauthorizedException('X-Timestamp 헤더가 필요합니다');
    const t = new Date(opts.timestamp).getTime();
    if (!t || Math.abs(Date.now() - t) > FRESHNESS_MS) throw new UnauthorizedException('웹훅 타임스탬프가 만료되었거나 유효하지 않습니다');

    // 본문 HMAC — 권장: HMAC("<timestamp>." + rawBody)(타임스탬프 바인딩·신선도 무력화 방지).
    // 레거시 HMAC(rawBody)는 ERP 이전 완료로 기본 차단. erp.financeWebhookLegacyAccept=true 시에만
    // 한시 수용(롤백용 escape hatch, 무재시작 플립).
    const secret = ((await this.config.get('erp.financeWebhookSecret')) as string) || ((await this.config.get('erp.integrationKey')) as string);
    if (!secret) throw new UnauthorizedException('재무 웹훅 시크릿 미설정');
    if (!opts.rawBody || !opts.signature) throw new UnauthorizedException('웹훅 본문 서명(X-Signature)이 필요합니다');
    const bound = `sha256=${crypto.createHmac('sha256', secret).update(`${opts.timestamp}.`).update(opts.rawBody).digest('hex')}`;
    if (secureKeyEqual(opts.signature, bound)) return;
    const legacyRaw = await this.config.get('erp.financeWebhookLegacyAccept');
    if (legacyRaw === true || legacyRaw === 'true') {
      const legacy = `sha256=${crypto.createHmac('sha256', secret).update(opts.rawBody).digest('hex')}`;
      if (secureKeyEqual(opts.signature, legacy)) return;
    }
    throw new UnauthorizedException('웹훅 본문 서명이 일치하지 않습니다');
  }

  /**
   * S-3 대상별 인가(IDOR 차단) — 대상특정 PII 조회(staff/:employeeNumber·환자 :chartNo)에
   * 서명된 대상 토큰 요구. 토큰=`<target>.<expEpochSec>.<hmacHex>`, hmac=HMAC-SHA256(`<target>.<exp>`, secret).
   * HIS가 ①대상 일치 ②만료 ③서명 검증 → 키 1개로 임의 대상 순회 차단.
   * 무중단: <scope>.targetAuthEnforce≠true 이고 토큰 미동봉 시 통과(레거시). 동봉 시 검증.
   * scope(기본 'erp'): 파트너별 시크릿 분리 — `${scope}.targetTokenSecret`(폴백 `${scope}.integrationKey`).
   * LIS 등 타 파트너 EP에 erp 시크릿을 공유하지 않기 위한 신뢰경계 분리.
   */
  async assertTargetAuth(opts: { token?: string; target: string; scope?: string }): Promise<void> {
    const scope = opts.scope ?? 'erp';
    const enforceRaw = await this.config.get(`${scope}.targetAuthEnforce`);
    const enforce = enforceRaw === true || enforceRaw === 'true';
    if (!enforce && !opts.token) return; // 레거시 무중단
    if (!opts.token) throw new UnauthorizedException('대상 토큰(X-Target-Token)이 필요합니다');

    // 오른쪽에서 파싱(target 에 점 포함 대비): <target>.<exp>.<sig>
    const lastDot = opts.token.lastIndexOf('.');
    const sig = opts.token.slice(lastDot + 1);
    const rest = opts.token.slice(0, lastDot);
    const expDot = rest.lastIndexOf('.');
    if (lastDot < 0 || expDot < 0) throw new UnauthorizedException('대상 토큰 형식 오류');
    const expStr = rest.slice(expDot + 1);
    const tgt = rest.slice(0, expDot);

    if (tgt !== opts.target) throw new UnauthorizedException('대상 토큰 불일치(IDOR 차단)');
    const exp = Number(expStr);
    if (!exp || exp * 1000 < Date.now()) throw new UnauthorizedException('대상 토큰이 만료되었습니다');
    const secret = ((await this.config.get(`${scope}.targetTokenSecret`)) as string) || ((await this.config.get(`${scope}.integrationKey`)) as string);
    if (!secret) throw new UnauthorizedException('대상 토큰 시크릿 미설정');
    const expected = crypto.createHmac('sha256', secret).update(`${tgt}.${expStr}`).digest('hex');
    if (!secureKeyEqual(sig, expected)) throw new UnauthorizedException('대상 토큰 서명이 일치하지 않습니다');
  }
}
