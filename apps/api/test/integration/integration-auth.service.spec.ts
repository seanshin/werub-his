import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { IntegrationAuthService } from '../../src/modules/integration/integration-auth.service';

// ERP 연동 인증(S-1/S-2/S-3) — 키 폴백·strict, 재무 웹훅 양쪽 서명·신선도·enforce, 대상 토큰 IDOR.
const KEYS = {
  integrationKey: 'INTEGRATION_KEY_LEGACY_000000',
  piiReadKey: 'PII_READ_KEY_DEDICATED_000000',
  financeWebhookSecret: 'FIN_SECRET',
  targetTokenSecret: 'TGT_SECRET',
};

function makeService(overrides: Record<string, unknown> = {}) {
  const map: Record<string, unknown> = {
    'erp.integrationKey': KEYS.integrationKey,
    'erp.piiReadKey': KEYS.piiReadKey,
    'erp.financeWebhookSecret': KEYS.financeWebhookSecret,
    'erp.targetTokenSecret': KEYS.targetTokenSecret,
    ...overrides,
  };
  const config = { get: vi.fn((k: string) => Promise.resolve(map[k])) };
  return new IntegrationAuthService(config as never);
}

const finSig = (payload: string, secret = KEYS.financeWebhookSecret) =>
  `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
const targetToken = (target: string, exp: number, secret = KEYS.targetTokenSecret) =>
  `${target}.${exp}.${crypto.createHmac('sha256', secret).update(`${target}.${exp}`).digest('hex')}`;

describe('IntegrationAuthService', () => {
  // ── S-1 PII 조회 키 분리 ──
  describe('assertPiiReadKey', () => {
    it('전용 piiReadKey 일치 → 통과', async () => {
      await expect(makeService().assertPiiReadKey(KEYS.piiReadKey)).resolves.toBeUndefined();
    });
    it('비strict: 레거시 integrationKey 폴백 통과', async () => {
      await expect(makeService().assertPiiReadKey(KEYS.integrationKey)).resolves.toBeUndefined();
    });
    it('strict: 레거시 키 차단', async () => {
      const svc = makeService({ 'erp.piiReadStrict': true });
      await expect(svc.assertPiiReadKey(KEYS.integrationKey)).rejects.toThrow();
    });
    it('strict: piiReadKey 통과', async () => {
      const svc = makeService({ 'erp.piiReadStrict': true });
      await expect(svc.assertPiiReadKey(KEYS.piiReadKey)).resolves.toBeUndefined();
    });
    it('잘못된 키 차단', async () => {
      await expect(makeService().assertPiiReadKey('WRONG')).rejects.toThrow();
    });
    it('strict인데 piiReadKey 미설정 → fail-closed(차단)', async () => {
      const svc = makeService({ 'erp.piiReadStrict': true, 'erp.piiReadKey': undefined });
      await expect(svc.assertPiiReadKey(KEYS.integrationKey)).rejects.toThrow();
    });
  });

  // ── S-2 재무 웹훅 본문 HMAC + 신선도 ──
  describe('assertFinanceWebhook', () => {
    const raw = Buffer.from(JSON.stringify({ event_id: 'e1', status: 'PAID' }));
    const now = () => new Date().toISOString();

    it('enforce off + 무서명 → 키만으로 통과(레거시 무중단)', async () => {
      await expect(makeService().assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw })).resolves.toBeUndefined();
    });
    it('레거시 서명(HMAC rawBody) → 기본 차단(ERP 이전 완료)', async () => {
      const ts = now();
      await expect(makeService().assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw, signature: finSig(raw.toString()), timestamp: ts })).rejects.toThrow();
    });
    it('레거시 서명 — financeWebhookLegacyAccept=true 시 한시 수용(escape hatch)', async () => {
      const ts = now();
      const svc = makeService({ 'erp.financeWebhookLegacyAccept': true });
      await expect(svc.assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw, signature: finSig(raw.toString()), timestamp: ts })).resolves.toBeUndefined();
    });
    it('바운드 서명(HMAC ts.rawBody) + 신선 → 통과', async () => {
      const ts = now();
      await expect(makeService().assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw, signature: finSig(`${ts}.${raw.toString()}`), timestamp: ts })).resolves.toBeUndefined();
    });
    it('잘못된 서명 → 차단', async () => {
      await expect(makeService().assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw, signature: 'sha256=bad', timestamp: now() })).rejects.toThrow();
    });
    it('오래된 타임스탬프 → 차단(재전송)', async () => {
      const stale = new Date(Date.now() - 10 * 60000).toISOString();
      await expect(makeService().assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw, signature: finSig(raw.toString()), timestamp: stale })).rejects.toThrow();
    });
    it('enforce on + 무서명 → 차단', async () => {
      const svc = makeService({ 'erp.financeWebhookEnforce': true });
      await expect(svc.assertFinanceWebhook({ key: KEYS.integrationKey, rawBody: raw })).rejects.toThrow();
    });
    it('잘못된 키 → 차단(서명 이전)', async () => {
      await expect(makeService().assertFinanceWebhook({ key: 'WRONG', rawBody: raw })).rejects.toThrow();
    });
  });

  // ── S-3 대상별 인가(IDOR) ──
  describe('assertTargetAuth', () => {
    const fresh = () => Math.floor(Date.now() / 1000) + 300;

    it('enforce off + 토큰 없음 → 통과(레거시)', async () => {
      await expect(makeService().assertTargetAuth({ target: 'EMP-1', token: undefined })).resolves.toBeUndefined();
    });
    it('대상 일치 + 정상 서명 + 신선 → 통과', async () => {
      const t = targetToken('EMP-1', fresh());
      await expect(makeService().assertTargetAuth({ target: 'EMP-1', token: t })).resolves.toBeUndefined();
    });
    it('대상 불일치 → 차단(IDOR)', async () => {
      const t = targetToken('EMP-OTHER', fresh()); // 다른 대상으로 서명
      await expect(makeService().assertTargetAuth({ target: 'EMP-1', token: t })).rejects.toThrow();
    });
    it('잘못된 서명 → 차단', async () => {
      await expect(makeService().assertTargetAuth({ target: 'EMP-1', token: `EMP-1.${fresh()}.deadbeef` })).rejects.toThrow();
    });
    it('만료 토큰 → 차단', async () => {
      const t = targetToken('EMP-1', Math.floor(Date.now() / 1000) - 60);
      await expect(makeService().assertTargetAuth({ target: 'EMP-1', token: t })).rejects.toThrow();
    });
    it('대상에 점 포함(EMP.A.1) — 오른쪽 2점 파싱 정상', async () => {
      const t = targetToken('EMP.A.1', fresh());
      await expect(makeService().assertTargetAuth({ target: 'EMP.A.1', token: t })).resolves.toBeUndefined();
    });
    it('enforce on + 토큰 없음 → 차단', async () => {
      const svc = makeService({ 'erp.targetAuthEnforce': true });
      await expect(svc.assertTargetAuth({ target: 'EMP-1', token: undefined })).rejects.toThrow();
    });
  });

  // ── S-3 scope 일반화 — 파트너별 시크릿 분리(erp 시크릿을 LIS 등과 공유하지 않음) ──
  describe('assertTargetAuth (scope)', () => {
    const fresh = () => Math.floor(Date.now() / 1000) + 300;
    const LIS = { 'lis.integrationKey': 'LIS_KEY_000', 'lis.targetTokenSecret': 'LIS_TGT_SECRET' };

    it('scope=lis — lis.targetTokenSecret으로 서명된 토큰 통과', async () => {
      const svc = makeService(LIS);
      const t = targetToken('pat-1', fresh(), 'LIS_TGT_SECRET');
      await expect(svc.assertTargetAuth({ target: 'pat-1', token: t, scope: 'lis' })).resolves.toBeUndefined();
    });
    it('scope=lis — erp 시크릿으로 서명된 토큰은 차단(신뢰경계 분리)', async () => {
      const svc = makeService(LIS);
      const t = targetToken('pat-1', fresh()); // erp targetTokenSecret 서명
      await expect(svc.assertTargetAuth({ target: 'pat-1', token: t, scope: 'lis' })).rejects.toThrow();
    });
    it('scope=lis — lis.targetTokenSecret 미설정 시 lis.integrationKey 폴백', async () => {
      const svc = makeService({ 'lis.integrationKey': 'LIS_KEY_000' });
      const t = targetToken('pat-1', fresh(), 'LIS_KEY_000');
      await expect(svc.assertTargetAuth({ target: 'pat-1', token: t, scope: 'lis' })).resolves.toBeUndefined();
    });
    it('scope=lis enforce on(lis.targetAuthEnforce) + 토큰 없음 → 차단, erp enforce와 독립', async () => {
      const svc = makeService({ ...LIS, 'lis.targetAuthEnforce': 'true' });
      await expect(svc.assertTargetAuth({ target: 'pat-1', token: undefined, scope: 'lis' })).rejects.toThrow();
      await expect(svc.assertTargetAuth({ target: 'EMP-1', token: undefined })).resolves.toBeUndefined(); // erp는 여전히 permissive
    });
  });

  // ── 단일 키 초크포인트 (12+ 무가드 ERP/연동 표면이 의존) ──
  // 이 계약이 깨지면 로그인 없는 S2S EP 가 무방비가 된다. secureKeyEqual 이 빈 expected 를
  // false 로 막아 **키 미설정=차단**(fail-closed)이 성립함을 각 게이트별로 고정한다.
  describe('assertWebhookKey (쓰기 웹훅 — billing/cssd/inventory/hr map/equipment/claim 등)', () => {
    it('키 일치 → 통과', async () => {
      await expect(makeService().assertWebhookKey(KEYS.integrationKey)).resolves.toBeUndefined();
    });
    it('키 불일치 → 차단', async () => {
      await expect(makeService().assertWebhookKey('WRONG')).rejects.toThrow();
    });
    it('🔴 키 미설정(빈값) → 아무 값이나 보내도 차단(fail-closed·명시 가드 없이 secureKeyEqual 방어)', async () => {
      const svc = makeService({ 'erp.integrationKey': '' });
      await expect(svc.assertWebhookKey('')).rejects.toThrow();
      await expect(svc.assertWebhookKey('anything')).rejects.toThrow();
    });
    it('🔴 키 누락(undefined) → 차단', async () => {
      await expect(makeService().assertWebhookKey(undefined)).rejects.toThrow();
    });
  });

  // ── 신규 인바운드 게이트 — 명시적 fail-closed(미구성 시 차단) ──
  describe.each([
    ['assertEmsKey', 'emergency.emsKey'],
    ['assertLisKey', 'lis.integrationKey'],
    ['assertEduKey', 'edu.integrationKey'],
  ] as const)('%s — 미구성 fail-closed', (method, cfgKey) => {
    it('미구성 → 키를 보내도 차단', async () => {
      await expect((makeService() as never)[method]('whatever')).rejects.toThrow(/미구성/);
    });
    it('구성 + 일치 → 통과', async () => {
      await expect((makeService({ [cfgKey]: 'REAL_KEY_00' }) as never)[method]('REAL_KEY_00')).resolves.toBeUndefined();
    });
    it('구성 + 불일치 → 차단', async () => {
      await expect((makeService({ [cfgKey]: 'REAL_KEY_00' }) as never)[method]('WRONG')).rejects.toThrow(/올바르지/);
    });
    it('구성 + 키 누락(undefined) → 차단', async () => {
      await expect((makeService({ [cfgKey]: 'REAL_KEY_00' }) as never)[method](undefined)).rejects.toThrow(/올바르지/);
    });
  });
});
