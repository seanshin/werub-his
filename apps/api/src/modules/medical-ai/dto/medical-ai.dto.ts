import {
  IsString, IsOptional, IsNotEmpty, IsArray, IsNumber, IsEnum, IsBoolean, IsIn, IsUUID, MaxLength, IsInt, Min, Max,
  ArrayMaxSize,
  ValidateNested} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── AI Chat ──

export class AiChatSoapDto {
  @IsOptional() @IsString() @MaxLength(20000) subjective?: string;
  @IsOptional() @IsString() @MaxLength(20000) objective?: string;
  @IsOptional() @IsString() @MaxLength(20000) assessment?: string;
  @IsOptional() @IsString() @MaxLength(20000) plan?: string;
}

/**
 * 어시스턴트 맥락 계약(shared `AiChatContextPayload` 와 같은 키) — 2026-10-02 재구성.
 * 🔴 종전 `Record<string, unknown>` 은 화면이 보내는 키(patientName·encounterData)와 서버가 읽는 키(soap·age·sex)가
 *    하나도 겹치지 않았다. 나이·성별은 받지 않는다(서버가 환자 원장에서 읽는다).
 */
export class AiChatContextDto {
  @IsOptional() @IsUUID() patientId?: string;
  @IsOptional() @IsUUID() encounterId?: string;
  @IsOptional() @ValidateNested() @Type(() => AiChatSoapDto) soap?: AiChatSoapDto;
  @IsOptional() @IsString() @MaxLength(100) department?: string;
}

