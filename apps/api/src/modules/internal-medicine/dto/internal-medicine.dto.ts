import { IsString, IsNumber, IsOptional, IsUUID, IsObject, IsIn } from 'class-validator';
import { IM_SUBSPECIALTY_KEYS } from '@hospital-run/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInternalMedicineExamDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  // 🔴 어휘가 네 벌이었다(코드 정본 GASTRO/ENDOCRINE · 시드 GASTROENTEROLOGY/ENDOCRINOLOGY ·
  //    진료 화면 한글). 다른 어휘로 저장되면 조회 필터·지표표에서 그 기록이 사라진다 →
  //    정본 밖 값은 **저장 전에 400 으로 막는다**(조용히 저장되고 안 보이는 것보다 낫다).
  @ApiProperty({ description: '세부 전공', enum: IM_SUBSPECIALTY_KEYS })
  @IsIn(IM_SUBSPECIALTY_KEYS)
  subspecialty: string;

  @ApiPropertyOptional() @IsOptional() @IsString() chiefComplaint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plan?: string;

  // 순환기
  @ApiPropertyOptional() @IsOptional() @IsNumber() nyhaClass?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() ccsGrade?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lvef?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() heartRhythm?: string;
  @ApiPropertyOptional() @IsOptional() ecgFindings?: unknown;
  @ApiPropertyOptional() @IsOptional() echoSummary?: unknown;
  @ApiPropertyOptional() @IsOptional() pacemakerInfo?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() inrTarget?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() inrActual?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() cha2ds2vasc?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() hasbled?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() heartScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() graceScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() timiScore?: number;

  // 호흡기
  @ApiPropertyOptional() @IsOptional() @IsNumber() fev1?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fvc?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fev1Fvc?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() dlco?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() goldStage?: number;
  @ApiPropertyOptional() @IsOptional() oxygenTherapy?: unknown;
  @ApiPropertyOptional() @IsOptional() sputum?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() curb65?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() catScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() mmrcGrade?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() qsofa?: number;

  // 소화기
  @ApiPropertyOptional() @IsOptional() @IsString() endoscopyType?: string;
  @ApiPropertyOptional() @IsOptional() endoscopyFindings?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() childPughScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() childPughClass?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() meldScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() ascites?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() varicesGrade?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() blatchfordScore?: number;

  // 내분비
  @ApiPropertyOptional() @IsOptional() @IsNumber() hba1c?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fastingGlucose?: number;
  @ApiPropertyOptional() @IsOptional() insulinRegimen?: unknown;
  @ApiPropertyOptional() @IsOptional() thyroidFunction?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() bmdTScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() bmdSite?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fraxScore?: number;

  // 신장
  @ApiPropertyOptional() @IsOptional() @IsString() ckdStage?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() egfr?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() dialysisType?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() ktv?: number;
  @ApiPropertyOptional() @IsOptional() electrolytes?: unknown;
  @ApiPropertyOptional() @IsOptional() fluidBalance?: unknown;

  // 혈액종양
  @ApiPropertyOptional() @IsOptional() @IsString() cancerType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tnmStage?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() ecogPs?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() regimenName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cycleDay?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() bsa?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() recistResponse?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() ctcaeGrade?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() ctcaeEvent?: string;

  // 감염
  @ApiPropertyOptional() @IsOptional() @IsString() infectionSite?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() organism?: string;
  @ApiPropertyOptional() @IsOptional() susceptibility?: unknown;
  @ApiPropertyOptional() @IsOptional() antibiotics?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() isolationType?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sofaScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() procalcitonin?: number;

  // 류마티스
  @ApiPropertyOptional() @IsOptional() @IsNumber() tenderJointCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() swollenJointCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() das28?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() haqDi?: number;
  @ApiPropertyOptional() @IsOptional() autoantibodies?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sledai?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() basdai?: number;
  @ApiPropertyOptional() @IsOptional() biologics?: unknown;

  // 공통 메타
  @ApiPropertyOptional() @IsOptional() scores?: unknown;
}
