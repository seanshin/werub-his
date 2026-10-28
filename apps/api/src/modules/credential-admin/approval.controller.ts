import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { ApprovalService } from './approval.service';
import { RejectDto } from './dto/credential.dto';

// FR-41: 4-eyes 승인 큐. 승인/반려는 요청자≠승인자 강제.
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential/approvals')
@UseGuards(JwtAuthGuard, CredentialGuard)
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '승인 대기/이력 목록' })
  list(@Query('status') status?: string) {
    return this.approvals.list(status).then((data) => ({ data }));
  }

  @Post(':id/approve')
  @RequireCred(Permission.CRED_POLICY_MANAGE)
  @ApiOperation({ summary: '승인(요청자≠승인자)' })
  approve(@CurrentUser('id') approverId: string, @Param('id') id: string) {
    return this.approvals.approve(id, approverId).then((data) => ({ data }));
  }

  @Post(':id/reject')
  @RequireCred(Permission.CRED_POLICY_MANAGE)
  @ApiOperation({ summary: '반려' })
  reject(@CurrentUser('id') approverId: string, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.approvals.reject(id, approverId, dto.reason).then((data) => ({ data }));
  }
}
