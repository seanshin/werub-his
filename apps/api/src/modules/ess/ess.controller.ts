import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, Res, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { EssService } from './ess.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClockDto, LeaveRequestDto, CertificateDto, DependentDto, PayrollIdentityDto, UploadStaffDocDto, DecideApprovalDto, AttendanceCorrectionDto, OvertimeRequestDto, LeaveCancelDto, DelegationDto, SubmitClinicalApprovalDto, SubmitConsentApprovalDto, SubmitNoteCosignDto, SubmitRecordCopyApprovalDto } from './dto/ess.dto';

const STAFF_DOC_MAX = 10 * 1024 * 1024; // 10MB
const STAFF_DOC_TYPES = ['image/png', 'image/jpeg', 'application/pdf', 'image/heic'];

// 직원 행정 셀프서비스(ESS) — 본인(self) 스코프. 내정보/근무표는 기존 /hr/me·/hr/schedule 재사용.
/**
 * 🔴 역할 목록은 shared 정본 하나 — 여기에 다시 적으면 신설 직군이 따라오지 못한다.
 *    실제로 그랬다(2026-09-02 실측): 손으로 적은 12역할에 CRM_MANAGER·CRM_STAFF 가 빠져
 *    CRM 직원 4명이 **자기** 출퇴근·급여명세·휴가·결재함에서 상시 403 이었다
 *    (이 컨트롤러는 전 핸들러가 `@CurrentUser` 자기 스코프다 — 남의 것을 보는 EP 가 아니다).
 *    ESS 는 급여·근태를 가진 **모든 계정**의 자기 서비스라 정본 전체를 그대로 쓴다.
 */
const ESS_SELF_ROLES = EVERY_STAFF_ROLE.map((r) => r as UserRole);

