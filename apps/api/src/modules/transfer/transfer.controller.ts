import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TRANSFER_ACCESS_ROLES } from '@hospital-run/shared';
import { TransferService } from './transfer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTransferDto, RejectTransferDto } from './transfer.dto';

@ApiTags('Transfer (환자 전원)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
// 🔴 역할 목록은 shared 정본 하나 — 사이드바(nav)가 같은 목록으로 메뉴를 낸다.
//    종전엔 nav 가 NURSE 까지 열어 **간호사에게는 전원 화면 3종이 열자마자 전 패널 403** 이었다.
@Roles(...(TRANSFER_ACCESS_ROLES as readonly UserRole[]))
@Controller('api/v1/transfer')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post('request')
  @ApiOperation({ summary: '전원 요청' })
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.transferService.create(dto, userId) };
  }

  @Get('incoming')
  @ApiOperation({ summary: '수신 전원 목록 (자기 기관)' })
  async getIncoming() {
    return { data: await this.transferService.getIncoming() };
  }

  @Get('stats')
  @ApiOperation({ summary: '전원 통계' })
  async getStats() {
    return { data: await this.transferService.getStats() };
  }

  @Get()
  @ApiOperation({ summary: '전원 목록 조회' })
  async findAll(@Query('status') status?: string) {
    return { data: await this.transferService.findAll(status) };
  }

  @Get(':id')
  @ApiOperation({ summary: '전원 상세 조회' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.transferService.findOne(id) };
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: '전원 수락' })
  async accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.transferService.accept(id, userId) };
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: '전원 거부' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: RejectTransferDto) {
    return { data: await this.transferService.reject(id, body.reason) };
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: '전원 완료' })
  async complete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.transferService.complete(id) };
  }

  @Get(':id/bundle')
  @ApiOperation({ summary: 'FHIR Bundle 조회' })
  async getBundle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.transferService.getBundle(id) };
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'FHIR Bundle 전송 (HTTP + retry)' })
  async sendBundle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.transferService.sendBundle(id) };
  }

  @Post('receive')
  @ApiOperation({ summary: 'FHIR Bundle 수신 (외부 전원)' })
  async receiveBundle(
    @Body() bundle: Record<string, unknown>,
    @Req() req: any,
  ) {
    const clientId = req.smartClient?.client_id ?? undefined;
    return { data: await this.transferService.receiveBundle(bundle, clientId) };
  }
}
