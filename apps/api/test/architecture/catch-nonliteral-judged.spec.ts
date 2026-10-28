/**
 * `.catch(() => 비리터럴 기본값)` 46곳 판정(2026-10-01) — 실결함 17 교정의 행동 가드.
 * 종전엔 `CATCH_NONLITERAL_BASELINE` 으로 **늘지 못하게만** 했다(판정 아님). 이 스펙은 고친 자리마다
 * "실패를 없음·기본값·미설정으로 말하지 않는다" + 대조군 "성공(·미설정)이면 종전처럼 동작한다" 를 본다.
 * 재주입: 각 자리의 `.catch(() => 기본값)` 을 되돌리면 해당 블록이 실패한다.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AI_DEFAULT_DISCLAIMER } from '@hospital-run/shared';
import { DataQualityService } from '../../src/modules/data-quality/data-quality.service';
import { FeeIntegrationService } from '../../src/modules/fee-integration/fee-integration.service';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { VocSlaCronService } from '../../src/modules/voc/voc-sla-cron.service';
import { DevDemoService } from '../../src/modules/dev-demo/dev-demo.service';

const down = () => Promise.reject(new Error('config down'));

describe('품질 스냅샷 보존 정리 — 지우는 쪽 폴백 금지', () => {
  function svc(get: (k: string) => Promise<unknown>) {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const s = new DataQualityService({ qualityMetricSnapshot: { upsert: vi.fn(async () => ({})), deleteMany } } as never, { get } as never);
    vi.spyOn(s, 'summary').mockResolvedValue({ domains: [] } as never);
    return { s, deleteMany };
  }
  it('🔴 보존기간 조회 실패 → 이번 정리는 건너뛴다(기본 365일로 지우지 않는다)', async () => {
    const { s, deleteMany } = svc(down);
    await s.captureSnapshot();
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('대조군 — 미설정(null)이면 종전처럼 365일 기준으로 정리 · 설정값이면 그 값', async () => {
    const a = svc(async () => null);
    await a.s.captureSnapshot();
    expect(a.deleteMany).toHaveBeenCalledTimes(1);
    const b = svc(async () => 1000);
    await b.s.captureSnapshot();
    const lt = (b.deleteMany.mock.calls[0] as unknown as [{ where: { capturedOn: { lt: Date } } }])[0].where.capturedOn.lt;
    expect(Date.now() - lt.getTime()).toBeGreaterThan(999 * 86400_000);
  });
});

describe('AI 브리핑 고지 — 조회 실패에 고지를 빼지 않는다', () => {
  it('🔴 ai.disclaimer 조회 실패 → 기본 고지(빈 문자열 아님) · 대조군: 설정값이면 그 값', async () => {
    const mk = (get: (k: string) => Promise<unknown>) => {
      const s = new DataQualityService({} as never, { get } as never) as unknown as Record<string, unknown>;
      vi.spyOn(s as never, 'summary' as never).mockResolvedValue({ domains: [] } as never);
      s.aiEnabled = async () => true;
      s.llmGenerate = async () => '제안';
      return s as unknown as DataQualityService;
    };
    const failed = await mk((k) => (k === 'ai.disclaimer' ? down() : Promise.resolve(null))).briefing();
    expect((failed as { disclaimer?: string }).disclaimer).toBe(AI_DEFAULT_DISCLAIMER);
    const set = await mk(async (k) => (k === 'ai.disclaimer' ? '원내 고지' : null)).briefing();
    expect((set as { disclaimer?: string }).disclaimer).toBe('원내 고지');
  });
});

describe('재고 원가 갱신 — 실패를 "ERP 매핑 없음"으로 세지 않는다', () => {
  it('🔴 갱신 실패는 failed · 대조군: 매핑 없는 품목은 unmatched', async () => {
    const prisma = {
      inventoryItem: { updateMany: vi.fn(async ({ where }: { where: { erpItemCode: string } }) => {
        if (where.erpItemCode === 'BOOM') throw new Error('db');
        return { count: where.erpItemCode === 'HIT' ? 1 : 0 };
      }) },
      instrumentItem: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const r = await new FeeIntegrationService(prisma as never).updateMaterialCosts([
      { erpItemCode: 'HIT', unitPrice: 10 }, { erpItemCode: 'NONE', unitPrice: 10 }, { erpItemCode: 'BOOM', unitPrice: 10 },
    ]);
    expect(r).toMatchObject({ total: 3, inventoryUpdated: 1, unmatched: 1, failed: 1 });
  });
});

describe('개원 관제 — 설정 조회 실패는 판정 불가(BLOCKED)', () => {
  const svc = (get: (k: string) => Promise<unknown>) => new GoLiveService({} as never, { get } as never) as unknown as {
    derivePhase0(): Promise<{ status: string }>;
    deriveServiceFlag(k: string, s: string): Promise<{ status: string; auto: boolean }>;
  };
  it('🔴 컷오버 승인 조회 실패 → "법무 승인 대기"가 아니라 BLOCKED · 대조군: 미설정이면 NOT_READY', async () => {
    expect((await svc(down).derivePhase0()).status).toBe('BLOCKED');
    expect((await svc(async () => null).derivePhase0()).status).toBe('NOT_READY');
    expect((await svc(async () => ({ approvedAt: 'x' })).derivePhase0()).status).toBe('READY');
  });
  it('🔴 서비스 플래그 조회 실패 → "현재 미설정"이 아니라 BLOCKED · 대조군: 목표값이면 READY', async () => {
    expect((await svc(down).deriveServiceFlag('flag:a.b=true', 'NOT_READY')).status).toBe('BLOCKED');
    expect((await svc(async () => 'true').deriveServiceFlag('flag:a.b=true', 'NOT_READY')).status).toBe('READY');
  });
});

describe('VoC 자동 종결 — 조회 실패에 기본 7일로 닫지 않는다', () => {
  it('🔴 autoCloseDays 조회 실패 → updateMany(종결) 없음 · 대조군: 미설정이면 종전처럼 닫는다', async () => {
    const mk = (get: (k: string) => Promise<unknown>) => {
      const updateMany = vi.fn(async () => ({ count: 0 }));
      const prisma = { vocTicket: { findMany: vi.fn(async () => []), updateMany }, consultSession: { findMany: vi.fn(async () => []) } };
      return { s: new VocSlaCronService(prisma as never, { get } as never), updateMany };
    };
    const failed = mk((k) => (k === 'voc.autoCloseDays' ? down() : Promise.resolve(null)));
    await failed.s.run();
    expect(failed.updateMany).not.toHaveBeenCalled();
    const unset = mk(async () => null);
    await unset.s.run();
    expect(unset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }));
  });
});

describe('데모 리프레시 — 실패를 0건으로 말하지 않는다', () => {
  it('🔴 갈래 실패는 { failed, error } · 대조군: 다른 갈래는 그대로 돈다', async () => {
    const s = new DevDemoService({} as never, { get: vi.fn(async () => true) } as never);
    vi.spyOn(s, 'rollForward').mockResolvedValue({ today: '2026-10-01', tables: [] } as never);
    vi.spyOn(s, 'refreshOrderQueues').mockResolvedValue({ queues: [] } as never);
    vi.spyOn(s, 'refreshDiagnosticsDemo').mockResolvedValue(0 as never);
    vi.spyOn(s, 'refreshClinicQueue').mockRejectedValue(new Error('queue boom'));
    vi.spyOn(s, 'refreshReceptionAppointments').mockResolvedValue(5);
    vi.spyOn(s, 'refreshSurgeries').mockResolvedValue({ moved: 1, created: 0 } as never);
    vi.spyOn(s, 'refreshEmergency').mockRejectedValue(new Error('er boom'));
    const r = await s.refreshAll(false);
    expect(r.clinicQueue).toEqual({ failed: true, error: 'queue boom' });
    expect(r.emergency).toEqual({ failed: true, error: 'er boom' });
    expect(r.receptionAppts).toBe(5);
    expect(r.surgeries).toEqual({ moved: 1, created: 0 });
  });
});

describe('구조 — 본문을 못 읽은 2xx 를 성공·빈 결과로 넘기지 않는다', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../../src/modules', p), 'utf8');
  it('🔴 STT 청크 · sign 제출은 본문 파싱 실패를 던진다(빈 객체 폴백 없음)', () => {
    const stt = src('voice-emr/stt-chunk.client.ts');
    const chunk = stt.slice(stt.indexOf("code: 'STT_CHUNK_FAIL', message: `STT ${res.status}`"), stt.indexOf('return parsed as ChunkResult;'));
    expect(chunk).toMatch(/STT 응답을 읽지 못했습니다/);
    const sign = src('sign-integration/sign-integration.service.ts');
    const submit = sign.slice(sign.indexOf('sign 제출 실패: ${res.status}'), sign.indexOf('sign 제출 실패: ${res.status}') + 900);
    expect(submit).toMatch(/sign 제출 응답을 읽지 못했습니다/);
    expect(submit).not.toMatch(/res\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  });
  it('🔴 VoC 접수 SLA·부서 배정 · 컷오버 현황은 조회 실패를 기본값으로 접지 않는다', () => {
    const voc = src('voc/voc.service.ts');
    expect(voc).not.toMatch(/get\(`voc\.sla\.\$\{type\}`\)\.catch/);
    expect(voc).not.toMatch(/get\('voc\.routing'\)\.catch/);
    const p0 = src('phase0-cutover/phase0-cutover.service.ts');
    expect(p0).not.toMatch(/integration\.(cutoverApproval|pseudonymKey|pseudonymizeChartNo)'\)\.catch/);
  });
});
