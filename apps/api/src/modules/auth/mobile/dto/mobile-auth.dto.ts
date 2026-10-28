import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

/** 🔴 인라인 `@Body()` 객체가 아니라 **클래스 DTO** 여야 ValidationPipe 가 실제로 돈다(v4.3.0 교훈) */
export class MobileLoginDto {
  @ApiProperty({ description: '이메일 또는 사번' })
  @IsString() @Length(2, 255)
  identifier!: string;

  @ApiProperty() @IsString() @Length(1, 200)
  password!: string;

  @ApiProperty() @IsString() @Length(8, 64)
  installationId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  staffDeviceId?: string;

  @ApiPropertyOptional({ description: '등록된 App Attest 키 — 설정된 환경에서는 필수' })
  @IsOptional() @IsString()
  appKeyId?: string;

  @ApiPropertyOptional() @IsOptional() @IsIn(['IOS', 'ANDROID'])
  platform?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  appVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  osVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60)
  deviceModel?: string;
}

export class MobileRefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  refreshToken!: string;

  @ApiProperty() @IsString() @Length(8, 64)
  installationId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  staffDeviceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  appKeyId?: string;
}

export class MobileLogoutDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  refreshToken?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ enum: ['CURRENT_SESSION', 'ALL_SESSIONS'] })
  @IsOptional() @IsIn(['CURRENT_SESSION', 'ALL_SESSIONS'])
  scope?: 'CURRENT_SESSION' | 'ALL_SESSIONS';
}
