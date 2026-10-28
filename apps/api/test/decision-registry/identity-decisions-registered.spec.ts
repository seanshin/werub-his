/**
 * 🔴 기관 정체성 — 사람 몫을 화면 선택으로 (2026-09-11 · 기획 `docs/01-plan/features/hospital-identity-canon.plan.md`).
 *
 * 병원명 하드코딩 전수 실측에서 **개발로는 정할 수 없는 것 5개**가 나왔다(법정 서식 명칭·발급 스냅샷·정본 위치·
 * 외국어 명칭·미설정 발급). 기획서의 사람 결정 표는 정본이 아니다 — 등록부에 올라와 **고를 수 있는 모양**이어야 한다.
 * 재주입: 아래 키 중 하나를 등록부에서 지우거나 선택지를 하나로 줄이면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY, LAYER_RANK } from '../../src/modules/decision-registry/decision.registry';

const KEYS = [
  'identity.legalNameSplit',
  'identity.documentSnapshot',
  'identity.canonSource',
  'identity.foreignNames',
  'identity.unsetIssuance',
] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('기관 정체성 결정 5건이 등록부에 있다', () => {
  it('🔴 전부 등재 — 기획서에만 있으면 아무도 고를 수 없다', () => {
    expect(KEYS.filter((k) => !byKey(k))).toEqual([]);
  });

  it('🔴 고를 수 있는 모양 — 선택지 2개 이상·결과·지금 상태·확인 경로·기록 후 남는 일', () => {
    for (const k of KEYS) {
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) expect(o.effect.trim().length, `${k}.${o.value}`).toBeGreaterThan(20);
      expect(d.statusQuo.trim().length, k).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim(), `${k}: 기록≠적용 — 남는 일을 밝혀라`).not.toBe('');
    }
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

  it('🔴 기획서가 등록부 키를 가리킨다 — 문서와 등록부가 갈라지지 않게(기계 대조)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/01-plan/features/hospital-identity-canon.plan.md'), 'utf8');
    // 🔴 `includes` 는 부분 문자열이라 `identity.foreignNamesX` 도 통과시켰다(재주입이 잡음) — 키 경계로 본다
    const cites = (k: string) => new RegExp(`(?<![\\w.])${k.replace(/\./g, '\\.')}(?![\\w.])`).test(doc);
    expect(KEYS.filter((k) => !cites(k)), '기획서에 없는 등록부 키').toEqual([]);
  });
});
