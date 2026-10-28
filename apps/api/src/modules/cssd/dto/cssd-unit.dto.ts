import { IsString, IsOptional, IsNotEmpty, IsBoolean, IsArray, IsUUID, IsInt, Min, Max, MaxLength, ArrayMaxSize, Equals } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 🔴 수명 한도(maxCycles)는 제조사·원내 기준 입력값이다 — null 은 "한도 미설정"(경보 없음), 0·음수·소수는 입력 오류(400).
//    class-validator 의 @IsOptional 은 null·undefined 를 모두 건너뛰므로 null 은 그대로 서비스까지 간다(= 해제).

export class RepackageDto {
  @ApiProperty({ description: '트레이 마스터 ID' })
  @IsUUID()
  templateId: string;

  @ApiProperty({ description: '구성품 카운트 검증 완료(true 여야 포장)' })
  @IsBoolean()
  countVerified: boolean;

  @ApiPropertyOptional({ description: '누락/대체 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  countNote?: string;

  @ApiPropertyOptional({ description: '보관 위치' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ description: '이 LOT 에 들어가는 기구 개체 번호(선택) — 등록되지 않은 번호·폐기 개체는 400', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  unitSerials?: string[];
}

export class CreateInstrumentUnitDto {
  @ApiProperty({ description: '기구 품목 ID' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ description: '개체 번호(각인·UDI·자체 라벨)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  serialNo: string;

  @ApiPropertyOptional({ description: '개체 수명 한도(멸균 합격 사이클) — 미입력이면 품목 한도, 둘 다 없으면 한도 미설정', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxCycles?: number | null;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateInstrumentUnitDto {
  @ApiPropertyOptional({ description: '개체 수명 한도 — null 이면 개체 한도 해제(품목 한도 따름)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxCycles?: number | null;

  @ApiPropertyOptional({ description: '메모', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class RetireInstrumentUnitDto {
  @ApiProperty({ description: '폐기 확인(true)' })
  @Equals(true)
  confirm: boolean;

  @ApiPropertyOptional({ description: '폐기 사유' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SetItemMaxCyclesDto {
  @ApiProperty({ description: '품목 기본 수명 한도(멸균 합격 사이클) — null 이면 한도 미설정', nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxCycles: number | null;
}
