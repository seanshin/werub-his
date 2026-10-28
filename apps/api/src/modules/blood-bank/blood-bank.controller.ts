import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BloodBankService } from './blood-bank.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddBloodProductDto, UpdateProductStatusDto, RequestCrossmatchDto,
  SubmitCrossmatchResultDto, CreateTransfusionOrderDto, IssueBloodDto,
  VerifyTransfusionDto, CompleteTransfusionDto, ReportReactionDto,
  SetBloodTypingDto, AddAntibodyDto, ActivateMtpDto, UpdateMtpDto, IssueEmergencyDto,
  ReactionReportDto, ProductAttributesDto, DisposeProductDto, ReorderDto, UpdateReorderStatusDto,
  RecordTransfusionVitalsDto,
} from './dto/blood-bank.dto';

@ApiTags('Blood Bank (혈액은행)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/blood-bank')
export class BloodBankController {
  constructor(private readonly service: BloodBankService) {}

  // ── Inventory ──

  @Get('inventory')
  @ApiOperation({ summary: '혈액제제 재고 조회' })
  async getInventory(
    @Query('productType') productType?: string,
    @Query('bloodType') bloodType?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.service.getInventory(productType, bloodType, status) };
  }

  @Post('inventory')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 입고는 혈액은행 검사기사 업무(직무분리)
  @ApiOperation({ summary: '혈액제제 입고' })
  async addProduct(@Body() body: AddBloodProductDto) {
    return { data: await this.service.addProduct(body) };
  }

  @Patch('inventory/:id/status')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 재고 상태(폐기/반납 포함)는 검사기사 업무
  @ApiOperation({ summary: '혈액제제 상태 변경' })
  async updateProductStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductStatusDto,
  ) {
    return { data: await this.service.updateProductStatus(id, body.status) };
  }

  @Get('inventory/expiring')
  @ApiOperation({ summary: '유효기간 임박 혈액제제' })
  async getExpiringProducts(@Query('days') days?: string) {
    return { data: await this.service.getExpiringProducts(days ? parseInt(days, 10) : 7) };
  }

  @Get('inventory/stats')
  @ApiOperation({ summary: '재고 통계 (제품유형/혈액형 매트릭스)' })
  async getInventoryStats() {
    return { data: await this.service.getInventoryStats() };
  }

  // ── Crossmatch ──

  @Post('crossmatch')
  @ApiOperation({ summary: '교차시험 요청' })
  async requestCrossmatch(
    @Body() body: RequestCrossmatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.requestCrossmatch(body, userId) };
  }

  @Patch('crossmatch/:id/result')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 교차시험 판정은 검사기사 업무
  @ApiOperation({ summary: '교차시험 결과 입력 (72시간 유효)' })
  async submitCrossmatchResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitCrossmatchResultDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.submitCrossmatchResult(id, body, userId) };
  }

  // ── Transfusion Order ──

  @Post('orders')
  @ApiOperation({ summary: '수혈 오더 생성' })
  async createTransfusionOrder(
    @Body() body: CreateTransfusionOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createTransfusionOrder(body, userId) };
  }

  @Get('orders')
  @ApiOperation({ summary: '수혈 오더 목록' })
  async getTransfusionOrders(
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
  ) {
    return { data: await this.service.getTransfusionOrders(status, patientId) };
  }

  // ── Transfusion ──

  @Get('orders/:orderId/candidate-units')
  @ApiOperation({ summary: '출고 후보 유닛 자동매칭(A-7) — 오더 요건(ABO/Rh·특수요구) 적합 유닛 추천(교차상태·FEFO)' })
  async getCandidateUnits(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.service.getCandidateUnits(orderId) };
  }

  @Post('orders/:orderId/issue')
  @ApiOperation({ summary: '혈액 출고 (TransfusionOrder에 BloodProduct 배정)' })
  async issueBlood(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: IssueBloodDto,
  ) {
    return { data: await this.service.issueBlood(orderId, body.bloodProductId) };
  }

  @Get('transfusions')
  /**
   * 🔴 **핸들러 `@Roles` 가 클래스를 덮어 `LAB_TECH` 가 빠져 있었다**(2026-08-29 실측).
   *    클래스는 `@Roles(LAB_TECH, DOCTOR, NURSE, ADMIN)` 인데 이 핸들러만 셋을 다시 적으면서
   *    **혈액은행 화면의 주인(검사기사)** 을 떨어뜨렸다 —
   *    `/workstation/blood-bank`(roles: ADMIN·LAB_TECH·NURSE)를 열면 목록이 **상시 403** 이었다.
   * 🔴 같은 컨트롤러의 **출고**(`issueBlood`)는 `LAB_TECH` 전용이다 —
   *    출고는 하는데 그 목록은 못 보는 상태였다.
   */
  @Roles(UserRole.LAB_TECH, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수혈 실행 목록 (PENDING/VERIFIED/IN_PROGRESS)' })
  async listTransfusions(@Query('status') status?: string) {
    return { data: await this.service.listTransfusions(status) };
  }

  @Patch('transfusions/:id/verify')
  @ApiOperation({ summary: '2인 확인 (수혈 전 환자/혈액 확인)' })
  async verifyTransfusion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VerifyTransfusionDto,
  ) {
    return { data: await this.service.verifyTransfusion(id, body.nurse1Id, body.nurse2Id, { patientBandScan: body.patientBandScan, bloodUnitScan: body.bloodUnitScan }) };
  }

  @Patch('transfusions/:id/start')
  @ApiOperation({ summary: '수혈 시작' })
  async startTransfusion(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.startTransfusion(id) };
  }

  @Patch('transfusions/:id/vitals')
  @ApiOperation({ summary: '수혈 중 바이탈 기록' })
  async recordVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordTransfusionVitalsDto,
  ) {
    return { data: await this.service.recordVitals(id, body as unknown as Record<string, unknown>) };
  }

  @Patch('transfusions/:id/complete')
  @ApiOperation({ summary: '수혈 완료' })
  async completeTransfusion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteTransfusionDto,
  ) {
    return { data: await this.service.completeTransfusion(id, body.volumeTransfused) };
  }

  @Patch('transfusions/:id/reaction')
  @ApiOperation({ summary: '수혈 부작용 보고' })
  async reportReaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReportReactionDto,
  ) {
    return { data: await this.service.reportReaction(id, body) };
  }

  // ── P1: 수혈전검사 기반 ──

  @Get('patients/:patientId/profile')
  @ApiOperation({ summary: '환자 수혈전검사 프로필(혈액형+항체 이력)' })
  async getBloodProfile(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getBloodProfile(patientId) };
  }

  @Post('typing')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 혈액형 확정은 검사기사 업무
  @ApiOperation({ summary: '환자 혈액형 확정(ABO 2차 불일치 감지)' })
  async setTyping(@Body() dto: SetBloodTypingDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.setBloodTyping(dto, userId) };
  }

  @Post('antibody')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 항체 이력은 검사기사 업무
  @ApiOperation({ summary: '불규칙항체 이력 추가' })
  async addAntibody(@Body() dto: AddAntibodyDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.addAntibody(dto, userId) };
  }

  @Get('mtp/active')
  @ApiOperation({ summary: '활성 대량수혈 프로토콜(MTP)' })
  async getActiveMtps() {
    return { data: await this.service.getActiveMtps() };
  }

  @Post('mtp')
  @ApiOperation({ summary: '대량수혈 프로토콜 활성화' })
  async activateMtp(@Body() dto: ActivateMtpDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.activateMtp(dto, userId) };
  }

  @Patch('mtp/:id')
  @ApiOperation({ summary: 'MTP 갱신(팩 수·해제)' })
  async updateMtp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMtpDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.updateMtp(id, dto, userId) };
  }

  @Post('orders/:orderId/issue-emergency')
  @ApiOperation({ summary: '긴급 출고(비교차·uncrossmatched·사유 필수)' })
  async issueEmergency(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: IssueEmergencyDto) {
    return { data: await this.service.issueEmergency(orderId, dto.bloodProductId, dto.reason) };
  }

  // ── P2: 반응 신고·특수제제·반납/폐기 ──

  @Get('reaction-reports')
  @ApiOperation({ summary: '수혈반응 보고 목록' })
  async getReactionReports(@Query('reportedOnly') reportedOnly?: string) {
    return { data: await this.service.getReactionReports(reportedOnly === 'true') };
  }

  @Post('transfusions/:id/reaction-report')
  @ApiOperation({ summary: '수혈반응 상세 보고(+혈액원 신고)' })
  async reportReactionDetail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactionReportDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.reportReactionDetail(id, dto, userId) };
  }

  @Patch('inventory/:id/attributes')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN) // 제제 속성은 검사기사 업무
  @ApiOperation({ summary: '특수제제 속성(방사선조사·백혈구제거·CMV·세척)' })
  async setAttributes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductAttributesDto) {
    return { data: await this.service.setProductAttributes(id, dto) };
  }

  @Patch('inventory/:id/dispose')
  @ApiOperation({ summary: '혈액제제 반납/폐기(사유)' })
  async dispose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeProductDto) {
    return { data: await this.service.disposeProduct(id, dto.action, dto.reason) };
  }

  // ── P3: 재고 알림·발주 ──

  @Get('inventory/alerts')
  @ApiOperation({ summary: '재고 임계 미만 알림' })
  async getInventoryAlerts() {
    return { data: await this.service.getInventoryAlerts() };
  }

  @Get('reorders')
  @ApiOperation({ summary: '혈액원 발주 목록' })
  async getReorders(@Query('status') status?: string) {
    return { data: await this.service.getReorders(status) };
  }

  @Post('reorders')
  @ApiOperation({ summary: '혈액원 발주 요청' })
  async createReorder(@Body() dto: ReorderDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createReorder(dto, userId) };
  }

  @Patch('reorders/:id/status')
  @ApiOperation({ summary: '발주 상태 갱신' })
  async updateReorderStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateReorderStatusDto) {
    return { data: await this.service.updateReorderStatus(id, body.status) };
  }

  // ── Dashboard ──

  @Get('dashboard')
  @ApiOperation({ summary: '혈액은행 대시보드' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }
}
