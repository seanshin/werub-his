import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class BreakGlassGrantDto {
  @IsString()
  staffUserId!: string; // 인증 불가 상태의 대상 직원

  @IsString()
  reason!: string; // 사유(필수)

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minutes?: number; // 임시 접근 유효(기본 30, 최대 120)

  @IsOptional()
  @IsString()
  secondApproverId?: string; // 2인 승인 시
}

export class BreakGlassReviewDto {
  @IsOptional()
  @IsString()
  note?: string;
}
