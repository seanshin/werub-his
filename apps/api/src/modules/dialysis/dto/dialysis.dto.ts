import {
  IsString, IsOptional, IsNumber, IsUUID, IsNotEmpty, IsBoolean, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── 투석 처방 ──

export class CreateDialysisOrderDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '투석 방식 (HD, PD, CRRT 등)' })
  @IsString()
  @IsNotEmpty()
  modality: string;

  @ApiProperty({ description: '투석 빈도 (주3회 등)' })
  @IsString()
  @IsNotEmpty()
  frequency: string;

  @ApiProperty({ description: '투석 시간 (분)' })
  @IsNumber() @Min(30) @Max(600)
  duration: number;

  @ApiPropertyOptional({ description: '다이얼라이저 종류' })
  @IsOptional()
  @IsString()
  dialyzerType?: string;

  // 임상 경계 — 비정상/음수 파라미터가 침상까지 전달되어 위험한 제수(除水)·응고를 유발하던 것 방지.
  @ApiPropertyOptional({ description: '혈류 속도 (mL/min)' })
  @IsOptional()
  @IsNumber() @Min(50) @Max(600)
  bloodFlowRate?: number;

  @ApiPropertyOptional({ description: '투석액 유량 (mL/min)' })
  @IsOptional()
  @IsNumber() @Min(100) @Max(1000)
  dialysateFlow?: number;

  @ApiPropertyOptional({ description: '건체중 (kg)' })
  @IsOptional()
  @IsNumber() @Min(20) @Max(300)
  dryWeight?: number;

  @ApiPropertyOptional({ description: 'UF 목표 (mL) — 총 제수 목표' })
  @IsOptional()
  @IsNumber() @Min(0) @Max(6000)
  ufGoal?: number;

  @ApiPropertyOptional({ description: '항응고제' })
  @IsOptional()
  @IsString()
  anticoagulant?: string;

  @ApiPropertyOptional({ description: '혈관접근 유형' })
  @IsOptional()
  @IsString()
  accessType?: string;

  @ApiPropertyOptional({ description: 'PD 용액' })
  @IsOptional()
  @IsString()
  pdSolution?: string;

  @ApiPropertyOptional({ description: 'PD 용량 (mL)' })
  @IsOptional()
  @IsNumber()
  pdVolume?: number;

  @ApiPropertyOptional({ description: 'PD 교환 횟수' })
  @IsOptional()
  @IsNumber()
  pdExchanges?: number;

  @ApiPropertyOptional({ description: '체류 시간 (분)' })
  @IsOptional()
  @IsNumber()
  dwellTime?: number;

  @ApiProperty({ description: '시작일' })
  @IsString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 처방 수정/종료 ──

export class UpdateDialysisOrderDto {
  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '종료일' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '투석 빈도' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ description: '투석 시간 (분)' })
  @IsOptional()
  @IsNumber() @Min(30) @Max(600)
  duration?: number;

  @ApiPropertyOptional({ description: '건체중 (kg)' })
  @IsOptional()
  @IsNumber() @Min(20) @Max(300)
  dryWeight?: number;

  @ApiPropertyOptional({ description: 'UF 목표 (mL)' })
  @IsOptional()
  @IsNumber() @Min(0) @Max(6000)
  ufGoal?: number;

  @ApiPropertyOptional({ description: '항응고제' })
  @IsOptional()
  @IsString()
  anticoagulant?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 월간 세션 자동 생성 ──

export class GenerateSessionsDto {
  @ApiProperty({ description: '처방 ID' })
  @IsUUID()
  orderId: string;

  @ApiProperty({ description: '연도' })
  @IsNumber()
  year: number;

  @ApiProperty({ description: '월' })
  @IsNumber()
  month: number;
}

// ── 투석 시작 ──

export class StartSessionDto {
  // 세션 체중은 UF·Kt/V 안전계산의 입력 — 임상 경계로 음수/비현실값(제수 계산 오염) 차단.
  @ApiPropertyOptional({ description: '전 체중 (kg)' })
  @IsOptional()
  @IsNumber() @Min(20) @Max(300)
  preWeight?: number;

