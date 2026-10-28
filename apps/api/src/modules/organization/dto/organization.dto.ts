import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 E2) 기관 등록·수정이 `@Body() dto: any` 를 그대로 `prisma.organization.create/update({ data: dto })` 에 넣었다 —
 * 본문에 `smartSecret`·`smartClientId`·`isSelf` 를 넣으면 SMART 비밀·자기 기관 표식이 그대로 덮였다(대량 할당).
 * 또 관리 화면은 기관 유형을 `type` 으로 보내는데 서비스는 `orgType` 을 읽어, 등록은 Prisma 알 수 없는 필드로 **늘 실패**했다.
 * 길이는 `Organization` 스키마 VarChar 그대로.
 */
export class CreateOrganizationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional({ description: '기관 유형 — 정본 키' }) @IsOptional() @IsString() @MaxLength(30) orgType?: string;
  @ApiPropertyOptional({ description: '기관 유형 — 관리 화면이 보내는 키(orgType 별칭)' }) @IsOptional() @IsString() @MaxLength(30) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) grade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() address?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fhirEndpoint?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) orgType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) grade?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() address?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fhirEndpoint?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
