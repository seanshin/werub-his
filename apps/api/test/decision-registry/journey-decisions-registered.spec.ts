/**
 * 🔴 환자 여정 사람 결정 D1~D12 — 기획서 표에만 있으면 아무도 고를 수 없다(2026-10-01 · `patient-journey-model.plan.md` §7).
 * P0~P2 가 배포되는 동안 "미등재"였다. 재주입: 키 하나를 등록부나 기획서 표에서 지우면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY, LAYER_RANK } from '../../src/modules/decision-registry/decision.registry';

const KEYS = [
  'journey.backfillOccurredAt', 'journey.erToAdmissionBoundary', 'journey.unexposedRecording', 'journey.exportMode',
  'journey.emitDurability', 'journey.performerObjects', 'journey.userClaimedInMetrics', 'journey.outpatientEnd',
  'emergency.departureTimeSource', 'surgery.durationDefinition', 'quality.readmission30Definition', 'journey.demoSeparation',
] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('환자 여정 결정 12건이 등록부에 있다', () => {
  it('🔴 전부 등재 · 키 중복 없음', () => {
    expect(KEYS.filter((k) => !byKey(k))).toEqual([]);
    for (const k of KEYS) expect(DECISION_REGISTRY.filter((d) => d.key === k)).toHaveLength(1);
  });

  it('🔴 고를 수 있는 모양 — 선택지 2개 이상·결과·지금 상태·확인 경로·기록 후 남는 일 · 권고 없음(enact 전부 null)', () => {
    for (const k of KEYS) {
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) {
        expect(o.effect.trim().length, `${k}.${o.value}`).toBeGreaterThan(15);
        expect(o.enact, `${k}.${o.value}`).toBeNull();
      }
      expect(d.statusQuo.trim().length, k).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim(), `${k}: 기록≠적용`).not.toBe('');
      expect(d.enactKind, k).toBeUndefined();
    }
  });

  it('🔴 반출 허용은 허가권자 층(원내 위원회가 대신 정할 수 없다)', () => {
    expect(byKey('journey.exportMode')!.layer).toBe('LICENSE_HOLDER');
  });

  it('선행 조건이 하위 층을 가리키지 않는다', () => {
    for (const k of KEYS) {
      for (const dep of byKey(k)!.dependsOn ?? []) {
        const parent = byKey(dep);
        expect(parent, `${k} → ${dep}`).toBeDefined();
        expect(LAYER_RANK[parent!.layer]).toBeGreaterThanOrEqual(LAYER_RANK[byKey(k)!.layer]);
      }
    }
  });

  it('🔴 기획서 §7 이 등록부 키를 가리킨다(키 경계 대조)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/01-plan/features/patient-journey-model.plan.md'), 'utf8');
    const cites = (k: string) => new RegExp(`(?<![\\w.])${k.replace(/\./g, '\\.')}(?![\\w.])`).test(doc);
    expect(KEYS.filter((k) => !cites(k))).toEqual([]);
  });
});
