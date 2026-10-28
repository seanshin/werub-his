# AI 진료 보조 시스템 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/medical-ai/medical-ai.controller.ts · apps/web/src/app/(main)/patients/[id]/encounter/new/components/AiAssistantPanel.tsx · 잔여: 없음

## 현재 상태

### 이미 구현된 것
- Medical AI 서버: `example.org/ollama` (Qwen2.5 14b/7b)
- API 7개: triage, summarize, analyze(감별진단), reference(RAG), explain, draft, drugInfo
- Agent Session: 대화 기반 증상수집 → 진료과 추천
- 오케스트레이터 v3: 멀티 도구 병렬, 폴백 체인

### 부족한 것
- 진료 화면에서 AI 패널이 없음 (별도 AI 챗바만 존재)
- 진료 중 실시간 감별진단 제안이 없음
- SOAP 작성 시 AI 자동 초안이 없음
- 검사 결과 해석 AI가 없음
- 처방 시 AI 약물 추천이 없음

## 목표

의사가 진료하는 동안 **옆에서 실시간으로 도움을 주는 AI 어시스턴트** — 진료 시작부터 처방까지 전 과정을 보조합니다.

## 기능 설계

### 1. 진료 화면 AI 사이드 패널

```
┌─ 진료 차트 (기존) ──────────────────┬─ AI 어시스턴트 ──────────────┐
│                                     │                              │
│  환자: 김영수 (68세/남)              │  🤖 AI 진료 보조              │
│  주소: 흉통, 호흡곤란                │                              │
│                                     │  ── 감별진단 (자동) ──        │
│  [S] 3일 전부터 흉통 ...            │  1. 🔴 급성관상동맥증후군 85% │
│  [O] BP 150/90, HR 98 ...           │  2. 🟡 불안정 협심증 72%      │
│  [A] _______________                │  3. 🟢 GERD 45%              │
│  [P] _______________                │  4. 🟢 근골격 흉통 30%        │
│                                     │                              │
│                                     │  ── 권장 검사 ──              │
│                                     │  ✓ Troponin-I (serial)       │
│                                     │  ✓ 12-lead ECG               │
│                                     │  ✓ Chest X-ray               │
│                                     │  ○ CT Angiography            │
│                                     │                              │
│                                     │  ── AI SOAP 초안 ──           │
│                                     │  [자동 생성] 클릭하여 적용    │
│                                     │                              │
│                                     │  ── 약물 추천 ──              │
│                                     │  Aspirin 300mg loading       │
│                                     │  Nitroglycerin SL PRN        │
│                                     │                              │
│                                     │  [💬 AI에게 질문하기]         │
└─────────────────────────────────────┴──────────────────────────────┘
```

### 2. AI 기능 7가지

#### 2.1 실시간 감별진단 (Differential Diagnosis)
- **트리거**: S/O 필드 입력 시 자동 (디바운스 2초)
- **입력**: 주소(CC), 현병력(HPI), 활력징후, 나이/성별, 기존 진단
- **출력**: 확률 순 감별진단 5개 + 근거 + 추가 확인 질문

```
POST /api/v1/ai/realtime-ddx
Body: {
  "patientId": "uuid",
  "subjective": "3일 전부터 흉통, 운동 시 악화...",
  "objective": "BP 150/90, HR 98, SpO2 96%...",
  "existingDiagnoses": ["I10", "E11"]
}

Response:
{
  "data": {
    "differentials": [
      { "rank": 1, "code": "I21", "name": "급성 심근경색", "probability": 85, "urgency": "CRITICAL",
        "reasoning": "흉통+운동시악화+고혈압+당뇨 위험인자. Troponin 필요.",
        "keyFindings": ["흉통 NRS 7/10", "운동 시 악화", "고혈압+당뇨 기왕력"],
        "suggestedQuestions": ["좌측 팔 방사통 여부?", "발한/구역?", "이전 PCI/CABG력?"] },
      { "rank": 2, "code": "I20", "name": "불안정 협심증", "probability": 72, "urgency": "HIGH" }
    ],
    "suggestedTests": [
      { "name": "Troponin-I (serial)", "priority": "STAT", "reason": "ACS 감별 필수" },
      { "name": "12-lead ECG", "priority": "STAT", "reason": "ST 변화 확인" },
      { "name": "Chest X-ray", "priority": "URGENT", "reason": "심비대/폐부종 감별" }
    ],
    "redFlags": ["흉통+호흡곤란 → ACS 배제 필수", "고령 남성+DM+HTN → 고위험군"]
  }
}
```

