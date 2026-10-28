# 진단 기반 약속처방 관리 + 기본형 자동선택 + AI 연계 기획 (Diagnosis-Driven Order Set)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/app.module.ts:104 · apps/api/prisma/schema.prisma:347 · apps/web/src/app/(main)/patients/[id]/encounter/new/components/ApplyOrderSetModal.tsx · 잔여: 없음

> 작성: 2026-07-14 / 상태: Plan v1.0 (승인 대기 — 구현 착수 전 검토 필요)
> 관련: [regimen-cpoe-bridge](regimen-cpoe-bridge.plan.md) · [pre-prescription-enhancement](pre-prescription-enhancement.plan.md) · [diagnosis-treatment-schedule](diagnosis-treatment-schedule.plan.md)
> 한 줄: 주상병·부상병이 확정되면 약처방·검사·영상·치료·식이·활동·간호 **7유형 약속처방**을 자동 추천하고, 선택 시 **기본형(default) 항목이 자동 선택**되며, AI가 추천·검증·초안생성으로 연계되는 체계를 만든다.

---

## 1. 배경·현황 (2026-07-14 실사)

### 이미 있는 것
- `OrderSet` 모델(schema:6629): name/code/category/diagnosisCode/items(JsonB)/버전관리(parentId)/승인 상태머신(DRAFT→PENDING_APPROVAL→APPROVED→ACTIVE→DEPRECATED)/사용통계(useCount)/금기(contraindications)/연령군(ageGroup).
- CRUD·버전·승인·통계·즐겨찾기 API 15종(`order-set.controller.ts`), admin 빌더(`admin/order-sets/page.tsx`).
- 진단 추천: `GET /order-sets/recommend?diagnosisCodes=` — `diagnosisCode IN (...)` **exact match**.
- CPOE 연동: `OrderSetPanel`(패널) + `RecommendedOrderSets`(진단 배너) → `handleApplyOrderSet`(encounter/new/page.tsx:1067).
- CDSS `suggest-orderset`(cdss.service.ts:173) — 알레르기·초진 맥락 포함하나 FE 미사용.
- AI: `POST /ai/recommend-drugs`가 `orderSetSuggested`(텍스트)를 반환하나 **DB 미연결·클릭 적용 불가**.

### 결함·갭 (이번 기획의 대상)
| # | 갭 | 근거 |
|---|----|------|
| G1 | **미해석 유령 처방**: items가 name 문자열만 보유(codeId 없음) → 적용 시 `unresolved`로 로컬 표시만 되고 서버 처방 미생성. 시드 order set 전부 해당 | page.tsx:1087~1105, seed.ts:3090~ |
| G2 | **유형 5종뿐**(MEDICATION/LAB/IMAGING/ORDER/DOCUMENT) — 치료(THERAPY)/식이(DIET)/활동(ACTIVITY)/간호(NURSING) 미지원. `PrescriptionType`에는 7유형이 이미 존재(schema:1100) | admin 빌더 ITEM_TYPES:49 |
| G3 | **진단 연결이 단일 코드 exact match**: OrderSet당 diagnosisCode 1개(VarChar)·주/부상병 구분 없음·KCD 계층(prefix) 매칭 없음·다중진단 조합 없음 | order-set.service.ts:84 |
| G4 | **기본형 개념 부재**: 항목별 필수/선택/기본선택 구분이 없어 적용=전량 생성. 부분 적용은 불가 | items JsonB 구조 |
| G5 | **AI 미연계**: orderSetSuggested는 LLM 텍스트, CDSS suggest-orderset은 FE 미사용, AI 추천→적용 플로우 없음 | medical-ai.service.ts:1044 |

## 2. 목표·비목표

**목표**
1. 진단(주상병 우선) 확정 → 관련 약속처방 자동 추천 (계층 매칭·다중진단·사용실적 반영).
2. 7유형(약/검사/영상/치료/식이/활동/간호) 항목 지원 + 항목별 **기본형(isDefault) 자동 선택** UI.
3. 미해석 유령 근절: 항목 코드 정규화 + 해석 파이프라인 + 미해석 항목 적용 차단.
4. AI 연계 3종: (a) AI 추천→실제 OrderSet 매칭·클릭 적용, (b) AI 약속처방 초안 생성(관리 도구), (c) 적용 시점 AI 안전 체크.

