import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { CertAdminService } from './cert-admin.service';
import { CertIssueDto, CertRevokeDto, CertRenewDto, DeviceReasonDto } from './dto/credential.dto';

// FR-10~14/44: 인증서 통합 관리
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential')
@UseGuards(JwtAuthGuard, CredentialGuard)
export class CertAdminController {
  constructor(private readonly svc: CertAdminService) {}

  @Get('certs')
  @RequireCred(Permission.CRED_CERT_ISSUE)
  @ApiOperation({ summary: '직원 인증서 목록' })
  list(@Query('userId') userId: string) {
    return this.svc.listByUser(userId).then((data) => ({ data }));
  }

  @Post('certs/issue')
  @RequireCred(Permission.CRED_CERT_ISSUE)
  @ApiOperation({ summary: '인증서 발급(정책 유효기간)' })
  issue(@CurrentUser('id') actorId: string, @Body() dto: CertIssueDto) {
    return this.svc.issue(actorId, dto).then((data) => ({ data }));
  }

  @Post('certs/:id/renew')
  @RequireCred(Permission.CRED_CERT_ISSUE)
  @ApiOperation({ summary: '인증서 갱신(rekey)' })
  renew(@CurrentUser('id') actorId: string, @Param('id') id: string, @Body() dto: CertRenewDto) {
    return this.svc.renew(actorId, id, dto).then((data) => ({ data }));
  }

  @Post('certs/:id/suspend')
  @RequireCred(Permission.CRED_CERT_ISSUE)
  @ApiOperation({ summary: '인증서 정지' })
  suspend(@CurrentUser('id') actorId: string, @Param('id') id: string, @Body() dto: DeviceReasonDto) {
    return this.svc.suspend(actorId, id, dto.reason).then((data) => ({ data }));
  }

  @Post('certs/:id/restore')
  @RequireCred(Permission.CRED_CERT_ISSUE)
  @ApiOperation({ summary: '인증서 복원(SUSPENDED→ACTIVE)' })
  restore(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.svc.restore(actorId, id).then((data) => ({ data }));
  }

  @Post('certs/:id/revoke')
  @RequireCred(Permission.CRED_CERT_REVOKE)
  @ApiOperation({ summary: '인증서 폐기(4-eyes, 과거 서명 효력 유지)' })
  revoke(@CurrentUser('id') actorId: string, @Param('id') id: string, @Body() dto: CertRevokeDto) {
    return this.svc.revoke(actorId, id, dto.reason).then((data) => ({ data }));
  }

  @Get('crl')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: 'CRL(폐기·정지 목록)' })
  crl() {
    return this.svc.crl().then((data) => ({ data }));
  }
}