#### 2.2 SOAP 자동 초안 (Auto-Draft)
- **트리거**: "AI 초안" 버튼 클릭
- **입력**: 환자 정보 + S/O 필드 + 감별진단 결과
- **출력**: Assessment + Plan 초안

```
POST /api/v1/ai/auto-soap
Body: {
  "patientId": "uuid",
  "subjective": "...",
  "objective": "...",
  "differentials": [...],  // 위 감별진단 결과
  "existingMedications": ["아모디핀 5mg", "메트포르민 500mg"]
}

Response:
{
  "data": {
    "assessment": "68세 남성, HTN/DM 기왕력. 3일간 운동 시 악화되는 흉통으로 내원.\n급성 관상동맥증후군 감별 필요 (Troponin, ECG 결과 대기 중).\n안정형 협심증 vs NSTEMI 감별.",
    "plan": "1. Troponin-I serial (0h, 3h)\n2. 12-lead ECG → 순환기내과 협진\n3. ASA 300mg loading (CDSS 확인 완료)\n4. Nitroglycerin SL PRN\n5. Chest X-ray\n6. 기존 약물 유지 (아모디핀, 메트포르민)\n7. 입원 고려 (Troponin 양성 시)",
    "confidence": 0.82,
    "references": ["2023 ESC ACS Guideline", "JNC-8 고혈압 가이드라인"]
  }
}
```

#### 2.3 검사 결과 해석 (Lab Interpretation)
- **트리거**: 검사 결과 도착 시 자동 / "AI 해석" 버튼
- **입력**: 검사 항목 + 결과값 + 환자 맥락
- **출력**: 이상 소견 요약 + 임상 의미 + 추가 검사 제안

```
POST /api/v1/ai/interpret-lab
Body: {
  "patientId": "uuid",
  "results": [
    { "testName": "Troponin-I", "value": "15.8", "unit": "ng/mL", "normalMax": 0.04 },
    { "testName": "CK-MB", "value": "48", "unit": "U/L", "normalMax": 25 },
    { "testName": "BNP", "value": "1250", "unit": "pg/mL", "normalMax": 100 }
  ],
  "clinicalContext": "흉통 환자, ACS r/o"
}

Response:
{
  "data": {
    "summary": "Troponin-I 현저히 상승 (정상의 395배) → 급성 심근손상 확인",
    "findings": [
      { "test": "Troponin-I", "interpretation": "15.8 ng/mL — 급성 심근경색 진단적", "severity": "CRITICAL" },
      { "test": "CK-MB", "interpretation": "48 U/L — 상승, 심근손상 보조 확인", "severity": "HIGH" },
      { "test": "BNP", "interpretation": "1250 pg/mL — 심부전 동반 가능", "severity": "HIGH" }
    ],
    "clinicalImplication": "NSTEMI 또는 STEMI 확인. 즉각적 순환기내과 협진 및 cardiac catheterization 고려.",
    "suggestedActions": ["Serial Troponin (3h)", "심초음파(TTE)", "순환기내과 긴급 협진"],
    "confidence": 0.95
  }
}
```

#### 2.4 약물 추천 (Drug Recommendation)
- **트리거**: 진단 확정 후 처방 시 / "AI 추천" 버튼
- **입력**: 확정 진단 + 환자 정보 (연령/신기능/알레르기/기존 약물)
- **출력**: 가이드라인 기반 약물 추천 + CDSS 교차 검증

```
POST /api/v1/ai/recommend-drugs
Body: {
  "patientId": "uuid",
  "diagnosis": "I21.0",  // NSTEMI
  "patientContext": {
    "age": 68, "eGFR": 85,
    "allergies": ["페니실린"],
    "currentMedications": ["아모디핀 5mg", "메트포르민 500mg"]
  }
}

Response:
{
  "data": {
    "recommendations": [
      { "name": "아스피린 300mg", "dosage": "300mg loading → 100mg/day", "reason": "NSTEMI 1차 항혈소판", "guideline": "ESC 2023", "cdssCheck": "PASS" },
      { "name": "티카그렐러 180mg", "dosage": "180mg loading → 90mg bid", "reason": "DAPT", "guideline": "ESC 2023", "cdssCheck": "PASS" },
      { "name": "헤파린", "dosage": "60U/kg IV bolus", "reason": "항응고", "guideline": "ESC 2023", "cdssCheck": "PASS" },
      { "name": "아토르바스타틴 80mg", "dosage": "80mg/day", "reason": "고강도 스타틴", "guideline": "ACC/AHA", "cdssCheck": "WARNING — 기존 아모디핀과 상호작용 주의" }
    ],
    "contraindicated": ["클로피도그렐+오메프라졸 병용 주의"],
    "orderSetSuggested": "CP-EM-001 (흉통 ACS 프로토콜)"
  }
}
```

