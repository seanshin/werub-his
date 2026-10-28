import { IsIn, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INTRAOP_EVENT_KINDS, INTRAOP_PHASE_STAMPS, OR_DEVICE_PROFILES, OR_ROLES } from '@hospital-run/shared';

/** 수술 중 기록 한 줄 — 값 검사는 shared checkIntraopPayload(종류별 필수 칸·기록 가능 범위) */
export class AddIntraopEventDto {
  @ApiProperty({ enum: [...INTRAOP_EVENT_KINDS] })
  @IsIn([...INTRAOP_EVENT_KINDS])
  kind: string;

  @ApiProperty({ description: '종류별 값(활력·약물·수액·혈액·배출·사건·메모)' })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ description: '발생 시각(비우면 지금 · 넣으면 USER_CLAIMED)' })
  @IsOptional() @IsISO8601()
  occurredAt?: string;
}

export class VoidIntraopEventDto {
  @ApiProperty({ description: '무효 사유' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class StampIntraopPhaseDto {
  @ApiProperty({ enum: [...INTRAOP_PHASE_STAMPS] })
  @IsIn([...INTRAOP_PHASE_STAMPS])
  phase: string;

  @ApiPropertyOptional({ description: '시각(비우면 지금)' })
  @IsOptional() @IsISO8601()
  at?: string;
}

export class SaveOrChartLayoutDto {
  @ApiProperty({ enum: [...OR_DEVICE_PROFILES] })
  @IsIn([...OR_DEVICE_PROFILES])
  profile: string;

  @ApiProperty({ enum: [...OR_ROLES] })
  @IsIn([...OR_ROLES])
  role: string;

  @ApiProperty({ description: '{ screens: [{ panels: string[], columns: 1|2|3 }] } — shared normalizeOrLayout 로 정규화' })
  @IsObject()
  layout: Record<string, unknown>;
}

export class SetCirculatingDto {
  @ApiProperty({ enum: ['TAKE', 'RELEASE'], description: 'TAKE=내가 맡기(교대 포함) · RELEASE=내려놓기(본인·관리자)' })
  @IsIn(['TAKE', 'RELEASE'])
  action: 'TAKE' | 'RELEASE';
}
