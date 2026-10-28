# 항암 레지멘 → CPOE 처방 결선 기획 (Regimen-CPOE Bridge)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/components/clinical-charts/RegimenOrderModal.tsx:35 · apps/web/src/components/clinical-charts/ClinicalChartRunner.tsx · 잔여: 없음

> 작성: 2026-07-03 / 상태: Plan v1.0 (승인 대기 — 구현 착수 전 검토 필요)
> 상위: [chart-template-expansion](chart-template-expansion.plan.md) Track 5 후속 · [clinical-chart-engine](../../02-design/clinical-chart-engine.design.md) §5-4
> 한 줄: Tree 레지멘(현재 4종·용량 산출 보조까지)의 산출 결과를 **처방 초안(DRAFT) 생성**으로 잇는다. 자동 확정 없음 — 의사 검토·DUR·서명은 기존 CPOE 흐름 그대로.

---

## 1. 배경·현황

- v3.29.0 Tree 아키타입: TreeRunner가 BSA(Mosteller)·Calvert(AUC)로 약물라인별 용량 산출(cap·누적한계 경고)까지 제공. **"자동 처방 미생성"을 명시**한 상태.
- 기존 CPOE 자산: `useAddPrescription`(POST /encounters/:id/prescriptions·DUR 경고 반환)·OrderSetPanel(오더셋)·Tier2 step-up 서명·MAR.
- 갭: 산출된 용량을 의사가 **수기로 재입력**해야 함 — 전사 오류 위험이 오히려 안전 저해.

## 2. 목표·비목표

**목표**
- 레지멘 산출 → 현재 인카운터에 **처방 초안 일괄 생성**(약물라인별 1건). 의사 검토 모달에서 수정·제외 가능.
- DUR 체크·용량 cap·누적한계 경고를 생성 시점에 통과/표시.
- 전 과정 감사(레지멘 chartId·산출 입력·생성자) — ClinicalChartResult와 연계.

**비목표(이번 범위 아님)**
- 자동 처방 확정/서명(금지 — 초안까지만).
- 항암 조제실 워크플로(조제·감사·투여 스케줄링) — 별도.
- 레지멘 관리 UI(정의는 코드+검수 콘솔 유지).

## 3. 핵심 설계

### 3.1 약물 매핑 (선결 과제)
레지멘 정의의 성분명(예: 'Oxaliplatin') ↔ `MedicationCode` 매핑이 필요.
- `RegimenDrug`에 `medicationCodeQuery?: string`(검색어) 추가 — 생성 시 code-search로 후보 조회, **의사가 검토 모달에서 확정**(자동 확정 금지).
- 기관 상용 코드가 확정되면 `medicationCodeId` 직접 기입 가능(정의 갱신→재검수 트리거는 defHash가 자동 처리).

### 3.2 생성 흐름
```
TreeRunner(용량 산출 완료)
  → [처방 초안 생성] 버튼 (encounter 컨텍스트에서만 노출)
  → 검토 모달: 약물라인별 { 후보 약물코드 선택(검색), 용량(수정 가능·산출값 프리필),
                 용법(route·일수), 제외 토글 } + 전처치 체크리스트 표시
  → 확인 체크: "기관 프로토콜·허가사항 대조함" (필수)
  → 일괄 POST /encounters/:id/prescriptions (건별 DUR 경고 표시·차단 규칙은 기존 그대로)
  → 결과: DRAFT 처방 목록 — 이후 기존 흐름(수정·서명·수납)
```

### 3.3 안전장치 (SaMD/고위험 의약품)
| 장치 | 내용 |
|------|------|
| 초안만 생성 | status DRAFT — 서명 전 의사 확인 필수(기존 서명 게이트) |
| DUR | 건별 DUR 경고 표출·override는 기존 감사 로직 |
| 용량 가드 | cap 초과 불가·산출값 대비 ±20% 수정 시 경고 |
| 누적한계 | Doxorubicin 등 — 환자 ClinicalChartResult(레지멘 기록) 합산해 누적 경고(P2) |
| 검수 게이트 | **레지멘 verified=검증됨(검수 콘솔) 아니면 생성 버튼 비활성**(미검증 참조용은 산출만) |
| 확인 서약 | 기관 프로토콜 대조 체크 필수 + 생성 감사 기록 |

## 4. 단계

| 단계 | 내용 | 산출 |
|------|------|------|
| P0 | 검토 모달 + 일괄 초안 생성(FE 중심·기존 useAddPrescription 재사용) + verified 게이트 | encounter에서 레지멘→DRAFT |
| P1 | 매핑 보강(medicationCodeQuery·기관 코드 확정 시 직접 매핑) + 용량 가드(±20%) | 재입력 최소화 |
| P2 | 누적용량 추적(환자별 레지멘 기록 합산·한계 경고) | Doxorubicin 등 심독성 가드 |
| P3 | 주기 관리(차수 진행·지연/감량 기록) — 항암 조제실 연계 검토 | 별도 기획 분리 가능 |

## 5. 게이트 (착수 전 확정)
1. **임상 검수**: 레지멘 4종 verified 승인 선행(검수 콘솔) — 미검증 상태로는 생성 기능 노출 불가.
2. **약사/법무 검토**: 항암 고위험 의약품 초안 생성 프로세스 승인.
3. 매핑 소스: 기관 MedicationCode에 해당 성분 존재 여부 확인(부재 시 코드 마스터 등재 선행).

## 6. 리스크
- 미검증 레지멘 오용 → verified 게이트로 차단(§3.3).
- 약물 오매핑 → 자동 확정 금지·의사 선택 필수·감사 기록.
- 용량 단위 혼동(mg vs AUC) → 검토 모달에 기준용량·산출근거(BSA/GFR) 병기.