#### 2.5 환자 설명문 생성 (Patient Education)
- **트리거**: "환자 설명" 버튼
- **입력**: 진단명 + 치료 계획
- **출력**: 환자가 이해할 수 있는 쉬운 설명

#### 2.6 의무기록 품질 검사 (Chart QA)
- **트리거**: 서명 전 자동 / "품질 검사" 버튼
- **입력**: 완성된 SOAP
- **출력**: 누락 항목, 일관성 검사, 코딩 정확도

#### 2.7 임상 질문 답변 (Clinical Q&A)
- **트리거**: AI 챗 입력
- **입력**: 자유 형식 질문
- **출력**: 근거 기반 답변 + 참고문헌

## API 요약

| # | Method | Endpoint | 설명 | 트리거 |
|---|--------|----------|------|--------|
| 1 | POST | `/api/v1/ai/realtime-ddx` | 실시간 감별진단 | S/O 입력 시 자동 |
| 2 | POST | `/api/v1/ai/auto-soap` | SOAP 자동 초안 | 버튼 클릭 |
| 3 | POST | `/api/v1/ai/interpret-lab` | 검사 결과 해석 | 결과 도착 시 |
| 4 | POST | `/api/v1/ai/recommend-drugs` | 약물 추천 | 처방 시 |
| 5 | POST | `/api/v1/ai/patient-education` | 환자 설명문 | 버튼 클릭 |
| 6 | POST | `/api/v1/ai/chart-qa` | 의무기록 품질검사 | 서명 전 |
| 7 | POST | `/api/v1/ai/clinical-qa` | 임상 질문 답변 | 채팅 |

## 프론트엔드 UI

### 진료 화면 AI 사이드 패널
- 환자 차트 `/patients/[id]/encounter/new` 에 우측 패널 추가
- 접기/펼치기 토글
- 탭: 감별진단 | 검사해석 | 약물추천 | 기록품질

### 감별진단 카드
```
🔴 1. 급성 심근경색 (85%)
   - 흉통+운동악화+위험인자
   - [추가 질문] 좌측 팔 방사통?
   
🟡 2. 불안정 협심증 (72%)
   - 유사 증상, 경과 확인 필요
```

### AI SOAP 초안
```
[AI가 작성한 Assessment]
68세 남성, HTN/DM 기왕력...

[AI가 작성한 Plan]
1. Troponin serial...
2. ECG...

[차트에 적용] [수정 후 적용] [무시]
```

## 구현 단계

### Phase 1: 핵심 3개 API + UI 패널
1. POST /ai/realtime-ddx (감별진단)
2. POST /ai/auto-soap (SOAP 초안)
3. POST /ai/interpret-lab (검사 해석)
4. 진료 화면 AI 사이드 패널 컴포넌트

### Phase 2: 약물 추천 + 품질검사
5. POST /ai/recommend-drugs (CDSS 교차 검증 포함)
6. POST /ai/chart-qa (서명 전 자동 실행)
7. 처방 모달에 AI 추천 연동

### Phase 3: 환자 설명 + 고도화
8. POST /ai/patient-education
9. POST /ai/clinical-qa
10. AI 응답 피드백 수집 (정확도 향상)
11. 의사별 AI 사용 통계

## 기대 효과

| 지표 | 현재 | 목표 |
|------|------|------|
| 감별진단 시간 | 의사 판단 5~10분 | AI 제안 2초 + 의사 확인 |
| SOAP 작성 시간 | 10~15분 | AI 초안 3초 + 수정 3분 |
| 검사 결과 해석 | 수동 확인 | 자동 이상치 요약 |
| 가이드라인 준수율 | 측정 불가 | AI 추천 기반 추적 가능 |
