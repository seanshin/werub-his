# FCM 푸시 알림 (Mobile Push Notification) Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/notification/fcm-push.service.ts:13 · apps/api/src/modules/patient-auth/patient-auth.service.ts:1211 · 잔여: FCM 자격·푸시 켜기(사람)

> **Summary**: 모바일앱 FCM 푸시 알림 — 호출/검사완료/수납/입원 실시간 알림
>
> **Project**: Hospital RUN
> **Date**: 2026-05-29
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

환자가 앱을 열지 않아도 병원 여정 이벤트(호출/검사완료/수납대기 등)를 실시간으로 받을 수 있도록
FCM(Firebase Cloud Messaging) 기반 푸시 알림을 모바일앱에 통합한다.

### 1.2 Background

- BE에 `PatientDevice.fcmToken` 필드가 존재하나 저장 로직 없음
- `PatientNotification` 모델 + `NotificationSetting` 모델 완비
- 의료진용 SSE 알림은 구현됨, 환자용 푸시는 미구현
- Expo SDK 56 기반 → `expo-notifications` 사용

---

## 2. Scope

### 2.1 In Scope

- [ ] BE: FCM 토큰 등록/갱신 API
- [ ] BE: 푸시 발송 서비스 (firebase-admin)
- [ ] BE: PatientNotification 생성 시 자동 푸시
- [ ] FE: expo-notifications 설치 + 권한 요청
- [ ] FE: FCM 토큰 등록 (로그인 시)
- [ ] FE: 포그라운드/백그라운드 알림 수신
- [ ] FE: 알림 탭 → 읽음 처리

### 2.2 Out of Scope

- SMS 알림 (별도 기획)
- 카카오 알림톡 (별도 기획)
- 웹 푸시 (Service Worker — FR-08 이연)

---

## 3. Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | 로그인 시 FCM 토큰 서버 등록 | High |
| FR-02 | 호출됨(CALLED) → 즉시 푸시 | High |
| FR-03 | 검사 결과 완료 → 푸시 | High |
| FR-04 | 수납 대기 → 푸시 | Medium |
| FR-05 | 입원 회진 예정 → 푸시 | Medium |
| FR-06 | 알림 설정 (유형별 on/off) | Medium |
| FR-07 | 포그라운드 인앱 배너 | Medium |
| FR-08 | 알림 탭 실시간 갱신 | Low |

---

## 4. 기존 인프라 활용

| 모델/서비스 | 현황 | 필요 작업 |
|------------|------|----------|
| `PatientDevice.fcmToken` | 컬럼 존재, 미사용 | 저장 로직 추가 |
| `PatientNotification` | 모델 완비 (type/title/body/sentVia) | 푸시 발송 트리거 연결 |
| `NotificationSetting` | pushEnabled 필드 존재 | 발송 전 체크 로직 |
| `patient-auth.service.ts login()` | device upsert 존재 | fcmToken 파라미터 추가 |
| `notification.listener.ts` | 의료진 이벤트 리스너 | 환자용 리스너 추가 |

---

## 5. 구현 순서

| Step | 작업 | 규모 |
|:----:|------|:----:|
| 1 | FE: expo-notifications 설치 + 권한 요청 + 토큰 획득 | 소 |
| 2 | BE: FCM 토큰 등록 API + login에 fcmToken 추가 | 소 |
| 3 | BE: firebase-admin 푸시 발송 서비스 | 중 |
| 4 | BE: PatientNotification 생성 → 자동 푸시 | 중 |
| 5 | FE: 포그라운드 배너 + 백그라운드 핸들러 | 소 |
| 6 | 통합 테스트 + 배포 | 소 |
