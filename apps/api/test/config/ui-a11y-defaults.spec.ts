import { describe, it, expect } from 'vitest';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

/**
 * 가드 — 접근성 설정 키(`ui.a11y.*` · 임상 UX 규약 §4.6, 기획서 §10 P3 선행분)
 *
 * 🔴 기획 의도는 **"정할 대상을 만든다"** 이지 "지금 바꾼다"가 아니다.
 *    · DEFAULTS 에 없으면 `getAll` 이 순회하지 않아 **관리 화면에 아예 뜨지 않는다**(defaults-coverage 참조)
 *      → 간호부·환자안전위원회가 값을 넣을 표면 자체가 없다.
 *    · 기본값이 현행(1.0 · NORMAL · false)이 아니면 **현장 공지 없이 임상 화면이 바뀐다.**
 *
 * 재주입: 키를 지우거나, category 를 'ui' 밖으로 옮기거나, 기본값을 바꾸면 실패한다.
 */
const A11Y_KEYS = ['ui.a11y.textScale', 'ui.a11y.contrast', 'ui.a11y.statusShape'] as const;

const stubPrisma = { systemConfig: { findMany: async () => [] } } as never;
const svc = new ConfigRuntimeService(stubPrisma, { emit: () => true } as never);

describe('ui.a11y.* — 화면 표시(UX) 그룹 등재', () => {
  it('3키가 DEFAULTS 에 있다(없으면 관리 화면에 뜨지 않는다)', () => {
    for (const k of A11Y_KEYS) expect(svc.hasDefault(k), `${k} 미등재`).toBe(true);
  });

  it('기본값은 현행 유지 — 켜기 전까지 화면 변화 없음', () => {
    expect(svc.getDefault('ui.a11y.textScale')).toBe(1);
    expect(svc.getDefault('ui.a11y.contrast')).toBe('NORMAL');
    expect(svc.getDefault('ui.a11y.statusShape')).toBe(false);
  });

  it("category 가 기존 ui.* 와 같아 '화면 표시(UX)' 탭에 함께 뜬다", async () => {
    const rows = await svc.getAll('ui');
    const byKey = new Map(rows.map((r) => [r.key, r]));
    // 기존 ui.* 와 같은 카테고리여야 같은 탭에 묶인다
    expect(byKey.get('ui.dateStyle')?.category).toBe('ui');
    for (const k of A11Y_KEYS) {
      expect(byKey.has(k), `${k} 가 category=ui 조회에 없음`).toBe(true);
      expect(byKey.get(k)?.category).toBe('ui');
      // 설명이 비어 있으면 화면 라벨이 키 문자열이 된다(위원회가 무엇을 정하는지 알 수 없다)
      expect((byKey.get(k)?.description ?? '').length).toBeGreaterThan(10);
    }
  });
});

describe('ui.a11y.* 설명 문구 계약', () => {
  it('배율은 범위(0.9~1.6)와 1.0=현행을, 대비는 HIGH 의미를, 기호는 색 외 채널을 밝힌다', async () => {
    const rows = await svc.getAll('ui');
    const d = (k: string) => rows.find((r) => r.key === k)?.description ?? '';
    expect(d('ui.a11y.textScale')).toContain('0.9~1.6');
    expect(d('ui.a11y.textScale')).toContain('1.0=현행');
    expect(d('ui.a11y.contrast')).toContain('HIGH');
    expect(d('ui.a11y.statusShape')).toContain('색');
  });
});
