import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AI_PROPOSAL_KINDS, AI_PROPOSAL_STATUSES } from '@hospital-run/shared';

/**
 * 🔴 DTO 는 **class** 여야 한다 — interface·교차 타입·`Partial<>` 은 런타임 metatype 이 `Object` 라
 *    ValidationPipe 가 통째로 스킵된다(2026-09-01 실측: 그렇게 검증이 새던 @Body 14개).
 * 🔴 kind/status 어휘 정본은 shared 하나다(여기에 목록을 다시 적으면 갈라진다).
 * 🔴 전역 `whitelist:true` 는 DTO 에 없는 키를 **조용히 지운다** — 새 필터를 추가할 때
 *    FE 쿼리 키와 이 클래스를 함께 고친다(한쪽만 고치면 성공 응답+필터 소실이 된다).
 */

const DAYS = [7, 30, 90];

export class AiOversightSummaryQueryDto {
  @ApiPropertyOptional({ enum: DAYS, default: 7, description: '조회 기간(일) — 7·30·90 만' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(DAYS)
  days?: number;

  @ApiPropertyOptional({ enum: AI_PROPOSAL_KINDS as unknown as string[] })
  @IsOptional()
  @IsIn(AI_PROPOSAL_KINDS as unknown as string[])
  kind?: string;

  @ApiPropertyOptional({ description: '부서명(Staff.department) — 계정 미연결 직원은 셀 수 없다(응답이 그 사실을 말한다)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dept?: string;

  @ApiPropertyOptional({ description: '결정자(User.id)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: '상류가 보고한 모델 태그' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modelRef?: string;
}

export class AiOversightProposalQueryDto extends AiOversightSummaryQueryDto {
  @ApiPropertyOptional({ enum: AI_PROPOSAL_STATUSES as unknown as string[] })
  @IsOptional()
  @IsIn(AI_PROPOSAL_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AiOversightCallsQueryDto {
  @ApiPropertyOptional({ enum: DAYS, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(DAYS)
  days?: number;
}

export class AiOversightExportQueryDto {
  /**
   * 🔴 형식 검증만 여기서 하고, 구간 조립은 정본 `dayRange` 가 한다(끝나는 날 포함).
   *    파싱 실패는 500 이 아니라 400 이어야 한다 — 사용자가 자기 입력 문제인 줄 알게.
   */
  @ApiPropertyOptional({ description: '시작일 YYYY-MM-DD(생략 시 하한 없음)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  from?: string;

  @ApiPropertyOptional({ description: '종료일 YYYY-MM-DD(그 날 포함 · 생략 시 상한 없음)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  to?: string;
}
