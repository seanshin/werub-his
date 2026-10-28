# Hospital RUN Detailed Design Document

> **Version**: 0.5
> **Created**: 2026-05-06
> **Author**: user
> **Status**: Draft
> **Reviewers**: -
> **Planning Doc**: [hospital-run.plan.md](../../01-plan/features/hospital-run.plan.md)

### Pipeline References

| Phase | Document | Status |
|-------|----------|--------|
| Phase 1 | Schema Definition | N/A (본 문서에서 정의) |
| Phase 2 | Coding Conventions | N/A (본 문서에서 정의) |
| Phase 3 | Mockup | N/A (Phase 2 이후) |
| Phase 4 | API Spec | N/A (본 문서에서 정의) |

---

## 1. Executive Summary

### 1.1 Purpose

HospitalRun, EtherCIS/EHRBase, Medplum 3개 오픈소스를 참고하여 Enterprise급 병원 정보 시스템(HIS)을 최신 스택으로 리빌드한다. FHIR R4 표준 API + openEHR 스타일 내부 데이터 모델 + 오프라인 우선 설계를 결합한 차세대 HIS를 구축한다.

### 1.2 Scope

**포함**: MVP(Phase 1) — 환자 관리, RBAC, 예약, FHIR Patient API, 감사 로그(기본), **한국 의료코드 마스터(KCD, EDI, 약품코드)**
**제외**: Phase 2~5 기능 (OCS, 진료기록, 건강보험 청구, DUR, 수납, 오프라인 동기화 등)은 별도 Design 문서로 분리

### 1.3 Goals

- FHIR R4 표준 호환 Patient API 제공
- 5개 역할(Admin, Doctor, Nurse, Pharmacist, Lab Tech) RBAC 구현
- 모듈러 모놀리스 아키텍처로 시작하여 점진적 서비스 분리 가능한 구조
- Phase별 NFR 차등 적용 (MVP: 동시 50명, Phase 3+: 500명)

### 1.4 Design Principles

- **Clean Architecture**: 레이어 간 단방향 의존성, Domain 레이어는 외부 의존성 없이 순수 유지
- **FHIR-first External Interface**: 외부 연동은 FHIR R4 표준 API, 내부는 도메인 최적화 REST API
- **Separation of Concerns**: NestJS 모듈 단위로 관심사 분리, 모듈 간 느슨한 결합
- **Domain-Driven Design**: 의료 도메인 용어를 코드에 그대로 반영 (Ubiquitous Language)
- **Security by Design**: PHI 데이터 암호화, 감사 로그, RBAC을 후순위가 아닌 기본 설계에 포함
- **Progressive Enhancement**: MVP → Phase별 점진 확장, 모듈러 모놀리스 → 마이크로서비스
- **Configuration over Code** (from O3): 병원별 커스터마이징을 코드 변경 없이 JSON 설정으로 해결
- **Extension/Slot Pattern** (from O3): UI를 슬롯 기반으로 설계하여 제3자 모듈 동적 확장 지원 (Phase 4)

### 1.5 Architecture Decision Records (ADR)

#### ADR-001: 인증 방식 — NextAuth.js v5 → Custom JWT

| 항목 | 내용 |
|------|------|
| **상태** | Accepted |
| **맥락** | Plan 단계에서 NextAuth.js v5를 선정했으나, 의료 시스템의 세밀한 RBAC 구현 시 제약 발견 |
| **결정** | Custom JWT(Access 15min + Refresh 7d) + Redis 세션 + bcrypt 방식으로 전환 |
| **근거** | (1) NextAuth는 소셜 로그인에 최적화되어 있으나 5개 역할 + 리소스별 퍼미션 매트릭스 구현에 커스터마이징 과다 (2) Refresh Token의 Redis 저장/무효화를 직접 제어해야 의료 세션 보안 요구사항 충족 (3) 추후 SMART-on-FHIR 인증 레이어 추가 시 Custom JWT가 더 유연 |
| **영향** | Plan 문서 6.2의 Auth 결정을 "Custom JWT + RBAC Guard"로 업데이트 필요 |

#### ADR-002: 한국형 이름 체계 — firstName/lastName → familyName/givenName

| 항목 | 내용 |
|------|------|
| **상태** | Accepted |
| **맥락** | 한국형 HIS 타겟으로 전환됨에 따라 이름 표기 체계 결정 필요 |
| **결정** | FHIR R4의 HumanName 구조를 따라 `familyName`(성) + `givenName`(이름) 사용. 한국어 표시 시 `familyName + givenName` 순서로 결합 |
| **근거** | (1) FHIR R4 Patient의 name.family/name.given과 자연스럽게 매핑 (2) 한국 관행(성+이름)과 호환 (3) 영어권 확장 시 given+family 순서만 변경하면 됨 |
| **영향** | Patient, User 엔티티의 firstName/lastName을 familyName/givenName으로 변경 |

#### ADR-003: 환자 식별자 — 주민등록번호 미수집

| 항목 | 내용 |
|------|------|
| **상태** | Accepted |
| **맥락** | 한국 HIS에서 주민등록번호 처리 정책 결정 필요 |
| **결정** | 주민등록번호는 수집하지 않음. 생년월일 + 성별로 대체. 건강보험증번호는 AES-256 암호화 저장 |
| **근거** | (1) 개인정보보호법 민감정보 최소 수집 원칙 (2) 주민번호 수집 시 보안 사고 리스크 극대 (3) HIRA 청구 시 건강보험증번호로 충분 |
| **영향** | Patient에 `insuranceNumber`(암호화) + `insuranceType` 필드 추가. 주민등록번호 필드 없음 |

#### ADR-004: JSON Form Engine — O3 패턴 채택 (Phase 2 FR-13)

| 항목 | 내용 |
|------|------|
| **상태** | Planned (Phase 2 구현 예정) |
| **맥락** | 임상 템플릿(진료 노트, 문진표 등)이 병원/진료과마다 다르므로 동적 폼 시스템 필요 |
| **결정** | OpenMRS O3의 JSON Form Engine 패턴 채택. JSON 스키마로 폼 정의 → 런타임 렌더링 |
| **근거** | (1) O3 Form Engine이 검증된 의료 폼 표준 (2) JSON 스키마 기반으로 코드 변경 없이 폼 추가 가능 (3) 유효성 검사/조건부 렌더링/다국어 지원 내장 (4) openEHR Archetype 개념과 호환 |
| **핵심 설계** | 아래 JSON Form Schema 구조 참조 |

```json
// Hospital RUN Form Schema (O3 Form Engine 참고)
{
  "name": "vital-signs",
  "version": "1.0",
  "locale": "ko",
  "pages": [{
    "label": "바이탈 사인",
    "sections": [{
      "label": "기본 측정",
      "questions": [
        {
          "id": "systolicBP",
          "label": "수축기 혈압",
          "type": "number",
          "unit": "mmHg",
          "validation": { "min": 50, "max": 300, "required": true }
        },
        {
          "id": "temperature",
          "label": "체온",
          "type": "number",
          "unit": "°C",
          "validation": { "min": 30, "max": 45, "required": true },
          "conditionalRender": { "when": "measureTemp", "equals": true }
        }
      ]
    }]
  }]
}
```

**Phase 2 구현 시**: `FormEngineModule` (Backend — 스키마 CRUD) + `FormRenderer` (Frontend — JSON → React 컴포넌트 렌더링)

---

## 2. Non-Functional Requirements (Phase별 차등)

### 2.1 Performance

| Metric | MVP (Phase 1) | Phase 3+ (목표) | Rationale |
|--------|:-------------:|:---------------:|-----------|
| Response time (P95) | < 500ms | < 200ms | MVP에서는 기능 검증 우선 |
| Throughput | > 100 RPS | > 1000 RPS | 단일 병원 → 다중 병원 |
| DB query time | < 100ms | < 50ms | 인덱스 최적화 점진 적용 |
| Concurrent users | 50명 | 500명 | MVP 검증 → 운영 스케일 |

### 2.2 Scalability

