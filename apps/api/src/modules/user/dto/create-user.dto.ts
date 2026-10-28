import { IsEmail, IsString, MinLength, IsEnum, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CLINICAL_PROFESSIONS } from '@hospital-run/shared';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

export class CreateUserDto {
  @ApiProperty({ example: 'newdoctor@hospitalrun.example' })
  @IsEmail()
  email: string;

  @ApiProperty({ required: false, description: '비우면 서버가 일회용 임의 비밀번호를 발급해 응답 issuedPassword 로 1회 반환' })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password?: string;

  @ApiProperty({ example: '박' })
  @IsString()
  familyName: string;

  @ApiProperty({ example: '의사' })
  @IsString()
  givenName: string;

  @ApiProperty({ enum: UserRole, example: 'DOCTOR' })
  @IsEnum(UserRole)
  role: UserRole;

  // 🔴 (2026-09-15 T2) 직원 등록 화면(createStaffSchema)이 보내고 서비스가 저장하는 두 필드 — 종전 컨트롤러가
  //    `Record<string, unknown>` 로 받아 이 DTO 를 안 탔다. DTO 로 옮기며 빠뜨리면 whitelist 가 조용히 지운다.
  //    길이는 User 스키마 VarChar(50)·VarChar(100).
  @ApiProperty({ required: false, example: '내과' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string;

  @ApiProperty({ required: false, example: '순환기' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;

  /**
   * 직종(오더 입력 범위) — shared CLINICAL_PROFESSIONS. null 이면 해제(역할 기본 직종).
   * 역할과 맞는지(PROFESSION_ROLE)는 서비스가 검사한다 — 맞지 않으면 400.
   */
  @ApiProperty({ required: false, nullable: true, enum: CLINICAL_PROFESSIONS })
  @IsOptional()
  @IsIn([...CLINICAL_PROFESSIONS])
  profession?: string | null;
}
