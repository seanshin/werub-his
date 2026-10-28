/**
 * 🔴 수술방 녹화 사람 결정 4건이 등록부에 있다 (2026-10-05 · 배치 10-C).
 * 녹화 요청을 받았으나 HIS 에 촬영 연동이 없다 — 법적 요건(허가권자)·요청 절차·보관/열람·장비 영상 연결을 결정으로 올린다.
 *  · 조문·보관 일수를 등재에 박지 않는다(원문 대조 안 함) · 권고 없음(enact 전부 null)
 *  · 수술방 차트는 녹화하지 않는다고 말하고, "녹화 중"을 그리는 코드가 없다
 * 재주입: 키 하나를 지우거나, 차트 문구를 지우거나, 등재에 일수를 박으면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const KEYS = ['or.recording.cctvOperation', 'or.recording.requestFlow', 'or.recording.retentionAccess', 'or.procedureVideo'] as const;
const byKey = (k: string) => DECISION_REGISTRY.find((d) => d.key === k);
const ROOT = path.join(__dirname, '../../../..');

describe('배치 10-C — 수술방 녹화', () => {
  it('🔴 전부 등재 · 키 중복 없음 · 선택지 2개 이상 · 권고 없음 · 기록 후 남는 일', () => {
    expect(KEYS.filter((k) => !byKey(k))).toEqual([]);
    for (const k of KEYS) {
      expect(DECISION_REGISTRY.filter((d) => d.key === k)).toHaveLength(1);
      const d = byKey(k)!;
      expect(d.options.length, k).toBeGreaterThan(1);
      for (const o of d.options) expect(o.enact, `${k}.${o.value}`).toBeNull();
      expect(d.enactKind, k).toBeUndefined();
      expect((d.afterDecision ?? '').trim(), k).not.toBe('');
      expect((d.verifyHow ?? []).length, k).toBeGreaterThan(0);
    }
  });

  it('🔴 촬영 운영은 허가권자 층 · 개시 전 필수 · 하위 결정은 그것에 기댄다', () => {
    const top = byKey('or.recording.cctvOperation')!;
    expect(top.layer).toBe('LICENSE_HOLDER');
    expect(top.goLive).toBe('REQUIRED_BEFORE');
    expect(top.dueBy).toBe('BEFORE_GO_LIVE');
    expect(byKey('or.recording.requestFlow')!.dependsOn).toContain('or.recording.cctvOperation');
    expect(byKey('or.recording.retentionAccess')!.dependsOn).toContain('or.recording.cctvOperation');
  });

  it('🔴 조사하지 않은 보관 일수를 박지 않는다(숫자+일/개월/년 없음)', () => {
    for (const k of KEYS) {
      const d = byKey(k)!;
      const text = [d.why, d.statusQuo, ...d.legalReview, ...d.options.map((o) => `${o.label} ${o.effect}`)].join(' ');
      expect(text, k).not.toMatch(/\d+\s*(일|개월|년)/);
    }
  });

  it('🔴 수술방 차트는 녹화하지 않는다고 말하고, 녹화 중을 그리지 않는다(등재 statusQuo 가 가리키는 사실)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/web/src/app/or-chart/[surgeryId]/panels.tsx'), 'utf8');
    expect(src).toContain('녹화 연동 없음');
    expect(src).not.toMatch(/녹화 중/);
  });
});
