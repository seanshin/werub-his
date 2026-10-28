/**
 * 🔴 공간·동선 사람 결정 D1~D12 — 기획서 표에만 있으면 아무도 고를 수 없다 (2026-09-28 · 기획 `spatial-flow-vision-3d.plan.md` §9).
 * 재주입: 키 하나를 등록부에서 지우거나 기획서 표에서 지우면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY, LAYER_RANK } from '../../src/modules/decision-registry/decision.registry';

const KEYS = [
  'space.drawingExtract.provider',
  'space.geometry.confirmAuthority',
  'space.drawingExtract.acceptance',
  'location.inferred.display',
  'wayfinding.patientExposure',
  'space.i18nNames',
  'location.retentionDays',
  'infection.contactCandidates',
  'space.assets.readRoles',
  'space.assets.legacyText',
  'space.assets.controlledSubstance',
  'space.floorApi.fallbackGeometry',
] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('공간·동선 결정 12건이 등록부에 있다', () => {
  it('🔴 전부 등재', () => {
    expect(KEYS.filter((k) => !byKey(k))).toEqual([]);
  });

  it('🔴 고를 수 있는 모양 — 선택지 2개 이상·결과·지금 상태·확인 경로·기록 후 남는 일', () => {
    for (const k of KEYS) {
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) expect(o.effect.trim().length, `${k}.${o.value}`).toBeGreaterThan(20);
      expect(d.statusQuo.trim().length, k).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim(), `${k}: 기록≠적용`).not.toBe('');
    }
  });

  it('🔴 위치 보존기간은 허가권자 층·개시 전 필수(개인정보 보존 — 원내 직원이 정할 수 없다)', () => {
    const d = byKey('location.retentionDays')!;
    expect(d.layer).toBe('LICENSE_HOLDER');
    expect(d.goLive).toBe('REQUIRED_BEFORE');
  });

  it('🔴 선행 조건이 하위 층을 가리키지 않는다', () => {
    for (const k of KEYS) {
      for (const dep of byKey(k)!.dependsOn ?? []) {
        const parent = byKey(dep);
        expect(parent, `${k} → ${dep}`).toBeDefined();
        expect(LAYER_RANK[parent!.layer]).toBeGreaterThanOrEqual(LAYER_RANK[byKey(k)!.layer]);
      }
    }
  });

  it('🔴 기획서 §9 가 등록부 키를 가리킨다(키 경계 대조)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/01-plan/features/spatial-flow-vision-3d.plan.md'), 'utf8');
    const cites = (k: string) => new RegExp(`(?<![\\w.])${k.replace(/\./g, '\\.')}(?![\\w.])`).test(doc);
    expect(KEYS.filter((k) => !cites(k)), '기획서에 없는 등록부 키').toEqual([]);
  });
});
