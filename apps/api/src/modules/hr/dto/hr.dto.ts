import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsDateString, IsEnum, IsArray, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffCategory } from '@prisma/client';

// ── 직원 등록 ──

export class CreateStaffDto {
  @ApiProperty({ description: '사번' })
  @IsString()
  @IsNotEmpty()
  employeeNumber: string;

  @ApiProperty({ description: '성' })
  @IsString()
  @IsNotEmpty()
  familyName: string;

  @ApiProperty({ description: '이름' })
  @IsString()
  @IsNotEmpty()
  givenName: string;

  @ApiProperty({ enum: StaffCategory, description: '직종 (MEDICAL, NURSING, TECHNICAL, ADMIN, SUPPORT)' })
  @IsEnum(StaffCategory)
  category: StaffCategory;

  @ApiProperty({ description: '부서' })
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiProperty({ description: '직위' })
  @IsString()
  @IsNotEmpty()
  position: string;

  @ApiProperty({ description: '입사일' })
  @IsDateString()
  hireDate: string;

  @ApiPropertyOptional({ description: '면허번호' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ description: '전공' })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ description: '전화번호' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '이메일' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: '사용자 ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// ── 직원 수정 ──

export class UpdateStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specialty?: string;
}

// ── 직원 부분 수정 (Clinic 연동용) ──

export class PatchStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specialty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() licenseNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clinicUserId?: string;
}

// ── 근무 스케줄 등록 ──

export class SetScheduleDto {
  @ApiProperty({ description: '직원 ID' })
  @IsUUID()
  staffId: string;

  @ApiProperty({ description: '스케줄 목록' })
  @IsArray()
  schedules: { date: string; shiftType: string; startTime?: string; endTime?: string }[];
}

// ── 보고라인·재직상태 (2026-09-15 B4 — 종전 인라인 타입) ──

const present = (_: object, v: unknown) => v !== '' && v !== null && v !== undefined;

export class SetStaffManagerDto {
  /** `null`·'' = 해제(서비스). 값이 있으면 Staff id(`@db.Uuid` — 비 uuid 는 Prisma 500 이었다) */
  @ApiPropertyOptional({ nullable: true, description: '상급자 Staff id — null 이면 해제' })
  @ValidateIf(present)
  @IsUUID()
  managerStaffId?: string | null;
}

export class ChangeStaffStatusDto {
  /** 어휘는 서비스가 `EmploymentStatus` 정본으로 대조한다(여기서 두 번 적지 않는다) */
  @ApiProperty({ description: '재직상태(EmploymentStatus)' })
  @IsString()
  status: string;

  @ApiPropertyOptional({ description: '적용일(ERP 이벤트 statusEffectiveFrom)', example: '2026-10-01' })
  @ValidateIf(present)
  @IsDateString()
  effectiveDate?: string;
}
