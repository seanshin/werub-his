import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class NonCoveredService {
  constructor(private readonly prisma: PrismaService) {}

  list(category?: string, activeOnly = false) {
    const where: Prisma.NonCoveredItemWhereInput = {};
    if (category) where.category = category;
    if (activeOnly) where.isActive = true;
    return this.prisma.nonCoveredItem.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  create(data: { code: string; name: string; category: string; price: number; description?: string; requiresConsent?: boolean }) {
    return this.prisma.nonCoveredItem.create({ data });
  }

  async update(id: string, data: Partial<{ code: string; name: string; category: string; price: number; description?: string; requiresConsent?: boolean }>) {
    await this.ensure(id);
    return this.prisma.nonCoveredItem.update({ where: { id }, data });
  }

  async toggle(id: string) {
    const cur = await this.ensure(id);
    return this.prisma.nonCoveredItem.update({ where: { id }, data: { isActive: !cur.isActive } });
  }

  async remove(id: string) {
    await this.ensure(id);
    await this.prisma.nonCoveredItem.delete({ where: { id } });
    return { ok: true };
  }

  private async ensure(id: string) {
    const item = await this.prisma.nonCoveredItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('비급여 항목을 찾을 수 없습니다.');
    return item;
  }
}
