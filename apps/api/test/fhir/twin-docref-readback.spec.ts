import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { FhirController } from '../../src/modules/fhir/fhir.controller';

/**
 * 트윈 write-back 문서를 되읽을 수 있어야 write-back 이다.
 *
 * 🔴 2026-09-02 실측: `POST /twin/fhir-writeback` 의 DocumentReference 는 `TwinDocumentReference` 로
 *    저장되는데, `GET /fhir/R4/DocumentReference`(+`/:id`)는 ConsentForm 과 LabResultAttachment 만 봤다.
 *    트윈은 201 로 받은 id 로 GET 하면 **404** 를 받았다 — 쓰기만 되고 읽히지 않던 원장.
 * 🔴 AI 생성물이면 그렇게 밝힌다(AI기본법 §31) — 표기는 shared 정본에서 온다.
 */
describe('FHIR DocumentReference — 트윈 write-back 문서 되읽기', () => {
  let prisma: any;
  let ctrl: any;

  const twinDoc = {
    id: 'twin-1', patientId: 'p-1', status: 'current', docType: 'SBAR',
    description: '야간 인계', contentText: 'S: 흉통 A: 관찰', aiGenerated: true,
    authorFhirUser: 'Practitioner/u-1', createdAt: new Date('2026-09-02T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      consentForm: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
      labResultAttachment: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
      twinDocumentReference: { findMany: vi.fn().mockResolvedValue([twinDoc]), findUnique: vi.fn().mockResolvedValue(twinDoc) },
    };
    ctrl = new (FhirController as any)(prisma, { assertPatientAccess: vi.fn() }, ...Array(12).fill({}));
    (ctrl as any).prisma = prisma;
    (ctrl as any).smartAuth = { assertPatientAccess: vi.fn() };
  });

  it('🔴 단건 조회가 404 가 아니라 문서를 돌려준다', async () => {
    const r = await ctrl.getDocumentReference('twin-1', {});
    expect(r.resourceType).toBe('DocumentReference');
    expect(r.id).toBe('twin-1');
    expect(r.subject?.reference).toBe('Patient/p-1');
  });

  it('AI 생성물임을 밝힌다 — 정본 표기를 그대로 쓴다', async () => {
    const r = await ctrl.getDocumentReference('twin-1', {});
    expect(r.description).toContain(AI_ORIGIN_TEXT);
    expect(JSON.stringify(r.category)).toContain(AI_ORIGIN_TEXT);
  });

  it('본문을 base64 로 담아 돌려준다(쓴 것을 잃지 않는다)', async () => {
    const r = await ctrl.getDocumentReference('twin-1', {});
    const data = r.content?.[0]?.attachment?.data as string;
    expect(Buffer.from(data, 'base64').toString('utf-8')).toBe('S: 흉통 A: 관찰');
  });

  it('환자 스코프를 확인한다 — 남의 문서를 그냥 주지 않는다', async () => {
    await ctrl.getDocumentReference('twin-1', {});
    expect((ctrl as any).smartAuth.assertPatientAccess).toHaveBeenCalledWith(undefined, 'DocumentReference', 'p-1');
  });

  it('검색 결과 번들에도 포함된다', async () => {
    const b = await ctrl.searchDocumentReferences('Patient/p-1');
    expect(b.entry?.some((e: any) => e.resource?.id === 'twin-1')).toBe(true);
    expect(prisma.twinDocumentReference.findMany).toHaveBeenCalled();
  });

  it('대조군: 트윈 문서도 없으면 여전히 404', async () => {
    prisma.twinDocumentReference.findUnique.mockResolvedValue(null);
    await expect(ctrl.getDocumentReference('nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
