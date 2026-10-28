import {
  IsString, IsOptional, IsNotEmpty, IsUUID, IsObject, IsIn, Validate,
  ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  UNIVERSAL_NURSING_CONTEXT_TYPES,
  UNIVERSAL_NURSING_NOTE_TYPES,
  UNIVERSAL_NURSING_SEVERITIES,
  ADMISSION_SCOPED_NURSING_CONTEXT_TYPES,
  ADMISSION_SCOPED_NURSING_HINT,
  hasUniversalNursingBody, NURSING_SHIFTS,
} from '@hospital-run/shared';

/**
 * 🔴 `contextType` 은 **정본 경계**다 — 자유 문자열이면 입원 기록이 universal 로 새고,
 *    그렇게 샌 기록은 서명·QA·미비기록·사본발급을 전부 우회한다(`127faa58` 에서 한 번 되돌렸다).
 *    허용값 정본은 `@hospital-run/shared` — 화면·시드·DTO 가 같은 목록을 본다.
 */
function contextTypeMessage(args: ValidationArguments): string {
  const v = String((args.object as Record<string, unknown>)?.contextType ?? '');
  if ((ADMISSION_SCOPED_NURSING_CONTEXT_TYPES as readonly string[]).includes(v)) {
    return `contextType='${v}' 은 범용 간호기록에 쓸 수 없습니다. ${ADMISSION_SCOPED_NURSING_HINT}`;
  }
  return `contextType 은 ${UNIVERSAL_NURSING_CONTEXT_TYPES.join(' | ')} 중 하나여야 합니다.`;
}

/**
 * 🔴 본문이 비어 있으면 기록이 아니다.
 * 화면이 DTO 에 없는 키(`spiSituation`…)로 보내던 시절, 전역 `whitelist:true` 가 그 키를 조용히 지워
 * **본문 없는 빈 행**이 200 과 함께 저장될 수 있었다. 그 소실을 여기서 막는다.
 */
@ValidatorConstraint({ name: 'universalNursingBody', async: false })
export class HasNursingBodyConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return hasUniversalNursingBody(args.object as Record<string, string | undefined>);
  }
  defaultMessage(): string {
    return '간호기록 본문이 비었습니다 — content 또는 SBAR(situation·background·assessment·recommendation) 중 최소 한 칸을 채우세요. '
      + '(화면이 DTO 에 없는 키로 보내면 whitelist 가 조용히 지웁니다)';
  }
}

export class CreateNursingNoteDto {
  @ApiProperty() @IsUUID() patientId: string;

  @ApiProperty({ enum: UNIVERSAL_NURSING_CONTEXT_TYPES })
  @IsIn(UNIVERSAL_NURSING_CONTEXT_TYPES, { message: contextTypeMessage })
  contextType: string;

  @ApiProperty() @IsUUID() contextId: string;

  @ApiProperty({ enum: UNIVERSAL_NURSING_NOTE_TYPES })
  @IsIn(UNIVERSAL_NURSING_NOTE_TYPES)
  noteType: string;

  @ApiPropertyOptional() @IsOptional() @IsString() situation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() background?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() recommendation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;

  /**
   * 본문 존재 검증 앵커 — 값을 보내지 않는다.
   * 🔴 `@IsOptional()` 은 값이 없으면 그 속성의 검증을 **통째로 건너뛴다**. 본문 검사를 `content` 에
   *    붙이면 SBAR-만-보낸 페이로드(=content 부재)에서 검사가 아예 안 돈다 — 정확히 막아야 할 그 경우다.
   *    그래서 항상 도는 별도 속성에 건다.
   */
  @Validate(HasNursingBodyConstraint)
  readonly bodyPresence?: never;

  @ApiPropertyOptional() @IsOptional() @IsObject() vitalSigns?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: UNIVERSAL_NURSING_SEVERITIES }) @IsOptional() @IsIn(UNIVERSAL_NURSING_SEVERITIES) severity?: string;
  @ApiPropertyOptional({ enum: NURSING_SHIFTS }) @IsOptional() @IsIn(NURSING_SHIFTS) shiftType?: string;
}

export class UpdateNursingNoteDto {
  @ApiPropertyOptional({ enum: UNIVERSAL_NURSING_CONTEXT_TYPES })
  @IsOptional() @IsIn(UNIVERSAL_NURSING_CONTEXT_TYPES, { message: contextTypeMessage })
  contextType?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() contextId?: string;

  @ApiPropertyOptional({ enum: UNIVERSAL_NURSING_NOTE_TYPES })
  @IsOptional() @IsIn(UNIVERSAL_NURSING_NOTE_TYPES)
  noteType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() situation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() background?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assessment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() recommendation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() vitalSigns?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: UNIVERSAL_NURSING_SEVERITIES }) @IsOptional() @IsIn(UNIVERSAL_NURSING_SEVERITIES) severity?: string;
  @ApiPropertyOptional({ enum: NURSING_SHIFTS }) @IsOptional() @IsIn(NURSING_SHIFTS) shiftType?: string;
}
