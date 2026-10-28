import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **PHI 를 새 창(window.open)에서 인쇄하면 PrintGuard·감사를 통째로 우회한다** (2026-09-01 · 발굴).
 *
 * PrintGuard 는 메인 앱의 인쇄를 막고 `reportPrintEvent` 로 감사한다. 그러나 `window.open()` +
 * `document.write(html)` + `window.print()` 는 **별도 창**에서 돌아 가드도 감사도 없다 —
 * 환자 팔찌(이름·MRN·알레르기)·의뢰서·상담 letter·접수증 같은 PHI 인쇄가 감사에서 빠졌다.
 * → PHI 새 창 인쇄는 `auditNewWindowPrint()` 로 인쇄 시도를 남긴다.
 */
const root = join(process.cwd(), 'src', 'app');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('🔴 PHI 새 창 인쇄가 감사된다', () => {
  const files: [string, string][] = [
    ['(main)/patients/[id]/components/PatientHeader.tsx', '환자 팔찌'],
    ['(main)/patients/[id]/components/ReferralTab.tsx', '의뢰서'],
    ['(main)/consultations/letters/page.tsx', '상담 letter'],
    ['(main)/reception/components/ReceptionTicket.tsx', '접수증'],
  ];
  for (const [f, label] of files) {
    it(`${label} — auditNewWindowPrint 호출`, () => {
      const s = read(f);
      expect(s, `${label} 인쇄가 감사되지 않는다`).toMatch(/auditNewWindowPrint\(/);
    });
  }
  it('감사 헬퍼가 존재한다(대조군)', () => {
    const g = readFileSync(join(process.cwd(), 'src/components/print/PrintGuard.tsx'), 'utf8');
    expect(g).toMatch(/export function auditNewWindowPrint/);
    expect(g).toMatch(/reportPrintEvent\(/);
  });
});
