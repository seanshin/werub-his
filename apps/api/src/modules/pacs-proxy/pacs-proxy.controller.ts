import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Req, Res, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Request, Response as ExpressResponse } from 'express';
import { PacsProxyService, PacsSsoContext } from './pacs-proxy.service';
import { PacsIntegrationListener } from './pacs-integration.listener';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SsoIdpService } from '../auth/sso-idp/sso-idp.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import {
  CreateWorklistItemDto, CreatePacsOrderDto, CreatePacsReportDto,
  UpdatePacsReportDto, RequestAiInferenceDto,
  RetakeRequestDto, CancelOrderDto, AdditionalViewDto, UrgentReadingDto,
  PatientUpdateDto, ClinicalInfoDto, ScheduleChangeDto,
} from './dto/pacs-proxy.dto';

interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

/** Request에서 SSO 컨텍스트 추출 */
function extractSso(req: Request): PacsSsoContext | undefined {
  const user = req.user as AuthenticatedUser | undefined;
  const authHeader = req.headers.authorization;
  if (!user || !authHeader) return undefined;
  return {
    hisUserId: user.id,
    hisUserEmail: user.email,
    hisUserRole: user.role,
    hisJwt: authHeader.replace('Bearer ', ''),
  };
}

@ApiTags('PACS Proxy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/pacs')
export class PacsProxyController {
  private readonly logger = new Logger(PacsProxyController.name);

  constructor(
    private readonly pacsProxy: PacsProxyService,
    private readonly pacsListener: PacsIntegrationListener,
    private readonly ssoIdp: SsoIdpService,
  ) {}

  // ── DICOMweb Studies ──

