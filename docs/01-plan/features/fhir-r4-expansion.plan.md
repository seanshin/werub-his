# FHIR R4 연동 확대 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/app.module.ts:67 · apps/api/src/modules/fhir-full · 잔여: 리소스별 1:1 대조 안 함

## 현재 상태

### 구현됨 (5 리소스)
- Patient: CRUD + Search (name/identifier/birthdate/gender)
- Encounter: Read + Search (subject/status)
- MedicationRequest: Read + Search (subject/encounter)
- Condition: Read + Search (subject)
- Observation: Read only (form submission 기반)

### 부족한 것
- Practitioner (의료진) 없음
- Organization (기관) 없음
- DiagnosticReport (검사 결과) 없음
- AllergyIntolerance (알레르기) 없음
- Procedure (수술/시술) 없음
- Appointment (예약) 없음
- ServiceRequest (의뢰) 없음
- Location (위치) 없음
- Bundle (배치 처리) 없음

## 확대 계획

### Phase 1: 핵심 리소스 (8개 추가)

| FHIR 리소스 | HIS 데이터 소스 | 매핑 |
|-------------|----------------|------|
| Practitioner | User (DOCTOR/NURSE) | id, name, qualification, telecom |
| Organization | 병원 설정 (config) | name, address, telecom, type |
| AllergyIntolerance | Allergy | patient, code, category, criticality |
| Procedure | Surgery | subject, code, performedDateTime, performer |
| Appointment | Appointment | participant, start, end, status |
| DiagnosticReport | LabResult | subject, code, result(Observation), conclusion |
| ServiceRequest | Order (LAB/IMAGING) | subject, code, requester, status |
| Location | Ward/Bed | name, type, physicalType |

### Phase 2: 확장 리소스 (5개)

| FHIR 리소스 | HIS 데이터 소스 |
|-------------|----------------|
| Immunization | (신규) 예방접종 |
| CarePlan | RehabPlan, DietOrder |
| CareTeam | 담당 의료진 그룹 |
| DocumentReference | ConsentForm, 검사 PDF |
| Bundle | 배치 생성/조회 |

### API 엔드포인트

```
GET  /fhir/R4/metadata                    — CapabilityStatement (확대)

# Phase 1
GET  /fhir/R4/Practitioner                — 의료진 검색
GET  /fhir/R4/Practitioner/:id            — 의료진 조회
GET  /fhir/R4/Organization                — 기관 정보
GET  /fhir/R4/AllergyIntolerance          — 알레르기 검색 (subject)
GET  /fhir/R4/AllergyIntolerance/:id      — 알레르기 조회
GET  /fhir/R4/Procedure                   — 수술/시술 검색
GET  /fhir/R4/Procedure/:id              — 수술/시술 조회
GET  /fhir/R4/Appointment                 — 예약 검색
GET  /fhir/R4/Appointment/:id            — 예약 조회
GET  /fhir/R4/DiagnosticReport            — 검사 보고서 검색
GET  /fhir/R4/DiagnosticReport/:id       — 검사 보고서 조회
GET  /fhir/R4/ServiceRequest              — 의뢰 검색
GET  /fhir/R4/ServiceRequest/:id         — 의뢰 조회
GET  /fhir/R4/Location                    — 위치 검색
GET  /fhir/R4/Location/:id              — 위치 조회
```

### 매핑 예시

#### Practitioner
```json
{
  "resourceType": "Practitioner",
  "id": "uuid",
  "identifier": [{ "system": "urn:oid:hospital-run", "value": "EMP-2018-002" }],
  "name": [{ "family": "김", "given": ["내과"], "text": "김내과" }],
  "qualification": [{
    "code": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0360", "code": "MD" }] },
    "identifier": [{ "value": "MD-2018-12345" }]
  }],
  "telecom": [{ "system": "email", "value": "kim.naegwa@hospitalrun.example" }]
}
```

#### DiagnosticReport
```json
{
  "resourceType": "DiagnosticReport",
  "id": "uuid",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0074", "code": "LAB" }] }],
  "code": { "coding": [{ "system": "urn:oid:EDI", "code": "E6541" }], "text": "일반혈액검사(CBC)" },
  "subject": { "reference": "Patient/uuid" },
  "result": [
    { "reference": "Observation/uuid-wbc", "display": "WBC 7.2 10^3/uL" },
    { "reference": "Observation/uuid-rbc", "display": "RBC 4.85 10^6/uL" }
  ],
  "conclusion": "정상 범위"
}
```

#### AllergyIntolerance
```json
{
  "resourceType": "AllergyIntolerance",
  "id": "uuid",
  "clinicalStatus": { "coding": [{ "code": "active" }] },
  "category": ["medication"],
  "criticality": "high",
  "code": { "text": "페니실린" },
  "patient": { "reference": "Patient/uuid" }
}
```

## 구현 우선순위

1. **Practitioner + Organization** — 기본 인프라
2. **AllergyIntolerance** — 환자 안전 필수
3. **DiagnosticReport + Observation 확장** — 검사 결과 교환
4. **Procedure** — 수술 기록 교환
5. **Appointment + ServiceRequest** — 예약/의뢰
6. **Location** — 시설 정보
7. **CapabilityStatement 업데이트** — 지원 리소스 반영
