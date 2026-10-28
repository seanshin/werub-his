import { describe, it, expect, vi } from 'vitest';

/**
 * 🔴 L2 — **조회 실패를 '없음'으로 번역하던 자리**가 다시 삼키지 않는다(2026-09-17).
 *
 * K4 가 `.catch(() => 기본값)` 333곳 중 고위험 80자리만 읽고 **166 은 읽지 않았다**고 밝혔다.
 * 이 스펙은 그 166 을 읽어 ③(실패를 '없음'으로 번역)으로 판정한 자리의 **동작**을 못박는다.
 *
 * 🔴 대조군이 절반이다 — "진짜 없음"은 그대로 `null`/`[]`/`false` 여야 한다.
 *    실패만 전파되고 미설정·미존재는 종전대로 동작해야, 고친 것이 **기능을 바꾸지 않았다**고 말할 수 있다.
 *    (`config.get()` 은 미설정 키에 `null` 을 돌려주고 DB 실패에만 던진다 — `config-runtime.service.ts:734`)
 */

const BOOM = () => Promise.reject(new Error('DB unavailable'));

describe('🔴 결정 등록부 — 근거 문서·선행 결정 조회 실패를 "없음"으로 말하지 않는다', () => {
  const load = async (get: (k: string) => Promise<unknown>) => {
    const { DecisionService } = await import('../../src/modules/decision-registry/decision.service');
    const config = { get: vi.fn(get), set: vi.fn().mockResolvedValue(undefined) };
    const svc = new DecisionService({} as never, config as never, { hasDefaultKey: () => false } as never);
    return { svc: svc as unknown as { pendingAttachments: (k: string) => Promise<unknown[]> }, config };
  };

  it('🔴 첨부 목록 조회 실패는 전파한다 — []로 접히면 다음 첨부가 기존 목록을 덮어쓴다', async () => {
    const { svc } = await load(() => BOOM());
    await expect(svc.pendingAttachments('legal.ai.deviceClassification')).rejects.toThrow('DB unavailable');
  });

  it('대조군 — 첨부가 정말 없으면(미설정 = null) 종전대로 빈 목록이다', async () => {
    const { svc } = await load(async () => null);
    await expect(svc.pendingAttachments('legal.ai.deviceClassification')).resolves.toEqual([]);
  });

  it('대조군 — 첨부가 있으면 그대로 돌려준다', async () => {
    const att = [{ id: 'a1', fileName: '검토회신.pdf' }];
    const { svc } = await load(async () => att);
    await expect(svc.pendingAttachments('legal.ai.deviceClassification')).resolves.toEqual(att);
  });
});

describe('🔴 연동 게이트 — 개통 여부 조회 실패로 회수 가드가 꺼지지 않는다', () => {
  const load = async (findUnique: () => Promise<unknown>) => {
    const { IntegrationGateService } = await import('../../src/modules/integration-gate/integration-gate.service');
    const prisma = {
      systemConfig: { findUnique: vi.fn(findUnique) },
      integrationGate: { findUnique: vi.fn().mockResolvedValue({ id: 'g1', key: 'k' }), update: vi.fn().mockResolvedValue({}) },
      integrationGateEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const svc = new IntegrationGateService(prisma as never) as unknown as {
      revoke: (t: string, k: string, u: string) => Promise<unknown>;
    };
    return { svc, prisma };
  };
  const TRACK = 'LIS_REFLEX';

  it('🔴 개통 여부를 못 읽으면 회수하지 않는다 — 실패가 "개통 중이 아니다"가 되면 개통 중 게이트가 비워진다', async () => {
    const { svc, prisma } = await load(() => BOOM());
    await expect(svc.revoke(TRACK, 'contract', 'admin-1')).rejects.toThrow('DB unavailable');
    expect(prisma.integrationGate.update).not.toHaveBeenCalled(); // 회수 쓰기가 일어나지 않았다
  });

  it('대조번 — 개통 중이면 종전대로 거부한다', async () => {
    const { svc } = await load(async () => ({ value: 'true' }));
    await expect(svc.revoke(TRACK, 'contract', 'admin-1')).rejects.toThrow(/개통 중에는/);
  });

  it('대조군 — 개통 중이 아니면(행 없음) 종전대로 회수한다', async () => {
    const { svc, prisma } = await load(async () => null);
    await svc.revoke(TRACK, 'contract', 'admin-1');
    expect(prisma.integrationGate.update).toHaveBeenCalled();
  });
});

describe('🔴 게이트 스위치 — 설정 조회 실패를 "관리자가 껐다"로 말하지 않는다', () => {
  const loadPreAuth = async (get: () => Promise<unknown>) => {
    const { PreAuthService } = await import('../../src/modules/pre-auth/pre-auth.service');
    const svc = new PreAuthService(
      { patient: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) } } as never, // prisma
      { get: vi.fn() } as never,                                                     // ConfigService(env)
      { get: vi.fn(get) } as never,                                                  // ConfigRuntimeService(DB)
      { get: vi.fn() } as never,                                                     // ModuleRef
    ) as unknown as { submitPortalPreAuth: (p: string, d: { type: string }) => Promise<unknown> };
    return svc;
  };

  it('🔴 조회 실패는 전파한다 — "신청이 비활성화되어 있습니다"는 설정을 단정하는 말이다', async () => {
    const svc = await loadPreAuth(() => BOOM());
    await expect(svc.submitPortalPreAuth('p1', { type: 'PORTAL_REFILL' })).rejects.toThrow('DB unavailable');
  });

  it('대조군 — 정말 꺼져 있으면(미설정 = null) 종전 문구 그대로 거부한다', async () => {
    const svc = await loadPreAuth(async () => null);
    await expect(svc.submitPortalPreAuth('p1', { type: 'PORTAL_REFILL' })).rejects.toThrow(/비활성화되어 있습니다/);
  });
});

