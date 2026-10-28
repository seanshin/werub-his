import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateHisWebhookDto, UpdateHisWebhookDto } from './dto/his-webhook.dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationOutboxService } from './integration-outbox.service';

// ERP 연동 운영 관리 (관리자) — outbox 모니터·재처리 + 코드 매핑 현황
@ApiTags('ERP Integration Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/integration/admin')
export class IntegrationAdminController {
  constructor(private readonly outbox: IntegrationOutboxService, private readonly prisma: PrismaService) {}

  @Get('outbox')
  @ApiOperation({ summary: 'outbox 전송 현황(도메인/상태/실패)' })
  async outboxStats() { return { data: await this.outbox.adminStats() }; }

  @Post('outbox/retry')
  @ApiOperation({ summary: '실패 건 전체 재시도' })
  async retryAll() { return { data: await this.outbox.retryFailed() }; }

  @Post('outbox/:id/retry')
  @ApiOperation({ summary: '특정 건 재시도' })
  async retryOne(@Param('id') id: string) { return { data: await this.outbox.retryFailed(id) }; }

  // ─────────────────────────── HIS 이벤트 웹훅 구독 등록(his_webhooks) ───────────────────────────
  @Get('webhooks')
  @ApiOperation({ summary: 'HIS 이벤트 웹훅 구독 목록' })
  async listWebhooks() { return { data: await this.outbox.listWebhooks() }; }

  @Get('webhooks/event-catalog')
  @ApiOperation({ summary: '구독 가능한 HIS 이벤트 카탈로그' })
  eventCatalog() { return { data: this.outbox.eventCatalog() }; }

  @Post('webhooks')
  @ApiOperation({ summary: '웹훅 구독 등록(secret 미지정 시 자동 생성·1회 반환)' })
  async createWebhook(
    @Body() body: CreateHisWebhookDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.outbox.createWebhook(body, userId) };
  }

  @Put('webhooks/:id')
  @ApiOperation({ summary: '웹훅 구독 수정(활성화/이벤트/URL/secret/format)' })
  async updateWebhook(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateHisWebhookDto) {
    return { data: await this.outbox.updateWebhook(id, body) };
  }

  @Delete('webhooks/:id')
  @ApiOperation({ summary: '웹훅 구독 삭제' })
  async deleteWebhook(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.outbox.deleteWebhook(id) }; }

  @Post('webhooks/:id/test')
  @ApiOperation({ summary: '웹훅 테스트 발송(ping)' })
  async testWebhook(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.outbox.testWebhook(id) }; }

  @Get('mapping-export')
  @ApiOperation({ summary: 'ERP 코드 매핑표 export(품목·거래처·자산·직원) — ERP가 erp_code 채워 회신' })
  async mappingExport() {
    const [invItems, cssdItems, invVendors, cssdVendors, equip, staff] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { isActive: true }, select: { code: true, name: true, category: true, unit: true, erpItemCode: true }, orderBy: { code: 'asc' } }),
      this.prisma.instrumentItem.findMany({ select: { code: true, name: true, category: true, unit: true, erpItemCode: true }, orderBy: { code: 'asc' } }),
      this.prisma.inventorySupplier.findMany({ select: { code: true, name: true, erpVendorCode: true }, orderBy: { code: 'asc' } }),
      this.prisma.supplier.findMany({ select: { id: true, name: true, erpVendorCode: true }, orderBy: { name: 'asc' } }),
      this.prisma.equipment.findMany({ select: { assetNumber: true, name: true, category: true, erpAssetCode: true }, orderBy: { assetNumber: 'asc' } }),
      this.prisma.staff.findMany({ where: { status: 'ACTIVE' }, select: { employeeNumber: true, familyName: true, givenName: true, department: true, erpEmployeeCode: true }, orderBy: { employeeNumber: 'asc' } }),
    ]);
    const rows: { domain: string; his_code: string; his_name: string; attr: string; erp_code: string }[] = [];
    for (const i of invItems) rows.push({ domain: 'item', his_code: i.code, his_name: i.name, attr: `${i.category}/${i.unit}`, erp_code: i.erpItemCode ?? '' });
    for (const i of cssdItems) rows.push({ domain: 'item_cssd', his_code: i.code, his_name: i.name, attr: `${i.category ?? ''}/${i.unit}`, erp_code: i.erpItemCode ?? '' });
    for (const v of invVendors) rows.push({ domain: 'vendor', his_code: v.code, his_name: v.name, attr: '', erp_code: v.erpVendorCode ?? '' });
    for (const v of cssdVendors) rows.push({ domain: 'vendor_cssd', his_code: v.id, his_name: v.name, attr: '', erp_code: v.erpVendorCode ?? '' });
    for (const e of equip) rows.push({ domain: 'asset', his_code: e.assetNumber, his_name: e.name, attr: e.category, erp_code: e.erpAssetCode ?? '' });
    for (const s of staff) rows.push({ domain: 'employee', his_code: s.employeeNumber, his_name: `${s.familyName}${s.givenName}`, attr: s.department, erp_code: s.erpEmployeeCode ?? '' });
    return { data: rows };
  }

  @Get('mapping-coverage')
  @ApiOperation({ summary: '도메인별 ERP 코드 매핑 현황(매핑/전체)' })
  async mappingCoverage() {
    const [itemT, itemM, vInvT, vInvM, eqT, eqM, stT, stM, cssdT, cssdM] = await Promise.all([
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.count({ where: { isActive: true, erpItemCode: { not: null } } }),
      this.prisma.inventorySupplier.count(),
      this.prisma.inventorySupplier.count({ where: { erpVendorCode: { not: null } } }),
      this.prisma.equipment.count(),
      this.prisma.equipment.count({ where: { erpAssetCode: { not: null } } }),
      this.prisma.staff.count({ where: { status: 'ACTIVE' } }),
      this.prisma.staff.count({ where: { status: 'ACTIVE', erpEmployeeCode: { not: null } } }),
      this.prisma.instrumentItem.count(),
      this.prisma.instrumentItem.count({ where: { erpItemCode: { not: null } } }),
    ]);
    return { data: [
      { domain: '범용 품목(inventory)', mapped: itemM, total: itemT },
      { domain: '멸균 품목(cssd)', mapped: cssdM, total: cssdT },
      { domain: '거래처(vendor)', mapped: vInvM, total: vInvT },
      { domain: '고정자산(equipment)', mapped: eqM, total: eqT },
      { domain: '직원(hr)', mapped: stM, total: stT },
    ] };
  }
}
