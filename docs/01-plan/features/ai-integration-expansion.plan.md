# HIS AI 통합 확장 기획서 (ai-integration-expansion)

> 전체 HIS 모듈에 AI를 체계적으로 확장하여 임상 효율성과 환자 안전성을 향상

- **작성일**: 2026-05-29
- **상태**: Plan (검토 완료, 72→88점)
- **관련 문서**: medical-ai.service.ts, cdss.service.ts, orchestrator.service.ts
- **검토**: design-validator 72점 → 9건 보완 반영

## 1. 현재 AI 적용 현황

### 1.1 구현 완료 (MedicalAiService — 1,514줄, 50+ 메서드)

| 영역 | 기능 | API |
|------|------|-----|
| **진료 보조** | 실시간 감별진단 (확률순 5개, ICD-10) | `realtimeDdx()` |
| **SOAP 자동화** | 증상 → SOAP 초안 자동 생성 | `autoSoap()` |
| **검사 해석** | 검사 결과 이상치 감지 + 임상 의의 | `interpretLab()` |
| **약물 추천** | 가이드라인 기반 약물 추천 + 금기 검증 | `recommendDrugs()` |
| **의무기록 품질** | 차트 완전성/일관성/부호화 점수 | `chartQa()` |
| **환자 교육** | 환자용 쉬운 설명문 자동 생성 | `patientEducation()` |
| **임상 Q&A** | 의사 질문에 가이드라인 근거 답변 | `clinicalQa()` |
| **임상 추론** | 5단계 추론 체인 | `reasoningChain()` |
| **재입원 예측** | 30일 재입원 위험도 | `predictReadmission()` |
| **합병증 예측** | 수술/시술 합병증 위험도 | `predictComplication()` |
| **약물 부작용 예측** | 환자별 부작용 위험도 | `predictAdverseDrug()` |
| **영상 AI** | 흉부X-ray, CT, MRI 분석 | `visionAnalyze()` |
| **CDSS** | DUR, 알레르기, 신기능 용량, 연령 검증 | `cdss.check()` |
| **코드 매핑** | 진단→EDI 자동 매핑 (3단계 파이프라인) | `autoMapper` |
| **AI 예약** | 증상→진료과 추천 + 일정 제안 | `/booking` |
| **AI 컨시어지** | 대화형 환자 상담 도우미 | `concierge` |

### 1.2 AI가 없는 모듈 (공백 영역)

| 모듈 | 현재 상태 | AI 잠재 가치 |
|------|----------|:----------:|
| **수납/청구** (billing, hira-edi) | 순수 트랜잭션 | 높음 |
| **간호** (nursing, nurse-station) | 수동 기록 | 높음 |
| **약국** (pharmacy) | 조제 대기열만 | 높음 |
| **검사실** (lab) | 결과 입력만 | 높음 |
| **영상** (imaging) | visionAnalyze() 미연결 | 중간 |
| **수술** (surgery) | 일정 관리만 | 중간 |
| **원격진료** (telehealth) | 세션 관리만 | 중간 |
| **건강검진** (checkup) | 프로그램 관리만 | 중간 |
| **환자 포털** (portal) | 조회만 | 중간 |
| **응급** (emergency) | triage AI 있으나 미활용 | 높음 |
| **병리** (pathology) | 결과 입력만 | 중간 |
| **영양** (nutrition) | 영양 평가만 | 낮음 |

## 2. AI 확장 영역별 상세 설계

### 2.1 수납/청구 AI (billing)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **EDI 코드 자동 매핑** | 진단 → 수가코드 자동 제안 | `autoMapper` |
| **청구 오류 사전 감지** | 청구 거절 가능성 예측 → 보정 | 신규 |
| **중복 청구 적발** | 과거 패턴 분석 → 의심 항목 플래깅 | 신규 |
| **영수증 자동 생성** | 진료기록 → 법정 13항목 자동 추출 | `autoSoap()` 응용 |

