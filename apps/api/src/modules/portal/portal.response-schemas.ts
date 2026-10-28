/**
 * 🔴 모바일 계약 응답 스키마 — **서버가 실제로 반환하는 필드**만 적는다 (2026-08-31).
 *
 * 근거: 앱이 서버 응답에 없는 필드를 읽어 공지 날짜·검사 날짜가 빈칸/오표시된 사고가 있었다
 * (date≠createdAt · orderedAt≠completedAt). 핵심 EP 의 응답 필드를 계약에 못박아 재발 시
 * OpenAPI 대조로 드러나게 한다. 여기 필드는 portal.service.ts 의 select/map 을 읽어 확정한 것이며,
 * 가정으로 채우지 않는다 — 서비스 반환이 바뀌면 이 파일도 같이 고친다(mobile-openapi-contract 가드).
 */
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/** `{ data, meta }` 봉투로 감싼다 — 전 응답 공통 계약 */
export const envelope = (data: SchemaObject): SchemaObject => ({
  type: 'object',
  properties: { data, meta: { type: 'object', nullable: true } },
  required: ['data'],
});
const arr = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const S = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: 'object', properties });

// ── 인증 ──
export const LoginResult = envelope(S({
  accountId: { type: 'string', format: 'uuid' },
  patientId: { type: 'string', format: 'uuid' },
  patientName: { type: 'string', example: '홍길동' },
  mrn: { type: 'string', example: 'M000123' },
  accessToken: { type: 'string' },
  refreshToken: { type: 'string' },
  expiresAt: { type: 'string', format: 'date-time', description: '🔴 access 만료 — 토큰 exp 에서 산출(하드코딩 금지)' },
}));
export const RefreshResult = envelope(S({
  accessToken: { type: 'string' },
  refreshToken: { type: 'string', description: '회전 refresh — 재사용 탐지' },
  expiresAt: { type: 'string', format: 'date-time' },
  refreshExpiresAt: { type: 'string', format: 'date-time' },
  deviceId: { type: 'string' },
}));

