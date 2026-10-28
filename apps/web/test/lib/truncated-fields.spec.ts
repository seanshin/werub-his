import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { truncatedFieldsOf, truncationSummary } from '@/lib/truncated-fields';

/** 🔴 (2026-09-15 U4) 서버가 운영 메모를 잘랐다는 응답(`truncatedFields`)을 화면이 읽고 말한다 */
describe('truncatedFields 읽기', () => {
  it('apiClient 응답({ data }) 과 맨 응답 모두 읽는다', () => {
    const f = { field: 'title', max: 200, receivedLength: 240 };
    expect(truncatedFieldsOf({ data: { ok: true, truncatedFields: [f] } })).toEqual([f]);
    expect(truncatedFieldsOf({ truncatedFields: [f] })).toEqual([f]);
    expect(truncationSummary([f, { field: 'items[1].notes', max: 300, receivedLength: 301 }])).toBe('title(200) · items[1].notes(300)');
  });

  it('대조군 — 잘리지 않았거나 모양이 다르면 빈 목록(경고를 지어내지 않는다)', () => {
    expect(truncatedFieldsOf({ data: { ok: true, truncatedFields: [] } })).toEqual([]);
    expect(truncatedFieldsOf({ data: { ok: true } })).toEqual([]);
    expect(truncatedFieldsOf(null)).toEqual([]);
    expect(truncatedFieldsOf({ data: { truncatedFields: [{ nope: 1 }] } })).toEqual([]);
  });

  it.each([
    'app/(main)/custom/[slug]/page.tsx',
    'app/(main)/admin/treatment-templates/page.tsx',
    'app/(main)/admin/formulary/page.tsx',
    'app/(main)/patients/[id]/components/TreatmentScheduleTab.tsx',
  ])('%s — 저장 응답의 truncatedFields 를 경고로 띄운다', (rel) => {
    const src = readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
    expect(src).toMatch(/const cut = truncatedFieldsOf\(res\);\s*\n\s*if \(cut\.length\) toast\.warning\(/);
  });
});
