import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { BulkService } from './bulk.service';
import { BulkDto } from './dto/credential.dto';

// FR-27: 일괄 작업
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential/bulk')
@UseGuards(JwtAuthGuard, CredentialGuard)
@RequireCred(Permission.CRED_POLICY_MANAGE)
export class BulkController {
  constructor(private readonly svc: BulkService) {}

  @Post('preview')
  @ApiOperation({ summary: '일괄 대상 미리보기' })
  preview(@Body() dto: BulkDto) {
    return this.svc.preview(dto.scope, dto.scopeRef).then((data) => ({ data }));
  }

  @Post('reenroll')
  @ApiOperation({ summary: '그룹 강제 재등록(4-eyes)' })
  reenroll(@CurrentUser('id') actorId: string, @Body() dto: BulkDto) {
    return this.svc.bulkReEnroll(actorId, dto.scope, dto.scopeRef).then((data) => ({ data }));
  }

  @Post('expiry-check')
  @ApiOperation({ summary: '만료/재등록 일괄 점검(cron 수동)' })
  expiryCheck(@CurrentUser('id') actorId: string) {
    return this.svc.expiryCheck(actorId).then((data) => ({ data }));
  }
}
