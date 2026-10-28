import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateItemDto, UpdateItemDto,
  TransactDto,
  CreateStorageDto, UpdateStorageDto,
  CreateSupplierDto, AddItemSupplierDto,
  UpdateLotStatusDto,
  CreatePurchaseOrderDto, UpdatePOStatusDto, ReceivePODto,
  CreateRequestDto, ApproveRequestDto,
  CreateRepackOrderDto, UpdateRepackStatusDto,
  CreateQrLabelDto, CreateQrLabelsBulkDto,
  CreateInventoryCountDto, UpdateCountItemsDto, ReportQueryDto,
} from './dto/inventory.dto';

@ApiTags('Inventory (자재/재고)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  // ── 품목 ──

  @Get()
  @ApiOperation({ summary: '품목 목록' })
  async findAll(
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(100, parseInt(limit, 10)) : 50;
    const data = await this.svc.findAll({ category, lowStock: lowStock === 'true' });
    const total = data.length;
    const paginated = data.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    return { data: paginated, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '품목 등록' })
  async create(@Body() body: CreateItemDto) {
    return { data: await this.svc.createItem(body) };
  }

  @Get('alerts')
  @ApiOperation({ summary: '안전재고 미달 알림' })
  async getAlerts() { return { data: await this.svc.getLowStockAlerts() }; }

  @Get('items/:id')
  @ApiOperation({ summary: '품목 상세' })
  async getItem(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.svc.findById(id) }; }

  @Put('items/:id')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '품목 수정' })
  async updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateItemDto) {
    return { data: await this.svc.updateItem(id, body) };
  }

  // ── 입출고 ──

  @Get('transactions')
  @ApiOperation({ summary: '입출고 이력' })
  async getTransactions(
    @Query('itemId') itemId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(200, parseInt(limit, 10)) : 100;
    return { data: await this.svc.getTransactions(itemId, limitNum), meta: { page: pageNum, limit: limitNum } };
  }

  @Post(':id/transaction')
  @ApiOperation({ summary: '입출고 처리' })
  async transact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransactDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.transact(id, body.type as any, Number(body.quantity), userId, body.reason, {
      lotId: body.lotId, storageId: body.storageId,
      unitCost: body.unitCost, department: body.department, referenceNumber: body.referenceNumber,
    }) };
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: '품목별 입출고 이력' })
  async getItemTransactions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getTransactions(id) };
  }

  // ── 보관장소 ──

  @Get('storages')
  @ApiOperation({ summary: '보관장소 목록' })
  async getStorages() { return { data: await this.svc.getStorages() }; }

  @Post('storages')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '보관장소 등록' })
  async createStorage(@Body() body: CreateStorageDto) { return { data: await this.svc.createStorage(body) }; }

  @Put('storages/:id')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '보관장소 수정' })
  async updateStorage(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStorageDto) {
    return { data: await this.svc.updateStorage(id, body) };
  }

  @Delete('storages/:id')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '보관장소 삭제' })
  async deleteStorage(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteStorage(id) };
  }

  // ── 거래처 ──

  @Get('suppliers')
  @ApiOperation({ summary: '거래처 목록' })
  async getSuppliers() { return { data: await this.svc.getSuppliers() }; }

  @Post('suppliers')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '거래처 등록' })
  async createSupplier(@Body() body: CreateSupplierDto) { return { data: await this.svc.createSupplier(body) }; }

  @Get('suppliers/:id')
  @ApiOperation({ summary: '거래처 상세' })
  async getSupplierDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getSupplierDetail(id) };
  }

  @Put('suppliers/:id')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '거래처 수정' })
  async updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateSupplierDto) {
    return { data: await this.svc.updateSupplier(id, body) };
  }

  @Post('suppliers/:id/items')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '거래처-품목 매핑' })
  async addItemSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() body: AddItemSupplierDto) {
    return { data: await this.svc.addItemSupplier(id, body) };
  }

  // ── LOT/유효기간 ──

  @Get('lots')
  @ApiOperation({ summary: 'LOT 목록' })
  async getLots(
    @Query('itemId') itemId?: string,
    @Query('expiring') expiring?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(200, parseInt(limit, 10)) : 100;
    const data = await this.svc.getLots({ itemId, expiring: expiring === 'true', status });
    return { data, meta: { total: data.length, page: pageNum, limit: limitNum } };
  }

  @Patch('lots/:id')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: 'LOT 상태 변경 (RECALLED 지정=리콜 처리·이후 불출/재포장 차단)' })
  async updateLot(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateLotStatusDto) {
    return { data: await this.svc.updateLotStatus(id, body.status) };
  }

  @Get('lots/:id/trace')
  @ApiOperation({ summary: 'LOT 리콜 역추적 — 불출 이력(부서·일시·수량)' })
  async getLotTrace(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getLotTrace(id) };
  }

  // ── 발주 ──

  @Get('purchase-orders')
  @ApiOperation({ summary: '발주 목록' })
  async getPurchaseOrders(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(100, parseInt(limit, 10)) : 50;
    const data = await this.svc.getPurchaseOrders(status, limitNum);
    return { data, meta: { total: data.length, page: pageNum, limit: limitNum } };
  }

  @Post('purchase-orders')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '발주서 작성' })
  async createPO(@Body() body: CreatePurchaseOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createPurchaseOrder(body, userId) };
  }

  @Get('purchase-orders/auto-suggest')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '자동 발주 제안' })
  async getAutoSuggest() { return { data: await this.svc.getAutoSuggest() }; }

  @Get('purchase-orders/:id')
  @ApiOperation({ summary: '발주 상세' })
  async getPODetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getPurchaseOrderDetail(id) };
  }

  @Patch('purchase-orders/:id/status')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '발주 상태 변경' })
  async updatePOStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePOStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.updatePurchaseOrderStatus(id, body.status, userId) };
  }

  @Post('purchase-orders/:id/receive')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '발주 입고 처리' })
  async receivePO(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReceivePODto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.receivePurchaseOrder(id, body.items, userId) };
  }

  // ── 부서 청구/불출 ──

  @Get('requests')
  @ApiOperation({ summary: '청구 목록' })
  async getRequests(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.min(100, parseInt(limit, 10)) : 50;
    const data = await this.svc.getRequests(status, limitNum);
    return { data, meta: { total: data.length, page: pageNum, limit: limitNum } };
  }

  @Post('requests')
  @ApiOperation({ summary: '청구서 작성' })
  async createRequest(@Body() body: CreateRequestDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createRequest(body, userId) };
  }

  @Patch('requests/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '청구 승인' })
  async approveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.svc.approveRequest(id, userId, body.items);
    return { data: { approved: true } };
  }

  @Patch('requests/:id/issue')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '불출 처리' })
  async issueRequest(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.issueRequest(id, userId) };
  }

  // ── 재포장/키트 ──

  @Get('repack-orders')
  @ApiOperation({ summary: '재포장 지시서 목록' })
  async getRepackOrders(@Query('status') status?: string) {
    return { data: await this.svc.getRepackOrders(status) };
  }

  @Post('repack-orders')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '재포장 지시서 작성' })
  async createRepackOrder(@Body() body: CreateRepackOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createRepackOrder(body, userId) };
  }

  @Get('repack-orders/:id')
  @ApiOperation({ summary: '재포장 상세' })
  async getRepackDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getRepackOrderDetail(id) };
  }

  @Patch('repack-orders/:id/status')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '재포장 상태 변경' })
  async updateRepackStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRepackStatusDto) {
    return { data: await this.svc.updateRepackOrderStatus(id, body.status, body.performedBy) };
  }

  @Post('repack-orders/:id/complete')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '재포장 완료 (재고 차감)' })
  async completeRepack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.completeRepackOrder(id, userId) };
  }

  // ── QR코드 ──

  @Get('qr-labels')
  @ApiOperation({ summary: 'QR 라벨 목록' })
  async getQrLabels(@Query('labelType') labelType?: string) {
    return { data: await this.svc.getQrLabels(labelType) };
  }

  @Post('qr-labels')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: 'QR 라벨 생성' })
  async createQrLabel(@Body() body: CreateQrLabelDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createQrLabel(body, userId) };
  }

  @Post('qr-labels/bulk')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: 'QR 라벨 일괄 생성' })
  async createQrLabelsBulk(@Body() body: CreateQrLabelsBulkDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createQrLabelsBulk(body.labels, userId) };
  }

  @Get('qr-labels/:id')
  @ApiOperation({ summary: 'QR 라벨 상세' })
  async getQrLabel(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getQrLabel(id) };
  }

  @Patch('qr-labels/:id/print')
  @ApiOperation({ summary: 'QR 인쇄 기록' })
  async markQrPrinted(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.markQrPrinted(id) };
  }

  // ── 실사 (Inventory Count) ──

  @Post('counts')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '실사 생성' })
  async createCount(@Body() body: CreateInventoryCountDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createCount(body, userId) };
  }

  @Get('counts')
  @ApiOperation({ summary: '실사 목록' })
  async getCounts(@Query('status') status?: string) {
    return { data: await this.svc.getCounts(status) };
  }

  @Get('counts/:id')
  @ApiOperation({ summary: '실사 상세' })
  async getCountDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.getCountDetail(id) };
  }

  @Patch('counts/:id/items')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '실사 결과 입력' })
  async updateCountItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCountItemsDto,
  ) {
    return { data: await this.svc.updateCountItems(id, body.items) };
  }

  @Post('counts/:id/complete')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '실사 완료 + 재고 조정' })
  async completeCount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.completeCount(id, userId) };
  }

  // ── 리포트 ──

  @Get('reports/summary')
  @ApiOperation({ summary: '재고 요약 리포트' })
  async getReportSummary(@Query('category') category?: string) {
    return { data: await this.svc.getReportSummary({ category }) };
  }

  @Get('reports/abc-analysis')
  @ApiOperation({ summary: 'ABC 분석 리포트' })
  async getAbcAnalysis(@Query('category') category?: string) {
    return { data: await this.svc.getAbcAnalysis({ category }) };
  }

  @Get('reports/turnover')
  @ApiOperation({ summary: '재고 회전율 리포트' })
  async getTurnoverReport(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('category') category?: string,
  ) {
    return { data: await this.svc.getTurnoverReport({ dateFrom, dateTo, category }) };
  }

  @Get('reports/expiry')
  @ApiOperation({ summary: '유효기간 임박 리포트' })
  async getExpiryReport(@Query('category') category?: string) {
    return { data: await this.svc.getExpiryReport({ category }) };
  }

  @Get('reports/movement')
  @ApiOperation({ summary: '품목별 입출고 이력 요약' })
  async getMovementReport(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('category') category?: string,
  ) {
    return { data: await this.svc.getMovementReport({ dateFrom, dateTo, category }) };
  }
}