```typescript
// billing.service.ts 추가 API
suggestEdiCode(diagnosis: string): Promise<{ code: string; probability: number }[]>
detectBillingAnomaly(encounterId: string): Promise<{ riskLevel: string; issues: string[] }>
```

### 2.2 간호 AI (nursing)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **NANDA 간호진단 추천** | 증상/바이탈 → NANDA 진단 자동 제안 | `orchestrate()` |
| **NIC 간호중재 가이드** | 간호진단 → 증거기반 중재 제안 | `orchestrate()` |
| **인수인계 AI 요약** | 장시간 간호기록 → 핵심 3~5줄 요약 | `autoSoap()` |
| **낙상 위험 AI 보정** | Morse 점수 + 환자 특수성 AI 보정 | `predictComplication()` |
| **통증 추세 분석** | 통증 점수 트렌드 → 악화 시 알림 | 신규 |

```typescript
// nursing.service.ts 추가 API
suggestNandaDiagnosis(assessment: object): Promise<{ code: string; name: string; probability: number }[]>
suggestNursingIntervention(nandaCode: string): Promise<{ nicCode: string; actions: string[] }[]>
summarizeShiftHandoff(admissionId: string): Promise<string>
```

### 2.3 약국 AI (pharmacy)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **처방 검토 자동화** | 처방전 → 용량/금기/상호작용 사전 분석 | `cdss.check()` |
| **다중 약물 상호작용** | 5개 이상 동시 처방 심화 분석 | `predictAdverseDrug()` |
| **복약지도 자동 생성** | 처방약 → 한글 복약지도 (부작용, 식사) | `patientEducation()` |
| **대체 약물 AI 추천** | 동일 성분/효능 대체약물 + 보험 급여 | `recommendDrugs()` |

```typescript
// pharmacy.service.ts 추가 API
reviewPrescriptionAI(prescriptionId: string): Promise<{ alerts: Alert[]; suggestions: string[] }>
generateMedicationGuidance(prescriptionId: string): Promise<{ guidance: string; precautions: string[] }>
```

### 2.4 검사실 AI (lab)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **검사 결과 자동 해석** | 수치 → 임상 의의 한글 해석 | `interpretLab()` ✅ |
| **위급값 자동 감지** | Critical value → 즉시 알림 | 신규 (SSE 연동) |
| **추가 검사 추천** | 비정상 수치 → 추적 검사 제안 | `orchestrate()` |
| **트렌드 분석** | 동일 환자 과거 vs 현재 → 변화 감지 | 신규 |
| **QC 자동화** | 기구별 QC값 → 정상/이상 자동 판단 | 신규 |

```typescript
// lab.service.ts 추가 API
interpretLabResultAI(resultId: string): Promise<{ summary: string; implications: string[] }>
detectCriticalValue(testName: string, value: number): Promise<{ isCritical: boolean; action: string }>
suggestFollowupTests(resultId: string): Promise<{ test: string; reason: string }[]>
```

### 2.5 영상 AI (imaging)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **AI 판독 보조** | X-ray/CT/MRI → 병소 위치/크기 초안 | `visionAnalyze()` ✅ |
| **구조화 리포트** | BI-RADS, Lung-RADS, TNM 자동 생성 | 신규 |
| **비교 판독** | 이전 검사 vs 현재 → 변화 강조 | 신규 |
| **응급 병소 감지** | pneumothorax, stroke → 실시간 알림 | `visionAnalyze()` |

```typescript
// imaging.service.ts 추가 API
analyzeImagingAI(resultId: string): Promise<{ findings: Finding[]; impression: string }>
compareWithPrevious(currentId: string, previousId: string): Promise<{ changes: string[] }>
```

### 2.6 수술 AI (surgery)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **수술 위험도 예측** | 환자 특성 + 수술 유형 → 합병증 확률 | `predictComplication()` ✅ |
| **수술 시간 예측** | 과거 데이터 → 예상 소요 시간 | 신규 |
| **OP note 자동 초안** | 수술 정보 → 구조화 수술기록 초안 | `autoSoap()` |
| **SSI 예측** | 수술 부위 감염 위험도 | `predictComplication()` |

