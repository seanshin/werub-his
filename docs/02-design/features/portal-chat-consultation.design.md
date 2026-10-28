# 환자포털 통합 상담실 설계 v1.0 (구현 반영)

> Plan: portal-chat-consultation.plan v1.3 · 작성 2026-06-08 · 상태: 구현 완료
> 연관: [[multilingual-i18n]] 공유 번역 엔진, telehealth(Jitsi), notification(SSE 패턴)

## 1. 데이터 모델 (Prisma)
- `ConsultSession`: id, patientId, status(OPEN/ACTIVE/CLOSED), locale, category, assigneeId, jitsiRoom, videoStartedAt, rating, ratingComment, timestamps
- `ConsultMessage`: id, sessionId, sender(PATIENT/AI/STAFF), content(수신자 언어), contentKo(직원용 한국어), attachmentUrl, lang, readAt, createdAt

## 2. API
### 환자 (`/api/v1/portal/consult`, PortalOrPatientGuard)
| Method | Path | 설명 |
|--------|------|------|
| POST | `/` | 세션 열기(locale) + serviceOnline |
| GET | `/:id` | 상태·평가·대기위치(waitingPosition)·serviceOnline |
| GET | `/:id/messages` | 메시지(환자 언어) |
| POST | `/:id/message` | 전송 → 즉시 저장, 번역·AI 1차는 백그라운드 |
| POST | `/:id/video` | 1:1 화상(환자=게스트 Jitsi 토큰) |
| POST | `/:id/rate` | 만족도 1~5 |
| POST | `/:id/attachment` | 이미지/PDF 업로드(multipart, 5MB → uploads/consult) |
| SSE | `/:id/stream` | 실시간 신호 |

### 직원 (`/api/v1/consult`, JwtAuthGuard+Roles DOCTOR/NURSE/ADMIN) — 화면 `/consult`(코드2102)
| Method | Path | 설명 |
|--------|------|------|
| GET | `/sessions?status=` | 인박스(환자명·MRN·언어·마지막메시지) |
| GET | `/sessions/:id/messages` | 직원용(한국어 우선 + 원문) |
| POST | `/sessions/:id/reply` | 답변(한국어 → 환자 언어 번역) |
| POST | `/sessions/:id/claim` | 담당 배정(ACTIVE) |
| POST | `/sessions/:id/video` | 화상(직원=모더레이터) |
| POST | `/sessions/:id/close` | 종료 |
| SSE | `/sessions/:id/stream` | 실시간 신호 |

## 3. 핵심 설계 결정
- **AI 1차 비동기**: LLM 호출을 응답 경로에서 분리(백그라운드). 한국어는 토큰 스트리밍(메시지 누적 갱신+SSE), 외국어는 생성 후 번역.
- **다국어**: [[multilingual-i18n]] 공유 엔진. 환자 언어↔직원 한국어 양방향, content=수신자언어 / contentKo=직원 한국어 병기.
- **실시간(신호식 SSE)**: 메시지 생성 시 `emit` → 프론트 `subscribeSseSignal`(fetch-streaming, 헤더인증)이 신호받아 메시지 재조회. EventSource 헤더 한계 회피. 15초 폴백 폴링.
- **화상**: telehealth Jitsi 재사용(buildJitsiToken). iframe `/meet/{room}?jwt=`. 환자 게스트/직원 모더레이터, prejoin off.
- **운영**: serviceOnline(평일 09~18, CONSULT_HOUR_*), waitingPosition(OPEN 큐), claim 배정.

## 4. 프론트
- 환자: `portal/_consult/ConsultChat.tsx`(좌하단 💬) — 언어선택·채팅·📹화상·📎첨부·만족도·영업시간/대기 안내(다국어)
- 직원: `(main)/consult/page.tsx` — 인박스+대화, 담당하기·화상·종료, 원문 병기

## 5. 단계 이력
P1 채팅·다국어·AI 1차 → P2 직원 데스크 → P2b 화상 → SSE 실시간화 → P5 만족도·첨부 → 운영(영업시간·대기·claim) → AI /api/chat 스트리밍
