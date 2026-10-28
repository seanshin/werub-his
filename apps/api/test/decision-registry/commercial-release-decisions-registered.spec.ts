/**
 * 🔴 첫 상용 패키지 릴리즈 — Phase 0 범위 선언이 등록부에 있다 (2026-09-13 · 기획 `commercial-release-v1-freeze.plan.md` §1).
 *
 * 기획서 S1~S7 표는 정본이 아니다. 새 결정 5건(S2·S4·S5·S6·S7)은 여기 등재돼 **고를 수 있는 모양**이어야 하고,
 * 이미 있던 S1(`country.institutionProfile`)·S3(`policy.ai.clinicalFeatureScope`)은 새로 만들지 않고 연결한다
 * (같은 사실에 결정이 둘이면 갈라진다).
 * 재주입: 키 하나를 지우거나 · 선택지를 하나로 줄이거나 · goLive 를 REQUIRED_BEFORE 로 올리거나 · 기획서에서 키를 빼면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const NEW_KEYS = [
  'release.deploymentForm',
  'release.externalTransmitScope',
  'release.emrCertification',
  'release.versionScheme',
  'release.saleLanguages',
] as const;
const LINKED_KEYS = ['country.institutionProfile', 'policy.ai.clinicalFeatureScope'] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('상용 릴리즈 Phase 0 — 범위 선언 결정이 등록부에 있다', () => {
  it('🔴 새 결정 5건 + 연결 2건이 전부 등재돼 있다', () => {
    expect([...NEW_KEYS, ...LINKED_KEYS].filter((k) => !byKey(k))).toEqual([]);
  });

  it('🔴 고를 수 있는 모양 — 선택지 2개 이상·결과·지금 상태·확인 경로·기록 후 남는 일·선택지마다 target 명시', () => {
    for (const k of NEW_KEYS) {
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) {
        expect(o.effect.trim().length, `${k}.${o.value}`).toBeGreaterThan(20);
        // `null` 은 "바꾸지 않음"의 명시 · `undefined` 는 빠뜨림 — 둘은 다른 사실이다
        expect(o.enact, `${k}.${o.value}: enact 를 빠뜨렸다`).not.toBeUndefined();
      }
      expect(d.statusQuo.trim().length, k).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim(), `${k}: 기록≠적용 — 남는 일을 밝혀라`).not.toBe('');
    }
  });

  it('🔴 시스템은 권고하지 않는다 — 선택지 라벨·결과에 "권장" 표기가 없다', () => {
    for (const k of NEW_KEYS) {
      for (const o of byKey(k)!.options) {
        expect(`${o.label} ${o.effect}`, `${k}.${o.value}`).not.toMatch(/권장|추천|recommended/i);
      }
    }
  });

  it('🔴 이 기관의 실서비스 개시와 무관하다 — 판매 산출물의 게이트를 개시 필수로 올리지 않는다(거짓 경보 금지)', () => {
    for (const k of NEW_KEYS) {
      expect(byKey(k)!.goLive, k).toBe('NOT_RELATED');
      expect(byKey(k)!.dueBy, k).toBe('NONE');
    }
  });

  it('🔴 기획서 §1 표가 7개 키를 전부 가리킨다 — 문서와 등록부가 갈라지지 않게(키 경계로 대조)', () => {
    const doc = fs.readFileSync(
      path.join(__dirname, '../../../../docs/01-plan/features/commercial-release-v1-freeze.plan.md'),
      'utf8',
    );
    const cites = (k: string) => new RegExp(`(?<![\\w.])${k.replace(/\./g, '\\.')}(?![\\w.])`).test(doc);
    expect([...NEW_KEYS, ...LINKED_KEYS].filter((k) => !cites(k)), '기획서에 없는 등록부 키').toEqual([]);
  });
});
