/**
 * 데모 약품 효능 분류(2026-10-27).
 *  · 🔴 데모 약품 47종 분류가 전부 비어 진통제 판정(통증 재평가)이 데모 투약 365건을 "분류 모름"으로 셌다
 *  · 시드 지도 = 운영 SQL(같은 값·빈 분류만 채움) · 지도 키는 시드 약품에 실재 · 진통 성분 4종은 진통제로 판정된다
 *  · 근거가 갈리는 성분은 비워 둔다(지어내지 않음) · 이미 있는 행은 분류가 비어 있을 때만 채운다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { isAnalgesicMed } from '@hospital-run/shared';

const API = join(__dirname, '../..');
const seed = readFileSync(join(API, 'prisma/seed.ts'), 'utf8');
const block = seed.slice(seed.indexOf('const SEED_MED_CATEGORY'), seed.indexOf('};', seed.indexOf('const SEED_MED_CATEGORY')));
const map = Object.fromEntries([...block.matchAll(/(M\d+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
const seedCodes = new Set([...seed.slice(seed.indexOf('const medicationCodes = ['), seed.indexOf('const SEED_MED_CATEGORY')).matchAll(/code: '(M\d+)'/g)].map((m) => m[1]));
const sql = readFileSync(join(API, 'prisma/sql/ops/2026-10-27-seed-med-category.sql'), 'utf8');

describe('🔴 데모 약품 효능 분류', () => {
  it('지도 키는 시드 약품에 실재 · 운영 SQL 과 같은 값 · SQL 은 빈 분류만 채운다', () => {
    expect(Object.keys(map).length).toBeGreaterThan(30);
    for (const c of Object.keys(map)) expect(seedCodes.has(c), c).toBe(true);
    const sqlPairs = Object.fromEntries([...sql.matchAll(/SET category = '([^']+)' WHERE code = '(M\d+)' AND category IS NULL;/g)].map((m) => [m[2], m[1]]));
    expect(sqlPairs).toEqual(map);
    expect(sql.match(/UPDATE/g)?.length).toBe(Object.keys(map).length);
  });
  it('진통 성분(타이레놀·부루펜·트라몰·셀레브렉스)은 진통제 · 항생제·위장약은 아니다', () => {
    for (const c of ['M040702', 'M040703', 'M040704', 'M040705']) expect(isAnalgesicMed({ category: map[c] }), c).toBe(true);
    for (const c of ['M047801', 'M065203']) expect(isAnalgesicMed({ category: map[c] }), c).toBe(false);
  });
  it('🔴 근거가 갈리는 성분은 비워 둔다 — 레보플록사신·프레드니솔론·덱사메타손·암로디핀', () => {
    for (const c of ['M047804', 'M085601', 'M300401', 'M091502']) expect(map[c], c).toBeUndefined();
  });
  it('시드 — 새 행에 분류 · 이미 있는 행은 비어 있을 때만', () => {
    expect(seed).toMatch(/create: \{ \.\.\.mc, category, validFrom/);
    expect(seed).toMatch(/updateMany\(\{ where: \{ code: mc\.code, category: null \}, data: \{ category \} \}\)/);
  });
});
