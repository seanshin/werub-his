# 동의서 서명 기기(페어링·실시간 디스패치) 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:6429 model ConsentSigningDevice · apps/api/src/modules/consent/consent-device-public.controller.ts · apps/web/src/app/(main)/patients/register/foreign/page.tsx:165 · 잔여: 없음

> **작성일**: 2026-06-05
> **우선순위**: P1 (동의서 워크스테이션 운영성 — 현장 태블릿 운용)
> **전제**: [consent-workstation](consent-workstation.plan.md)(동의서 워크스테이션 + ConsentSignSession + 서명패드 + SSE) 위에 확장
> **핵심**: 태블릿을 **고정 페이지에 상주(페어링)** → 직원이 그 기기로 동의서를 **전송(디스패치)** → 태블릿에 **실시간** 표시 → 서명 결과 실시간 반영

---

## 1. 기획 배경

### 1.1 현재 방식의 한계
현재 동의서 워크스테이션은 동의서마다 **1회용 링크(토큰 URL)** 를 생성해 직원이 태블릿에서 수동으로 열어야 한다(스크린샷의 "서명 받기" 모달). 매번 링크 복사/입력이 필요하고, 환자마다 URL을 다시 열어야 한다.

### 1.2 요구사항 (요지)
- 태블릿이 **정해진 고정 링크**에 들어와 **"등록"** 을 누르면, **관리자가 승인**해 기기로 등록된다(자가 등록 + 승인).
- 등록된 태블릿은 그 페이지에 상주하면서 **동의서 서명 전용 화면**으로 동작한다.
- **해당 웹페이지는 실시간 갱신**이 가능해야 한다 — 등록 대기 → 승인 → 동의서 수신 → 서명 완료까지 새로고침 없이 자동 전환.
- 직원이 그 **기기(페이지)를 관리**하면서, 그 페이지로 **동의서를 보낸다(전송)**.
- 동의서가 전송되면 태블릿에 **실시간으로 뜨고**, 환자/보호자가 서명하면 **실시간으로 반영**된다.

### 1.3 등록 모델 (QR + 인증코드, 자동 승인 / 수동 승인 폴백)
```
[주 경로 — QR 페어링]
  관리자가 "기기 등록"을 열면 화면에 QR + 인증코드(6자리) 표시
  → 태블릿이 QR 스캔 → 등록 링크 자동 진입(QR에 URL 포함)
  → 태블릿에서 인증코드 입력 + 기기 이름 → [등록]
  → 코드 일치(=관리자 인가 증명) → 등록 완료(자동 승인) → 즉시 "대기 중"

[폴백 — 자가 등록 + 수동 승인]
  인증코드 없이 링크 진입 → [등록] → "승인 대기" 실시간 화면
  → 관리자가 목록에서 승인 → 그 순간 "대기 중"으로 자동 전환
```

### 1.4 목표
```
태블릿 = "동의서 키오스크"처럼 한 번 등록·승인해두면 계속 상주.
직원은 큐에서 동의서를 골라 "○○ 태블릿으로 보내기" 한 번이면 끝.
환자 서명 → 직원 화면·태블릿 모두 즉시 갱신.
```

---

## 2. 재사용 vs 신규

### 2.1 재사용
| 자산 | 활용 |
|------|------|
| ConsentForm / consent API / 다중서명 순서 | 동의서 본체·서명 |
| **ConsentSignSession**(1회용 토큰) | 디스패치 시 세션 발급에 재사용 |
| 서명 화면 `/consent-sign/[token]` + SignaturePad | 태블릿 서명 UI 재사용 |
| 워크스테이션 SSE(`consent/workstation/stream`) | 직원 화면 실시간 갱신 재사용 |

### 2.2 신규
| # | 항목 | 규모 |
|---|------|:----:|
| N-1 | **ConsentSigningDevice** 모델(기기 등록·상태·현재 동의서) | 소 |
| N-2 | **기기 관리** API/UI(등록/목록/상태/해제) | 중 |
| N-3 | **디스패치** API(동의서 → 기기로 전송) | 소 |
| N-4 | **기기 상주 페이지** `/consent-device/[code]`(대기↔서명 자동 전환) | 중 |
| N-5 | **기기 SSE 스트림**(디스패치/해제 실시간 푸시) | 중 |
| N-6 | 기기 하트비트(온라인/오프라인 표시) | 소 |

