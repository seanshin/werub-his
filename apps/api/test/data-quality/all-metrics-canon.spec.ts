import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_QUALITY_METRICS } from '../../src/modules/data-quality/quality-registry';

/**
 * 🔴 품질 지표 정본 하나 (P3/C5 · 2026-08-31).
 * 종전엔 챗도구가 9/17 도메인만 나열해 8도메인(emergency·surgery·imaging·checkup·nursing·safety·master·voc)을
 * 못 봤다(레지스트리 확장을 안 따라온 드리프트). ALL_QUALITY_METRICS 하나로 수렴 — 소비처가 이걸 쓴다.
 */
describe('ALL_QUALITY_METRICS 정본', () => {
  it('17 도메인을 모두 담는다(종전 누락 8도메인 포함)', () => {
    const domains = new Set(ALL_QUALITY_METRICS.map((m) => m.domain));
    for (const d of ['patient', 'encounter', 'order', 'admission', 'emergency', 'surgery', 'imaging', 'lab', 'billing', 'checkup', 'nursing', 'safety', 'consent', 'staff', 'appointment', 'master', 'voc']) {
      expect(domains.has(d), `도메인 누락: ${d}`).toBe(true);
    }
    expect(ALL_QUALITY_METRICS.length).toBeGreaterThan(40);
  });

  it('🔴 소비처가 정본을 쓴다 — 각자 배열을 나열하지 않는다(드리프트 방지)', () => {
    const svc = readFileSync(join(process.cwd(), 'src/modules/data-quality/data-quality.service.ts'), 'utf8');
    const tools = readFileSync(join(process.cwd(), 'src/modules/orchestrator/enterprise-tools.ts'), 'utf8');
    expect(svc).toContain('ALL_QUALITY_METRICS');
    expect(tools).toContain('ALL_QUALITY_METRICS');
    // 종전처럼 도메인 배열을 다시 나열하면(스프레드 9개+) 드리프트 위험 — enterprise-tools 에서 재나열 금지
    expect(tools.includes('...PATIENT_METRICS'), 'enterprise-tools 가 다시 배열을 나열').toBe(false);
  });
});
