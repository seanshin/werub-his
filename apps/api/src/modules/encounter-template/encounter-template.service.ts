import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class EncounterTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { department: string; name: string; description?: string; soapSections: any; version: string }, userId: string) {
    return this.prisma.encounterTemplate.create({
      data: {
        department: data.department,
        name: data.name,
        description: data.description,
        soapSections: data.soapSections as unknown as Prisma.InputJsonValue,
        version: data.version,
        createdBy: userId,
      },
    });
  }

  async findAll(department?: string) {
    const where: Prisma.EncounterTemplateWhereInput = { isActive: true };
    if (department) where.department = department;
    return this.prisma.encounterTemplate.findMany({ where, orderBy: { department: 'asc' } });
  }

  async findById(id: string) {
    const t = await this.prisma.encounterTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Encounter template not found');
    return t;
  }

  async update(id: string, data: Partial<{ department: string; name: string; description: string; soapSections: any; version: string; isActive: boolean }>) {
    await this.findById(id);
    return this.prisma.encounterTemplate.update({
      where: { id },
      data: {
        ...(data.department !== undefined && { department: data.department }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.soapSections !== undefined && { soapSections: data.soapSections as unknown as Prisma.InputJsonValue }),
        ...(data.version !== undefined && { version: data.version }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }
}
