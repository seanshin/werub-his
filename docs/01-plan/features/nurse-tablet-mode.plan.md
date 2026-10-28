# 간호사용 타블렛·핸드헬드 모드 — 분리 기획 (Nurse Tablet/Handheld)

> 작성: 2026-06-29 / 상태: Plan v1.1 (보완: **이동 중(핸드헬드·PWA) 폼팩터** + **환자 QR 식별 빠른 검토(IPSG.1)**)
> 한 줄: 환자 모바일 앱(환자 포털 전용)에 직원 인증을 넣지 않고, **이미 존재하는 웹 셸(`apps/web/src/app/tablet`)에 간호사 전용 세그먼트를 추가**해 **타블렛은 물론 핸드헬드(폰)로 이동 중에도** 간호 기록·간호 AI 보조(초안·품질검사·SBAR·care-plan·브리핑)를 수행하고, **환자 손목밴드/병상 QR을 카메라로 스캔해 즉시 해당 환자 차트로 진입**(환자확인 IPSG.1)한다. **신규 네이티브 앱·신규 직원 인증 없이** 배포된 자산을 재사용한다.

---

## 0. 결정 (Why this shape)
- **환자 모바일 앱(`apps/mobile`)은 환자 포털 전용** — `/api/v1/patient-auth/*`·환자 데이터만·역할 없음. 간호 AI 엔드포인트(`ai-draft`·`ai-care-plan`·`ai-handoff-sbar`·`station-briefing`·`qa-check`)는 전부 **NURSE/ADMIN 직원 JWT** + 직원이 관리하는 입원 대상이라 환자 앱과 인증·데이터 모델이 충돌.
- → **간호사 경험을 환자 앱과 분리**. 후보 아키텍처:
  | 안 | 내용 | 평가 |
  |----|------|------|
  | **(A) 웹 타블렛 셸 확장** | 기존 `app/tablet` 독립 셸에 간호 세그먼트 추가 | ✅ **채택** — 직원 웹 세션 그대로·셸/컴포넌트 재사용·간호 AI 엔드포인트 그대로·신규 인증/앱 0 |
  | (B) 네이티브 간호 앱(Expo) | 직원용 별도 RN 앱 신설 | 직원 인증·화면 전부 신규(수주)·유지보수 2배 |
  | (C) 환자앱에 직원 로그인 | 환자 앱에 staff auth 추가 | 보안·아키텍처 혼입(환자/직원 한 앱)·부적합 |
- **(A) 채택 근거**: `app/tablet`은 이미 **독립 셸**(전용 layout·터치 네비·KioskLock 잠금·PenNoteCanvas 스타일러스·DictationButton 음성·PatientSwitcher)로 의료진 병상 작업을 전제([[tablet-chart-view.plan]]). 간호 AI는 web+BE에 **운영 배포·검증 완료**. 직원 웹 인증·step-up·단말 인증도 기존재. → **셸 + 간호 세그먼트 + 배포 API 조합**이 최소 노력·최대 정합.

---

## 1. 배경·문제
- 간호 기록·간호 AI 보조는 **데스크탑 웹 중심**으로 배포됨(`inpatient/[id]/nursing/*`·`nursing-station`). 그러나 간호 업무는 **병상 옆·회진·이동 중**(손에 든 타블렛, 장갑, 키보드 없음)이 핵심.
- 환자 모바일 앱은 직원이 못 씀(환자 전용). 데스크탑은 병상에서 불편.
- 이미 **의료진 타블렛 셸**(`app/tablet`)이 회진·병상 차트용으로 존재 → 간호 버전이 자연스러운 확장.

**결정(요구사항)**: 간호사 타블렛은 **환자 앱과 분리**, **웹 타블렛 셸 확장**으로 구현. 보조 우선·책임=간호사 규약 그대로.

---

## 2. 목표·비목표
**목표**
- 회진/병상에서 **간호 라운드 보드 → 환자 간호 차트 조회 → 간호기록 작성(AI 초안·품질검사·검토·서명) → SBAR 인계**를 타블렛/핸드헬드 단독으로 완결.
- **이동 중 사용**: 타블렛(거치·휴대) + **핸드헬드(폰)** 양쪽. 반응형 + **PWA 설치**(홈화면 아이콘·전체화면)로 별도 앱 없이 직원 기기에 상주. 한 손 조작.
- **환자 QR 빠른 검토**: 손목밴드/병상 QR을 **카메라로 스캔 → 즉시 해당 환자 간호 요약**(환자확인 IPSG.1·오인 방지). 회진 중 1초 진입.
- **배포된 간호 AI 재사용**(신규 BE 최소): F-1 초안·F-2 간호과정·F-3 SBAR·F-4 품질검사·F-5 브리핑.
- 키보드/마우스 없이 **터치·스타일러스·음성**으로 핵심 동작.

