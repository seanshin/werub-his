import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FeeIntegrationService } from './fee-integration.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';

class ProcedureCodeDto {
  @IsString() code!: string;
  @IsString() nameKo!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsInt() unitPrice?: number;
  @IsOptional() @IsNumber() copayRate?: number;
  @IsOptional() @IsBoolean() insuranceCovered?: boolean;
  @IsString() validFrom!: string;
  @IsOptional() @IsString() validTo?: string;
}
class NonCoveredDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() category!: string;
  @IsInt() @Min(0) price!: number;
  @IsOptional() @IsBoolean() requiresConsent?: boolean;
  @IsOptional() @IsString() description?: string;
}
class MaterialCostDto {
  @IsString() erpItemCode!: string;
  @IsInt() @Min(0) unitPrice!: number;
}
class ProcedureBatchDto { @IsArray() @ValidateNested({ each: true }) @Type(() => ProcedureCodeDto) items!: ProcedureCodeDto[]; }
class NonCoveredBatchDto { @IsArray() @ValidateNested({ each: true }) @Type(() => NonCoveredDto) items!: NonCoveredDto[]; }
class MaterialBatchDto { @IsArray() @ValidateNested({ each: true }) @Type(() => MaterialCostDto) items!: MaterialCostDto[]; }

// ERP(수가/재료비 마스터) → HIS 적재 (서버-서버, X-Integration-Key). 대량 일괄이라 스로틀 예외.
@SkipThrottle()
@ApiTags('ERP Integration (수가/재료비)')
@Controller('api/v1/integration/fee')
export class FeeIntegrationController {
  constructor(private readonly svc: FeeIntegrationService, private readonly configRuntime: ConfigRuntimeService) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  @Post('procedure-codes')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '수가(EDI ProcedureCode) 일괄 upsert' })
  async procedureCodes(@Headers('x-integration-key') key: string, @Body() dto: ProcedureBatchDto) {
    await this.auth(key);
    return { data: await this.svc.upsertProcedureCodes(dto.items) };
  }

  @Post('non-covered')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '비급여/재료대(NonCoveredItem) 일괄 upsert' })
  async nonCovered(@Headers('x-integration-key') key: string, @Body() dto: NonCoveredBatchDto) {
    await this.auth(key);
    return { data: await this.svc.upsertNonCovered(dto.items) };
  }

  @Post('material-costs')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '재고 원가(매입단가) — erpItemCode 매핑 품목 unitPrice 갱신' })
  async materialCosts(@Headers('x-integration-key') key: string, @Body() dto: MaterialBatchDto) {
    await this.auth(key);
    return { data: await this.svc.updateMaterialCosts(dto.items) };
  }
}
