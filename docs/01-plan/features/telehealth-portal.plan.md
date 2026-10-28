# 원격진료 포털 연동 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/portal/_services/ServicesTab.tsx:39 · apps/api/src/modules/portal/ · apps/api/src/modules/telehealth/telehealth.controller.ts · 잔여: 없음

> 환자가 포털에서 직접 원격진료를 예약/참여/관리하는 전체 흐름

## 1. 현황

### 완성된 부분
- BE: TelehealthSession 모델 + API 14개 (의사용)
- BE: 포털 API 5개 (목록/상세/대기실/메시지/평가)
- FE: /telehealth 관리 페이지 (의사용)
- FE: 포털 원격진료 탭 (읽기 전용 + 대기실 입장 + 평가)

### 누락된 기능
| ID | 기능 | 현황 |
|----|------|------|
| FR-01 | **환자 직접 원격진료 예약** | 포털에서 예약 불가 — "병원에 요청하세요"만 표시 |
| FR-02 | **의사/진료과 선택** | 예약 시 의사 목록 없음 |
| FR-03 | **예약 가능 시간 조회** | 의사별 가용 슬롯 조회 없음 |
| FR-04 | **사전 문진표 작성** | 예약 시 증상/사진 입력 없음 |
| FR-05 | **예약 변경/취소** | 환자 측 취소 불가 |
| FR-06 | **진료비 사전 안내/결제** | 원격진료 비용 표시 없음 |
| FR-07 | **원격 처방전 수령** | 진료 후 처방전 조회 없음 |
| FR-08 | **진료 녹화 재생** | 녹화 URL 미표시 |
| FR-09 | **비동기 진료 사진 첨부** | 텍스트만, 사진 업로드 미구현 |
| FR-10 | **홈 대시보드 연동** | 예정된 원격진료 홈에 미표시 |

---

## 2. 환자 원격진료 전체 흐름

```
환자 포털 진입
├─ 홈 대시보드: "예정된 원격진료" 카드 표시
│
├─ 원격진료 탭
│  ├─ 1. 새 원격진료 예약
│  │   ├─ 진료 유형 선택 (화상/음성/비동기)
│  │   ├─ 진료과 선택 → 의사 목록
│  │   ├─ 예약 가능 시간 조회 (30분 단위 슬롯)
│  │   ├─ 증상/문진 입력 + 사진 첨부 (선택)
│  │   ├─ 진료비 안내 (보험/비보험)
│  │   └─ 예약 확정
│  │
│  ├─ 2. 내 원격진료 목록
│  │   ├─ 예정: "대기실 입장" 버튼 (예약 시간 10분 전부터)
│  │   ├─ 대기중: "의사 연결 대기 중" 안내
│  │   ├─ 진료중: WebRTC 화상진료 화면
│  │   ├─ 완료: 진료 요약 + 처방전 조회 + 평가
│  │   └─ 취소: 취소 이력
│  │
│  └─ 3. 비동기 진료
│      ├─ 메시지 + 사진 전송
│      └─ 의사 답변 확인 + 처방전
│
└─ 처방전/진료비 탭과 자동 연동
```

---

## 3. 상세 기능 설계

### 3.1 환자 직접 예약 (FR-01~03)

```
새 포털 API:
  GET  /api/v1/portal/telehealth/departments
    → 원격진료 가능 진료과 목록

  GET  /api/v1/portal/telehealth/doctors?department=...
    → 해당 과 의사 목록 (이름, 프로필)

  GET  /api/v1/portal/telehealth/slots?doctorId=...&date=...
    → 30분 단위 가용 슬롯 (이미 예약된 시간 제외)

  POST /api/v1/portal/telehealth/book
    { doctorId, scheduledAt, sessionType, chiefComplaint, photos? }
    → TelehealthSession 생성 (status: SCHEDULED)

UI 흐름:
  Step 1: 진료 유형 선택 (📹 화상 / 📞 음성 / 💬 비동기)
  Step 2: 진료과 선택 → 의사 선택 (사진+이름+전문분야)
  Step 3: 날짜 선택 → 시간 슬롯 선택 (가용 시간만 표시)
  Step 4: 증상 입력 + 사진 첨부 (선택)
  Step 5: 진료비 안내 → 예약 확정
```

### 3.2 사전 문진 + 사진 첨부 (FR-04, FR-09)

```
예약 시:
  - chiefComplaint: 텍스트 (필수)
  - photos: 최대 5장 (선택)
  - 기존 약물/알레르기 자동 표시

사진 업로드:
  - 브라우저 File API → base64 변환 → patientPhotos JSON 저장
  - 또는 presigned URL 방식 (bkend.ai storage)
```

### 3.3 예약 변경/취소 (FR-05)

```
  PATCH /api/v1/portal/telehealth/:id/cancel
    → 24시간 전까지 무료 취소
    → 24시간 이내 취소 시 경고

  PATCH /api/v1/portal/telehealth/:id/reschedule
    { newScheduledAt }
    → 기존 세션 취소 + 새 세션 생성
```

### 3.4 진료비 안내/결제 (FR-06)

```
  config-runtime:
    + telehealth.videoFee: 15000      (화상 진료비)
    + telehealth.audioFee: 10000      (음성 진료비)
    + telehealth.asyncFee: 8000       (비동기 진료비)

  예약 확정 시: feeAmount 자동 설정
  진료 완료 후: billing 자동 생성 (수납 연동)
```

### 3.5 처방전 수령 (FR-07)

```
  진료 완료 + prescriptionIssued=true 시:
    → 포털에서 "처방전 보기" 버튼 표시
    → 기존 /print/prescription/:encounterId 연동
```

### 3.6 홈 대시보드 연동 (FR-10)

```
  포털 홈에 추가:
    "예정된 원격진료" 카드
    - 다음 원격진료 일시/의사명/유형
    - "대기실 입장" 버튼 (시간 도래 시)
    - 카운트다운 타이머
```

---

## 4. 구현 우선순위

### Phase 1: 예약 + 취소 (2일)
- [ ] 포털 예약 API (departments/doctors/slots/book)
- [ ] 포털 예약 UI (4단계 스텝)
- [ ] 예약 취소/변경

### Phase 2: 대기실 + 진료 (1일)
- [ ] 대기실 UI 개선 (카운트다운, 연결 안내)
- [ ] 홈 대시보드 원격진료 카드
- [ ] 진료비 안내 + config-runtime 연동

### Phase 3: 처방전 + 평가 (1일)
- [ ] 처방전 연동 (encounterId 기반)
- [ ] 비동기 진료 사진 첨부
- [ ] 진료 완료 후 처방전 조회 + 평가 개선

---

## 5. Out of Scope

| 항목 | 사유 |
|------|------|
| WebRTC 실제 구현 | 별도 인프라 (STUN/TURN) 필요, 향후 |
| 실시간 결제 (PG) | 수납 모듈로 대체 |
| 녹화 재생 | 스토리지 인프라 필요 |

---

*작성일: 2026-05-21*
*상태: Phase 1 우선 진행*
