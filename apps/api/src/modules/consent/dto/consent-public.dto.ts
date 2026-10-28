import { IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 공개(비인증) 동의 서명 경로의 입력 DTO — 2026-07 입력 검증 전수검토.
 *
 * ⚠️ 인라인 타입(`@Body() body: { ... }`)은 런타임 metatype 이 Object 라
 * 전역 ValidationPipe 가 **검증을 통째로 건너뛴다**. 그 결과 문자열 자리에 객체를 넣으면
 * Prisma where 절에서 필터 연산자로 해석돼 조건이 무력화된다(연산자 주입).
 * 외부에서 호출되는 경로는 반드시 class-validator DTO 를 쓴다.
 */
export class ConsentDeviceEnrollDto {
  @ApiProperty({ description: '기기 식별자' })
  @IsString()
  @Length(1, 64)
  deviceUid: string;

  @ApiProperty({ description: '기기 이름' })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ description: '기기 페어링 인증코드(있으면 자동 승인)' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  code?: string;

  /**
   * 🔴 (2026-09-16 H1) 이미 등록된 기기의 재요청에서 **소지 증명**으로 쓴다.
   *    종전엔 uid 만으로 기존 deviceSecret 을 돌려줬다 — uid 는 URL 경로에 실리는 식별자이고
   *    secret 은 그 태블릿의 유일한 문턱이라, 자격증명을 식별자와 맞바꾸는 문이었다.
   */
  @ApiPropertyOptional({ description: '현재 기기 비밀(재요청 시 소지 증명)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  secret?: string;
}

export class ConsentDeviceSignedDto {
  @ApiPropertyOptional({ description: '기기 비밀' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  secret?: string;
}

export class ConsentSignSubmitDto {
  @ApiProperty({ description: '서명패드 이미지(data URL · PNG/JPEG)' })
  @IsString()
  @MaxLength(3_000_000)
  signatureImage: string;

  @ApiProperty({ description: '서명자 이름' })
  @IsString()
  @MaxLength(100)
  signedBy: string;

  // 세션 생성 시점 값을 신뢰하므로 본문 값은 무시되지만(위장 방지), 형식은 검증한다.
  @ApiPropertyOptional({ description: '서명자 유형(무시됨 — 세션 값 사용)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  signerType?: string;

  @ApiPropertyOptional({ description: '보호자 이름' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  guardianName?: string;

  @ApiPropertyOptional({ description: '보호자 관계' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  guardianRelation?: string;

  @ApiPropertyOptional({ description: '보호자 법적 근거' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardianLegalBasis?: string;

  /**
   * 초진 등록 동의 묶음(type REGISTRATION)일 때 **환자가 고른 항목별 동의** — { PRIVACY: true, MARKETING: false, … }(2026-10-02).
   * 🔴 전역 whitelist 는 DTO 에 없는 키를 조용히 지운다 — 여기 선언하지 않으면 선택이 서버에 닿지 않는다.
   *    값 검증(키가 10종 안·값이 boolean)은 서비스가 한다(묶음이 아니면 무시).
   */
  @ApiPropertyOptional({ description: '초진 동의 묶음의 항목별 동의 { 유형: boolean }' })
  @IsOptional()
  @IsObject()
  choices?: Record<string, unknown>;
}