  @Get('studies')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE, UserRole.PHARMACIST)
  @RequirePermission(Permission.PACS_STUDY_VIEW)
  @ApiOperation({ summary: 'Study 목록 (OpenPACS 프록시)' })
  async getStudies(
    @Req() req: Request,
    @Query('patientId') patientId?: string,
    @Query('studyDate') studyDate?: string,
    @Query('modality') modality?: string,
  ) {
    const result = await this.pacsProxy.getStudies({ patientId, studyDate, modality }, extractSso(req));
    return { data: result };
  }

  @Get('studies/:uid/series')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE, UserRole.PHARMACIST)
  @RequirePermission(Permission.PACS_STUDY_VIEW)
  @ApiOperation({ summary: 'Series 목록 (OpenPACS 프록시)' })
  async getStudySeries(@Req() req: Request, @Param('uid') uid: string) {
    const result = await this.pacsProxy.getStudySeries(uid, extractSso(req));
    return { data: result };
  }

  /**
   * WADO 이미지 중계 — 판독 워크스테이션이 PACS 를 직접 부르지 않게 한다.
   *
   * 🔴 `/pacs-api/wado` 직접 호출은 HIS 의 JWT·RBAC·감사를 통째로 우회한다.
   *    여기로 오면 RolesGuard + PACS_STUDY_VIEW 권한이 걸리고, 실패는 503/404 로 갈라 말한다
   *    (빈 응답으로 "영상 없음"을 흉내내지 않는다).
   */
  @Get('wado')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE)
  @RequirePermission(Permission.PACS_STUDY_VIEW)
  @ApiOperation({ summary: 'WADO 영상 바이트 중계 (OpenPACS 프록시)' })
  async getWadoImage(
    @Req() req: Request,
    @Res() res: ExpressResponse,
    @Query('studyUID') studyUID?: string,
    @Query('seriesUID') seriesUID?: string,
    @Query('objectUID') objectUID?: string,
  ) {
    if (!studyUID) throw new BadRequestException({ error: 'VALIDATION_ERROR', message: 'studyUID 가 필요합니다.' });
    const { contentType, body } = await this.pacsProxy.fetchWadoImage({ studyUID, seriesUID, objectUID }, extractSso(req));
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
    });
    res.send(body);
  }

  // ── Worklist ──

  @Get('worklist')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE)
  @RequirePermission(Permission.PACS_STUDY_VIEW)
  @ApiOperation({ summary: 'Worklist 목록 (OpenPACS 프록시)' })
  async getWorklist(
    @Req() req: Request,
    @Query('scheduledDate') scheduledDate?: string,
    @Query('status') status?: string,
    @Query('modality') modality?: string,
  ) {
    const result = await this.pacsProxy.getWorklist({ scheduledDate, status, modality }, extractSso(req));
    return { data: result };
  }

  @Post('worklist')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_WORKLIST_MANAGE)
  @ApiOperation({ summary: 'Worklist 항목 생성 (OpenPACS 프록시)' })
  async createWorklistItem(@Req() req: Request, @Body() body: CreateWorklistItemDto) {
    const result = await this.pacsProxy.createWorklistItem(body, extractSso(req));
    return { data: result };
  }

  /** 워크리스트 실패분 일괄 재등록(§H.8) — OPENPACS 자격 회복 후 관리자가 누른다 */
  @Post('worklist/retry-failed')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'FAILED 워크리스트 일괄 재시도 — 성공/실패 건별 반환' })
  async retryFailedWorklist() {
    return { data: await this.pacsListener.retryFailedWorklist() };
  }

  @Get('worklist/failed-count')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '워크리스트 FAILED 잔량' })
  async failedWorklistCount() {
    return { data: { failed: await this.pacsListener.countFailedWorklist() } };
  }

  // ── Orders (영상 오더) ──

  @Post('orders')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_ORDER_CREATE)
  @ApiOperation({ summary: '영상 오더 생성 (OpenPACS 프록시)' })
  async createOrder(@Req() req: Request, @Body() dto: CreatePacsOrderDto) {
    const result = await this.pacsProxy.createOrder(dto, extractSso(req));
    return { data: result };
  }

  @Get('orders/:accession/status')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '오더 상태 조회 (OpenPACS 프록시)' })
  async getOrderStatus(@Req() req: Request, @Param('accession') accession: string) {
    const result = await this.pacsProxy.getOrderStatus(accession, extractSso(req));
    return { data: result };
  }

  // ── Reports (기존 + 추가) ──

  @Get('reports')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE, UserRole.PHARMACIST)
  @RequirePermission(Permission.PACS_REPORT_VIEW)
  @ApiOperation({ summary: '판독 리포트 목록 (OpenPACS 프록시)' })
  async getReports(
    @Req() req: Request,
    @Query('patientId') patientId?: string,
    @Query('studyUid') studyUid?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.pacsProxy.getReports({ patientId, studyUid, status }, extractSso(req));
    return { data: result };
  }

  @Post('reports')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_REPORT_CREATE)
  @ApiOperation({ summary: '판독 리포트 생성 (OpenPACS 프록시)' })
  async createReport(@Req() req: Request, @Body() dto: CreatePacsReportDto) {
    const result = await this.pacsProxy.createReport(dto, extractSso(req));
    return { data: result };
  }

  @Get('reports/:id')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE, UserRole.PHARMACIST)
  @RequirePermission(Permission.PACS_REPORT_VIEW)
  @ApiOperation({ summary: '리포트 상세 조회 (OpenPACS 프록시)' })
  async getReportDetail(@Req() req: Request, @Param('id') id: string) {
    const result = await this.pacsProxy.getReportDetail(id, extractSso(req));
    return { data: result };
  }

  @Patch('reports/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_REPORT_CREATE)
  @ApiOperation({ summary: '리포트 수정 (OpenPACS 프록시)' })
  async updateReport(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdatePacsReportDto) {
    const result = await this.pacsProxy.updateReport(id, dto, extractSso(req));
    return { data: result };
  }

  @Post('reports/:id/sign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_REPORT_SIGN)
  @ApiOperation({ summary: '리포트 서명 (OpenPACS 프록시)' })
  async signReport(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('as_preliminary') asPreliminary?: string,
  ) {
    const result = await this.pacsProxy.signReport(id, asPreliminary === 'true', extractSso(req));
    return { data: result };
  }

  // ── Patient Reports (환자별 리포트) ──

  @Get('patients/:pid/reports')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE, UserRole.PHARMACIST)
  @RequirePermission(Permission.PACS_REPORT_VIEW)
  @ApiOperation({ summary: '환자별 리포트 목록 (OpenPACS 프록시)' })
  async getPatientReports(@Req() req: Request, @Param('pid') pid: string) {
    const result = await this.pacsProxy.getPatientReports(pid, extractSso(req));
    return { data: result };
  }

  // ── AI Inference ──

  @Get('ai/models')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 모델 목록 (OpenPACS 프록시)' })
  async getAiModels(@Req() req: Request) {
    const result = await this.pacsProxy.getAiModels(extractSso(req));
    return { data: result };
  }

  @Post('ai/inference')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.PACS_AI_INFERENCE)
  @ApiOperation({ summary: 'AI 추론 요청 (OpenPACS 프록시)' })
  async requestAiInference(@Req() req: Request, @Body() dto: RequestAiInferenceDto) {
    const result = await this.pacsProxy.requestAiInference(dto, extractSso(req));
    return { data: result };
  }

  @Get('ai/jobs/:jobId')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 작업 상태 조회 (OpenPACS 프록시)' })
  async getAiJobStatus(@Req() req: Request, @Param('jobId') jobId: string) {
    const result = await this.pacsProxy.getAiJobStatus(jobId, extractSso(req));
    return { data: result };
  }

  // ── Dashboard ──

  @Get('dashboard/today')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 통계 (OpenPACS 프록시)' })
  async getDashboardToday(@Req() req: Request) {
    const result = await this.pacsProxy.getDashboardToday(extractSso(req));
    return { data: result };
  }

  @Get('dashboard/reading-queue')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '판독 대기열 (OpenPACS 프록시)' })
  async getReadingQueue(@Req() req: Request) {
    const result = await this.pacsProxy.getReadingQueue(extractSso(req));
    return { data: result };
  }

  // ── Templates ──

  @Get('templates')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '리포트 템플릿 목록 (OpenPACS 프록시)' })
  async getTemplates(@Req() req: Request) {
    const result = await this.pacsProxy.getTemplates(extractSso(req));
    return { data: result };
  }

  // ── Health ──

  @Get('health')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: 'PACS 상태 확인' })
  async checkHealth() {
    const result = await this.pacsProxy.checkHealth();
    // 🔴 서비스 계정 자격이 있는지를 **갈라 말한다**. 종전엔 "PACS 살아 있음"과 "포털·웹훅·배치가
    //    인증 없이 503 을 받는 상태"가 상태 응답에서 같은 모양이었다(REAL 미설정=NOT_CONFIGURED · 개발 폴백은 CONFIGURED).
    //    문장은 조립하지 않는다 — 화면이 어휘로 말한다.
    const serviceAccount = this.pacsProxy.isServiceAccountConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED';
    return { data: { ...(result as Record<string, unknown>), serviceAccount } };
  }

  // ── HIS Integration ──

  @Post('his/retake-request')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '재촬영 요청' })
  async retakeRequest(@Req() req: Request, @Body() dto: RetakeRequestDto) {
    const result = await this.pacsProxy.retakeRequest({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Post('his/cancel-order')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '검사 취소' })
  async cancelOrder(@Req() req: Request, @Body() dto: CancelOrderDto) {
    const result = await this.pacsProxy.cancelOrder({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Post('his/additional-view')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '추가 촬영 요청' })
  async additionalView(@Req() req: Request, @Body() dto: AdditionalViewDto) {
    const result = await this.pacsProxy.additionalView({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Post('his/urgent-reading')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '긴급 판독 요청' })
  async urgentReading(@Req() req: Request, @Body() dto: UrgentReadingDto) {
    const result = await this.pacsProxy.urgentReading({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Post('his/patient-update')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '환자 정보 동기화' })
  async patientUpdate(@Req() req: Request, @Body() dto: PatientUpdateDto) {
    const result = await this.pacsProxy.patientUpdate({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Post('his/clinical-info')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '임상 정보 전송' })
  async clinicalInfo(@Req() req: Request, @Body() dto: ClinicalInfoDto) {
    const result = await this.pacsProxy.clinicalInfo({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Get('his/report-status')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '판독 상태 조회' })
  async reportStatus(@Req() req: Request, @Query('accessionNumber') accessionNumber: string) {
    const result = await this.pacsProxy.reportStatus(accessionNumber, extractSso(req));
    return { data: result };
  }

  @Get('his/study-status')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '검사 상태 조회' })
  async studyStatus(@Req() req: Request, @Query('accessionNumber') accessionNumber: string) {
    const result = await this.pacsProxy.studyStatus(accessionNumber, extractSso(req));
    return { data: result };
  }

  @Post('his/schedule-change')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '검사 일정 변경' })
  async scheduleChange(@Req() req: Request, @Body() dto: ScheduleChangeDto) {
    const result = await this.pacsProxy.scheduleChange({ ...dto }, extractSso(req));
    return { data: result };
  }

  @Get('his/available-slots')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: '촬영 가능 시간대 조회' })
  async availableSlots(
    @Req() req: Request,
    @Query('modality') modality?: string,
    @Query('date') date?: string,
  ) {
    const result = await this.pacsProxy.availableSlots(modality, date, extractSso(req));
    return { data: result };
  }

  @Get('his/requests')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiTags('PACS HIS Integration')
  @ApiOperation({ summary: 'HIS 요청 이력 조회' })
  async getRequests(@Req() req: Request, @Query('limit') limit?: string) {
    const result = await this.pacsProxy.getRequests(limit ? parseInt(limit, 10) : undefined, extractSso(req));
    return { data: result };
  }

  // ── Viewer URL (SSO 토큰 포함) ──

  @Get('viewer/:studyUid')
  @Roles(UserRole.DOCTOR, UserRole.LAB_TECH, UserRole.ADMIN, UserRole.NURSE)
  @RequirePermission(Permission.PACS_VIEWER_ACCESS)
  @ApiOperation({ summary: 'OHIF 뷰어 URL 반환 (내부 IdP 단기·1회용 토큰)' })
  async getViewerUrl(@Req() req: Request, @Param('studyUid') studyUid: string) {
    /**
     * 🔴 (외부 점검) 종전에는 `extractSso(req).hisJwt` — **8시간짜리 메인 access 토큰**을
     *    뷰어 URL 쿼리에 실어 새 창으로 보냈다. 그 토큰은 jti 가 없어 재사용되고, 브라우저 기록·PACS 접근 로그·
     *    Referer 에 남는다. 같은 화면의 '스터디 없음' 경로(`web/src/lib/pacs.ts`)는 이미 내부 IdP grant
     *    (audience `ohif` · 60초 · jti 1회 소비)를 쓰고 있었다 — 같은 사실에 자격이 둘이었다(P12). 강한 쪽으로 맞춘다.
     * 🔴 발급 실패는 메인 토큰으로 되돌아가지 않고 **토큰 없는 URL + meta 로 그 사실을 말한다**
     *    (뷰어가 별도 로그인을 요구할 수는 있어도 8시간 자격이 URL 에 남는 것보다 안전한 쪽이다).
     */
    const user = req.user as AuthenticatedUser | undefined;
    let viewerToken: string | undefined;
    let expiresInSec: number | undefined;
    let reason: 'NO_USER' | 'SSO_GRANT_FAILED' | undefined = user ? undefined : 'NO_USER';
    if (user) {
      try {
        const granted = await this.ssoIdp.grant(user.id, user.role, 'ohif');
        if (granted.mode === 'url') { viewerToken = granted.token; expiresInSec = granted.expiresIn; }
        else reason = 'SSO_GRANT_FAILED';
      } catch (e) {
        reason = 'SSO_GRANT_FAILED';
        this.logger.warn(`뷰어 SSO 토큰 발급 실패(study=${studyUid}) — 토큰 없이 뷰어 URL 을 돌려준다: ${(e as Error).message}`);
      }
    }
    return {
      data: { url: this.pacsProxy.getViewerUrl(studyUid, viewerToken) },
      meta: viewerToken
        ? { tokenKind: 'internal-sso' as const, audience: 'ohif', expiresInSec, oneTime: true }
        : { tokenKind: 'none' as const, reason },
    };
  }
}