export class AiChatDto {
  @ApiProperty({ description: '메시지 (슬래시 커맨드 포함)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  message: string;

  @ApiPropertyOptional({ description: '맥락 — patientId·encounterId·작성 중 SOAP·진료과' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiChatContextDto)
  context?: AiChatContextDto;
}

// ── SOAP 자동 구조화 ──

export class AiSummarizeDto {
  @ApiProperty({ description: '진료 텍스트' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  text: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  specialty?: string;
}

// ── 감별진단 ──

export class AiDiagnoseDto {
  @ApiProperty({ description: '증상 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  symptoms: string[];

  @ApiPropertyOptional({ description: '활력징후' })
  @IsOptional()
  vitals?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '검사 결과' })
  @IsOptional()
  labs?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '과거력' })
  @IsOptional()
  @IsString()
  history?: string;

  @ApiPropertyOptional({ description: '나이' })
  @IsOptional()
  @IsNumber()
  age?: number;

  @ApiPropertyOptional({ description: '성별' })
  @IsOptional()
  @IsString()
  sex?: string;
}

// ── 약물 정보 ──

export class AiDrugInfoDto {
  @ApiProperty({ description: '약물 검색어' })
  @IsString()
  @IsNotEmpty()
  query: string;
}

// ── 환자 설명문 생성 ──

export class AiExplainDto {
  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiProperty({ description: '치료 계획' })
  @IsString()
  @IsNotEmpty()
  treatmentPlan: string;

  @ApiPropertyOptional({ description: '환자 이해 수준' })
  @IsOptional()
  @IsString()
  patientLevel?: string;
}

// ── 의무기록 초안 ──

export class AiDraftDto {
  @ApiProperty({ description: '기록 유형' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: '기록 데이터' })
  data: Record<string, unknown>;
}

// ── 트리아지 ──

export class AiTriageDto {
  @ApiProperty({ description: '증상' })
  @IsString()
  @IsNotEmpty()
  symptom: string;

  /**
   * 🔴 나이·성별은 KTAS 판정에 영향을 준다(소아·고령 가중). `MedicalAiService.triage()` 는 처음부터
   *    이 파라미터를 받도록 만들어져 있었는데 **DTO 에 키가 없어 whitelist 가 지웠고 컨트롤러도
   *    넘기지 않았다** — 응급 화면이 보내던 `age` 가 한 번도 AI 에 닿은 적이 없다.
   *    모르는 값은 보내지 않는다(추정 금지) — 미전송이면 종전과 같이 증상만으로 판정한다.
   */
  @ApiPropertyOptional({ description: '만 나이 — 미상이면 보내지 않는다(추정 금지)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  age?: number;

  @ApiPropertyOptional({ description: '성별(M/F) — 미상이면 보내지 않는다' })
  @IsOptional()
  @IsString()
  sex?: string;
}

// ── 의학 참고 (RAG) ──

export class AiReferenceDto {
  @ApiProperty({ description: '질문' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;
}

// ── 피드백 ──

export class AiFeedbackDto {
  @ApiProperty({ description: '평점 (good/bad)' })
  @IsString()
  @IsNotEmpty()
  rating: string;

  @ApiPropertyOptional({ description: '코멘트' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class AiFeedbackCreateDto {
  @ApiProperty({ description: '기능(ddx/soap/drug/lab/qa 등)' })
  @IsString() @IsNotEmpty()
  feature: string;

  @ApiProperty({ description: '평점 (GOOD/BAD)' })
  @IsIn(['GOOD', 'BAD'])
  rating: string;

  @ApiPropertyOptional({ description: '코멘트' })
  @IsOptional() @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'AI 응답 요약(감사용)' })
  @IsOptional() @IsString()
  aiResponse?: string;
}


// ── 실시간 감별진단 ──

export class AiRealtimeDdxDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '주관적 소견 (S)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  subjective: string;

  @ApiPropertyOptional({ description: '객관적 소견 (O)' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  objective?: string;

  @ApiPropertyOptional({ description: '기존 진단 목록', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingDiagnoses?: string[];
}

// ── SOAP 자동 초안 ──

export class AiAutoSoapDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '주관적 소견 (S)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  subjective: string;

  @ApiPropertyOptional({ description: '객관적 소견 (O)' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  objective?: string;

  @ApiPropertyOptional({ description: 'PHI 최소화 — 기본 true(성명 미전송). 명시적 false만 실명 포함' })
  @IsOptional()
  @IsBoolean()
  deidentify?: boolean;

  /**
   * 🔴 제안 원장(`AiProposal.targetId`) 전용 — 초안이 **무엇에 대한 것인가**를 남기기 위한 값이다.
   *    신규 진료 화면은 저장 전이라 진료(Encounter)가 아직 없을 수 있다 → 그때는 보내지 않고,
   *    서버가 `targetKey` 로 "아직 만들어지지 않은 진료(환자 지목)"를 밝힌다(대상을 추정하지 않는다).
   *    프롬프트에는 들어가지 않는다(외부 AI 로 나가는 값이 아니다).
   */
  @ApiPropertyOptional({ description: '진료 ID(있으면 제안 원장의 대상이 된다 · 신규 진료는 미확정이라 생략 가능)' })
  @IsOptional()
  @IsString()
  encounterId?: string;

  @ApiPropertyOptional({ description: '감별진단 목록' })
  @IsOptional()
  @IsArray()
  differentials?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: '현재 복용약 목록', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingMedications?: string[];
}

// ── 검사 결과 AI 해석 ──

export class LabResultForInterpretDto {
  @ApiProperty({ description: '검사명' })
  @IsString()
  testName: string;

  @ApiProperty({ description: '결과값' })
  @IsString()
  value: string;

  @ApiPropertyOptional({ description: '단위' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: 'LIS flag(H/L/HH/LL/N) — 기준치가 없어도 방향의 정본' })
  @IsOptional()
  @IsString()
  flag?: string | null;

  @ApiPropertyOptional({ description: '정상범위 최소' })
  @IsOptional()
  @IsNumber()
  normalMin?: number;

  @ApiPropertyOptional({ description: '정상범위 최대' })
  @IsOptional()
  @IsNumber()
  normalMax?: number;
}

export class AiInterpretLabDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '검사 결과 목록', type: [LabResultForInterpretDto] })
  @IsArray()
  results: { testName: string; value: string; unit?: string; normalMin?: number; normalMax?: number; flag?: string | null }[];

  @ApiPropertyOptional({ description: '임상 컨텍스트' })
  @IsOptional()
  @IsString()
  clinicalContext?: string;
}

// ── 약물 추천 ──

/**
 * 🔴 인라인 객체 타입은 런타임 metatype 이 `Object` 라 **ValidationPipe 가 통째로 스킵된다**
 * (이 저장소 실측 결함). 그래서 `eGFR` 이 검증 없이 용량 프롬프트로 들어갔다 —
 * 음수·문자열·비정상 값이 그대로 모델에게 전달되면 **용량 판단이 그 위에서 이뤄진다.**
 * 클래스 + `@ValidateNested` 로 실제 검증이 돌게 한다.
 *
 * 🔴 상한은 넉넉히 둔다 — **막는 것이 목적이 아니라 말이 되지 않는 값을 거르는 것**이다
 * (막으면 방치된다: 임상값을 좁게 강제하면 사람이 아무 값이나 넣어 통과시킨다).
 */
export class AiPatientContextDto {
  @ApiPropertyOptional({ description: '나이(년)' })
  @IsOptional() @IsInt() @Min(0) @Max(150)
  age?: number;

  @ApiPropertyOptional({ description: 'eGFR (mL/min/1.73㎡)' })
  @IsOptional() @IsNumber() @Min(0) @Max(250)
  eGFR?: number;

  @ApiPropertyOptional({ description: '알레르기 목록', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50)
  allergies?: string[];

  @ApiPropertyOptional({ description: '현재 복용약 목록', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(100)
  currentMedications?: string[];
}

export class AiRecommendDrugsDto {
  @ApiProperty({ description: '환자 ID' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiPropertyOptional({ description: '환자 컨텍스트 (나이, eGFR, 알레르기 등)', type: () => AiPatientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiPatientContextDto)
  patientContext?: AiPatientContextDto;

  @ApiPropertyOptional({ description: '진료 ID — DUR 정본 재검증(durVerdict)이 볼 진료. 없으면 환자의 최근 진료, 그것도 없으면 임신 여부·현 진료 처방 점검이 생략된다(basis 에 명시)' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;
}

// ── 의무기록 품질검사 ──

export class ChartQaPrescriptionDto {
  @ApiProperty({ description: '약품명' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '용량' })
  @IsOptional()
  @IsString()
  dosage?: string;
}

export class AiChartQaDto {
  /** 저장 전 진료(폼 값만 있는 상태)에서도 기록품질을 볼 수 있어야 한다 — 2026-08-19 실측: 필수라 새 진료에서 400·패널은 침묵 */
  @ApiPropertyOptional({ description: '진료 ID(저장 전이면 생략)' })
  @IsOptional()
  @IsString()
  encounterId?: string;

  @ApiProperty({ description: '주관적 소견 (S)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  subjective: string;

  @ApiPropertyOptional({ description: '객관적 소견 (O)' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  objective?: string;

  @ApiPropertyOptional({ description: '평가 (A)' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  assessment?: string;

  @ApiPropertyOptional({ description: '계획 (P)' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  plan?: string;

  @ApiPropertyOptional({ description: '처방 목록' })
  @IsOptional()
  @IsArray()
  prescriptions?: { name: string; dosage?: string }[];

  @ApiPropertyOptional({ description: '진단 목록', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnoses?: string[];
}

// ── 환자 교육문 생성 ──

export class AiPatientEducationDto {
  @ApiProperty({ description: '진단명' })
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @ApiPropertyOptional({ description: '치료 계획' })
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @ApiPropertyOptional({ description: '복용약 목록', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medications?: string[];

  @ApiPropertyOptional({ description: '환자 나이' })
  @IsOptional()
  @IsNumber()
  patientAge?: number;

  @ApiPropertyOptional({ description: '언어' })
  @IsOptional()
  @IsString()
  language?: string;
}

// ── 임상 번역 ──

export class AiClinicalTranslateDto {
  @ApiProperty({ description: '번역할 의학 텍스트' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  text: string;
}

// ── 약물 상호작용 ──

export class AiDrugInteractionsDto {
  @ApiProperty({ description: '약물 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  drugs: string[];
}

// ── 지식관리: 색인 ──

export class AiKnowledgeIndexDto {
  @ApiProperty({ description: '제목' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '내용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;

  @ApiProperty({ description: '카테고리' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiPropertyOptional({ description: '출처' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: '공유 여부' })
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

// ── 지식관리: 검색 ──

export class AiKnowledgeSearchDto {
  @ApiProperty({ description: '검색 쿼리' })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '결과 수 제한' })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

// ── 오케스트레이터 실행 ──

export class AiOrchestratorRunDto {
  @ApiProperty({ description: '워크플로우 이름' })
  @IsString()
  @IsNotEmpty()
  workflow: string;

  @ApiProperty({ description: '입력 데이터' })
  @IsNotEmpty()
  input: object;
}

// ── 트리아지 후속 질문 ──

export class AiTriageFollowUpDto {
  @ApiProperty({ description: '증상' })
  @IsString()
  @IsNotEmpty()
  symptom: string;
}

// ── 임상 질문 답변 ──

export class AiClinicalQaDto {
  @ApiProperty({ description: '임상 질문' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  question: string;

  @ApiPropertyOptional({ description: '환자 컨텍스트' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  patientContext?: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional()
  @IsString()
  specialty?: string;
}

// ══════════════════════════════════════════════
// v2.48.0 신규 DTO
// ══════════════════════════════════════════════

export class AiCliExecuteDto {
  @ApiProperty({ description: '역할 (reception/billing/nurse/doctor/claims)' })
  @IsString() @IsNotEmpty()
  role: string;

  @ApiProperty({ description: '자연어 명령' })
  @IsString() @IsNotEmpty()
  command: string;
}

export class AiCliSuggestDto {
  @ApiProperty({ description: '역할' })
  @IsString() @IsNotEmpty()
  role: string;

  @ApiProperty({ description: '입력 중인 텍스트' })
  @IsString()
  partial: string;
}

export class AiCodeSearchDto {
  @ApiProperty({ description: '검색어 (질병명/코드/수가명)' })
  @IsString() @IsNotEmpty()
  query: string;
}

export class AiCodeMappingDto {
  @ApiProperty({ description: '질병 코드 (KCD)' })
  @IsString() @IsNotEmpty()
  diseaseCode: string;
}

export class AiReasoningChainDto {
  @ApiProperty({ description: '증상 목록' })
  @IsArray() @IsString({ each: true })
  symptoms: string[];

  @ApiPropertyOptional() @IsOptional() @IsNumber() age?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sex?: string;
  @ApiPropertyOptional() @IsOptional() vitals?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() labs?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() history?: string;
}

export class AiAutoRecordDto {
  @ApiProperty({ description: '진료 대화 텍스트' })
  @IsString() @IsNotEmpty() @MaxLength(20000)
  conversation: string;

  @ApiPropertyOptional({ description: '진료과' })
  @IsOptional() @IsString()
  specialty?: string;
}

export class AiPredictReadmissionDto {
  @ApiProperty() @IsNumber() age: number;
  @ApiProperty() @IsString() sex: string;
  @ApiProperty() @IsArray() diagnoses: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() procedures?: string[];
  /** 입원(admissionId)을 주면 서버가 기록에서 계산한다 — 둘 다 없으면 400(추정하지 않는다) */
  @ApiPropertyOptional() @IsOptional() @IsNumber() lengthOfStay?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() previousAdmissions?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() comorbidities?: string[];
  /** 2026-10-07 — 권장 키(Hb·Na·응급 경유·입원 중 수술·1년 내 입원)를 기록에서 채운다 */
  @ApiPropertyOptional() @IsOptional() @IsUUID() admissionId?: string;
}

export class AiPredictComplicationDto {
  @ApiProperty() @IsNumber() age: number;
  @ApiProperty() @IsString() sex: string;
  @ApiProperty() @IsString() diagnosis: string;
  @ApiPropertyOptional() @IsOptional() @IsString() procedure?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() comorbidities?: string[];
  @ApiPropertyOptional() @IsOptional() vitals?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() labs?: Record<string, unknown>;
}

export class AiPredictAdverseDrugDto {
  @ApiProperty() @IsArray() drugs: string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() age?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sex?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() diagnoses?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() allergies?: string[];
}

/**
 * 🔴 영상 URL 기반 외부 AI 분석 — **서버 입구**.
 *
 * 2026-08-18 화면(FE)에서 `clinicalInfo` 로 **환자 성명이 외부 AI 로 나가던 것**을 봉합했지만,
 * 이 입구는 **동의 게이트도 길이 제한도 없이** 그대로 열려 있었다. FE 만 고친 봉합은 다음 호출자
 * (다른 화면·다른 서비스·스크립트)가 생기면 되살아난다 — "고쳤다"가 아래층 때문에 되살아난다.
 *   → 같은 컨트롤러 `vision/medical/analyze` 와 **동일한 계약**(동의 필수·clinicalInfo 4000자 상한·
 *     감사 귀속용 patientId 선택)으로 맞춘다.
 */
export class AiVisionAnalyzeDto {
  @ApiProperty({ description: '영상 URL' })
  @IsString() @IsNotEmpty()
  imageUrl: string;

  @ApiProperty({ description: 'modality (xray/ct/mri/ultrasound/pathology/fundus/dermoscopy)' })
  @IsString() @IsNotEmpty()
  modality: string;

  @ApiProperty({ description: 'body part' })
  @IsString() @IsNotEmpty()
  bodyPart: string;

  @ApiPropertyOptional({ description: '임상 정보 — ⚠️ 외부 AI 로 원문 전송된다. 환자 성명·연락처를 넣지 말 것' })
  @IsOptional() @IsString() @MaxLength(4000)
  clinicalInfo?: string;

  @ApiPropertyOptional({ description: '대상 환자 UUID — 감사 귀속용(모르면 생략. 추정 금지)' })
  @IsOptional() @IsUUID()
  patientId?: string;

  @ApiProperty({ description: '의료영상 외부 AI 전송 동의 확인(필수)' })
  @IsBoolean()
  consent: boolean;
}

export class AiVisionCompareDto extends AiVisionAnalyzeDto {
  @ApiProperty({ description: '이전 영상 URL' })
  @IsString() @IsNotEmpty()
  previousImageUrl: string;
}

export class IdCardOcrDto {
  @ApiProperty({ description: '신분증 이미지(base64/data URL). ⚠️ 서버 비저장(메모리 처리)' })
  @IsString() @IsNotEmpty()
  image: string;

  @ApiPropertyOptional({ description: 'RRN_CARD | DRIVER_LICENSE', default: 'RRN_CARD' })
  @IsOptional() @IsString()
  docType?: string;

  @ApiProperty({ description: '신분증 OCR 처리 동의(필수)' })
  @IsBoolean()
  consent: boolean;
}

/**
 * 🔴 의료영상 외부 AI 전송(MedGemma) — 같은 컨트롤러의 `id-ocr` 에는 `CONSENT_REQUIRED` 게이트가 있는데
 * 이 경로에는 없었다(최대 15MB 의 의료영상이 동의 확인 없이 외부로 나갔다).
 * 또한 인라인 `@Body() body: {...}` 라 **ValidationPipe 가 스킵**되던 경로다(저장소 기지의 함정)
 *   → DTO 로 승격 + `id-ocr` 과 동일한 동의 게이트.
 * `patientId` 는 **선택**이다 — 감사에 "누구의"를 담기 위한 것이며, 모르면 비워 둔다(추정 금지).
 */
export class AiVisionMedicalAnalyzeDto {
  @ApiProperty({ description: '영상 base64(최대 ~11MB)' })
  @IsString() @IsNotEmpty()
  imageBase64: string;

  @ApiProperty({ description: 'modality (xray/ct/mri/ultrasound/pathology/fundus/dermoscopy)' })
  @IsString() @IsNotEmpty()
  modality: string;

  @ApiProperty({ description: 'body part' })
  @IsString() @IsNotEmpty()
  bodyPart: string;

  @ApiPropertyOptional({ description: '임상 정보' })
  @IsOptional() @IsString() @MaxLength(4000)
  clinicalInfo?: string;

  @ApiPropertyOptional({ description: '대상 환자 UUID — 감사 귀속용(모르면 생략. 추정 금지)' })
  @IsOptional() @IsUUID()
  patientId?: string;

  @ApiProperty({ description: '의료영상 외부 AI 전송 동의 확인(필수)' })
  @IsBoolean()
  consent: boolean;
}

/** 상담 대화 — 인라인 @Body(ValidationPipe 스킵) 승격 */
export class AiCounselingChatDto {
  @ApiProperty({ description: '상담 메시지' })
  @IsString() @IsNotEmpty() @MaxLength(20000)
  message: string;

  @ApiPropertyOptional({ description: '세션 ID' })
  @IsOptional() @IsString()
  session_id?: string;
}

/** 회의 녹화 분석 요청 — 출처(metadata.source)는 서버가 확정하므로 클라이언트 지정 불가 */
export class AiMeetingAnalyzeDto {
  @ApiProperty({ description: '녹화 파일 URL' })
  @IsString() @IsNotEmpty()
  file_url: string;

  @ApiPropertyOptional({ description: '콜백 URL' })
  @IsOptional() @IsString()
  callback_url?: string;

  @ApiPropertyOptional({ description: '분석 옵션' })
  @IsOptional()
  options?: Record<string, boolean>;

  @ApiPropertyOptional({ description: '회의 메타(room_name 등)' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/** AI 초안이 적용된 자원 종류 — 화면이 문구가 아니라 코드로 말한다 */
export const AI_DRAFT_RESOURCE_TYPES = ['ENCOUNTER_SOAP', 'DISCHARGE_SUMMARY', 'REFERRAL', 'CONSENT', 'VOC_REPLY', 'CHECKUP_OPINION', 'MDT_SUMMARY', 'OTHER'] as const;
/** 초안을 만든 경로 */
// 🔴 FE `components/ai/DraftBanner.tsx` `DraftSource` 와 집합 일치(가드 `apps/web/test/ui/voice-dictate-append-canon.spec.ts`).
//    한쪽에만 더하면 ValidationPipe 가 400 을 내고 배너는 "감사기록에 남기지 못했습니다"를 그린다.
export const AI_DRAFT_SOURCES = ['ASSISTANT', 'REASONING', 'AUTO_RECORD', 'SCRIBE', 'AMBIENT', 'GENERATOR', 'DICTATE'] as const;

/**
 * 🔴 초안≠확정 — 적용 시 프로비넌스 이전(clinical-ux-agent-era.plan §7.6-b).
 * 패널 안에서는 "AI 초안"이던 글이 폼에 들어가는 순간 사람이 쓴 글자와 같아진다. 스키마 프로비넌스가 없는 자원
 * (진료 AI 보조·퇴원요약 등)은 **적용 사실을 감사 원장에 남긴다**(Encounter.aiScribed 는 스크라이브 전용).
 * 스키마 프로비넌스 일반화(Encounter.aiAssistSource 등)는 사람 게이트 — 그 전까지 이 원장이 유일한 흔적이다.
 */
export class AiDraftAppliedDto {
  @ApiProperty({ enum: AI_DRAFT_RESOURCE_TYPES }) @IsIn(AI_DRAFT_RESOURCE_TYPES as unknown as string[]) resourceType!: (typeof AI_DRAFT_RESOURCE_TYPES)[number];
  @ApiProperty({ enum: AI_DRAFT_SOURCES }) @IsIn(AI_DRAFT_SOURCES as unknown as string[]) source!: (typeof AI_DRAFT_SOURCES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) field?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) promptVersion?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) textLength!: number;
}

/**
 * 🔴 무수정 승인율(human_edit_ratio) 계측 입력 — 기획서 chart-ai-assistant-agent §4.5·§4.6.
 *
 * 초안(draftText)과 사람이 확정한 최종본(finalText)을 받아 **서버가 편집 거리만 계산**하고
 * 숫자·플래그만 남긴다. 스키마(사람 게이트) 전까지 감사 원장이 유일한 원장이다.
 *
 * 🔴 본문은 계산에만 쓰고 **응답에도 감사행에도 싣지 않는다**(PHI). 그래서 이 DTO 는 요청 전용이다.
 */
export class AiDraftOutcomeDto {
  @ApiProperty({ enum: AI_DRAFT_RESOURCE_TYPES }) @IsIn(AI_DRAFT_RESOURCE_TYPES as unknown as string[]) resourceType!: (typeof AI_DRAFT_RESOURCE_TYPES)[number];
  @ApiProperty({ enum: AI_DRAFT_SOURCES }) @IsIn(AI_DRAFT_SOURCES as unknown as string[]) source!: (typeof AI_DRAFT_SOURCES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) field?: string;
  @ApiProperty({ description: 'AI 초안 원문(계산에만 사용 — 저장하지 않는다)' }) @IsString() @MaxLength(20000) draftText!: string;
  @ApiProperty({ description: '사람이 확정한 최종본(계산에만 사용 — 저장하지 않는다)' }) @IsString() @MaxLength(20000) finalText!: string;
}
