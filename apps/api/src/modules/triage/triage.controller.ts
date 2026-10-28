import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TriageService } from './triage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateSymptomDto, UpdateSymptomDto, CreateRuleDto, UpdateRuleDto, CreateAliasDto, BulkCreateAliasesDto, EvaluateTriageDto } from './dto/triage.dto';

@ApiTags('Triage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 증상·규칙 쓰기만 역할이 있고 **분류 판정(`POST evaluate`)과 조회 7EP 는 무역할**이었다.
 *    소비 화면은 `/admin/triage`(ADMIN·DOCTOR) 하나뿐이다. 응급 간호가 쓰는 화면이 생기면 NURSE 를 더한다.
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR)
@Controller('api/v1/triage')
export class TriageController {
  constructor(private readonly service: TriageService) {}

  // 🔴 원 결함 T7 — 서비스도 `{ data }` 로 감싸고 컨트롤러도 감싸 이중 래핑이 나갔다.
  //    FE 통계 탭이 한 겹만 벗겨 모든 수치가 0 이었고, 정작 트리아지 실패가 화면에서 보이지 않았다.
  //    이제 서비스는 가공 없는 값을 돌려주고 **포장은 여기서 한 번만** 한다(`{ data, meta }` 규약).
  @Post('evaluate')
  @ApiOperation({ summary: '트리아지 평가 (증상 → 진료과 추천)' })
  async evaluate(@Body() body: EvaluateTriageDto) {
    return { data: await this.service.evaluate(body.text, body.patientInfo) };
  }

  // ── 증상 ──

  @Get('symptoms')
  @ApiOperation({ summary: '증상 목록' })
  async getSymptoms(@Query('category') category?: string) {
    return { data: await this.service.getSymptoms(category) };
  }

  @Post('symptoms')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '증상 추가' })
  async createSymptom(@Body() dto: CreateSymptomDto) {
    return { data: await this.service.createSymptom(dto) };
  }

  @Patch('symptoms/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '증상 수정' })
  async updateSymptom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSymptomDto) {
    return { data: await this.service.updateSymptom(id, dto) };
  }

  @Delete('symptoms/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '증상 비활성화' })
  async deleteSymptom(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteSymptom(id) };
  }

  // ── 규칙 ──

  @Get('rules')
  @ApiOperation({ summary: '매핑 규칙 목록' })
  async getRules(@Query('symptomId') symptomId?: string, @Query('department') department?: string) {
    return { data: await this.service.getRules(symptomId, department) };
  }

  @Post('rules')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '매핑 규칙 추가' })
  async createRule(@Body() dto: CreateRuleDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createRule({ ...dto, createdBy: userId }) };
  }

  @Patch('rules/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '매핑 규칙 수정' })
  async updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRuleDto) {
    return { data: await this.service.updateRule(id, dto) };
  }

  @Delete('rules/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 규칙 비활성화' })
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteRule(id) };
  }

  @Get('rules/stats')
  @ApiOperation({ summary: '매핑 통계' })
  async getRuleStats() {
    return { data: await this.service.getRuleStats() };
  }

  // ── 별칭 ──

  @Get('aliases')
  @ApiOperation({ summary: '별칭 목록' })
  async getAliases(@Query('symptomId') symptomId?: string) {
    return { data: await this.service.getAliases(symptomId) };
  }

  @Post('aliases')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '별칭 추가' })
  async createAlias(@Body() body: CreateAliasDto) {
    return { data: await this.service.createAlias(body) };
  }

  @Post('aliases/bulk')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '별칭 일괄 추가' })
  async createAliasesBulk(@Body() body: BulkCreateAliasesDto) {
    return { data: await this.service.createAliasesBulk(body.items) };
  }

  @Delete('aliases/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '별칭 삭제' })
  async deleteAlias(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteAlias(id) };
  }

  // ── 자가 점검 ──
  // 🔴 T5/T8 — 구 하드코딩 맵을 현행 규칙에 덧씌우던 `POST /migrate-from-code` 는 제거했다.
  //    같은 흉통에 답이 셋이던 원인 중 하나였고, 토스트마저 이중 래핑으로 "증상 undefined" 였다.

  @Get('self-check')
  @ApiOperation({ summary: '자가 점검 — 시스템이 환자에게 제시하는 예시 문장이 실제로 매칭되는가' })
  async selfCheck() {
    return { data: await this.service.selfCheck() };
  }

  @Get('emergency-messages')
  @ApiOperation({ summary: '응급 증상 문구 점검 — 환자용 행동 지시(119) 유무' })
  async emergencyMessages() {
    return { data: await this.service.emergencyMsgAudit() };
  }
}
