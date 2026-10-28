import { Controller, Get, Query, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { LisReferenceService } from './lis-reference.service';

/**
 * LIS 서비스계정(read-only) 참조 EP — x-integration-key(lis.integrationKey) 인증.
 * 결재참조(EAS)·수혈동의(ConsentForm) 조회 전용. 쓰기 없음(정본은 HIS).
 */
@ApiTags('LIS Reference (LIS 참조·read-only)')
@Controller('api/v1/integration/lis')
export class LisReferenceController {
  constructor(
    private readonly auth: IntegrationAuthService,
    private readonly svc: LisReferenceService,
  ) {}

  @Get('eapproval/status')
  @ApiOperation({ summary: '조직 게이트 결재 참조(gateKey) — 커스텀 JSON' })
  async gateApproval(@Headers('x-integration-key') key: string, @Query('gateKey') gateKey?: string) {
    await this.auth.assertLisKey(key);
    return { data: await this.svc.getGateApproval(gateKey) };
  }

  @Get('lab-codes')
  @ApiOperation({ summary: '검사코드 전체 카탈로그(H1) — B/C/D 챕터·edi_code 정본·1:N 패널·?since= 증분(코드 또는 패널 항목 변경 · deactivated)·페이징(limit≤20000)' })
  async labCodes(
    @Headers('x-integration-key') key: string,
    @Query('since') since?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.auth.assertLisKey(key);
    return { data: await this.svc.getLabCodeCatalog(since, page ? parseInt(page, 10) || 1 : 1, limit ? parseInt(limit, 10) || 5000 : 5000) };
  }

  @Get('consent/status')
  @ApiOperation({ summary: '수혈 동의 참조(FHIR Consent) — 환자·범주. S-3 대상토큰(X-Target-Token, scope=lis·기본 permissive)' })
  async consent(
    @Headers('x-integration-key') key: string,
    @Headers('x-target-token') targetToken?: string,
    @Query('patientId') patientId?: string,
    @Query('category') category?: string,
  ) {
    await this.auth.assertLisKey(key);
    // S-3 IDOR 차단 — 키 1개로 임의 patientId 순회 방지. lis.targetAuthEnforce=true 플립 전엔 토큰 미동봉 통과(무중단)
    if (patientId) await this.auth.assertTargetAuth({ token: targetToken, target: patientId, scope: 'lis' });
    return { data: await this.svc.getConsent(patientId, category ?? 'TRANSFUSION') };
  }
}
