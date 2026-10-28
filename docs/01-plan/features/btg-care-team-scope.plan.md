# Break-the-Glass / Care-Team 접근 스코프 — 설계 (의사결정 지원)

> 2026-07-04 / Plan v1.0 / 상위: [perf-security-remediation-2026h2.plan](perf-security-remediation-2026h2.plan.md) 3-A·잔여
> 계기: P1 감사에서 `GET /clinical-chart-results?patientId=`가 역할만으로 임의 환자 PHI 조회 가능(규범보다 느슨) 지적. 검토 결과 **단일 EP 문제가 아니라 임상데이터 접근 전반의 아키텍처 결정**임이 확인됨.

## 0. 핵심 사실 (코드 grounded)
- **BTG 인프라는 이미 존재하나 dead code**: `audit-enhanced/btg.guard.ts`(`BreakTheGlassGuard`)·`btg.service.ts`·`BreakTheGlassAccess` 모델이 있고 모듈에 provider/export 등록까지 됐지만 **어떤 컨트롤러에도 `@UseGuards`로 배선돼 있지 않음**.
- **현재 실제 규범 = 역할 기반만**: 임상 조회 EP(nurse-station vitals/patient·internal-medicine exams·lab results·clinical-chart-result 등) 전부 `@Roles`만. **담당(care-team) 확인·BTG 강제 없음**.
- **가드 한계**: `checkAssignment`가 **doctorId만**(최근 30일 encounter·현재 입원 admittingDoctor) 확인 → **간호사·기타 직군 미포함**. patientId는 params/query/body에서 추출(clinical-chart-result의 `query.patientId`와 호환).
- **FE 미지원**: 임상 화면은 `X-BTG-Reason` 헤더를 보내지 않음 → 가드를 그대로 켜면 비담당의·전 간호사가 403.
- **관련 존재물**: `CareTeam` 모델·`auth/break-glass`(ADMIN grant)·portal guardian-BTG(GUARDIAN_BTG 감사).

→ **결론**: 가드를 단일 EP에 naive 배선하면 (a)그 EP만 규범과 어긋나게 엄격해지고 (b)간호사/비담당의 워크플로가 깨짐. **일관 적용 여부가 선결 결정**.

## 1. 결정 사항 (사람/제품)
1. **스코프**: BTG를 임상데이터 접근에 **전면 도입**할 것인가, 아니면 **역할 기반 유지 + 사후 감사(현행)**로 둘 것인가? (의료기관 정책·EMR인증/접근통제 요건에 따름)
2. 도입 시 **대상 집합**: 어떤 리소스(진료기록·간호기록·검사·임상도구결과·문제목록·알레르기…)에 담당확인을 요구할지.
3. **담당(assignment) 정의**: 주치의·입원담당·병동배정 간호사·협진·care-team 명시 배정 중 무엇을 "담당"으로 인정할지.

## 2. 권고 설계 (전면 도입을 택할 경우)
현행 무중단을 위해 **config 게이트 + 점진 롤아웃**([[tier2_stepup_active]]·4-eyes 선례와 동일 패턴):

### 2-A 가드 활성화 (config off 기본)
- `SystemConfig 'security.btgEnforce'`(기본 off) + 대상 EP 화이트리스트. off면 현행(역할만) 그대로.
- 공용 데코레이터 `@RequirePatientScope()` + `BreakTheGlassGuard`를 **대상 EP 집합에 일괄** 배선(단일 EP 아님).

### 2-B checkAssignment 확장 (간호사·care-team 포함)
- 현행 doctorId 2경로 + 추가: **병동배정 간호사**(Admission↔ward↔nurse 배정), **CareTeam 멤버십**, **협진 요청 수신자**. 역할별 담당 판정.
- 성능: 판정 쿼리에 인덱스(encounter[doctorId,patientId,createdAt]·admission[patientId,status]) 확인/보강.

### 2-C FE BTG 플로우
- 403 `BTG_REQUIRED` 인터셉트 → 사유 입력 모달 → `X-BTG-Reason` 헤더로 재요청(공용 apiClient 인터셉터에 1곳). 임상 화면 공통 적용.
- 감사: `BreakTheGlassAccess` 기록(이미 가드가 수행)·사후 리뷰 콘솔(비담당 접근 리스트).

### 2-D 롤아웃
- config off 배포 → 파일럿 EP 1~2종 on(내부 검증) → 대상 확대 → 전면. 롤백=config off.

## 3. 대안 (도입 안 함)
- 역할 기반 유지 + **강화된 사후 감사**(비담당 접근 이상탐지·정기 리뷰). BTG 강제 없이 접근기록·이상패턴만. 낮은 마찰·낮은 통제.
- 이 경우 dead code인 `BreakTheGlassGuard`는 **제거 또는 명시적 보류 주석**으로 정리(혼선 방지).

## 4. 즉시 가능한 저위험 조치 (결정 무관)
- ✅ 이미 반영: clinical-chart-result GET에서 `UserRole.READ` 제거(P2·PR#195) — 저권한 직군 PHI 조회 차단.
- 문서화: BTG 가드가 dead code임을 코드 주석/이 문서로 명시(오해 방지).
- (선택) 이상탐지 강화: 단시간 다수 환자 조회 등 비담당 패턴 알림(AnomalyDetectionService 재사용).

## 5. 리스크
| 리스크 | 대응 |
|--------|------|
| 가드 전면화가 워크플로 마찰 | config 게이트·파일럿·FE 사유모달 UX |
| 간호사 미담당 판정 오차단 | checkAssignment 역할별 확장 선행 |
| 단일 EP만 적용해 규범 불일치 | 대상 집합 일괄 적용(단일 금지) |

## 6. 사람 게이트
접근통제 정책(BTG 전면 vs 사후감사)·담당 정의·대상 리소스 집합 — 의료정보보호/인증 담당 결정 후 착수.
