import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CssdInventoryService } from './cssd-inventory.service';
import { CreateInstrumentItemDto, CreateSupplierDto, SupplyInstrumentItemDto, UpdateInstrumentItemDto } from './dto/cssd-inventory-write.dto';

@ApiTags('CSSD 품목·공급/재고')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/cssd')
export class CssdInventoryController {
  constructor(private readonly svc: CssdInventoryService) {}

  // 공급업체
  @Get('suppliers') @ApiOperation({ summary: '공급업체 목록' })
  suppliers() { return this.svc.listSuppliers().then((data) => ({ data })); }
  @Post('suppliers') @ApiOperation({ summary: '공급업체 등록' })
  createSupplier(@Body() body: CreateSupplierDto) { return this.svc.createSupplier(body).then((data) => ({ data })); }

  // 품목 마스터
  @Get('items') @ApiOperation({ summary: '기구 품목 목록' })
  items(@Query('lowStock') lowStock?: string, @Query('q') q?: string) { return this.svc.listItems({ lowStock: lowStock === 'true', q }).then((data) => ({ data })); }
  @Get('items/:id') @ApiOperation({ summary: '품목 상세(이력·사용 세트)' })
  item(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getItem(id).then((data) => ({ data })); }
  @Post('items') @ApiOperation({ summary: '품목 등록' })
  createItem(@Body() body: CreateInstrumentItemDto) { return this.svc.createItem(body).then((data) => ({ data })); }
  @Patch('items/:id') @ApiOperation({ summary: '품목 수정' })
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateInstrumentItemDto) { return this.svc.updateItem(id, body).then((data) => ({ data })); }

  // 공급/재고
  @Post('items/:id/supply') @ApiOperation({ summary: '입고/조정/반품(재고 거래)' })
  supply(@Param('id', ParseUUIDPipe) id: string, @Body() body: SupplyInstrumentItemDto, @CurrentUser('id') userId: string) {
    return this.svc.supply(id, { type: body.type, qty: body.qty, reason: body.reason, userId }).then((data) => ({ data }));
  }
  @Get('items/:id/transactions') @ApiOperation({ summary: '품목 입출고 이력' })
  txs(@Param('id', ParseUUIDPipe) id: string) { return this.svc.transactions(id).then((data) => ({ data })); }

  @Get('transactions') @ApiOperation({ summary: '전체 입출고 원장(유형·날짜 필터)' })
  ledger(@Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string) {
    return this.svc.ledger({ type, from, to, q }).then((data) => ({ data }));
  }

  @Get('items/by-code/:code') @ApiOperation({ summary: '바코드/QR 코드로 품목 조회(스캔)' })
  byCode(@Param('code') code: string) { return this.svc.findByCode(code).then((data) => ({ data })); }
  @Get('inventory/stats') @ApiOperation({ summary: '재고 통계(안전재고 미달)' })
  stats() { return this.svc.stats().then((data) => ({ data })); }
}