- MVP: 단일 인스턴스 (Docker Compose)
- Phase 3+: Kubernetes 수평 확장 (Auto-scaling CPU 70% 기준)
- 예상 성장: 월 10% 데이터 증가 (환자 레코드 기준)

### 2.3 Availability

| 항목 | MVP | Phase 3+ |
|------|-----|----------|
| Target SLA | 99% | 99.9% |
| RTO | < 4시간 | < 1시간 |
| RPO | < 1시간 | < 5분 |

---

## 3. System Architecture

### 3.1 Phase 1~2: 모듈러 모놀리스

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser/PWA)                   │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐               │
│  │ Next.js  │  │  Zustand  │  │ TanStack  │               │
│  │ App      │  │  (State)  │  │  Query    │               │
│  │ Router   │  │           │  │ (Server)  │               │
│  └────┬─────┘  └───────────┘  └───────────┘               │
└───────┼─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                       Nginx (Reverse Proxy)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              NestJS Modular Monolith                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Presentation Layer                   │   │
│  │  AuthController  PatientController  ScheduleController│  │
│  │  FhirController                                      │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │                  Application Layer                    │   │
│  │  AuthService  PatientService  ScheduleService        │   │
│  │  FhirMappingService                                  │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │                    Domain Layer                       │   │
│  │  User  Patient  Appointment  Role  AuditLog          │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │                Infrastructure Layer                   │   │
│  │  PrismaRepository  RedisCache  S3Storage             │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌───────────┐
   │ PostgreSQL │ │   Redis    │ │    S3     │
   │  (Primary) │ │ (Session/  │ │ (Files)   │
   │            │ │  Cache)    │ │           │
   └────────────┘ └────────────┘ └───────────┘
```

### 3.2 NestJS Module Structure

| Module | Responsibility | Dependencies |
|--------|---------------|-------------|
| `AuthModule` | 인증/인가, JWT, RBAC | PrismaModule, RedisModule |
| `PatientModule` | 환자 CRUD, 검색 | PrismaModule, AuthModule |
| `ScheduleModule` | 예약 CRUD, 캘린더 | PrismaModule, AuthModule, PatientModule |
| `FhirModule` | FHIR R4 Patient 리소스 매핑 | PatientModule |
| `CodeMasterModule` | 한국 의료코드 CRUD, 시딩, 검색 (KCD, EDI, 약품) | PrismaModule, AuthModule |
| `AuditModule` | 감사 로그 기록 (글로벌 인터셉터) | PrismaModule |
| `PrismaModule` | DB 연결, 트랜잭션 | - |
| `RedisModule` | 캐시, 세션 스토어 | - |
| `HealthModule` | 헬스체크, 메트릭 | - |

### 3.3 Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│           Controllers, DTOs, Guards, Interceptors            │
│           - @Controller, @Get/@Post/@Put/@Delete             │
│           - Request validation (class-validator + Zod)       │
├─────────────────────────────────────────────────────────────┤
│                    Application Layer                         │
│              Services, Use Cases, Mappers                    │
│           - Business logic orchestration                     │
│           - FHIR ↔ Internal 변환                             │
│           - 트랜잭션 관리                                     │
├─────────────────────────────────────────────────────────────┤
│                      Domain Layer                            │
│          Entities, Value Objects, Repository Interfaces       │
│           - 순수 TypeScript (외부 의존성 없음)                 │
│           - 비즈니스 규칙 검증                                 │
│           - bi-temporal 필드 정의                              │
├─────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                       │
│         Prisma Repositories, Redis, S3, External APIs        │
│           - Domain Repository Interface 구현                  │
│           - DB 쿼리 최적화                                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 Dependency Rules

| From | Can Import | Cannot Import |
|------|-----------|---------------|
| Presentation | Application, Domain | Infrastructure 직접 접근 불가 |
| Application | Domain, Infrastructure (via DI) | Presentation |
| Domain | 없음 (순수 타입/로직) | 모든 외부 레이어 |
| Infrastructure | Domain (Interface 구현) | Application, Presentation |

### 3.5 Data Flow — 환자 등록 시퀀스

```
Client (Browser)          Nginx          NestJS API                    PostgreSQL        Redis
     │                      │                │                            │               │
     │  POST /api/v1/patients│               │                            │               │
     │─────────────────────▶│──────────────▶│                            │               │
     │                      │               │                            │               │
     │                      │               │ [JwtAuthGuard]             │               │
     │                      │               │  Verify Access Token       │               │
     │                      │               │◀───────────────────────────┤               │
     │                      │               │                            │               │
     │                      │               │ [RolesGuard]               │               │
     │                      │               │  Check NURSE/ADMIN role    │               │
     │                      │               │                            │               │
     │                      │               │ [PatientController]        │               │
     │                      │               │  Validate DTO (Zod)        │               │
     │                      │               │                            │               │
     │                      │               │ [PatientService]           │               │
     │                      │               │  Check duplicate MRN       │               │
     │                      │               │─────────────────────────▶│               │
     │                      │               │◀─────────────────────────│               │
     │                      │               │                            │               │
     │                      │               │  Generate MRN (if auto)    │               │
     │                      │               │                            │               │
     │                      │               │ [Transaction]              │               │
     │                      │               │  INSERT patients           │               │
     │                      │               │─────────────────────────▶│               │
     │                      │               │                            │               │
     │                      │               │ [AuditInterceptor]         │               │
     │                      │               │  INSERT audit_logs         │               │
     │                      │               │─────────────────────────▶│               │
     │                      │               │◀─────────────────────────│               │
     │                      │               │                            │               │
     │  201 Created + Patient│              │                            │               │
     │◀─────────────────────│◀─────────────│                            │               │
     │                      │               │                            │               │
```

### 3.6 Data Flow — 환자 정보 수정 (Bi-temporal)

```
Client                    NestJS API                          PostgreSQL
  │                          │                                    │
  │ PUT /api/v1/patients/:id │                                    │
  │─────────────────────────▶│                                    │
  │                          │                                    │
  │                          │ [PatientService.update()]           │
  │                          │                                    │
  │                          │ BEGIN TRANSACTION                   │
  │                          │───────────────────────────────────▶│
  │                          │                                    │
  │                          │ 1. SELECT current patient           │
  │                          │    WHERE id = :id AND valid_to IS NULL
  │                          │───────────────────────────────────▶│
  │                          │◀───────────────────────────────────│
  │                          │                                    │
  │                          │ 2. INSERT INTO patient_history      │
  │                          │    (patient_id, data=snapshot,      │
  │                          │     valid_from, valid_to=NOW(),     │
  │                          │     tx_time=NOW(), changed_by)      │
  │                          │───────────────────────────────────▶│
  │                          │                                    │
  │                          │ 3. UPDATE patients SET              │
  │                          │    fields..., valid_from=NOW(),     │
  │                          │    updated_at=NOW(), updated_by     │
  │                          │    WHERE id = :id                   │
  │                          │───────────────────────────────────▶│
  │                          │                                    │
  │                          │ 4. INSERT audit_logs                │
  │                          │    (action=UPDATE, changes={diff})  │
  │                          │───────────────────────────────────▶│
  │                          │                                    │
  │                          │ COMMIT                              │
  │                          │───────────────────────────────────▶│
  │                          │◀───────────────────────────────────│
  │                          │                                    │
  │ 200 OK + Updated Patient │                                    │
  │◀─────────────────────────│                                    │
```

**Bi-temporal 트랜잭션 규칙:**

```typescript
// PatientService.update() 의사 코드
async updatePatient(id: string, dto: UpdatePatientDto, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 현재 유효한 레코드 조회
    const current = await tx.patient.findFirst({
      where: { id, validTo: null },
    });
    if (!current) throw new PatientNotFoundError(id);

    // 2. 현재 상태를 history에 스냅샷 저장
    await tx.patientHistory.create({
      data: {
        patientId: id,
        data: current,              // JSONB snapshot
        validFrom: current.validFrom,
        validTo: new Date(),         // 이전 버전 종료 시점
        changedBy: userId,
      },
    });

    // 3. 현재 레코드를 새 값으로 갱신 + validFrom 리셋
    const updated = await tx.patient.update({
      where: { id },
      data: {
        ...dto,
        validFrom: new Date(),       // 새 버전 시작 시점
        updatedAt: new Date(),
        updatedBy: userId,
      },
    });

    return updated;
  });
}

