import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 🔴 (2026-09-14) 예약 챗 규칙 응답(입원·응급·면회)의 근거 없는 병원 사실 — 원무과 '1층'·면회 18:00~20:00·
 *    중환자실 면회 10:00~10:30·응급실 '위치: 1층' — 을 걷었다(P15). 빠른답장 '장례식장 안내'(끝에 '해' 없음)가
 *    병원 정보 분기에 걸리지 않아 CMS 장례식장 안내로 가지 못하던 결함도 함께.
 * 목은 정본의 실제 반환 모양(`hospitalInfoContent.findMany` 행 배열 · `systemConfig.findMany` key/value 행).
 */

const FABRICATED = ['18:00~20:00', '10:00~10:30', '18:00~18:30', '원무과(1층)', '위치: 1층', '신분증, 보험카드, 세면도구'];

function mkSvc(facts: Array<{ key: string; value: string }> = []) {
  const prisma = {
    agentSession: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    patient: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    hospitalInfoContent: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    encounter: { findFirst: vi.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue(facts) },
  };
  const svc = new AgentSessionService(prisma as never, { enhancedChat: vi.fn(), orchestrate: vi.fn() } as never, { extractSymptoms: vi.fn(), evaluate: vi.fn() } as never, {} as never, {} as never);
  (svc as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { svc, prisma };
}
const ask = (svc: AgentSessionService, input: string) =>
  (svc as any).handleNonSymptomInput(input, { patient: {}, reception: {}, recommendations: {} }, { id: 's-1' }, []);

describe('예약 챗 규칙 응답 — 근거 없는 병원 사실을 말하지 않는다', () => {
  it.each(['면회 시간 알려줘', '입원 절차가 궁금해요', '응급실 어디예요'])('"%s" 응답에 지어낸 위치·시간이 없다', async (q) => {
    const { svc } = mkSvc();
    const r = await ask(svc, q);
    expect(r?.response).toBeTruthy();
    for (const f of FABRICATED) expect(r.response, `상수 '${f}'`).not.toContain(f);
  });

  it('🔴 면회 — 등록 안내가 없으면 그 사실을 말한다', async () => {
    const { svc } = mkSvc();
    const r = await ask(svc, '면회 시간 알려줘');
    expect(r.response).toContain('등록된 면회 안내가 없어');
  });

  it('응급 — 운영 시간은 기관 설정(hospital.emergency)이 있으면 그 값, 없으면 확인되지 않음', async () => {
    expect((await ask(mkSvc([{ key: 'hospital.emergency', value: '24시간 운영' }]).svc, '응급실 어디예요')).response).toContain('운영: 24시간 운영');
    expect((await ask(mkSvc().svc, '응급실 어디예요')).response).toContain('운영: 확인되지 않음');
  });

  it('🔴 빠른답장 "장례식장 안내"(끝에 해 없음)도 CMS 장례식장 안내로 간다', async () => {
    const { svc, prisma } = mkSvc();
    const r = await ask(svc, '장례식장 안내');
    expect(r?.response).toContain('장례식장 안내');
    expect(r.response).toContain('등록된 안내가 없습니다');
    const call = prisma.hospitalInfoContent.findMany.mock.calls.at(-1)![0] as { where: { category: string } };
    expect(call.where.category).toBe('FUNERAL');
  });

  it('빠른답장 값이 다른 버튼과 같은 모양("… 안내해줘")이다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/agent-session/agent-session.service.ts'), 'utf8');
    expect(src).toContain("{ label: '장례식장', value: '장례식장 안내해줘'");
  });

  it('소스에 지어낸 위치·시간 상수가 남지 않는다(주석 제외)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/modules/agent-session/agent-session.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const f of FABRICATED) expect(src, `상수 '${f}'`).not.toContain(f);
  });
});
