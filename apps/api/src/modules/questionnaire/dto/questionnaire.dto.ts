import {
  IsString, IsOptional, IsNotEmpty, IsUUID, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 문진표 토큰 생성 ──

export class GenerateQuestionnaireTokenDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '양식 스키마 ID' })
  @IsString()
  @IsNotEmpty()
  formSchemaId: string;

  @ApiPropertyOptional({ description: '예약 ID' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}

// ── 문진표 제출/임시저장 ──

export class SubmitQuestionnaireDto {
  @ApiProperty({ description: '문진표 데이터 (JSON)' })
  @IsOptional()
  data: Record<string, unknown>;
}

// ── 매핑 생성 ──

export class CreateQuestionnaireMappingDto {
  @ApiProperty({ description: '진료과명' })
  @IsString()
  @IsNotEmpty()
  departmentName: string;

  @ApiProperty({ description: '양식 스키마 ID' })
  @IsString()
  @IsNotEmpty()
  formSchemaId: string;

  @ApiPropertyOptional({ description: '방문 유형' })
  @IsOptional()
  @IsString()
  visitType?: string;

  @ApiPropertyOptional({ description: '우선순위' })
  @IsOptional()
  priority?: number;
}

// ── 매핑 수정 ──

export class UpdateQuestionnaireMappingDto {
  @ApiPropertyOptional({ description: '방문 유형' })
  @IsOptional()
  @IsString()
  visitType?: string;

  @ApiPropertyOptional({ description: '우선순위' })
  @IsOptional()
  priority?: number;

  // 🔴 (2026-09-15 P2) 문자열 "false" 가 Prisma Boolean 컬럼에서 500 — 형식을 입구에서 막는다
  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── 수동 발송 ──

export class SendQuestionnaireDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '양식 스키마 ID' })
  @IsOptional()
  @IsString()
  formSchemaId?: string;

  @ApiPropertyOptional({ description: '예약 ID' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional({ description: '발송 수단 (SMS, KAKAO 등)' })
  @IsOptional()
  @IsString()
  sentVia?: string;
}
