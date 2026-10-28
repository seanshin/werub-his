import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { GrantService } from './grant.service';
import { GrantDto } from './dto/credential.dto';

// FR-40/54: 자격증명 관리 권한 grant (ADMIN 부트스트랩 / CRED_POLICY_MANAGE)
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential/grants')
@UseGuards(JwtAuthGuard, CredentialGuard)
@RequireCred(Permission.CRED_POLICY_MANAGE)
export class GrantController {
  constructor(private readonly grants: GrantService) {}

  @Get()
  @ApiOperation({ summary: '권한 grant 목록' })
  list(@Query('userId') userId?: string) {
    return this.grants.list(userId).then((data) => ({ data }));
  }

  @Post()
  @ApiOperation({ summary: '권한 grant 부여(SECURITY_ADMIN/AUDITOR 지정·위임)' })
  grant(@CurrentUser('id') actorId: string, @Body() dto: GrantDto) {
    return this.grants.grant(actorId, dto.userId, dto.permission, dto.expiresAt).then((data) => ({ data }));
  }

  @Delete(':id')
  @ApiOperation({ summary: '권한 grant 회수' })
  revoke(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.grants.revoke(actorId, id).then((data) => ({ data }));
  }
}
