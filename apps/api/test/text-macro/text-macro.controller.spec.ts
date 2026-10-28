import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextMacroController } from '../../src/modules/text-macro/text-macro.controller';
import { TextMacroService } from '../../src/modules/text-macro/text-macro.service';

describe('TextMacroController', () => {
  let controller: TextMacroController;
  let mockService: any;

  beforeEach(() => {
    mockService = { create: vi.fn(), findAll: vi.fn(), expand: vi.fn(), remove: vi.fn() };
    controller = new TextMacroController(mockService as TextMacroService);
  });

  it('create wraps in { data }', async () => {
    mockService.create.mockResolvedValue({ id: 'm1' });
    expect((await controller.create({ category: 'DX', shortcut: 'htn', content: '고혈압' } as any, 'u1')).data.id).toBe('m1');
  });

  it('findAll wraps in { data }', async () => {
    mockService.findAll.mockResolvedValue([{ id: 'm1' }]);
    expect((await controller.findAll('u1')).data).toHaveLength(1);
  });

  it('expand wraps in { data }', async () => {
    mockService.expand.mockResolvedValue({ id: 'm1', content: '고혈압' });
    expect((await controller.expand('htn', 'u1')).data.content).toBe('고혈압');
  });

  it('remove returns deleted true', async () => {
    mockService.remove.mockResolvedValue(undefined);
    expect((await controller.remove('m1', 'u1')).data.deleted).toBe(true);
  });
});
