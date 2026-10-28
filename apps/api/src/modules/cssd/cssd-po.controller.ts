import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsArray, IsOptional, IsString, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CssdPoService } from './cssd-po.service';

class PoLineDto {
  @IsString() itemId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsInt() unitPrice?: number;
}
class CreatePoDto {
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PoLineDto) lines!: PoLineDto[];
}
class ReceiptDto {
  @IsString() lineId!: string;
  @IsInt() @Min(1) qty!: number;
}
class ReceiveDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiptDto) receipts!: ReceiptDto[];
}

@ApiTags('CSSD 발주(PO)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE)
@Controller('api/v1/cssd/po')
export class CssdPoController {
  constructor(private readonly svc: CssdPoService) {}

  @Get('reorder-suggestions')
  @ApiOperation({ summary: '재주문 제안(안전재고 이하)' })
  reorder() { return this.svc.suggestReorder(); }

  @Get()
  @ApiOperation({ summary: '발주 목록' })
  list(@Query('status') status?: string) { return this.svc.list(status); }

  @Get(':id')
  @ApiOperation({ summary: '발주 상세' })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @ApiOperation({ summary: '발주 생성(요청)' })
  create(@Body() dto: CreatePoDto, @CurrentUser() u: { sub?: string }) {
    return this.svc.create({ ...dto, requestedBy: u?.sub });
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '발주 승인 → ERP 통보' })
  approve(@Param('id') id: string, @CurrentUser() u: { sub?: string }) {
    return this.svc.approve(id, u?.sub);
  }

  @Post(':id/receive')
  @ApiOperation({ summary: '입고(수령) — 라인별 수량' })
  receive(@Param('id') id: string, @Body() dto: ReceiveDto, @CurrentUser() u: { sub?: string }) {
    return this.svc.receive(id, dto.receipts, u?.sub);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '발주 취소' })
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