---

## 3. 데이터 모델 (신규)

```prisma
model ConsentSigningDevice {
  id             String    @id @default(uuid()) @db.Uuid
  deviceUid      String    @unique @map("device_uid") @db.VarChar(64) // 태블릿이 자가 생성(localStorage 보관)
  name           String    @db.VarChar(100)                 // 등록 시 입력("외래1 태블릿")
  location       String?   @db.VarChar(100)
  // 등록 상태: PENDING(승인대기) → APPROVED(승인=활성) / REJECTED
  approvalStatus String    @default("PENDING") @map("approval_status") @db.VarChar(20)
  approvedBy     String?   @map("approved_by") @db.Uuid
  approvedAt     DateTime? @map("approved_at") @db.Timestamptz()
  // 운영 상태(승인 후): IDLE, DISPATCHED, SIGNING
  status         String    @default("IDLE") @db.VarChar(20)
  currentConsentId String? @map("current_consent_id") @db.Uuid  // 현재 전송된 동의서
  currentToken   String?   @map("current_token") @db.VarChar(64) // 현재 서명 세션 토큰
  lastSeenAt     DateTime? @map("last_seen_at") @db.Timestamptz()  // 하트비트(온라인 판정)
  userAgent      String?   @map("user_agent") @db.VarChar(300)  // 등록 시 기기 정보(참고)
  isActive       Boolean   @default(true) @map("is_active")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@index([deviceUid])
  @@index([approvalStatus])
  @@index([status])
  @@map("consent_signing_devices")
}
```

```prisma
// 기기 등록용 페어링 코드 (관리자가 QR+인증코드로 발급, 1회용 단기)
model DevicePairingCode {
  id        String   @id @default(uuid()) @db.Uuid
  code      String   @unique @db.VarChar(8)            // 6자리 인증코드(QR에도 포함)
  status    String   @default("ACTIVE") @db.VarChar(20) // ACTIVE, USED, EXPIRED
  createdBy String   @map("created_by") @db.Uuid
  usedByDeviceId String? @map("used_by_device_id") @db.Uuid
  expiresAt DateTime @map("expires_at") @db.Timestamptz()  // 5분 TTL
  usedAt    DateTime? @map("used_at") @db.Timestamptz()
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([code])
  @@map("device_pairing_codes")
}
```

> - **deviceUid**: 태블릿이 최초 진입 시 생성해 localStorage에 보관 → 재진입/새로고침해도 동일 기기로 인식. 서버는 이 uid로 등록/상태를 조회.
> - **approvalStatus**가 핵심: QR 인증코드로 등록하면 즉시 APPROVED, 코드 없이 등록하면 PENDING(수동 승인 대기). REJECTED/isActive=false면 거부.
> - **DevicePairingCode**: 관리자 화면이 발급한 1회용 코드. QR URL(`/consent-device?code=######`)에 포함되며, 태블릿이 입력한 코드와 대조해 인가 검증 → 자동 승인. 5분 TTL·1회 사용.
> - ConsentSignSession은 그대로 재사용(디스패치 시 발급한 token을 device.currentToken에 보관).

---

## 4. 전체 플로우

### 4.1-A 기기 등록 — QR + 인증코드 (주 경로, 자동 승인)
```
관리자(워크스테이션 "기기")              태블릿(고정 링크)
  ├─ [+ 기기 등록] 클릭
  │   POST /consent/devices/pairing-code
  │   → DevicePairingCode(ACTIVE, 5분) 발급
  │   → 화면에 QR + 인증코드(예: 374182) 표시
  │        QR = /consent-device?code=374182
  │                                  │
  │                  태블릿이 QR 스캔 ─┤ 링크 자동 진입(code 프리필)
  │                                  ├─ deviceUid 생성(localStorage)
  │                                  ├─ 이름("외래1 태블릿") + 인증코드 확인 → [등록]
  │                                  │   POST /consent-device/enroll
  │                                  │        {deviceUid, name, code:374182}
  │   코드 대조(ACTIVE·미만료) ◀───────┘
  │   → 일치: ConsentSigningDevice(APPROVED) 생성 + 코드 USED
  │   → (실시간) 관리자 목록에 즉시 "외래1 태블릿 · 대기 중"
  │                                  ▼
  │                       ┌─ 대기 화면(상주, 승인됨) ─┐
  │                       │ 외래1 태블릿 · 서명 대기 중 │
  │                       │ ● 온라인                  │
  │                       └──────────────────────────┘
```