**비목표**
- 자동 처방 확정/서명(금지 — 적용은 항상 의사 검토 모달 경유).
- 치료일정 자동 전개(→ [diagnosis-treatment-schedule](diagnosis-treatment-schedule.plan.md) 별도 기획).
- 항암 레지멘(→ regimen-cpoe-bridge 기존 기획 유지).

## 3. 핵심 설계

### 3.1 데이터 모델 개편

**(a) `OrderSetDiagnosis` 신설 — 진단 다대다 매핑**
```prisma
model OrderSetDiagnosis {
  id           String   @id @default(uuid())
  orderSetId   String
  diagnosisCode String  @db.VarChar(20)   // KCD-8 코드 or prefix
  matchType    String   @default("EXACT") // EXACT | PREFIX (E11 → E11.*)
  role         String   @default("ANY")   // PRIMARY_ONLY | ANY — 주상병일 때만 추천할지
  weight       Int      @default(100)     // 추천 정렬 가중치
  @@unique([orderSetId, diagnosisCode])
  @@index([diagnosisCode])
}
```
- 기존 `OrderSet.diagnosisCode`(단일)는 하위호환 유지 + 마이그레이션 시 OrderSetDiagnosis로 복사.

**(b) items 정규화 — JsonB 유지하되 스키마 강제**
정규화 테이블 분리 대신 **JsonB 구조를 DTO로 엄격 검증**(class-validator, 기존 전역 whitelist 활용):
```ts
interface OrderSetItem {
  type: 'MEDICATION'|'LAB'|'IMAGING'|'THERAPY'|'DIET'|'ACTIVITY'|'NURSING'|'DOCUMENT'
  name: string
  medicationCodeId?: string   // MEDICATION일 때 필수
  procedureCodeId?: string    // LAB/IMAGING/THERAPY일 때 필수
  nursingCodeId?: string      // NURSING일 때 (NursingCode schema:996)
  dietCode?: string           // DIET일 때 (DietOrder 유형 코드)
  isDefault: boolean          // ★ 기본형: 적용 모달에서 자동 체크
  isRequired: boolean         // 해제 불가 (임상 필수)
  dosage?, frequency?, duration?, route?, quantity?   // MEDICATION
  variant?: string            // 'ADULT'|'PEDIATRIC'|'RENAL' 등 변형군
}
```
- **ACTIVE 승격 게이트**: `changeStatus`에서 APPROVED→ACTIVE 시 **전 항목 코드 해석 완료 검증**(MEDICATION인데 medicationCodeId 없으면 승격 거부). 신규 유령 발생 원천 차단.

**(c) 미해석 재고 정리 — 해석 파이프라인**
- `POST /order-sets/:id/resolve-items`: name 기반 자동 후보 매칭(MedicationCode/ProcedureCode ILIKE + pg_trgm 유사도) → 후보 목록 반환 → admin 빌더에서 **사람이 확정**(자동확정 금지).
- admin 빌더에 "미해석 항목 N건" 배지 + 일괄 해석 콘솔.
- CPOE `handleApplyOrderSet`: 미해석 항목은 로컬 배열 추가 대신 **명시 경고 모달**("이 약속처방은 N건 미해석 — 관리자 해석 필요")로 적용 자체를 안내 후 해석된 항목만 생성. `codeId:''` 유령 push 제거.

### 3.2 추천 엔진 v2 (`recommend`)

```
입력: encounter의 진단 목록 [{code, type(PRIMARY/SECONDARY), rank}] + 환자 맥락(연령·성별·입원여부)
매칭: OrderSetDiagnosis에서
  1) EXACT: code 완전일치
  2) PREFIX: 등록된 prefix가 진단코드의 앞부분과 일치 (E11 ← E11.9)
스코어: matchScore = weight
  × (주상병 매칭 ×1.5 | 부상병 ×1.0)
  × (EXACT ×1.2 | PREFIX ×1.0)
  + log(useCount+1) 부스팅
필터: ageGroup(환자 연령), status=ACTIVE, contraindications(알레르기 교차 — CDSS 로직 이관)
정렬: matchScore desc, 상위 5개
```
- 기존 `GET /order-sets/recommend` 하위호환 유지(응답에 matchScore·matchedBy 추가).
- CDSS `suggest-orderset`의 알레르기/초진 맥락 로직을 이 엔진으로 통합(중복 제거).

