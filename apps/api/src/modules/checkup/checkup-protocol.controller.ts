import { Controller, Get, Post, Put, Body, Param, Query, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CheckupProtocolService } from './checkup-protocol.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';

// 검진 프로토콜 정의·관리 — 판정룰·판독라우팅·검토/서명 단계. 정의/발효=관리자, 조회/판정=조회권한.
@ApiTags('검진 프로토콜')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/checkup/protocols')
export class CheckupProtocolController {
  constructor(private readonly svc: CheckupProtocolService) {}

  @Get()
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '프로토콜 목록' })
  async list(@Query('programId') programId?: string, @Query('status') status?: string) {
    return { data: await this.svc.list(programId, status) };
  }

  @Get('resolve')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'visit 적용 ACTIVE 프로토콜 해소(programId·sex·age)' })
  async resolve(@Query('programId') programId?: string, @Query('sex') sex?: string, @Query('age') age?: string) {
    return { data: await this.svc.resolve({ programId, sex, age: age ? parseInt(age, 10) : undefined }) };
  }

  @Post()
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '프로토콜 생성(DRAFT)' })
  async create(@Body() dto: Record<string, never>) {
    return { data: await this.svc.create(dto as never) };
  }

  @Get(':id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '프로토콜 상세(룰 포함)' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.get(id) };
  }

  @Put(':id')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '프로토콜 수정(DRAFT만)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>) {
    return { data: await this.svc.update(id, dto) };
  }

  @Put(':id/rules')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '판정 룰 일괄 교체(DRAFT만)' })
  async replaceRules(@Param('id', ParseUUIDPipe) id: string, @Body() body: { rules: Array<Record<string, unknown>> }) {
    return { data: await this.svc.replaceRules(id, body?.rules ?? []) };
  }

  @Post(':id/publish')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '발효(ACTIVE) — 동일 프로그램·성별 기존 ACTIVE는 RETIRED' })
  async publish(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: { id?: string; sub?: string } }) {
    return { data: await this.svc.publish(id, (req.user.id ?? req.user.sub)!) };
  }

  @Post(':id/retire')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '폐기(RETIRED)' })
  async retire(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.retire(id) };
  }

  @Post(':id/clone')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '새 버전으로 복제(DRAFT) — 발효본 편집용' })
  async clone(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.clone(id) };
  }

  @Post(':id/judge-preview')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '판정 룰 미리보기 — testCode·value·sex·age → finding/grade/위급값' })
  async judgePreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { testCode: string; value: string | number; sex?: string; age?: number },
  ) {
    return { data: await this.svc.judgeByProtocol(id, body.testCode, body.value, { sex: body.sex, age: body.age }) };
  }
}