// ── 환자 데이터 ──
export const LabResults = envelope(arr(S({
  id: { type: 'string' },
  orderName: { type: 'string', description: '🔴 completedAt 이 아니라 이 이름을 쓴다' },
  orderedAt: { type: 'string', format: 'date-time', nullable: true, description: '🔴 완료시각을 이 이름으로 정규화(completedAt 아님)' },
  release: { type: 'string', enum: ['REVIEWED', 'AWAITING_REVIEW'], description: '🔴 2026-10-20 결정 portal.labResultRelease — 의료진 확인 전이면 판정(flag) 없음' },
  reviewedAt: { type: 'string', format: 'date-time', nullable: true, description: '의사 결과 확인 시각(검진은 종합판정 서명 시각)' },
  items: arr(S({
    name: { type: 'string' },
    value: { type: 'string', description: 'PENDING 위급값이면 "담당의 확인 중"' },
    unit: { type: 'string' },
    flag: { type: 'string', description: 'N·H·L·HH·LL·A·AA 등 · 의료진 확인 전이면 빈 문자열' },
    pendingReview: { type: 'boolean', nullable: true, description: '담당의 미확인 위급값 마스킹' },
    judgmentPending: { type: 'boolean', nullable: true, description: '의료진 확인 전 — 판정을 비웠다' },
  })),
})));
export const Billings = envelope(arr(S({
  id: { type: 'string' },
  totalAmount: { type: 'number' },
  insuranceCovered: { type: 'number' },
  patientCopay: { type: 'number' },
  paidAmount: { type: 'number' },
  status: { type: 'string', example: 'PAID' },
  paidAt: { type: 'string', format: 'date-time', nullable: true },
  createdAt: { type: 'string', format: 'date-time' },
  encounter: S({ doctor: S({ familyName: { type: 'string' }, givenName: { type: 'string' }, department: { type: 'string' } }) }),
})));
export const Medications = envelope(arr(S({
  id: { type: 'string' },
  medicationCodeId: { type: 'string', nullable: true },
  name: { type: 'string' },
  code: { type: 'string' },
  dosage: { type: 'string', nullable: true },
  frequency: { type: 'string', nullable: true },
  duration: { type: 'string', nullable: true },
  route: { type: 'string', nullable: true },
  prescribedAt: { type: 'string', format: 'date-time' },
  doctor: { type: 'string', nullable: true },
  department: { type: 'string', nullable: true },
})));
export const Vaccinations = envelope(arr(S({
  id: { type: 'string' },
  vaccineName: { type: 'string' },
  vaccineCode: { type: 'string', nullable: true },
  doseNumber: { type: 'integer', nullable: true },
  administeredAt: { type: 'string', format: 'date-time' },
  nextDueAt: { type: 'string', format: 'date-time', nullable: true },
  administeredBy: { type: 'string', nullable: true },
  location: { type: 'string', nullable: true },
  lotNumber: { type: 'string', nullable: true },
  notes: { type: 'string', nullable: true },
})));
export const Encounters = envelope(arr(S({
  id: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  // 🔴 2026-10-20 결정 portal.visitSummaryScope = GENERAL — 의사 소견 원문(assessment·plan)은 싣지 않는다
  doctor: S({ familyName: { type: 'string' }, givenName: { type: 'string' }, department: { type: 'string' } }),
  diagnoses: arr(S({ type: { type: 'string' }, certainty: { type: 'string', nullable: true }, diagnosisCode: S({ code: { type: 'string' }, nameKo: { type: 'string' } }) })),
})));
/** 진료 후 요약(B2 · 일반 수준) */
export const VisitSummary = envelope(S({
  encounterId: { type: 'string' },
  visitedAt: { type: 'string', format: 'date-time' },
  signedAt: { type: 'string', format: 'date-time', nullable: true },
  department: { type: 'string', nullable: true },
  doctorName: { type: 'string', nullable: true },
  scope: { type: 'string', enum: ['GENERAL'] },
  diagnoses: arr(S({ name: { type: 'string', nullable: true }, code: { type: 'string', nullable: true }, primary: { type: 'boolean' }, provisional: { type: 'boolean' } })),
  medications: arr(S({
    name: { type: 'string', nullable: true }, dosage: { type: 'string', nullable: true }, frequency: { type: 'string', nullable: true },
    durationDays: { type: 'integer', nullable: true }, route: { type: 'string', nullable: true }, instructions: { type: 'string', nullable: true },
    discontinued: { type: 'boolean' }, dischargeMed: { type: 'boolean' },
  })),
  orders: arr(S({ type: { type: 'string' }, name: { type: 'string', nullable: true } })),
  nextAppointment: { ...S({ id: { type: 'string' }, scheduledAt: { type: 'string', format: 'date-time' }, department: { type: 'string', nullable: true }, doctorName: { type: 'string', nullable: true } }), nullable: true },
  hospitalPhone: { type: 'string', nullable: true },
}));
/** 예약 진료 예상 본인부담(B6 · 예측 자료) */
export const CostEstimate = envelope(S({
  appointmentId: { type: 'string' },
  estimate: { type: 'boolean', enum: [true], description: '🔴 늘 예측 자료 — 확정 금액이 아니다' },
  consultation: S({
    code: { type: 'string', nullable: true, description: '종별 진찰료 코드 — 요양기관 종별 설정값을 모르면 null' }, name: { type: 'string', nullable: true }, visitKind: { type: 'string', enum: ['INITIAL', 'FOLLOW_UP'] },
    totalAmount: { type: 'number', nullable: true }, patientCopay: { type: 'number', nullable: true, description: '단가 미등재·0원·요율 모름이면 null' },
    basis: { type: 'string', enum: ['ELIGIBILITY', 'INSURANCE_TYPE_FALLBACK', 'UNKNOWN'] }, unknownReason: { type: 'string', nullable: true },
  }),
  recent: S({
    department: { type: 'string', nullable: true }, sampleSize: { type: 'integer' },
    min: { type: 'number', nullable: true }, max: { type: 'number', nullable: true },
  }),
}));
export const Allergies = envelope(arr(S({
  id: { type: 'string' },
  allergen: { type: 'string' },
  reaction: { type: 'string', nullable: true },
  severity: { type: 'string', nullable: true },
  isActive: { type: 'boolean' },
})));
export const Notices = envelope(arr(S({
  id: { type: 'string' },
  title: { type: 'string', nullable: true },
  content: { type: 'string' },
  date: { type: 'string', format: 'date-time', description: '🔴 createdAt 아님 — date 를 읽는다' },
})));
