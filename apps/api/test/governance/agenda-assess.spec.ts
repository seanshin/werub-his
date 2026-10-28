import { describe, expect, it, vi } from 'vitest';
import { GovernanceService } from '../../src/modules/gld/governance.service';

/**
 * 안건 AI 영향 평가 계약(워크벤치 P2·D5~D7) — baseline 고정:
 * 게이트 OFF 거부·RESOLVED 동결·컨텍스트는 정책 메타데이터만(환자 데이터 접근 0)·스냅샷 저장.
 */

type AnyRecord = Record<string, unknown>;

const AGENDA = {
  id: 'ag-1', committeeId: 'c-1', status: 'SUBMITTED',
  title: 'DUR 처방 게이트(BLOCK) 운영 현황 정기 검토',
  body: '30일 위반 0건 실측.',
  sourceRef: { type: 'SAFETY_GATE', key: 'dur.enforce' },
  committee: { code: 'DTC', name: '약사위원회' },
};

function makeSvc(opts: { aiEnabled?: boolean; agenda?: AnyRecord | null } = {}) {
  const prisma = {
    committeeAgenda: {
      findUnique: vi.fn(async () => (opts.agenda === undefined ? AGENDA : opts.agenda)),
      update: vi.fn(async (args: AnyRecord) => args),
    },
    committeeSurfaceMap: {
      findMany: vi.fn(async () => [
        { surfaceKey: 'config:dur.enforce', committeeId: 'c-1', note: 'go-live owner: 진료부·약제' },
        { surfaceKey: 'master:dur-rules', committeeId: 'c-1', note: 'DurRule 테이블' },
      ]),
    },
    gateViolationLog: { count: vi.fn(async () => 0) },
    formularyRequest: { findUnique: vi.fn(async () => null) },
    systemConfig: { findMany: vi.fn(async () => [{ key: 'ai.server.url', value: 'http://ai' }, { key: 'ai.server.gpuKey', value: 'sk-x' }]) },
    user: { findMany: vi.fn(async () => []) },
  };
  const config = {
    get: vi.fn(async (k: string) => (k === 'governance.ai.enabled' ? (opts.aiEnabled ?? false) : 'BLOCK')),
    getAll: vi.fn(async () => []),
  };
  const svc = new GovernanceService(prisma as never, undefined, undefined, config as never, undefined);
  return { svc, prisma, config };
}

describe('assessAgenda — 게이트·동결', () => {
  it('게이트 OFF(기본) → GOVERNANCE_AI_OFF 거부', async () => {
    const { svc } = makeSvc({ aiEnabled: false });
    await expect(svc.assessAgenda('ag-1')).rejects.toThrowError(/비활성|GOVERNANCE_AI_OFF/);
  });

  it('RESOLVED 안건 → 동결(409) — 의결 근거 감사 가능성', async () => {
    const { svc } = makeSvc({ aiEnabled: true, agenda: { ...AGENDA, status: 'RESOLVED' } });
    await expect(svc.assessAgenda('ag-1')).rejects.toThrowError(/동결|ASSESS_FROZEN/);
  });

  it('정상 경로 — LLM 출력 파싱·disclaimer 동봉·스냅샷 update', async () => {
    const { svc, prisma } = makeSvc({ aiEnabled: true });
    (svc as never as { llmGenerate: unknown }).llmGenerate = vi.fn(async () =>
      '{"scope":"DTC 표면 2종","currentState":"BLOCK·위반 0","risks":["r1"],"checklist":["c1"],"bindingSuggestion":null}');
    const r = await svc.assessAgenda('ag-1') as AnyRecord;
    expect(r.scope).toBe('DTC 표면 2종');
    expect(String(r.disclaimer)).toContain('위원회 몫');
    const upd = (prisma.committeeAgenda.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as AnyRecord;
    expect((upd.data as AnyRecord).aiAssessment).toBeTruthy();
    expect((upd.data as AnyRecord).aiAssessedAt).toBeInstanceOf(Date);
  });

  it('파싱 실패 시 폴백(parseFallback) — 평가가 통째로 죽지 않는다', async () => {
    const { svc } = makeSvc({ aiEnabled: true });
    (svc as never as { llmGenerate: unknown }).llmGenerate = vi.fn(async () => 'JSON 아님 자유 텍스트');
    const r = await svc.assessAgenda('ag-1') as AnyRecord;
    expect(r.parseFallback).toBe(true);
    expect(String(r.scope)).toContain('자유 텍스트');
  });
});

describe('buildAssessContext — 정책 메타데이터만(PHI 미포함 계약)', () => {
  it('최상위 키 화이트리스트 고정 — 환자 데이터 필드가 끼어들 수 없다', async () => {
    const { svc } = makeSvc({ aiEnabled: true });
    const ctx = await svc.buildAssessContext(AGENDA as never) as AnyRecord;
    expect(Object.keys(ctx).sort()).toEqual(
      ['agenda', 'committee', 'configDriftCount', 'openBindingKinds', 'sourceRefData', 'surfaces'],
    );
    const flat = JSON.stringify(ctx);
    for (const banned of ['mrn', 'patientId', 'familyName', 'givenName', 'dateOfBirth', '주민']) {
      expect(flat).not.toContain(banned);
    }
  });

  it('SAFETY_GATE 출처 — 게이트 현재 모드·30일 위반수를 결정적으로 동봉(D6)', async () => {
    const { svc } = makeSvc({ aiEnabled: true });
    const ctx = await svc.buildAssessContext(AGENDA as never) as AnyRecord;
    expect(ctx.sourceRefData).toMatchObject({ type: 'SAFETY_GATE', key: 'dur.enforce', currentMode: 'BLOCK', violations30d: 0 });
    const surfaces = ctx.surfaces as { surfaceKey: string; currentValue?: string }[];
    expect(surfaces.find((s) => s.surfaceKey === 'config:dur.enforce')?.currentValue).toBe('"BLOCK"');
    expect(surfaces.find((s) => s.surfaceKey === 'master:dur-rules')?.currentValue).toBeUndefined(); // config: 만 값 조회
  });
});
