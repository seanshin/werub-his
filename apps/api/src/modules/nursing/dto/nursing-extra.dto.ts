import {
  IsString, IsOptional, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 투약 확인 ──

export class AdministerMedDto {
  @ApiProperty({ description: '투여량' })
  @IsString()
  @IsNotEmpty()
  dose: string;

  @ApiProperty({ description: '투여 경로' })
  @IsString()
  @IsNotEmpty()
  route: string;

  @ApiPropertyOptional({ description: 'BCMA — 환자 손목밴드 스캔(MRN)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  patientBandScan?: string;

  @ApiPropertyOptional({ description: 'BCMA — 약품 바코드 스캔(medicationCode.barcode 또는 EDI 코드)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  medScan?: string;

  @ApiPropertyOptional({ description: '검증자 ID(독립 이중확인 간호사)' })
  @IsOptional()
  @IsUUID()
  verifiedBy?: string;

  /**
   * 🔴 전역 `whitelist: true` 는 DTO 에 없는 키를 **조용히 지운다.**
   *    이 필드가 없으면 화면이 우회 사유를 보내도 서버에 닿지 않고 기록은 다시 침묵한다.
   *    FE↔DTO 기계 대조: `test/architecture/mar-administer-contract.spec.ts`
   */
  @ApiPropertyOptional({ description: '독립 이중확인 우회 사유(야간 단독근무 등) — 막지 않되 기록·표시' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doubleCheckBypassReason?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 투약 보류 ──

export class HoldMedDto {
  @ApiProperty({ description: '보류 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ── 간호진단 추가 ──

export class CreateNursingDiagnosisDto {
  @ApiProperty({ description: 'NANDA 코드' })
  @IsString()
  @IsNotEmpty()
  nandaCode: string;

  @ApiProperty({ description: 'NANDA 진단명' })
  @IsString()
  @IsNotEmpty()
  nandaName: string;

  @ApiPropertyOptional({ description: '관련 요인' })
  @IsOptional()
  @IsString()
  relatedFactors?: string;

  @ApiPropertyOptional({ description: '특성적 징후' })
  @IsOptional()
  @IsString()
  definingCharacteristics?: string;

  @ApiProperty({ description: '기대 결과' })
  @IsString()
  @IsNotEmpty()
  expectedOutcome: string;
}
