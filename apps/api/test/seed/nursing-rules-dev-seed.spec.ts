/**
 * 간호 원내 규정 개발 시드(2026-10-27 사용자 지시 "원내 규정도 시드 형태로").
 *  · 시드 값은 shared 정본 검사를 통과 · 운영 SQL 과 같은 값 · 없을 때만 · label 표식
 *  · 🔴 시드 행은 출처 SEED(원내 규정 아님) — 그 값으로 동작하되 사람 몫 H11·H12 는 미충족
 *  · 🔴 사람이 저장하면 label 이 등재 설명으로 되돌아가 표식이 사라진다(원내 설정) · label 은 200자로 자른다
 *    (설명이 200자를 넘는 키 4개는 처음 저장이 칸 길이 초과로 실패했다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { DEV_SEED_CONFIG_LABEL, isDevSeedConfigLabel, settingValueInvalidReason } from '@hospital-run/shared';
import { NURSING_RULE_DEV_SEEDS } from '../../prisma/seeds/nursing-rules-dev-seed';
import { ConfigRuntimeService, DEFAULTS, configLabel } from '../../src/modules/config/config-runtime.service';
import { readHandoffAckMode, readPainReassessRule, readRestraintInterval } from '../../src/modules/nursing-rules/nursing-rules.read';
import { HumanActionsService } from '../../src/modules/human-actions/human-actions.service';

const API = join(__dirname, '../..');
// 운영 SQL 두 파일(세 규정 · 재평가 주기 — 같은 날 나눠 적용)
const sql = ['2026-10-27-nursing-rules-dev-seed.sql', '2026-10-27-nursing-risk-interval-dev-seed.sql'].map((f) => readFileSync(join(API, 'prisma/sql/ops', f), 'utf8')).join('\n');
const seed = readFileSync(join(API, 'prisma/seed.ts'), 'utf8');

describe('시드 값·운영 SQL', () => {
  it('세 규정 · 정본 검사 통과 · 등재 키', () => {
    expect(NURSING_RULE_DEV_SEEDS.map((s) => s.key).sort()).toEqual(['nursing.handoff.ackTakeOverMode', 'nursing.pain.reassessRule', 'nursing.restraint.checkIntervalMinutes', 'nursing.riskReassess.intervalHours']);
    for (const s of NURSING_RULE_DEV_SEEDS) {
      expect(settingValueInvalidReason(s.key, s.value) ?? null, s.key).toBeNull();
      expect(s.key in DEFAULTS, s.key).toBe(true);
      expect(s.why.length).toBeGreaterThan(5);
    }
    // 권한·자동 동작을 넓히지 않는다 — 인수 방식은 현행(둘 다 제공)
    expect(NURSING_RULE_DEV_SEEDS.find((s) => s.key === 'nursing.handoff.ackTakeOverMode')!.value).toBe('OFFER_BOTH');
  });
  it('운영 SQL = 시드 값 · 없을 때만 · label 표식', () => {
    const rows = [...sql.matchAll(/SELECT gen_random_uuid\(\), '([^']+)', '([^']+)'::jsonb, 'nursing', '([^']+)', NULL, now\(\), now\(\)\nWHERE NOT EXISTS \(SELECT 1 FROM system_configs WHERE key = '([^']+)'\);/g)];
    expect(rows).toHaveLength(NURSING_RULE_DEV_SEEDS.length);
    for (const r of rows) {
      expect(r[1]).toBe(r[4]);
      expect(isDevSeedConfigLabel(r[3])).toBe(true);
      expect(JSON.parse(r[2])).toEqual(NURSING_RULE_DEV_SEEDS.find((s) => s.key === r[1])!.value);
    }
  });
  it('seed.ts — 없을 때만(update 비움)·label 표식·updatedBy 없음', () => {
    expect(seed).toMatch(/for \(const ns of NURSING_RULE_DEV_SEEDS\) \{\s*await prisma\.systemConfig\.upsert\(\{\s*where: \{ key: ns\.key \},\s*create: \{ key: ns\.key, value: ns\.value as never, category: 'nursing', label: `\$\{DEV_SEED_CONFIG_LABEL\} — 원내 규정 아님`, updatedBy: null \},\s*update: \{\},/);
  });
});

function cfgRow(rows: Record<string, { value: unknown; label: string }>) {
  const prisma: any = { systemConfig: { findUnique: vi.fn(async ({ where }: any) => rows[where.key] ?? null) } };
  return new ConfigRuntimeService(prisma, { emit: vi.fn() } as never);
}
const SEEDED = (value: unknown) => ({ value, label: `${DEV_SEED_CONFIG_LABEL} — 원내 규정 아님` });

describe('🔴 출처 SEED', () => {
  it('시드 행은 SEED — 값으로 동작 · 사람이 저장한 행은 CONFIGURED', async () => {
    const seeded = cfgRow({
      'nursing.pain.reassessRule': SEEDED({ thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 60 }),
      'nursing.handoff.ackTakeOverMode': SEEDED('OFFER_BOTH'),
      'nursing.restraint.checkIntervalMinutes': SEEDED(120),
    });
    expect(await readPainReassessRule(seeded)).toMatchObject({ source: 'SEED', rule: { thresholdScore: 4 } });
    expect(await readHandoffAckMode(seeded)).toEqual({ mode: 'OFFER_BOTH', source: 'SEED' });
    expect(await readRestraintInterval(seeded)).toEqual({ minutes: 120, source: 'SEED' });
    const human = cfgRow({ 'nursing.handoff.ackTakeOverMode': { value: 'SEPARATE', label: '간호 교대 인계 …' } });
    expect(await readHandoffAckMode(human)).toEqual({ mode: 'SEPARATE', source: 'CONFIGURED' });
  });
  it('🔴 사람 몫 H11·H12 — 시드는 미충족', async () => {
    const config = cfgRow({
      'nursing.pain.reassessRule': SEEDED({ thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: null }),
      'nursing.handoff.ackTakeOverMode': SEEDED('OFFER_BOTH'),
      'nursing.restraint.checkIntervalMinutes': SEEDED(120),
    });
    const svc = new HumanActionsService({} as never, config, { get: () => { throw new Error('x'); } } as never);
    const { items } = await svc.list();
    expect(items.find((i) => i.id === 'H11')!.checks[0].state).toBe('UNMET');
    expect(items.find((i) => i.id === 'H12')!.checks.map((c) => c.state)).toEqual(['UNMET', 'UNMET', 'UNMET']);
  });
});

describe('🔴 설정 저장 — label', () => {
  it('저장하면 label 이 등재 설명으로(시드 표식 사라짐) · 200자로 자름(새 행·갱신 모두)', async () => {
    const upsert = vi.fn(async (a: any) => a);
    const svc = new ConfigRuntimeService({ systemConfig: { upsert } } as never, { emit: vi.fn() } as never);
    await svc.set('nursing.pain.reassessRule', { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: null }, 'admin1');
    const a = upsert.mock.calls[0][0];
    expect(DEFAULTS['nursing.pain.reassessRule'].description.length).toBeGreaterThan(200);
    expect(a.create.label.length).toBe(200);
    expect(a.update.label).toBe(a.create.label);
    expect(isDevSeedConfigLabel(a.update.label)).toBe(false);
    expect(configLabel('짧은')).toBe('짧은');
  });
});
