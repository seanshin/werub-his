import { Controller, Get, Post, Body, Param, Query, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { ErpEapprovalService } from './erp-eapproval.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { secureKeyEqual } from '../../common/util/secure-compare';

class RefDto {
  @IsString() source_module!: string;
  @IsString() source_ref!: string;
}
class SubmitDto {
  @IsString() doc_type!: string;
  @IsString() title!: string;
  @IsString() drafter_clinic_user_id!: string;
  @IsOptional() @IsArray() approvers?: string[] | null;
  @IsObject() content!: Record<string, unknown>;
  @ValidateNested() @Type(() => RefDto) ref!: RefDto;
  @IsString() callback_url!: string;
}

// ERP-facing 전자결재 릴레이 (서버-서버, X-Integration-Key 인증)
@ApiTags('ERP E-Approval Relay (전자결재)')
@SkipThrottle()
@Controller('api/v1/erp/eapproval')
export class ErpEapprovalController {
  constructor(private readonly svc: ErpEapprovalService, private readonly config: ConfigService, private readonly configRuntime: ConfigRuntimeService, private readonly integrationAuth: IntegrationAuthService) {}

  // 키 출처 통일: 공유 연동키(ConfigRuntime erp.integrationKey) + 전용 env키 모두 수용
  private async auth(key?: string) {
    const shared = (await this.configRuntime.get('erp.integrationKey')) as string;
    const env1 = this.config.get<string>('ERP_INTEGRATION_KEY');
    const env2 = this.config.get<string>('EAPPROVAL_RELAY_KEY');
    if (!(secureKeyEqual(key, shared) || secureKeyEqual(key, env1) || secureKeyEqual(key, env2))) {
      throw new UnauthorizedException('연동 키가 올바르지 않습니다');
    }
  }

  @Post('submit')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: '① 결재 상신 릴레이 (ERP→HIS→W.Sign)' })
  async submit(@Headers('x-integration-key') key: string, @Headers('idempotency-key') idem: string, @Body() dto: SubmitDto) {
    await this.auth(key);
    return { data: await this.svc.submit(dto, idem) };
  }

  @Get('approvers')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiHeader({ name: 'X-Target-Token', required: false })
  @ApiOperation({ summary: '④ 결재선 추천 (조직도) — S-3 대상토큰(drafter IDOR·기본 permissive)' })
  async approvers(@Headers('x-integration-key') key: string, @Headers('x-target-token') targetToken: string, @Query('drafter_clinic_user_id') drafter: string, @Query('doc_type') docType?: string) {
    await this.auth(key);
    // S-3 대상별 인가 — 키 1개로 임의 drafter 조직도 순회 방지(erp.targetAuthEnforce=true 플립 시 강제)
    if (drafter) await this.integrationAuth.assertTargetAuth({ token: targetToken, target: drafter });
    return { data: await this.svc.approvers(drafter, docType) };
  }

  @Get(':approvalId')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '③ 상태 조회 릴레이' })
  async status(@Headers('x-integration-key') key: string, @Param('approvalId') approvalId: string) {
    await this.auth(key);
    return { data: await this.svc.status(approvalId) };
  }
}
