import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 DTO 는 **class** 여야 한다 — interface·교차 타입·`Partial<>` 은 런타임 metatype 이 `Object` 라
 *    ValidationPipe 가 통째로 스킵된다(2026-09-01 실측: 그렇게 검증이 새던 @Body 14개).
 * 🔴 전역 `whitelist:true` 라 DTO 에 없는 키는 **조용히 지워진다** — 필드를 늘릴 땐 FE 와 같이 본다.
 */
export class CreateAiModelReleaseDto {
  @ApiProperty({ description: '제공자(WeRU.B 등)' })
  @IsString()
  @MaxLength(40)
  provider!: string;

  @ApiProperty({ description: '상류가 말한 태그 그대로(qwen2.5:14b …) — 지어내지 않는다' })
  @IsString()
  @MaxLength(64)
  modelTag!: string;

  @ApiPropertyOptional({ description: '이미지/가중치 digest — 모르면 비운다(추측 금지)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  digest?: string;

  @ApiPropertyOptional({ description: '배포 시각(ISO). 생략하면 지금 — 🔴 모르는 과거 시각을 지어내지 않는다' })
  @IsOptional()
  @IsISO8601()
  deployedAt?: string;

  @ApiPropertyOptional({ description: '결정 등록부 키(policy.aiModel.revalidation 등). 근거가 없으면 비운다' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  approvalRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RetireAiModelReleaseDto {
  @ApiPropertyOptional({ description: '폐기 사유(선택 — 필수로 강제하면 아무 값이나 골라 거짓이 쌓인다)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ListAiModelReleaseQueryDto {
  @ApiPropertyOptional({ description: '폐기분 포함', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRetired?: boolean;
}

export class AiCallStatsQueryDto {
  @ApiPropertyOptional({ description: '조회 일수(1~90)', default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
