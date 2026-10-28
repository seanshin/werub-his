import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { Staff360Service } from './staff360.service';
import { AnomalyService } from './anomaly.service';

// FR-20/21/22: 직원 360° 인증현황 + 세션/로그인
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/identity')
@UseGuards(JwtAuthGuard, CredentialGuard)
export class Staff360Controller {
  constructor(
    private readonly svc: Staff360Service,
    private readonly anomaly: AnomalyService,
  ) {}

  @Get('anomalies')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '이상 로그인 탐지(FR-52)' })
  anomalies() {
    return this.anomaly.detect().then((data) => ({ data }));
  }

  @Get('dashboard')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '인증 현황 대시보드(FR-28)' })
  dashboard() {
    return this.svc.dashboard().then((data) => ({ data }));
  }

  @Get('staff/:userId')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '직원 360° 인증현황(디바이스·패스키·인증서·세션·복구·감사)' })
  get(@CurrentUser('id') viewerId: string, @Param('userId') userId: string) {
    return this.svc.get(userId, viewerId).then((data) => ({ data }));
  }

  @Get('staff/:userId/audit')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '직원 인증 감사 타임라인' })
  audit(@CurrentUser('id') viewerId: string, @Param('userId') userId: string) {
    return this.svc.get(userId, viewerId).then((d) => ({ data: d.audit }));
  }

  @Get('sessions/:userId')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '활성 세션 목록' })
  sessions(@CurrentUser('id') viewerId: string, @Param('userId') userId: string) {
    return this.svc.getSessions(userId, viewerId).then((data) => ({ data }));
  }

  @Post('sessions/:userId/logout')
  @RequireCred(Permission.CRED_DEVICE_MANAGE)
  @ApiOperation({ summary: '강제 로그아웃(SLO)' })
  logout(@CurrentUser('id') actorId: string, @Param('userId') userId: string) {
    return this.svc.forceLogout(actorId, userId).then((data) => ({ data }));
  }

  @Get('logins/:userId')
  @RequireCred(Permission.CRED_AUDIT_READ)
  @ApiOperation({ summary: '로그인 이력' })
  logins(@CurrentUser('id') viewerId: string, @Param('userId') userId: string) {
    return this.svc.getLogins(userId, viewerId).then((data) => ({ data }));
  }
}
