import {
  IsUUID, IsOptional, IsString, IsIn, IsNotEmpty, IsDateString,
  IsNumber, IsInt, IsBoolean, MaxLength, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INTERVENTION_TYPES } from '../pharmacist-activity.service';

/**
 * 약사 임상활동 DTO — 🔴 인라인 `@Body()` 승격(2026-08-26)
 *
 * 종전 이 컨트롤러의 쓰기 7개는 전부 인라인 `@Body() body: { … }` 였다.
 * 인라인 객체 리터럴은 런타임 metatype 이 `Object` 라 **ValidationPipe 가 통째로 스킵된다**
 * (v4.3.0 처방 EP 와 같은 유형). 실제로 무엇을 통과시켰는가:
 *   · 중재 유형·ADR 중증도·인과관계가 **아무 문자열이나** 컬럼에 들어갔다
 *     (`severity @db.VarChar(10)` — 어휘가 오염되면 라벨표가 빈 배지를 그리고 집계가 갈라진다).
 *   · `duration` 이 소수·음수로 들어갔다(사용기간 -3일).
 *   · 잘못된 날짜는 `new Date('')` = Invalid Date 로 Prisma 500 — 400 이어야 한다.
 *
 * 🔴 whitelist:true 라 **DTO 에 없는 키는 조용히 지워진다**. 주체 키
 * (`pharmacistId`/`requestedBy`/`reportedBy`)를 일부러 넣지 않은 것은 그래서다 —
 * 클라이언트가 보내도 여기서 사라지고, 컨트롤러가 인증 사용자로 채운다.
 * 반대로 **서버가 실제로 읽는 키는 빠짐없이 적어야 한다**(빠지면 성공 응답 + 데이터 소실).
 */