**비목표(명시)**
- 환자 모바일 앱(`apps/mobile`) 통합/대체 — 아님(분리).
- 신규 네이티브 앱 — 아님(웹 타블렛 셸).
- 신규 직원 인증 스택 — 아님(기존 직원 웹 세션 재사용).
- 오프라인 동기화(FR-08 Out of Scope) — 미포함.
- 간호 AI 로직 변경 — 아님(배포본 그대로 소비).

---

## 3. 아키텍처 — 웹 타블렛 셸 확장
```
apps/web/src/app/tablet/                 ← 기존 독립 셸(재사용)
├── layout.tsx · KioskLock · TabletTopBar · BottomSheet · SegmentedTabs · PatientSwitcher
├── patients/[id]/page.tsx               ← 환자 차트(터치 IA) — 간호 탭 추가
└── nursing/                             ← 신규 간호 세그먼트
    ├── page.tsx                         ← 간호 라운드 보드(스테이션 브리핑 F-5 + 위험 우선 환자)
    └── [admissionId]/
        ├── page.tsx                     ← 환자 간호 요약(vitals·MAR·care-plan·최근기록)
        ├── note.tsx                     ← 간호기록 작성기(AI 초안 F-1·품질검사 F-4·검토확인·서명)
        ├── handoff.tsx                  ← SBAR 인계(F-3)
        └── care-plan.tsx                ← 간호과정(F-2)
```
- **데이터·도메인 재사용**: 배포된 엔드포인트·TanStack Query 훅·표시 컴포넌트를 타블렛 컨테이너로 래핑(중복 구현 금지).
- **재사용 컴포넌트**(셸): `KioskLock`(자동잠금)·`PenNoteCanvas`(필기)·`DictationButton`(음성 받아쓰기)·`QuickPhraseChips`(상용구)·`BottomSheet`/`SegmentedTabs`/`TabletActionBar`(터치 네비)·`PatientSwitcher`.
- **진입**: 데스크탑 간호 화면 헤더에 「타블렛 모드」 버튼 → `/tablet/nursing`. 병동 타블렛 키오스크 북마크로 직접 진입.

---

## 3.5 폼팩터 — 이동 중·핸드헬드·PWA (보완)
간호는 병동을 **걸어 다니며** 한다 → 타블렛 거치만으로 부족, **핸드헬드(폰)** 도 1급 대상.
- **반응형 셸**: `app/tablet` 간호 세그먼트를 **폰 폭(≥360px)까지 반응형**으로 — 라운드 보드/요약/스캔은 한 손 세로, 작성기는 가로/거치 권장.
- **PWA 설치**: `manifest`(홈화면 아이콘·standalone 전체화면)·기본 서비스워커(앱셸 캐시·**데이터 캐시는 FR-08 범위밖**) → 직원 기기에 **별도 앱 없이 상주**. iOS/Android 홈 추가.
- **한 손 조작**: 하단 액션바(엄지 도달)·하단 시트(`BottomSheet`)·큰 히트영역(≥44px). 상단은 환자 컨텍스트만.
- **카메라**: 후면 카메라(QR 스캔, §5.5). HTTPS(his.example.org)라 `getUserMedia` 가능.
- **세션 지속**: 이동 중 화면 꺼짐/복귀 빈번 → 토큰 유지·복귀 시 KioskLock/PIN. 짧은 무동작 자동잠금.
- (참고) 진짜 네이티브가 필요해지면(백그라운드·NFC 손목밴드 등) 별도 Expo 직원앱은 **장기 옵션**이나, 현 요구(이동 중 조회·기록·스캔)는 **반응형 웹+PWA로 충족**.

---

## 4. 인증·단말 보안 (기존 재사용)
- **직원 웹 세션**: 타블렛 셸은 `apps/web`이라 **기존 직원 로그인/JWT 그대로**(신규 인증 0). 간호 AI 엔드포인트의 NURSE 가드 충족.
- **단말 잠금**: `KioskLock`(Tier1 PIN 화면잠금)·자동잠금. 병동 공용 타블렛 공유 시 사용자 전환은 재로그인/PIN.
- **서명 step-up**: 간호기록 서명은 기존 작성자 검증(`signNote`)·필요 시 Tier2 생체 step-up(기존 config 게이트) 상속.
- **AI 게이트**: `nursing.aiAssist.enabled`(전역)·`nursing.aiAssist.wards`(병동 스코프) **그대로 적용** — 타블렛도 동일 게이트.
- **PHI**: 간호 초안 성명 미전송(`deidentify`) 등 배포본 정책 그대로.

---

