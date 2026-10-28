import { describe, it, expect, vi } from 'vitest';
import { IntegrationAuthService } from '../../src/modules/integration/integration-auth.service';
import { SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';

// e-sign #6 — ERP 계약 서명 발의: 전용 키 인증 + 발의 입력 검증.
describe('ERP 계약 서명 발의 — 인증(assertSignOriginationKey)', () => {
  const make = (cfg: Record<string, unknown>) =>
    new IntegrationAuthService({ get: (k: string) => Promise.resolve(cfg[k]) } as any);

  it('키 미구성이면 401', async () => {
    await expect(make({}).assertSignOriginationKey('whatever')).rejects.toThrow(/미구성/);
  });
  it('키 불일치면 401', async () => {
    await expect(make({ 'erp.signOriginationKey': 'real' }).assertSignOriginationKey('wrong')).rejects.toThrow(/올바르지/);
  });
  it('키 일치면 통과', async () => {
    await expect(make({ 'erp.signOriginationKey': 'real' }).assertSignOriginationKey('real')).resolves.toBeUndefined();
  });
  it('키 누락(undefined)이면 401', async () => {
    await expect(make({ 'erp.signOriginationKey': 'real' }).assertSignOriginationKey(undefined)).rejects.toThrow(/올바르지/);
  });
});

describe('ERP 계약 서명 발의 — 입력 검증(originateErpContractSign)', () => {
  // requestDocumentSign 도달 전 검증만 확인(외부 sign 호출 불요). getMode 가 불릴 일 없음.
  const svc = new SignIntegrationService(
    { get: () => Promise.resolve(undefined) } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  it('sourceId 누락이면 BadRequest', async () => {
    await expect(svc.originateErpContractSign({ sourceId: '' } as any)).rejects.toThrow(/sourceId/);
  });
  it('sourceId 공백이면 BadRequest', async () => {
    await expect(svc.originateErpContractSign({ sourceId: '   ' } as any)).rejects.toThrow(/sourceId/);
  });
  it('documentType 이 ERP_* 아니면 BadRequest', async () => {
    await expect(svc.originateErpContractSign({ sourceId: '123', documentType: 'CONSENT' })).rejects.toThrow(/ERP_/);
  });
  it('유효 입력은 requestDocumentSign 으로 진행(SIMULATION 모드라 501에서 멈춤=검증 통과)', async () => {
    await expect(svc.originateErpContractSign({ sourceId: 123, documentType: 'ERP_MEDICAL_CONTRACT' }))
      .rejects.toThrow(/SIMULATION|EXTERNAL/); // getMode→SIMULATION(config undefined) → requestDocumentSign 진입 증명
  });
});
