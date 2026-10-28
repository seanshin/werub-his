import { IsOptional, IsString, IsEnum, IsDateString, IsInt, IsIn, Matches, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';

export class PatientQueryDto {
  @ApiPropertyOptional({ description: '이름/MRN 통합 검색' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'MRN 정확 검색' })
  @IsOptional()
  @IsString()
  mrn?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: '보험 유형(NHI|MEDICAID|INDUSTRIAL|AUTO|SELF_PAY)' })
  @IsOptional()
  @IsString()
  insuranceType?: string;

  @ApiPropertyOptional({ description: '상태(active|inactive|deceased)' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'deceased'])
  status?: string;

  @ApiPropertyOptional({ description: '태그(콤마 구분 — 전부 보유 AND)' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({ description: "원내 상태 — 'onsite'(전체) 또는 콤마 목록(admitted,waiting,called,in_consult,cashier,pharmacy,drafting)" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_,]{1,120}$/, { message: 'presence 는 소문자 상태 키의 콤마 목록이어야 합니다' })
  presence?: string;

  @ApiPropertyOptional({ description: '범위 — mine=내 환자(최근 30일 내 진료·내 담당 입원·오늘 내 예약 · 2026-10-20)' })
  @IsOptional()
  @IsIn(['mine'])
  scope?: 'mine';

  @ApiPropertyOptional({ description: '고른 환자 id(콤마 · 최대 100) — 선택 행 일괄 반출(2026-10-20 P4 B9)' })
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,99}$/i, { message: 'ids 는 환자 id(UUID) 콤마 목록 · 최대 100' })
  ids?: string;

  @ApiPropertyOptional({ description: '환자 구분 — Y=외국인만·N=내국인만' })
  @IsOptional()
  @IsIn(['Y', 'N'])
  foreigner?: string;

  @ApiPropertyOptional({ description: '국적 코드(예 USA·MNG — 외국인 세부)' })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({ description: '선호 언어(예 en·mn)' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: '품질 드릴다운(대시보드 카드 → 워크리스트)' })
  @IsOptional()
  @IsIn(['noPhone', 'noInsurance', 'noAddress', 'noPhoto', 'dormant', 'dupSuspect', 'nationalitySuspect', 'passportExpiring'])
  quality?: string;

  @ApiPropertyOptional({ description: '생년월일 시작', example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  dobFrom?: string;

  @ApiPropertyOptional({ description: '생년월일 종료', example: '2000-12-31' })
  @IsOptional()
  @IsDateString()
  dobTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 'familyName', description: '정렬 필드' })
  @IsOptional()
  @IsString()
  sort?: string = 'familyName';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  // 🔴 리터럴 유니온 타입은 런타임 검증이 아니다 — @IsIn 없이는 ?order=bogus 가
  //    Prisma orderBy 로 직행해 PrismaClientValidationError → 500(운영 실측).
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';
}
