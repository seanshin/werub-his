/**
 * 동의서 환자 서명의 증거(2026-10-13 결함 발굴 A1).
 *  · 🔴 종전: 직원이 이름 하나(prompt)만 넣어도 patientSignedAt 이 찍혀 SIGNED·isValid:true — 증거 없는 "서명 완료"
 *  · 이제: 서명패드 이미지(태블릿 경로와 같은 검사) 또는 종이 서명 스캔본(이 동의서 첨부를 지목) · 서명자 이름 필수
 *  · 종이 서명의 스캔본은 지우지 못한다 · 대조군: 서명패드·종이 경로는 기록되고, 표식 없는 첨부는 지워진다
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConsentService, PAPER_SIGNATURE_EVIDENCE } from '../../src/modules/consent/consent.service';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SCAN = { url: '/uploads/consent/a.pdf', fileName: '서명본.pdf', mimeType: 'application/pdf', size: 10 };

function mk(attachments: unknown[] | null = null) {
  const prisma: any = {
    consentForm: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'PENDING', consentType: 'GENERAL', patientId: 'p1', doctorId: 'd1', attachments }),
      update: vi.fn().mockResolvedValue({ id: 'c1', status: 'PENDING' }),
    },
  };
  const svc = new ConsentService(prisma);
  vi.spyOn(svc as any, 'finalizeIfComplete').mockResolvedValue({ id: 'c1', status: 'SIGNED' });
  vi.spyOn(svc as any, 'anchorConsentSignature').mockResolvedValue(undefined);
  return { svc, prisma };
}
const code = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(BadRequestException);
  return ((e as BadRequestException).getResponse() as { code?: string }).code;
};

describe('🔴 환자 서명 — 증거 없이 서명 완료로 만들지 않는다', () => {
  it('이름만(종전 화면 prompt 경로) → 400 CONSENT_SIGNATURE_REQUIRED · 아무것도 기록하지 않는다', async () => {
    const { svc, prisma } = mk();
    expect(await code(svc.sign('c1', { patientSignedBy: '홍길동' }))).toBe('CONSENT_SIGNATURE_REQUIRED');
    expect(prisma.consentForm.update).not.toHaveBeenCalled();
  });
  it('서명자 이름 없음 → 400 CONSENT_SIGNER_REQUIRED · 서명 이미지 형식 오류(SVG) → 400', async () => {
    expect(await code(mk().svc.sign('c1', { patientSignedBy: '  ', patientSignature: PNG }))).toBe('CONSENT_SIGNER_REQUIRED');
    const e = await mk().svc.sign('c1', { patientSignedBy: '홍길동', patientSignature: 'data:image/svg+xml;base64,PHN2Zz4=' }).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
  });
  it('종이 경로 — 스캔본을 지목하지 않거나 없는 첨부를 지목하면 400 CONSENT_PAPER_SCAN_REQUIRED', async () => {
    expect(await code(mk([]).svc.sign('c1', { patientSignedBy: '홍길동', signMode: 'PAPER' }))).toBe('CONSENT_PAPER_SCAN_REQUIRED');
    expect(await code(mk([SCAN]).svc.sign('c1', { patientSignedBy: '홍길동', signMode: 'PAPER', paperScanIndex: 1 }))).toBe('CONSENT_PAPER_SCAN_REQUIRED');
  });
  it('대조군 — 서명패드: 이미지·이름(앞뒤 공백 제거)·방식 PC 를 기록한다', async () => {
    const { svc, prisma } = mk();
    await svc.sign('c1', { patientSignedBy: ' 홍길동 ', patientSignature: PNG });
    expect(prisma.consentForm.update.mock.calls[0][0].data).toMatchObject({ patientSignature: PNG, patientSignedBy: '홍길동', signMode: 'PC', patientSignedAt: expect.any(Date) });
  });
  it('대조군 — 종이: 이미지 없이 방식 PAPER · 지목한 스캔본에 증거 표식', async () => {
    const { svc, prisma } = mk([{ ...SCAN, fileName: '설명자료.pdf' }, SCAN]);
    await svc.sign('c1', { patientSignedBy: '보호자 김', signMode: 'PAPER', paperScanIndex: 1 });
    const data = prisma.consentForm.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ patientSignature: null, signMode: 'PAPER', patientSignedBy: '보호자 김' });
    expect(data.attachments[1].evidence).toBe(PAPER_SIGNATURE_EVIDENCE);
    expect(data.attachments[0].evidence).toBeUndefined();
  });
});

describe('🔴 종이 서명 스캔본은 지울 수 없다', () => {
  it('증거 표식 첨부 삭제 → 409 · 대조군: 표식 없는 첨부는 지워진다', async () => {
    const { svc, prisma } = mk([SCAN, { ...SCAN, evidence: PAPER_SIGNATURE_EVIDENCE }]);
    await expect(svc.removeAttachment('c1', 1)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.consentForm.update).not.toHaveBeenCalled();
    await svc.removeAttachment('c1', 0);
    expect(prisma.consentForm.update).toHaveBeenCalledTimes(1);
  });
});
