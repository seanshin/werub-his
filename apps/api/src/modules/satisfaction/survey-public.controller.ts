import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsObject } from 'class-validator';
import { SatisfactionService } from './satisfaction.service';

class SubmitDto { @IsObject() answers!: Record<string, number | string>; }

// 공개 설문 작성 (토큰 기반, 무인증) — 태블릿/포털/SMS 링크
@ApiTags('Public Survey')
@Controller('api/v1/public/survey')
export class SurveyPublicController {
  constructor(private readonly service: SatisfactionService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @ApiOperation({ summary: '설문 조회 (토큰)' })
  async get(@Param('token') token: string) {
    return { data: await this.service.getByToken(token) };
  }

  @Post(':token')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: '설문 응답 제출 (토큰)' })
  async submit(@Param('token') token: string, @Body() dto: SubmitDto) {
    return { data: await this.service.submitByToken(token, dto.answers) };
  }
}
