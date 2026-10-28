import { IsString, IsNumber, IsOptional, IsUUID, IsIn, IsBoolean, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 요역동학 검사 — 자유 JSON이던 것을 구조화(음수·비수치 차단)
export class UrodynamicsDto {
  @ApiPropertyOptional({ description: '최대 요속 (mL/s)' })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  maxFlowRate?: number;

  @ApiPropertyOptional({ description: '평균 요속 (mL/s)' })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  avgFlowRate?: number;

  @ApiPropertyOptional({ description: '배뇨량 (mL)' })
  @IsOptional() @IsNumber() @Min(0) @Max(3000)
  voidedVolume?: number;

  @ApiPropertyOptional({ description: '잔뇨량 (mL)' })
  @IsOptional() @IsNumber() @Min(0) @Max(3000)
  residualVolume?: number;
}

export class CreateUrologyExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  // 범위검증 — 음수·척도 밖 값이 그대로 저장되던 갭 해소(IPSS 0-35·QoL 0-6)
  @ApiPropertyOptional({ description: 'IPSS 총점 0-35' }) @IsOptional() @IsNumber() @Min(0) @Max(35) ipssScore?: number;
  @ApiPropertyOptional({ description: 'IPSS QoL 0-6' }) @IsOptional() @IsNumber() @Min(0) @Max(6) ipssQol?: number;
  @ApiPropertyOptional({ description: 'PSA (ng/mL)' }) @IsOptional() @IsNumber() @Min(0) @Max(9999.99) psaValue?: number;
  @ApiPropertyOptional({ type: UrodynamicsDto }) @IsOptional() @ValidateNested() @Type(() => UrodynamicsDto) urodynamics?: UrodynamicsDto;
  @ApiPropertyOptional({ description: '전립선 용적 (mL)' }) @IsOptional() @IsNumber() @Min(0) @Max(999.9) prostateVolume?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;
}

// 비뇨의학과 시술 기록 — 시술 모듈 부재 갭 해소
export class CreateUrologyProcedureDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ enum: ['CYSTOSCOPY', 'PROSTATE_BIOPSY', 'ESWL', 'TURP', 'URETEROSCOPY', 'CATHETERIZATION', 'OTHER'] })
  @IsIn(['CYSTOSCOPY', 'PROSTATE_BIOPSY', 'ESWL', 'TURP', 'URETEROSCOPY', 'CATHETERIZATION', 'OTHER'])
  procedureType: string;

  @ApiPropertyOptional({ description: '적응증' }) @IsOptional() @IsString() indication?: string;
  @ApiPropertyOptional({ description: '마취' }) @IsOptional() @IsString() anesthesia?: string;
  @ApiPropertyOptional({ description: '소견' }) @IsOptional() @IsString() findings?: string;
  @ApiPropertyOptional({ description: '합병증' }) @IsOptional() @IsString() complications?: string;
  @ApiPropertyOptional({ description: '검체 채취 여부(생검 — 병리 추적)' }) @IsOptional() @IsBoolean() specimenTaken?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
