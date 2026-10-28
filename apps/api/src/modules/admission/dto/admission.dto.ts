import { IsString, IsOptional, IsUUID, IsDateString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 전과(담당의 변경) — `interface`/인라인 `@Body(){...}` → class 승격(2026-09-01 유효-바디 프로브).
 *    종전엔 인라인 리터럴이라 ValidationPipe 스킵 → 빈 바디의 `newDoctorId=undefined` 가
 *    `user.findUnique({where:{id:undefined}})` 로 들어가 **500**(서비스의 "사유 필수" 검사보다 먼저
 *    크래시). summary 는 "사유 필수"라 적혔지만 인라인이라 그 필수가 강제된 적이 없었다 — 이제 400.
 */
export class TransferCareDto {
  @ApiProperty({ description: '전과 대상 담당의(ATTENDING) ID' })
  @IsUUID('4', { message: '전과 대상 의사를 선택하세요' })
  newDoctorId!: string;

  // 🔴 (2026-09-15 U4) 종전 MaxLength(500) 인데 서비스가 ChargeOfCare.reason VarChar(200) 에 맞춰 slice 로 잘랐다(201~500자 조용히 소실).
  //    해제 행에는 '[전과] ' 접두(5자)가 붙어 같은 200 에 들어가므로 195 로 400 을 낸다.
  @ApiProperty({ description: '전과 사유(필수·195자 이내)' })
  @IsString() @IsNotEmpty({ message: '전과 사유를 입력하세요' }) @MaxLength(195, { message: '전과 사유는 195자 이내로 입력하세요' })
  reason!: string;

  @ApiPropertyOptional({ description: '인계 노트' })
  @IsOptional() @IsString() @MaxLength(2000)
  handoffNote?: string;
}

export class CreateAdmissionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '병상 ID' })
  @IsUUID()
  bedId: string;

  @ApiProperty({ description: '담당 의사 ID' })
  @IsUUID()
  admittingDoctorId: string;

  @ApiProperty({ description: '입원 날짜' })
  @IsDateString()
  admitDate: string;

  @ApiPropertyOptional({ description: '입원 사유' })
  @IsOptional()
  @IsString()
  admitReason?: string;

  @ApiPropertyOptional({ description: '식이 타입' })
  @IsOptional()
  @IsString()
  dietType?: string;
}

export class DischargeAdmissionDto {
  @ApiProperty({ description: '퇴원 날짜' })
  @IsDateString()
  dischargeDate: string;

  @ApiPropertyOptional({ description: '퇴원 요약' })
  @IsOptional()
  @IsString()
  dischargeSummary?: string;
}

export class TransferBedDto {
  @ApiProperty({ description: '새로운 병상 ID' })
  @IsUUID()
  newBedId: string;

  @ApiPropertyOptional({ description: '전동 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateAdmissionDto {
  @ApiPropertyOptional({ description: '식이 타입' })
  @IsOptional()
  @IsString()
  dietType?: string;

  @ApiPropertyOptional({ description: '담당 의사 ID' })
  @IsOptional()
  @IsUUID()
  attendingDoctorId?: string;
}
