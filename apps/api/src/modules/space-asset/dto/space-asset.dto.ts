import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { ASSET_KINDS, PLACEMENT_SOURCES } from '@hospital-run/shared';

/** 원장으로 배치할 수 있는 출처 — NATIVE 는 자산 테이블 자체 값이라 사람이 보낼 수 없다 */
const WRITABLE_SOURCES = PLACEMENT_SOURCES.filter((s) => s !== 'NATIVE');

export class PlaceAssetDto {
  @ApiProperty({ enum: ASSET_KINDS })
  @IsIn([...ASSET_KINDS])
  kind!: (typeof ASSET_KINDS)[number];

  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'SpaceNode id(층·구역)' })
  @IsUUID()
  spaceNodeId!: string;

  @ApiPropertyOptional({ description: '층 좌표계 x(m) — 도면 확정 구역에서만. y 와 함께' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-1000)
  @Max(1000)
  x?: number;

  @ApiPropertyOptional({ description: '층 좌표계 y(m)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-1000)
  @Max(1000)
  y?: number;

  /** 출처는 호출자가 밝힌다 — 서버가 'MANUAL' 을 채우면 가져오기 도구가 빠뜨린 건이 직원 입력으로 남는다 */
  @ApiProperty({ enum: WRITABLE_SOURCES })
  @IsIn(WRITABLE_SOURCES)
  source!: (typeof WRITABLE_SOURCES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

export class EndPlacementDto {
  @ApiProperty({ description: '종료 사유(철거·반출·폐기 등) — 필수' })
  @IsString()
  @Length(2, 300)
  reason!: string;
}

export class SetClinicRoomDto {
  @ApiProperty({ description: '진료실 이름 원문(ClinicSchedule.roomName)' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ nullable: true, description: 'SpaceNode id · null=연결 해제' })
  @ValidateIf((o) => o.spaceNodeId !== null)
  @IsUUID()
  spaceNodeId!: string | null;
}

/** 병상 ↔ 공간 연결(2026-10-02) — spaceNodeId=null 이면 해제 */
export class SetBedLinkDto {
  @ApiProperty({ type: [String], description: '병상 id(1~200)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  bedIds!: string[];

  @ApiProperty({ nullable: true, description: 'SpaceNode id · null=연결 해제' })
  @ValidateIf((o) => o.spaceNodeId !== null)
  @IsUUID()
  spaceNodeId!: string | null;
}
