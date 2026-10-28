import { Controller, Get, Post, Body, Param, Headers, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';

class MapDto { @IsString() erpAssetCode!: string; }

// ERP ↔ 고정자산(equipment) 연동 (서버-서버, X-Integration-Key)
@ApiTags('ERP Integration (Equipment 자산)')
@SkipThrottle()
@Controller('api/v1/integration/equipment')
export class EquipmentErpController {
  constructor(private readonly prisma: PrismaService, private readonly configRuntime: ConfigRuntimeService) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  @Get('assets')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 자산 스냅샷 조회(취득가·보증·상태)' })
  async assets(@Headers('x-integration-key') key: string) {
    await this.auth(key);
    const rows = await this.prisma.equipment.findMany({
      select: { assetNumber: true, erpAssetCode: true, name: true, category: true, manufacturer: true, model: true, serialNumber: true, purchaseDate: true, purchasePrice: true, warrantyExpiry: true, status: true, location: true },
      orderBy: { assetNumber: 'asc' },
    });
    return { data: rows };
  }

  @Post('assets/:assetNumber/map')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 고정자산 코드 매핑(ERP가 FixedAsset 등록 후 코드 회신)' })
  async map(@Headers('x-integration-key') key: string, @Param('assetNumber') assetNumber: string, @Body() dto: MapDto) {
    await this.auth(key);
    const eq = await this.prisma.equipment.findUnique({ where: { assetNumber } });
    if (!eq) throw new NotFoundException('자산 없음');
    await this.prisma.equipment.update({ where: { assetNumber }, data: { erpAssetCode: dto.erpAssetCode } });
    return { data: { ok: true, assetNumber, erpAssetCode: dto.erpAssetCode } };
  }
}
