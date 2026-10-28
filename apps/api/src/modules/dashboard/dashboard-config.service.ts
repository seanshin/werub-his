import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class DashboardConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** 개인 config → 없으면 관리자 템플릿(부서>역할) 폴백 */
  async getConfig(userId: string) {
    const record = await this.prisma.userDashboardConfig.findUnique({ where: { userId } });
    if (record?.config) return record.config;
    // 관리자 템플릿 폴백
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, department: true } });
    if (!user) return null;
    return this.resolveTemplate(user.role, user.department);
  }

  /** 부서 템플릿 우선 → 역할 템플릿 → null(FE 하드코딩 기본) */
  async resolveTemplate(role?: string | null, department?: string | null) {
    if (department) {
      const dept = await this.prisma.dashboardTemplate.findUnique({ where: { scope_scopeRef: { scope: 'DEPARTMENT', scopeRef: department } } });
      if (dept?.config) return dept.config;
    }
    if (role) {
      const r = await this.prisma.dashboardTemplate.findUnique({ where: { scope_scopeRef: { scope: 'ROLE', scopeRef: role } } });
      if (r?.config) return r.config;
    }
    return null;
  }

  // ── 관리자 템플릿 관리 ──
  listTemplates() {
    return this.prisma.dashboardTemplate.findMany({ orderBy: [{ scope: 'asc' }, { scopeRef: 'asc' }] });
  }

  async upsertTemplate(scope: string, scopeRef: string, config: Prisma.InputJsonValue, updatedBy: string) {
    if (!['ROLE', 'DEPARTMENT'].includes(scope)) throw new BadRequestException('scope는 ROLE/DEPARTMENT');
    if (!scopeRef) throw new BadRequestException('scopeRef 필수');
    return this.prisma.dashboardTemplate.upsert({
      where: { scope_scopeRef: { scope, scopeRef } },
      create: { scope, scopeRef, config, updatedBy },
      update: { config, updatedBy },
    });
  }

  async deleteTemplate(scope: string, scopeRef: string) {
    await this.prisma.dashboardTemplate.deleteMany({ where: { scope, scopeRef } });
    return { ok: true };
  }

  async saveConfig(userId: string, config: any) {
    const result = await this.prisma.userDashboardConfig.upsert({
      where: { userId },
      create: { userId, config },
      update: { config },
    });
    return result;
  }

  async resetConfig(userId: string) {
    await this.prisma.userDashboardConfig.deleteMany({
      where: { userId },
    });
  }
}
