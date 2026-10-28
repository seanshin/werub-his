import { IsString, IsNumber, IsOptional, IsNotEmpty, IsBoolean, IsArray, IsObject, MaxLength, ValidateNested, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LabResultItemDto {
  @ApiProperty({ description: '검사 항목명' })
  @IsString()
  testName: string;

  @ApiProperty({ description: '검사 결과값' })
  @IsString()
  value: string;

  @ApiProperty({ description: '단위' })
  @IsString()
  unit: string;

  @ApiPropertyOptional({ description: '정상 범위 최소값' })
  @IsOptional()
  @IsNumber()
  normalMin?: number;

  @ApiPropertyOptional({ description: '정상 범위 최대값' })
  @IsOptional()
  @IsNumber()
  normalMax?: number;

  @ApiPropertyOptional({ description: '검사코드(코드마스터) — 지정 시 LOINC 자동 해소' })
  @IsOptional()
  @IsString()
  testCode?: string;

  @ApiPropertyOptional({ description: '표준 LOINC(직접 지정)' })
  @IsOptional()
  @IsString()
  loincCode?: string;
}

export class SubmitLabResultDto {
  @ApiProperty({ description: '검사 항목들', type: [LabResultItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabResultItemDto)
  items: LabResultItemDto[];

  @ApiPropertyOptional({ description: '기술자 노트' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AmendLabResultDto {
  @ApiProperty({ description: '정정 검사 항목들', type: [LabResultItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabResultItemDto)
  items: LabResultItemDto[];

  @ApiProperty({ description: '정정 사유(필수)' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CollectLabSampleDto {
  @ApiPropertyOptional({ description: '기술자 노트' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 검사 장비 수정 ──

export class UpdateInstrumentDto {
  @ApiPropertyOptional({ description: '장비명' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '모델' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '시리얼 번호' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ description: '분류' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '인터페이스 타입 (HL7, ASTM, FILE 등)' })
  @IsOptional()
  @IsString()
  interfaceType?: string;

  @ApiPropertyOptional({ description: '인터페이스 설정' })
  @IsOptional()
  interfaceConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '설치 위치' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── 검사 취소 ──

export class CancelTestingDto {
  @ApiPropertyOptional({ description: '취소 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── 검사 장비 등록 ──

export class CreateInstrumentDto {
  @ApiProperty({ description: '장비명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '모델' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '시리얼 번호' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiProperty({ description: '분류' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '인터페이스 타입 (HL7, ASTM, FILE 등)' })
  @IsString()
  @IsNotEmpty()
  interfaceType: string;

  @ApiPropertyOptional({ description: '인터페이스 설정' })
  @IsOptional()
  interfaceConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '설치 위치' })
  @IsOptional()
  @IsString()
  location?: string;
}

// ── 장비 결과 수신 ──

export class ReceiveInterfaceResultDto {
  @ApiProperty({ description: '장비 ID' })
  @IsString()
  @IsNotEmpty()
  instrumentId: string;

  /**
   * 🔴 `@IsObject()` 가 없으면 전역 `whitelist:true` 가 이 필드를 **조용히 지운다.**
   *    `@ApiProperty` 는 Swagger 문서용일 뿐 class-validator 가 아니다.
   *
   *    실측(2026-08-26): 이 DTO 를 운영과 같은 파이프 설정으로 태우면 출력 키에 `rawData` 가 없다.
   *    `raw_data` 는 DB 에서 **NOT NULL·기본값 없음**이라 Prisma 가 `Argument rawData is missing` 을
   *    던지고 500 이 된다. FE 는 그것을 `toast.error('파일 업로드 실패')` 로 삼켰다.
   *    `whitelist:true` 는 **초기 커밋부터** 켜져 있었고 이 필드는 그때부터 무데코레이터였다
   *    — **장비 결과 수신이 개통 이래 한 번도 성공한 적이 없다.**
   */
  @ApiProperty({ description: '원본 데이터' })
  @IsObject()
  rawData: Record<string, unknown>;

  @ApiPropertyOptional({ description: '파싱된 항목' })
  @IsOptional()
  @IsArray()
  parsedItems?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '검체 바코드' })
  @IsOptional()
  @IsString()
  sampleBarcode?: string;

  @ApiPropertyOptional({ description: '파일명' })
  @IsOptional()
  @IsString()
  fileName?: string;
}

// ── 수동 매칭 ──

export class MatchInterfaceResultDto {
  @ApiProperty({ description: '오더 ID' })
  @IsString()
  @IsNotEmpty()
  orderId: string;
}

// ── 수신 결과 거부 ──

export class RejectInterfaceResultDto {
  @ApiProperty({ description: '거부 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ── 결과 첨부파일 ──

export class AddLabAttachmentDto {
  @ApiProperty({ description: '파일명' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ description: '파일 URL' })
  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @ApiProperty({ description: '파일 크기 (bytes)' })
  @IsNumber()
  fileSize: number;

  @ApiProperty({ description: 'MIME 타입' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ description: '첨부 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;
}

// ── 검사기록지 생성 ──

export class CreateWorksheetDto {
  @ApiProperty({ description: '기록지 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '장비 ID' })
  @IsOptional()
  @IsString()
  instrumentId?: string;

  @ApiProperty({ description: '카테고리' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ description: '날짜 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── 기록지에 오더 추가 ──

export class AddWorksheetItemDto {
  @ApiProperty({ description: '오더 ID' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiPropertyOptional({ description: '검체 바코드' })
  @IsOptional()
  @IsString()
  sampleBarcode?: string;
}

// ── 기록지 서명 (2026-09-15 B5) ──
// 종전 인라인 `@Body() body?: { blockchainSignature?: {...} }` — 검증 스킵으로 문자열·배열 서명 블록이 서명 서비스까지 갔다.
// 화면(lab WorksheetTab)은 본문 없이 부른다 — 빈 본문은 통과한다.

export class SignLabWorksheetDto {
  @ApiPropertyOptional({ description: '블록체인 서명 블록(구조만 보장 — 값 검증은 서명 서비스)' })
  @IsOptional()
  @IsObject()
  blockchainSignature?: { certificateId: string; signatureValue: string; signatureAlgorithm: string; documentHash: string };
}

// ── 바코드 생성 ──

export class GenerateBarcodeDto {
  @ApiProperty({ description: '오더 ID' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;
}

// ── 바코드 스캔 ──

export class ScanBarcodeDto {
  @ApiProperty({ description: '바코드' })
  @IsString()
  @IsNotEmpty()
  barcode: string;
}

// ── 수탁기관 등록 ──

export class CreateReferenceLabDto {
  @ApiProperty({ description: '기관명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '기관 코드' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ description: '연락처 정보' })
  @IsOptional()
  contactInfo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'API 엔드포인트' })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;
}

// ── 카탈로그 항목 추가 ──

export class CreateCatalogItemDto {
  @ApiProperty({ description: '검사 코드' })
  @IsString()
  @IsNotEmpty()
  testCode: string;

  @ApiProperty({ description: '검사명' })
  @IsString()
  @IsNotEmpty()
  testName: string;

  @ApiProperty({ description: 'TAT (일수)' })
  @IsNumber()
  turnaroundDays: number;

  @ApiPropertyOptional({ description: '가격' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: '검체 유형' })
  @IsOptional()
  @IsString()
  sampleType?: string;

  @ApiPropertyOptional({ description: '검체 양' })
  @IsOptional()
  @IsString()
  sampleVolume?: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;
}

// ── 위탁검사 의뢰 ──

export class CreateSendOutDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '수탁기관 ID' })
  @IsString()
  @IsNotEmpty()
  referenceLabId: string;

  @ApiProperty({ description: '검사명' })
  @IsString()
  @IsNotEmpty()
  testName: string;

  @ApiPropertyOptional({ description: '카탈로그 항목 ID' })
  @IsOptional()
  @IsString()
  catalogItemId?: string;

  @ApiPropertyOptional({ description: '검체 유형' })
  @IsOptional()
  @IsString()
  sampleType?: string;

  @ApiPropertyOptional({ description: '검체 바코드' })
  @IsOptional()
  @IsString()
  sampleBarcode?: string;

  @ApiPropertyOptional({ description: '임상 정보' })
  @IsOptional()
  @IsString()
  clinicalInfo?: string;

  @ApiPropertyOptional({ description: '오더 ID' })
  @IsOptional()
  @IsString()
  orderId?: string;
}

// ── 위탁검사 상태 변경 ──

export class UpdateSendOutStatusDto {
  @ApiProperty({ description: '상태' })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ description: '송장번호' })
  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @ApiPropertyOptional({ description: '결과 파일 URL' })
  @IsOptional()
  @IsString()
  resultFileUrl?: string;

  @ApiPropertyOptional({ description: '결과 요약' })
  @IsOptional()
  @IsString()
  resultSummary?: string;
}

/**
 * 위급검사값 확인(IPSG.2 read-back / NPSG.02.03.01 · 인증기준 2.3.2·2.3.6)
 *
 * 🔴 2026-08-18 실체화 — 종전에는 **아무도 복창하지 않았는데 복창했다고 기록**했다.
 *    · 서비스가 `readBackConfirmed: data.readBack ?? true` 라 본문이 비면 "복창함"으로 적었고
 *    · 화면(CriticalValueAlertBanner)은 체크박스 없이 `readBack: true` 를 늘 보냈으며
 *    · 그 결과 품질지표 `lab.readBackMissing`(readBackConfirmed=false 카운트)이 **구조적으로 영원히 0**,
 *      화면은 "복창 누락 없음"이라고 안심시켰다(P17).
 *
 * 지금의 계약:
 *  1. `readBack` 은 **필수**다. 보내지 않으면 400 — 서버가 대신 "복창했다"고 정하지 않는다.
 *  2. `readBack: true` 는 **주장이 아니라 검증 대상**이다 — `readBackValue`(수신자가 되읽은 값)를 함께 보내고,
 *     서버가 통보값과 대조해 일치할 때만 `readBackConfirmed = true` 가 된다. 불일치는 400(확인 미완).
 *  3. `readBack: false` 도 정당한 경로다(구두 통화 없이 화면에서 인지). 이때 `readBackConfirmed = false` 로
 *     **정직하게** 남고 품질지표의 분자가 된다 — 그래야 "복창 누락 0"이 표본부재가 아닌 진짜 0이 된다.
 *  4. 담당의 본인이 아니면 `delegationReason`(대리 확인 사유)이 필수다 — 상세는 LabService 주석.
 *
 * 🔴 전역 `whitelist: true` 라 여기에 없는 키는 조용히 삭제된다. 화면이 보내는 키 = 이 DTO 의 키.
 */
export class AcknowledgeCriticalValueDto {
  @ApiProperty({ description: '구두 복창(read-back)을 실제로 받았는가 — 필수. 서버가 기본값을 정하지 않는다.' })
  @IsBoolean()
  readBack!: boolean;

  @ApiPropertyOptional({ description: '수신자가 되읽은 값(readBack=true 이면 필수). 통보값과 대조해 일치할 때만 확인으로 기록.' })
  @ValidateIf((o: AcknowledgeCriticalValueDto) => o.readBack === true)
  @IsString()
  @IsNotEmpty({ message: 'readBack=true 이면 되읽은 값(readBackValue)이 필요합니다' })
  @MaxLength(100)
  readBackValue?: string;

  @ApiPropertyOptional({ description: '대리 확인 사유 — 담당의 본인이 아닐 때 필수(당직/부재 등)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  delegationReason?: string;

  @ApiPropertyOptional({ description: '조치 내용' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  responseAction?: string;
}

/** 위급값 조치 기록(ACKNOWLEDGED → ACTED) */
export class RecordCriticalValueActionDto {
  @ApiProperty({ description: '확인 이후 실제로 한 조치(필수)' })
  @IsString()
  @IsNotEmpty({ message: '조치 내용이 필요합니다' })
  @MaxLength(1000)
  action!: string;
}
