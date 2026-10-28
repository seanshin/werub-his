import {
  IsString, IsOptional, IsNumber, IsUUID, IsNotEmpty, IsBoolean, IsEnum, Matches, IsIn, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 치아차트 기록 ──

export class CreateDentalChartDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '치아 상태 (치아번호별 상태 매핑)' })
  @IsNotEmpty()
  teethStatus: unknown;

  @ApiPropertyOptional({ description: '치주 상태' })
  @IsOptional()
  perioStatus?: unknown;

  @ApiPropertyOptional({ description: '교합' })
  @IsOptional()
  @IsString()
  occlusion?: string;

  @ApiPropertyOptional({ description: '구강 위생 상태' })
  @IsOptional()
  @IsString()
  oralHygiene?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 치료 계획 ──

export class CreateDentalPlanDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '치아 번호' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/, { message: "tooth는 FDI 치식 표기(영구치 11-48·유치 51-85)여야 합니다" }) // 오발치 방지 — 자유문자열 차단
  tooth: string;

  @ApiProperty({ description: '시술명' })
  @IsString()
  @IsNotEmpty()
  procedure: string;

  @ApiProperty({ description: '카테고리 (보존, 보철, 발치 등)' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiPropertyOptional({ description: '우선순위' })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({ description: '예상 비용' })
  @IsOptional()
  @IsNumber()
  estimatedCost?: number;

  @ApiPropertyOptional({ description: '보험 적용 여부' })
  @IsOptional()
  @IsBoolean()
  insuranceCovered?: boolean;

  @ApiPropertyOptional({ description: '예상 세션 수' })
  @IsOptional()
  @IsNumber()
  sessions?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 계획 상태 변경 ──

export class UpdateDentalPlanStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 치료 기록 ──

export class CreateDentalRecordDto {
  @ApiPropertyOptional({ description: '치료 계획 ID' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '치아 번호' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/, { message: "tooth는 FDI 치식 표기(영구치 11-48·유치 51-85)여야 합니다" }) // 오발치 방지 — 자유문자열 차단
  tooth: string;

  @ApiProperty({ description: '시술명' })
  @IsString()
  @IsNotEmpty()
  procedure: string;

  @ApiPropertyOptional({ description: '면 (O, M, D, B, L 등)' })
  @IsOptional()
  surfaces?: unknown;

  @ApiPropertyOptional({ description: '재료' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ description: '마취' })
  @IsOptional()
  @IsString()
  anesthesia?: string;

  @ApiPropertyOptional({ description: '국소마취제(구조화) — 최대용량 검증 대상', enum: ['LIDOCAINE', 'ARTICAINE', 'MEPIVACAINE', 'BUPIVACAINE', 'PRILOCAINE', 'NONE'] })
  @IsOptional()
  @IsIn(['LIDOCAINE', 'ARTICAINE', 'MEPIVACAINE', 'BUPIVACAINE', 'PRILOCAINE', 'NONE'])
  anesthesiaAgent?: string;

  @ApiPropertyOptional({ description: '국소마취제 총 투여량(mg) — 카트리지 환산(예: 리도카인 2% 1.8mL = 36mg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2000)
  anesthesiaDoseMg?: number;

  @ApiPropertyOptional({ description: '근관 길이' })
  @IsOptional()
  canalLength?: unknown;

  @ApiPropertyOptional({ description: '쉐이드' })
  @IsOptional()
  @IsString()
  shade?: string;

  @ApiPropertyOptional({ description: '기공 의뢰' })
  @IsOptional()
  @IsString()
  labOrder?: string;

  @ApiPropertyOptional({ description: 'X-ray 촬영 여부' })
  @IsOptional()
  @IsBoolean()
  xrayTaken?: boolean;

  @ApiPropertyOptional({ description: '소견' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '다음 방문일' })
  @IsOptional()
  @IsString()
  nextVisit?: string;
}

// ── 기공의뢰 ──

export class CreateDentalLabOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '치료 계획 ID' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiProperty({ description: '치아 번호' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/, { message: "tooth는 FDI 치식 표기(영구치 11-48·유치 51-85)여야 합니다" }) // 오발치 방지 — 자유문자열 차단
  tooth: string;

  @ApiProperty({ description: '의뢰 유형' })
  @IsString()
  @IsNotEmpty()
  orderType: string;

  @ApiProperty({ description: '재료' })
  @IsString()
  @IsNotEmpty()
  material: string;

  @ApiPropertyOptional({ description: '쉐이드' })
  @IsOptional()
  @IsString()
  shade?: string;

  @ApiPropertyOptional({ description: '기공소명' })
  @IsOptional()
  @IsString()
  labName?: string;

  @ApiPropertyOptional({ description: '인상 방법' })
  @IsOptional()
  @IsString()
  impression?: string;

  @ApiPropertyOptional({ description: '납기일' })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ description: '비용' })
  @IsOptional()
  @IsNumber()
  cost?: number;
}

// ── 기공의뢰 상태 변경 ──

export class UpdateDentalLabOrderStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}

// ── 치주검사 기록 ──

export class CreatePerioDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '진료 ID' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ description: '치주 상태 (치아별 pocket depth 등)' })
  @IsNotEmpty()
  perioStatus: unknown;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 리콜 스케줄 ──

export class CreateRecallDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: '치아 번호' })
  @IsOptional()
  @IsString()
  @Matches(/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/, { message: 'tooth는 FDI 치식 표기여야 합니다' })
  tooth?: string;

  @ApiProperty({ description: '리콜 유형', enum: ['6MONTH', '1YEAR', 'CUSTOM'] })
  @IsEnum(['6MONTH', '1YEAR', 'CUSTOM'])
  recallType: '6MONTH' | '1YEAR' | 'CUSTOM';

  @ApiProperty({ description: '예정일' })
  @IsString()
  @IsNotEmpty()
  scheduledDate: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}
