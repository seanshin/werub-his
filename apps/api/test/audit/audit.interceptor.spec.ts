import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { AuditInterceptor } from '../../src/modules/audit/audit.interceptor';

const UUID_A = '8f14e45f-ceea-467a-9b3a-1a1b2c3d4e5f';
const UUID_B = '3b9f0e1c-7d2a-4c58-9f10-0a1b2c3d4e5f';

function ctx(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1' }, headers: {}, ip: '10.0.0.1', ...req }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

describe('AuditInterceptor', () => {
  let audit: { log: any; logReadOnce: any };
  let reflector: any;
  let interceptor: AuditInterceptor;
  const next = (data?: unknown) => ({ handle: () => of(data ?? { data: { id: UUID_A } }) }) as any;

  const run = async (req: Record<string, unknown>, response?: unknown) =>
    new Promise((resolve) =>
      interceptor.intercept(ctx(req), next(response)).subscribe({ complete: () => resolve(undefined) }),
    );

  beforeEach(() => {
    audit = { log: vi.fn().mockResolvedValue(null), logReadOnce: vi.fn().mockResolvedValue(undefined) };
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    interceptor = new AuditInterceptor(audit as any, reflector);
  });

  it('미등록 임상 도메인의 변이도 기본 감사된다 (종전 allowlist 누락 봉합)', async () => {
    await run({ method: 'POST', path: '/api/v1/nursing-notes', body: { patientId: UUID_B, content: '경과 양호' } });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', action: 'CREATE', resourceType: 'NursingNote', resourceId: UUID_A }),
    );
  });

  it('changes 에는 PHI 값이 아니라 필드 키만 담는다', async () => {
    await run({ method: 'POST', path: '/api/v1/nursing-notes', body: { patientId: UUID_B, content: '경과 양호' } });

    const entry = audit.log.mock.calls[0][0];
    expect(entry.changes).toEqual({ fields: { old: null, new: 'patientId,content' } });
    expect(JSON.stringify(entry)).not.toContain('경과 양호');
  });

  it('권한 변경(access-control)이 감사된다', async () => {
    await run({ method: 'PUT', path: '/api/v1/access-control/feature-access/orders.sign', body: { roles: ['DOCTOR'] } });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'AccessControl', action: 'UPDATE' }));
  });

  it('면제 경로는 기록하지 않는다', async () => {
    await run({ method: 'PATCH', path: '/api/v1/notifications/read-all', body: {} });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('@NoAudit 이 붙은 라우트는 제외된다', async () => {
    reflector.getAllAndOverride = vi.fn().mockImplementation((key: string) => key === 'audit:skip');
    await run({ method: 'POST', path: '/api/v1/nursing-notes', body: {} });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('집계 조회는 열람 감사 대상이 아니다 (hex 오탐 봉합)', async () => {
    await run({ method: 'GET', path: '/api/v1/billing/daily-summary', query: {} });
    expect(audit.logReadOnce).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('환자 지목 조회는 대상 환자에 귀속돼 READ 로 기록된다', async () => {
    await run({ method: 'GET', path: '/api/v1/lab/results', query: { patientId: UUID_B } });

    expect(audit.logReadOnce).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ', resourceType: 'LabResult', resourceId: UUID_B }),
    );
  });

  it('인증되지 않은 요청은 actor 를 특정할 수 없어 기록하지 않는다', async () => {
    await run({ method: 'POST', path: '/api/v1/nursing-notes', body: {}, user: undefined });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('감사 실패가 요청을 깨뜨리지 않는다', async () => {
    audit.log = vi.fn().mockRejectedValue(new Error('DB down'));
    await expect(run({ method: 'POST', path: '/api/v1/surgery', body: {} })).resolves.toBeUndefined();
  });
});
