import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QrService } from './qr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateQrDto, ScanDto } from './dto/qr.dto';

// 범용 QR 세션 — 출퇴근·공용단말·출석·문서수령(§6.4)
@ApiTags('QR (범용 세션)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/qr')
export class QrController {
  constructor(private readonly svc: QrService) {}

  @Post('sessions')
  @ApiOperation({ summary: '용도별 QR 세션 생성(단기 회전)' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateQrDto) {
    return { data: await this.svc.createSession(userId, dto.purpose, dto.refType, dto.refId) };
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'QR 세션 상태(폴링 — 페어링/소비 확인)' })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.svc.getStatus(id, { userId, role }) };
  }

  @Post('scan')
  @ApiOperation({ summary: 'QR 스캔 처리(출퇴근 토글·출석·수령·페어링)' })
  async scan(@CurrentUser('id') userId: string, @Body() dto: ScanDto) {
    return { data: await this.svc.scan(userId, dto.token) };
  }
}
