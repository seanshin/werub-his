/**
 * 위원회 몫 결정 개발 시드가 넣은 설정 행의 개발 시드 표식(2026-10-27).
 *  · 🔴 종전 27행이 표식 없이 들어가 설정 화면은 "설정됨", QI 결정 현황은 "관리자 직접 변경"이라 말했다(둘 다 사실 아님)
 *  · seed.ts 가 label 표식으로 넣는다 · 운영 SQL 은 시드 그대로인 행만(label = 키·값 = 시드 값·생성 뒤 안 바뀜)
 *  · 표식이 지워지려면 저장이 label 을 되돌려야 한다 → 시드 설정 키는 전부 등재(DEFAULTS) 키
 *  · QI 결정 현황 — 시드 행은 출처 SEED(관리자 직접 변경 아님)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { DECISION_DEV_SEEDS } from '../../prisma/seeds/decision-dev-seeds';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { QiFlowSettingsService } from '../../src/modules/quality-flow/qi-flow-settings.service';

const API = join(__dirname, '../..');
const sql = readFileSync(join(API, 'prisma/sql/ops/2026-10-27-committee-seed-config-label.sql'), 'utf8');
const seed = readFileSync(join(API, 'prisma/seed.ts'), 'utf8');
const withConfig = DECISION_DEV_SEEDS.filter((d) => d.config);

describe('🔴 위원회 시드 설정 행 표식', () => {
  it('seed.ts 가 label 표식으로 넣는다', () => {
    expect(seed).toMatch(/key: sd\.config\.key, category: sd\.config\.category, label: `\$\{DEV_SEED_CONFIG_LABEL\} — 위원회 의결 전`/);
  });
  it('운영 SQL = 시드 목록 · 시드 그대로인 행만(label = 키 · 값 = 시드 값 · updated_at = created_at)', () => {
    const rows = [...sql.matchAll(/WHERE key = '([^']+)' AND label = '([^']+)' AND updated_at = created_at AND value = '([^']+)'::jsonb;/g)];
    expect(rows.map((r) => r[1]).sort()).toEqual(withConfig.map((d) => d.config!.key).sort());
    for (const r of rows) {
      expect(r[2]).toBe(r[1]);
      expect(JSON.parse(r[3])).toEqual(withConfig.find((d) => d.config!.key === r[1])!.config!.value);
    }
  });
  it('시드 설정 키는 전부 등재 키 — 사람·의결이 저장하면 label 이 되돌아가 표식이 사라진다', () => {
    for (const d of withConfig) expect(d.config!.key in DEFAULTS, d.config!.key).toBe(true);
  });
  it('QI 결정 현황 — 시드 행은 SEED(관리자 직접 변경 아님) · 사람 행은 종전 판정', async () => {
    const cfg = { getWithSource: vi.fn(async (k: string) => (k === 'safety.harmLevelScale' ? { value: 'KOPS', source: 'db', registered: true, seeded: true } : { value: 'X', source: 'db', registered: true })) };
    const prisma = { systemConfig: { findUnique: vi.fn(async () => ({ updatedAt: new Date() })) }, governanceEnactmentAction: { findFirst: vi.fn(async () => null) } };
    const { rows } = await new QiFlowSettingsService(cfg as never, prisma as never).read();
    expect(rows.find((r) => r.key === 'safety.harmLevelScale')!.provenance).toEqual({ by: 'SEED', at: null });
    expect(rows.find((r) => r.key === 'safety.poa.required')!.provenance!.by).not.toBe('SEED');
  });
});