  @ApiPropertyOptional({ description: '전 체온' })
  @IsOptional()
  @IsNumber()
  preTemp?: number;

  @ApiPropertyOptional({ description: '전 혈압' })
  @IsOptional()
  @IsString()
  preBp?: string;

  @ApiPropertyOptional({ description: '전 심박수' })
  @IsOptional()
  @IsNumber()
  preHr?: number;

  @ApiPropertyOptional({ description: '투석기 ID' })
  @IsOptional()
  @IsString()
  machineId?: string;

  @ApiPropertyOptional({ description: '근무교대' })
  @IsOptional()
  @IsString()
  shift?: string;

  @ApiPropertyOptional({ description: '간호사 ID' })
  @IsOptional()
  @IsString()
  nurseId?: string;
}

// ── 투석 중 활력징후 ──

export class AddIntradialyticVitalsDto {
  @ApiPropertyOptional({ description: '혈압' })
  @IsOptional()
  @IsString()
  bp?: string;

  @ApiPropertyOptional({ description: '심박수' })
  @IsOptional()
  @IsNumber()
  hr?: number;

  @ApiPropertyOptional({ description: 'UF 속도' })
  @IsOptional()
  @IsNumber()
  ufRate?: number;

  @ApiPropertyOptional({ description: '정맥압' })
  @IsOptional()
  @IsNumber()
  venousPressure?: number;

  @ApiPropertyOptional({ description: '동맥압' })
  @IsOptional()
  @IsNumber()
  arterialPressure?: number;

  @ApiPropertyOptional({ description: 'TMP' })
  @IsOptional()
  @IsNumber()
  tmpPressure?: number;
}

// ── 투석 완료 ──

export class CompleteSessionDto {
  @ApiPropertyOptional({ description: '후 체중 (kg)' })
  @IsOptional()
  @IsNumber() @Min(20) @Max(300)
  postWeight?: number;

  @ApiPropertyOptional({ description: '후 체온' })
  @IsOptional()
  @IsNumber()
  postTemp?: number;

  @ApiPropertyOptional({ description: '후 혈압' })
  @IsOptional()
  @IsString()
  postBp?: string;

  @ApiPropertyOptional({ description: '후 심박수' })
  @IsOptional()
  @IsNumber()
  postHr?: number;

  @ApiPropertyOptional({ description: '실제 UF량 (mL)' })
  @IsOptional()
  @IsNumber() @Min(0) @Max(8000)
  actualUf?: number;

  @ApiPropertyOptional({ description: '실제 투석 시간 (분)' })
  @IsOptional()
  @IsNumber()
  actualDuration?: number;

  // 🔴 화면(투석 완료 폼)은 Kt/V 를 입력받는데 DTO 에 없어 whitelist 가 버렸고,
  //    서버는 그 자리를 **비진단 근사식**으로 덮었다 — 간호사가 장비에서 읽은 실측이 사라졌다.
  @ApiPropertyOptional({ description: '실측 Kt/V (장비·검사 산출값)' })
  @IsOptional()
  @IsNumber() @Min(0) @Max(10)
  ktV?: number;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 합병증 기록 ──

export class AddComplicationDto {
  @ApiProperty({ description: '합병증 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '발생 시간' })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiPropertyOptional({ description: '조치' })
  @IsOptional()
  @IsString()
  action?: string;
}

// ── 투석기 등록 ──

export class CreateMachineDto {
  @ApiProperty({ description: '투석기 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '모델' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '일련번호' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiProperty({ description: '투석기 유형' })
  @IsString()
  @IsNotEmpty()
  machineType: string;

  @ApiPropertyOptional({ description: '위치' })
  @IsOptional()
  @IsString()
  location?: string;
}

// ── 투석기 상태 변경 ──

export class UpdateMachineStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;
}
