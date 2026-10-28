import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { RecoveryService } from '../auth/recovery/recovery.service';
import { RecoveryApproveDto } from './dto/credential.dto';

// FR-23/47: 복구 승인 큐 (RecoveryService 재사용, 다중통제)
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential/recovery')
@UseGuards(JwtAuthGuard, CredentialGuard)
@RequireCred(Permission.CRED_RECOVERY_APPROVE)
export class RecoveryQueueController {
  constructor(private readonly recovery: RecoveryService) {}

  @Get()
  @ApiOperation({ summary: '복구 대기 목록' })
  list() {
    return this.recovery.listPending().then((data) => ({ data }));
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '복구 승인(다중통제 FR-47)' })
  approve(@CurrentUser('id') approverId: string, @Param('id') id: string, @Body() dto: RecoveryApproveDto) {
    return this.recovery.approve(approverId, id, dto.secondApproverId, dto.minutes).then((data) => ({ data }));
  }
}
