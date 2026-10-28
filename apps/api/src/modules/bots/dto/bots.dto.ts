import {
  IsString, IsOptional, IsNotEmpty, IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 봇 생성 ──

export class CreateBotDto {
  @ApiProperty({ description: '봇 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '트리거 유형 (RESOURCE_CREATED, SCHEDULE 등)' })
  @IsString()
  @IsNotEmpty()
  triggerType: string;

  @ApiProperty({ description: '트리거 설정 (JSON)' })
  @IsObject()
  triggerConfig: Record<string, any>;

  @ApiProperty({ description: '실행 액션 (JSON)' })
  @IsObject()
  action: Record<string, any>;
}

// ── 봇 수동 실행 ──

export class ExecuteBotDto {
  @ApiPropertyOptional({ description: '리소스 유형' })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({ description: '이벤트 유형' })
  @IsOptional()
  @IsString()
  event?: string;

  @ApiPropertyOptional({ description: '리소스 ID' })
  @IsOptional()
  @IsString()
  resourceId?: string;
}