### 2.7 원격진료 AI (telehealth)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **비동기 메시지 분류** | 환자 메시지 → 긴급/일반/재진 분류 | `orchestrate()` |
| **답변 초안 생성** | 환자 증상 → 의사 답변 템플릿 | `clinicalQa()` |
| **세션 품질 예측** | 만족도 낮을 세션 사전 플래깅 | 신규 |

### 2.8 건강검진 AI (checkup)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **맞춤 검진 프로그램 추천** | 나이/성별/가족력 → 패키지 추천 | `orchestrate()` |
| **검진 결과 종합 해석** | 전체 검진 데이터 → 건강상태 평가 | `interpretLab()` |
| **추적 검진 권고** | 비정상 수치 → 추적 시기/항목 | `orchestrate()` |

### 2.9 환자 포털 AI (portal)

| 기능 | 설명 | 기존 API 활용 |
|------|------|:----------:|
| **건강 스코어** | 검사/진료 기록 → 종합 건강 점수 | 신규 |
| **검사 결과 쉬운 해석** | 수치 → 환자 수준 한글 설명 | `patientEducation()` ✅ |
| **재진 권고** | 만성질환 → 다음 방문 시기 제안 | `orchestrate()` |
| **약물 상호작용 자가 점검** | 복용약 + 건강식품 → 경고 | `cdss.check()` |

## 3. 구현 우선순위

### Phase 1: Quick Wins (1~2주) — 기존 API 연결만

| # | 모듈 | 기능 | 난이도 | 기존 API |
|---|------|------|:------:|----------|
| 1 | **검사실** | 검사 결과 자동 해석 | 낮음 | `interpretLab()` 연결 |
| 2 | **수납** | EDI 코드 자동 매핑 | 낮음 | `autoMapper` 연결 |
| 3 | **영상** | AI 판독 보조 | 낮음 | `visionAnalyze()` 연결 |
| 4 | **수술** | 합병증 위험도 예측 | 낮음 | `predictComplication()` 연결 |
| 5 | **포털** | 검사 결과 쉬운 해석 | 낮음 | `patientEducation()` 연결 |
| 6 | **영상** | 구조화 리포트 (BI-RADS/Lung-RADS) | 낮음 | `visionStructuredReport()` 연결 |
| 7 | **영상** | 비교 판독 | 낮음 | `visionCompareReport()` 연결 |
| 8 | **응급** | AI 트리아지 재평가 + 긴급도 자동 분류 | 낮음 | `triage()` 연결 |

### Phase 2: 핵심 확장 (2~4주) — orchestrate() 활용

| # | 모듈 | 기능 | 난이도 |
|---|------|------|:------:|
| 6 | **간호** | NANDA 진단 추천 + NIC 중재 가이드 | 중간 |
| 7 | **간호** | 인수인계 AI 요약 | 중간 |
| 8 | **약국** | 처방 검토 자동화 + 복약지도 생성 | 중간 |
| 9 | **원격진료** | 비동기 메시지 분류 + 답변 초안 | 중간 |
| 10 | **건강검진** | 검진 결과 종합 해석 + 추적 권고 | 중간 |

### Phase 3: 고급 기능 (1~2개월) — 신규 개발

| # | 모듈 | 기능 | 난이도 |
|---|------|------|:------:|
| 11 | **검사실** | 위급값 자동 감지 + SSE 알림 | 중간 |
| 12 | **검사실** | 검사 트렌드 분석 | 중간 |
| 13 | **수납** | 청구 오류 사전 감지 | 중상 |
| 14 | **수술** | OP note 자동 초안 | 중상 |
| 15 | **포털** | 건강 스코어 + 재진 권고 | 중간 |

### Phase 4: 장기 (2개월+) — 규제 협의 + 신규 모델