@ApiTags('ESS (직원 셀프서비스)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ESS_SELF_ROLES)
@Controller('api/v1/ess')
export class EssController {
  constructor(private readonly svc: EssService) {}

  // 근태 ──
  @Post('attendance/clock')
  // 🔴 인증수단은 서버가 정한다 — body 의 method 는 클라이언트 선언이라 증거가 아니다(P16).
  //    'BIO' 를 body 로 보내던 화면이 있었으므로 clockFromClient 가 WEB 으로 정규화한다.
  @ApiOperation({ summary: '출퇴근 체크(화면 버튼·WEB/QR — 생체·PIN은 서버 내부 경로 전용)' })
  async clock(@CurrentUser('id') userId: string, @Body() dto: ClockDto) {
    return { data: await this.svc.clockFromClient(userId, dto.type, dto.method, dto.lat, dto.lng) };
  }

  @Get('attendance')
  @ApiOperation({ summary: '내 출퇴근 이력' })
  async attendance(@CurrentUser('id') userId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.svc.attendance(userId, from, to) };
  }

  // 휴가 ──
  @Post('leave')
  @ApiOperation({ summary: '휴가/근태정정 신청 → 전자결재 상신' })
  async requestLeave(@CurrentUser('id') userId: string, @Body() dto: LeaveRequestDto) {
    return { data: await this.svc.requestLeave(userId, dto) };
  }

  @Get('leave')
  @ApiOperation({ summary: '내 휴가 신청 목록' })
  async listLeaves(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listLeaves(userId) };
  }

  @Get('leave/balance')
  @ApiOperation({ summary: '연차 잔여(ERP SoT, 로컬 폴백) — meta.unavailableSources = 못 물어본 출처' })
  async balance(@CurrentUser('id') userId: string, @Query('year') year?: string) {
    // 🔴 못 물어본 출처는 항목이 아니라 meta 에 — HIS 원장도 비어 있으면 항목이 0개라 실패가 통째로 사라진다
    const r = await this.svc.leaveBalanceDetailed(userId, year ? Number(year) : undefined);
    return { data: r.items, meta: { unavailableSources: r.unavailableSources } };
  }

  @Get('payslip')
  @ApiOperation({ summary: '급여명세 조회(ERP 제공, 확정분)' })
  async payslip(@CurrentUser('id') userId: string, @Query('period') period?: string) {
    return { data: await this.svc.getPayslip(userId, period) };
  }

  // 근태 정정·초과근무 (P1) ──
  @Post('attendance/corrections')
  @ApiOperation({ summary: '근태 정정 신청 → 결재(원본 불변·승인 시 correctionOf 레코드)' })
  async requestCorrection(@CurrentUser('id') userId: string, @Body() dto: AttendanceCorrectionDto) {
    return { data: await this.svc.requestAttendanceCorrection(userId, dto) };
  }

  @Get('attendance/corrections')
  @ApiOperation({ summary: '내 근태 정정 신청 이력' })
  async listCorrections(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listAttendanceCorrections(userId) };
  }

  @Post('overtime')
  @ApiOperation({ summary: '초과근무 신청 → 결재(승인분만 주간 집계 반영)' })
  async requestOvertime(@CurrentUser('id') userId: string, @Body() dto: OvertimeRequestDto) {
    return { data: await this.svc.requestOvertime(userId, dto) };
  }

  @Get('overtime')
  @ApiOperation({ summary: '내 초과근무 신청 이력' })
  async listOvertime(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listOvertimes(userId) };
  }

  // 결재함 (INTERNAL 모드 · P0) ──
  @Get('approvals/inbox')
  @ApiOperation({ summary: 'HR 결재 수신함 — 내가 결재할 차례' })
  async approvalInbox(@CurrentUser('id') userId: string) {
    return { data: await this.svc.approvalInbox(userId) };
  }

  @Get('approvals/outbox')
  @ApiOperation({ summary: 'HR 상신함 — 내 문서 진행상태(결재선 타임라인)' })
  async approvalOutbox(@CurrentUser('id') userId: string) {
    return { data: await this.svc.approvalOutbox(userId) };
  }

  @Get('approvals/dashboard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '결재 관리 대시보드 — 카테고리(인사·기록지·사전승인)별 현황(관리자)' })
  async approvalDashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.svc.approvalDashboard({ from, to }) };
  }

  @Post('approvals/:relayId/decide')
  @ApiOperation({ summary: 'HR 결재 승인/반려(반려 사유 필수)' })
  async decideApproval(@CurrentUser('id') userId: string, @Param('relayId', ParseUUIDPipe) relayId: string, @Body() dto: DecideApprovalDto) {
    return { data: await this.svc.decideApproval(relayId, userId, dto.decision, dto.comment) };
  }

  // 임상 기록지 전자결재 상신 (파일럿: 증명서) — 간호/행정 기안 → 담당의 결재함 확약 ──
  @Post('clinical-approvals')
  @ApiOperation({ summary: '증명서 전자결재 확약 상신(간호/행정 기안 → 담당의). 게이트 approval.clinicalCertificate.enabled' })
  async submitClinicalApproval(@CurrentUser('id') userId: string, @Body() dto: SubmitClinicalApprovalDto) {
    return { data: await this.svc.submitClinicalApproval(userId, dto) };
  }

  @Post('consent-approvals')
  @ApiOperation({ summary: '동의서 의사 확약 상신(간호 기안 → 담당의 doctorSign). 게이트 approval.consent.enabled' })
  async submitConsentApproval(@CurrentUser('id') userId: string, @Body() dto: SubmitConsentApprovalDto) {
    return { data: await this.svc.submitConsentApproval(userId, dto) };
  }

  @Post('note-cosigns')
  @ApiOperation({ summary: '간호기록 의사 공동서명 상신(간호 기안 → 담당의). 게이트 approval.clinicalNote.enabled' })
  async submitNoteCosign(@CurrentUser('id') userId: string, @Body() dto: SubmitNoteCosignDto) {
    return { data: await this.svc.submitNoteCosign(userId, dto) };
  }

  @Post('record-copy-approvals')
  @ApiOperation({ summary: '의무기록 사본 발급 승인 상신(행정 기안 → 담당의). 게이트 approval.recordCopy.enabled' })
  async submitRecordCopyApproval(@CurrentUser('id') userId: string, @Body() dto: SubmitRecordCopyApprovalDto) {
    return { data: await this.svc.submitRecordCopyApproval(userId, dto) };
  }

  @Post('leave/:id/cancel')
  @ApiOperation({ summary: '승인 휴가 회수(취소) 상신 — 새 결재 문서(HR_LEAVE_CANCEL)' })
  async requestLeaveCancel(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveCancelDto) {
    return { data: await this.svc.requestLeaveCancel(userId, id, dto.reason) };
  }

  @Get('approvals/:relayId/attachment')
  @ApiOperation({ summary: '결재 증빙 열람(결재선 참여자 한정·감사)' })
  async approvalAttachment(@CurrentUser('id') userId: string, @Param('relayId', ParseUUIDPipe) relayId: string, @Res() res: Response) {
    const f = await this.svc.readApprovalAttachment(relayId, userId);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
    res.send(f.buffer);
  }

  // 대결(위임) (P2-4) ──
  @Post('approvals/delegation')
  @ApiOperation({ summary: '결재 대결(위임) 지정' })
  async createDelegation(@CurrentUser('id') userId: string, @Body() dto: DelegationDto) {
    return { data: await this.svc.createDelegation(userId, dto) };
  }

  @Get('approvals/delegation')
  @ApiOperation({ summary: '내 위임 목록(위임/수임)' })
  async listDelegations(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listDelegations(userId) };
  }

  @Delete('approvals/delegation/:id')
  @ApiOperation({ summary: '위임 해제' })
  async revokeDelegation(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.revokeDelegation(userId, id) };
  }

  // 팀 캘린더 (P2-3, 부서장) ──
  @Get('team/calendar')
  @ApiOperation({ summary: '팀 휴가+당직 월뷰(부서장) — 인력공백 경고' })
  async teamCalendar(@CurrentUser('id') userId: string, @Query('month') month?: string) {
    return { data: await this.svc.teamCalendar(userId, month) };
  }

  @Post('leave/:id/withdraw')
  @ApiOperation({ summary: '휴가 신청 철회' })
  async withdraw(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.withdrawLeave(userId, id) };
  }

  // 증명서 ──
  @Post('certificates')
  @ApiOperation({ summary: '재직/경력 증명서 발급' })
  async issueCert(@CurrentUser('id') userId: string, @Body() dto: CertificateDto) {
    return { data: await this.svc.issueCertificate(userId, dto.kind) };
  }

  @Get('certificates')
  @ApiOperation({ summary: '내 증명서 목록' })
  async listCerts(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listCertificates(userId) };
  }

  // 자격·교육 ──
  @Get('qualifications')
  @ApiOperation({ summary: '내 면허·자격·의무교육 이수현황' })
  async qualifications(@CurrentUser('id') userId: string) {
    return { data: await this.svc.qualifications(userId) };
  }

  // 환영·회사소개 ──
  @Get('welcome')
  @ApiOperation({ summary: '환영·회사소개 콘텐츠 재열람(재직자)' })
  async welcome() {
    return { data: await this.svc.getWelcome() };
  }

  // ══ 급여 기초정보(셀프서비스) ══
  // 부양가족 ──
  @Get('dependents')
  @ApiOperation({ summary: '내 부양가족 목록' })
  async dependents(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listDependents(userId) };
  }
  @Post('dependents')
  @ApiOperation({ summary: '부양가족 추가' })
  async addDependent(@CurrentUser('id') userId: string, @Body() dto: DependentDto) {
    return { data: await this.svc.addDependent(userId, dto) };
  }
  @Put('dependents/:id')
  @ApiOperation({ summary: '부양가족 수정' })
  async updateDependent(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DependentDto) {
    return { data: await this.svc.updateDependent(userId, id, dto) };
  }
  @Delete('dependents/:id')
  @ApiOperation({ summary: '부양가족 삭제' })
  async removeDependent(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.removeDependent(userId, id) };
  }

  // 입사/급여 서류 ── (암호화 저장·본인만)
  @Get('documents')
  @ApiOperation({ summary: '내 서류 목록' })
  async documents(@CurrentUser('id') userId: string) {
    return { data: await this.svc.listStaffDocuments(userId) };
  }
  @Post('documents')
  @ApiOperation({ summary: '서류 업로드(통장사본·신분증 등·암호화 저장)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: STAFF_DOC_MAX },
    fileFilter: (_r, f, cb) => { if (!STAFF_DOC_TYPES.includes(f.mimetype)) return cb(new BadRequestException('이미지(PNG/JPG/HEIC) 또는 PDF만 가능합니다.'), false); cb(null, true); },
  }))
  async uploadDocument(@CurrentUser('id') userId: string, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadStaffDocDto) {
    if (!file) throw new BadRequestException('파일이 필요합니다.');
    return { data: await this.svc.uploadStaffDocument(userId, dto.category ?? 'OTHER', file.originalname, file.buffer, file.mimetype) };
  }
  @Get('documents/:id/file')
  @ApiOperation({ summary: '내 서류 다운로드(복호)' })
  async downloadDocument(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buffer, contentType, fileName } = await this.svc.readStaffDocument(userId, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }
  @Delete('documents/:id')
  @ApiOperation({ summary: '서류 삭제' })
  async deleteDocument(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteStaffDocument(userId, id) };
  }

  // ERP 급여 read 연동 ──
  @Get('deduction-codes')
  @ApiOperation({ summary: '인적공제 코드(ERP) — 부양가족 공제구분' })
  async deductionCodes() {
    return { data: await this.svc.getDeductionCodes() };
  }
  @Get('payroll-identity/erp')
  @ApiOperation({ summary: 'ERP 등록 급여기초(마스킹·R-4)' })
  async erpPayrollIdentity(@CurrentUser('id') userId: string) {
    return { data: await this.svc.getErpPayrollIdentity(userId) };
  }
  @Get('withholding-receipt')
  @ApiOperation({ summary: '원천징수영수증(연말정산·ERP)' })
  async withholding(@CurrentUser('id') userId: string, @Query('year') year?: string) {
    return { data: await this.svc.getWithholdingReceipt(userId, year) };
  }
  @Get('duties')
  @ApiOperation({ summary: '당직/근무표(ERP·R-8)' })
  async duties(@CurrentUser('id') userId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.svc.getDuties(userId, from, to) };
  }
  @Get('performance')
  @ApiOperation({ summary: '성과급 실적(ERP·R-9)' })
  async performance(@CurrentUser('id') userId: string, @Query('period') period?: string) {
    return { data: await this.svc.getPerformance(userId, period) };
  }
  @Get('severance')
  @ApiOperation({ summary: '퇴직금 추정(ERP·R-11)' })
  async severance(@CurrentUser('id') userId: string, @Query('asOf') asOf?: string) {
    return { data: await this.svc.getSeverance(userId, asOf) };
  }
  @Get('erp-certificates')
  @ApiOperation({ summary: '재직/경력 증명서 목록(ERP 정본·R-10)' })
  async erpCertificates(@CurrentUser('id') userId: string) {
    return { data: await this.svc.getErpCertificates(userId) };
  }
  @Get('erp-certificates/:id/pdf')
  @ApiOperation({ summary: '증명서 PDF 다운로드(ERP·본인)' })
  async erpCertificatePdf(@CurrentUser('id') userId: string, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.svc.getErpCertificatePdf(userId, id);
    if (!doc) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '증명서를 찾을 수 없습니다.' } }); return; }
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(doc.buffer);
  }

  // 급여 신원(계좌·주민번호) — HIS 전체값 미보관·ERP 릴레이(게이트) ──
  @Get('payroll-identity')
  @ApiOperation({ summary: '내 급여 신원정보 상태(마스킹·전송시각·릴레이 활성여부)' })
  async payrollIdentity(@CurrentUser('id') userId: string) {
    return { data: await this.svc.getPayrollRelayStatus(userId) };
  }
  @Put('payroll-identity')
  @ApiOperation({ summary: '계좌·주민번호 등록→ERP 릴레이(게이트: ess.payrollRelay.enabled). HIS 전체값 미보관.' })
  async relayPayrollIdentity(@CurrentUser('id') userId: string, @Body() dto: PayrollIdentityDto) {
    return { data: await this.svc.relayPayrollIdentity(userId, dto) };
  }
}
