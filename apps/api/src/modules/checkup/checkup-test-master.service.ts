import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateCheckupTestMasterDto,
  UpdateCheckupTestMasterDto,
} from './dto/checkup-test-master.dto';

@Injectable()
export class CheckupTestMasterService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    category?: string;
    subCategory?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (query.category) where.category = query.category;
    if (query.subCategory) where.subCategory = query.subCategory;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.checkupTestMaster.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.checkupTestMaster.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('검사항목을 찾을 수 없습니다');
    return item;
  }

  async create(dto: CreateCheckupTestMasterDto) {
    const existing = await this.prisma.checkupTestMaster.findUnique({
      where: { code: dto.code },
    });
    if (existing)
      throw new ConflictException(`검사 코드 '${dto.code}'가 이미 존재합니다`);

    return this.prisma.checkupTestMaster.create({
      data: {
        code: dto.code,
        name: dto.name,
        category: dto.category,
        subCategory: dto.subCategory,
        interpretDept: dto.interpretDept,
        unit: dto.unit,
        referenceRange: dto.referenceRange,
        defaultPrice: dto.defaultPrice ?? 0,
        duration: dto.duration ?? 5,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateCheckupTestMasterDto) {
    await this.findOne(id);

    if (dto.code) {
      const existing = await this.prisma.checkupTestMaster.findFirst({
        where: { code: dto.code, NOT: { id } },
      });
      if (existing)
        throw new ConflictException(`검사 코드 '${dto.code}'가 이미 존재합니다`);
    }

    return this.prisma.checkupTestMaster.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.checkupTestMaster.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** 프로그램에서 사용 중인 코드 집계 */
  async getUsageCounts(): Promise<Record<string, number>> {
    const programs = await this.prisma.checkupProgram.findMany({
      where: { isActive: true },
      select: { items: true, options: true },
    });

    const counts: Record<string, number> = {};
    for (const prog of programs) {
      const items = (prog.items ?? []) as Array<Record<string, unknown>>;
      const options = (prog.options ?? []) as Array<Record<string, unknown>>;
      for (const item of [...items, ...options]) {
        const codes = (item.codes ?? []) as string[];
        for (const code of codes) {
          counts[code] = (counts[code] ?? 0) + 1;
        }
      }
    }
    return counts;
  }
}
