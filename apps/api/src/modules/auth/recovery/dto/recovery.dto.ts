import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class RecoveryRequestDto {
  @IsString()
  identifier!: string; // 이메일/사번

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RecoveryApproveDto {
  @IsOptional()
  @IsString()
  secondApproverId?: string; // 2차 승인(부서장 등)

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minutes?: number; // 복구 토큰 유효(기본 15)
}

export class RecoveryCompleteDto {
  @IsString()
  requestId!: string;

  @IsString()
  recoveryToken!: string;
}
