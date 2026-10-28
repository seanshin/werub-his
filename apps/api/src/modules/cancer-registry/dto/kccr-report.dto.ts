import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * KCCR 제출 자료 생성 요청.
 *
 * 🔴 ids 는 **필수**다. 비면 서버가 전건(미보고 VERIFIED 전체)으로 확대해
 * 선택하지 않은 건까지 되돌릴 수 없게 봉인하던 결함이 있었다 → fail-closed.
 * 🔴 인라인 @Body 는 ValidationPipe 를 건너뛰므로 반드시 DTO 클래스로 받는다.
 */
export class GenerateKccrReportDto {
  @ApiProperty({
    description: '보고 대상 암등록 ID 목록 (비어 있으면 400 — 전건 확대 금지)',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: '보고 대상(ids)이 비어 있습니다 — 전건 보고는 허용되지 않습니다' })
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    description:
      "true 인 경우에만 대상 건을 '보고 대상 확정(미전송)' 으로 표시한다. " +
      '중앙암등록본부 전송 연동은 없으므로 어떤 경우에도 전송은 일어나지 않는다.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
