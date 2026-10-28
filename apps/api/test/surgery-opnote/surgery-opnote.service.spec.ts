import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeryOpnoteService } from '../../src/modules/surgery-opnote/surgery-opnote.service';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';

describe('SurgeryOpnoteService', () => {
  let service: SurgeryOpnoteService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      surgeryOpNote: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      // WHO 체크리스트의 정본은 SurgicalChecklist 다(Op Note 의 JSON 사본이 아니다).
      surgicalChecklist: { findUnique: vi.fn() },
    };
    service = new SurgeryOpnoteService(mockPrisma);
  });

  /* ───── getOpNote ───── */

  describe('getOpNote', () => {
    it('should return op note for a surgery', async () => {
      const note = {
        id: 'n-1', surgeryId: 'surg-1', findings: 'Normal anatomy',
        surgery: { id: 'surg-1', status: 'COMPLETED', scheduledAt: new Date() },
        creator: { familyName: '김', givenName: '외과' },
      };
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(note);
      const result = await service.getOpNote('surg-1');
      expect(result).toEqual(note);
      expect(mockPrisma.surgeryOpNote.findUnique).toHaveBeenCalledWith({
        where: { surgeryId: 'surg-1' },
        include: {
          surgery: { select: { id: true, status: true, scheduledAt: true } },
          creator: { select: { familyName: true, givenName: true } },
        },
      });
    });

    it('should throw NotFoundException when op note not found', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(null);
      await expect(service.getOpNote('surg-none')).rejects.toThrow('Op note not found');
    });

    it('should throw with surgery ID in error message', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(null);
      await expect(service.getOpNote('surg-abc')).rejects.toThrow('surg-abc');
    });
  });

  /* ───── createOpNote ───── */

  describe('createOpNote', () => {
    it('should create an op note with required fields', async () => {
      const input = { surgeryId: 'surg-1', createdBy: 'doc-1' };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-new', ...input });
      const result = await service.createOpNote(input);
      expect(result.id).toBe('n-new');
    });

    it('should create op note with full data', async () => {
      const input = {
        surgeryId: 'surg-1',
        preOpDiagnosis: 'Appendicitis',
        postOpDiagnosis: 'Acute appendicitis',
        procedureCode: '47.09',
        anesthesiaType: 'GENERAL',
        findings: 'Inflamed appendix',
        estimatedBloodLoss: 50,
        narrative: 'Standard appendectomy performed',
        asaClass: 2,
        vteProphylaxis: true,
        createdBy: 'doc-1',
      };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-full', ...input });
      const result = await service.createOpNote(input);
      expect(result.id).toBe('n-full');
    });

    it('should convert incisionTime string to Date', async () => {
      const input = {
        surgeryId: 'surg-1',
        incisionTime: '2026-05-20T09:00:00Z',
        closureTime: '2026-05-20T11:00:00Z',
        createdBy: 'doc-1',
      };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-time' });
      await service.createOpNote(input);
      const callArg = mockPrisma.surgeryOpNote.create.mock.calls[0][0];
      expect(callArg.data.incisionTime).toBeInstanceOf(Date);
      expect(callArg.data.closureTime).toBeInstanceOf(Date);
    });

    it('should handle undefined time fields', async () => {
      const input = { surgeryId: 'surg-1', createdBy: 'doc-1' };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-notime' });
      await service.createOpNote(input);
      const callArg = mockPrisma.surgeryOpNote.create.mock.calls[0][0];
      expect(callArg.data.incisionTime).toBeUndefined();
      expect(callArg.data.closureTime).toBeUndefined();
    });

    it('should pass WHO checklist as JSON', async () => {
      const input = {
        surgeryId: 'surg-1',
        whoChecklist: { signIn: true, timeOut: true, signOut: false },
        createdBy: 'doc-1',
      };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-who' });
      await service.createOpNote(input);
      const callArg = mockPrisma.surgeryOpNote.create.mock.calls[0][0];
      expect(callArg.data.whoChecklist).toEqual({ signIn: true, timeOut: true, signOut: false });
    });

    it('should include surgery and creator in response', async () => {
      const input = { surgeryId: 'surg-1', createdBy: 'doc-1' };
      mockPrisma.surgeryOpNote.create.mockResolvedValue({ id: 'n-inc' });
      await service.createOpNote(input);
      expect(mockPrisma.surgeryOpNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            surgery: { select: { id: true, status: true } },
            creator: { select: { familyName: true, givenName: true } },
          },
        }),
      );
    });
  });

  /* ───── updateOpNote ───── */

  describe('updateOpNote', () => {
    it('should update an existing op note', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ id: 'n-1' });
      mockPrisma.surgeryOpNote.update.mockResolvedValue({ id: 'n-1', findings: 'Updated findings' });
      const result = await service.updateOpNote('n-1', { findings: 'Updated findings' });
      expect(result.findings).toBe('Updated findings');
    });

    it('should throw NotFoundException when note not found', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(null);
      await expect(service.updateOpNote('n-none', { findings: 'test' })).rejects.toThrow('Op note n-none not found');
    });

    it('should convert incisionTime on update', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ id: 'n-1' });
      mockPrisma.surgeryOpNote.update.mockResolvedValue({ id: 'n-1' });
      await service.updateOpNote('n-1', { incisionTime: '2026-05-20T10:00:00Z' });
      const callArg = mockPrisma.surgeryOpNote.update.mock.calls[0][0];
      expect(callArg.data.incisionTime).toBeInstanceOf(Date);
    });

    it('should update partial fields', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ id: 'n-1' });
      mockPrisma.surgeryOpNote.update.mockResolvedValue({ id: 'n-1', estimatedBloodLoss: 100 });
      await service.updateOpNote('n-1', { estimatedBloodLoss: 100 });
      const callArg = mockPrisma.surgeryOpNote.update.mock.calls[0][0];
      expect(callArg.data.estimatedBloodLoss).toBe(100);
    });

    it('should include surgery and creator in response', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ id: 'n-1' });
      mockPrisma.surgeryOpNote.update.mockResolvedValue({ id: 'n-1' });
      await service.updateOpNote('n-1', {});
      expect(mockPrisma.surgeryOpNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            surgery: { select: { id: true, status: true } },
            creator: { select: { familyName: true, givenName: true } },
          },
        }),
      );
    });
  });

  /* ───── getWhoChecklist ───── */

  /**
   * 🔴 2026-08-18 계약 변경 — 이 EP 는 `SurgeryOpNote.whoChecklist`(JSON 3-boolean)를 읽었고,
   *    그 컬럼을 쓰는 화면은 **하나도 없었다**. 즉 아래 테스트들은 "늘 false 를 돌려주는 고아 EP"를
   *    통과시키고 있었다(목만 통과하는 테스트). 정본(`SurgicalChecklist`)에서 파생하도록 바꾸고
   *    테스트도 그 계약으로 옮긴다.
   */
  describe('getWhoChecklist — 정본(SurgicalChecklist)에서 파생', () => {
    /** 필수 항목을 전부 채운 정본 1행 */
    const fullChecklist = (): Record<string, unknown> => {
      const cl: Record<string, unknown> = { surgeryId: 'surg-1', signInCompletedAt: new Date(), timeOutCompletedAt: new Date(), signOutCompletedAt: new Date(), countStatus: 'MATCH' };
      for (const ph of ['signIn', 'timeOut', 'signOut'] as const) {
        for (const i of SurgeryAdvancedService.CHECKLIST_ITEMS[ph]) if (i.required) cl[i.field] = true;
      }
      return cl;
    };

    it('필수 항목이 전 단계 충족이면 complete=true', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ whoChecklist: null });
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(fullChecklist());
      const result = await service.getWhoChecklist('surg-1');
      expect(result.source).toBe('SurgicalChecklist');
      expect(result.complete).toBe(true);
      expect(result.signIn).toBe(true);
      expect(result.timeOut).toBe(true);
      expect(result.signOut).toBe(true);
    });

    it('한 단계라도 필수 항목이 비면 complete=false', async () => {
      const cl = fullChecklist();
      cl.signOutInstrumentCount = false;
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ whoChecklist: null });
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(cl);
      const result = await service.getWhoChecklist('surg-1');
      expect(result.complete).toBe(false);
      expect(result.signOut).toBe(false);
      expect(result.signIn).toBe(true);
    });

    it('🔴 레거시 JSON 사본이 정본과 어긋나도 정본을 따르고, 사본을 감추지 않는다', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ whoChecklist: { signIn: false, timeOut: false, signOut: false } });
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(fullChecklist());
      const result = await service.getWhoChecklist('surg-1');
      expect(result.complete).toBe(true);
      expect(result.legacyOpNoteBlob).toEqual({ signIn: false, timeOut: false, signOut: false });
    });

    it('🔴 체크리스트 미작성은 "전부 false" 가 아니라 404 — 모르는 것을 아는 것처럼 말하지 않는다', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(null);
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(null);
      await expect(service.getWhoChecklist('surg-none')).rejects.toThrow(/체크리스트/);
    });

    it('Op Note 가 없어도 체크리스트가 있으면 답한다', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue(null);
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(fullChecklist());
      const result = await service.getWhoChecklist('surg-1');
      expect(result.complete).toBe(true);
      expect(result.legacyOpNoteBlob).toBeNull();
    });

    it('정본을 surgeryId 로 조회한다', async () => {
      mockPrisma.surgeryOpNote.findUnique.mockResolvedValue({ whoChecklist: null });
      mockPrisma.surgicalChecklist.findUnique.mockResolvedValue(fullChecklist());
      await service.getWhoChecklist('surg-1');
      expect(mockPrisma.surgicalChecklist.findUnique).toHaveBeenCalledWith({ where: { surgeryId: 'surg-1' } });
    });
  });
});
