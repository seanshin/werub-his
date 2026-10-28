import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 🔴 (2026-09-14) 예약 챗의 주차·식당·장례식장·층별 안내는 CMS(HospitalInfoContent) 공개 행만 — 3상태.
 * 원 결함: '320대'·'한우리'·'메디치노'·'빈소 5실'·장례식장 '02-1234-5670'(지어낸 번호)을 상수로 환자에게 말했다.
 * 목은 정본의 실제 반환 모양(`hospitalInfoContent.findMany` → 행 배열 · select title/content).
 */

const FABRICATED = ['320대', '한우리', '메디치노', '빈소 5실', '02-1234-5670', '1,200,000원', 'CU 편의점', 'B1~B3'];
const noneOf = (text: string) => { for (const f of FABRICATED) expect(text, `상수 '${f}' 가 남았습니다`).not.toContain(f); };

function mkSvc(cms: (args: unknown) => Promise<unknown[]>) {
  const prisma = {
    agentSession: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    patient: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    hospitalInfoContent: { findMany: vi.fn(cms) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    encounter: { findFirst: vi.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([{ key: 'hospital.phone', value: '02-000-0000' }]) },
  };
  const medicalAi = { enhancedChat: vi.fn(), orchestrate: vi.fn(), generateNaturalResponse: vi.fn() };
  const triage = { extractSymptoms: vi.fn(), evaluate: vi.fn() };
  const svc = new AgentSessionService(prisma as never, medicalAi as never, triage as never, {} as never, {} as never);
  (svc as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc, prisma };
}
const ask = (svc: AgentSessionService, input: string) =>
  (svc as any).handleNonSymptomInput(input, { patient: {}, reception: {}, recommendations: {} }, { id: 's-1' }, []);

const CASES: Array<[string, string]> = [['주차 안내해줘', 'PARKING'], ['식당 메뉴 알려줘', 'DINING'], ['장례식장 안내해줘', 'FUNERAL'], ['층별 안내해줘', 'FACILITY']];

describe('예약 챗 — 시설 안내는 CMS 공개 행만(3상태)', () => {
  it.each(CASES)('🔴 NONE — "%s" 행이 없으면 지어내지 않고 "등록된 안내가 없습니다"', async (q, cat) => {
    const { svc, prisma } = mkSvc(async () => []);
    const r = await ask(svc, q);
    expect(r?.response).toContain('등록된 안내가 없습니다');
    noneOf(r.response);
    const where = prisma.hospitalInfoContent.findMany.mock.calls.at(-1)![0] as { where: unknown };
    expect(where.where).toMatchObject({ category: cat, status: 'PUBLISHED', isActive: true, deletedAt: null }); // 공개 조건 정본
  });

  it.each(CASES)('FOUND — "%s" 는 CMS 제목·본문을 그대로 말한다', async (q) => {
    const { svc } = mkSvc(async () => [{ title: '센티넬 안내', content: '센티넬 본문 42' }]);
    const r = await ask(svc, q);
    expect(r.response).toContain('센티넬 안내');
    expect(r.response).toContain('센티넬 본문 42');
    noneOf(r.response);
  });

  it.each(CASES)('🔴 FAILED — "%s" 조회 실패를 "없음"으로 번역하지 않는다', async (q) => {
    const { svc } = mkSvc(async () => { throw new Error('db down'); });
    const r = await ask(svc, q);
    expect(r.response).toContain('불러오지 못했습니다');
    expect(r.response).not.toContain('등록된 안내가 없습니다');
    expect((svc as any).logger.warn).toHaveBeenCalled();
  });

  it('포괄 병원 안내·오시는 길에도 시설 상수가 없다', async () => {
    const { svc } = mkSvc(async () => []);
    for (const q of ['병원 안내해줘', '오시는 길 알려줘']) noneOf((await ask(svc, q)).response);
  });

  it('소스에 시설 상수가 남지 않는다(주석 제외)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/agent-session/agent-session.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const f of FABRICATED) expect(src, `상수 '${f}'`).not.toContain(f);
  });
});
