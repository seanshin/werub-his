# Clinic Integration (외부 클리닉 연동) 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/clinic-integration/clinic-integration.controller.ts:519 · apps/api/src/modules/clinic-integration/clinic-integration.controller.ts:222 · 잔여: 🔴 직원 동기화(pushStaff)가 활성 직원 전원을 공용 하드코딩 비밀번호로 Clinic 에 등록(`clinic-integration.controller.ts:222` — 2026-09-14 G12 실측)(사람)
> 작성일: 2026-05-09

## 1. 목적
WeRU.B Clinic(그룹웨어)과 HIS를 SSO/직원동기화/알림/캘린더/전자결재/Wiki로 연동하여, 병원 내 업무 시스템을 통합한다.

## 2. 기능 목록

### Phase 1: 직원 동기화 및 SSO
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/clinic/status` | GET | Clinic 연동 상태 확인 |
| `/api/v1/clinic/role-mapping` | GET | 직원 역할 매핑 조회 |
| `/api/v1/clinic/role-mapping` | PUT | 역할 매핑 업데이트 |
| `/api/v1/clinic/sync-staff` | POST | Clinic → HIS 직원 동기화 |
| `/api/v1/clinic/push-staff` | POST | HIS → Clinic 직원 등록 |
| `/api/v1/clinic/sync-logs` | GET | 동기화 이력 조회 |
| `/api/v1/clinic/hospital` | GET | 병원 정보 (Clinic 연동용) |
| `/sso` | GET | SSO 랜딩 (Clinic → HIS 리다이렉트) |
| `/api/v1/sso/verify` | POST | SSO 토큰 검증 (내부용) |

### Phase 2: 알림 및 채널
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/clinic/notify` | POST | Clinic 알림 발송 |
| `/api/v1/clinic/notify/urgent` | POST | 긴급 알림 발송 |
| `/api/v1/clinic/channel/message` | POST | 채널 메시지 발송 |
| `/api/v1/clinic/channel/handoff` | POST | 인수인계 노트 발송 |
| `/api/v1/clinic/channels` | GET | 채널 목록 조회 |

### Phase 3: 캘린더 및 근태
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/clinic/calendar/sync` | POST | HIS 캘린더 → Clinic 동기화 |
| `/api/v1/clinic/calendar/surgery` | POST | 수술 일정 → Clinic 동기화 |
| `/api/v1/clinic/attendance` | GET | 출퇴근 현황 조회 |
| `/api/v1/clinic/leave/:userId` | GET | 연차 잔여 조회 |
| `/api/v1/clinic/leave/request` | POST | 연차 신청 |

### Phase 4: 전자결재 및 Wiki
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/clinic/wsign/request` | POST | 전자결재 요청 (W.Sign) |
| `/api/v1/clinic/wsign/status/:docId` | GET | 전자결재 상태 조회 |
| `/api/v1/clinic/wiki/search` | GET | Wiki 검색 (ShareSpace) |
| `/api/v1/clinic/wiki/page/:pageId` | GET | Wiki 페이지 조회 |
| `/api/v1/clinic/wiki/page` | POST | Wiki 페이지 생성 |

### Phase 5: Webhook
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/clinic/webhooks/subscribe` | POST | Webhook 구독 등록 |
| `/api/v1/clinic/webhooks/subscriptions` | GET | Webhook 구독 목록 |
| `/api/v1/clinic/webhooks/:id` | DELETE | Webhook 구독 해제 |
| `/api/v1/webhooks/clinic` | POST | Clinic Webhook 수신 (HMAC 서명 검증) |

## 3. 데이터 모델
**ClinicSyncLog**
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| syncType | VARCHAR(50) | 동기화 유형 (PUSH_STAFF, PULL_STAFF 등) |
| status | VARCHAR(20) | 상태 (SUCCESS, FAILED, PARTIAL) |
| totalSent | INT | 전송 수 |
| registered | INT | 등록 수 |
| skipped | INT | 건너뛴 수 |
| failed | INT | 실패 수 |
| details | JSONB | 상세 결과 (nullable) |
| errorMessage | TEXT | 에러 메시지 (nullable) |
| executedBy | UUID | 실행자 (FK → User) |
| executedAt | TIMESTAMPTZ | 실행일시 |

**WebhookSubscription**
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| url | VARCHAR(500) | Webhook URL |
| events | VARCHAR(50)[] | 구독 이벤트 목록 |
| secret | VARCHAR(200) | HMAC 서명 시크릿 |
| isActive | BOOLEAN | 활성 여부 |
| createdAt | TIMESTAMPTZ | 생성일시 |

**Staff.clinicUserId** — 기존 Staff 모델에 Clinic 사용자 ID 매핑 필드 추가

## 4. 프론트엔드
- 관리자 설정 내 Clinic 연동 관리 페이지
- SSO 랜딩: `/sso?token=xxx` → 대시보드 리다이렉트
- 프론트엔드 SSO 페이지: `/sso?accessToken=xxx`

## 5. 상태
구현 완료 — 28개 엔드포인트 (5 Phase) + SSO 컨트롤러 + Webhook 수신기
