import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterStationDto {
  @ApiProperty() @IsUUID() zoneId!: string;
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty({ enum: ['PHONE', 'TABLET', 'READER'] }) @IsIn(['PHONE', 'TABLET', 'READER']) deviceType!: string;
}

export class IssueTokenDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiProperty({ enum: ['DAILY', 'ADMISSION'] }) @IsIn(['DAILY', 'ADMISSION']) mode!: string;
  @ApiPropertyOptional({ enum: ['MOBILE', 'PAPER', 'CARD'] }) @IsOptional() @IsIn(['MOBILE', 'PAPER', 'CARD']) issuedVia?: string;
  @ApiPropertyOptional({ description: '위치추적 동의(가입/접수 시 수집)' }) @IsOptional() @IsBoolean() consent?: boolean;
}

export class CheckinDto {
  @ApiProperty({ description: '환자 위치 QR 토큰(plt)' }) @IsString() @Length(8, 64) plt!: string;
}

/**
 * 🔴 (2026-09-15 B10) 스테이션 활성/비활성 — `@Body('isActive') isActive: boolean` 원시 추출이라 검증이 없었다.
 *    본문이 비면 `data: { isActive: undefined }` 로 **아무것도 안 바꾸고 성공**했고, 문자열 "false" 는 Prisma 500 이었다.
 */
export class SetStationActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}
