/**
 * 🔴 (2026-09-14 P3) 검사 보드 '30분 초과 미보고'가 30 을 하드코딩해 상향 보고 크론의 허용시간 config 와 따로 놀았다.
 * 지키는 것: ① 설정값 기준으로 센다 ② 미설정·해석 불가·조회 실패·config 부재는 null(산출 불가) + 사유 — 30 으로 폴백하지 않는다
 *           ③ 상황판 라벨이 '30분'을 박지 않는다 ④ 보드 소스에 `>= 30` 하드코딩이 없다
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsBoardService } from '../../src/modules/lab/diagnostics-board.service';

function prismaWith(alertAgesMin: number[]) {
  const now = Date.now();
  const alerts = alertAgesMin.map((m, i) => ({
    id: `a${i}`, status: 'PENDING', notifiedAt: new Date(now - m * 60000), patientId: 'p', testName: 'K', value: '7', unit: '', flag: 'HH',
    patient: { familyName: '김', givenName: '환자', mrn: 'X' },
  }));
  const empty = vi.fn().mockResolvedValue([]);
  const zero = vi.fn().mockResolvedValue(0);
  return new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_u, op: string) => {
        if (model === 'criticalValueAlert' && op === 'findMany') return vi.fn().mockResolvedValue(alerts);
        if (op === 'count') return zero;
        if (op === 'groupBy') return empty;
        return empty;
      },
    }),
  }) as any;
}

async function board(ages: number[], cfg?: { get: ReturnType<typeof vi.fn> }) {
  const svc = new DiagnosticsBoardService(prismaWith(ages), cfg as any);
  (svc as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  return (await svc.getBoard()).summary as any;
}

describe('위급값 허용시간 초과 — config 정본', () => {
  it('① 설정 45분 → 50분 경과만 센다', async () => {
    const s = await board([10, 50], { get: vi.fn().mockResolvedValue(45) });
    expect(s).toMatchObject({ criticalOverdue: 1, criticalOverdueAfterMinutes: 45, criticalOverduePolicy: 'CONFIGURED' });
  });

  it.each([
    ['미설정', { get: vi.fn().mockResolvedValue(null) }, 'NOT_CONFIGURED'],
    ['해석 불가', { get: vi.fn().mockResolvedValue('30분') }, 'INVALID'],
    ['조회 실패', { get: vi.fn().mockRejectedValue(new Error('db')) }, 'UNAVAILABLE'],
    ['config 부재', undefined, 'UNAVAILABLE'],
  ] as const)('② %s → null(산출 불가)·30 폴백 없음', async (_n, cfg, policy) => {
    const s = await board([10, 50], cfg as any);
    expect(s.criticalOverdue).toBeNull();
    expect(s.criticalOverdueAfterMinutes).toBeNull();
    expect(s.criticalOverduePolicy).toBe(policy);
  });

  it('③·④ 라벨·소스에 30분 하드코딩 없음', () => {
    const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const root = path.resolve(__dirname, '../../..');
    const view = strip(fs.readFileSync(path.join(root, 'web/src/app/(main)/command-center/command-center-view.ts'), 'utf8'));
    expect(view).not.toMatch(/위급값 보고 30분 초과|alertLabel: '30분 초과'/);
    const src = strip(fs.readFileSync(path.join(root, 'api/src/modules/lab/diagnostics-board.service.ts'), 'utf8'));
    expect(src).not.toMatch(/minsElapsed\s*>=\s*30\b/);
  });
});
