import {
  IsString, IsOptional, IsUUID, IsNotEmpty, IsDateString, IsEnum, IsInt, Min, Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Laterality } from '@prisma/client';

// ── 수술 예약 ──

export class CreateSurgeryDto {
  @ApiProperty({ description: '환자 ID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: '집도의 ID' })
  @IsUUID()
  surgeonId: string;

  @ApiProperty({ description: '예정 일시' })
  @IsDateString()
  scheduledAt: string;

  @ApiProperty({ description: '수술명' })
  @IsString()
  @IsNotEmpty()
  procedureName: string;

  // 🔴 화면은 '수술 전 진단'을 입력받는데 DTO 에 없어 whitelist 가 버리고 있었다(컬럼은 존재).
  @ApiPropertyOptional({ description: '수술 전 진단' })
  @IsOptional()
  @IsString()
  preOpDiagnosis?: string;

  @ApiPropertyOptional({ description: '수술 코드' })
  @IsOptional()
  @IsString()
  procedureCode?: string;

  @ApiPropertyOptional({ description: '수술 부위(예: 슬관절)' })
  @IsOptional()
  @IsString()
  bodySite?: string;

  @ApiPropertyOptional({ description: '좌우 구분(오부위수술 방지)', enum: Laterality })
  @IsOptional()
  @IsEnum(Laterality)
  laterality?: Laterality;

  @ApiPropertyOptional({ description: '마취 유형' })
  @IsOptional()
  @IsString()
  anesthesiaType?: string;

  // 🔴 보조 의사는 **이름 문자열이 아니라 직원 선택**이다. 컬럼(`Surgery.assistantId`)은 uuid 인데
  //    설정 경로가 어디에도 없어 개통 이래 전건 null 이었다(운영 실측 14/14). 그 결과
  //    수술 프로토콜 단계 알림(`protocol.service.afterTransition` — DOCTOR 수신자에 assistantId 포함)이
  //    보조의에게 **한 번도 가지 않았다**. 이름을 uuid 칸에 밀어 넣으면 그 순간 원장이 거짓이 되므로
  //    IsUUID 로 잠근다(자유 텍스트는 400 으로 거절 — 조용히 버리지 않는다).
  @ApiPropertyOptional({ description: '보조 의사(의사 계정 ID) — 이름 문자열 불가' })
  @IsOptional()
  @IsUUID()
  assistantId?: string;
}

// ── 수술 완료 (Op Note) ──

export class CompleteSurgeryDto {
  @ApiPropertyOptional({ description: '수술 전 진단' })
  @IsOptional()
  @IsString()
  preOpDiagnosis?: string;

  @ApiPropertyOptional({ description: '수술 후 진단' })
  @IsOptional()
  @IsString()
  postOpDiagnosis?: string;

  @ApiPropertyOptional({ description: '수술 기록' })
  @IsOptional()
  @IsString()
  opNote?: string;

  @ApiPropertyOptional({ description: '소견' })
  @IsOptional()
  @IsString()
  findings?: string;

  @ApiPropertyOptional({ description: '합병증' })
  @IsOptional()
  @IsString()
  complications?: string;

  @ApiPropertyOptional({ description: '검체' })
  @IsOptional()
  @IsString()
  specimens?: string;

  // 🔴 컬럼(`Surgery.ebl`)은 Int 인데 DTO 가 `@IsString()` 이라 화면이 보내는 **숫자**가
  //    ValidationPipe 에서 400 으로 튕겼다 — 추정실혈량을 적는 순간 Op Note **전체**(소견·상세기술·
  //    검체·합병증·마취기록)가 저장되지 않았다(수술 진료 레이아웃은 ebl 기본값 0 을 늘 보내
  //    개통 이래 100% 실패). 숫자로 받는다. 빈 문자열은 '미기재'(undefined)로, 숫자가 아닌 글자는
  //    조용히 버리지 않고 400 으로 거절한다.
  @ApiPropertyOptional({ description: '추정 실혈량(mL) — 정수', type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') { const n = Number(value.trim()); return Number.isNaN(n) ? value : n; }
    return value;
  })
  @IsInt()
  @Min(0)
  @Max(100000)
  ebl?: number;

  @ApiPropertyOptional({ description: '수액 투여량' })
  @IsOptional()
  @IsString()
  fluidsGiven?: string;

  @ApiPropertyOptional({ description: '임플란트' })
  @IsOptional()
  @IsString()
  implants?: string;

  @ApiPropertyOptional({ description: '배액관' })
  @IsOptional()
  @IsString()
  drains?: string;

  @ApiPropertyOptional({ description: '마취 유형' })
  @IsOptional()
  @IsString()
  anesthesiaType?: string;

  @ApiPropertyOptional({ description: '마취 기록' })
  @IsOptional()
  @IsString()
  anesthesiaNote?: string;
}
