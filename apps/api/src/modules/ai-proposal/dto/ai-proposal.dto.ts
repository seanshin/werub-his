import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_PROPOSAL_DECISIONS,
  AI_PROPOSAL_KINDS,
  AI_PROPOSAL_STATUSES,
} from '@hospital-run/shared';

/**
 * 🔴 DTO 는 **class** 여야 한다 — interface·교차 타입·`Partial<>` 은 런타임 metatype 이 `Object` 라
 *    ValidationPipe 가 통째로 스킵된다(2026-09-01 실측: 그렇게 검증이 새던 @Body 14개).
 * 🔴 kind/status 어휘 정본은 shared 하나다(여기에 목록을 다시 적으면 갈라진다).
 */

export class MarkPresentedDto {
  @ApiPropertyOptional({ description: '어느 화면에서 노출됐는가(모르면 생략 — 지어내지 않는다)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientContext?: string;
}

export class DecideAiProposalDto {
  @ApiProperty({ enum: AI_PROPOSAL_DECISIONS as unknown as string[] })
  @IsIn(AI_PROPOSAL_DECISIONS as unknown as string[])
  decision!: 'ACCEPTED' | 'EDITED' | 'REJECTED';

  /**
   * 🔴 편집거리 측정용 최종본. **저장하지 않는다** — 최종 본문의 정본은 도메인 정본 테이블이다.
   *    주지 않으면 편집거리는 `null`(미측정)이며 0 으로 채우지 않는다.
   */
  @ApiPropertyOptional({ description: '최종본(편집거리 측정용 · 저장하지 않음)' })
  @IsOptional()
  @IsString()
  finalText?: string;

  /** 🔴 거부 사유는 **선택**이다 — 필수로 강제하면 아무 값이나 골라 거짓 사유가 쌓인다 */
  @ApiPropertyOptional({ description: '사유(선택 — 강제하지 않는다)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientContext?: string;
}

export class ListAiProposalQueryDto {
  @ApiPropertyOptional({ enum: AI_PROPOSAL_KINDS as unknown as string[] })
  @IsOptional()
  @IsIn(AI_PROPOSAL_KINDS as unknown as string[])
  kind?: string;

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
