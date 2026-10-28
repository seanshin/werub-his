# 감염관리(Infection Control) 보강 기획 — P1·P2·P3

> 2026-07-04 / Plan v1.0 / 대상: `apps/api/src/modules/infection-control`·`apps/web/.../infection`
> 계기: 검토 결과 감시목록·손위생은 양호하나 **HAI 케이스 분류·MDRO 레지스트리·법정감염병 신고가 구조화 모델 없이 ad-hoc**.

## 1. 현황
- 모델 2종만: `InfectionSurveillance`(제네릭 infectionType·organism·isolationType·notes)·`HandHygieneObservation`(WHO 5모먼트).
- EP는 다수(konis/report·resistance/surveillance·isolation·contact-trace·staff-exposure)이나 **전용 영속 모델 부재**.

## 2. 보강 범위 (신규 모델 3종·구조화)

### P1 — HAI 케이스 분류 + MDRO 레지스트리
- **`HaiCase`**: 의료관련감염 유형(CLABSI/CAUTI/VAP/SSI/CDI)·기구(중심정맥관/도뇨관/인공호흡기)·삽입일·기구일수·부위·발생일·병동·기준충족(NHSN/KONIS)·상태·KONIS 보고여부.
- **`MdroRegistry`**: 다제내성균(MRSA/VRE/CRE/CRAB/CPE)·내성기전(KPC/NDM/OXA-48)·검체·병동·검출/해제일·격리유형·활성.

### P2 — 법정감염병 신고 구조화
- **`NotifiableDiseaseReport`**: 질병명·급수(1~4급)·KCDC 코드·진단구분(의사환자/확진/병원체보유)·신고상태(DRAFT/SUBMITTED/ACK/REJECTED)·접수번호·오류로그.

### P3 — 통계/추이
- HAI 발생률(기구일수 1000일당)·MDRO 유형별·법정감염병 신고 현황. 손위생 부서별 추이(기존 확장).

## 3. 안전·정합
- 신규 모델 3종 plain patientId(비파괴). 기존 InfectionSurveillance/손위생 흐름 무영향.
- HAI/MDRO/법정신고는 **감염관리 인증·법정신고 컴플라이언스** 핵심.

## 4. 배포
신규 모델 3 → manual SQL → prisma generate → --api → --web.
