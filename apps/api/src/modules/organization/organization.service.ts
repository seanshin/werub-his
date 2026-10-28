import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { safeFetch } from '../../common/util/safe-fetch';

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger('OrganizationService');

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.organization.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: {
    code: string;
    name: string;
    orgType: string;
    grade?: string;
    country?: string;
    address?: any;
    phone?: string;
    fhirEndpoint?: string;
  }) {
    return this.prisma.organization.create({ data: dto });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('기관을 찾을 수 없습니다');
    return org;
  }

  async update(id: string, dto: Partial<{
    name: string;
    orgType: string;
    grade: string;
    address: any;
    phone: string;
    fhirEndpoint: string;
    isActive: boolean;
  }>) {
    await this.findOne(id);
    return this.prisma.organization.update({ where: { id }, data: dto });
  }

  async testConnection(id: string) {
    const org = await this.findOne(id);
    if (!org.fhirEndpoint) {
      return { success: false, statusCode: null, resourceCount: 0, message: 'FHIR endpoint가 설정되지 않았습니다' };
    }

    try {
      const response = await safeFetch(`${org.fhirEndpoint}/metadata`); // SSRF 검증(G2)
      const body = await response.json() as any;
      const resourceCount = body?.rest?.[0]?.resource?.length ?? 0;
      return { success: response.ok, statusCode: response.status, resourceCount };
    } catch (error) {
      this.logger.warn(`FHIR connection test failed for org ${id}: ${error}`);
      return { success: false, statusCode: null, resourceCount: 0, message: String(error) };
    }
  }
}