### 4.1-B 폴백 — 자가 등록 + 수동 승인 (코드 없이 진입 시)
```
태블릿: 코드 없이 [등록] → POST enroll {deviceUid, name} → PENDING
       → "승인 대기 중..." 실시간 화면
관리자: 승인 대기 목록 [승인] → POST /consent/devices/:id/approve
       → 태블릿 SSE {type:'approved'} → 자동 "대기 중" 전환
```
> 핵심: 태블릿 페이지는 **새로고침 없이** (미등록→)PENDING/APPROVED→(디스패치)→서명→IDLE 을 SSE로 실시간 전환.

### 4.2 디스패치(전송)·서명
```
직원(워크스테이션)                  태블릿(상주)
  ├─ 큐에서 동의서 선택
  ├─ [기기로 보내기] → 기기 선택(외래1)
  │   → POST /consent/:id/dispatch {deviceId}
  │   → ConsentSignSession 발급 + device.currentConsentId/Token 설정
  │   → 기기 SSE: {type:'dispatch', token}
  │                                  │
  │                       ┌──────────▼──────────┐
  │                       │ 자동으로 동의서 화면 전환 │
  │                       │ 전문 + 본인/보호자 +     │
  │                       │ 서명패드               │
  │                       └──────────┬──────────┘
  │   워크스테이션 SSE ◀── 서명 제출 ──┘
  ├─ 즉시 "서명됨" 반영           → 태블릿 자동 대기화면 복귀
  │
  ▼
의사/증인 서명 → 완료
```

### 4.3 취소/회수
직원이 [회수] → device.currentConsentId 해제 + 기기 SSE `{type:'clear'}` → 태블릿 대기화면 복귀.

---

## 5. API 설계 (신규)

**공개(태블릿, deviceUid 기반)**
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/consent-device/pairing-code/:code/check` | (선택) QR 진입 시 코드 유효성 사전 확인 |
| POST | `/api/v1/consent-device/enroll` | 등록 {deviceUid, name, code?}. **code 유효 시 즉시 APPROVED**, 없으면 PENDING |
| GET | `/api/v1/consent-device/:deviceUid` | 내 상태(PENDING/APPROVED/REJECTED) + 현재 동의서(있으면 sign 데이터) |
| GET(SSE) | `/api/v1/consent-device/:deviceUid/stream` | approved/dispatch/clear/revoked 실시간 푸시 |
| POST | `/api/v1/consent-device/:deviceUid/heartbeat` | 온라인 하트비트(lastSeenAt) |

**관리(staff)**
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/consent/devices/pairing-code` | QR 등록용 인증코드 발급(6자리, 5분) → {code, qrUrl, expiresAt} |
| GET | `/api/v1/consent/devices` | 기기 목록(PENDING 승인대기 + APPROVED) + 온라인 여부 |
| POST | `/api/v1/consent/devices/:id/approve` | 등록 승인(폴백) → APPROVED + 기기 SSE approved |
| POST | `/api/v1/consent/devices/:id/reject` | 등록 거부 → REJECTED |
| PATCH | `/api/v1/consent/devices/:id` | 이름/위치 변경 |
| DELETE | `/api/v1/consent/devices/:id` | 기기 해제(등록 취소) |
| POST | `/api/v1/consent/:id/dispatch` | 동의서를 기기로 전송 {deviceId} |
| POST | `/api/v1/consent/devices/:id/recall` | 전송 회수(대기화면 복귀) |

