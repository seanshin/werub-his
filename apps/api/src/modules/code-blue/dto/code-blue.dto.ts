import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CodeBlueOutcome, RrtOutcome, RrtTrigger } from '@prisma/client';
import { IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * 코드블루·RRT 본문 — 🔴 (2026-09-14) 종전 `@Body() body: Record<string, unknown>` 4곳은 런타임 metatype 이 `Object` 라
 * ValidationPipe 가 통째로 건너뛰었다: `recognizedAt: '어제'` 가 `Invalid Date` 로 저장 시도(500)·`outcome: 'X'` 가 Prisma 오류(500)·
 * `defibrillationCount: 'abc'` 가 NaN. 필드 이름은 **서비스가 실제로 읽는 키**와 같다(whitelist 가 지우지 않게 —
 * web `/code-blue` 호출부가 보내는 키 전부 포함, 스펙이 대조한다). 길이 상한은 서비스의 기존 slice 가 정본 — 여기서 새로 정하지 않는다.
 */
export class CreateCodeBlueDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() admissionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() staffCallId?: string;
  // 🔴 (2026-09-15 U4) 코드블루 기록 위치는 스키마 VarChar(100) — 종전엔 서비스가 조용히 잘랐다. 400 으로 알린다
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional({ description: 'ISO 8601 — 없으면 서버 시각' }) @IsOptional() @IsISO8601() recognizedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() cprStartedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateCodeBlueDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() teamArrivedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() cprStartedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() roscAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) defibrillationCount?: number;
  @ApiPropertyOptional({ description: '[{drug, dose, at}] — 형식은 서비스가 그대로 저장', type: [Object] })
  @IsOptional() @IsArray() medications?: unknown[];
  @ApiPropertyOptional({ enum: CodeBlueOutcome }) @IsOptional() @IsEnum(CodeBlueOutcome) outcome?: CodeBlueOutcome;
  /** 빈 문자열은 메모 지우기(서비스 종전 동작 유지) */
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ActivateRrtDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ewsId?: string;
  @ApiPropertyOptional({ enum: RrtTrigger }) @IsOptional() @IsEnum(RrtTrigger) trigger?: RrtTrigger;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() activatedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) responderTeam?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class RespondRrtDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() respondedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) responderTeam?: string;
  @ApiPropertyOptional({ enum: RrtOutcome }) @IsOptional() @IsEnum(RrtOutcome) outcome?: RrtOutcome;
}
