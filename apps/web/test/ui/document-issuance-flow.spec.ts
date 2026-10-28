/**
 * 서류 발급 흐름 추적 보완(2026-10-10).
 *  · 🔴 환자 포털·모바일 상태 표가 발급 업무가 실제로 쓰는 상태를 다 갖는다 — IN_REVIEW 가 빠져 영문 enum 이 환자에게 보였다
 *  · 처리 화면 수령 방법 라벨이 포털 신청의 기본(PORTAL)을 갖는다
 *  · 🔴 의무기록사(MEDICAL_RECORDS)는 서버가 처리 전 단계를 허용하는데 메뉴 '서류 발급'에 없었다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_ISSUANCE_STATUS_LABEL } from '@hospital-run/shared';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const keysOf = (src: string, decl: string) => {
  const i = src.indexOf(decl);
  expect(i, `${decl} 를 찾지 못했다`).toBeGreaterThan(-1);
  const body = src.slice(i, src.indexOf('};', i));
  return new Set([...body.matchAll(/^\s*([A-Z_]+):\s*\{/gm)].map((m) => m[1]));
};

describe('환자에게 보이는 서류 상태 = 발급 업무 상태(기계 대조)', () => {
  const statuses = Object.keys(DOC_ISSUANCE_STATUS_LABEL);
  it('포털 웹 상태 표', () => {
    const keys = keysOf(read('src/app/portal/_services/ServicesTab.tsx'), 'const STATUS_MAP: Record<string, { label: string; cls: string }> = {');
    for (const s of statuses) expect(keys.has(s), `포털에 ${s} 라벨이 없다`).toBe(true);
  });
  it('모바일 상태 표', () => {
    const keys = keysOf(read('../mobile/app/(tabs)/documents.tsx'), 'const statusMap: Record<');
    for (const s of statuses) expect(keys.has(s), `모바일에 ${s} 라벨이 없다`).toBe(true);
  });
});

describe('처리 화면·메뉴', () => {
  it('수령 방법 라벨에 PORTAL', () => {
    expect(read('src/app/(main)/workstation/documents/page.tsx')).toMatch(/DELIVERY_LABEL: Record<string, string> = \{ PORTAL:/);
  });
  it('🔴 메뉴 서류 발급에 의무기록사', () => {
    const line = read('src/components/layout/Sidebar.tsx').split('\n').find((l) => l.includes("href: '/workstation/documents'"))!;
    expect(line).toMatch(/'MEDICAL_RECORDS'/);
  });
});