> - 미승인(PENDING/REJECTED) 기기로는 디스패치 불가.
> - 서명 제출은 기존 `POST /consent-sign/:token/submit` 재사용. 제출 성공 시 device 상태 IDLE 복귀 + 기기 SSE clear.

---

## 6. 화면 설계

### 6.1 기기 관리 (워크스테이션 내 "기기" 탭/패널)
```
┌─ 서명 기기 관리 ───────────────────────────────────────┐
│  ▸ 승인 대기 (실시간)                                   │
│    🆕 외래1 태블릿 · iPad · 방금                         │
│        [승인]  [거부]                                   │
│  ▸ 등록된 기기                                          │
│    🟢 수술장 태블릿 · 3층 OR · 서명 중(김영수)          │
│    🟢 외래2 태블릿 · 7층 외래 · 대기 중 · 12초 전        │
│    ⚪ 입원2 태블릿 · 5병동 · 오프라인 · 5분 전          │
│        각: [이름변경] [해제]                            │
└────────────────────────────────────────────────────────┘
```
> 승인 대기/기기 상태는 워크스테이션 SSE로 실시간 갱신.

### 6.1-b 기기 등록 모달 (QR + 인증코드)
```
┌─ 기기 등록 ────────────────────────┐
│   태블릿에서 아래 QR을 스캔하세요     │
│      ┌──────────┐                  │
│      │  ▓▓ QR ▓▓ │   인증코드        │
│      │  ▓▓▓▓▓▓▓▓ │   3 7 4 1 8 2    │
│      └──────────┘   (5:00 남음)     │
│  스캔 후 인증코드를 입력하면 자동 등록 │
│  스캔이 안 되면: his.example.org/      │
│                 consent-device       │
└────────────────────────────────────┘
```
> QR = `https://his.example.org/consent-device?code=374182`. 등록 성공 시 모달이 실시간으로 "✅ 외래1 태블릿 등록됨"으로 갱신.

### 6.2 디스패치 (큐 항목 액션)
```
한지영 · 항불안제 투약 동의서   [📲 기기로 보내기 ▾]
                               ├ 외래1 태블릿(대기)
                               └ 수술장 태블릿(사용중·비활성)
```

### 6.3 태블릿 상주 화면 (`/consent-device`, 고정 링크) — 실시간 상태 전환
```
[① 미등록(최초 진입 / QR 스캔)]   [② 승인 대기(코드없이 등록 시)]
  ┌──────────────────────┐        ┌──────────────────────┐
  │ 기기 등록             │        │ ⏳ 승인 대기 중...     │
  │ 이름: [외래1 태블릿 ]  │  ───▶  │ 관리자 승인을         │
  │ 인증코드: [3 7 4 1 8 2]│        │ 기다리고 있습니다     │
  │       [등록하기]      │        └──────────┬───────────┘
  └──────────────────────┘        SSE approved │ (자동)
   ↑ QR 스캔 시 인증코드 자동 채움                │
   ↑ 코드 일치 → 즉시 ③ 으로(자동 승인)          │
[③ 대기(승인됨·상주)]          ◀───────────────┘
  ┌────────────────────────────────────┐
  │   🏥 위루비병원 · 외래1 태블릿  │
  │        서명 대기 중입니다             │   ● 온라인
  └────────────────────────────────────┘
            │ SSE dispatch (자동)
[④ 서명] → /consent-sign 화면과 동일(전문+본인/보호자+서명패드+제출)
            │ 제출 완료
[⑤ 완료] → "감사합니다" 3초 → ③ 대기 화면 자동 복귀
```
> deviceUid가 localStorage에 있으면 ①을 건너뛰고 현재 상태(②/③)로 바로 진입. 모든 전환은 **새로고침 없이 SSE**로 처리(폴링 백업).

---

## 7. 실시간·보안

