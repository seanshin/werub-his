import {
  IsString, IsNumber, IsOptional, IsNotEmpty, IsBoolean, IsUUID,
  IsArray, ArrayMaxSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── CDSS 처방 검증 요청 ──

export class CdssCheckDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '약물 코드 ID' })
  @IsOptional()
  @IsUUID()
  medicationCodeId?: string;

  @ApiPropertyOptional({ description: '시술 코드 ID' })
  @IsOptional()
  @IsUUID()
  procedureCodeId?: string;

  @ApiPropertyOptional({ description: '용량' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ description: '빈도' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ description: '투여 기간 (일)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ description: '투여 경로' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: '기록 전용 진료 ID — 판정 범위는 그대로 두고 판정 기록(CdssLog)만 이 진료에 남긴다' })
  @IsOptional()
  @IsUUID()
  logEncounterId?: string;
}

// ── 처방세트(템플릿) 검증 요청 ──

/**
 * 처방세트 안의 약물 1건.
 * `medicationCodeId` 가 없으면(=약품 마스터에 연결되지 않은 자유 입력) **판정 대상이 아니다** —
 * 그 사실을 조용히 넘기지 않고 결과에 그대로 적는다.
 */
export class OrderSetMedicationDto {
  @ApiPropertyOptional({ description: '약품 마스터 ID — 없으면 판정 불가 항목으로 보고된다' })
  @IsOptional()
  @IsUUID()
  medicationCodeId?: string;

  @ApiPropertyOptional({ description: '항목 표시명(판정 불가 항목을 사람에게 지목하기 위한 이름)' })
  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * 🔴 처방세트 편집기의 "CDSS 검증" 버튼은 개통 이래 **항상 400** 이었다.
 *    화면은 `{ medications: [...] }` 를 보냈는데 `CdssCheckDto` 는 **환자 1명 + 약물 1건**
 *    구조였고 `patientId` 가 필수였다 — 처방세트는 템플릿이라 환자가 없다. 형태 자체가 달랐다.
 *
 *    그래서 환자에 매이지 않는 검사만 하는 별도 입구를 둔다.
 *    **환자 의존 검사(알레르기·신기능·연령·임부)는 여기서 할 수 없다** — 그 사실을 응답이 말한다.
 *    (없는 검사를 "통과"로 그리면 그것이 거짓 안심이다.)
 */
export class CheckOrderSetDto {
  @ApiProperty({ description: '처방세트의 약물 항목', type: [OrderSetMedicationDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderSetMedicationDto)
  medications: OrderSetMedicationDto[];
}

// ── CDSS 규칙 생성 ──

export class CreateCdssRuleDto {
  @ApiProperty({ description: '규칙 분류 (INTERACTION, ALLERGY, AGE, DOSE, DUPLICATE, DIAGNOSIS, GUIDELINE)' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '위험 수준 (ERROR, WARNING, INFO)' })
  @IsString()
  @IsNotEmpty()
  level: string;

  @ApiProperty({ description: '규칙 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '규칙 설명' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ description: '약물/성분 A' })
  @IsOptional()
  @IsString()
  drugA?: string;

  @ApiPropertyOptional({ description: '약물/성분 B (상호작용 시)' })
  @IsOptional()
  @IsString()
  drugB?: string;

  @ApiPropertyOptional({ description: '연령 하한' })
  @IsOptional()
  @IsNumber()
  ageMin?: number;

  @ApiPropertyOptional({ description: '연령 상한' })
  @IsOptional()
  @IsNumber()
  ageMax?: number;

  @ApiPropertyOptional({ description: '최대 용량' })
  @IsOptional()
  @IsString()
  maxDose?: string;

  @ApiPropertyOptional({ description: '관련 진단코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiPropertyOptional({ description: '권고 사항' })
  @IsOptional()
  @IsString()
  recommendation?: string;

  @ApiPropertyOptional({ description: '근거 문헌' })
  @IsOptional()
  @IsString()
  reference?: string;
}

// ── CDSS 규칙 수정 ──

export class UpdateCdssRuleDto {
  @ApiPropertyOptional({ description: '규칙 분류' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '위험 수준' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ description: '규칙 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '규칙 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '약물/성분 A' })
  @IsOptional()
  @IsString()
  drugA?: string;

  @ApiPropertyOptional({ description: '약물/성분 B' })
  @IsOptional()
  @IsString()
  drugB?: string;

  @ApiPropertyOptional({ description: '연령 하한' })
  @IsOptional()
  @IsNumber()
  ageMin?: number;

  @ApiPropertyOptional({ description: '연령 상한' })
  @IsOptional()
  @IsNumber()
  ageMax?: number;

  @ApiPropertyOptional({ description: '최대 용량' })
  @IsOptional()
  @IsString()
  maxDose?: string;

  @ApiPropertyOptional({ description: '관련 진단코드' })
  @IsOptional()
  @IsString()
  diagnosisCode?: string;

  @ApiPropertyOptional({ description: '권고 사항' })
  @IsOptional()
  @IsString()
  recommendation?: string;

  @ApiPropertyOptional({ description: '근거 문헌' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
