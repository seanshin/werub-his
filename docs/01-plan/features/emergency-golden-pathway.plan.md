# 응급실 골든타임 프로토콜(Critical Pathway) 기획 — STEMI·뇌졸중·패혈증

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:4656 model EmergencyGoldenPathway · apps/api/src/modules/emergency-pathway/ · 잔여: 없음

> 2026-07-04 / Plan v1.0 / 대상: 신규 `emergency-pathway` 모듈 + FE(emergency-board)
> 계기: 응급실 검토 최대 갭 — 중증질환 시간제한(골든타임) 프로토콜/번들 부재.

## 1. 범위 (3종 모두)
시간제한 크리티컬 패스웨이 3종을 활성화→마일스톤 타임스탬프→완료로 관리하고 **카운트다운·목표 초과**를 실시간 표시.

| 프로토콜 | 핵심지표 | 목표 | 번들 마일스톤(목표분) |
|----------|----------|:---:|------|
| **STEMI**(심근경색) | Door-to-Balloon | 90분 | 12유도 심전도(10)·순환기 통보(15)·항혈소판제(20)·심도자실 활성화(30)·재관류 PCI(90) |
| **STROKE**(뇌졸중) | Door-to-Needle | 60분 | NIHSS(10)·신경과 통보(15)·뇌 CT/CTA(25)·CT 판독(45)·tPA 투여(60) |
| **SEPSIS**(패혈증) | 1시간 번들 | 60분 | 젖산 측정(30)·혈액배양(45)·광범위 항생제(60)·수액 30mL/kg(60)·젖산 재측정(120) |

## 2. 설계
- **모델 `EmergencyGoldenPathway`**(plain visitId/patientId·비파괴): pathwayType·activatedAt·targetMinutes·primaryMetric·milestones(Json 배열 {key,label,targetMin,doneAt,doneBy})·status(ACTIVE/COMPLETED/CANCELLED)·completedAt·primaryMetricMinutes.
- **서비스**: activate(템플릿에서 마일스톤 초기화)·completeMilestone(key 타임스탬프)·complete(핵심지표 소요분 산출)·cancel·getActive(경과/목표/온타임)·getByVisit.
- **FE**(emergency-board): 활성 골든패스웨이 카드 — 경과 카운트업·목표 대비 색상·마일스톤 체크(완료/지연)·활성화/완료 버튼. 30초 폴링.

## 3. 안전·정합
- 신규 모델만·기존 응급 흐름 무영향. 마일스톤 목표 초과는 **시각 경고**(환자안전).
- 핵심지표(Door-to-Balloon/Needle) 완료 시 실측 소요분 기록 → 질지표(KPI).

## 4. 배포
신규 모델 1 → manual SQL(CREATE TABLE) → prisma generate → --api → --web.