### 3.3 기본형 자동선택 UX (CPOE)

```
진단 확정(주상병 지정) → RecommendedOrderSets 배너 갱신
  → [적용] 클릭 → ★ 적용 검토 모달 (신규)
     ├ 항목 7유형 그룹별 표시 (약/검사/영상/치료/식이/활동/간호)
     ├ isDefault=true 항목: 자동 체크 (기본형)
     ├ isRequired=true 항목: 체크 고정(해제 불가) + "필수" 배지
     ├ 나머지: 미체크 (의사가 선택)
     ├ variant 선택기 (성인/소아/신부전 — 환자 연령으로 초기값 자동)
     ├ MEDICATION 항목: 용량/용법 인라인 수정 가능
     └ AI 체크 결과 배지 (§3.4-c)
  → [선택 항목 생성] → 유형별 라우팅:
     MEDICATION/LAB/IMAGING/THERAPY → addPrescription (기존, DUR 통과)
     DIET → DietOrder 생성 / ACTIVITY·NURSING → Prescription(type) + Order
  → OrderSetUsage 기록 (itemsApplied/itemsModified — 기본형 대비 수정률 통계)
```
- 현재 "전량 즉시 생성" → "기본형 프리셀렉트 + 검토 후 생성"으로 전환. 수정률 통계(`getUsageStats`)가 기본형 품질 개선의 피드백 루프.

### 3.4 AI 연계 (WeRU.B)

| | 기능 | 설계 |
|---|------|------|
| a | **AI 추천→적용 연결** | `recommend-drugs`의 `orderSetSuggested`를 자유 텍스트 → **OrderSet.code 강제**(프롬프트에 ACTIVE 약속처방 code+name 목록 주입, 목록 내 선택만 허용). 응답 시 서버가 DB 검증 후 실 OrderSet 객체 동봉 → FE에서 "적용" 버튼 → §3.3 모달 |
| b | **AI 약속처방 초안 생성** (관리 도구) | admin 빌더에 "AI 초안": 진단코드+진료과 입력 → WeRU.B가 항목 초안(JSON) 생성 → 자동 코드 해석(§3.1-c 후보 매칭) → **DRAFT로만 저장** → 기존 승인 상태머신(PENDING_APPROVAL→APPROVED) 그대로. AI는 초안, 승인은 사람 |
| c | **적용 시점 AI 안전 체크** | 적용 모달 열릴 때 비차단 호출: 선택 항목 + 환자 맥락(연령·성별·알레르기·신기능·병용약) → 금기/중복/용량 경고 배지. formulary AI 체크리스트 패턴 재사용. **비차단**(응답 지연 시 모달 동작 무영향)·차단은 기존 DUR 게이트만 |

- 모든 AI 호출은 `aiFetch` 일원화 경로(kill-switch `ai.server.enabled`) 준수.

## 4. 단계

| 단계 | 내용 | 산출 |
|------|------|------|
| P0 | 미해석 근절: items DTO 검증 + ACTIVE 승격 게이트 + resolve-items 후보 매칭 + admin 해석 콘솔 + CPOE 유령 push 제거 | 유령 처방 0 |
| P1 | 7유형 확장 + isDefault/isRequired/variant + 적용 검토 모달(기본형 자동선택) + 유형별 생성 라우팅 | 기본형 UX |
| P2 | OrderSetDiagnosis 다대다 + 추천 엔진 v2(주상병 가중·prefix·스코어) + CDSS 통합 | 진단 기반 추천 |
| P3 | AI 3종(추천 연결·초안 생성·안전 체크) | AI 연계 |

## 5. 리스크·가드

- **처방 안전**: 적용은 항상 검토 모달 경유, DUR/서명 게이트 불변. isRequired 해제 불가 항목도 생성 전 의사 확인은 필수.
- **시드 데이터**: 기존 시드 order set 전량 미해석 — P0 해석 콘솔로 운영 데이터 정리 필요(자동 스크립트 + 사람 확정).
- **하위호환**: OrderSet.diagnosisCode 단일 필드·기존 recommend 응답 형태 유지(추가 필드만).
- **성능**: OrderSetDiagnosis 인덱스 + ACTIVE 필터로 추천 쿼리 경량 유지.
