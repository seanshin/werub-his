import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextMacroService } from '../../src/modules/text-macro/text-macro.service';
import { NotFoundException } from '@nestjs/common';

describe('TextMacroService', () => {
  let service: TextMacroService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      textMacro: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    };
    service = new TextMacroService(mockPrisma);
  });

  it('create saves macro with userId', async () => {
    mockPrisma.textMacro.create.mockResolvedValue({ id: 'm1', shortcut: 'htn', content: '고혈압' });
    const result = await service.create({ category: 'DX', shortcut: 'htn', content: '고혈압' }, 'u1');
    expect(result.shortcut).toBe('htn');
    expect(mockPrisma.textMacro.create.mock.calls[0][0].data.userId).toBe('u1');
  });

  it('findAll returns user macros + shared', async () => {
    mockPrisma.textMacro.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    const result = await service.findAll('u1');
    expect(result).toHaveLength(2);
    const call = mockPrisma.textMacro.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([{ userId: 'u1' }, { isShared: true }]);
  });

  it('findAll filters by category', async () => {
    mockPrisma.textMacro.findMany.mockResolvedValue([]);
    await service.findAll('u1', 'DX');
    const call = mockPrisma.textMacro.findMany.mock.calls[0][0];
    expect(call.where.category).toBe('DX');
  });

  it('expand returns matching macro', async () => {
    mockPrisma.textMacro.findFirst.mockResolvedValue({ id: 'm1', shortcut: 'htn', content: '고혈압' });
    const result = await service.expand('htn', 'u1');
    expect(result.content).toBe('고혈압');
  });

  it('expand throws if not found', async () => {
    mockPrisma.textMacro.findFirst.mockResolvedValue(null);
    await expect(service.expand('xxx', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('remove deletes own macro', async () => {
    mockPrisma.textMacro.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' });
    mockPrisma.textMacro.delete.mockResolvedValue({ id: 'm1' });
    const result = await service.remove('m1', 'u1');
    expect(result.id).toBe('m1');
  });

  it('remove throws if not owner', async () => {
    mockPrisma.textMacro.findUnique.mockResolvedValue({ id: 'm1', userId: 'other' });
    await expect(service.remove('m1', 'u1')).rejects.toThrow(NotFoundException);
  });
});
