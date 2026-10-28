import { Body, Controller, Post, Headers, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SsoIdpService } from './sso-idp.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SsoGrantDto, SsoRedeemDto, SsoIntrospectDto } from './dto/sso-idp.dto';

@ApiTags('sso-idp')
@Controller('api/v1/sso/internal')
export class SsoIdpController {
  constructor(private readonly sso: SsoIdpService) {}

  @Post('grant')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'SSO 토큰 발급(audience별 경로 A/B)' })
  async grant(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() body: SsoGrantDto,
  ) {
    return { data: await this.sso.grant(userId, role, body.audience) };
  }

  @Post('redeem')
  @ApiOperation({ summary: 'redemption code → 토큰 교환(백채널, 경로 B)' })
  async redeem(@Body() body: SsoRedeemDto) {
    return { data: await this.sso.redeem(body.code) };
  }

  @Post('introspect')
  @ApiOperation({ summary: 'SSO 토큰 검증(프록시/하위시스템, 키 필요)' })
  async introspect(
    @Body() body: SsoIntrospectDto,
    @Headers('x-sso-introspect-key') key?: string,
  ) {
    return { data: await this.sso.introspect(body.token, key) };
  }
}
