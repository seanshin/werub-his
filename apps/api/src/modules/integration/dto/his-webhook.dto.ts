import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { HIS_EVENT_CATALOG } from '../integration-outbox.service';

const EVENT_VOCAB = [...HIS_EVENT_CATALOG, '*'] as string[];

/**
 * 🔴 (2026-09-15 B10) HIS 이벤트 웹훅 구독 등록·수정 — 인라인 본문이었다.
 *  - 이벤트 목록의 오타는 서비스가 **조용히 걸러** 일부만 구독했다(보낸 3개 중 1개만 저장·성공 응답) — 카탈로그 밖이면 400.
 *  - 형식 `'slack'`(소문자) 같은 값은 조용히 `RAW` 가 됐다 — 어휘는 서비스 정본(RAW·SLACK) 그대로.
 *  - 이름·URL 누락·`isActive: "false"`·문자열 아닌 이름은 `throw new Error`·Prisma·`.trim()` 에서 500 이었다.
 * 목적지 검증(사설망·loopback 차단)은 서비스의 `assertEgressUrl` 그대로 — DTO 는 형태만 본다. 길이는 스키마 VarChar 그대로.
 */
export class CreateHisWebhookDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(400) targetUrl: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsIn(EVENT_VOCAB, { each: true }) events: string[];
  @ApiPropertyOptional({ description: '미지정 시 자동 생성(1회 반환)' }) @IsOptional() @IsString() @MaxLength(200) secret?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ enum: ['RAW', 'SLACK'] }) @IsOptional() @IsIn(['RAW', 'SLACK']) format?: string;
}

export class UpdateHisWebhookDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(400) targetUrl?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsIn(EVENT_VOCAB, { each: true }) events?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) secret?: string;
  @ApiPropertyOptional({ enum: ['RAW', 'SLACK'] }) @IsOptional() @IsIn(['RAW', 'SLACK']) format?: string;
}
