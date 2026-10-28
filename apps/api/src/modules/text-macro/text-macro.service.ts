import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class TextMacroService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { category: string; shortcut: string; content: string; isShared?: boolean }, userId: string) {
    return this.prisma.textMacro.create({
      data: { userId, category: data.category, shortcut: data.shortcut, content: data.content, isShared: data.isShared ?? false },
    });
  }

  async findAll(userId: string, category?: string) {
    const where: Prisma.TextMacroWhereInput = { OR: [{ userId }, { isShared: true }] };
    if (category) where.category = category;
    return this.prisma.textMacro.findMany({ where, orderBy: { shortcut: 'asc' } });
  }

  async expand(shortcut: string, userId: string) {
    const macro = await this.prisma.textMacro.findFirst({
      where: { shortcut, OR: [{ userId }, { isShared: true }] },
    });
    if (!macro) throw new NotFoundException(`Macro '${shortcut}' not found`);
    return macro;
  }

  async remove(id: string, userId: string) {
    const macro = await this.prisma.textMacro.findUnique({ where: { id } });
    if (!macro || macro.userId !== userId) throw new NotFoundException('Macro not found');
    return this.prisma.textMacro.delete({ where: { id } });
  }
}
