import {
  IsString, IsNumber, IsOptional, IsBoolean, IsNotEmpty, IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 확장 등록 ──

export class RegisterExtensionDto {
  @ApiProperty({ description: '확장명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '슬롯 위치' })
  @IsString()
  @IsNotEmpty()
  slot: string;

  @ApiProperty({ description: '프론트엔드 컴포넌트 경로' })
  @IsString()
  @IsNotEmpty()
  component: string;

  @ApiProperty({ description: '정렬 순서' })
  @IsNumber()
  order: number;

  @ApiProperty({ description: '활성화 여부' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: '설정 (JSON)' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
