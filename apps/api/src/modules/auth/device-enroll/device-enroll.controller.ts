import { Body, Controller, Get, Param, Post, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Observable } from 'rxjs';
import { DeviceEnrollService } from './device-enroll.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { EnrollStartDto, DeviceRevokeDto } from './dto/device-enroll.dto';

@ApiTags('admin-staff-devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/staff-devices')
export class DeviceEnrollController {
  constructor(private readonly enroll: DeviceEnrollService) {}

  @Post('enroll/start')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '디바이스 등록 세션 시작(QR+인증번호)' })
  async start(@CurrentUser('id') adminId: string, @Body() body: EnrollStartDto) {
    return { data: await this.enroll.start(adminId, body.staffUserId, body.enrollMode, body.deviceName) };
  }

  @Sse('enroll/:sessionId/stream')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '등록 진행 상태 SSE' })
  stream(@Param('sessionId') sessionId: string): Observable<MessageEvent> {
    return this.enroll.getStream(sessionId);
  }

  @Post('enroll/:sessionId/confirm')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '관리자 이중확인 → 등록 확정' })
  async confirm(@CurrentUser('id') adminId: string, @Param('sessionId') sessionId: string) {
    return { data: await this.enroll.confirm(adminId, sessionId) };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '등록 디바이스 목록' })
  async list() {
    return { data: await this.enroll.list() };
  }

  @Post(':id/revoke')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '디바이스 교체/해제(패스키 폐기)' })
  async revoke(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: DeviceRevokeDto,
  ) {
    return { data: await this.enroll.revoke(adminId, id, body?.reason) };
  }
}
