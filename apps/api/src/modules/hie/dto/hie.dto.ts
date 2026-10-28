import {
  IsObject, IsOptional, IsString, IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 진료정보 전송 ──

export class SendHieDto {
  @ApiProperty({ description: '대상 기관 ID' })
  @IsString()
  targetOrgId: string;
}

// ── 외부 진료정보 수신 ──

export class ReceiveExternalRecordDto {
  @ApiPropertyOptional({ description: 'FHIR Bundle 타입' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Bundle 엔트리' })
  @IsOptional()
  entry?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '메타 정보' })
  @IsOptional()
  @IsObject()
  meta?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Resource 타입' })
  @IsOptional()
  @IsString()
  resourceType?: string;
}
