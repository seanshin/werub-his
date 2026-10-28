import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsentDeviceService } from './consent-device.service';
import { DispatchConsentToDeviceDto } from './dto/consent-body.dto';

// 동의서 서명 기기 관리 (직원) — 경로 충돌 회피 위해 /consent-devices(복수)
@ApiTags('Consent Signing Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/consent-devices')
export class ConsentDevicesController {
  constructor(private readonly svc: ConsentDeviceService) {}

  @Post('pairing-code')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'QR 등록용 인증코드 발급(6자리·5분)' })
  async pairingCode(@CurrentUser('id') userId: string) {
    return { data: await this.svc.createPairingCode(userId) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 목록(승인대기+등록기기, 온라인 여부)' })
  async list() {
    return { data: await this.svc.listDevices() };
  }

  @Post(':id/approve')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 등록 승인' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.approveDevice(id, userId) };
  }

  @Post(':id/reject')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 등록 거부' })
  async reject(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.rejectDevice(id) };
  }

  @Post(':id/dispatch')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서를 기기로 전송' })
  async dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: DispatchConsentToDeviceDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.dispatch(body.consentId, id, userId) };
  }

  @Post(':id/recall')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '전송 회수(대기화면 복귀)' })
  async recall(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.recall(id) };
  }

  @Patch(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 이름/위치 변경' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; location?: string }) {
    return { data: await this.svc.updateDevice(id, body) };
  }

  @Delete(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 해제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteDevice(id) };
  }
}
