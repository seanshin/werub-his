# 역할·진료과별 접근 권한 세밀화 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/components/layout/Sidebar.tsx:639 · apps/api/src/modules/access-control/access-control.service.ts:112 · 잔여: 없음

> **Feature**: role-department-access-control
> **Project**: Hospital RUN
> **Version**: 1.0
> **Date**: 2026-05-20
> **Status**: Draft

---

## 1. 문제 정의

### 1.1 현재 상태

성형외과 의사(테스트성형외과)로 로그인 시:

| 항목 | 현재 | 문제 |
|------|------|------|
| **사이드바** | 모든 전문과 메뉴 표시 (내과, 치과, 안과 등 18과) | 본인 과가 아닌 메뉴 불필요 |
| **대시보드 미완료 차트** | 전체 미완료 차트 표시 | 다른 과 환자 차트가 보임 |
| **대시보드 검사결과** | 전체 검사결과 도착 표시 | 다른 과 환자 검사결과 보임 |
| **대시보드 대기 환자** | 전체 대기 환자 수 | 본인 과 대기만 보여야 함 |
| **차트 템플릿** | 전체 60개 (정리 후 10개) | 본인 과 템플릿만 보여야 함 |
| **환자 목록** | 전체 환자 | 내 환자 / 내 과 환자 필터 |

### 1.2 원칙

```
의사: 자기 과 중심 + 공통 메뉴
간호사: 배정 병동/과 중심 + 공통 메뉴
약사: 약국 메뉴 + 공통
검사: 검사실 메뉴 + 공통
관리자: 전체 접근
```

---

## 2. 접근 권한 매트릭스

### 2.1 사이드바 메뉴 접근

#### 의사 (DOCTOR)

| 메뉴 그룹 | 표시 조건 |
|----------|---------|
| **임상 공통** (대시보드, 접수, 환자, 예약, 처방, 약국, 수술, 응급, ICU) | ✅ 항상 |
| **내 전문과** (예: 성형외과) | ✅ user.department 일치 시만 |
| **다른 전문과** (예: 내과, 치과) | ❌ 숨김 |
| **검사/영상** (검사실, 영상실, 병리과) | ✅ 항상 (의뢰 목적) |
| **입원** (입원환자, 병상) | ✅ 항상 |
| **의무기록** (동의서, 기록검색) | ✅ 항상 |
| **내 설정** | ✅ 항상 |
| **관리자 메뉴** | ❌ 숨김 (ADMIN만) |

#### 간호사 (NURSE)

| 메뉴 그룹 | 표시 조건 |
|----------|---------|
| **임상 공통** | ✅ 항상 |
| **전문과 메뉴** | ❌ 전체 숨김 (간호사는 진료과 페이지 불필요) |
| **간호 전용** (간호 워크스테이션, PACU) | ✅ 항상 |
| **입원** | ✅ 항상 |

### 2.2 사이드바 전문과 필터 로직

```typescript
// 현재 (DOCTOR에게 모든 과 표시):
if (!item.roles || !item.roles.includes(userRole)) return false;
return true;

// 수정 (DOCTOR는 본인 과만):
if (!item.roles || !item.roles.includes(userRole)) return false;

// 전문과 메뉴는 본인 과만 표시
const SPECIALTY_PREFIXES = [
  '/internal-medicine', '/dental', '/ophthalmology', '/dermatology', '/ent',
  '/orthopedics', '/obgyn', '/pediatrics', '/psychiatry', '/neurosurgery',
  '/plastic', '/urology', '/rehab', '/radiation', '/dialysis', '/blood-bank',
];
if (SPECIALTY_PREFIXES.some(p => item.href.startsWith(p))) {
  if (userRole === 'DOCTOR') {
    // 본인 과 매핑
    const deptToPath: Record<string, string> = {
      '내과': '/internal-medicine',
      '치과': '/dental',
      '성형외과': '/plastic',
      // ... 전체 매핑
    };
    const myPath = deptToPath[userDept];
    return item.href === myPath;
  }
  if (userRole === 'NURSE') return false; // 간호사는 전문과 메뉴 불필요
}
return true;
```

---

## 3. 대시보드 데이터 필터

### 3.1 의사 대시보드

