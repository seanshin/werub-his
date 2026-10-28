/**
 * 🔴 응급 도착 상황 기록의 사람 결정 3건 — 기획서에만 있으면 아무도 고를 수 없다 (2026-09-29 · 기획 `er-arrival-record.plan.md` §3).
 * 재주입: 키 하나를 등록부에서 지우거나 기획서에서 지우면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const KEYS = ['er.arrival.belongingsCustody', 'er.arrival.thirdPartyRetention', 'er.arrival.recordRequirement'] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);

describe('응급 도착 상황 기록 결정 3건', () => {
  it('🔴 전부 등재 · 고를 수 있는 모양(선택지 2개 이상·결과·지금 상태·확인 경로·기록 후 남는 일) · 권고 없음(enact 전부 null)', () => {
    expect(KEYS.filter((k) => !byKey(k))).toEqual([]);
    for (const k of KEYS) {
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) {
        expect(o.effect.trim().length, `${k}.${o.value}`).toBeGreaterThan(20);
        expect(o.enact, `${k}.${o.value}`).toBeNull();
      }
      expect(d.statusQuo.trim().length, k).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim(), k).not.toBe('');
    }
  });

  it('🔴 제3자 개인정보 보존은 허가권자 층·개시 전 필수(위치 보존기간과 같은 판단)', () => {
    const d = byKey('er.arrival.thirdPartyRetention')!;
    expect(d.layer).toBe(byKey('location.retentionDays')!.layer);
    expect(d.goLive).toBe('REQUIRED_BEFORE');
    expect(d.dueBy).toBe('BEFORE_GO_LIVE');
  });

  it('🔴 기획서가 등록부 키를 가리킨다(키 경계 대조)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/01-plan/features/er-arrival-record.plan.md'), 'utf8');
    const cites = (k: string) => new RegExp(`(?<![\\w.])${k.replace(/\./g, '\\.')}(?![\\w.])`).test(doc);
    expect(KEYS.filter((k) => !cites(k)), '기획서에 없는 등록부 키').toEqual([]);
  });
});
