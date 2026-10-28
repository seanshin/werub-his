import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AiCallLogService } from './ai-call-log.service';
import {
  AiCallStatsQueryDto,
  CreateAiModelReleaseDto,
  ListAiModelReleaseQueryDto,
  RetireAiModelReleaseDto,
} from './dto/ai-model-release.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 모델 레지스트리·호출 분포 관리 EP — 기획서 §2.2.
 *
 * 🔴 여기에 **환자 정보는 없다.** `AiCallLog` 는 PHI 를 담지 않는 원장이고, 이 EP 들은 그 메타만 낸다.
 * 🔴 응답은 전부 `{ data }` 규약. 비율을 내는 자리에는 **분모(sample)를 같이** 낸다.
 */
@ApiTags('Admin · AI Model Registry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/ai')
export class AiCallLogController {
  constructor(private readonly service: AiCallLogService) {}

  @Get('model-releases')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '모델 릴리즈 목록(승인·배포·폐기 이력)' })
  async listReleases(@Query() q: ListAiModelReleaseQueryDto) {
    return { data: await this.service.listReleases(q?.includeRetired === true) };
  }

  @Post('model-releases')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '모델 릴리즈 등록 — 🔴 등록은 기록이지 적용이 아니다(호출 태그는 코드 상수가 정한다)' })
  async createRelease(@Body() dto: CreateAiModelReleaseDto, @CurrentUser('id') userId: string) {
    return {
      data: await this.service.createRelease({
        provider: dto.provider,
        modelTag: dto.modelTag,
        digest: dto.digest ?? null,
        deployedAt: dto.deployedAt ?? null,
        approvalRef: dto.approvalRef ?? null,
        notes: dto.notes ?? null,
        approvedBy: userId ?? null,
      }),
    };
  }

  @Post('model-releases/:id/retire')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '모델 릴리즈 폐기(행을 지우지 않고 retiredAt 을 적는다)' })
  async retireRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetireAiModelReleaseDto,
  ) {
    return { data: await this.service.retireRelease(id, dto?.notes ?? null) };
  }

  /**
   * 🔴 상류 실측. 실패는 `{ available: null, reason }` 이며 `missing` 도 null 이다(판정 불가).
   *    0 개로 접으면 "전부 없다"는 거짓 경보가 된다.
   */
  @Get('upstream-models')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 서버 보유 모델 실측(ollama /api/tags) + 코드 요구 태그 대조' })
  async upstreamModels() {
    return { data: await this.service.upstreamModels() };
  }

  @Get('call-stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 호출 분포(모델×스킬 · 상태 · 표본 수)' })
  async callStats(@Query() q: AiCallStatsQueryDto) {
    return { data: await this.service.callStats(q?.days ?? 7) };
  }
}
