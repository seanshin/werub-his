import {
  Controller, Get, Post, Patch, Param, Body, Query, Req,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BillingService } from './billing.service';
import { GradeCalculatorService } from './grade-calculator.service';
import { GradeCalculatorDto } from './dto/grade-calculator.dto';
import { PayBillingDto } from './dto/pay-billing.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { CancelBillingDto } from './dto/cancel-billing.dto';
import { RefundBillingDto } from './dto/refund-billing.dto';
import { DeferBillingDto } from './dto/defer-billing.dto';
import { CreateBillingDto } from './dto/create-billing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAiRead, NoAudit } from '../audit/no-audit.decorator';
import { ConfirmDrugCodeDto, CreateInstallmentPlanDto, ReemitAccrualDto } from './dto/billing-body.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class BillingController {
  constructor(private readonly billingService: BillingService, private readonly gradeCalc: GradeCalculatorService) {}

  @Post('billing/accrual/:prescriptionId/reemit')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'progressive accrual 라인 재발행(정정·재백필·E2E) — 동일 lineId 멱등 치환. cancelled=true 시 라인 제외' })
  async reemitAccrual(
    @Param('prescriptionId', ParseUUIDPipe) prescriptionId: string,
    @Body() body: ReemitAccrualDto,
  ) {
    const result = await this.billingService.emitAccrualLine(prescriptionId, body?.cancelled === true, body?.treatedOn);
    if (!result) return { data: { emitted: false, reason: 'PRESCRIPTION_OR_CODE_NOT_RESOLVED' } };
    return { data: { emitted: true, ...result } };
  }

  @Get('billing/review-queue')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '청구 검토 대기 큐 — 응급청구 실패·정정 검토(최근 N일, 기본 7일) 통합' })
  async getReviewQueue(@Query('days') days?: string) {
    const n = Math.min(30, Math.max(1, Number(days) || 7));
    return this.billingService.getReviewQueue(n);
  }

  @Post('billing/drug-mapping/pull-confirmed')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약품 보험코드 close-loop pull — ERP 확정코드 당겨 insuranceCode 백필' })
  async pullConfirmedDrugCodes() {
    return { data: await this.billingService.pullConfirmedDrugCodes() };
  }

  @Get('billing/drug-mapping/match')
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'HIRA 약가마스터 매칭 — HIS 약품→보험코드 후보(미적용)' })
  async matchDrugCodes() {
    return { data: await this.billingService.matchDrugStandardCodes(false) };
  }

  @Post('billing/drug-mapping/match/apply')
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'HIRA 매칭 자동적용 — HIGH 신뢰도만 insuranceCode 채움' })
  async applyDrugCodes() {
    return { data: await this.billingService.matchDrugStandardCodes(true) };
  }

  @Post('billing/drug-mapping/confirm')
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '약품 보험코드 수동 확정(후보 중 선택)' })
  async confirmDrugCode(@Body() body: ConfirmDrugCodeDto) {
    return { data: await this.billingService.confirmDrugCode(body.hisCode, body.insuranceCode) };
  }

  @Get('billing/erp-invoice')
  // 🔴 2026-09-16 J2(실로그인 프로브): **원무(RECEPTIONIST)만** 넣는다.
  //    이 EP 는 수납을 실제로 하는 원무를 빼고 의사를 넣고 있었는데, 원무는 다른 모든 수납 EP
  //    (목록·상세·미수금·영수증·분납)에 들어 있다. 패널은 "조용히 숨기면 ERP 금액이 없는 것처럼 보인다"며
  //    일부러 실패를 그리므로 원무는 수납 상세마다 실패 배너를 봤다. `journey-console` 의 같은 EP 주석도
  //    "서버도 **원무**·임상 역할에만 연다"고 적어 그 전제가 이미 코드와 어긋나 있었다.
  // 🔴 CHECKUP 은 **일부러 넣지 않는다** — `nav-role-endpoint.spec` 이 "ERP 청구서 상세까지 열지 않았다"를
  //    대조군으로 못박아 둔 자리다(2026-08-29 수정이 번지지 않게 한 것). 검진 데스크도 같은 실패 배너를
  //    보지만, 기존 판단을 이 갈래가 뒤집지 않는다 — 판정 문서에 사람 결정 후보로 남긴다.
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'ERP 진료비 계산결과 조회(D-6 요청2, interim 중간계산)' })
  async erpInvoice(
    @Query('encounterId') encounterId?: string,
    @Query('chartNo') chartNo?: string,
    @Query('interim') interim?: string,
  ) {
    return { data: await this.billingService.getErpInvoice({ encounterId, chartNo, interim: interim === 'true' }) };
  }

  @Get('billing/dur-check')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 약물 상호작용 체크' })
  async checkDUR(
    @Query('patientId') patientId: string,
    @Query('atcCode') atcCode: string,
    @Query('drugName') drugName: string,
  ) {
    return { data: await this.billingService.checkDUR(patientId, atcCode, drugName) };
  }

  @Get('billing/cashier-queue')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '수납 대기 목록 (원무과 큐)' })
  async getCashierQueue() {
    return this.billingService.getCashierQueue();
  }

  @Get('billing/cashier-stats')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '오늘의 수납 통계' })
  async getCashierStats() {
    return this.billingService.getCashierStats();
  }

  @Get('billing/daily-summary')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '일일 정산 요약' })
  async getDailySummary(@Query('date') date?: string) {
    return this.billingService.getDailySummary(date);
  }

  @Post('billing/daily-close')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '일마감 → ERP 전표 통보(billing.settled)' })
  async dailyClose(@Query('date') date?: string) {
    return { data: await this.billingService.dailyClose(date) };
  }

  @Get('billing/deferred')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '보류(미수) 목록' })
  async getDeferred() {
    return this.billingService.getDeferred();
  }

  /**
   * 요양기관 종별 계산기(2026-10-20) — 같은 진료를 의원·병원·종합병원·상급종합으로 나란히 센다(고시 종별 단가 · 실청구와 같은 본인부담 규칙).
   * 저장 없음 · 환자 정보 없음(코드·수량·자격 구분만) → 변이 감사 면제.
   */
  @Post('billing/grade-calculator')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.EXECUTIVE)
  @NoAudit()
  @ApiOperation({ summary: '요양기관 종별 계산기 — 의원·병원·종합·상급종합 비교(저장 없음)' })
  async gradeCalculator(@Body() dto: GradeCalculatorDto) {
    return { data: await this.gradeCalc.calculate(dto) };
  }

  @Get('billing/calculate/:encounterId')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '수납 자동 계산 (진료 기반)' })
  async calculateBilling(@Param('encounterId') encounterId: string) {
    return { data: await this.billingService.calculateBilling(encounterId) };
  }

  @Get('billing/copayment-cap/:patientId')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '본인부담상한제 조회 (소득분위별)' })
  async getCopaymentCap(
    @Param('patientId') patientId: string,
    @Query('year') year?: string,
  ) {
    return { data: await this.billingService.calculateCopaymentCap(patientId, year ? parseInt(year) : undefined) };
  }

  @Get('billings')
  // 환자 차트 수납 탭이 이 EP 를 쓰므로 DOCTOR 포함(종전 NURSE/ADMIN 만이라 의사에겐 상시 403·빈 탭)
  // 🔴 2026-08-29: **검진 데스크(CHECKUP)도 같은 자리에서 403** 이었다 —
  //    nav 는 `/billing`(수납)을 ADMIN·NURSE·RECEPTIONIST·**CHECKUP** 넷에 열어 두는데
  //    이 EP 는 셋만 받았다. 검진 접수(`/his-checkup/reception`)가 수납으로 이어진다.
  //    같은 결함을 의사에게 한 번 겪고 접수원을 넣으면서 **검진만 빠뜨렸다.**
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '수납 목록 (patientId 지정 시 해당 환자만)' })
  async findAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('patientId', new ParseUUIDPipe({ optional: true })) patientId?: string, // 위치 인자 호환 위해 말미
  ) {
    return this.billingService.findAll({
      status,
      patientId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('billings/:id/receipt')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '영수증 데이터 (법정 13개 항목)' })
  async getReceipt(@Param('id', ParseUUIDPipe) id: string) {
    const billing = await this.billingService.getReceipt(id);
    return { data: billing };
  }

  @Get('billing/patients/:patientId/annual-payment')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '의료비 납입확인서 — 환자 한 해의 월별 외래/입원 낸 돈(원무 · P4-5)' })
  async getAnnualPaymentStatement(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('year') year?: string) {
    return { data: await this.billingService.getAnnualPaymentStatement(patientId, year ? Number(year) : new Date().getFullYear()) };
  }

  @Post('billings/:id/issue-receipt')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '영수증 진위확인 발급 (IssuedDocument + QR, 멱등)' })
  async issueReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user?: { id?: string; sub?: string } },
  ) {
    const issued = await this.billingService.issueReceipt(id, req.user?.id ?? req.user?.sub);
    return { data: issued };
  }

  @Get('billings/:id/receipt-en')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '영문 영수증 (외국인 환자용)' })
  async getReceiptEn(@Param('id', ParseUUIDPipe) id: string) {
    const receipt = await this.billingService.getReceipt(id);
    return { data: await this.billingService.translateReceiptToEnglish(receipt) };
  }

  @Get('billings/:id')
  // 🔴 2026-09-16 J2(실로그인 프로브): 같은 드리프트가 **세 번째**다.
  //    목록(`GET billings`)은 2026-08-29 에 CHECKUP 을 넣었는데 **상세는 그대로였다** —
  //    검진 데스크가 목록은 보고, 상세에서 403, 그런데 분납(`POST billings/:id/installment`)은 또 된다.
  //    한 자원의 목록→상세→분납이 가운데만 끊겨 있었다.
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '수납 상세 (항목 내역)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const billing = await this.billingService.findById(id);
    return { data: billing };
  }

  @Post('encounters/:encounterId/billing')
  /**
   * 🔴 **의사를 뺀 채 처방 화면이 이 EP 를 부르고 있었다** (2026-08-31 · 발굴 34회차).
   *    /orders 의 "처방 완료 (서명+수납)" 버튼은 서명(의사 전용)이 먼저라 **의사만 누를 수
   *    있는데**, 뒤이은 이 호출은 DOCTOR 가 없어 **언제나 403** 이었고 화면의 `catch {}` 가
   *    그것을 삼켜 "수납"까지 됐다고 말했다(P16). 서명=청구 트리거(encounter.service 규약)이고
   *    금액은 서버가 자동 산정하며 중복은 `Billing already exists` 로 막혀 있다 — 의사를 연다.
   */
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.DOCTOR)
  @ApiOperation({
    summary: '수납 생성 (자동 금액 산정)',
    description:
      '`notifyPatient: true` 이면 환자 앱 "수납 대기" 푸시를 시도한다(설정이 켜져 있을 때만). ' +
      '응답 `data.patientPush = { attempted, sent, reason }` 를 화면이 그대로 말한다.',
  })
  async create(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Body() dto?: CreateBillingDto,
  ) {
    const billing = await this.billingService.createFromEncounter(encounterId, {
      notifyPatient: dto?.notifyPatient === true,
    });
    return { data: billing };
  }

  @Get('billings/:id/payment-options')
  // 🔴 이 응답이 **보유 검진권**을 싣는다 — 검진 데스크가 못 부르면 검진권 수납이 그 자리에서 막힌다(J2).
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '수납 결제 옵션(잔여 부담액·보유 검진권)' })
  async paymentOptions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.billingService.getPaymentOptions(id) };
  }

  @Patch('billings/:id/pay')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '수납 처리(복합결제·검진권 지원)' })
  async pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    // (2026-10-14 결함 발굴 수납 P5-6) 처리자는 로그인 직원 — 종전엔 넘기지 않아 수납 원장 처리자가 늘 null 이었다
    const billing = await this.billingService.pay(id, { ...dto, processedBy: userId });
    return { data: billing };
  }

  @Patch('billings/:id/cancel')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '수납 취소' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    // 🔴 (P5-6) 처리자 = 로그인 직원(종전엔 취소·환불·보류의 처리자가 늘 null — DTO 에 없는 값은 화이트리스트가 지운다)
    const billing = await this.billingService.cancel(id, dto.reason, userId);
    return { data: billing };
  }

  @Patch('billings/:id/refund')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '환불 처리' })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    const billing = await this.billingService.refund(id, { ...dto, processedBy: userId });
    return { data: billing };
  }

  @Patch('billings/:id/defer')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '수납 보류 (미수 처리)' })
  async defer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeferBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    const billing = await this.billingService.defer(id, { ...dto, processedBy: userId });
    return { data: billing };
  }

  @AuditAiRead('AiBillingEdiSuggest')

  @Get('encounters/:encounterId/ai-edi-suggest')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI EDI 수가코드 자동 매핑 제안' })
  async suggestEdiCodes(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    return { data: await this.billingService.suggestEdiCodes(encounterId) };
  }

  @AuditAiRead('AiBillingAnomaly')

  @Get('encounters/:encounterId/ai-anomaly')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 청구 오류 사전 감지' })
  async detectBillingAnomaly(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    return { data: await this.billingService.detectBillingAnomaly(encounterId) };
  }

  // ── HIRA 비급여 보고 ──

  @Get('billing/hira-non-covered-report')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'HIRA 비급여 진료비 보고 데이터 생성 (연 1회)' })
  async generateHiraNonCoveredReport(@Query('year') year?: string) {
    return { data: await this.billingService.generateHiraNonCoveredReport(parseInt(year ?? String(new Date().getFullYear()))) };
  }

  @Get('billing/non-covered-summary')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '비급여 항목별 매출 요약' })
  async getNonCoveredSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.billingService.getNonCoveredSummary(from, to) };
  }

  @Get('billing/non-covered-reconciliation')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '🔴 비급여 정본 대조 — 환자 고지가(non_covered_items) ↔ 실청구가(수가마스터) 불일치 노출(교정 없음)' })
  async getNonCoveredReconciliation() {
    return { data: await this.billingService.getNonCoveredReconciliation() };
  }

  @Get('billing/unpriced-codes')
  @Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF, UserRole.PHARMACIST)
  @ApiOperation({ summary: '🔴 약가·수가 미등재 코드 — "급여 0원" 오표시/0원 청구 위험 목록' })
  async getUnpricedCodes(@Query('limit') limit?: string) {
    return { data: await this.billingService.getUnpricedBillableCodes(limit ? Number(limit) : 200) };
  }

  @Get('billing/copayment-cap-patients')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '본인부담 상한 초과 환자 목록' })
  async getCopaymentCapPatients(@Query('year') year?: string) {
    return { data: await this.billingService.getCopaymentCapExceedPatients(parseInt(year ?? String(new Date().getFullYear()))) };
  }

  // ── 분할 납부 ──

  @Post('billings/:id/installment')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '분할 납부 스케줄 생성' })
  async createInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInstallmentPlanDto,
  ) {
    return { data: await this.billingService.createInstallmentPlan(id, dto.totalInstallments, dto.intervalDays ?? 30) };
  }

  @Get('billings/:id/installments')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '분할 납부 스케줄 조회' })
  async getInstallments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.billingService.getInstallmentPlan(id) };
  }

  @Patch('billing/installments/:installmentId/pay')
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '분할 납부 1건 결제' })
  async payInstallment(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() dto: PayInstallmentDto,
  ) {
    return { data: await this.billingService.payInstallment(installmentId, dto.method, dto.note) };
  }

  @Get('billing/outstanding')
  // 🔴 미수금 현황도 수납 화면의 것이다 — 접수원은 있고 검진 데스크만 빠져 있었다
  @Roles(UserRole.NURSE, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.CHECKUP)
  @ApiOperation({ summary: '미수금 현황 (환자별 미수금 목록·patientId 지정 시 해당 환자 미납만)' })
  async getOutstanding(@Query('page') page?: string, @Query('limit') limit?: string, @Query('patientId') patientId?: string) {
    return { data: await this.billingService.getOutstandingBillings(page ? Number(page) : 1, limit ? Number(limit) : 50, patientId) };
  }
}
