import { Controller, Get, Post, Body, Query, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { BillingService } from './billing.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { DrugMappingBackfillDto, IngredientMappingBackfillDto } from './dto/erp-backfill.dto';

// ERP 진료라인 백필(D-6 요청3) — ERP puller 가 호출. PII(진료라인) 조회=PII키(S-1)·나머지=웹훅키.
@ApiTags('Billing ERP (진료라인 백필)')
@SkipThrottle()
@Controller('api/v1/integration/billing')
export class BillingErpController {
  constructor(private readonly svc: BillingService, private readonly integrationAuth: IntegrationAuthService) {}

  @Get('lines')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '진료라인 백필(기간) — billing.line_recorded 동일 페이로드(PII) · PII 조회 키' })
  async lines(@Headers('x-integration-key') key: string, @Query('from') from?: string, @Query('to') to?: string) {
    await this.integrationAuth.assertPiiReadKey(key);
    return { data: await this.svc.backfillLines(from, to) };
  }

  @Post('drug-mapping/backfill')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '약품 보험 제품코드 백필(close-loop) — ERP 약제팀 확정코드 수신 → MedicationCode.insuranceCode 채움' })
  async drugMappingBackfill(
    @Headers('x-integration-key') key: string,
    @Body() body: DrugMappingBackfillDto,
  ) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.backfillInsuranceCodes(body?.mappings ?? []) };
  }

  @Get('unbilled-progress')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '미청구 진행분(B-1 진행기준 수익) — 기준일(as_of)까지 이행·미청구분. PII(chartNo) 미동봉' })
  async unbilledProgress(@Headers('x-integration-key') key: string, @Query('as_of') asOf?: string) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.getUnbilledProgress(asOf) };
  }

  @Post('ingredient-mapping/backfill')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '주성분코드 백필(#2 공식, 식약처/ERP) — code→ingredientCode' })
  async ingredientBackfill(
    @Headers('x-integration-key') key: string,
    @Body() body: IngredientMappingBackfillDto,
  ) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.backfillIngredientCodes(body?.mappings ?? []) };
  }

  @Post('ingredient-mapping/derive')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '주성분 정규화 키 파생(#2 중간 — 동일성분 매칭, 공식코드 부재분만)' })
  async ingredientDerive(@Headers('x-integration-key') key: string) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.deriveIngredientKeys(false) };
  }

  @Get('noncovered')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '비급여 가격표(P1) — ERP 비급여 SoT 동기화용' })
  async noncovered(@Headers('x-integration-key') key: string) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.listNonCoveredForErp() };
  }

  @Get('census')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '일별 0시 재원환자수(P2) — 간호등급 산정용' })
  async census(@Headers('x-integration-key') key: string, @Query('from') from: string, @Query('to') to: string) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.getDailyCensus(from, to) };
  }

  @Get('materials')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '재료 품목(P2-2) — ERP 무매핑 등록용(code=HIS 그대로)' })
  async materials(@Headers('x-integration-key') key: string) {
    await this.integrationAuth.assertWebhookKey(key);
    return { data: await this.svc.listMaterialsForErp() };
  }
}
