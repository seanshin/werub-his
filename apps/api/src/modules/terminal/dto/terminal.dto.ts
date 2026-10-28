import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

// 전역 whitelist ValidationPipe가 데코레이터 없는 필드를 strip → 모든 필드 class-validator 필수
export class RegisterTerminalDto {
  @ApiProperty({ description: '단말 고유 식별자(X-Device-UUID)' })
  @IsString()
  @Length(1, 128)
  deviceUuid!: string;

  @ApiPropertyOptional({ description: '고정 IP(보조키)' })
  @IsOptional()
  @IsString()
  @Length(1, 45)
  ipAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 32)
  macAddress?: string;

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'] })
  @IsOptional()
  @IsIn(['PUBLIC', 'PRIVATE'])
  mode?: 'PUBLIC' | 'PRIVATE';

  @ApiPropertyOptional({ description: 'PRIVATE 전담 직원 userId' })
  @IsOptional()
  @IsUUID()
  dedicatedUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @ApiPropertyOptional({ description: '잠금 타임아웃(초) — null=프로파일 기본' })
  @IsOptional()
  @IsInt()
  @Min(30)
  lockTimeoutSec?: number;
}

export class OverrideTerminalDto {
  @ApiProperty({ description: '대상 단말 X-Device-UUID' })
  @IsString()
  @Length(1, 128)
  deviceUuid!: string;

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'] })
  @IsOptional()
  @IsIn(['PUBLIC', 'PRIVATE'])
  mode?: 'PUBLIC' | 'PRIVATE';

  @ApiPropertyOptional({ description: '전담 변경(null 전달 시 해제)' })
  @IsOptional()
  @IsUUID()
  dedicatedUserId?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'QUARANTINED', 'RETIRED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'QUARANTINED', 'RETIRED'])
  status?: string;
}

export class VerifyPinDto {
  @ApiProperty({ description: '단말 X-Device-UUID' })
  @IsString()
  @Length(1, 128)
  deviceUuid!: string;

  @ApiProperty({ description: '직원 사번' })
  @IsString()
  @Length(1, 40)
  employeeNumber!: string;

  @ApiProperty({ description: '6자리 데일리 PIN' })
  @Matches(/^\d{6}$/, { message: 'PIN은 6자리 숫자여야 합니다.' })
  pin!: string;
}

export class RevealPinDto {
  @ApiProperty({ description: '생체(passkey) step-up assertion 응답' })
  @IsDefined()
  @IsObject()
  response!: Record<string, unknown>;
}

export class SaveDraftDto {
  @ApiProperty({ description: '작성 중 스냅샷(임의 JSON)' })
  @IsDefined()
  @IsObject()
  snapshot!: Record<string, unknown>;
}

export class KillSwitchDto {
  @ApiProperty({ description: '세션 파기 대상 직원 userId' })
  @IsUUID()
  targetUserId!: string;

  @ApiPropertyOptional({ description: '분실 기기 StaffDevice.id(지정 시 패스키 폐기)' })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ description: '사유' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  reason?: string;
}