export class CreateInterventionDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: '환자 ID 는 UUID 여야 합니다' })
  patientId: string;

  @ApiPropertyOptional({ description: '연결 처방 ID(선택) — 넣으면 그 환자의 처방이어야 한다' })
  @IsOptional()
  @IsUUID('4', { message: '처방 ID 는 UUID 여야 합니다' })
  prescriptionId?: string;

  @ApiPropertyOptional({ description: '중재 대상 약물 표기(처방 삭제 후에도 남는 기록)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  prescriptionDrug?: string;

  @ApiProperty({ description: '중재 유형', enum: INTERVENTION_TYPES as unknown as string[] })
  @IsIn(INTERVENTION_TYPES as unknown as string[], {
    message: `중재 유형은 ${INTERVENTION_TYPES.join('|')} 중 하나여야 합니다`,
  })
  type: string;

  @ApiProperty({ description: '중재 사유' })
  @IsString()
  @IsNotEmpty({ message: '중재 사유는 필수입니다' })
  reason: string;

  @ApiProperty({ description: '중재 제안' })
  @IsString()
  @IsNotEmpty({ message: '중재 제안은 필수입니다' })
  suggestion: string;
}

export class RespondInterventionDto {
  /** 🔴 PENDING 이 아닌 제3의 상태로 밀어넣지 못하게 두 값만 받는다. */
  @ApiProperty({ description: '처리 결과', enum: ['ACCEPTED', 'REJECTED'] })
  @IsIn(['ACCEPTED', 'REJECTED'], { message: '처리 상태는 ACCEPTED|REJECTED 여야 합니다' })
  status: 'ACCEPTED' | 'REJECTED';

  @ApiPropertyOptional({ description: '회신 내용(거절 사유 등)' })
  @IsOptional()
  @IsString()
  doctorResponse?: string;
}

export class CreateTdmRequestDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: '환자 ID 는 UUID 여야 합니다' })
  patientId: string;

  @ApiProperty({ description: '약물명' })
  @IsString()
  @IsNotEmpty({ message: '약물명은 필수입니다' })
  @MaxLength(120)
  drugName: string;

  @ApiPropertyOptional({ description: '적응증' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  indication?: string;

  /** 🔴 미입력은 보내지 않는다 — `Number('') = 0` 은 "목표 0" 이라는 다른 사실이다. */
  @ApiPropertyOptional({ description: '목표범위 하한(미입력이면 생략)' })
  @IsOptional()
  @IsNumber({}, { message: '목표범위 하한은 숫자여야 합니다' })
  targetRangeMin?: number;

  @ApiPropertyOptional({ description: '목표범위 상한(미입력이면 생략)' })
  @IsOptional()
  @IsNumber({}, { message: '목표범위 상한은 숫자여야 합니다' })
  targetRangeMax?: number;

  @ApiPropertyOptional({ description: '목표범위 단위' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  targetUnit?: string;
}

export class RecordTdmResultDto {
  @ApiProperty({ description: '실측 농도' })
  @IsNumber({}, { message: '실측 농도는 숫자여야 합니다' })
  resultLevel: number;

  @ApiProperty({ description: '결과 해석' })
  @IsString()
  @IsNotEmpty({ message: '결과 해석은 필수입니다' })
  resultInterpretation: string;

  @ApiPropertyOptional({ description: '용량 권고' })
  @IsOptional()
  @IsString()
  doseRecommendation?: string;
}

export const ADR_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE', 'FATAL'] as const;
export const ADR_OUTCOMES = ['RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'FATAL', 'UNKNOWN'] as const;
export const ADR_CAUSALITIES = ['CERTAIN', 'PROBABLE', 'POSSIBLE', 'UNLIKELY'] as const;

export class CreateAdrReportDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: '환자 ID 는 UUID 여야 합니다' })
  patientId: string;

  /** 응답 에코용 — 원장에 저장되지 않는다(이름 정본은 환자 원장). */
  @ApiPropertyOptional({ description: '환자명(표시용)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  patientName?: string;

  @ApiProperty({ description: '의심 약물' })
  @IsString()
  @IsNotEmpty({ message: '의심 약물은 필수입니다' })
  @MaxLength(200)
  suspectedDrug: string;

  @ApiProperty({ description: '이상반응 서술' })
  @IsString()
  @IsNotEmpty({ message: '이상반응은 필수입니다' })
  reaction: string;

  @ApiProperty({ description: '중증도', enum: ADR_SEVERITIES as unknown as string[] })
  @IsIn(ADR_SEVERITIES as unknown as string[], {
    message: `중증도는 ${ADR_SEVERITIES.join('|')} 중 하나여야 합니다`,
  })
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'FATAL';

  @ApiProperty({ description: '발생일(YYYY-MM-DD)' })
  @IsDateString({}, { message: '발생일은 날짜여야 합니다' })
  onsetDate: string;

  @ApiProperty({ description: '결과', enum: ADR_OUTCOMES as unknown as string[] })
  @IsIn(ADR_OUTCOMES as unknown as string[], {
    message: `결과는 ${ADR_OUTCOMES.join('|')} 중 하나여야 합니다`,
  })
  outcome: string;

  @ApiProperty({ description: '인과관계 평가', enum: ADR_CAUSALITIES as unknown as string[] })
  @IsIn(ADR_CAUSALITIES as unknown as string[], {
    message: `인과관계는 ${ADR_CAUSALITIES.join('|')} 중 하나여야 합니다`,
  })
  causalityAssessment: string;

  /**
   * 🔴 Naranjo 총점(-4~13). 컬럼(`naranjo_score`)은 개통 이래 있었는데
   * 이 화면의 보고 경로가 값을 넘기지 않아 **한 번도 채워진 적이 없다**.
   * 계산하지 않았으면 보내지 않는다 — 0 은 "의심(UNLIKELY)"이라는 다른 사실이다.
   */
  @ApiPropertyOptional({ description: 'Naranjo 총점(계산했을 때만)' })
  @IsOptional()
  @IsInt({ message: 'Naranjo 점수는 정수여야 합니다' })
  @Min(-4)
  @Max(13)
  naranjoScore?: number;

  @ApiPropertyOptional({ description: 'KAERS/KIDS 보고번호' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  kaersReportId?: string;
}

export class CreateAspRequestDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID('4', { message: '환자 ID 는 UUID 여야 합니다' })
  patientId: string;

  @ApiPropertyOptional({ description: '환자명(표시용)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  patientName?: string;

  @ApiProperty({ description: '항생제' })
  @IsString()
  @IsNotEmpty({ message: '항생제명은 필수입니다' })
  @MaxLength(200)
  antimicrobialName: string;

  @ApiProperty({ description: '적응증' })
  @IsString()
  @IsNotEmpty({ message: '적응증은 필수입니다' })
  indication: string;

  /** 🔴 음수·소수 사용기간은 존재하지 않는다(종전 인라인 @Body 는 통과시켰다). */
  @ApiPropertyOptional({ description: '사용기간(양의 정수)' })
  @IsOptional()
  @IsInt({ message: '사용기간은 정수여야 합니다' })
  @Min(1, { message: '사용기간은 1 이상이어야 합니다' })
  @Max(3650)
  duration?: number;

  @ApiPropertyOptional({ description: '기간 단위', enum: ['days', 'hours'] })
  @IsOptional()
  @IsIn(['days', 'hours'], { message: '기간 단위는 days|hours 여야 합니다' })
  durationUnit?: string;

  @ApiPropertyOptional({ description: '제한 등급' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  restrictedLevel?: string;
}

export class HandleAspRequestDto {
  @ApiProperty({ description: '승인 여부' })
  @IsBoolean({ message: 'approve 는 true|false 여야 합니다' })
  approve: boolean;

  /**
   * 🔴 검토 의견은 **사람이 쓴 것만** 남는다. 종전 화면은 버튼에
   * `comment: '승인'` / `'부적절'` 을 하드코딩해 보냈다 — 아무도 쓰지 않은 문장이
   * 항생제 승인 기록의 사유로 남았다(화면이 값을 지어내지 않는다).
   */
  @ApiPropertyOptional({ description: '검토 의견(사람이 입력한 것만)' })
  @IsOptional()
  @IsString()
  reviewComment?: string;
}
