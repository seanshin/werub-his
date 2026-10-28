import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString,
  MaxLength, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * RCA(근본원인분석) 입력 DTO.
 *
 * 🔴 종전 컨트롤러는 `@Body() body: Record<string, unknown>` 이었다. 런타임 metatype 이
 *    `Object` 라 **ValidationPipe 가 통째로 스킵**된다(v4.3.0 에서 처방 EP 가 같은 이유로
 *    개통 이래 한 번도 검증되지 않았던 것과 동일 결함). 검증도 없고, 전역 `whitelist: true` 도
 *    작동하지 않아 무엇이든 들어왔다.
 *
 * 🔴 그리고 반대 함정: DTO 를 만들면 **DTO 에 없는 키는 whitelist 가 조용히 지운다.**
 *    그래서 화면이 실제로 보내는 키(findings·contributingFactors·actionPlan·status·dueAt·owner)를
 *    빠짐없이 선언한다. FE↔DTO 는 기계 대조(계약 테스트)로만 잡힌다.
 */
export class RcaActionItemDto {
  @ApiProperty({ description: '개선 조치' })
  @IsString()
  @MaxLength(500)
  action: string;

  @ApiPropertyOptional({ description: '담당(부서·직위)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  owner?: string;

  @ApiPropertyOptional({ description: '기한 표기(예: 30일·2026-09-30)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  due?: string;
}

export class UpsertRcaDto {
  @ApiPropertyOptional({ description: '근본원인(findings)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  findings?: string;

  /** 🔴 기여요인은 **사람이 쓰는 것**이다 — 화면에 입력 경로가 없어 시드 5건만 있었다. */
  @ApiPropertyOptional({ description: '기여요인(문자열 배열)', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  contributingFactors?: string[];

  @ApiPropertyOptional({ description: '개선계획', type: [RcaActionItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RcaActionItemDto)
  actionPlan?: RcaActionItemDto[];

  /**
   * 🔴 `APPROVED` 는 받지 않는다 — 승인은 전용 EP(`POST .../rca/approve`)만이 할 수 있다.
   *    종전엔 이 PATCH 로 `status:'APPROVED'` 를 넣을 수 있었고, 그러면 `approvedBy`·`approvedAt`
   *    이 비고 `SafetyIncident.rcaCompleted` 도 그대로라 **승인자 없는 승인**이 만들어졌다
   *    (화면은 '승인완료'로 보이는데 사건은 RCA 미완료 — 같은 사실에 정본이 둘·P12).
   */
  @ApiPropertyOptional({ description: 'RCA 상태(승인은 전용 EP)', enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'COMPLETED'])
  status?: string;

  @ApiPropertyOptional({ description: '완료 기한(ISO)' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'RCA 책임자 userId' })
  @IsOptional()
  @IsString()
  owner?: string;
}
