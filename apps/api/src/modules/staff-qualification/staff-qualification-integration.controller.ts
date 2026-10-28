import { Controller, Get, Post, Body, Query, Headers, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength } from 'class-validator';
import { StaffQualificationService } from './staff-qualification.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// 🔴 외부 edu 연동 인바운드 DTO — `interface` → `class` 승격(2026-09-01 변이 EP 재실측).
//    외부 수신은 검증이 가장 필요한데 interface 라 metatype 이 Object → ValidationPipe 스킵이었다
//    (external-body-dto 가드도 명명 타입은 못 봤다). class-validator 로 승격한다.
class EduEducationDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  userId!: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  courseName!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @IsOptional() @IsString() @MaxLength(30)
  completedAt?: string;

  @IsOptional() @IsString() @MaxLength(30)
  expiresAt?: string;

  @IsOptional() @IsString() @MaxLength(30)
  dueDate?: string;

  @IsOptional() @IsNumber()
  hours?: number;

  @IsOptional() @IsString() @MaxLength(500)
  certificateUrl?: string;
}

class EduNotificationDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  userId!: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  title!: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  message!: string;

  @IsOptional() @IsString() @MaxLength(50)
  type?: string;

  @IsOptional() @IsString() @MaxLength(20)
  severity?: string;
}

/**
 * edu(교육/SQE) 시스템 전용 연동 EP — 서비스 키(edu.integrationKey) 인증.
 * ADMIN 세션 self-mint 대신 스코프 키로 이수기록만 쓰기(최소권한). JwtAuthGuard 없음(hr-erp 패턴).
 */
@ApiTags('Integration - edu')
@Controller('api/v1/integration/edu')
export class StaffQualificationIntegrationController {
  constructor(
    private readonly svc: StaffQualificationService,
    private readonly integrationAuth: IntegrationAuthService,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  /** 이수기록 등록 — 멱등(Idempotency-Key 1순위·자연키 2순위). 단일소스=SQE StaffEducation(권장·정책확정 대기). */
  @Post('education')
  @ApiHeader({ name: 'X-Integration-Key', description: 'edu.integrationKey', required: true })
  @ApiHeader({ name: 'Idempotency-Key', description: '재전송 멱등키(선택)', required: false })
  @ApiOperation({ summary: 'edu 이수기록 등록(서비스 키·멱등)' })
  async recordEducation(
    @Headers('x-integration-key') key: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: EduEducationDto,
  ) {
    await this.integrationAuth.assertEduKey(key);
    const result = await this.svc.recordEducationIdempotent({ ...body, idempotencyKey: idempotencyKey || undefined });
    return { data: result.record, meta: { idempotent: result.idempotent } };
  }

  /** 이수기록 조회(서비스 키) — edu 과거분 정합용 로컬 id 백필(재-POST 중복 회피). userId·courseName 필터. */
  @Get('education')
  @ApiHeader({ name: 'X-Integration-Key', description: 'edu.integrationKey', required: true })
  @ApiOperation({ summary: 'edu 이수기록 조회(서비스 키·백필)' })
  async listEducation(
    @Headers('x-integration-key') key: string,
    @Query('userId') userId?: string,
    @Query('courseName') courseName?: string,
  ) {
    await this.integrationAuth.assertEduKey(key);
    return { data: await this.svc.listEducationForBackfill({ userId, courseName }) };
  }

  /** 스태프 알림 인입(P1-5) — 서비스 키. HIS 인앱(SSE) 알림 생성. 이메일/SMS는 별도 채널(계약). */
  @Post('notifications')
  @ApiHeader({ name: 'X-Integration-Key', description: 'edu.integrationKey', required: true })
  @ApiOperation({ summary: 'edu → HIS 스태프 알림 인입(서비스 키)' })
  async createNotification(@Headers('x-integration-key') key: string, @Body() body: EduNotificationDto) {
    await this.integrationAuth.assertEduKey(key);
    if (!body?.userId || !body?.title || !body?.message) throw new BadRequestException('userId·title·message는 필수입니다');
    // 대상 사용자 실존 검증 — 임의 userId 알림 주입 방지(폭발반경 축소)
    const target = await this.prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!target) throw new BadRequestException('대상 사용자를 찾을 수 없습니다');
    const record = await this.notifications.create(body.userId, {
      type: 'EDU', // 출처 고정(edu 인입) — 사칭 표기 방지
      title: body.title,
      message: body.message,
      severity: body.severity,
    });
    return { data: record };
  }
}
