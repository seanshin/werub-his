import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EssService } from '../../src/modules/ess/ess.service';

/**
 * 🔴 **ESS → ERP 쓰기는 리얼 모드가 아니면 나가지 않는다** (2026-09-21 형제 프로젝트 인바운드 §3 · 2026-09-23 수렴).
 *
 * 왜: 운영 모드 게이트(`allowsOutboundSend` — 정본 shared `his-mode.ts`)는 아웃박스·문자·메일에만 걸려 있었고,
 *     ESS 는 아웃박스를 거치지 않아 **리허설에서도 실제 ERP 로 나갔다.** 이 경로가 실어보내는 것은
 *     직원의 **주민등록번호와 계좌번호**다 — 리허설 시험 입력이 실 ERP 에 들어가면 되돌릴 수 없다.
 *     수렴 전 main 에는 `allowsOutboundSend`·`heldByMode` 가 ess 모듈에 0건이었다(실측).
 *
 * 🔴 보류는 실패가 아니다: 예외(400)가 아니라 `{ relayed:false, heldByMode }` 로 말하고(문장은 화면이 조립한다 —
 *    서버가 한국어 문장을 만들지 않는다), **마스킹·전송 시각도 남기지 않는다**(보낸 적 없는 것에 전송 시각을 박지 않는다).
 * 🔴 조회(GET)는 여기서 막지 않는다 — 읽기는 밖으로 무엇도 싣지 않는다.
 */

const PAYLOAD = { bankName: '국민', bankHolder: '홍길동', bankAccount: '1234567890', residentId: '9001011234567' };

function makeService(mode: 'DEV' | 'REHEARSAL' | 'REAL') {
  const prisma: any = {
    staff: { findUnique: vi.fn(async () => ({ id: 'staff-1', employeeNumber: 'E001', clinicUserId: null })) },
    staffDependent: { count: vi.fn(async () => 0) },
    staffPayrollRelay: { upsert: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
  };
  const configRuntime: any = {
    get: vi.fn(async (k: string) => {
      if (k === 'ess.payrollRelay.enabled') return true;
      if (k === 'erp.webhookUrl') return 'https://erp.example.invalid';
      if (k === 'erp.integrationKey') return 'k';
      if (k === 'erp.payrollHmacKey') return 'hmac-secret';
      return null;
    }),
  };
  const hisMode: any = { effective: vi.fn(async () => mode) };
  const svc = new EssService(prisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime, {} as any, {} as any, {} as any, {} as any, hisMode);
  return { svc, prisma, hisMode };
}

describe('🔴 ESS → ERP 쓰기 — 운영 모드 게이트(정본 allowsOutboundSend)', () => {
  const realFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ accepted: true }) }) as never);
    globalThis.fetch = fetchSpy as never;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  for (const mode of ['DEV', 'REHEARSAL'] as const) {
    it(`🔴 ${mode} 모드 — 주민번호·계좌를 ERP 로 보내지 않는다 (fetch 호출 0) · 보류는 실패가 아니다(200·heldByMode)`, async () => {
      const { svc } = makeService(mode);
      const r: any = await svc.relayPayrollIdentity('u1', PAYLOAD as never);
      expect(r).toMatchObject({ relayed: false, heldByMode: mode });
      expect(fetchSpy, `${mode} 인데 ERP 로 요청이 나갔다`).not.toHaveBeenCalled();
      // 보내지 않았으니 전송 시각·마스킹도 없다(상태 조회는 findUnique=null → 전부 null)
      expect(r.bankRelayedAt).toBeNull();
      expect(r.residentRelayedAt).toBeNull();
      expect(r.bankAccountMask).toBeNull();
    });

    it(`🔴 ${mode} 모드 — 보내지 않았으므로 마스킹·전송 시각을 저장하지 않는다(P16)`, async () => {
      const { svc, prisma } = makeService(mode);
      await svc.relayPayrollIdentity('u1', PAYLOAD as never);
      expect(prisma.staffPayrollRelay.upsert, '보낸 적 없는 건에 전송 기록이 남았다').not.toHaveBeenCalled();
    });
  }

  it('대조군 — REAL 모드에서는 실제로 나간다 (게이트가 전부를 막아버리지 않는다)', async () => {
    const { svc, prisma } = makeService('REAL');
    const r = await svc.relayPayrollIdentity('u1', PAYLOAD as never);
    expect(fetchSpy, 'REAL 인데 요청이 나가지 않았다 — 게이트가 과하게 막는다').toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toContain('/api/v1/integration/hr/payroll-identity');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Signature'], 'HMAC 서명이 빠졌다').toBeTruthy();
    expect(prisma.staffPayrollRelay.upsert).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ relayed: true });
    expect((r as any).heldByMode).toBeUndefined();
  });

  it('대조군 — 모드 판정을 실제로 물어본다(하드코딩된 통과가 아니다)', async () => {
    const { svc, hisMode } = makeService('REHEARSAL');
    await svc.relayPayrollIdentity('u1', PAYLOAD as never);
    expect(hisMode.effective).toHaveBeenCalled();
  });

  it('조회(GET)는 모드와 무관하게 나간다 — 게이트는 쓰기에만(읽기는 밖으로 무엇도 싣지 않는다)', async () => {
    const { svc, hisMode } = makeService('REHEARSAL');
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) } as never);
    const r: any = await svc.getDuties('u1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.available).toBe(true);
    expect(hisMode.effective).not.toHaveBeenCalled();
  });

  it('🔴 화면이 보류를 "전송되었습니다"로도 실패로도 말하지 않는다(heldByMode 분기가 소스에 있다)', () => {
    const src = readFileSync(join(__dirname, '../../../web/src/app/(main)/ess/_components/PayrollBasicsSection.tsx'), 'utf8');
    expect(src).toContain('res.data?.heldByMode');
    // 보류 분기는 성공 문구 앞에서 return 한다 — 순서가 뒤집히면 "전송되었습니다"가 먼저 찍힌다
    expect(src.indexOf('res.data?.heldByMode')).toBeLessThan(src.indexOf("tAttr('전송되었습니다.')"));
  });
});
