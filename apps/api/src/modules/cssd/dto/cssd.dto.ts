import {
  IsString, IsOptional, IsNotEmpty, IsObject, IsIn, IsArray, IsUUID, IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 멸균 로드 생성 ──

export class CreateLoadDto {
  @ApiProperty({ description: '멸균기' })
  @IsString()
  @IsNotEmpty()
  sterilizer: string;

  @ApiPropertyOptional({ description: '프로그램', enum: ['STEAM', 'EO', 'H2O2', 'PLASMA'] })
  @IsOptional()
  @IsIn(['STEAM', 'EO', 'H2O2', 'PLASMA'])
  program?: string;

  @ApiPropertyOptional({ description: '온도(℃)' })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(150)
  tempC?: number;

  @ApiPropertyOptional({ description: '시간(분)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  durationMin?: number;

  @ApiProperty({ description: '포함 패키지 ID 목록', type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  packageIds: string[];
}

// ── BI/CI 판독·불출 ──

export class ReleaseLoadDto {
  @ApiProperty({ description: '생물학적 지표(BI) 결과', enum: ['PASS', 'FAIL', 'PENDING'] })
  @IsIn(['PASS', 'FAIL', 'PENDING'])
  biResult: string;

  @ApiProperty({ description: '화학적 지표(CI) 결과', enum: ['PASS', 'FAIL', 'PENDING'] })
  @IsIn(['PASS', 'FAIL', 'PENDING'])
  ciResult: string;
}

// ── 기구 세트 등록 ──

export class CreateInstrumentSetDto {
  @ApiProperty({ description: '기구 세트 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '세트 구성 내용 (JSON)' })
  @IsObject()
  contents: Record<string, any>;

  @ApiPropertyOptional({ description: '보관 위치' })
  @IsOptional()
  @IsString()
  location?: string;
}

// ── 멸균 상태 변경 ──

export class UpdateCssdStatusDto {
  @ApiProperty({ description: '상태', enum: ['DIRTY', 'WASHING', 'STERILIZING', 'STERILE', 'EXPIRED', 'IN_USE'] })
  @IsIn(['DIRTY', 'WASHING', 'STERILIZING', 'STERILE', 'EXPIRED', 'IN_USE'])
  status: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: '생물학적 지표(BI) 결과 — PASS/FAIL' })
  @IsOptional()
  @IsString()
  biResult?: string;

  @ApiPropertyOptional({ description: '화학적 지표(CI) 결과 — PASS/FAIL' })
  @IsOptional()
  @IsString()
  ciResult?: string;
}