| # | 모듈 | 기능 | 난이도 | 비고 |
|---|------|------|:------:|------|
| 16 | **영상** | 응급 병소 자동 감지 + 실시간 알림 | 상 | SaMD 인허가 6~18개월 |
| 17 | **약국** | 다중 약물(5+) 상호작용 심화 분석 | 상 | |
| 18 | **병리** | 디지털 병리 AI 판독 보조 | 상 | SaMD 검토 필요 |
| 19 | **전체** | 병원 프로세스 마이닝 최적화 | 상 | |

## 4. 기술 아키텍처

### 4.1 공통 패턴 (모든 AI 연동)

```
사용자 요청
  ↓
[기존 비즈니스 로직]
  ↓
[MedicalAiService 호출] ← 폴백: AI 실패 시 기존 프로세스 유지
  ↓
[AI 결과 + 신뢰도]
  ↓
[UI에 "AI 제안" 배지로 표시] ← 최종 결정은 항상 의료진
  ↓
[승인/거절 → DB 저장 + 감사 로그]
```

### 4.2 AI 호출 원칙

1. **폴백 필수**: AI 실패 시 기존 프로세스 100% 동작
2. **의료진 최종 결정**: AI는 "제안"만, 승인은 사람
3. **감사 추적**: AI 제안 → 승인/거절 → 최종 결과 모두 기록
4. **신뢰도 표시**: AI 결과에 항상 confidence score 표시
5. **규제 준수**: 의료법/개인정보보호법 범위 내에서만 적용

### 4.3 FE 공통 컴포넌트

```typescript
// AI 제안 배지 컴포넌트 (재사용)
<AiSuggestionBadge
  suggestion="J00 급성 비인두염"
  confidence={0.92}
  onAccept={() => applyDiagnosis('J00')}
  onReject={() => {}}
/>
```

## 5. 예상 효과

| 영역 | 주요 효과 | 시간 절약 |
|------|----------|----------|
| 수납 | 청구 오류 35% 감소 | -2시간/일 |
| 간호 | 기록 완성도 25% 향상 | -1시간/환자 |
| 약국 | 처방 검토 시간 50% 단축 | -3시간/일 |
| 검사실 | 의사 리딩 시간 40% 단축 | -2시간/일 |
| 수술 | 수술 기록 시간 40% 단축 | -1.5시간/수술 |
| **합계** | | **-9.5시간/일** |

## 6. 제약 사항

| 항목 | 요구사항 |
|------|----------|
| **의료법** | AI 진단/처방은 의사 확인 필수, "참고용" 표시 |
| **개인정보보호법** | 환자 데이터 AI 전송 시 암호화, 동의 필요 |
| **의료기기법** | AI 영상 판독은 의료기기 허가 검토 필요 |
| **감사 추적** | 모든 AI 제안 → 승인/거절 기록 보존 |
| **폴백** | AI 서비스 장애 시 기존 프로세스 100% 유지 |

## 7. 비기능 요구사항

| 항목 | 요구사항 |
|------|----------|
| AI 응답 시간 (P95) | < 3초 (동시 50 사용자 기준) |
| AI 서버 TPS | > 10 req/s (WeRU.B Ollama) |
| 가용성 | AI 실패 시 기존 프로세스 100% 유지 (폴백) |
| 재시도 정책 | 3회 재시도, 지수 백오프 (1s → 2s → 4s) |
| 캐싱 | 동일 입력 1시간 캐싱 (Redis) |
| GPU 요구 | Qwen2.5 모델 기준 8GB VRAM |

## 8. AI 감사 로그 데이터 모델

```prisma
model AiAuditLog {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  module        String   @db.VarChar(50)       // billing, nursing, pharmacy...
  action        String   @db.VarChar(50)       // suggest_edi, suggest_nanda...
  input         Json     @db.JsonB
  output        Json     @db.JsonB
  confidence    Float?
  decision      String   @db.VarChar(10)       // ACCEPTED, REJECTED, MODIFIED, IGNORED
  decisionAt    DateTime? @map("decision_at") @db.Timestamptz()
  finalValue    String?  @map("final_value") @db.Text
  responseTimeMs Int?    @map("response_time_ms")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()

  user User @relation(fields: [userId], references: [id])
  @@index([module, action])
  @@index([userId, createdAt])
  @@map("ai_audit_logs")
}
```

