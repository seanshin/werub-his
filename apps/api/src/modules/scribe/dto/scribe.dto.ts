import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** 세션 시작 — encounterId는 경로 파라미터. 바디는 선택 메타. */
export class StartScribeSessionDto {
  @ApiPropertyOptional({ description: '클라이언트 메타(녹음 환경 등)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientNote?: string;
}

/**
 * 오디오 업로드(P0) — base64 dataURL 바디.
 * ⚠️ P1: resumable 청크 multipart 업로드로 교체(대용량·재시도). 여기선 스캐폴드용 base64.
 */
export class UploadScribeAudioDto {
  @ApiProperty({ description: 'base64 오디오(webm/ogg/m4a/wav)' })
  @IsString()
  audioBase64!: string;

  @ApiPropertyOptional({ description: 'MIME (audio/webm 등)', default: 'audio/webm' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mime?: string;
}

/** 전사 요청(P0 스텁) — 실제 STT 어댑터는 P1(Track B 설계). */
export class TranscribeScribeDto {
  @ApiPropertyOptional({ description: '화자분리 요청', default: true })
  @IsOptional()
  @IsBoolean()
  diarize?: boolean;
}

/** 의료진 음성 프로파일 등록(생체 동의 선행) — P0: 임베딩 자리표시(placeholder). */
export class EnrollVoiceProfileDto {
  @ApiProperty({ description: '생체정보 등록 동의 확인(§4.1(2))' })
  @IsBoolean()
  consent!: boolean;

  @ApiPropertyOptional({ description: 'base64 음성 샘플(P1에서 임베딩 추출)' })
  @IsOptional()
  @IsString()
  audioBase64?: string;

  @ApiPropertyOptional({ description: '등록 샘플 수', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  sampleCount?: number;
}

/** 화자분리 세그먼트 재라벨(D8) — 화자 라벨만 정정. 🔴 원문(text)은 이 DTO 에 없다: 전사 원문은 절대 못 바꾼다. */
export const SCRIBE_SEGMENT_ROLES = ['DOCTOR', 'PATIENT', 'GUARDIAN', 'OTHER', 'UNKNOWN'] as const;
export class RelabelScribeSegmentDto {
  @ApiProperty({ description: '화자 라벨(정정)', enum: SCRIBE_SEGMENT_ROLES })
  @IsIn(SCRIBE_SEGMENT_ROLES as unknown as string[])
  role!: (typeof SCRIBE_SEGMENT_ROLES)[number];
}
