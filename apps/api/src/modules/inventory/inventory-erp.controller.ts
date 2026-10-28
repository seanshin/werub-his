import { Controller, Get, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { InventoryService } from './inventory.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';

class ErpSupplyDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() erpItemCode?: string;
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsString() poNo?: string;
  @IsOptional() @IsString() reason?: string;
}

// ERP ↔ 범용 자재(inventory) 재고 연동 (서버-서버, X-Integration-Key)
@ApiTags('ERP Integration (Inventory 자재)')
@SkipThrottle()
@Controller('api/v1/integration/inventory')
export class InventoryErpController {
  constructor(private readonly svc: InventoryService, private readonly configRuntime: ConfigRuntimeService) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  @Post('supply')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 입고 반영(인바운드) — code 또는 erpItemCode' })
  async supply(@Headers('x-integration-key') key: string, @Body() dto: ErpSupplyDto) {
    await this.auth(key);
    return { data: await this.svc.erpInbound(dto) };
  }

  @Get('stock')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 재고 스냅샷 조회(읽기)' })
  async stock(@Headers('x-integration-key') key: string) {
    await this.auth(key);
    return { data: await this.svc.erpStockSnapshot() };
  }
}
