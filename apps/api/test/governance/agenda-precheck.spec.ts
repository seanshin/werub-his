import { describe, expect, it, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';

/**
 * 제안 사전 검토 계약(TipTap 개편 동반·2026-08-05) — baseline 고정:
 * 게이트 OFF 거부 · LLM 지목 제목은 실제 안건 재매칭만 반환(환각 제목 차단) · HTML strip · 비차단 브리핑.
 */

type AnyRecord = Record<string, unknown>;

const AGENDAS = [
  { id: 'a1', title: 'DUR 처방 게이트(BLOCK) 운영 현황 정기 검토', status: 'RESOLVED', committee: { code: 'DTC', name: '약사위원회' }, decision: { decisionNo: 'GOV-2026-013', status: 'ENACTED' } },
  { id: 'a2', title: '외래 대기 표시 임계 정책 확정 — 경고 20분/위험 60분 vs 종전 관행 30분', status: 'RESOLVED', committee: { code: 'QPS', name: '질향상위' }, decision: { decisionNo: 'GOV-2026-009', status: 'ENACTED' } },
];

function makeSvc(opts: { aiEnabled?: boolean; llmOut?: string } = {}) {
  const prisma = {
    committeeAgenda: { findMany: vi.fn(async () => AGENDAS) },
    committeeSurfaceMap: { findMany: vi.fn(async () => [{ surfaceKey: 'config:dur.enforce', note: null }]) },
    systemConfig: { findMany: vi.fn(async () => [{ key: 'ai.server.url', value: 'http://ai' }]) },
  };
  const config = { get: vi.fn(async (k: string) => (k === 'governance.ai.enabled' ? (opts.aiEnabled ?? true) : null)), getAll: vi.fn(async () => []) };
  const svc = new GovernanceService(prisma as never, undefined, undefined, config as never, undefined);
  (svc as never as { llmGenerate: unknown }).llmGenerate = vi.fn(async () => opts.llmOut ??
    '{"similarTitles":[{"title":"DUR 처방 게이트(BLOCK) 운영 현황 정기 검토","reason":"동일 게이트 재검토"},{"title":"존재하지 않는 창작 제목","reason":"환각"}],"relatedFeatures":["dur.enforce 게이트"],"questions":["최근 위반 통계를 인용했는가?"],"scopeNote":"GATE_MODE 바인딩 사용 가능"}');
  return { svc, prisma };
}

describe('precheckAgenda', () => {
  it('게이트 OFF → GOVERNANCE_AI_OFF 거부', async () => {
    const { svc } = makeSvc({ aiEnabled: false });
    await expect(svc.precheckAgenda({ title: 'x' })).rejects.toThrowError(/비활성|GOVERNANCE_AI_OFF/);
  });

  it('유사 안건 = 실제 안건 재매칭분만(환각 제목 차단)·GOV 번호 동봉·disclaimer 고정', async () => {
    const { svc } = makeSvc();
    const r = await svc.precheckAgenda({ title: 'DUR 게이트 재검토 요청' }) as AnyRecord;
    const similar = r.similar as AnyRecord[];
    expect(similar).toHaveLength(1); // 창작 제목은 매칭 실패로 제외
    expect(similar[0]).toMatchObject({ agendaId: 'a1', decisionNo: 'GOV-2026-013', status: 'RESOLVED' });
    expect(String(r.disclaimer)).toContain('막지 않습니다');
    expect(r.questions).toContain('최근 위반 통계를 인용했는가?');
  });

  it('TipTap HTML body → 평문 strip 후 컨텍스트 사용(태그 미전송)', async () => {
    const { svc } = makeSvc();
    const spy = (svc as never as { llmGenerate: ReturnType<typeof vi.fn> }).llmGenerate;
    await svc.precheckAgenda({ title: '제목', body: '<p>본문 <strong>강조</strong>&nbsp;줄</p><ul><li>항목</li></ul>' });
    const prompt = spy.mock.calls[0][0] as string;
    expect(prompt).toContain('본문 강조 줄 항목');
    expect(prompt).not.toContain('<strong>');
  });

  it('LLM 파싱 실패 → 비차단 폴백(질의로 안내·throw 없음)', async () => {
    const { svc } = makeSvc({ llmOut: 'JSON 아님' });
    const r = await svc.precheckAgenda({ title: '제목' }) as AnyRecord;
    expect((r.questions as string[])[0]).toContain('파싱 실패');
    expect(r.similar).toEqual([]);
  });
});
