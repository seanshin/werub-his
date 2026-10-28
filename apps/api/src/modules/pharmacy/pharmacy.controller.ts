import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PharmacyService } from './pharmacy.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { ReceiveBatchDto, AdjustBatchDto, ScanBarcodeDto } from './dto/inventory.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StartDispensingDto, UpdateDispensingDto, CancelDispensingDto, CompleteDispensingDto } from './dto/start-dispensing.dto';
import { CreateCounselDto, ComputeNaranjoDto } from './dto/counsel.dto';
import { AuditAiRead } from '../audit/no-audit.decorator';
import { CreateAdrDto } from './dto/adr.dto';
import {
  CreateAtcJobDto, CreatePharmacyDeviceDto, DispenseSplitNextDto, GeneratePharmacyLabelDto, IssueDispensingDto,
  RequestSubstitutionDto, StartSplitDispensingDto, VerifyDispensingDto, DecideSubstitutionDto,
} from './dto/pharmacy-write.dto';

@ApiTags('Pharmacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PHARMACIST, UserRole.ADMIN)
@Controller('api/v1/pharmacy')
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  @Get('queue')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '약국 조제 대기열' })
  @ApiResponse({ status: 200, description: '조제 대기열 조회 성공' })
  async getQueue(@Query('pharmacyType') pharmacyType?: string) {
    return { data: await this.pharmacyService.getQueue(pharmacyType) };
  }

  @Post('dispense/:orderId')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '조제 시작' })
  @ApiResponse({ status: 201, description: '조제 시작 성공' })
  async startDispensing(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: StartDispensingDto,
    @CurrentUser('id') userId: string
  ) {
    return { data: await this.pharmacyService.startDispensing(orderId, userId, dto.notes, dto.durOverrideReason) };
  }

  /**
   * 고위험약/마약류 2차 확인자 후보 — 활성·자격 역할·본인 제외.
   *
   * 🔴 클래스 가드가 `@Roles(PHARMACIST, ADMIN)` 이라 **약사가 부를 수 있는 자리**여야 한다.
   *    `GET /users?role=PHARMACIST` 는 `@Roles(ADMIN, DOCTOR, NURSE)` 라 약사에게 403 이고,
   *    게이트가 인정하는 ADMIN 확인자도 빠진다. 그래서 약국 스코프로 따로 낸다.
   */
  @Get('second-checkers')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '고위험약 2차 확인자 후보(활성 약사·관리자, 본인 제외)' })
  async secondCheckers(@CurrentUser('id') userId: string) {
    return { data: await this.pharmacyService.listSecondCheckers(userId) };
  }

  @Patch('dispense/:id/complete')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '조제 완료 (고위험약은 2차 확인자 필요)' })
  @ApiResponse({ status: 200, description: '조제 완료 성공' })
  // 🔴 종전은 인라인 `@Body() body?: { secondCheckBy?: string }` — 런타임 metatype 이 `Object` 라
  //    ValidationPipe 가 **통째로 스킵**됐다. 임의 문자열이 그대로 `user.findUnique` 로 가
  //    P2023(잘못된 UUID)을 냈고, 그 예외는 `.catch(() => null)` 에 먹혀 "확인자 없음"과
  //    구별되지 않았다. 화면이 이 필드를 실제로 보내기 시작하는 지금 DTO 로 승격한다.
  //    (B5) 이 주석이 파라미터 목록 안에 있어 인라인 @Body 가드가 주석 속 `@Body() body?: {` 를 세었다 — 시그니처 밖으로 옮긴다.
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteDispensingDto,
  ) {
    return { data: await this.pharmacyService.completeDispensing(id, body?.secondCheckBy) };
  }

  @Patch('dispense/:id/verify')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({
    summary: '투약 확인(조제 검수 DISPENSED→VERIFIED)',
    description:
      '`notifyPatient: true` 이면 외래 환자에게 "약 조제 완료" 앱 푸시를 시도한다(설정이 켜져 있을 때만 · 입원 조제는 병동 인계라 미해당). ' +
      '응답 `data.patientPush = { attempted, sent, reason }`.',
  })
  @ApiResponse({ status: 200, description: '투약 확인 성공' })
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    /** `notifyPatient` — 환자 앱 푸시 명시 옵트인(기본 false — 미지정이면 reason=NOT_REQUESTED) */
    @Body() body: VerifyDispensingDto,
  ) {
    return {
      data: await this.pharmacyService.verifyDispensing(id, userId, body?.blockchainSignature, {
        notifyPatient: body?.notifyPatient === true,
      }),
    };
  }

  @Patch('dispense/:id/issue')
  // 병동 인수 확인은 간호사도 가능 (외래 창구 불출은 약사)
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '불출(교부) — 검수 완료 건의 실물 전달 확인 (외래 수령/병동 인계)' })
  @ApiResponse({ status: 200, description: '불출 성공' })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: IssueDispensingDto,
  ) {
    return { data: await this.pharmacyService.issueDispensing(id, userId, body?.issuedTo) };
  }

  @Get('dispense/:id')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '조제 상세 조회' })
  @ApiResponse({ status: 200, description: '조제 상세 조회 성공' })
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pharmacyService.getDispensingDetail(id) };
  }

  @Patch('dispense/:id/items')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '조제 항목 수정' })
  @ApiResponse({ status: 200, description: '조제 항목 수정 성공' })
  async updateItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDispensingDto
  ) {
    if (dto.items) {
      return { data: await this.pharmacyService.updateDispensingItems(id, dto.items) };
    }
    return { data: await this.pharmacyService.getDispensingDetail(id) };
  }

  @Patch('dispense/:id/cancel')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '조제 취소' })
  @ApiResponse({ status: 200, description: '조제 취소 성공' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelDispensingDto
  ) {
    return { data: await this.pharmacyService.cancelDispensing(id, body.reason || '') };
  }

  // ── 재고/배치 관리 ──

  @Get('inventory')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '약품 재고 현황' })
  async getInventory(@Query('medicationCodeId') medicationCodeId?: string) {
    return { data: await this.pharmacyService.getInventory(medicationCodeId) };
  }

  @Get('inventory/expiring')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '유효기간 임박 약품' })
  async getExpiringBatches(@Query('days') days?: string) {
    return { data: await this.pharmacyService.getExpiringBatches(Number(days) || 30) };
  }

  @Get('inventory/low-stock')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '안전재고 미달 약품' })
  async getLowStock(@Query('threshold') threshold?: string) {
    return { data: await this.pharmacyService.getLowStock(Number(threshold) || 10) };
  }

  @Post('inventory/receive')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '약품 입고' })
  async receiveBatch(@Body() body: ReceiveBatchDto) {
    return { data: await this.pharmacyService.receiveBatch(body) };
  }

  @Patch('inventory/:batchId/adjust')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '재고 조정' })
  async adjustBatch(@Param('batchId', ParseUUIDPipe) batchId: string, @Body() body: AdjustBatchDto) {
    return { data: await this.pharmacyService.adjustBatch(batchId, body.quantity, body.reason) };
  }

  // ── 바코드 스캔 ──

  @Post('scan')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '약품 바코드 스캔' })
  async scanBarcode(@Body() body: ScanBarcodeDto) {
    return { data: await this.pharmacyService.scanBarcode(body.barcode, body.dispensingId) };
  }

  // ── 분할조제 ──

  @Post('split-dispensing')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '분할조제 시작 (장기처방)' })
  async startSplitDispensing(
    @Body() body: StartSplitDispensingDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.pharmacyService.startSplitDispensing(body.orderId, body.totalSplits, userId) };
  }

  @Post('split-dispensing/next')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '분할조제 후속 회차' })
  async dispenseSplitNext(
    @Body() body: DispenseSplitNextDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.pharmacyService.dispenseSplitNext(body.orderId, userId) };
  }

  @Get('split-dispensing/:orderId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '분할조제 현황 조회' })
  async getSplitHistory(@Param('orderId') orderId: string) {
    return { data: await this.pharmacyService.getSplitHistory(orderId) };
  }

  // ── 복약지도 ──

  @Post('counsel')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '복약지도 기록' })
  async createCounsel(@Body() body: CreateCounselDto, @CurrentUser('id') userId: string) {
    // 상담한 사람은 인증 사용자 — 본문의 pharmacistId 는 DTO 에 없어 whitelist 가 지운다.
    return {
      data: await this.pharmacyService.createCounsel({
        dispensingId: body.dispensingId,
        patientId: body.patientId,
        counselType: body.counselType,
        content: body.content,
        drugInteractions: body.drugInteractions,
        sideEffects: body.sideEffects,
        foodInteractions: body.foodInteractions,
        storageInstructions: body.storageInstructions,
        duration: body.duration,
        pharmacistId: userId,
      }),
    };
  }

  @Get('counsel/candidates/:patientId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '복약지도 대상 후보(그 환자의 최근 조제분)' })
  async getCounselCandidates(@Param('patientId', ParseUUIDPipe) patientId: string) {
    // 🔴 조제 UUID 를 타이핑할 수 있는 사람은 없다 — 후보 목록이 없으면 복약지도 등록 경로가 막힌다.
    return { data: await this.pharmacyService.getCounselCandidates(patientId) };
  }

  @Get('counsel/dispensing/:dispensingId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '조제별 복약지도 이력' })
  async getCounsels(@Param('dispensingId', ParseUUIDPipe) dispensingId: string) {
    return { data: await this.pharmacyService.getCounsels(dispensingId) };
  }

  @Get('counsel/patient/:patientId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '환자별 복약지도 이력' })
  async getPatientCounsels(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.pharmacyService.getPatientCounsels(patientId) };
  }

  // ── 대체조제 ──

  @Post('substitution')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '대체조제 요청' })
  async requestSubstitution(@Body() body: RequestSubstitutionDto, @CurrentUser('id') userId: string) {
    return {
      data: await this.pharmacyService.requestSubstitution({
        originalPrescriptionId: body.originalPrescriptionId,
        substituteMedicationCodeId: body.substituteMedicationCodeId,
        reason: body.reason,
        pharmacistId: userId,
      }),
    };
  }

  // 🔴 판정은 책임 처방의만(관리자 예외) — 종전엔 역할만 보고 누구의 처방인지 보지 않았다
  @Patch('substitution/:id/approve')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '대체조제 승인' })
  async approveSubstitution(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideSubstitutionDto, @CurrentUser() user: { id: string; role: UserRole }) {
    await this.pharmacyService.assertCanDecideSubstitution(id, user);
    return { data: await this.pharmacyService.approveSubstitution(id, user.id, body?.note) };
  }

  @Patch('substitution/:id/reject')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '대체조제 거부' })
  async rejectSubstitution(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideSubstitutionDto, @CurrentUser() user: { id: string; role: UserRole }) {
    await this.pharmacyService.assertCanDecideSubstitution(id, user);
    // 거부는 사유 필수(서비스가 400) — 약사가 다음 조치를 정해야 한다
    return { data: await this.pharmacyService.rejectSubstitution(id, user.id, body?.note) };
  }

  /**
   * 🔴 의사의 대체조제 승인 워크리스트 — 내 처방의 대기분만(전건 `substitution/pending` 은 약사·관리자 그대로).
   *    승인 EP 는 의사에게 열려 있었는데 대기 목록이 클래스 역할(약사·관리자)로 떨어져 의사는 볼 수 없었다.
   */
  @Get('substitution/mine')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내 처방의 대체조제 승인 대기(의사 워크리스트)' })
  async getMyPendingSubstitutions(@CurrentUser('id') userId: string) {
    return { data: await this.pharmacyService.getMyPendingSubstitutions(userId) };
  }

  /**
   * DUR 경고 무시 기록 — 읽기 전용 검토 목록. 약사·관리자는 전건, 의사는 자기 처방만(서비스가 역할로 좁힌다).
   */
  @Get('dur-overrides')
  @Roles(UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 경고 무시(오버라이드) 기록 — 사유 포함' })
  async getDurOverrides(@CurrentUser() user: { id: string; role: UserRole }, @Query('days') days?: string) {
    const n = days != null && days !== '' ? Number(days) : undefined;
    const page = await this.pharmacyService.getDurOverrides(user, n);
    return { data: page.items, meta: { truncated: page.truncated, limit: page.limit, windowDays: page.windowDays, scope: page.scope } };
  }

  /** 최근 판정된 대체조제 — 판정자(책임 처방의 본인/관리자 대리)·시각·사유 · 약사가 결과를 보는 자리(2026-09-30) */
  @Get('substitution/decided')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '최근 판정된 대체조제(판정자·사유 포함)' })
  async getDecidedSubstitutions(@Query('days') days?: string) {
    const n = days != null && days !== '' ? Number(days) : undefined;
    const page = await this.pharmacyService.getDecidedSubstitutions(n);
    return { data: page.items, meta: { truncated: page.truncated, limit: page.limit, windowDays: page.windowDays } };
  }

  @Get('substitution/pending')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '대체조제 대기 목록' })
  async getPendingSubstitutions() {
    return { data: await this.pharmacyService.getPendingSubstitutions() };
  }

  // ── ADR 보고 ──

  @Post('adr')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: 'ADR(약물이상반응) 보고' })
  async createAdr(@Body() body: CreateAdrDto, @CurrentUser('id') userId: string) {
    return { data: await this.pharmacyService.createAdr({ ...body, reporterId: userId }) };
  }

  @Post('adr/naranjo')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: 'Naranjo 인과성 점수 계산(10문항 yes/no/unknown)' })
  async computeNaranjo(@Body() body: ComputeNaranjoDto) {
    // 🔴 `@Body('answers')` 였을 때는 빈 배열도 통과해 **0점=UNLIKELY(희박)** 이 나왔다.
    //    DTO 가 10문항 전체를 요구하므로 이제 "설문 미제출"과 "전부 모름"이 갈린다.
    return { data: this.pharmacyService.computeNaranjo(body.answers) };
  }

  @Get('adr')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: 'ADR 보고 목록' })
  async getAdrReports(@Query('patientId') patientId?: string) {
    return { data: await this.pharmacyService.getAdrReports(patientId) };
  }

  @Patch('adr/:id/submit')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: 'ADR KIDS 보고' })
  async submitAdrToKids(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pharmacyService.submitAdrToKids(id) };
  }

  @Get('adr/:id/e2b')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: 'ADR E2B(R3) XML 다운로드(KIDS 제출용 서식)' })
  async downloadE2b(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.pharmacyService.buildE2bXml(id);
    res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.filename}"` });
    res.send(file.content);
  }

  @Get('adr/stats')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: 'ADR 약품별 통계' })
  async getAdrStats() {
    return { data: await this.pharmacyService.getAdrStats() };
  }

  // ── 기기 관리 ──

  @Get('devices')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '약국 기기 목록' })
  async getDevices() {
    return { data: await this.pharmacyService.getDevices() };
  }

  @Post('devices')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기기 등록' })
  async createDevice(@Body() body: CreatePharmacyDeviceDto) {
    return { data: await this.pharmacyService.createDevice(body) };
  }

  @Post('devices/:id/heartbeat')
  @ApiOperation({ summary: '기기 상태 체크' })
  async deviceHeartbeat(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pharmacyService.deviceHeartbeat(id) };
  }

  @Post('devices/:id/dispense')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: 'ATC 자동조제 요청' })
  async createAtcJob(@Param('id', ParseUUIDPipe) deviceId: string, @Body() body: CreateAtcJobDto) {
    return { data: await this.pharmacyService.createAtcJob(body.dispensingId, deviceId, body.medications) };
  }

  @Get('atc-jobs/:id/status')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: 'ATC 작업 상태' })
  async getAtcJobStatus(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pharmacyService.getAtcJobStatus(id) };
  }

  // ── 라벨 ──

  @Post('print/label')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '약봉지 라벨 데이터 생성' })
  async generateLabel(@Body() body: GeneratePharmacyLabelDto) {
    return { data: await this.pharmacyService.generateLabel(body.dispensingId) };
  }

  // ── 원외처방전 자동 만료 수동 트리거 ──

  @Post('expire-external')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '원외처방전 유효기간 만료 처리 (수동 트리거)' })
  @ApiResponse({ status: 201, description: '만료 처리된 처방전 건수 반환' })
  async expireExternalPrescriptions() {
    return { data: await this.pharmacyService.expireExternalPrescriptions() };
  }

  @AuditAiRead('AiPharmacyReview')

  @Get('orders/:orderId/ai-review')
  @ApiOperation({ summary: 'AI 처방 검토 자동화' })
  async reviewPrescriptionAI(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.pharmacyService.reviewPrescriptionAI(orderId) };
  }

  @AuditAiRead('AiPharmacyGuidance')

  @Get('orders/:orderId/ai-guidance')
  @ApiOperation({ summary: 'AI 복약지도 자동 생성' })
  async generateMedicationGuidance(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.pharmacyService.generateMedicationGuidance(orderId) };
  }
}