// 특정 시점의 환자 상태 조회 (Point-in-time query)
async getPatientAtTime(id: string, pointInTime: Date) {
  // 현재 레코드가 해당 시점에 유효한지 확인
  const current = await this.prisma.patient.findFirst({
    where: {
      id,
      validFrom: { lte: pointInTime },
      OR: [
        { validTo: null },
        { validTo: { gt: pointInTime } },
      ],
    },
  });
  if (current) return current;

  // history에서 해당 시점의 스냅샷 조회
  const history = await this.prisma.patientHistory.findFirst({
    where: {
      patientId: id,
      validFrom: { lte: pointInTime },
      validTo: { gt: pointInTime },
    },
    orderBy: { txTime: 'desc' },
  });
  return history?.data ?? null;
}
```

---

## 4. Data Model

### 4.1 Entity Definitions

#### User (사용자)

```typescript
interface User {
  id: string;                    // UUID
  email: string;                 // unique, login ID
  passwordHash: string;          // bcrypt hashed
  familyName: string;            // 성 (한국: 홍, FHIR: name.family)
  givenName: string;             // 이름 (한국: 길동, FHIR: name.given)
  role: UserRole;                // ADMIN | DOCTOR | NURSE | PHARMACIST | LAB_TECH
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

enum UserRole {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  NURSE = 'NURSE',
  PHARMACIST = 'PHARMACIST',
  LAB_TECH = 'LAB_TECH',
}
```

#### Patient (환자)

**MRN (Medical Record Number) 생성 규칙:**

| 항목 | 규칙 |
|------|------|
| 포맷 | `HR-YYYYMMDD-NNNN` (예: `HR-20260506-0001`) |
| 생성 | 서버 자동 생성 (PatientService.generateMrn()) |
| 유일성 | DB UNIQUE 제약 + 당일 시퀀스 카운터 |
| 불변성 | 생성 후 변경 불가 (수정 API에서 제외) |

```typescript
// MRN 생성 로직 (동시성 안전)
async generateMrn(): Promise<string> {
  const today = format(new Date(), 'yyyyMMdd');
  const prefix = `HR-${today}-`;
  
  // PostgreSQL SEQUENCE 활용으로 race condition 방지
  // fallback: UNIQUE 제약 위반 시 최대 3회 재시도
  for (let attempt = 0; attempt < 3; attempt++) {
    const [result] = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('mrn_daily_seq')
    `;
    const mrn = `${prefix}${String(Number(result.nextval)).padStart(4, '0')}`;
    try {
      return mrn;
    } catch (e) {
      if (attempt === 2) throw e; // 3회 실패 시 에러
    }
  }
  throw new Error('MRN generation failed after 3 attempts');
}

// DB: CREATE SEQUENCE mrn_daily_seq START 1;
// 매일 자정 cron으로 ALTER SEQUENCE mrn_daily_seq RESTART WITH 1;
```

```typescript
interface Patient {
  id: string;                    // UUID (내부 ID)
  mrn: string;                   // Medical Record Number (unique, 자동 생성: HR-YYYYMMDD-NNNN)
  fhirId: string | null;        // FHIR Resource ID (외부 연동용)
  
  // Demographics (ADR-002: familyName/givenName)
  familyName: string;            // 성 (홍)
  givenName: string;             // 이름 (길동)
  dateOfBirth: Date;
  gender: Gender;                // MALE | FEMALE | OTHER | UNKNOWN
  
  // 한국형 보험 정보 (ADR-003)
  insuranceType: InsuranceType;  // 건강보험/의료급여/산재/자보/자비
  insuranceNumber: string | null; // 건강보험증번호 (AES-256 암호화 저장)
  
  // Contact
  phone: string | null;
  email: string | null;
  address: Address | null;       // Value Object (JSON)
  
  // Medical
  bloodType: BloodType | null;
  allergies: string[];           // JSONB array
  
  // Bi-temporal (from EtherCIS pattern)
  validFrom: Date;               // 데이터 유효 시작 시점
  validTo: Date | null;          // 데이터 유효 종료 시점 (null = 현재 유효)
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;             // User ID
  updatedBy: string;             // User ID
}

// Value Objects
interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

enum Gender { MALE = 'MALE', FEMALE = 'FEMALE', OTHER = 'OTHER', UNKNOWN = 'UNKNOWN' }
enum InsuranceType { NHI = 'NHI', MEDICAID = 'MEDICAID', INDUSTRIAL = 'INDUSTRIAL', AUTO = 'AUTO', SELF_PAY = 'SELF_PAY' }
// NHI=국민건강보험, MEDICAID=의료급여, INDUSTRIAL=산재, AUTO=자동차보험, SELF_PAY=자비
enum BloodType { A_POS = 'A+', A_NEG = 'A-', B_POS = 'B+', B_NEG = 'B-', AB_POS = 'AB+', AB_NEG = 'AB-', O_POS = 'O+', O_NEG = 'O-' }
```

#### Appointment (예약)

```typescript
interface Appointment {
  id: string;                    // UUID
  patientId: string;             // FK → Patient
  doctorId: string;              // FK → User (role=DOCTOR)
  
  scheduledAt: Date;             // 예약 일시
  duration: number;              // 분 단위 (기본 30분)
  status: AppointmentStatus;
  type: AppointmentType;
  
  reason: string | null;         // 방문 사유
  notes: string | null;          // 의사 메모
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

enum AppointmentType {
  INITIAL = 'INITIAL',          // 초진
  FOLLOW_UP = 'FOLLOW_UP',     // 재진
  URGENT = 'URGENT',            // 응급
  ROUTINE = 'ROUTINE',          // 정기
}
```

**예약 상태 전이 규칙:**

```
                    ┌──────────────┐
                    │  SCHEDULED   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌──────────┐ ┌──────────┐
       │ CHECKED_IN │ │ CANCELLED│ │  NO_SHOW │
       └──────┬─────┘ └──────────┘ └──────────┘
              │
              ▼
       ┌─────────────┐
       │ IN_PROGRESS │
       └──────┬──────┘
              │
              ▼
       ┌─────────────┐
       │  COMPLETED  │
       └─────────────┘
```

| From | To (허용) | To (불허) |
|------|----------|----------|
| SCHEDULED | CHECKED_IN, CANCELLED, NO_SHOW | IN_PROGRESS, COMPLETED |
| CHECKED_IN | IN_PROGRESS, CANCELLED | SCHEDULED, COMPLETED, NO_SHOW |
| IN_PROGRESS | COMPLETED | 그 외 전부 |
| COMPLETED | (최종 상태 — 전이 불가) | 전부 |
| CANCELLED | (최종 상태 — 전이 불가) | 전부 |
| NO_SHOW | (최종 상태 — 전이 불가) | 전부 |

**예약 충돌 비즈니스 규칙:**

| 규칙 | 설명 |
|------|------|
| 의사 시간 충돌 금지 | 동일 의사의 기존 예약과 시간이 겹치면 생성 불가 (CANCELLED, NO_SHOW 제외) |
| 환자 중복 예약 경고 | 동일 환자가 같은 날 이미 예약이 있으면 경고 (생성은 허용) |
| 근무 시간 제한 | 기본 09:00~18:00, 관리자가 의사별 설정 가능 |
| 최소 간격 | 예약 간 최소 5분 buffer (연속 예약 방지) |

```typescript
// ScheduleService.validateNoConflict() 의사 코드
async validateNoConflict(doctorId: string, scheduledAt: Date, duration: number, excludeId?: string) {
  const endAt = addMinutes(scheduledAt, duration);
  const conflicts = await this.prisma.appointment.findMany({
    where: {
      doctorId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      scheduledAt: { lt: endAt },
      // scheduledAt + duration > new scheduledAt
    },
  });
  // 시간 겹침 체크: existing.scheduledAt < endAt AND existing.endAt > scheduledAt
  const overlapping = conflicts.filter(apt => 
    addMinutes(apt.scheduledAt, apt.duration) > scheduledAt
  );
  if (overlapping.length > 0) {
    throw new AppointmentConflictError(doctorId, scheduledAt, overlapping[0].id);
  }
}
```

#### AuditLog (감사 로그)

**감사 로그 범위:**

| 대상 | CREATE | READ | UPDATE | DELETE |
|------|:------:|:----:|:------:|:------:|
| Patient (PHI) | ✅ | ✅ | ✅ | ✅ |
| Appointment | ✅ | - | ✅ | ✅ |
| User | ✅ | - | ✅ | ✅ |

> READ 감사는 PHI(환자 정보) 접근만 기록하여 성능 영향 최소화

```typescript
interface AuditLog {
  id: string;                    // UUID
  userId: string;                // 수행한 사용자
  action: AuditAction;          // CREATE | READ | UPDATE | DELETE
  resourceType: string;          // 'Patient' | 'Appointment' | etc.
  resourceId: string;            // 대상 리소스 ID
  changes: Record<string, { old: unknown; new: unknown }> | null; // 변경 내역 (JSON)
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

enum AuditAction { CREATE = 'CREATE', READ = 'READ', UPDATE = 'UPDATE', DELETE = 'DELETE' }
```

### 4.2 Entity Relationships

```
[User] 1 ──── N [Appointment] (as doctor)
  │
  └── 1 ──── N [AuditLog]

[Patient] 1 ──── N [Appointment]
  │
  └── (bi-temporal versioning: 이력 추적)

[Appointment] N ──── 1 [Patient]
              N ──── 1 [User (Doctor)]
```

### 4.3 Database Schema (PostgreSQL)

```sql
-- Enums
CREATE TYPE user_role AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
CREATE TYPE gender AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');
CREATE TYPE appointment_status AS ENUM ('SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE appointment_type AS ENUM ('INITIAL', 'FOLLOW_UP', 'URGENT', 'ROUTINE');
CREATE TYPE audit_action AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE');

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  family_name VARCHAR(100) NOT NULL,     -- 성 (ADR-002)
  given_name VARCHAR(100) NOT NULL,      -- 이름
  role user_role NOT NULL DEFAULT 'NURSE',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Patients (with bi-temporal fields)
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn VARCHAR(50) NOT NULL UNIQUE,
  fhir_id VARCHAR(100) UNIQUE,
  
  family_name VARCHAR(100) NOT NULL,      -- 성 (ADR-002)
  given_name VARCHAR(100) NOT NULL,      -- 이름
  date_of_birth DATE NOT NULL,
  gender gender NOT NULL,
  
  -- 한국형 보험 정보 (ADR-003)
  insurance_type insurance_type NOT NULL DEFAULT 'NHI',
  insurance_number VARCHAR(255),          -- AES-256 암호화 저장
  
  phone VARCHAR(20),
  email VARCHAR(255),
  address JSONB,
  
  blood_type VARCHAR(5),
  allergies JSONB DEFAULT '[]',
  
  -- Bi-temporal (EtherCIS pattern)
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_patients_mrn ON patients(mrn);
CREATE INDEX idx_patients_name ON patients(family_name, given_name);
CREATE INDEX idx_patients_dob ON patients(date_of_birth);
CREATE INDEX idx_patients_fhir_id ON patients(fhir_id);
CREATE INDEX idx_patients_valid_range ON patients(valid_from, valid_to);

-- Patient History (bi-temporal versioning)
CREATE TABLE patient_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  data JSONB NOT NULL,           -- snapshot of patient record
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,
  tx_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- transaction time
  changed_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_patient_history_patient ON patient_history(patient_id);
CREATE INDEX idx_patient_history_temporal ON patient_history(valid_from, valid_to);

-- Appointments
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES users(id),
  
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration INTEGER NOT NULL DEFAULT 30,
  status appointment_status NOT NULL DEFAULT 'SCHEDULED',
  type appointment_type NOT NULL DEFAULT 'INITIAL',
  
  reason TEXT,
  notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id),
  cancel_reason TEXT
);

CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_doctor_schedule ON appointments(doctor_id, scheduled_at);

-- Audit Logs (append-only)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  action audit_action NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID NOT NULL,
  changes JSONB,
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Partitioning for audit_logs (월별)
-- Phase 3+에서 적용: CREATE TABLE audit_logs PARTITION BY RANGE (timestamp);

-- 한국 보험 유형 Enum
CREATE TYPE insurance_type AS ENUM ('NHI', 'MEDICAID', 'INDUSTRIAL', 'AUTO', 'SELF_PAY');

-- Patients 테이블 한국형 필드 추가 (위 patients 정의에 포함)
-- insurance_type insurance_type NOT NULL DEFAULT 'NHI',
-- insurance_number VARCHAR(255),  -- AES-256 encrypted

-- ============================================================
-- 한국 의료 코드 마스터 (FR-20)
-- ============================================================

-- KCD 질병분류코드 (한국표준질병·사인분류 KCD-8)
CREATE TABLE diagnosis_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,        -- 예: "J06.9"
  name_ko VARCHAR(500) NOT NULL,           -- 한국어 명칭
  name_en VARCHAR(500),                    -- 영문 명칭
  category VARCHAR(100),                   -- 대분류 (예: "호흡기계 질환")
  chapter VARCHAR(10),                     -- 장 (예: "X")
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL,                -- 유효 시작일
  valid_to DATE,                           -- 유효 종료일 (null=현재 유효)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diagnosis_codes_code ON diagnosis_codes(code);
CREATE INDEX idx_diagnosis_codes_name ON diagnosis_codes USING gin(name_ko gin_trgm_ops);

-- EDI 수가코드 (건강보험 행위/치료재료 수가)
CREATE TABLE procedure_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,        -- EDI 코드 (예: "E6541")
  name_ko VARCHAR(500) NOT NULL,           -- 한국어 명칭
  category VARCHAR(100),                   -- 분류 (행위/치료재료)
  unit_price INTEGER,                      -- 단가 (원)
  insurance_covered BOOLEAN DEFAULT true,  -- 급여/비급여
  copay_rate DECIMAL(5,4),                 -- 본인부담률 (0.0~1.0)
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_procedure_codes_code ON procedure_codes(code);
CREATE INDEX idx_procedure_codes_name ON procedure_codes USING gin(name_ko gin_trgm_ops);

-- 약품코드 (약학정보원 KPIS 기반)
CREATE TABLE medication_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,        -- 약품코드
  name_ko VARCHAR(500) NOT NULL,           -- 한국어 약품명
  name_en VARCHAR(500),                    -- 영문 약품명
  ingredient VARCHAR(500),                 -- 주성분
  manufacturer VARCHAR(200),               -- 제조사
  dosage_form VARCHAR(100),                -- 제형 (정제, 캡슐, 주사 등)
  unit VARCHAR(50),                        -- 단위 (mg, ml 등)
  insurance_code VARCHAR(20),              -- 보험 약가코드
  unit_price INTEGER,                      -- 약가 (원)
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medication_codes_code ON medication_codes(code);
CREATE INDEX idx_medication_codes_name ON medication_codes USING gin(name_ko gin_trgm_ops);
CREATE INDEX idx_medication_codes_ingredient ON medication_codes(ingredient);
```

### 4.4 코드 마스터 엔티티 (FR-20)

```typescript
interface DiagnosisCode {
  id: string;
  code: string;             // KCD 코드 (예: "J06.9")
  nameKo: string;           // 급성 상기도감염, 상세불명
  nameEn: string | null;
  category: string | null;  // 대분류
  chapter: string | null;   // 장
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
}

interface ProcedureCode {
  id: string;
  code: string;             // EDI 코드 (예: "E6541")
  nameKo: string;
  category: string | null;  // 행위/치료재료
  unitPrice: number | null; // 단가 (원)
  insuranceCovered: boolean; // 급여 여부
  copayRate: number | null;  // 본인부담률
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
}

interface MedicationCode {
  id: string;
  code: string;             // 약품코드
  nameKo: string;
  nameEn: string | null;
  ingredient: string | null; // 주성분
  manufacturer: string | null;
  dosageForm: string | null; // 제형
  unit: string | null;
  insuranceCode: string | null;
  unitPrice: number | null;  // 약가 (원)
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
}
```

**코드 마스터 시딩 전략:**

| 단계 | 방법 | 데이터 소스 |
|------|------|-----------|
| 초기 시딩 | CLI 명령 (`npm run seed:codes`) | HIRA 공개 CSV/Excel 파일을 JSON 변환 |
| 정기 업데이트 | 월 1회 배치 작업 (cron) | HIRA 수가 파일, 약학정보원 데이터 |
| 수동 업데이트 | Admin UI에서 개별 코드 CRUD | 관리자 입력 |

```typescript
// 시딩 예시 (seed:codes 스크립트)
async function seedDiagnosisCodes() {
  const kcdData = await parseCsv('data/kcd-8.csv');
  await prisma.diagnosisCode.createMany({
    data: kcdData.map(row => ({
      code: row.code,
      nameKo: row.name_ko,
      nameEn: row.name_en,
      category: row.category,
      chapter: row.chapter,
      validFrom: new Date('2026-01-01'),
    })),
    skipDuplicates: true,
  });
}
```

---

## 5. API Specification

### 5.1 Internal REST API

#### Authentication

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/auth/login` | 로그인 (JWT 발급) | Public |
| POST | `/api/v1/auth/refresh` | 토큰 갱신 | Refresh Token |
| POST | `/api/v1/auth/logout` | 로그아웃 (토큰 무효화) | Required |
| GET | `/api/v1/auth/me` | 현재 사용자 정보 | Required |

#### Users (Admin only)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/users` | 사용자 목록 | ADMIN |
| POST | `/api/v1/users` | 사용자 생성 | ADMIN |
| GET | `/api/v1/users/:id` | 사용자 상세 | ADMIN |
| PUT | `/api/v1/users/:id` | 사용자 수정 | ADMIN |
| PATCH | `/api/v1/users/:id/deactivate` | 사용자 비활성화 | ADMIN |

#### Patients

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| GET | `/api/v1/patients` | 환자 목록 (검색/필터) | ALL (5역할 모두) | 100/min |
| POST | `/api/v1/patients` | 환자 등록 | NURSE, ADMIN | 10/min |
| GET | `/api/v1/patients/:id` | 환자 상세 | ALL (5역할 모두) | 100/min |
| PUT | `/api/v1/patients/:id` | 환자 정보 수정 | NURSE, ADMIN | 30/min |
| DELETE | `/api/v1/patients/:id` | 환자 비활성화 (soft delete) | ADMIN | 5/min |
| GET | `/api/v1/patients/:id/history` | 환자 변경 이력 | DOCTOR, ADMIN | 30/min |

**GET `/api/v1/patients` 쿼리 파라미터:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `q` | string | 이름/MRN 통합 검색 | `?q=홍길동` |
| `mrn` | string | MRN 정확 검색 | `?mrn=HR-20260506-0001` |
| `gender` | enum | 성별 필터 | `?gender=MALE` |
| `dobFrom` | date | 생년월일 시작 | `?dobFrom=1990-01-01` |
| `dobTo` | date | 생년월일 종료 | `?dobTo=2000-12-31` |
| `page` | number | 페이지 번호 (1부터) | `?page=1` |
| `limit` | number | 페이지당 개수 (기본 20, 최대 100) | `?limit=20` |
| `sort` | string | 정렬 필드 | `?sort=familyName` |
| `order` | enum | 정렬 방향 (asc/desc, 기본 asc) | `?order=desc` |

#### Appointments

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| GET | `/api/v1/appointments` | 예약 목록 (날짜/의사 필터) | ALL | 100/min |
| POST | `/api/v1/appointments` | 예약 생성 | DOCTOR, NURSE, ADMIN | 30/min |
| GET | `/api/v1/appointments/:id` | 예약 상세 | ALL | 100/min |
| PUT | `/api/v1/appointments/:id` | 예약 수정 | DOCTOR, NURSE, ADMIN | 30/min |
| PATCH | `/api/v1/appointments/:id/status` | 상태 변경 (체크인, 완료, 취소) | DOCTOR, NURSE, ADMIN | 30/min |
| GET | `/api/v1/appointments/calendar` | 캘린더 뷰 (주간/월간) | ALL | 50/min |

**GET `/api/v1/appointments` 쿼리 파라미터:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `doctorId` | UUID | 의사별 필터 | `?doctorId=uuid` |
| `patientId` | UUID | 환자별 필터 | `?patientId=uuid` |
| `status` | enum | 상태 필터 | `?status=SCHEDULED` |
| `dateFrom` | date | 날짜 시작 | `?dateFrom=2026-05-06` |
| `dateTo` | date | 날짜 종료 | `?dateTo=2026-05-12` |
| `type` | enum | 예약 유형 | `?type=INITIAL` |
| `page` | number | 페이지 (기본 1) | `?page=1` |
| `limit` | number | 개수 (기본 20, 최대 100) | `?limit=50` |

**GET `/api/v1/appointments/calendar` 쿼리 파라미터:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `view` | enum | `week` / `month` (기본 week) | `?view=week` |
| `date` | date | 기준 날짜 (기본 오늘) | `?date=2026-05-06` |
| `doctorId` | UUID | 의사별 필터 (선택) | `?doctorId=uuid` |

#### Code Master (한국 의료코드 — FR-20)

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| GET | `/api/v1/codes/diagnosis` | KCD 질병코드 검색 | ALL | 200/min |
| GET | `/api/v1/codes/diagnosis/:code` | KCD 코드 상세 | ALL | 200/min |
| GET | `/api/v1/codes/procedure` | EDI 수가코드 검색 | ALL | 200/min |
| GET | `/api/v1/codes/procedure/:code` | EDI 코드 상세 | ALL | 200/min |
| GET | `/api/v1/codes/medication` | 약품코드 검색 | ALL | 200/min |
| GET | `/api/v1/codes/medication/:code` | 약품 상세 | ALL | 200/min |
| POST | `/api/v1/codes/seed` | 코드 마스터 시딩 (초기/업데이트) | ADMIN | 1/hour |

**코드 검색 공통 쿼리 파라미터:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `q` | string | 코드 또는 명칭 통합 검색 | `?q=감기` or `?q=J06` |
| `category` | string | 분류 필터 | `?category=호흡기계` |
| `active` | boolean | 유효 코드만 (기본 true) | `?active=true` |
| `page` | number | 페이지 (기본 1) | `?page=1` |
| `limit` | number | 개수 (기본 20, 최대 100) | `?limit=50` |

### 5.2 FHIR R4 API (Phase 1: Patient만)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/fhir/R4/Patient` | FHIR Patient 검색 | Required |
| GET | `/fhir/R4/Patient/:id` | FHIR Patient 조회 | Required |
| POST | `/fhir/R4/Patient` | FHIR Patient 생성 | Required |
| PUT | `/fhir/R4/Patient/:id` | FHIR Patient 업데이트 | Required |
| GET | `/fhir/R4/metadata` | CapabilityStatement | Public |

#### FHIR CapabilityStatement (MVP)

```json
{
  "resourceType": "CapabilityStatement",
  "status": "active",
  "kind": "instance",
  "fhirVersion": "4.0.1",
  "format": ["json"],
  "rest": [{
    "mode": "server",
    "security": {
      "service": [{ "coding": [{ "code": "SMART-on-FHIR" }] }],
      "description": "JWT Bearer Token required"
    },
    "resource": [{
      "type": "Patient",
      "interaction": [
        { "code": "read" },
        { "code": "search-type" },
        { "code": "create" },
        { "code": "update" }
      ],
      "searchParam": [
        { "name": "name", "type": "string" },
        { "name": "identifier", "type": "token" },
        { "name": "birthdate", "type": "date" },
        { "name": "gender", "type": "token" }
      ]
    }]
  }]
}
```

> Phase 3+에서 Encounter, Observation, MedicationRequest 등 리소스 추가 예정

#### FHIR Patient Mapping (Internal ↔ FHIR)

```typescript
// Internal Patient → FHIR R4 Patient
function toFhirPatient(patient: Patient): FhirPatient {
  return {
    resourceType: 'Patient',
    id: patient.fhirId || patient.id,
    identifier: [{
      system: 'urn:hospital-run:mrn',
      value: patient.mrn,
    }],
    name: [{
      family: patient.familyName,      // 성 (ADR-002)
      given: [patient.givenName],      // 이름
    }],
    gender: mapGender(patient.gender),  // MALE→male, FEMALE→female
    birthDate: formatDate(patient.dateOfBirth),
    telecom: [
      patient.phone ? { system: 'phone', value: patient.phone } : null,
      patient.email ? { system: 'email', value: patient.email } : null,
    ].filter(Boolean),
    address: patient.address ? [{
      line: [patient.address.line1, patient.address.line2].filter(Boolean),
      city: patient.address.city,
      state: patient.address.state,
      postalCode: patient.address.postalCode,
      country: patient.address.country,
    }] : [],
  };
}
```

### 5.3 Response Format (Standard)

```json
// Success (단일)
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-05-06T00:00:00Z"
  }
}

// Success (목록)
{
  "data": [ ... ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "hasMore": true
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-05-06T00:00:00Z"
  }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "성을 입력해주세요",
    "details": [
      { "field": "familyName", "message": "must not be empty" }
    ]
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-05-06T00:00:00Z"
  }
}
```

### 5.4 Error Codes

| HTTP | Code | Description | Handling |
|------|------|-------------|----------|
| 400 | VALIDATION_ERROR | 입력값 유효성 실패 | 필드별 에러 메시지 표시 |
| 401 | UNAUTHORIZED | 인증 실패/토큰 만료 | 로그인 페이지로 리다이렉트 |
| 403 | FORBIDDEN | 권한 없음 | "접근 권한이 없습니다" 표시 |
| 404 | NOT_FOUND | 리소스 없음 | 404 페이지 표시 |
| 409 | CONFLICT | 중복 데이터 (MRN 등) | 중복 안내 메시지 |
| 422 | BUSINESS_RULE_VIOLATION | 비즈니스 규칙 위반 | 구체적 사유 표시 |
| 429 | RATE_LIMITED | 요청 제한 초과 | 재시도 안내 |
| 500 | INTERNAL_ERROR | 서버 오류 | 에러 로그 + "잠시 후 다시 시도" |

---

## 6. UI/UX Design

### 6.1 Screen Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar: Logo | Search | Notifications | User Menu          │
├───────────┬─────────────────────────────────────────────────┤
│           │                                                 │
│  Sidebar  │           Main Content Area                     │
│           │                                                 │
│  - Dashboard                                                │
│  - Patients   ┌─────────────────────────────────────┐       │
│  - Schedule   │  Breadcrumb                         │       │
│  - (Phase 2+) │  ┌─────────────────────────────────┐│       │
│    - Clinical │  │                                 ││       │
│    - Pharmacy │  │    Page Content                  ││       │
│    - Labs     │  │                                 ││       │
│  - Admin      │  └─────────────────────────────────┘│       │
│               └─────────────────────────────────────┘       │
└───────────┴─────────────────────────────────────────────────┘
```

### 6.2 User Flows (MVP)

#### Flow 1: 환자 등록
```
Login → Dashboard → Patients → [+ New Patient] → Fill Form → Submit → Patient Detail
```

#### Flow 2: 예약 생성
```
Login → Schedule → Calendar View → [+ New Appointment] → Select Patient → Select Doctor → Select Time → Submit → Calendar Updated
```

#### Flow 3: 환자 검색
```
Login → TopBar Search or Patients → Search by Name/MRN → Results List → Patient Detail → View History
```

### 6.3 Component List (MVP)

| Component | Location | Layer | Responsibility |
|-----------|----------|-------|----------------|
| `LoginForm` | `app/(auth)/login/` | Presentation | 로그인 폼 |
| `DashboardPage` | `app/(main)/dashboard/` | Presentation | 대시보드 레이아웃 |
| `PatientList` | `app/(main)/patients/` | Presentation | 환자 목록 + 검색 |
| `PatientForm` | `app/(main)/patients/new/` | Presentation | 환자 등록/수정 폼 |
| `PatientDetail` | `app/(main)/patients/[id]/` | Presentation | 환자 상세 정보 |
| `AppointmentCalendar` | `app/(main)/schedule/` | Presentation | 캘린더 뷰 |
| `AppointmentForm` | `app/(main)/schedule/new/` | Presentation | 예약 생성 모달 |
| `Sidebar` | `components/layout/` | Presentation | 네비게이션 사이드바 |
| `TopBar` | `components/layout/` | Presentation | 상단 바 (검색, 알림) |
| `DataTable` | `components/ui/` | Shared | 공통 테이블 (정렬, 필터, 페이지네이션) |

### 6.4 Frontend Library Stack

| 라이브러리 | 용도 | 적용 컴포넌트 |
|-----------|------|-------------|
| **shadcn/ui** | 디자인 시스템 기반 UI 컴포넌트 | Button, Input, Dialog, Table, Calendar, Select, Badge, Toast |
| **React Hook Form** | 폼 상태 관리 + 유효성 검사 | PatientForm, AppointmentForm, LoginForm |
| **Zod** | 스키마 기반 유효성 검사 (RHF resolver) | 모든 Form 컴포넌트의 validation schema |
| **TanStack Query** | 서버 상태 관리 + 캐싱 | usePatients, useAppointments hooks |
| **Zustand** | 클라이언트 상태 (인증, UI) | auth-store, sidebar 상태 |
| **date-fns** | 날짜 포맷/계산 | 예약 캘린더, 생년월일 표시 |
| **Lucide React** | 아이콘 (shadcn/ui 기본) | Sidebar 메뉴, 액션 버튼 |

**폼 처리 패턴:**

```typescript
// PatientForm 예시 — React Hook Form + Zod + shadcn/ui
const patientSchema = z.object({
  familyName: z.string().min(1, '성을 입력해주세요'),
  givenName: z.string().min(1, '이름을 입력해주세요'),
  dateOfBirth: z.date({ required_error: '생년월일을 선택해주세요' }),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
});

type PatientFormValues = z.infer<typeof patientSchema>;

function PatientForm() {
  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
  });
  // shadcn/ui Form + FormField + Input 조합
}
```

### 6.5 Frontend Clean Architecture 매핑

| Clean Architecture Layer | 파일 구조 | 역할 |
|------------------------|----------|------|
| **Presentation** | `app/`, `components/` | 페이지, UI 컴포넌트, 이벤트 핸들링 |
| **Application** | `hooks/`, `stores/` | 비즈니스 로직 오케스트레이션, 상태 관리 |
| **Domain** | `types/` | 엔티티 타입, 비즈니스 규칙 (Zod schema) |
| **Infrastructure** | `lib/` | API 클라이언트, 토큰 관리, 스토리지 |

---

## 7. Security

### 7.1 Authentication & Authorization

```
┌────────────────────────────────────────────────────────┐
│                   Auth Flow                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Login Request (email + password)                      │
│        │                                               │
│        ▼                                               │
│  Verify credentials (bcrypt compare)                   │
│        │                                               │
│        ▼                                               │
│  Issue tokens:                                         │
│    - Access Token (JWT, 15min, role + permissions)      │
│    - Refresh Token (opaque, 7days, stored in Redis)    │
│        │                                               │
│        ▼                                               │
│  Client stores: Access in memory, Refresh in httpOnly  │
│                  cookie (Secure, SameSite=Strict)      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 7.2 RBAC Permission Matrix

| Resource | Action | ADMIN | DOCTOR | NURSE | PHARMACIST | LAB_TECH |
|----------|--------|:-----:|:------:|:-----:|:----------:|:--------:|
| User | CRUD | ✅ | - | - | - | - |
| Patient | Create | ✅ | - | ✅ | - | - |
| Patient | Read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Patient | Update | ✅ | - | ✅ | - | - |
| Patient | Delete | ✅ | - | - | - | - |
| Appointment | Create | ✅ | ✅ | ✅ | - | - |
| Appointment | Read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Appointment | Update | ✅ | ✅ | ✅ | - | - |
| Appointment | Cancel | ✅ | ✅ | ✅ | - | - |
| AuditLog | Read | ✅ | - | - | - | - |
| FHIR API | All | ✅ | ✅ | ✅ | - | - |

### 7.3 Security Checklist

- [ ] Input validation — Zod schemas on all endpoints
- [ ] SQL injection prevention — Prisma parameterized queries
- [ ] XSS prevention — React auto-escaping + DOMPurify for rich text
- [ ] CSRF protection — SameSite=Strict cookies + CSRF token
- [ ] Rate limiting — per-endpoint limits (Section 5.1)
- [ ] Audit logging — global NestJS interceptor on all mutations
- [ ] Secrets management — environment variables, never hardcoded
- [ ] Password policy — min 8 chars, complexity requirements, bcrypt cost=12
- [ ] PHI encryption — AES-256 for sensitive fields at application level
- [ ] HTTPS enforcement — TLS termination at Nginx/ALB
- [ ] Session management — Redis-backed, auto-expire

---

## 8. Monitoring & Observability

### 8.1 Metrics (MVP — Prometheus)

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| `http_request_duration_seconds` | Histogram | P95 > 500ms (MVP) |
| `http_requests_total` | Counter | error_rate > 5% for 5min |
| `db_query_duration_seconds` | Histogram | P95 > 200ms |
| `active_sessions` | Gauge | > 100 (MVP capacity) |
| `patient_records_total` | Gauge | Info only |

### 8.2 Logging (JSON Structured)

```json
{
  "timestamp": "2026-05-06T10:30:00.000Z",
  "level": "info",
  "service": "hospital-run-api",
  "requestId": "req_abc123",
  "userId": "usr_xyz",
  "method": "POST",
  "path": "/api/v1/patients",
  "statusCode": 201,
  "duration": 45,
  "message": "Patient created successfully"
}
```

- **Retention**: 30일 (MVP), 90일 (Phase 3+)
- **필수 필드**: timestamp, level, service, requestId, message
- **PHI 마스킹**: 환자 이름, 연락처 등 민감 정보는 로그에서 마스킹 처리

### 8.3 Health Check

```
GET /health          → { "status": "ok", "version": "0.1.0" }
GET /health/ready    → { "db": "ok", "redis": "ok" }
GET /health/live     → 200 OK
```

---

## 9. Infrastructure (MVP)

### 9.1 Docker Compose (개발/MVP)

```yaml
services:
  web:
    build: ./apps/web
    ports: ["3000:3000"]
    depends_on: [api]
    
  api:
    build: ./apps/api
    ports: ["4000:4000"]
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql://hospital:CHANGE_ME@postgres:5432/hospitalrun
      REDIS_URL: redis://redis:6379
      AUTH_SECRET: ${AUTH_SECRET}
      
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment:
      POSTGRES_DB: hospitalrun
      POSTGRES_USER: hospital
      POSTGRES_PASSWORD: secret
      
  redis:
    image: redis:7-alpine
    
  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    depends_on: [web, api]

volumes:
  pgdata:
```

### 9.2 Environment Variables

| Variable | Description | Scope | Required |
|----------|-------------|-------|:--------:|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | Server | ✅ |
| `REDIS_URL` | Redis 연결 문자열 | Server | ✅ |
| `AUTH_SECRET` | JWT 서명 키 (min 32 chars) | Server | ✅ |
| `AUTH_REFRESH_SECRET` | Refresh Token 서명 키 | Server | ✅ |
| `NEXT_PUBLIC_API_URL` | Backend API base URL | Client | ✅ |
| `ENCRYPTION_KEY` | PHI 데이터 암호화 키 (AES-256) | Server | ✅ |
| `S3_BUCKET` | 파일 저장소 버킷 | Server | Phase 2+ |
| `S3_REGION` | AWS S3 리전 | Server | Phase 2+ |
| `LOG_LEVEL` | 로그 레벨 (debug/info/warn/error) | Server | info |

---

## 10. Coding Conventions

### 10.1 Naming Conventions

| Target | Rule | Example |
|--------|------|---------|
| Components | PascalCase | `PatientList`, `AppointmentForm` |
| Functions/Methods | camelCase | `getPatientById()`, `handleSubmit()` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| Types/Interfaces | PascalCase | `Patient`, `AppointmentStatus` |
| Enums | PascalCase + UPPER values | `enum UserRole { ADMIN = 'ADMIN' }` |
| Files (component) | PascalCase.tsx | `PatientList.tsx` |
| Files (utility) | camelCase.ts | `formatDate.ts` |
| Files (api/service) | kebab-case.ts | `patient-service.ts` |
| Folders | kebab-case | `patient-detail/`, `auth-guard/` |
| DB columns | snake_case | `family_name`, `created_at` |
| API paths | kebab-case | `/api/v1/patients`, `/api/v1/audit-logs` |

### 10.2 Import Order

```typescript
// 1. Node builtins
import { randomUUID } from 'crypto';

// 2. External libraries
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/client';

// 3. Internal absolute imports
import { PatientService } from '@/application/patient-service';
import { Patient } from '@/domain/entities/patient';

// 4. Relative imports
import { CreatePatientDto } from './dto/create-patient.dto';

// 5. Type-only imports
import type { UserRole } from '@/domain/enums';
```

### 10.3 Error Handling Pattern

```typescript
// Domain Error (비즈니스 규칙 위반)
class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// 사용 예시
class PatientNotFoundError extends DomainError {
  constructor(id: string) {
    super('PATIENT_NOT_FOUND', `Patient with id ${id} not found`);
  }
}

class DuplicateMrnError extends DomainError {
  constructor(mrn: string) {
    super('DUPLICATE_MRN', `Patient with MRN ${mrn} already exists`);
  }
}
```

---

## 11. Test Plan

### 11.1 Test Pyramid

| Type | Coverage Target | Tools | Scope |
|------|-----------------|-------|-------|
| Unit | > 80% | Vitest | Services, Mappers, Domain Logic |
| Integration | Key paths | Vitest + Supertest | API endpoints + DB |
| E2E | Critical flows | Playwright | 환자 등록, 예약 생성, 로그인 |
| Load | Performance | k6 | P95 < 500ms (MVP) |

### 11.2 Key Test Scenarios

- [ ] **Happy path**: 코드 마스터 시딩 → KCD 코드 검색 → 비활성 코드 필터링
- [ ] **Happy path**: 환자 등록(보험 정보 포함) → 조회 → 수정 → 이력 확인
- [ ] **Happy path**: 예약 생성 → 체크인 → 완료
- [ ] **Auth**: 로그인 → 토큰 발급 → 보호 API 접근 → 토큰 갱신
- [ ] **RBAC**: NURSE가 환자 생성 가능, DOCTOR는 불가
- [ ] **RBAC**: ADMIN만 사용자 관리 가능
- [ ] **FHIR**: `/fhir/R4/Patient` CRUD + 내부 데이터 매핑 검증
- [ ] **Error**: 중복 MRN 등록 시 409 응답
- [ ] **Error**: 잘못된 토큰으로 접근 시 401 응답
- [ ] **Edge case**: 동일 시간대 예약 충돌 처리
- [ ] **Audit**: 환자 정보 수정 시 감사 로그 생성 확인

---

## 12. Implementation Plan (MVP — Phase 1)

### 12.1 Implementation Order

| Step | Scope | Duration | 선행 조건 |
|------|-------|----------|----------|
| 1 | 프로젝트 초기화 (Turborepo, Next.js, NestJS, Prisma) | 2일 | - |
| 2 | DB 스키마 + Prisma 마이그레이션 (코드 마스터 포함) | 2일 | Step 1 |
| 3 | AuthModule — JWT 인증 + RBAC 가드 | 3일 | Step 2 |
| 4 | **CodeMasterModule** — KCD/EDI/약품코드 CRUD + 시딩 CLI | 3일 | Step 2 |
| 5 | PatientModule — CRUD + 검색 + bi-temporal + 보험 정보 | 4일 | Step 3 |
| 6 | ScheduleModule — 예약 CRUD + 캘린더 + 상태 전이 | 3일 | Step 5 |
| 7 | FhirModule — Patient 리소스 매핑 + API | 3일 | Step 5 |
| 8 | AuditModule — 글로벌 인터셉터 + 로그 기록 | 2일 | Step 3 |
| 9 | Frontend — 로그인, 환자 목록/상세/등록 UI | 5일 | Step 5 |
| 10 | Frontend — 예약 캘린더, 예약 생성 UI | 4일 | Step 6 |
| 11 | Docker Compose + Nginx + Health Check | 1일 | Step 9, 10 |
| 12 | 코드 마스터 시딩 데이터 준비 (KCD CSV → JSON 변환) | 2일 | Step 4 |
| 13 | 테스트 작성 + QA | 4일 | Step 11, 12 |
| 14 | 문서화 (API docs, README) | 1일 | Step 13 |

**총 예상 기간: ~10주 (39 working days)**

### 12.2 File Structure (MVP)

```
hospital-run/
├── apps/
│   ├── web/                          # Next.js 15 Frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/
│   │   │   │   │   └── login/page.tsx
│   │   │   │   ├── (main)/
│   │   │   │   │   ├── dashboard/page.tsx
│   │   │   │   │   ├── patients/
│   │   │   │   │   │   ├── page.tsx          # 환자 목록
│   │   │   │   │   │   ├── new/page.tsx      # 환자 등록
│   │   │   │   │   │   └── [id]/page.tsx     # 환자 상세
│   │   │   │   │   └── schedule/
│   │   │   │   │       └── page.tsx          # 예약 캘린더
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   └── TopBar.tsx
│   │   │   │   ├── patients/
│   │   │   │   │   ├── PatientForm.tsx
│   │   │   │   │   └── PatientTable.tsx
│   │   │   │   └── schedule/
│   │   │   │       ├── AppointmentCalendar.tsx
│   │   │   │       └── AppointmentForm.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── usePatients.ts
│   │   │   │   ├── useAppointments.ts
│   │   │   │   └── useAuth.ts
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts             # fetch wrapper
│   │   │   │   └── auth.ts                   # token management
│   │   │   ├── stores/
│   │   │   │   └── auth-store.ts             # Zustand
│   │   │   └── types/
│   │   │       ├── patient.ts
│   │   │       ├── appointment.ts
│   │   │       └── user.ts
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── api/                          # NestJS Backend
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   │   ├── auth.module.ts
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── guards/
│       │   │   │   │   ├── jwt-auth.guard.ts
│       │   │   │   │   └── roles.guard.ts
│       │   │   │   ├── strategies/
│       │   │   │   │   └── jwt.strategy.ts
│       │   │   │   └── dto/
│       │   │   │       ├── login.dto.ts
│       │   │   │       └── token-response.dto.ts
│       │   │   ├── patient/
│       │   │   │   ├── patient.module.ts
│       │   │   │   ├── patient.controller.ts
│       │   │   │   ├── patient.service.ts
│       │   │   │   ├── patient.repository.ts
│       │   │   │   └── dto/
│       │   │   │       ├── create-patient.dto.ts
│       │   │   │       ├── update-patient.dto.ts
│       │   │   │       └── patient-query.dto.ts
│       │   │   ├── schedule/
│       │   │   │   ├── schedule.module.ts
│       │   │   │   ├── schedule.controller.ts
│       │   │   │   ├── schedule.service.ts
│       │   │   │   └── dto/
│       │   │   ├── code-master/
│       │   │   │   ├── code-master.module.ts
│       │   │   │   ├── code-master.controller.ts
│       │   │   │   ├── code-master.service.ts
│       │   │   │   ├── seed/
│       │   │   │   │   └── seed-codes.command.ts
│       │   │   │   └── dto/
│       │   │   │       └── code-query.dto.ts
│       │   │   ├── fhir/
│       │   │   │   ├── fhir.module.ts
│       │   │   │   ├── fhir.controller.ts
│       │   │   │   ├── fhir-patient.mapper.ts
│       │   │   │   └── types/
│       │   │   │       └── fhir-r4.types.ts
│       │   │   └── audit/
│       │   │       ├── audit.module.ts
│       │   │       ├── audit.interceptor.ts
│       │   │       └── audit.service.ts
│       │   ├── domain/
│       │   │   ├── entities/
│       │   │   │   ├── user.entity.ts
│       │   │   │   ├── patient.entity.ts
│       │   │   │   └── appointment.entity.ts
│       │   │   ├── enums/
│       │   │   │   └── index.ts
│       │   │   ├── errors/
│       │   │   │   └── domain-error.ts
│       │   │   └── interfaces/
│       │   │       ├── patient-repository.interface.ts
│       │   │       └── appointment-repository.interface.ts
│       │   ├── infrastructure/
│       │   │   ├── prisma/
│       │   │   │   ├── prisma.module.ts
│       │   │   │   └── prisma.service.ts
│       │   │   └── redis/
│       │   │       ├── redis.module.ts
│       │   │       └── redis.service.ts
│       │   ├── common/
│       │   │   ├── filters/
│       │   │   │   └── global-exception.filter.ts
│       │   │   ├── interceptors/
│       │   │   │   └── logging.interceptor.ts
│       │   │   └── decorators/
│       │   │       └── roles.decorator.ts
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── prisma/                        # Prisma schema (단일 소스)
│       │   ├── schema.prisma
│       │   └── migrations/
│       ├── test/
│       └── package.json
│
├── packages/
│   └── shared/                       # 공유 타입
│       ├── src/
│       │   ├── types/
│       │   └── constants/
│       └── package.json
│
├── infra/
│   └── docker/
│       ├── docker-compose.yml
│       ├── docker-compose.dev.yml
│       └── nginx/
│           └── default.conf
│
├── turbo.json
├── package.json
├── .env.example
├── .gitignore
└── CLAUDE.md
```

### 12.3 Success Criteria (MVP)

- [ ] 환자 CRUD + 검색 동작
- [ ] RBAC 5개 역할 권한 동작
- [ ] 예약 CRUD + 캘린더 뷰 동작
- [ ] FHIR R4 Patient CRUD + CapabilityStatement 응답
- [ ] 감사 로그 자동 기록
- [ ] JWT 인증 + 토큰 갱신 동작
- [ ] 한국 의료코드 마스터(KCD, EDI, 약품) 시딩 + 검색 동작
- [ ] Docker Compose로 전체 시스템 기동
- [ ] 테스트 커버리지 > 80%
- [ ] API 문서 (Swagger) 제공

---

## Document History

| Version | Date | Changes | Author | Reviewer |
|---------|------|---------|--------|----------|
| 0.1 | 2026-05-06 | Initial draft — MVP Design (Phase 1) | user | - |
| 0.2 | 2026-05-06 | 검토 반영 — ADR-001(인증 전환), Design Principles, bi-temporal 트랜잭션 패턴, 데이터 플로우 시퀀스, FHIR CapabilityStatement, 쿼리 파라미터, 예약 충돌 규칙, MRN 생성 규칙, 프론트엔드 라이브러리 스택, Clean Architecture 매핑, Prisma schema 통일 | user | design-validator |
| 0.3 | 2026-05-06 | Warning 보완 — MRN 동시성(DB SEQUENCE), Appointment 상태 전이 다이어그램, AuditLog MVP 선제 적용 | user | design-validator |
| 0.4 | 2026-05-06 | **한국형 HIS 반영** — ADR-002(이름 체계), ADR-003(식별자 정책), Patient 보험 필드, 코드 마스터 엔티티(KCD/EDI/약품) + API + 시딩 전략, CodeMasterModule 추가, 구현 계획 14단계로 확장 | user | - |
| 0.5 | 2026-05-06 | **OpenMRS O3 패턴 반영** — ADR-004(JSON Form Engine), Configuration over Code/Extension Slot Design Principle 추가, Phase 2 FormEngine 설계 명시 | user | - |
