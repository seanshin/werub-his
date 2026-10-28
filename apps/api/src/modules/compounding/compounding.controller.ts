import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CompoundingService } from './compounding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateCompoundingOrderDto, ChemoDoseDto, CalculateCompoundingDto,
  PrepCompoundingDto, VerifyCompoundingDto, CancelCompoundingDto,
} from './dto/compounding.dto';

@ApiTags('Compounding (무균조제)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/compounding')
export class CompoundingController {
  constructor(private readonly service: CompoundingService) {}

  @Post('orders')
  @Roles(UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '무균조제 지시 생성(IV/TPN/CHEMO)' })
  async createOrder(@Body() dto: CreateCompoundingOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createOrder(dto, userId) };
  }

  @Post('chemo-dose')
  @Roles(UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '항암 용량 계산(BSA·용량밴딩·상한)' })
  async chemoDose(@Body() body: ChemoDoseDto) {
    return { data: this.service.computeChemoDose(body) };
  }

  @Get('worklist')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '무균조제실 워크리스트' })
  async worklist(@Query('status') status?: string) {
    return { data: await this.service.getWorklist(status) };
  }

  @Get('orders/:id')
  @Roles(UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '조제지시 상세' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getOne(id) };
  }

  @Patch('orders/:id/calculate')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '조성 계산 완료' })
  async calculate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CalculateCompoundingDto) {
    // 🔴 `@Body('components')` 는 파이프를 건너뛴다 — 성분 id/용량이 무검증이었다.
    return { data: await this.service.calculate(id, dto?.components) };
  }

  @Patch('orders/:id/prep')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '무균조제 수행(조제자·후드·로트) — 항암은 차폐 필수' })
  async prep(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrepCompoundingDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.prep(id, { compoundedBy: userId, hoodType: dto.hoodType, componentLots: dto.componentLots }) };
  }

  @Patch('orders/:id/verify')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '독립 2차 검증(조제자≠검증자)·BUD 스탬프' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyCompoundingDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.verify(id, { verifiedBy: userId, budHours: dto?.budHours }) };
  }

  @Patch('orders/:id/release')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '불출(라벨 발행)' })
  async release(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.release(id) };
  }

  @Get('orders/:id/label')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '무균조제 라벨(인쇄용 HTML) 다운로드' })
  async label(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.service.buildLabel(id);
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="${file.filename}"` });
    res.send(file.content);
  }

  @Get('orders/:id/label.zpl')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '무균조제 라벨(ZPL — 라벨프린터 직인쇄) 다운로드' })
  async labelZpl(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.service.buildLabelZpl(id);
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.filename}"` });
    res.send(file.content);
  }

  @Patch('orders/:id/cancel')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '조제지시 취소' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCompoundingDto) {
    return { data: await this.service.cancel(id, dto?.reason) };
  }
}