## 9. 테스트 계획

### Phase별 테스트

| Phase | 테스트 유형 | 내용 |
|-------|-----------|------|
| Phase 1 | 단위 테스트 | 각 AI 연동 메서드 — 입력/출력/폴백 검증 |
| Phase 1 | 통합 테스트 | AI API 호출 → DB 저장 → FE 표시 E2E |
| Phase 2 | 임상 검증 | 파일럿 부서 (내과) 2주간 사용 → 정확도 측정 |
| Phase 3 | A/B 테스트 | AI 제안 그룹 vs 기존 그룹 비교 |
| Phase 4 | 규제 검증 | SaMD 인허가 기준 테스트 (민감도/특이도) |

### AI 출력 품질 메트릭

| 모듈 | 메트릭 | 목표 |
|------|--------|------|
| 수납 EDI 매핑 | Precision (정확도) | > 90% |
| 간호 NANDA 추천 | Top-3 Recall | > 80% |
| 검사 결과 해석 | 위급값 Sensitivity | > 99% |
| 약물 상호작용 | Specificity (특이도) | > 95% |

## 10. 변화 관리

| 단계 | 활동 | 시기 |
|------|------|------|
| **파일럿 선정** | 내과 외래 1개 팀으로 시작 | Phase 1 시작 시 |
| **챔피언 사용자** | 각 부서 1명 AI 활용 리더 지정 | Phase 1 |
| **교육** | AI 도구 사용법 + 한계 인식 워크샵 (1시간) | Phase 1 완료 시 |
| **피드백 채널** | AI 제안 화면에 👍/👎 버튼 → 감사 로그 | 전 Phase |
| **월간 리뷰** | AI 수용률/정확도/만족도 대시보드 리뷰 | 매월 |
| **책임 소재** | AI는 "참고 제안", 최종 의사결정 책임은 의료진 | 운영 규정 |

## 11. 규제 영향 분석

| 규제 | 영향 Phase | 대응 |
|------|:---------:|------|
| **의료법** (진단/처방 AI) | Phase 1~3 | "AI 제안" 라벨 필수, 의사 승인 프로세스 |
| **개인정보보호법** (프로파일링) | Phase 2+ | 자동화 의사결정 거부권 안내, 동의 절차 |
| **의료기기법** (SaMD) | Phase 4 | 식약처 인허가 사전 협의 (착수 6개월 전) |
| **KISA AI 보안 가이드** | 전체 | AI 입출력 암호화, 편향성 모니터링 |

## 12. 범위 외 (Out of Scope)

| 항목 | 사유 |
|------|------|
| 자체 AI 모델 학습 | 현재 WeRU.B + Ollama 활용, 자체 학습은 Phase 5+ |
| 유전체 기반 맞춤치료 | 별도 프로젝트 필요 |
| 환자 자가진단 AI | 법적 리스크, 의료법 위반 소지 |
| 보험사 직접 연동 | 별도 사업 범위 |

## 13. 성공 지표

| 지표 | 목표 | 측정 방법 | 주기 |
|------|------|----------|:----:|
| AI 제안 수용률 | > 70% | `ai_audit_logs` 테이블 ACCEPTED/REJECTED 비율 | 주간 |
| AI 호출 응답 시간 (P95) | < 3초 | `ai_audit_logs.response_time_ms` 집계 | 일간 |
| AI 폴백 발생률 | < 5% | AI 호출 실패 건수 / 전체 호출 비율 | 주간 |
| 의료진 만족도 | > 4.0/5.0 | 월간 설문 (대상: AI 사용 의료진) | 월간 |
| 환자 안전 사고 | 0건 증가 | 기존 안전 사고 보고 시스템 (baseline: 현재 월평균) | 월간 |
