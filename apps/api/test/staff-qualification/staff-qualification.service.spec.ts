import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StaffQualificationService,
  effectiveCredentialStatus,
} from '../../src/modules/staff-qualification/staff-qualification.service';

/**
 * SQE 면허·자격 원장 가드 (2026-08 W7 화면 실사용 점검)
 *
 * 이 스펙이 지키는 사실:
 *  · 표본 0 은 "이상 없음"이 아니다 — 원장이 비어 있으면 화면이 초록 ✓ 를 낼 근거가 없어야 한다.
 *  · 만료 판정은 한 벌이다 — 집계(카드)와 행(표)이 같은 규칙을 쓴다.
 *  · 재이수 추적은 한 카테고리에 갇히지 않는다.
 *  · 목록/패널 상한은 화면이 말할 수 있게 total·truncated 로 함께 나온다.
 */
describe('StaffQualificationService', () => {
  let service: StaffQualificationService;
  let prisma: any;
  const outbox = { enqueue: vi.fn() } as any;

  beforeEach(() => {
    prisma = {
      staffCredential: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      staffEducation: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      staff: { count: vi.fn().mockResolvedValue(0) },
    };
    service = new StaffQualificationService(prisma, outbox);
  });

  describe('effectiveCredentialStatus (만료 판정 정본)', () => {
    const now = new Date('2026-08-14T00:00:00Z');
    it('만료일이 지났으면 EXPIRED', () => {
      expect(effectiveCredentialStatus('VALID', new Date('2026-01-01T00:00:00Z'), now)).toBe('EXPIRED');
    });
    it('만료일이 없거나 미래면 저장된 상태를 그대로 쓴다', () => {
      expect(effectiveCredentialStatus('VALID', null, now)).toBe('VALID');
      expect(effectiveCredentialStatus('SUSPENDED', null, now)).toBe('SUSPENDED');
      expect(effectiveCredentialStatus('EXPIRED', new Date('2027-01-01T00:00:00Z'), now)).toBe('EXPIRED');
    });
  });

  describe('listCredentials', () => {
    // 🔴 원 결함: 상한 200 에 표식이 없어 잘린 사실을 아무도 몰랐다.
    it('total·limit·truncated 를 함께 돌려준다', async () => {
      prisma.staffCredential.count.mockResolvedValue(250);
      prisma.staffCredential.findMany.mockResolvedValue(
        Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, userId: 'u1', status: 'VALID', expiresAt: null })),
      );
      const res = await service.listCredentials({});
      expect(res.total).toBe(250);
      expect(res.limit).toBe(200);
      expect(res.truncated).toBe(true);
      expect(res.items).toHaveLength(200);
    });

    it('행의 effectiveStatus 는 집계와 같은 정본 함수로 만든다', async () => {
      prisma.staffCredential.count.mockResolvedValue(1);
      prisma.staffCredential.findMany.mockResolvedValue([
        { id: 'c1', userId: 'u1', status: 'VALID', expiresAt: new Date('2020-01-01T00:00:00Z') },
      ]);
      const res = await service.listCredentials({});
      expect(res.items[0].effectiveStatus).toBe('EXPIRED');
    });
  });

  describe('getDashboard — 표본 0 은 "이상 없음"이 아니다', () => {
    beforeEach(() => {
      // 실측 상태 재현: staff_credentials 0행 · 활성 임상직 75명 · 인사원장 면허번호 51건
      prisma.staffCredential.count.mockResolvedValue(0);
      prisma.staffCredential.findMany.mockResolvedValue([]);
      prisma.staffCredential.groupBy.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(75);
      prisma.staff.count.mockResolvedValue(51);
    });

    // 🔴 원 결함: 등록 0·만료 0·미검증 0 인데 만료 임박 패널이 emerald 초록으로
    //    "임박한 만료가 없습니다 ✓" 라고 안심시켰다. 화면이 그 판단을 못 하게 근거를 서버가 준다.
    it('원장이 비어 있으면 ledger.built=false 로 "미구축"을 명시한다', async () => {
      const d = await service.getDashboard();
      expect(d.credentials.total).toBe(0);
      expect(d.credentials.ledger.built).toBe(false);
      expect(d.credentials.ledger.clinicalStaffActive).toBe(75);
      expect(d.credentials.ledger.staffWithCredential).toBe(0);
      expect(d.credentials.ledger.registrationRate).toBe(0);
    });

    // 🔴 면허 정본이 둘 — 인사 원장에 51건이 있는데 SQE 는 staff_credentials 만 본다.
    //    합치지 않되(설계 판단 대기), 화면이 그 사실을 말할 수 있게 건수를 노출한다.
    it('인사 원장(staff.license_number) 건수를 별도로 알리되 합치지 않는다', async () => {
      const d = await service.getDashboard();
      expect(d.credentials.ledger.hrLicenseNumberRows).toBe(51);
      expect(d.credentials.total).toBe(0); // 합산되지 않았음
      expect(d.credentials.ledger.hrLedgerNote).toContain('별개');
    });

    it('분모가 0이면 등록률은 0 이 아니라 null(산출 불가)', async () => {
      prisma.user.count.mockResolvedValue(0);
      const d = await service.getDashboard();
      expect(d.credentials.ledger.registrationRate).toBeNull();
    });
  });

  describe('getDashboard — 집계 규칙', () => {
    // 🔴 원 결함: 카드는 `expiresAt < now` 만 세어, 관리자가 EXPIRED 로 바꾼 건이 빠졌다.
    it('만료 집계는 만료일 경과 OR 상태 EXPIRED 를 모두 센다', async () => {
      await service.getDashboard();
      const expiredCall = prisma.staffCredential.count.mock.calls[1][0];
      expect(expiredCall.where.OR).toEqual([
        { expiresAt: { lt: expect.any(Date) } },
        { status: 'EXPIRED' },
      ]);
    });

    // 🔴 원 결함: 재이수 추적이 category='MANDATORY' 한 종에만 걸려
    //    감염관리(13)·환자안전(1)·보수교육(7)이 통째로 추적 밖이었다.
    it('교육 만료 추적을 특정 카테고리로 제한하지 않는다', async () => {
      await service.getDashboard();
      const eduWheres = prisma.staffEducation.findMany.mock.calls.map((c: any[]) => c[0].where);
      expect(eduWheres.length).toBeGreaterThanOrEqual(2);
      for (const w of eduWheres) expect(w.category).toBeUndefined();
    });

    // 🔴 원 결함: `expiresAt: { lt: in30 }` 로 초과와 임박을 한 목록에 섞었다.
    it('교육 초과(경과)와 임박(도래 예정)을 분리하고 임박에는 하한이 있다', async () => {
      const d = await service.getDashboard();
      const [overdueWhere, dueSoonWhere] = prisma.staffEducation.findMany.mock.calls.map((c: any[]) => c[0].where);
      expect(overdueWhere.expiresAt.lt).toBeInstanceOf(Date);
      expect(overdueWhere.expiresAt.gte).toBeUndefined();
      expect(dueSoonWhere.expiresAt.gte).toBeInstanceOf(Date);
      expect(dueSoonWhere.expiresAt.lt).toBeInstanceOf(Date);
      expect(d.education.overdue).toBeDefined();
      expect(d.education.dueSoon).toBeDefined();
    });

    // 🔴 원 결함: 패널 상한 20 에 표식이 없었다.
    it('패널 상한과 total 을 함께 내보내 잘렸음을 알린다', async () => {
      prisma.staffCredential.count.mockResolvedValue(5);
      prisma.staffCredential.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, userId: 'u1', status: 'VALID', expiresAt: new Date(Date.now() + 86400000) })),
      );
      const d = await service.getDashboard();
      expect(d.panelLimit).toBe(20);
      expect(d.credentials.expiringSoonTotal).toBe(5);
      // findMany 가 상한만큼 돌려줬는데 total 이 더 크면 truncated
      prisma.staffCredential.count.mockResolvedValue(40);
      const d2 = await service.getDashboard();
      expect(d2.credentials.expiringSoonTruncated).toBe(true);
    });

    it('기한 없는 교육 기록 수를 별도로 알린다(추적 불가 사실)', async () => {
      const d = await service.getDashboard();
      expect(d.education.withoutDueDate).toBeDefined();
    });
  });
});
