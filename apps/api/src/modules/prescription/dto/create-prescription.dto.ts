import { IsUUID, IsEnum, IsOptional, IsString, IsInt, IsBoolean, IsObject, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrescriptionType } from '@prisma/client';

export class CreatePrescriptionDto {
  @ApiProperty({ enum: PrescriptionType })
  @IsEnum(PrescriptionType)
  type: PrescriptionType;

  // 약 처방
  @ApiPropertyOptional({ description: 'MedicationCode ID' })
  @IsOptional()
  @IsUUID()
  medicationCodeId?: string;

  @ApiPropertyOptional({ description: '관련 상병 DiagnosisCode ID(G2-5)' })
  @IsOptional()
  @IsUUID()
  diagnosisCodeId?: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ example: '1일 3회' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ description: '일수', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ description: '총 수량', example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ example: '경구' })
  @IsOptional()
  @IsString()
  route?: string;

  // 검사/영상 처방
  @ApiPropertyOptional({ description: 'ProcedureCode ID' })
  @IsOptional()
  @IsUUID()
  procedureCodeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ description: '우선순위 (STAT/ROUTINE/PRN)', default: 'ROUTINE' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ description: '처방 출처 (MANUAL/PRE_ORDER/CP/COPY/FAVORITE)' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'DUR 경고 무시하고 강제 처방', default: false })
  @IsOptional()
  @IsBoolean()
  overrideDur?: boolean;

  @ApiPropertyOptional({ description: 'DUR 경고 무시(override) 사유 — 강제 처방 시 약국/심사 추적용' })
  @IsOptional()
  @IsString()
  overrideReason?: string;

  @ApiPropertyOptional({ description: 'CDSS 임상 검증 경고(알레르기·신기능·연령) 무시하고 강제 처방 — 사유는 overrideReason 공유', default: false })
  @IsOptional()
  @IsBoolean()
  overrideCdss?: boolean;

  @ApiPropertyOptional({ description: '조제 유형 (INTERNAL=원내, EXTERNAL=원외)', default: 'INTERNAL' })
  @IsOptional()
  @IsString()
  dispensingType?: string;
}

/**
 * 처방 생성 본문(위임·서명 맥락 포함) — 🔴 2026-08-18
 *
 * 종전 컨트롤러 시그니처는 `@Body() dto: CreatePrescriptionDto & { prescriberId?…; blockchainSignature?… }`
 * 였다. **교차(intersection) 타입은 `design:paramtypes` 가 `Object` 로 방출**되므로
 * 전역 ValidationPipe 가 통째로 스킵됐다 — 즉 위의 `CreatePrescriptionDto` 에 적어둔
 * `@IsEnum(PrescriptionType)`·`@IsUUID()`·`@Min(1)` 이 **처방 생성 주경로에서 한 번도 실행된 적이 없다.**
 * (DTO 가 있다 ≠ 검증된다 — 이 저장소의 반복 함정이다.)
 *
 * 클래스 상속으로 바꿔 metatype 을 되살린다. 화면 9경로가 실제로 보내는 키
 * (type·priority·dispensingType·diagnosisCodeId·medicationCodeId·dosage·frequency·duration·
 *  quantity·route·procedureCodeId·instructions·prescriberId·overrideDur·overrideReason)를
 * 전부 포함한다. `notes` 는 서비스가 읽지 않는 키라 종전에도 저장되지 않았다(`dto.instructions`가 정본).
 */
export class CreatePrescriptionWithContextDto extends CreatePrescriptionDto {
  // ── 지시 경로(구두·전화 처방) ──
  // 🔴 2026-08-19: `prescriptions.order_source` 컬럼과 화면 배지(`PrescriptionSafetyBadges`)는 있는데
  //    **DTO 에 키가 없어 전역 whitelist 가 지우고 있었다.** 운영 실측 1,769건 **전량 `WRITTEN`** —
  //    구두·전화 처방이 개통 이래 한 건도 기록된 적이 없다(오기 위험이 가장 높은 경로가 원장에서 사라졌다).
  //
  // 🔴 자동으로 분류하지 않는다. 위임(대리입력)이라고 해서 구두처방이라 단정할 수 없다 —
  //    시스템 승인(폰)으로 받은 지시는 구두가 아니다. 입력하는 사람이 고른다.
  @ApiPropertyOptional({ description: '지시 경로 — WRITTEN(서면·전자)·VERBAL(구두)·TELEPHONE(전화)', enum: ['WRITTEN', 'VERBAL', 'TELEPHONE'] })
  @IsOptional()
  @IsIn(['WRITTEN', 'VERBAL', 'TELEPHONE'])
  orderSource?: string;

  /**
   * 복창(read-back) 확인 — 구두·전화 처방일 때만 의미가 있다.
   * 🔴 기본값을 참으로 두지 않는다. v4.5.0 에서 위급값 복창이 `readBack ?? true` 라
   *    "복창 누락"이 구조적으로 영원히 0이던 것과 같은 함정이다(P17).
   */
  @ApiPropertyOptional({ description: '복창 확인 여부(구두·전화 처방) — 미전송은 "확인 안 함"이다' })
  @IsOptional()
  @IsBoolean()
  readBackConfirmed?: boolean;

  @ApiPropertyOptional({ description: '책임 처방의 지정(위임·대리처방). 미지정=작성자 본인' })
  @IsOptional()
  @IsUUID()
  prescriberId?: string;

  @ApiPropertyOptional({ description: '블록체인 서명 블록(구조만 보장 — 값 검증은 서명 서비스)' })
  @IsOptional()
  @IsObject()
  blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  };
}
