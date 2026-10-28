import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeryOpnoteController } from '../../src/modules/surgery-opnote/surgery-opnote.controller';

describe('SurgeryOpnoteController', () => {
  let controller: SurgeryOpnoteController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getOpNote: vi.fn(),
      createOpNote: vi.fn(),
      updateOpNote: vi.fn(),
      getWhoChecklist: vi.fn(),
    };
    controller = new SurgeryOpnoteController(mockService);
  });

  describe('getOpNote', () => {
    it('should return { data: opNote }', async () => {
      const note = { id: 'n-1', surgeryId: 'surg-1', findings: 'Normal' };
      mockService.getOpNote.mockResolvedValue(note);
      const result = await controller.getOpNote('surg-1');
      expect(result).toEqual({ data: note });
      expect(mockService.getOpNote).toHaveBeenCalledWith('surg-1');
    });

    it('should pass surgeryId to service', async () => {
      mockService.getOpNote.mockResolvedValue({});
      await controller.getOpNote('surgery-uuid-1');
      expect(mockService.getOpNote).toHaveBeenCalledWith('surgery-uuid-1');
    });

    it('should propagate NotFoundException', async () => {
      mockService.getOpNote.mockRejectedValue(new Error('Op note not found'));
      await expect(controller.getOpNote('surg-none')).rejects.toThrow('Op note not found');
    });
  });

  describe('createOpNote', () => {
    it('should return { data: created }', async () => {
      const body = { surgeryId: 'surg-1', preOpDiagnosis: 'Appendicitis' };
      mockService.createOpNote.mockResolvedValue({ id: 'n-new' });
      const result = await controller.createOpNote(body as any, 'doc-1');
      expect(result).toEqual({ data: { id: 'n-new' } });
    });

    it('should merge userId as createdBy', async () => {
      const body = { surgeryId: 'surg-1' };
      mockService.createOpNote.mockResolvedValue({ id: 'n-2' });
      await controller.createOpNote(body as any, 'doctor-uuid-1');
      expect(mockService.createOpNote).toHaveBeenCalledWith({ ...body, createdBy: 'doctor-uuid-1' });
    });

    it('should pass all body fields', async () => {
      const body = {
        surgeryId: 'surg-1', preOpDiagnosis: 'Hernia',
        postOpDiagnosis: 'Inguinal hernia', anesthesiaType: 'GENERAL',
        estimatedBloodLoss: 30,
      };
      mockService.createOpNote.mockResolvedValue({ id: 'n-3' });
      await controller.createOpNote(body as any, 'doc-1');
      expect(mockService.createOpNote).toHaveBeenCalledWith({ ...body, createdBy: 'doc-1' });
    });
  });

  describe('updateOpNote', () => {
    it('should return { data: updated }', async () => {
      const body = { findings: 'Updated findings' };
      mockService.updateOpNote.mockResolvedValue({ id: 'n-1', findings: 'Updated findings' });
      const result = await controller.updateOpNote('n-1', body as any);
      expect(result).toEqual({ data: { id: 'n-1', findings: 'Updated findings' } });
      expect(mockService.updateOpNote).toHaveBeenCalledWith('n-1', body);
    });

    it('should pass id and body to service', async () => {
      const body = { estimatedBloodLoss: 100 };
      mockService.updateOpNote.mockResolvedValue({ id: 'n-1' });
      await controller.updateOpNote('note-uuid-1', body as any);
      expect(mockService.updateOpNote).toHaveBeenCalledWith('note-uuid-1', body);
    });

    it('should propagate NotFoundException', async () => {
      mockService.updateOpNote.mockRejectedValue(new Error('Op note not found'));
      await expect(controller.updateOpNote('n-none', {} as any)).rejects.toThrow('Op note not found');
    });
  });

  describe('getWhoChecklist', () => {
    it('should return { data: checklist }', async () => {
      const checklist = { surgeryId: 'surg-1', signIn: true, timeOut: true, signOut: true, complete: true };
      mockService.getWhoChecklist.mockResolvedValue(checklist);
      const result = await controller.getWhoChecklist('surg-1');
      expect(result).toEqual({ data: checklist });
      expect(mockService.getWhoChecklist).toHaveBeenCalledWith('surg-1');
    });

    it('should pass surgeryId to service', async () => {
      mockService.getWhoChecklist.mockResolvedValue({ complete: false });
      await controller.getWhoChecklist('surgery-uuid-1');
      expect(mockService.getWhoChecklist).toHaveBeenCalledWith('surgery-uuid-1');
    });

    it('should propagate NotFoundException', async () => {
      mockService.getWhoChecklist.mockRejectedValue(new Error('Op note not found'));
      await expect(controller.getWhoChecklist('surg-none')).rejects.toThrow('Op note not found');
    });
  });
});