## 5. 화면 구성(IA) — 터치 재구성
| 화면 | 소비 API(배포본) | 핵심 |
|------|------------------|------|
| **QR 스캔 진입**(FAB 상시) | `QrScanModal` + 환자식별 해석(§5.5) | 손목밴드/병상 QR → 환자 확인(IPSG.1) → 간호 요약 즉시 |
| **간호 라운드 보드** `/tablet/nursing` | `nursing/station-board`·`station-briefing`(F-5) | WeRU.B 브리핑 한 문단 + 위험 우선 환자 큰 행(EWS·낙상·투약지연·미서명) → 탭하여 환자 |
| **환자 간호 요약** `/nursing/[admissionId]` | `care-plan`·vitals·MAR·`nursing-notes` | 최신 V/S·활성 간호진단·미서명·투약 — 회진 한눈 |
| **간호기록 작성기** `note` | `ai-draft`(F-1)·`qa-check`(F-4)·`nursing-notes`(작성/서명) | 「WeRU.B 초안」(근거칩)·필기/음성 입력·품질검사 인라인·**검토확인 게이트**·서명 |
| **SBAR 인계** `handoff` | `ai-handoff-sbar`(F-3) | S/B/A/R 4섹션·전체 복사(교대 인계) |
| **간호과정** `care-plan` | `ai-care-plan`(F-2)·diagnoses/interventions/outcomes | NANDA 제안·표준코드 피커·중재/결과 |
| **MAR 투약확인** | 기존 MAR EP | 5R·투여/보류(터치) |

---

## 5.5 환자 QR 식별 — 빠른 검토 (IPSG.1·보완)
회진/병상에서 **환자 손목밴드(또는 병상 카드) QR을 카메라로 스캔 → 즉시 그 환자 간호 차트**로 진입. 환자확인(IPSG.1) 오인 방지 + 1초 진입.

### 흐름
```
[스캔 FAB/단축] → QrScanModal(카메라·BarcodeDetector) → 토큰 인식
   → 해석(환자/입원) → 일치: /tablet/nursing/[admissionId] 즉시 이동(+환자명·MRN 확인 배너)
                     → 불일치/만료/타병동: 경고("다른 환자/만료 — 재확인")
```

### 재사용·신규(정직한 범위)
- **재사용(카메라)**: `QrScanModal`(`workstation/front-desk/QrScanModal.tsx` — 브라우저 **BarcodeDetector**·라이브러리 0·후면카메라). 라운드 보드·환자 요약 상단에 **상시 「스캔」 버튼/FAB**.
- **재사용(환자 QR 발급)**: 환자 QR은 이미 발급됨 — `POST /api/v1/patient-flow/qr`(`PatientLocQrButton` → token·qrDataUrl, 환자 동선용). **이 토큰/QR을 손목밴드·병상에 재사용** 또는 동일 패턴으로 입원 시 발급.
- **재사용(IPSG.1 환자확인)**: `POST /api/v1/patient-safety/identification-check`(환자확인 기록·통계 존재) — 스캔 식별을 **여기에 기록**해 IPSG.1 컴플라이언스 충족(누가·언제·어떻게 확인).
- **신규(소): 식별 토큰 → 활성 입원 해석**. 현 `POST /qr/scan`(`qr.service.ts:39`)은 단발 액션세션(CLOCK/ATTEND/RECEIPT/LOGIN)이라 부적합. **신규 `GET /api/v1/nursing/resolve-patient?code=`(NURSE)** — 손목밴드 페이로드(`patient-flow/qr` 토큰 또는 **MRN**, `Patient.mrn` unique)를 활성 입원(admissionId)+환자명/MRN/병상으로 해석. (또는 protocol QR 해석 경로 재사용 검토.)
- **안전(IPSG.1)**: 스캔 후 **환자명·MRN·병상 확인 배너**(이중 식별자) + identification-check 기록. 만료/타병동/불일치 차단. 스캔은 **조회 진입**일 뿐, 기록·서명은 기존 검토확인·서명 가드 그대로.

### 부가
- **수동 폴백**: 카메라 불가/미인식 시 환자 검색(이름·MRN·병상)으로 진입.
- **바코드 호환**: 손목밴드가 1D 바코드면 BarcodeDetector formats에 `code_128` 등 포함(스캐너 옵션).

---

## 6. UX — 병상·회진 맥락
- **터치 퍼스트**: 큰 히트영역(≥44px)·하단 액션바(엄지 도달)·오프캔버스 네비.
- **스타일러스**(`PenNoteCanvas`): 장갑/필기로 간호기록 보조 입력 → 텍스트 변환·첨부.
- **음성**(`DictationButton`): 병상 옆 손 안 쓰고 받아쓰기(S 주관 호소 등). AI 초안과 병행.
- **상용구**(`QuickPhraseChips`): 자주 쓰는 간호 문구 빠른 삽입.
- **AI 보조 정합**: 초안 적용 시 **검토확인 체크** 없이는 서명 비활성(데스크탑과 동일·JCI MOI.11.1.1). 근거칩·WeRU.B 배지 동일.