describe('🔴 소스 계약 — 고친 자리에 리터럴 폴백 catch 가 되살아나지 않는다', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'modules', p), 'utf8') as string;
  const LITERAL_CATCH = /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:null|undefined|\[\]|0|\{\s*\}|false)\s*\)/;

  it('집행 전 스냅샷(executeAction)에 리터럴 폴백 catch 가 없다 — 실패가 "신규"로 원장에 박히던 자리', () => {
    const src = read('gld/governance-enactment.service.ts');
    const body = src.slice(src.indexOf('private async executeAction'));
    expect(body.length).toBeGreaterThan(2000); // 대조군: 본문을 실제로 잘라냈다
    expect(LITERAL_CATCH.test(body)).toBe(false);
  });

  it('상담 AI 답변 저장 실패가 로그에 남는다(환자는 답이 오지 않은 것을 모른다)', () => {
    const src = read('consult/consult.service.ts');
    expect(src).toMatch(/상담 AI 답변 저장 실패/);
    expect(src.match(/상담 AI 답변 저장 실패/g)?.length).toBe(2); // 한국어·외국어 두 경로
  });

  it('🔴 Prisma 호출은 한 줄로 유지된다 — 줄바꿈하면 tx·상태 쓰기 스캐너가 그 쓰기를 못 본다', () => {
    // 🔴 이 세 문장은 L2 가 고친 자리다 — 로그 문구로 그 자리를 겨눠, **내가 되돌리는 것만** 잡는다
    //    (파일 전체를 겨누면 손대지 않은 기존 줄바꿈까지 잡혀 대상이 흐려진다).
    const touched: [string, RegExp][] = [
      ['eligibility/eligibility.service.ts', /this\.prisma\.waitingQueue\.update\([^\n]*\n\s*\.catch\([^\n]*자격 결과의 대기열 반영 실패/],
      ['eligibility/eligibility.service.ts', /this\.prisma\.waitingQueue\.update\([^\n]*\n\s*\.catch\([^\n]*본인확인 배지 반영 실패/],
      ['gld/governance.service.ts', /this\.prisma\.committeeDecision\.update\([^\n]*\n\s*\.catch\([^\n]*의결 봉인 해시 기록 실패/],
      ['gld/governance.service.ts', /this\.prisma\.committeeDecision\.update\([^\n]*\n\s*\.catch\([^\n]*결정 상태 승격/],
      ['blood-bank/blood-bank.service.ts', /this\.prisma\.massiveTransfusionProtocol\s*\n?\s*\.updateMany\(/],
    ];
    for (const [f, re] of touched) expect(read(f), f + ' ' + String(re)).toMatch(re);
  });
});
