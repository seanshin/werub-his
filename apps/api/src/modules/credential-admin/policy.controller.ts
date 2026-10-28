import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { PolicyService } from './policy.service';
import { CredentialCronService } from './credential-cron.service';
import { PolicyUpsertDto } from './dto/credential.dto';

// FR-25/45/30: 인증 정책 + 수동 cron
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential')
@UseGuards(JwtAuthGuard, CredentialGuard)
@RequireCred(Permission.CRED_POLICY_MANAGE)
export class PolicyController {
  constructor(
    private readonly policy: PolicyService,
    private readonly cron: CredentialCronService,
  ) {}

  @Get('policy')
  @ApiOperation({ summary: '정책 목록(GLOBAL/ROLE/DEPARTMENT)' })
  list() {
    return this.policy.list().then((data) => ({ data }));
  }

  @Put('policy')
  @ApiOperation({ summary: '정책 설정' })
  upsert(@CurrentUser('id') actorId: string, @Body() dto: PolicyUpsertDto) {
    const { scope, scopeRef, ...fields } = dto;
    return this.policy.upsert(actorId, scope, scopeRef ?? '*', fields).then((data) => ({ data }));
  }

  @Post('policy/preview')
  @ApiOperation({ summary: '정책 적용 영향 미리보기(FR-45)' })
  preview(@Body() dto: PolicyUpsertDto) {
    const { scope, scopeRef, ...fields } = dto;
    return this.policy.preview(scope, scopeRef ?? '*', fields).then((data) => ({ data }));
  }

  @Post('cron/run')
  @ApiOperation({ summary: '만료/재등록 일배치 수동 실행(FR-30)' })
  runCron() {
    return this.cron.runOnce().then((data) => ({ data }));
  }
}
