import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateCheckupProgramDto,
  UpdateCheckupProgramDto,
} from './dto/checkup-program.dto';

@Injectable()
export class CheckupProgramService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    category?: string;
    gender?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (query.category) where.category = query.category;
    if (query.gender) where.gender = { in: [query.gender, 'ALL'] };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.checkupProgram.findMany({
      where,
      include: { _count: { select: { visits: true } } },
      orderBy: [{ category: 'asc' }, { price: 'asc' }],
    });
  }

  async findOne(id: string) {
    const program = await this.prisma.checkupProgram.findUnique({
      where: { id },
      include: {
        _count: { select: { visits: true } },
      },
    });

    if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');
    return program;
  }

  async create(dto: CreateCheckupProgramDto) {
    const existing = await this.prisma.checkupProgram.findUnique({
      where: { code: dto.code },
    });
    if (existing)
      throw new ConflictException(`프로그램 코드 '${dto.code}'가 이미 존재합니다`);

    return this.prisma.checkupProgram.create({
      data: {
        code: dto.code,
        name: dto.name,
        category: dto.category,
        description: dto.description,
        gender: dto.gender ?? 'ALL',
        ageMin: dto.ageMin,
        ageMax: dto.ageMax,
        price: dto.price,
        discountRate: dto.discountRate ?? 0,
        duration: dto.duration ?? 120,
        dailyCapacity: dto.dailyCapacity ?? null,
        items: dto.items as Prisma.InputJsonValue,
        options: dto.options as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateCheckupProgramDto) {
    await this.findOne(id);

    if (dto.code) {
      const existing = await this.prisma.checkupProgram.findFirst({
        where: { code: dto.code, NOT: { id } },
      });
      if (existing)
        throw new ConflictException(`프로그램 코드 '${dto.code}'가 이미 존재합니다`);
    }

    return this.prisma.checkupProgram.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.ageMin !== undefined && { ageMin: dto.ageMin }),
        ...(dto.ageMax !== undefined && { ageMax: dto.ageMax }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.discountRate !== undefined && { discountRate: dto.discountRate }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.dailyCapacity !== undefined && { dailyCapacity: dto.dailyCapacity }),
        ...(dto.items !== undefined && { items: dto.items as Prisma.InputJsonValue }),
        ...(dto.options !== undefined && { options: dto.options as Prisma.InputJsonValue }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.checkupProgram.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