| 항목 | 방식 |
|------|------|
| 기기 → 서버 푸시 수신 | SSE `/consent-device/:deviceUid/stream`(공개, deviceUid 식별) |
| 직원 화면 갱신 | 기존 워크스테이션 SSE 재사용 |
| 온라인 판정 | heartbeat 30s, lastSeenAt 90s 초과 시 OFFLINE |
| **등록 승인 게이트** | 인증코드 등록=즉시 APPROVED, 코드 없으면 PENDING(관리자 승인 전 디스패치/서명 불가). 미승인 기기는 "승인 대기" 화면만 노출 |
| **페어링 인증코드** | 관리자만 발급(6자리), 5분 TTL·1회 사용. QR에 포함되나 입력 검증으로 무작위 추측 방지(짧은 TTL+단일사용). 만료/사용 후 거부 |
| 기기 인증 | deviceUid(랜덤 64자, localStorage) + 승인 상태. 거부/해제 시 즉시 무효 |
| 세션 보안 | 디스패치 시 ConsentSignSession(5분 TTL) 발급, 제출 후 즉시 소멸 |
| 오용 방지 | 한 기기에 1건만 활성(새 디스패치 시 기존 세션 만료) |
| 개인정보 | 대기화면엔 환자정보 노출 안 함, 디스패치 후에만 표시. 화면 이탈/타임아웃 시 자동 대기복귀 |

---

## 8. 구현 우선순위
| Phase | 작업 | 규모 |
|:-----:|------|:----:|
| 1 | ConsentSigningDevice + DevicePairingCode 스키마 + enroll(코드검증)/pairing-code/승인/거부/목록 API | 중 |
| 2 | 기기 관리 UI(워크스테이션 "기기" 탭 + QR/인증코드 등록 모달, 실시간). QR 렌더(경량 QR 라이브러리 또는 SVG) | 중 |
| 3 | 디스패치/회수 API + 큐 "기기로 보내기"(승인된 기기만) | 중 |
| 4 | 기기 상주 페이지 `/consent-device`(미등록→등록→승인대기→대기→서명, 실시간) | 대 |
| 5 | 기기 SSE 스트림(approved/dispatch/clear) + 하트비트(온라인/오프라인) | 중 |
| 6 | 서명 완료 후 자동 대기복귀 + 직원 실시간 반영 | 소 |

---

## 9. 성공 지표
| 지표 | 목표 |
|------|------|
| 디스패치→태블릿 표시 지연 | 1초 이하 |
| 링크 수동 입력 제거 | 100%(상주 기기) |
| 기기 온라인 가시성 | 실시간 표시 |
| 서명 완료→직원 반영 | 2초 이하 |

---

## 10. 결정 필요 (PM 체크리스트)
- [x] 기기 페어링 방식 → **QR + 인증코드(자동 승인)** 주 경로 + 자가등록·수동승인 폴백(확정)
- [ ] 인증코드 발급 권한 역할: ADMIN만 vs 간호사/접수 포함
- [ ] QR 렌더 방식: 경량 QR 라이브러리 도입 vs 외부 QR 서비스 vs 자체 SVG
- [ ] 인증코드 자릿수/TTL(6자리·5분 적정성)
- [ ] 대기화면 잠금(키오스크 모드 안내) 수준
- [ ] 다건 큐: 한 기기에 1건만 vs 대기열
- [ ] 오프라인 판정 시간(90s) 적정성
- [ ] SSE 대신 폴링 폴백(저사양 태블릿) 허용 여부

---

## 변경 이력
| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-06-05 | 초안 — 태블릿 상주 페어링 + 동의서 디스패치 + 실시간(SSE) + 기기 관리. consent-workstation/ConsentSignSession 재사용 |
| v1.1 | 2026-06-05 | 등록 모델 변경 — 직원 사전등록/코드발급 → **태블릿 자가등록(deviceUid)+관리자 승인**. 태블릿 페이지 실시간(미등록→승인대기→대기→서명) 명시. API enroll/approve/reject 추가 |
| v1.2 | 2026-06-05 | **QR + 인증코드 등록** 추가 — 관리자 화면 QR(URL)+6자리 인증코드 발급, 태블릿 QR 스캔→코드 입력→자동 승인 등록. DevicePairingCode 모델 + pairing-code API. 코드 없으면 수동승인 폴백 |
