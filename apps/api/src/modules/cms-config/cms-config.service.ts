import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// 🔴 DTO 는 class-validator 클래스로 승격돼 dto/ 로 옮겼다(interface 는 metatype Object 라 검증 스킵).
//    컨트롤러가 `./cms-config.service` 에서 import 하므로 재export 로 경로를 유지한다.
export {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateMenuDto,
  UpdateMenuDto,
} from './dto/cms-config.dto';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateMenuDto,
  UpdateMenuDto,
} from './dto/cms-config.dto';

@Injectable()
export class CmsConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 카테고리 ──

  async getCategories() {
    return this.prisma.cmsCategory.findMany({
      include: { children: { orderBy: { sortOrder: 'asc' } } },
      where: { parentId: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createCategory(data: CreateCategoryDto) {
    return this.prisma.cmsCategory.create({ data: data as Parameters<typeof this.prisma.cmsCategory.create>[0]['data'] });
  }

  async updateCategory(id: string, data: UpdateCategoryDto) {
    return this.prisma.cmsCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    return this.prisma.cmsCategory.delete({ where: { id } });
  }

  async reorderCategories(items: { id: string; sortOrder: number }[]) {
    for (const item of items) {
      await this.prisma.cmsCategory.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
    }
    return { success: true };
  }

  // ── 메뉴 ──

  async getMenus(group: string) {
    return this.prisma.cmsMenu.findMany({
      where: { menuGroup: group, parentId: null },
      include: { children: { orderBy: { sortOrder: 'asc' }, include: { children: { orderBy: { sortOrder: 'asc' } } } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getPublicMenus(group: string) {
    return this.prisma.cmsMenu.findMany({
      where: { menuGroup: group, parentId: null, isActive: true },
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createMenu(data: CreateMenuDto) {
    return this.prisma.cmsMenu.create({ data: data as Parameters<typeof this.prisma.cmsMenu.create>[0]['data'] });
  }

  async updateMenu(id: string, data: UpdateMenuDto) {
    return this.prisma.cmsMenu.update({ where: { id }, data });
  }

  async deleteMenu(id: string) {
    // 하위 메뉴도 삭제
    await this.prisma.cmsMenu.deleteMany({ where: { parentId: id } });
    return this.prisma.cmsMenu.delete({ where: { id } });
  }

  async reorderMenus(items: { id: string; sortOrder: number }[]) {
    for (const item of items) {
      await this.prisma.cmsMenu.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
    }
    return { success: true };
  }
}