| 카드 | 현재 | 수정 |
|------|------|------|
| 내 대기 환자 | 전체 대기 | **내 예약 환자** 중 대기만 |
| 오늘 내 예약 | 전체 예약 | **내 예약**만 (현재 양호) |
| 오늘 진료 | 전체 진료 | **내 진료**만 |
| 미완료 차트 | 전체 미완료 | **내 미완료**만 |
| 내 검사결과 | 전체 결과 | **내가 의뢰한 검사** 결과만 |

### 3.2 API 필터 적용

```
현재: GET /api/v1/dashboard/overview
→ 전체 count

수정: GET /api/v1/dashboard/overview
→ JWT에서 userId 추출 → doctorId 기준 필터
→ encounter.doctorId = userId
→ labResult.order.doctorId = userId
```

---

## 4. 검사결과 도착 필터

```
현재:
  GET /api/v1/lab/results/recent → 전체 최근 결과

수정:
  GET /api/v1/lab/results/my-recent → 내가 의뢰한 검사 결과만
  WHERE order.doctorId = currentUserId
```

---

## 5. 미완료 차트 필터

```
현재:
  GET /api/v1/encounter?status=DRAFT → 전체 DRAFT

수정:
  GET /api/v1/encounter?status=DRAFT&doctorId=me → 내 DRAFT만
```

---

## 6. 차트 템플릿 필터

```
현재:
  전체 템플릿 표시 (60→10개)

수정:
  본인 과 + 공통 템플릿만 표시
  WHERE department = userDept OR department = '공통'
```

---

## 7. 환자 목록 기본 필터

```
현재:
  /patients → 전체 환자

수정:
  /patients → 기본적으로 "내 환자" 탭 활성
  내 환자 = 내가 최근 진료한 환자 (encounter.doctorId = me)
  전체 환자 = 별도 탭으로 전환 시
```

---

## 8. 구현 항목 요약

| # | 항목 | 변경 위치 | 영향 |
|---|------|---------|------|
| 1 | **사이드바 전문과 필터** | Sidebar.tsx | 의사: 본인 과만, 간호사: 전문과 숨김 |
| 2 | **대시보드 카드 필터** | dashboard API + 프론트 | doctorId 기준 |
| 3 | **검사결과 도착** | DoctorDashboard.tsx | 내 의뢰 결과만 |
| 4 | **미완료 차트** | DoctorDashboard.tsx | 내 DRAFT만 |
| 5 | **차트 템플릿** | chart-editor/page.tsx | 내 과 + 공통만 |
| 6 | **환자 목록 기본 필터** | patients/page.tsx | 내 환자 탭 기본 |

### 예외: 관리자(ADMIN)
- 모든 메뉴 접근 가능 (변경 없음)
- 대시보드에서 전체 현황 표시 (변경 없음)

### 예외: 응급의학과
- 다른 과 환자도 볼 수 있어야 함 (응급 특성)
- 응급실 의사는 전체 접근 유지

---

## 9. 구현 단계

### Phase 1: 사이드바 (즉시)
- Sidebar.tsx에 전문과 필터 로직 추가
- deptToPath 매핑 테이블
- 5분 작업

### Phase 2: 대시보드 필터
- dashboard overview API에 doctorId 필터 추가
- DoctorDashboard 검사결과/미완료 차트 필터
- 프론트에서 내 데이터만 표시

### Phase 3: 차트 템플릿 + 환자 목록
- 차트 템플릿 과 필터
- 환자 목록 기본 탭 "내 환자"

---

## 10. 보안 고려

| 원칙 | 설명 |
|------|------|
| **UI 필터 ≠ API 보안** | 사이드바 숨김은 UX 편의. API 레벨 접근 제어는 별도 (현재 RBAC Guard) |
| **환자 차트 접근** | 모든 의사가 모든 환자 차트를 볼 수 있어야 함 (의료 응급 상황) |
| **Break-the-Glass** | 타과 환자 차트 접근 시 사유 기록 (btg 모듈 이미 구현) |
| **감사 로그** | 타과 데이터 접근 시 로그 기록 |

> **핵심**: 접근을 **차단**하는 것이 아니라 **기본 화면을 정리**하는 것.
> 의사가 원하면 다른 과 정보도 볼 수 있지만, 기본 화면에서는 내 과/내 환자만 보여주는 것이 목표.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-20 | 초안 — 사이드바/대시보드/검사/차트/환자 6개 필터 항목 | PM |
