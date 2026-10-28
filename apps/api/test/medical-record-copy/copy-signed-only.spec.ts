/**
 * 의무기록 사본 생성기는 서명된 기록만(2026-10-13 결함 발굴 B6).
 *  · 🔴 종전: 상태를 보지 않아 작성 중 진료기록·퇴원요약도 사본으로 만들었다
 *  · 대조군: 서명된 기록은 생성기로 간다 · 간호기록은 생성기가 없다(404 그대로 — 화면 선택지에서 뺐다)
 */
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MedicalRecordCopyService } from '../../src/modules/medical-record-copy/medical-record-copy.service';

const mk = (encStatus: string | null, dsStatus: string | null) => {
  const pdf = { generateEncounterPdf: vi.fn(async () => '<html>e</html>'), generateDischargeSummaryPdf: vi.fn(async () => '<html>d</html>'), generateLabResultPdf: vi.fn() };
  const prisma = {
    encounter: { findUnique: vi.fn().mockResolvedValue(encStatus ? { status: encStatus } : null) },
    dischargeSummary: { findUnique: vi.fn().mockResolvedValue(dsStatus ? { status: dsStatus } : null) },
  };
  return { svc: new MedicalRecordCopyService(prisma as never, pdf as never), pdf };
};

describe('🔴 사본 — 서명된 기록만', () => {
  it('작성 중 진료기록·퇴원요약 → 409 COPY_RECORD_UNSIGNED · 생성기 미호출', async () => {
    for (const [type, a, b] of [['encounter', 'DRAFT', null], ['encounter', 'AMENDED', null], ['discharge_summary', null, 'DRAFT']] as const) {
      const { svc, pdf } = mk(a, b);
      const e = await svc.generatePdf(type, 'x').catch((x) => x);
      expect(e, `${type} ${a ?? b}`).toBeInstanceOf(ConflictException);
      expect(pdf.generateEncounterPdf).not.toHaveBeenCalled();
      expect(pdf.generateDischargeSummaryPdf).not.toHaveBeenCalled();
    }
  });
  it('대조군 — 서명된 기록은 만든다 · 간호기록은 생성기 없음(404)', async () => {
    expect(await mk('SIGNED', null).svc.generatePdf('encounter', 'x')).toContain('<html>');
    expect(await mk(null, 'SIGNED').svc.generatePdf('discharge_summary', 'x')).toContain('<html>');
    expect(await mk(null, null).svc.generatePdf('nursing_note', 'x').catch((x) => x)).toBeInstanceOf(NotFoundException);
  });
});
