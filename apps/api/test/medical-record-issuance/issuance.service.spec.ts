import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IssuanceService } from '../../src/modules/medical-record-issuance/issuance.service';

describe('IssuanceService', () => {
  let svc: IssuanceService;
  let prisma: any;
  let documents: any;
  let audit: any;
  let events: any;

  beforeEach(() => {
    prisma = {
      documentRequest: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      issuanceArtifact: { updateMany: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), findFirst: vi.fn() },
      patient: { findUnique: vi.fn().mockResolvedValue({ mrn: 'M1', familyName: '김', givenName: '환자', dateOfBirth: new Date() }) },
      issuedDocument: { findUnique: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }) },
      encounter: { findUnique: vi.fn() },
      staff: { findUnique: vi.fn().mockResolvedValue({ licenseNumber: 'L123' }) },
      // 수수료 규칙엔진(getFeeRules)이 SystemConfig 오버라이드를 조회 — 누락 시 발급 스펙 2건 실패(mock 드리프트)
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      // 🔴 (I2) 배열형뿐 아니라 **콜백형**도 받는다 — 증명서 본문·요청 상태를 한 트랜잭션에서 쓰는 정본 모양.
      //    배열형만 처리하던 종전 목은 콜백을 실행하지 않아 그 안의 쓰기가 통째로 사라졌다.
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    documents = { issue: vi.fn().mockResolvedValue({ issueNo: 'WRB-MEDICAL_RECORD_COPY-20260621-0001', qrUrl: 'q' }) };
    audit = { safeLog: vi.fn() };
    events = { emit: vi.fn() };
    svc = new IssuanceService(prisma, documents, audit, events);
  });

  describe('issue', () => {
    it('멱등: 이미 발급된 요청은 documents.issue 호출 없이 기존 issueNo 반환', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: 'WRB-X', status: 'READY', artifacts: [] });
      const r = await svc.issue('r1', 'u1');
      expect(r).toEqual({ issueNo: 'WRB-X', alreadyIssued: true });
      expect(documents.issue).not.toHaveBeenCalled();
    });

    it('IN_REVIEW 가 아니면 거부', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: null, status: 'REQUESTED', artifacts: [{ sourceIds: ['a'] }] });
      await expect(svc.issue('r1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('동결된 기록(artifact)이 없으면 거부', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: null, status: 'IN_REVIEW', artifacts: [{ sourceIds: [] }] });
      await expect(svc.issue('r1', 'u1')).rejects.toThrow(/EMPTY_SNAPSHOT|동결/);
    });

    it('정상 발급 시 IssuedDocument 생성·READY·이벤트', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({
        id: 'r1', issuedDocumentId: null, status: 'IN_REVIEW', patientId: 'p1', purpose: '보험', periodFrom: null, periodTo: null,
        artifacts: [{ recordType: 'ENCOUNTER', sourceIds: ['e1'], snapshotJson: [{ id: 'e1' }] }],
      });
      const r = await svc.issue('r1', 'u1');
      expect(documents.issue).toHaveBeenCalledOnce();
      expect(r.issueNo).toContain('WRB-MEDICAL_RECORD_COPY');
      expect(r.alreadyIssued).toBe(false);
      expect(events.emit).toHaveBeenCalledWith('document.ready', expect.objectContaining({ requestId: 'r1' }));
    });
  });

  describe('reject', () => {
    it('허용되지 않은 사유는 거부', async () => {
      await expect(svc.reject('r1', 'HACK', undefined, 'u1')).rejects.toThrow(/INVALID_REASON|사유/);
    });

    it('이미 발급된 요청은 반려 불가', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: 'WRB-X', status: 'READY' });
      await expect(svc.reject('r1', 'NO_RECORD', undefined, 'u1')).rejects.toThrow(/ALREADY_ISSUED|발급/);
    });

    it('정상 반려 시 사유 카테고리+상세 기록·이벤트', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: null, status: 'REQUESTED', rejectReason: null, patientId: 'p1' });
      const r = await svc.reject('r1', 'NO_RECORD', '해당 기간 기록 없음', 'u1');
      expect(r).toEqual({ ok: true });
      expect(prisma.documentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
      expect(events.emit).toHaveBeenCalledWith('document.rejected', expect.any(Object));
    });
  });

  describe('createSnapshot', () => {
    it('유효한 기록 유형이 없으면 거부', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: null, patientId: 'p1', status: 'REQUESTED' });
      await expect(svc.createSnapshot('r1', { recordTypes: ['BOGUS'] }, 'u1')).rejects.toThrow(/NO_RECORD_TYPE|선택/);
    });

    it('이미 발급된 요청은 스냅샷 불가', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', issuedDocumentId: 'WRB-X' });
      await expect(svc.createSnapshot('r1', { recordTypes: ['ENCOUNTER'] }, 'u1')).rejects.toThrow(/ALREADY_ISSUED|발급/);
    });
  });

  describe('B그룹 진단서 작성·서명·발급', () => {
    it('author: 의사가 아니면 거부', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', issuedDocumentId: null, status: 'REQUESTED' });
      prisma.user.findUnique.mockResolvedValue({ role: 'NURSE' });
      await expect(svc.authorCertificate('r1', { encounterId: 'e1' }, 'u1')).rejects.toThrow(/DOCTOR_ONLY|의사/);
    });

    it('author: 진단서인데 encounter 없으면 거부', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', issuedDocumentId: null, status: 'REQUESTED' });
      prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
      await expect(svc.authorCertificate('r1', {}, 'u1')).rejects.toThrow(/ENCOUNTER_REQUIRED|진료/);
    });

    it('author: 담당의(직접진찰)가 아니면 거부 — 의료법 §17', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', issuedDocumentId: null, status: 'REQUESTED' });
      prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
      prisma.encounter.findUnique.mockResolvedValue({ patientId: 'p1', doctorId: 'other-doc' });
      await expect(svc.authorCertificate('r1', { encounterId: 'e1' }, 'u1')).rejects.toThrow(/NOT_ATTENDING|직접 진찰/);
    });

    it('author: 담당의 본인이면 artifact 작성·IN_REVIEW', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', issuedDocumentId: null, purpose: '보험', status: 'REQUESTED' });
      prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
      prisma.encounter.findUnique.mockResolvedValue({ patientId: 'p1', doctorId: 'u1' });
      prisma.issuanceArtifact.findFirst.mockResolvedValue(null);
      const r = await svc.authorCertificate('r1', { encounterId: 'e1', diagnoses: [{ name: '고혈압', kcdCode: 'I10' }] }, 'u1');
      expect(r).toEqual({ ok: true });
      expect(prisma.issuanceArtifact.create).toHaveBeenCalled();
    });

    it('sign: 작성자 본인만 서명', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', issuedDocumentId: null, artifacts: [{ id: 'a1', authoredJson: { diagnoses: [] }, createdBy: 'other' }] });
      await expect(svc.signCertificate('r1', 'u1')).rejects.toThrow(/NOT_AUTHOR|작성한 의사/);
    });

    it('issue(B): 서명 없으면 SIGN_REQUIRED', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', issuedDocumentId: null, status: 'IN_REVIEW', artifacts: [{ id: 'a1', authoredJson: { diagnoses: [] }, signedAt: null }] });
      await expect(svc.issue('r1', 'u1')).rejects.toThrow(/SIGN_REQUIRED|서명/);
    });

    it('issue(B): 서명되면 CERTIFICATE 발급', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', patientId: 'p1', purpose: '보험', issuedDocumentId: null, status: 'IN_REVIEW',
        artifacts: [{ id: 'a1', authoredJson: { diagnoses: [{ name: '고혈압' }], treatmentOpinion: 'x' }, signedAt: new Date(), signedBy: 'u1' }] });
      documents.issue.mockResolvedValue({ issueNo: 'WRB-CERTIFICATE-20260621-0001', qrUrl: 'q' });
      const r = await svc.issue('r1', 'u1');
      // 서명한 의사를 넘긴다 — 발급 규칙은 발급자가 아니라 서명 의사로 판정(v4.82 회귀 봉합)
      expect(documents.issue).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'CERTIFICATE' }), 'u1', { preSigned: { signerUserId: expect.any(String) } });
      expect(r.issueNo).toContain('WRB-CERTIFICATE');
    });
  });

  describe('patientDownloadIssueNo', () => {
    it('본인 아님/없음이면 거부', async () => {
      prisma.documentRequest.findFirst.mockResolvedValue(null);
      await expect(svc.patientDownloadIssueNo('p1', 'r1')).rejects.toThrow();
    });

    it('READY 아니면 거부', async () => {
      prisma.documentRequest.findFirst = vi.fn().mockResolvedValue({ id: 'r1', patientId: 'p1', status: 'REQUESTED', issuedDocumentId: null });
      await expect(svc.patientDownloadIssueNo('p1', 'r1')).rejects.toThrow(/NOT_READY|발급/);
    });

    it('포털 수령(PORTAL) READY 본인이면 issueNo 반환 + DELIVERED(수령 시각 함께)', async () => {
      prisma.documentRequest.findFirst = vi.fn().mockResolvedValue({ id: 'r1', patientId: 'p1', status: 'READY', issuedDocumentId: 'WRB-X', deliveryMethod: 'PORTAL' });
      prisma.issuedDocument.findUnique.mockResolvedValue({ patientId: 'p1' });
      const no = await svc.patientDownloadIssueNo('p1', 'r1');
      expect(no).toBe('WRB-X');
      expect(prisma.documentRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'DELIVERED', deliveredAt: expect.any(Date) });
    });

    it('🔴 우편·팩스·방문 신청은 내려받아도 수령 완료로 바꾸지 않는다(송장·창구 수령은 직원이)', async () => {
      for (const deliveryMethod of ['MAIL', 'FAX', 'VISIT']) {
        prisma.documentRequest.update.mockClear();
        prisma.documentRequest.findFirst = vi.fn().mockResolvedValue({ id: 'r1', patientId: 'p1', status: 'READY', issuedDocumentId: 'WRB-X', deliveryMethod });
        prisma.issuedDocument.findUnique.mockResolvedValue({ patientId: 'p1' });
        expect(await svc.patientDownloadIssueNo('p1', 'r1')).toBe('WRB-X');
        expect(prisma.documentRequest.update).not.toHaveBeenCalled();
      }
    });
  });

  // ── 2026-10-10 흐름 추적 보완 ──
  describe('🔴 상태 전이 — 반려·수령된 요청을 되살리지 않는다', () => {
    for (const status of ['REJECTED', 'DELIVERED']) {
      it(`${status} 요청은 동결·작성·반려·발급 모두 거절(REQUEST_NOT_OPEN)`, async () => {
        prisma.documentRequest.findUnique.mockResolvedValue({ id: 'r1', type: 'DIAGNOSIS_CERT', issuedDocumentId: null, patientId: 'p1', status, artifacts: [{ id: 'a1', authoredJson: {}, signedAt: new Date() }] });
        await expect(svc.createSnapshot('r1', { recordTypes: ['ENCOUNTER'] }, 'u1')).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_OPEN' } });
        await expect(svc.authorCertificate('r1', {}, 'u1')).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_OPEN' } });
        await expect(svc.reject('r1', 'OTHER', undefined, 'u1')).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_OPEN' } });
        await expect(svc.issue('r1', 'u1')).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_OPEN' } });
        expect(prisma.documentRequest.update).not.toHaveBeenCalled();
        expect(documents.issue).not.toHaveBeenCalled();
      });
    }
  });

  describe('🔴 발급 수수료는 발급 시점 매수·부수로 다시 센다(신청 때 견적을 보존하지 않는다)', () => {
    it('사본 7매 1부 — 신청 견적 1,000 이 아니라 누진 5×1,000 + 2×100 = 5,200', async () => {
      prisma.documentRequest.findUnique.mockResolvedValue({
        id: 'r1', type: 'MEDICAL_RECORD', copies: 1, fee: 1000, issuedDocumentId: null, status: 'IN_REVIEW', patientId: 'p1', purpose: null, periodFrom: null, periodTo: null,
        artifacts: [{ recordType: 'ENCOUNTER', sourceIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], snapshotJson: [] }],
      });
      await svc.issue('r1', 'u1');
      const call = prisma.$transaction.mock.calls[0][0];
      expect(prisma.documentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY', fee: 5200 }) }));
      expect(call).toBeTruthy();
    });

    it('🔴 수수료 규칙 조회 실패는 기본 금액으로 접지 않고 실패한다', async () => {
      prisma.systemConfig.findUnique.mockRejectedValueOnce(new Error('db down'));
      prisma.documentRequest.findUnique.mockResolvedValue({
        id: 'r1', type: 'MEDICAL_RECORD', copies: 1, fee: null, issuedDocumentId: null, status: 'IN_REVIEW', patientId: 'p1', purpose: null, periodFrom: null, periodTo: null,
        artifacts: [{ recordType: 'ENCOUNTER', sourceIds: ['e1'], snapshotJson: [] }],
      });
      await expect(svc.issue('r1', 'u1')).rejects.toThrow('db down');
      // 발급번호만 남는 반쪽 발급이 없다 — 수수료를 먼저 센다
      expect(documents.issue).not.toHaveBeenCalled();
    });
  });
});
