import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, ArrayNotEmpty, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 🔴 검사결과 입력 — 인라인 `@Body(){ items:[...] }` → class 승격(2026-09-01 유효-바디 프로브).
 *    종전엔 인라인 리터럴이라 ValidationPipe 스킵 → 빈/오염 바디의 `items` 가 undefined 로
 *    오더 로드·상태 가드를 지나 `items.map(...)` 에서 **TypeError → 검사기사에게 500**
 *    (`workstation.service.completeLabResult`). 검사 항목을 안 담고 제출하면 자기 입력 문제인데
 *    서버 오류로 읽힌다 — 이제 400. 유효 오더 id 라야 도달하던 자리라 빈-바디 프로브(404)가 가렸다.
 */
export class LabResultItemDto {
  @IsString() @IsNotEmpty({ message: '검사 항목명을 입력하세요' }) @MaxLength(200)
  name!: string;

  @IsString() @IsNotEmpty({ message: '결과값을 입력하세요' }) @MaxLength(200)
  value!: string;

  @IsOptional() @IsString() @MaxLength(50)
  unit?: string;

  @IsOptional() @IsString() @MaxLength(100)
  refRange?: string;

  @IsOptional() @IsString() @MaxLength(50)
  finding?: string;
}

export class CompleteLabResultDto {
  @IsArray() @ArrayNotEmpty({ message: '검사 항목을 하나 이상 입력하세요' })
  @ValidateNested({ each: true }) @Type(() => LabResultItemDto)
  items!: LabResultItemDto[];

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
