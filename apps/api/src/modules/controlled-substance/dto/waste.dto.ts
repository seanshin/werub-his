import { IsString, IsOptional, IsNotEmpty, IsNumber, IsUUID, IsIn, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 마약류 폐기(2인 무결성) — 화면 실사용 점검 W8(2026-08-14).
 *
 * 🔴 종전: 화면이 `{ reason, witness(성명 문자열) }` 를 보내는데 컨트롤러는 `@Body('witnessId')`
 *    를 읽어 **개통 이래 100% `폐기 시 증인이 필요합니다`** 로 실패했다(P11 FE↔서버 계약 불일치).
 *    성명 문자열이 그대로 닿았더라도 `wasteWitness` 는 @db.Uuid 라 P2023 이었고,
 *    `witnessId === wastedById` 2인 비교도 무력화됐다.
 *
 * 🔴 인라인 `@Body('x')` 는 ValidationPipe 를 건너뛴다 → DTO 클래스로 받는다.
 */
export class RecordWasteDto {
  @ApiProperty({ description: '폐기 사유' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  reason: string;

  @ApiProperty({ description: '폐기 입회자(증인) — **User.id**. 성명 문자열이 아니다.' })
  @IsUUID()
  witnessId: string;

  @ApiPropertyOptional({ description: '폐기 잔량(앰플 부분사용)' })
  @IsOptional() @IsNumber() @Min(0) @Max(1000000)
  wastedQty?: number;
}

/** 사고마약류 보고(§12 도난·분실·파손·재해) */
export class ReportIncidentDto {
  @ApiPropertyOptional({ description: '관련 마약류 원장 ID' })
  @IsOptional() @IsUUID()
  logId?: string;

  @ApiProperty({ description: '사고 유형', enum: ['THEFT', 'LOSS', 'DAMAGE', 'DISASTER'] })
  @IsIn(['THEFT', 'LOSS', 'DAMAGE', 'DISASTER'])
  incidentType: string;

  @ApiProperty({ description: '약품명' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  drugName: string;

  @ApiPropertyOptional({ description: '약품 코드' })
  @IsOptional() @IsString() @MaxLength(30)
  drugCode?: string;

  @ApiProperty({ description: '수량' })
  @IsNumber() @Min(0) @Max(1000000)
  quantity: number;

  @ApiProperty({ description: '단위' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  unit: string;

  @ApiProperty({ description: '발생일시(YYYY-MM-DD 또는 ISO)' })
  @IsString() @IsNotEmpty()
  occurredAt: string;

  @ApiProperty({ description: '경위' })
  @IsString() @IsNotEmpty()
  description: string;
}

/** 사고마약류 관할 신고 **기록**(전송 아님 — 사람이 신고한 사실을 적는다) */
export class FileIncidentDto {
  @ApiPropertyOptional({ description: '관할 관청 접수번호' })
  @IsOptional() @IsString() @MaxLength(60)
  filedRef?: string;

  @ApiPropertyOptional({ description: '신고 시각(미지정=지금)' })
  @IsOptional() @IsString()
  filedAt?: string;
}

/**
 * NIMS **수기 접수번호 기록** — 담당자가 NIMS 웹에 배치파일을 올리고 받은 실제 접수번호.
 * 연동이 없는 동안 '도달했다'고 말할 수 있는 유일한 근거다.
 */
export class RecordNimsAckDto {
  @ApiProperty({ description: 'NIMS 가 발급한 접수번호(원내 배치번호 아님)' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  nimsRefNo: string;

  @ApiPropertyOptional({ description: '접수 시각(미지정=지금)' })
  @IsOptional() @IsString()
  submittedAt?: string;

  @ApiPropertyOptional({ description: '비고' })
  @IsOptional() @IsString() @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ description: '배치 단위로 닫을 때의 원내 배치번호(LOCAL-NIMS-…)' })
  @IsOptional() @IsString() @MaxLength(50)
  batchNo?: string;
}

/**
 * 마약류 투약량 — 인라인 `@Body('administeredQty')` 는 ValidationPipe 를 건너뛰어
 * **음수·비수치**가 그대로 닿았다(2026-09-01). 서비스는 상한(> 불출량)만 봤을 뿐 하한/타입이 없어
 * 음수 투여량이 원장에 저장되고 NIMS(마약류통합관리) 보고에 음수로 나갈 수 있었다.
 * 문자열이면 @db.Decimal 이 P2023 으로 터져 투약 자체가 500 이 되기도 했다.
 */
export class AdministerControlledSubstanceDto {
  @ApiPropertyOptional({ description: '실제 투여량(생략 시 불출량 전량) — 0 초과, 불출량 이하' })
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000000)
  administeredQty?: number;
}
