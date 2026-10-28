# [기획] 당직 모델 이원화 실통합 (DutyEntry ↔ StaffSchedule)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/hr/hr-erp.controller.ts:61 · apps/api/prisma/schema.prisma:11651 · apps/api/prisma/schema.prisma:5678 · 잔여: StaffSchedule 모델·테이블 제거(운영 행 수 확인 후)(사람) · 이번 세션: 직원 상세·내 정보가 옛 StaffSchedule 을 include 로 읽던 것 → DutyEntry 조립으로 전환(2026-09-14 P3) ✔ · 검토 초안의 "참조 0"은 틀렸었다(A6)

- **작성**: 2026-07-22
- **선행**: duty-schedule-completion.plan.md P0~P3 배포 완료(PR#554~558). P0 통합뷰로 표시층은 일원화됐으나 **저장 모델 이원화는 미해소**.
- **성격**: 기획서(구현 전). 운영 데이터 마이그레이션 포함 — DB 백업 선결.
- **2026-09-14 재확인(기획서 전체 검토 후속)**: 쓰기·조회 정본은 `DutyEntry` 로 통합됐고 `StaffSchedule` **직접 쿼리(`prisma.staffSchedule.*`)는 0** 이다.
  🔴 다만 "참조 0"은 **틀렸다** — `hr.service.ts` `findById`·`findByUserId` 가 관계 `include: { schedules }` 로 **옛 테이블을 아직 읽어**
  직원 상세 응답에 최근 30건을 싣는다(쓰기가 끊긴 뒤라 그 값은 낡는다 — 같은 사실에 정본이 둘). 이 include 를 걷거나 DutyEntry 조립으로 바꾸는 것이 모델 제거보다 먼저다.
  **스키마 삭제는 하지 않았다** — 운영 `staff_schedules` 행 수 미확인·`db push` 가 테이블을 DROP 할 위험(`CLAUDE.md` 배포 규칙). 제거 후보 · 운영 행 수 확인 필요.

## 1. 현황 (2026-07-22 코드 전수조사 결과)

### 두 병렬 시스템

| | 정본 후보(강한 쪽) | 폐지 대상(약한 쪽) |
|---|---|---|
| 모델 | `DutyEntry` (+OnCallSchedule/DutyStaffingRule/DutyPreference/DutySwapRequest) | `StaffSchedule` |
| staffId 정체 | **User.id** (VarChar(50)·FK 없음·unique 없음) | **Staff.id** (Uuid·FK·`@@unique[staffId,date]`) |
| 소유 서비스 | `DutyScheduleService` (`/api/v1/duty/*` 22 EP) | `WorkgroupService`·`HrService`·`EssService` |
| FE 소비처 | `/admin/duty-schedule`·`/duty-schedule` 실사용 | **없음 — `/api/workgroup/duty/*` 3 EP는 고아** |
| 시드 | 없음 | 있음(seed.ts:4943~4961, 5명×7일) |
| OFF 표현 | 없음(통합뷰가 LeaveRequest 병합) | shiftType=OFF (휴가 파생) |

### StaffSchedule 소비처 전수 (재배선 대상)

| 위치 | 용도 | 방향 |
|---|---|---|
| `hr.service.ts:199` setSchedule | 수동 근무표 upsert | 정본 쓰기로 전환 |
| `hr.service.ts:223` getSchedule / `hr-erp.controller.ts:61` | **ERP 근태 산정 조회(외부 계약)** | 응답 형태 유지, 소스만 통합조회로 교체 |
| `ess.service.ts:1222` (휴가 승인) | OFF 파생 upsert | 제거(정본=LeaveRequest, 통합뷰 병합 중) |
| `ess.service.ts:563` (휴가 철회) | OFF deleteMany 원복 | 제거(동상) |
| `workgroup.service.ts:183` | 오늘 병동 당직간호사 조회 | DutyEntry 조회로 교체 |
| `workgroup.service.ts:283/749/787` | getDutySchedule·autoAssignDuty | 고아 EP와 함께 제거 |

### 🔴 핵심 함정
1. **staffId 의미 이원화**: DutyEntry=User.id, StaffSchedule=Staff.id. 브릿지는 `Staff.userId`(schema:5070, nullable) 유일. userId 없는 Staff의 스케줄은 이관 불가 → 실태 조사로 판정.
2. **교차 지점**: `ess.service.ts:1215~1240` 휴가 승인 한 흐름 안에서 Staff.id(OFF 쓰기)와 User.id(DutyEntry 겹침 count)를 동시 사용.
3. `DutyEntry.staffId` 주석 "User.id 또는 외부 직원키" — FK화 전 운영 데이터에 비-User.id 값 존재 여부 확인 필수.
4. workgroup `requestDutySwap`(workgroup.service.ts:536~552)은 SystemConfig JSON 임시구현 — 정본 `DutySwapRequest`로 대체하고 제거.
5. ERP 근태(hr-erp)가 OFF를 소비한다면, OFF 파생 제거 시 hr-erp 조회에서 LeaveRequest를 병합해 계약 유지해야 함.

## 2. 목표

1. 근무·당직 저장 정본을 **DutyEntry 계열로 단일화** — 쓰기 경로 1개, 읽기 통합조회 1개.
2. OFF는 저장하지 않는다 — **승인 LeaveRequest가 정본**(P0 결정 유지), 모든 조회는 병합 뷰 사용.
3. 고아 EP·임시구현·이중 시드 제거로 표면적 축소.
4. 운영 데이터 무손실: 백업 + StaffSchedule 원본 보존(드롭하지 않음, deprecated 동결).

## 3. Phase별 계획

### P0 — 백업 + 데이터 실태 조사 (마이그레이션 가능성 판정) — 선결
- `./infra/scripts/deploy.sh --backup` (운영 DB 백업).
- 운영 DB 판정 쿼리(읽기 전용):
  - StaffSchedule 총 행수·OFF/비OFF 비율·기간 분포.
  - 비OFF 행 중 `Staff.userId IS NULL`로 이관 불가한 행수.
  - DutyEntry.staffId 중 User.id와 매칭되지 않는 값(외부 직원키) 존재 여부.
  - 같은 (사람, 날짜)에 StaffSchedule 비OFF와 DutyEntry가 동시 존재하는 충돌 행수.
- 판정: 이관 불가·충돌 행이 유의미하면 처리 방침(스킵+리포트 vs 수동 매핑)을 먼저 확정.

### P1 — 데이터 마이그레이션 (StaffSchedule → DutyEntry)
- 이관 대상: **비OFF 행만**. OFF는 LeaveRequest 파생이므로 이관하지 않음.
- 매핑: `StaffSchedule.staffId → Staff → Staff.userId`(=DutyEntry.staffId)·shiftType→shift·비정규화 필드(staffName/role/department)는 User/Staff에서 채움.
- 멱등 스크립트(재실행 안전)·충돌(같은 날 같은 shift 기존 DutyEntry 존재) 스킵+로그·이관 불가 행 리포트 출력.
- 이관 후 StaffSchedule 원본은 삭제하지 않음(감사·롤백용 동결).

### P2 — 쓰기/읽기 경로 재배선 (BE)
- `hr.service.setSchedule` → DutyEntry upsert로 전환(입력은 Staff.id 유지 가능하되 내부에서 userId 변환·비변환 시 명시 에러).
- `hr.service.getSchedule`·`hr-erp` → DutyEntry+승인 LeaveRequest 병합 조회로 교체. **응답 스키마 불변**(ERP 외부 계약). OFF는 LeaveRequest에서 파생 생성해 기존 소비 형태 유지.
- `ess.service` 휴가 승인/철회의 StaffSchedule OFF upsert/deleteMany 제거. 겹침 경고(DutyEntry count)는 유지.
- `workgroup.service.ts:183` 병동 당직간호사 → DutyEntry 조회로 교체(Staff→userId 변환 포함).
- 신규 쓰기 유입 차단 확인: 이 시점 이후 `prisma.staffSchedule` 쓰기 코드 0.

### P3 — 표면 정리
- 고아 EP 제거: `/api/workgroup/duty/schedule`·`auto-assign`·`swap-request`(FE 소비처 없음 확인됨) + `getDutySchedule`/`autoAssignDuty`/`requestDutySwap`(SystemConfig 임시구현) 서비스 로직 제거.
- 시드: StaffSchedule 시드(seed.ts:4943~4961) → DutyEntry 시드로 교체(User.id 기반·멱등).
- schema.prisma `StaffSchedule`에 deprecated 주석(모델 드롭은 후속 릴리즈에서 별도 판단 — 데이터 동결 보존).
- 선택 하드닝: DutyEntry `@@index([staffId,date])` 추가. FK/unique 승격은 P0 조사에서 외부 직원키 부재 확인 시에만.

### P4 — 검증·테스트
- 스펙 갱신: workgroup.service.spec(제거분 반영)·hr.service.spec(재배선)·ess p2-leave-advanced(OFF 파생 제거 반영)·duty-schedule 회귀.
- 종단 확인: 휴가 승인→통합뷰 OFF 표시·ERP 근태 응답 불변·병동 당직간호사 조회·관리자/일반 페이지 회귀.
- 배포: `--schema` 불요 시 `--api`만. **prisma generate + nest 클린 빌드 + `node dist/main.js` 부팅검증** 후 restart.

## 4. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| Staff.userId 없는 직원 스케줄 유실 | P0 조사로 정량화 → 스킵+리포트, 필요 시 수동 매핑 |
| ERP 근태 응답 변화로 외부 연동 파손 | 응답 스키마 스냅샷 비교 테스트, 소스만 교체 |
| DutyEntry unique 부재로 이관 중 중복 | 멱등 스크립트에서 (staffId,date,shift) 사전 조회 후 스킵 |
| 롤백 필요 | 백업 + StaffSchedule 원본 동결 보존으로 즉시 복귀 가능 |

## 5. 실행 결과 (2026-07-22 — 전 Phase 완료)

- **P0 조사(운영 DB)**: StaffSchedule 36행(비OFF 35·OFF 1)·비OFF 전량 Staff.userId 보유(이관 불가 0)·DutyEntry 93행 전량 User.id 매칭(외부 직원키 0)·충돌 0 → **판정 PASS**. 백업 `pre-deploy_20260722_010242.sql.gz`(12M).
- **P1 이관**: `manual/duty-model-unification-20260722.sql` 실행 — 35행 이관·스킵 0·duty_entries 93→128. 멱등(NOT EXISTS)·StaffSchedule 원본 동결 보존.
- **P2 재배선**: hr setSchedule/getSchedule(+`buildUnifiedSchedules` 통합조회)·hr-erp 근태 EP(응답 스키마 불변)·ess OFF 파생 제거(승인/철회)·workgroup 4개소(병동당직·#10 조회·auto-assign 강한 엔진 위임·swap 정본 위임). DutyEntry에 startTime/endTime/notes 추가(additive). `prisma.staffSchedule` 참조 src 내 0.
- **P3 정리**: workgroup duty EP는 **외부 Clinic 연동 계약(#10/#11/auto-assign)이라 제거 대신 응답 형태 보존 재구현**으로 조정. SystemConfig 임시 swap 저장 제거. 시드 DutyEntry로 교체. StaffSchedule deprecated 주석. 로컬자정↔UTC자정(@db.Date) 날짜 경계 결함도 수정.
- **P4 검증**: 스펙 105 PASS(hr 23·workgroup 8·ess 28·duty 46)·클린빌드+부팅검증·배포(--schema --api)·스모크 29 PASS·운영 종단: /api/v1/duty/schedule 31일·workgroup #10 형태불변·hr/schedule 95행(OFF 파생 2 포함·구 형태 유지).

## 6. 산출물
- 마이그레이션 스크립트(멱등·리포트 출력) 1종
- BE 재배선 커밋(hr/ess/workgroup) + 고아 EP 제거
- 시드 교체·스펙 갱신
- 본 기획서 결과 추기(P0 조사 수치)
