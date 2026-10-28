import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TranslationService } from './translation.service';

class TranslateDto {
  @IsString() @MaxLength(5000) text!: string;
  @IsString() target!: string;
  @IsOptional() @IsString() source?: string;
}

@ApiTags('i18n')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/i18n')
export class TranslationController {
  constructor(private readonly svc: TranslationService) {}

  @Post('translate')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @ApiOperation({ summary: '자동 번역(캐시 우선, 온프레미스 Ollama)' })
  async translate(@Body() dto: TranslateDto) {
    return { data: await this.svc.translate(dto.text, dto.target, dto.source ?? 'ko') };
  }
}
