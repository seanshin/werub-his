# 진료·간호 기록 통합 시계열 뷰어(새 창) 기획서

> **Feature**: record-timeline-window
> **Version**: 1.0 (Plan)
> **Date**: 2026-06-21
> **Status**: Plan (설계 전)
> **근거 조사**: Encounter(SOAP)·NursingNote(DAR/SOAP)·JourneyTab·inpatient nursing timeline·`(main)/layout.tsx` #auth 해시 토큰·print 독립 라우트

---

## 0. 목적
진료차트에서 버튼 클릭 → **새 창**으로 **진료기록(Encounter)** 과 **간호기록(NursingNote)** 을 **시계열**로 보는 독립 화면을 띄운다. 듀얼모니터/참조 작업 시 메인 차트와 나란히 두고 시간순 흐름을 빠르게 파악한다.

---

## 1. 현황 (조사)
| 자산 | 상태 | 비고 |
|------|------|------|
| 진료기록 | ✅ | `Encounter`(SOAP·status·createdAt/signedAt·doctor) + `EncounterHistoryTab`(역시간 타임라인 카드) |
| 간호기록 | ✅ | `NursingNote`(DAR/DARE/SOAP·recordedAt·shiftType·nurse·status) + `NursingRecordTab` + `GET /nursing-notes/patient/:id` |
| 통합 시계열 | ❌ | 진료+간호 동일 시간축 통합 뷰 없음(JourneyTab=이벤트 요약·상세無 / inpatient nursing timeline=입원·일일 한정) |
| 새 창·독립 라우트 | ✅ | `print/*`(사이드바 없는 그룹 밖 라우트) + `(main)/layout.tsx`의 **`#auth=<token>` 해시 복원**(듀얼모니터 자동로그인) + telehealth `window.open(...#auth=)` 패턴 |
| 진입점 | ✅ | `PatientHeader` 액션 버튼 행(QR·진료시작…), ImagingTab OHIF `window.open` |

---

## 2. 범위
- **포함**: 환자 단위 진료기록 + 간호기록 통합 시계열, 새 창(독립 레이아웃·#auth 자동인증), 보기 모드(통합/분할), 필터(유형·기간·교대), 항목 펼침(SOAP/DAR 상세), 인쇄.
- **확장(후속)**: ProgressNote·바이탈·I/O·투약(MAR)·검사결과 트랙 추가, admission 단위 뷰, 실시간 갱신(SSE).
- **제외**: 편집(읽기 전용 뷰어), PHI 외부 반출.

---

## 3. 새 창 · 라우트 · 인증
- **신규 독립 라우트**(`(main)` 그룹 밖, 사이드바 없음): `app/record-timeline/[scope]/[id]/page.tsx`
  - `scope`=`patient`|`admission`. 예: `/record-timeline/patient/<patientId>`, `/record-timeline/admission/<admissionId>`
  - 자체 경량 레이아웃(상단바: 환자요약·닫기·인쇄, 본문 시계열). `(main)` 레이아웃 미적용.
- **인증**: 기존 `#auth=<accessToken>` 해시 토큰 복원 패턴 재사용. 단, 이 라우트는 `(main)/layout.tsx` 밖이므로 **동일 해시 복원 로직을 이 라우트 레이아웃에도 적용**(localStorage.accessToken 설정 후 apiClient). 듀얼모니터/새 창 자동 인증.
- **새 창 열기**(PatientHeader 버튼):
  ```ts
  const t = localStorage.getItem('accessToken');
  window.open(`/record-timeline/patient/${patientId}#auth=${encodeURIComponent(t)}`,
    'record-timeline', 'width=1280,height=900,resizable=yes');
  ```

---

## 4. 데이터 · API
### 신규 통합 API
```
GET /api/v1/patients/:id/record-timeline?from&to&types=ENCOUNTER,NURSING,PROGRESS&shift=
→ { items: [ { type, at, author, status, title, body, meta }, ... ] }   // at 오름차순(또는 내림차순 토글)
```
- **ENCOUNTER**: at=signedAt ?? createdAt, author=의사, status, title=주호소, body={S,O,A,P}, meta={diagnoses,처방수}
- **NURSING**: at=recordedAt, author=간호사, status, shift, body=DAR{D,A,R}/SOAP, meta={focus,priority}
- (확장) **PROGRESS**: at=noteDate, body=content / **VITAL·IO·MAR** 트랙
- 서버에서 두 소스를 조회→정규 이벤트로 매핑→시간순 병합→페이지네이션(기간/limit). 기존 list 서비스 재사용(EncounterService·NursingService).
- 권한: JwtAuthGuard + 임상 역할(DOCTOR/NURSE/ADMIN). 환자 접근 감사.

### 대안(무신규API)
기존 `GET /patients/:id/encounters` + `GET /nursing-notes/patient/:id` 를 FE에서 병합. 단 페이지네이션·정렬 일관성 위해 **통합 API 권장**.

---

## 5. 화면(UI)
- **보기 모드 토글**:
  - **통합(기본)**: 단일 세로 시간축에 진료/간호 카드 혼합(유형 색상 구분). JourneyTab 세로선 + EncounterHistoryTab/NursingRecordTab 카드 재사용.
  - **분할(2열)**: 좌=진료 시계열 / 우=간호 시계열 — 같은 시간축 동기 스크롤. "간호도 시계열·진료도 시계열" 요구 직접 충족.
- **필터**: 유형(진료/간호/전체)·기간(7일/1개월/3개월/전체)·교대(주/저녁/야)·상태(SIGNED만).
- **카드**: 시간·작성자·상태배지 + 펼침(진료 SOAP / 간호 DAR·SOAP) + 진단·처방 요약.
- **상단바**: 환자 요약(이름·MRN·나이) + 인쇄(PrintLayout 재사용 선택) + 닫기.
- **재사용 컴포넌트**: JourneyTab 타임라인 골격, EncounterHistoryTab SOAP 카드, NursingRecordTab 섹션, nursing timeline 타입 색상맵, QueryErrorFallback.

---

## 6. 단계
| 단계 | 범위 |
|------|------|
| **P0** | 통합 API(ENCOUNTER+NURSING) + `/record-timeline/patient/[id]` 독립 라우트(#auth) + 통합/분할 뷰 + 기간·유형 필터 + PatientHeader 새창 버튼 |
| **P1** | admission scope·ProgressNote/바이탈/IO/MAR 트랙·인쇄·교대 필터·내림/오름 토글 |
| **P2** | 실시간(SSE) 갱신·검사/영상 트랙·즐겨찾기 기간·요약(AI) |

---

## 7. 결정 필요
1. **기본 보기**: 통합(혼합) vs 분할(2열) 중 기본값. (권장: 통합 기본 + 분할 토글)
2. **scope**: 환자 전체 vs 입원(admission) 단위 우선.
3. **통합 API 신설** vs 기존 2개 API FE 병합. (권장: 신설)
4. 인쇄 포함 여부(P0/P1).

## 8. 리스크
- 새 창 인증: `(main)` 밖 라우트라 #auth 복원 로직을 해당 레이아웃에 별도 구현 필요(미구현 시 401).
- 대량 기록 환자 성능 → 기간/limit 기본값·페이지네이션.
- PHI: 새 창도 동일 인증·감사. 외부 공유 금지.
