import { Controller, Get, Post, Param, Body, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { ConsentSignSubmitDto } from './dto/consent-public.dto';

// 공개(토큰 기반) 대면 서명 화면용 — 태블릿/PC에서 환자/보호자가 접근 (직원 로그인 불필요)
@ApiTags('Consent Sign (Public)')
@Controller('api/v1/consent-sign')
export class ConsentSignController {
  constructor(private readonly service: ConsentService) {}

  @Get(':token')
  @ApiOperation({ summary: '서명 화면용 동의서 조회 (토큰)' })
  async getSession(@Param('token') token: string) {
    return { data: await this.service.getSignSession(token) };
  }

  @Post(':token/submit')
  @ApiOperation({ summary: '서명 제출 (서명패드 이미지)' })
  async submit(@Param('token') token: string, @Body() body: ConsentSignSubmitDto, @Ip() ip: string) {
    return { data: await this.service.submitSignSession(token, body, { ipAddress: ip ?? null }) };
  }
}