---

## 7. 보조 우선·책임 (불변)
- AI는 초안·제안·요약만. **확정·서명은 간호사**(의료법 §22). 자동 서명 0.
- 게이트·프로비넌스·수정량·HMAC 무결성 등 배포본 가드 **그대로 상속**(타블렛은 표현 셸).

---

## 8. 단계별 로드맵
| 단계 | 범위 | 비고 |
|------|------|------|
| **P0** | `tablet/nursing` 라운드 보드(브리핑 F-5 + 위험 우선 환자) + 셸 네비 + **반응형(핸드헬드)·PWA 설치** + **QR 스캔 진입**(QrScanModal 재사용 + 환자식별 해석 EP) | 읽기·진입·저위험 |
| **P1** | 환자 간호 요약(차트 조회) — vitals·MAR·care-plan·기록 재사용 | 조회 |
| **P2** | 간호기록 작성기(AI 초안 F-1·품질검사 F-4·검토확인·서명·필기/음성) | 핵심 |
| **P3** | SBAR 인계(F-3)·간호과정(F-2)·MAR 투약확인 | 확장 |
| 장기 | 오프라인(FR-08)·생체 로컬서명·NFC 손목밴드·네이티브 직원앱 | 범위 밖 |

> **P0 선결**: 손목밴드에 환자 QR(`patient-flow/qr` 토큰 또는 MRN) 인쇄 절차 확정(발급 EP는 존재) — §5.5.

---

## 9. 리스크·완화
| 리스크 | 완화 |
|--------|------|
| 공용 타블렛 세션 혼동 | KioskLock·자동잠금·사용자 전환 재인증 |
| 작은 화면 정보 과밀 | 터치 IA 재구성(2계층·스와이프)·핵심만 |
| AI 초안 과신 | 검토확인 게이트(데스크탑과 동일)·수정량 모니터 |
| 네트워크 불안정(병동) | 온라인 전제(FR-08)·실패 시 수동·게이트 OFF 무중단 |
| **QR 오인 스캔**(잘못된 환자) | 스캔 후 **환자명·MRN·병상 확인 배너**(IPSG.1 이중식별)·만료/타병동 차단·수동 검색 폴백 |
| 카메라 권한/미지원 | BarcodeDetector 미지원 브라우저는 수동 검색 폴백·HTTPS 필요(충족) |
| 핸드헬드 정보 과밀 | 반응형 우선순위(보드/요약/스캔=핸드헬드·작성기=가로 권장) |
| 신규 BE 유혹 | 최소 — 배포된 간호 AI/간호 EP 소비 + **환자식별 해석 EP 1개만** 신규 |

## 10. 범위 밖
- 환자 모바일 앱 · 신규 네이티브 앱 · 신규 직원 인증 · **오프라인 데이터 동기화(FR-08)**(PWA 앱셸 캐시는 포함·데이터 캐시는 제외) · NFC 손목밴드 · 간호 AI 로직 변경.

---

## 부록 — 근거
- 기존 셸: `apps/web/src/app/tablet/`(layout·KioskLock·PenNoteCanvas·DictationButton·QuickPhraseChips·PatientSwitcher·SegmentedTabs·BottomSheet·TabletActionBar)·`patients/[id]/page.tsx`. 기획 [[tablet-chart-view.plan]].
- 배포된 간호 AI: `ai-draft`·`ai-care-plan`·`ai-handoff-sbar`·`nursing/station-briefing`·`nursing-notes/qa-check`(전부 LIVE·게이트 `nursing.aiAssist.enabled`/`wards`).
- 간호 화면(데스크탑·재사용 도메인): `inpatient/[admissionId]/nursing/*`·`nursing-station`·`components/ai/NursingAiDraftPanel`.
- 모바일(분리 대상·환자 전용): `apps/mobile`(patient-auth·역할 없음).
- **QR 인프라(재사용)**: 카메라=`QrScanModal.tsx`(BarcodeDetector·후면카메라)·`station/page.tsx`·`tablet/protocol/*`. 환자 QR 발급=`POST /api/v1/patient-flow/qr`(`PatientLocQrButton`·token/qrDataUrl). 환자확인=`POST /api/v1/patient-safety/identification-check`(IPSG.1). 식별자=`Patient.mrn`(unique). 단, `POST /api/v1/qr/scan`(`qr.service.ts:39`)은 단발 액션세션이라 환자식별 부적합 → 신규 `nursing/resolve-patient` 또는 protocol QR 경로.
- 연관: 간호 AI 보조 기획 `ai-assisted-nursing-records.plan.md`·파일럿 런북 `nursing-ai-pilot-runbook.md`.
