/**
 * 인쇄 렌더 데이터에 기관 정보 — 설정 원장 행만(2026-10-13 결함 발굴 C6).
 *  · 없는 키는 null(서식이 '미설정') · 기본값으로 지어 채우지 않는다
 */
import { describe, it, expect, vi } from 'vitest';
import { DocumentService, HOSPITAL_FORM_KEYS } from '../../src/modules/document/document.service';

describe('🔴 렌더 데이터 기관 정보', () => {
  it('행이 있는 키만 값 · 나머지는 null', async () => {
    const prisma: any = {
      issuedDocument: { findUnique: vi.fn().mockResolvedValue({ issueNo: 'WRB-CERTIFICATE-20261013-0001', documentType: 'CERTIFICATE', snapshotJson: {}, status: 'ORIGINAL', issuedAt: new Date() }) },
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'hospital.name', value: '시험병원' }]), findUnique: vi.fn(async ({ where }: any) => (where.key === 'hospital.name' ? { value: '시험병원' } : null)) },
    };
    const svc = new DocumentService(prisma);
    vi.spyOn(svc as any, 'verifyRenderToken').mockReturnValue(true);
    vi.spyOn(svc as any, 'qrDataUrl').mockResolvedValue('data:');
    const r: any = await svc.renderData('WRB-CERTIFICATE-20261013-0001', 'rt');
    expect(r.hospital['hospital.name']).toBe('시험병원');
    for (const k of HOSPITAL_FORM_KEYS.filter((k) => k !== 'hospital.name')) expect(r.hospital[k], k).toBeNull();
  });
});
