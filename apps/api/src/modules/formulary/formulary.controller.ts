import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FormularyService } from './formulary.service';
import { FormularyGateService, type FormularyDomain } from './formulary-gate.service';
import { NoAudit } from '../audit/no-audit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FormularyStatusOfDto, AddFormularyDto, UpdateFormularyDto, ToggleFormularyDto, CreateFormularyRequestDto, DecideFormularyRequestDto, ImportFormularyCsvDto, SeedFormularyFromUsageDto, StartFormularyAiDraftDto, CreateFormularyListDto } from './dto/formulary.dto';

@ApiTags('Formulary (원내 처방집)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/formulary')
export class FormularyController {
  constructor(private readonly svc: FormularyService, private readonly gate: FormularyGateService) {}

  // ── 관리(위원회·ADMIN) ──

  @Get('summary')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '영역별 승인 수·대기 요청 수' })
  async summary() {
    return { data: await this.svc.summary() };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '승인 목록(영역별·코드명 조인)' })
  async list(@Query('domain') domain: string, @Query('status') status?: string, @Query('q') q?: string) {
    return { data: await this.svc.list(domain, status, q) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '등재(단건/일괄) — 중복은 재활성화' })
  async add(@Body() dto: AddFormularyDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.add(userId, dto) };
  }

  @Post('import-csv')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CSV 일괄 등재 — dryRun=true 미리보기(행별 판정·쓰기 없음) → false 확정(행마다 등재 정본 호출·부분 실패 행 단위)' })
  async importCsv(@Body() dto: ImportFormularyCsvDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.importCsv(userId, dto) };
  }

  @Get('policy')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '영역별 시행 모드(OFF/WARN/BLOCK) — 처방 화면 소비' })
  async policy() {
    return { data: await this.svc.getPolicy() };
  }

  // 🔴 W8-R2 F3 — 모드만으로는 "적용 중"인지 알 수 없다. 영역별 **집행점 유무**를 따로 준다
  // (프리셋/간호 영역은 처방 레코드에 대조 키가 없어 모드를 올려도 막히지 않는다).
  // ⚠️ 응답 형태 유지: 기존 GET /policy(Record<domain, mode>) 소비 화면(처방 화면)을 깨지 않도록 별도 EP.
  /** 코드 묶음의 처방집 상태 — 세트·템플릿 편집기용(처방 게이트와 같은 판정 · 읽기 전용 · 2026-10-21 P4) */
  @Post('status-of')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @NoAudit()
  @ApiOperation({ summary: '코드 묶음 처방집 상태(등재·사용중지·미등재) + 영역 시행 모드 — 처방 게이트와 같은 판정' })
  async statusOf(@Body() dto: FormularyStatusOfDto) {
    return { data: await this.gate.statusOf(dto.domain as FormularyDomain, dto.codeIds) };
  }

  @Get('policy/enforcement')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '영역별 실제 집행 여부(집행점 유무·사유) — 관리 화면이 "적용 중"을 말할 근거' })
  async policyEnforcement() {
    return { data: await this.svc.getEnforcement() };
  }

  @Patch('policy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '시행 모드 설정(영역별)' })
  async setPolicy(@Body() body: Record<string, string>, @CurrentUser('id') userId: string) {
    return { data: await this.svc.setPolicy(userId, body) };
  }

  // ⚠️ ':id' 와일드카드보다 위에 선언(라우트 매칭 순서)
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '상태(중지/재개/제거)·메모·위원회 변경' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormularyDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.update(userId, id, dto) };
  }

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '코드ID batch 승인 상태(코드마스터 화면 소비)' })
  async statusByIds(@Query('ids') ids: string, @Query('domain') domain?: string) {
    return { data: await this.svc.statusByIds((ids ?? '').split(',').filter(Boolean), domain) };
  }

  @Post('toggle')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '코드마스터 원클릭 토글(미등재→등재→중지→재개)' })
  async toggle(@Body() dto: ToggleFormularyDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.toggle(userId, dto) };
  }

  @Post('seed-from-usage')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용 실적 일괄 등재(최근 N개월 처방 코드)' })
  async seed(@Body() body: SeedFormularyFromUsageDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.seedFromUsage(userId, body?.months ?? 6) };
  }

  // ── AI 체크리스트 ──

  @Post('lists/ai-draft')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 초안 시작(비동기) — jobId 즉시 반환, 폴링으로 결과 수신' })
  aiDraft(@Body() body: StartFormularyAiDraftDto) {
    return { data: this.svc.startAiDraft(body) };
  }

  @Get('lists/ai-draft/:jobId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 초안 잡 상태/결과(RUNNING|DONE|ERROR)' })
  aiDraftJob(@Param('jobId') jobId: string) {
    return { data: this.svc.getAiDraftJob(jobId) };
  }

  @Post('lists')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 저장' })
  async createList(@Body() body: CreateFormularyListDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createList(userId, body) };
  }

  @Get('lists')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 목록' })
  async lists(@Query('domain') domain?: string) {
    return { data: await this.svc.lists(domain) };
  }

  @Delete('lists/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 삭제' })
  async deleteList(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteList(id) };
  }

  // ── 등재 요청(전 임상직) ──

  @Post('requests')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '등재 요청 생성(임상 사유 필수)' })
  async createRequest(
    @Body() dto: CreateFormularyRequestDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('department') department?: string,
  ) {
    return { data: await this.svc.createRequest(userId, department, dto) };
  }

  @Get('requests')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '요청 목록(심의함)' })
  async listRequests(@Query('status') status?: string, @Query('domain') domain?: string) {
    return { data: await this.svc.listRequests(status ?? 'PENDING', domain) };
  }

  @Post('requests/:id/decide')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '심의(승인=즉시 처방집 반영 / 반려=사유 필수)' })
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideFormularyRequestDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.decide(userId, id, dto) };
  }
}
