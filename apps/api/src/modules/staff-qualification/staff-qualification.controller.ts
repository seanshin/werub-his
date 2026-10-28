import { Controller, Get, Post, Patch, Body, Param, Query, Headers, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StaffQualificationService } from './staff-qualification.service';
import { CreateStaffCredentialDto, RecordStaffEducationDto, UpdateStaffCredentialStatusDto } from './dto/staff-qualification-write.dto';

// JCI SQE — 직원 자격(면허/자격증) + 필수교육 추적
@ApiTags('Staff Qualification (SQE)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/staff-qualification')
export class StaffQualificationController {
  constructor(private readonly svc: StaffQualificationService) {}

  @Get('dashboard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'SQE 대시보드 (만료 임박 자격·필수교육)' })
  async dashboard() {
    return { data: await this.svc.getDashboard() };
  }

  // 자격/면허
  @Get('credentials')
  @ApiOperation({ summary: '자격/면허 목록 (비ADMIN=본인만·ADMIN=전체 관리)' })
  async listCredentials(@CurrentUser('id') callerId: string, @CurrentUser('role') role: string, @Query('userId') userId?: string, @Query('type') type?: string, @Query('status') status?: string) {
    const scoped = role === UserRole.ADMIN ? userId : callerId; // IDOR 차단 — 비ADMIN 은 타인 면허번호·자격스캔 URL 조회 불가
    return { data: await this.svc.listCredentials({ userId: scoped, type, status }) };
  }

  @Post('credentials')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자격/면허 등록' })
  async createCredential(@Body() body: CreateStaffCredentialDto) {
    return { data: await this.svc.createCredential(body) };
  }

  @Patch('credentials/:id/verify')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자격 검증 확인' })
  async verifyCredential(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.verifyCredential(id, userId) };
  }

  @Patch('credentials/:id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자격 상태 변경 (VALID/EXPIRED/SUSPENDED)' })
  async updateCredentialStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStaffCredentialStatusDto) {
    return { data: await this.svc.updateCredentialStatus(id, body.status) };
  }

  // 교육
  @Get('education')
  @ApiOperation({ summary: '교육 이수 목록 (비ADMIN=본인만·ADMIN=전체)' })
  async listEducation(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') role: string,
    @Query('userId') userId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('courseName') courseName?: string,
  ) {
    const scoped = role === UserRole.ADMIN ? userId : callerId; // IDOR 차단 — 비ADMIN 은 타인 교육이력 조회 불가
    return { data: await this.svc.listEducation({ userId: scoped, category, status, courseName }) };
  }

  // 멱등(Idempotency-Key 1순위·자연키 2순위=userId+courseName+category+완료일 KST). 재호출 시 기존 반환(meta.idempotent).
  @Post('education')
  @Roles(UserRole.ADMIN)
  @ApiHeader({ name: 'Idempotency-Key', description: '재전송 멱등키(선택)', required: false })
  @ApiOperation({ summary: '교육 이수 기록(멱등)' })
  async recordEducation(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: RecordStaffEducationDto,
  ) {
    const result = await this.svc.recordEducationIdempotent({ ...body, idempotencyKey: idempotencyKey || undefined });
    return { data: result.record, meta: { idempotent: result.idempotent } };
  }
}
