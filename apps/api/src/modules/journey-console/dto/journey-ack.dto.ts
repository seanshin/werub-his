import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, Length } from 'class-validator';
import { ALL_JOURNEY_STAGE_KEYS } from '@hospital-run/shared';

/**
 * 🔴 인라인 `@Body` 를 쓰지 않는다 — 교차 타입·인터페이스·인라인은 ValidationPipe 가 통째로 스킵된다.
 */
export class JourneyAckDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;

  @ApiProperty({ enum: ['OPD', 'IPD', 'ER'] })
  @IsIn(['OPD', 'IPD', 'ER'])
  track!: string;

  @ApiProperty({ enum: ALL_JOURNEY_STAGE_KEYS })
  @IsIn(ALL_JOURNEY_STAGE_KEYS)
  stage!: string;

  @ApiProperty({ description: '확인 당시의 지연 플래그' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  flags!: string[];

  @ApiProperty({ description: '무엇을 확인·조치했는가 — 비어 있으면 확인이 아니다' })
  @IsString()
  @Length(2, 300)
  note!: string;
}
