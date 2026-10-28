import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PharmacistActivityService } from '../../src/modules/pharmacist-activity/pharmacist-activity.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PharmacistActivityService', () => {
  let service: PharmacistActivityService;
  let adrStore: any[];
  let aspStore: any[];

  beforeEach(() => {
    adrStore = [];
    aspStore = [
      { id: 'asp-001', patientId: 'pt-1', antimicrobialName: 'Meropenem', indication: 'x', status: 'PENDING', requestedAt: new Date() },
      { id: 'asp-002', patientId: 'pt-2', antimicrobialName: 'Colistin', indication: 'y', status: 'APPROVED', requestedAt: new Date() },
      { id: 'asp-003', patientId: 'pt-3', antimicrobialName: 'Linezolid', indication: 'z', status: 'PENDING', requestedAt: new Date() },
    ];
    const prisma: any = {
      adverseReactionReport: {
        create: vi.fn(async ({ data }: any) => { const r = { id: `id-${adrStore.length}`, createdAt: new Date(), reporterId: data.reporterId, ...data, onsetDate: data.onsetDate instanceof Date ? data.onsetDate : new Date(data.onsetDate) }; adrStore.unshift(r); return r; }),
        findMany: vi.fn(async () => adrStore.map((r) => ({ ...r, patient: { familyName: '테', givenName: '스트' } }))),
        count: vi.fn(async () => adrStore.length),
      },
      aspRequest: {
        create: vi.fn(async ({ data }: any) => { const r = { id: `asp-new-${aspStore.length}`, status: 'PENDING', requestedAt: new Date(), ...data }; aspStore.unshift(r); return r; }),
        findMany: vi.fn(async (args: any = {}) => { const w = args.where; return w?.status ? aspStore.filter((a) => a.status === w.status) : aspStore; }),
        findUnique: vi.fn(async ({ where }: any) => aspStore.find((a) => a.id === where.id) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const a = aspStore.find((x) => x.id === where.id && x.status === where.status); if (!a) return { count: 0 }; Object.assign(a, data); return { count: 1 }; }),
        count: vi.fn(async (args: any = {}) => { const w = args.where; return (w?.status ? aspStore.filter((a) => a.status === w.status) : aspStore).length; }),
      },
      patient: { findMany: vi.fn(async () => []) },
    };
    service = new PharmacistActivityService(prisma);
  });

  /*
   * ── Interventions / TDM ──
   * 인메모리 → DB 영속화(2026-08-18)로 이관.
   * 종전 이 자리의 테스트는 **인메모리 구현을 동결**하고 있었다:
   *   · `expect(intervention.id).toMatch(/^intv-/)` — 메모리에서 만든 접두 id
   *   · `expect(trend.length).toBeGreaterThanOrEqual(5)` — 하드코딩 추이를 통과시킴
   *   · `expect(typeof acceptanceRate).toBe('number')` — 분모 부재의 "0%" 를 정답으로 못박음
   * 새 가드: test/pharmacist-activity/pharmacist-activity-persistence.spec.ts
   */

  /* ── ADR ─────────────────────────────────── */

  describe('getAdrReports', () => {
    it('should return persisted ADR reports (mapped shape)', async () => {
      await service.createAdrReport({ patientId: 'pt-1', patientName: 'A', suspectedDrug: 'D1', reaction: 'r', severity: 'MILD', onsetDate: '2026-05-20', outcome: 'o', causalityAssessment: 'Possible', reportedBy: '00000000-0000-4000-a000-0000000000a1' });
      const result = await service.getAdrReports();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].suspectedDrug).toBe('D1');
      expect(result[0].patientName).toBe('테스트');
    });
  });

  describe('createAdrReport', () => {
    it('should create a new ADR report', async () => {
      const report = await service.createAdrReport({
        patientId: 'pt-400',
        patientName: '최테스트',
        suspectedDrug: 'Penicillin',
        reaction: '아나필락시스',
        severity: 'SEVERE',
        onsetDate: '2026-05-22',
        outcome: '에피네프린 투여 후 회복',
        causalityAssessment: 'Certain',
        kaersReportId: 'KAERS-TEST-001',
        reportedBy: 'ph-002',
      });

      expect(report.id).toBeDefined();
      expect(report.severity).toBe('SEVERE');
      expect(report.suspectedDrug).toBe('Penicillin');
      expect(report.reportedAt).toBeDefined();
    });

    it('should persist the report in the list', async () => {
      const created = await service.createAdrReport({
        patientId: 'pt-500',
        patientName: '박테스트',
        suspectedDrug: 'Ibuprofen',
        reaction: '위장 출혈',
        severity: 'MODERATE',
        onsetDate: '2026-05-21',
        outcome: '투약 중단',
        causalityAssessment: 'Probable',
        reportedBy: 'ph-001',
      });

      const all = await service.getAdrReports();
      expect(all.find(r => r.id === created.id)).toBeDefined();
    });
  });

  /* ── ASP ─────────────────────────────────── */

  describe('getAspRequests', () => {
    it('should return all ASP requests', async () => {
      const result = await service.getAspRequests();

      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by status', async () => {
      const result = await service.getAspRequests('PENDING');

      for (const item of result) {
        expect(item.status).toBe('PENDING');
      }
    });
  });

  describe('createAspRequest', () => {
    it('should create an ASP request with PENDING status', async () => {
      const req = await service.createAspRequest({
        patientId: 'pt-600',
        patientName: '이테스트',
        antimicrobialName: 'Piperacillin/Tazobactam 4.5g IV q6h',
        indication: '복강내 감염',
        duration: 7,
        durationUnit: 'days',
        requestedBy: 'dr-010',
      });

      expect(req.id).toMatch(/^asp-/);
      expect(req.status).toBe('PENDING');
      expect(req.antimicrobialName).toContain('Piperacillin');
      expect(req.duration).toBe(7);
    });
  });

  describe('handleAspRequest', () => {
    it('should approve a pending ASP request', async () => {
      const result = await service.handleAspRequest('asp-001', true, {
        reviewedBy: 'ph-001',
        reviewComment: '적절한 항생제 선택',
      });

      expect(result.status).toBe('APPROVED');
      expect(result.reviewedBy).toBe('ph-001');
      expect(result.reviewComment).toBe('적절한 항생제 선택');
      expect(result.reviewedAt).toBeDefined();
    });

    it('should reject a pending ASP request', async () => {
      // Create a fresh one to reject
      const created = await service.createAspRequest({
        patientId: 'pt-700',
        patientName: '정테스트',
        antimicrobialName: 'Imipenem 500mg IV q6h',
        indication: '요로감염',
        duration: 14,
        durationUnit: 'days',
        requestedBy: 'dr-020',
      });

      const result = await service.handleAspRequest(created.id, false, {
        reviewedBy: 'ph-002',
        reviewComment: '7일 단축 또는 de-escalation 권고',
      });

      expect(result.status).toBe('REJECTED');
    });

    it('should throw NotFoundException for unknown ASP request', async () => {
      await expect(
        service.handleAspRequest('asp-999', true, { reviewedBy: 'ph-001' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for already-processed ASP request', async () => {
      // asp-002 is already APPROVED from mock data
      await expect(
        service.handleAspRequest('asp-002', false, { reviewedBy: 'ph-001' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

});
