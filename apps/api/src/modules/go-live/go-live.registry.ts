/**
 * 운영 전환(Go-Live/Cutover) 항목 정본 레지스트리 — go-live-cutover-command.plan.md §2·§7.
 * A~D: sourceKey로 어댑터가 status 실시간 파생(config/DB 직접조회·모듈 순환 회피).
 * E~G: sourceKey null = 수동 관리(GoLiveItem.status 직접).
 */
export type GoLiveArea = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type GoLiveType = 'CONFIG_GATE' | 'APPROVAL' | 'EXTERNAL' | 'MANUAL' | 'HARDWARE' | 'SERVICE_FLAG' | 'DB_PROBE';

export interface GoLiveDef {
  /**
   * 🔴 이 항목이 기대는 **사람 결정**(`decision.registry.ts` 의 key).
   *    종전에는 `note` 안에 **문자열 링크**로만 적혀 있었다 — 키를 바꿔도 아무도 모른다.
   *    정본 필드로 올리고 양쪽 존재를 기계 대조한다(가드).
   */
  decisionKey?: string;
  area: GoLiveArea;
  key: string;
  title: string;
  type: GoLiveType;
  owner?: string;
  drillDown?: string;
  sourceKey?: string;   // A=config gate key / B=track / C='phase0' / D='hospitalInfo' / F='ginIndex' / H='flag:<key>=<target>'
  targetMode?: string;  // A영역 준비 판정 목표 모드
  isBlocking?: boolean; // 기본 true
  note?: string;        // 운영자에게 보여줄 판단 근거(개시 시 무엇을 확인해야 하는가)
}

/**
 * F 영역 GIN 인덱스 실측 대상 — `prisma/manual/search-trgm-indexes-20260705.sql` 과 **이름까지 일치**해야 한다.
 * 목록을 늘릴 때는 SQL 과 함께 고칠 것(한쪽만 고치면 실측이 다시 거짓말한다).
 */
export const EXPECTED_GIN_INDEXES = [
  'idx_patients_family_trgm',
  'idx_patients_given_trgm',
  'idx_procedure_codes_nameko_trgm',
  'idx_medication_codes_nameko_trgm',
  'idx_diagnosis_codes_nameko_trgm',
  'idx_drug_std_product_trgm',
] as const;

export const AREA_LABEL: Record<GoLiveArea, string> = {
  A: '임상 안전게이트', B: '외부 연동', C: '개인정보/가명화', D: '데이터 준비',
  E: '보안/인증', F: '인프라/성능', G: '하드웨어/AI', H: '서비스 개시 설정 확정',
};

export const GO_LIVE_REGISTRY: GoLiveDef[] = [
  // ── A. 임상 안전게이트 (config gate 어댑터·targetMode 이상이면 READY) ──
  { area: 'A', key: 'gate.dur.enforce', title: 'DUR 처방 게이트(병용금기·임부·알레르기·용량)', type: 'CONFIG_GATE', owner: '진료부·약제', drillDown: '/admin/safety-gates', sourceKey: 'dur.enforce', targetMode: 'BLOCK' },
  { area: 'A', key: 'gate.pharmacy.durGate', title: 'DUR 조제 게이트(미해결 경고 조제 차단)', type: 'CONFIG_GATE', owner: '약제', drillDown: '/admin/safety-gates', sourceKey: 'pharmacy.durGate.enforce', targetMode: 'WARN' },
  { area: 'A', key: 'gate.cdss.enforce', title: 'CDSS 처방 검증(알레르기·신기능·연령)', type: 'CONFIG_GATE', owner: '진료부', drillDown: '/admin/safety-gates', sourceKey: 'cdss.enforce', targetMode: 'WARN' },
  { area: 'A', key: 'gate.imaging.contrast', title: '조영제 안전(알레르기·eGFR)', type: 'CONFIG_GATE', owner: '영상의학과', drillDown: '/admin/safety-gates', sourceKey: 'imaging.contrastEnforce', targetMode: 'WARN' },
  { area: 'A', key: 'gate.imaging.pregnancy', title: '임신확인(가임기 전리방사선)', type: 'CONFIG_GATE', owner: '영상의학과', drillDown: '/admin/safety-gates', sourceKey: 'imaging.pregnancyEnforce', targetMode: 'WARN' },
  { area: 'A', key: 'gate.inventory.expiry', title: '만료/리콜 LOT 불출 차단', type: 'CONFIG_GATE', owner: '물류', drillDown: '/admin/safety-gates', sourceKey: 'inventory.expiryIssueEnforce', targetMode: 'WARN' },
  // 🔴 formulary.enforce 는 단일 문자열이 아니라 **영역별 맵**(MEDICATION·LAB·IMAGING·THERAPY·DIET·ACTIVITY·NURSING).
  //    맵을 문자열로 취급하던 시절 `String(obj)`='[object Object]' 가 gateMode 의 fail-closed 분기에 걸려
  //    **항상 BLOCK 으로 읽혀** 6영역이 OFF 인데도 준비완료로 표시됐다. 판정은 최저 영역이 기준(go-live.service).
  { area: 'A', key: 'gate.formulary.enforce', title: '원내 처방집(포뮬러리) 시행', type: 'CONFIG_GATE', owner: '약제위', drillDown: '/admin/safety-gates', sourceKey: 'formulary.enforce', targetMode: 'WARN', note: '영역별 게이트 맵 — 전 영역이 목표 모드 이상일 때만 준비완료. 한 영역이라도 OFF 면 미준비(최저 영역 기준).' },
  { area: 'A', key: 'gate.psychiatry.ect', title: 'ECT 동의 게이트', type: 'CONFIG_GATE', owner: '정신과', drillDown: '/admin/safety-gates', sourceKey: 'psychiatry.ectConsentEnforce', targetMode: 'BLOCK' },

  // ── C. 가명화 (phase0 어댑터) ──
  { area: 'C', key: 'cutover.phase0.pseudonym', title: 'MRN 가명화 컷오버(chartNo→patientRef)', type: 'APPROVAL', owner: '법무·CPO', drillDown: '/admin/phase0-cutover', sourceKey: 'phase0' },

  // ── D. 데이터 준비 (data 어댑터) ──
  // 🔴 설정 키(`hospital.*`·`flag:*`)를 고치러 보내는 drillDown 은 **값을 바꿀 수 있는 화면** `/admin/ai-settings`
  //    (「시스템 설정」·`PUT /api/v1/config/:key`)를 가리킨다. `/admin/config` 는 같은 값을 출처 배지와 함께
  //    **보기만** 하는 화면이라 여기 쓰지 않는다(2026-09-13 외부 실측 S8 — 두 화면의 제목이 같아 가이드를 따라간
  //    사람이 끌 수 없는 화면에 도착했다). 가드: `test/go-live/settings-screen-canon.spec.ts`
  { area: 'D', key: 'data.hospitalInfo', title: '설치 필수 기관 키 입력(기호·사업자번호·대표자·면허·국가·주소·전화·응급·진료시간)', type: 'DB_PROBE', owner: '원무', drillDown: '/admin/ai-settings', sourceKey: 'hospitalInfo', decisionKey: 'identity.unsetIssuance', isBlocking: false, note: '🔴 (2026-09-13 상용 릴리즈 기획 T3-2) `hospital.*` 필수 13키의 **DB 행 실재**로 판정한다 — 설정 조회는 행이 없으면 개발 기본값(가짜 병원명·요양기관기호 12345678)으로 떨어져 미입력이 입력된 것처럼 보였다. 항상 `입력 n / 필수 13` 을 병기한다. 🔴 **관제만 한다(비차단)** — 미입력 시 법정 서식 발급을 막을지는 사람 결정 /admin/decisions/identity.unsetIssuance 뒤다. 필수/선택 분류 정본 = go-live.service.ts `INSTITUTION_REQUIRED_KEYS`' },

  // ── B. 외부 연동 (P2 어댑터 — integration-gate track CONFIRMED / config mode REAL 파생) ──
  { area: 'B', key: 'integ.lis', title: 'LIS Reflex 양방향 오더 컷오버', type: 'EXTERNAL', owner: '진단검사의학과', drillDown: '/admin/integration-gates', sourceKey: 'track:LIS_REFLEX', note: '🔴 현재 결재 3건은 전부 개발 시드(DEV-SEED)라 실검증으로 세지 않는다. /admin/integration-gates 에서 실제 결재 근거(문서·회신)로 재기록해야 준비완료가 된다.' },
  // 🔴 예전 sourceKey 는 `config:erp.enabled=true` 였다. 그런데 erp.enabled 는 **화면 상단 ERP 바로가기 표시 여부**
  //    UI 플래그이고 값도 DB 에 없어 코드 기본값(true)이 그대로 읽혔다 — 아무도 결정하지 않은 값이
  //    "ERP 실 이관 전환완료"의 근거로 표시됐다. 실 이관 근거는 ERP 팀 전표 확인 회신이므로 수동 항목으로 되돌린다.
  { area: 'B', key: 'integ.erp', title: 'ERP 진료비/전표 연동(실 이관)', type: 'EXTERNAL', owner: '원무·전산', drillDown: '/admin/integration-gates', note: '시스템이 자동 확인할 수 있는 신호가 없다(erp.enabled 는 ERP 바로가기 노출용 UI 플래그일 뿐 이관 근거가 아님). ERP 팀 전표 확인 회신을 받은 담당자가 근거와 함께 수동 확정.' },
  { area: 'B', key: 'integ.sign', title: 'W.Sign 전자서명 EXTERNAL 전환', type: 'EXTERNAL', owner: '전산·보안', drillDown: '/admin/integration-gates', sourceKey: 'config:sign.mode=EXTERNAL' },
  { area: 'B', key: 'integ.eligibility', title: '수진자 자격조회 NHIS 실연동', type: 'EXTERNAL', owner: '원무', drillDown: '/admin/integration-gates', sourceKey: 'config:eligibility.mode=NHIS' },
  // 외부 잔여 왕복·개통 (수동 관리 — 상대측 회신·발급 대기)
  { area: 'B', key: 'integ.erpResidual', title: 'ERP 잔여 왕복(전표 확인 회신·사번 백필 개시)', type: 'EXTERNAL', owner: 'ERP팀·전산', drillDown: '/admin/erp', isBlocking: false },
  { area: 'B', key: 'integ.ems119', title: '119 사전통보 개통(소방청 emsKey 발급·연동 상대 확정)', type: 'EXTERNAL', owner: '응급의학과·전산', drillDown: '/admin/ai-settings', isBlocking: false },
  { area: 'B', key: 'integ.smsProvider', title: 'SMS 제공자 등록(환자 로그인 OTP 실발송)', type: 'EXTERNAL', owner: '전산·원무', drillDown: '/admin/outbound-channels', note: '🔴 `CrmChannelService` 에 SMS 제공자가 등록돼 있지 않아 환자 OTP 가 SIMULATED(서버 로그에만·문자 미발송)다. 로그인 흐름은 정직하게 delivery 상태를 말하지만 실환자는 문자를 받지 못한다 — **운영 배포 전 필수**. 제공자(알리고·CoolSMS 등) 계약 후 CrmChannelService 에 SMS 채널 등록·확정. 정본 modules/patient-auth/services/sms-otp.service.ts · 코드 사실이라 자동 신호 없음(담당자 수동 확정).' },
  { area: 'B', key: 'integ.nimsKids', title: '마약류 NIMS·부작용 KIDS 실전송 개통', type: 'EXTERNAL', owner: '약제', drillDown: '/admin/outbound-channels', sourceKey: 'channel:NIMS,KIDS', note: '🔴 판정은 코드의 채널 구현 여부에서 자동 파생한다(사람이 "됐다"고 적어도 미구현이면 미완). 미구현 동안은 수기 신고로 대체된다.' },
  { area: 'B', key: 'integ.hiraSubmit', title: '심평원 EDI 명세서 실전송·반송 처리', type: 'EXTERNAL', owner: '원무·심사', drillDown: '/admin/hira-edi', sourceKey: 'channel:HIRA', note: '🔴 코드의 채널 구현 여부에서 자동 파생. 미구현 동안 청구는 요양기관업무포털 수기 제출로 대체된다(원장에는 미전송으로 남는다).' },
  { area: 'B', key: 'integ.pacsCutover', title: 'PACS 컷오버(PM 창 확정·당일 병리오더 검증)', type: 'EXTERNAL', owner: 'PM·전산', isBlocking: false },
  { area: 'B', key: 'integ.cernoPilot', title: 'Cerno 임상 AI 파일럿 착수(launch 경로 확인·대상 환자 AI 동의·실 의료진 왕복)', type: 'EXTERNAL', owner: 'Cerno·진료부', drillDown: '/admin/smart-clients', isBlocking: false, note: 'HIS 측 준비 완료(런처·RS256·접근 리포트). 대기=앱 launch 경로 회신·파일럿 환자 동의 취득' },
  { area: 'B', key: 'integ.bloodOrder', title: '혈액원 발주 실연계', type: 'EXTERNAL', owner: '혈액은행', isBlocking: false },
  /**
   * 🔴 법정 보고 채널 — 실 서비스 개시 전까지 **구현되어 있어야 한다**(2026-08-20 사람 결정).
   * 지금 미구현인 것은 결함이 아니라 **예정된 상태**다. 다만 개시 후에는 법정 의무라
   * 개시 항목으로 추적한다. 판정은 `/admin/outbound-channels` 가 읽는 채널 상수에서 자동 파생 —
   * 사람이 완료로 적어도 코드가 미구현이면 미완으로 나온다.
   */
  { area: 'B', key: 'integ.kcdc', title: '법정감염병 질병관리청 웹신고 전송', type: 'EXTERNAL', owner: '감염관리실', drillDown: '/admin/outbound-channels', sourceKey: 'channel:KCDC', note: '감염병예방법 §11 신고 의무. 미구현 동안은 is.kdca.go.kr 수기 신고 후 접수번호 기록.' },
  { area: 'B', key: 'integ.konis', title: '의료관련감염 KONIS 보고 전송', type: 'EXTERNAL', owner: '감염관리실', drillDown: '/admin/outbound-channels', sourceKey: 'channel:KONIS', note: '미구현 동안은 KONIS 웹 수기 보고 후 근거번호 입력.' },
  { area: 'B', key: 'integ.kccr', title: '암등록 KCCR 전송', type: 'EXTERNAL', owner: '암등록실', drillDown: '/admin/outbound-channels', sourceKey: 'channel:KCCR' },
  { area: 'B', key: 'integ.hie', title: '진료정보교류(HIE) 문서 전송', type: 'EXTERNAL', owner: '의무기록·전산', drillDown: '/admin/outbound-channels', sourceKey: 'channel:HIE_HIGHWAY' },

  // ── E. 보안/인증 (수동·go-live 체크리스트) ──
  { area: 'E', key: 'security.terminal2', title: '단말② 재인증 게이트 활성화(생체 step-up)', type: 'MANUAL', owner: '보안·진료부', drillDown: '/admin/emr-cert' },
  { area: 'E', key: 'security.certSelfIssue', title: 'HIS 자체 인증서 발급 폐지(sign 단독)', type: 'CONFIG_GATE', owner: '보안', sourceKey: 'blockchain.selfIssuanceEnabled', targetMode: 'OFF' },
  { area: 'E', key: 'security.hsm', title: 'HSM/KMS 키 수탁 컷오버(sign 소관)', type: 'EXTERNAL', owner: '보안·sign', isBlocking: false },
  // 법무 선결 게이트 (수동 관리)
  { area: 'E', key: 'legal.retention', title: '데이터 보유·실파기 개시(법무 승인 — DRY-RUN 완료 상태)', type: 'APPROVAL', owner: '법무·CPO', isBlocking: false },
  { area: 'E', key: 'legal.eduHardening', title: 'edu 연동 시크릿 회수·aud 하드닝(법무 선결)', type: 'MANUAL', owner: '법무·전산', isBlocking: false },
  { area: 'E', key: 'legal.voucher', title: '건강검진권 블록체인 발행 개시(외국인 §27·법무)', type: 'APPROVAL', owner: '법무', drillDown: '/admin/voucher/dashboard', isBlocking: false },
  { area: 'E', key: 'legal.clinicalChannel', title: '기록지 결재 채널전환 3중 게이트(HR CLINIC·W.Sign 템플릿·PHI 법무)', type: 'MANUAL', owner: '법무·현업', isBlocking: false },

  // 🔴 백업은 "했다"고 선언할 수 있는 것이 아니라 **파일이 있느냐**로 끝나는 사실이다.
  //    2026-08-25 실측: 크론은 2026-05-07부터 매일 돌았는데 스크립트에 실행 비트가 없어
  //    `Permission denied` 89회 — **문서에는 "매일 03:00 백업"이라 적혀 있었고 아무도 확인하지 않았다.**
  //    ginIndex 와 같은 처방(수기 선언 불가·실측 판정)으로 등재한다.
  { area: 'E', key: 'security.hisMode', title: '운영 모드 REAL 전환(시드 로그인 노출 종료)', type: 'DB_PROBE', owner: '전산', sourceKey: 'hisMode', note: '🔴 리허설 배포본에는 시드 로그인(직원 계정·공용 비밀번호·시드 환자 MRN)이 **번들에 들어 있다**. 관리 화면 토글은 숨길 뿐 지우지 못한다 — 실환자 전에 `deploy.sh --mode real` 재배포가 필요하다. 판정은 빌드 상한(HIS_MODE)으로 한다. 정본 docs/05-reference/operating-modes.md' },
  { area: 'E', key: 'billing.institutionGrade', title: '요양기관 종별 설정(개설 허가와 일치)', type: 'DB_PROBE', owner: '원무·보험', drillDown: '/admin/billing-calc', sourceKey: 'institutionGrade', decisionKey: 'billing.institutionType', note: '🔴 `billing.institution.grade` 가 **미설정이면 코드가 `?? \'CLINIC\'` 으로 떨어져 의원으로 청구된다.** 이 한 값이 셋을 동시에 가른다 — ERP 종별가산(`institutionGrade`) · 의료급여 본인부담(의원만 정액 1,000원, 병원급↑은 율) · 수가 고시 단가 열(실측 419,024코드 중 **97.4%가 의원단가 ≠ 병원급이상단가**). 운영 `procedure_codes.unit_price` 166,643건은 의원단가와 98.8% 일치했다. 판정은 DB 행 실재로 한다(기본값은 설정이 아니다). 사람 결정 /admin/decisions/billing.institutionType' },
  { area: 'E', key: 'security.dbBackup', title: '정기 DB 백업(GPG 암호화) 실행 확인', type: 'DB_PROBE', owner: '전산', sourceKey: 'dbBackup', note: '🔴 최근 .gpg 백업 파일의 생성 시각으로 판정한다(사람 선언 불가). 48시간 넘게 새 백업이 없으면 NOT_READY — 크론이 돌아도 실패하면 파일이 안 생긴다. 경로 /home/deploy/backups/hospitalrun · 스크립트 infra/scripts/backup.sh(deploy.sh 가 rsync 하지 않는 수동 배치분) · 절차 docs/05-reference/backup-and-key-rotation.md §1' },
  { area: 'E', key: 'security.encryptionKey', title: 'PID 암호화 키 로테이션(운영 키가 플레이스홀더 아님)', type: 'DB_PROBE', owner: '보안·전산', drillDown: '/admin/ai-settings', sourceKey: 'encryptionKey', note: '🔴 운영 `ENCRYPTION_KEY` 가 all-zeros(개발 플레이스홀더)면 PID(주민·여권·CI·보험번호) 암호화가 사실상 무력하다. env 값으로 자동 판정한다(사람 선언 불가) — 미설정·all-zeros 면 NOT_READY. 실 키 생성·기존 암호문 전량 재암호화 절차 docs/05-reference/backup-and-key-rotation.md §2 · 재암호화 스크립트 scripts/rotate-encryption-key.mjs(dry-run 기본).' },

  // ── F. 인프라/성능 (수동) ──
  // 🔴 이 항목은 수동 status 였고 누구도 확인하지 않은 채 READY 로 적혀 있었다(실측 = 6종 중 0종 존재·Seq Scan).
  //    "적용 확인"은 사람이 선언할 것이 아니라 pg_indexes 를 조회하면 끝나는 사실이므로 DB 실측으로 전환한다.
  { area: 'F', key: 'infra.ginIndex', title: 'GIN 인덱스(한글검색) 적용 확인', type: 'DB_PROBE', owner: '전산', sourceKey: 'ginIndex', note: 'pg_indexes 실측으로 판정(수기 선언 불가). 적용 SQL = apps/api/prisma/manual/search-trgm-indexes-20260705.sql — deploy.sh 는 manual/ 을 실행하지 않으므로 psql 로 수동 적용해야 한다.' },
  { area: 'F', key: 'infra.redis', title: 'Redis maxmemory/eviction 설정', type: 'MANUAL', owner: '전산' },
  { area: 'F', key: 'infra.pgTuning', title: 'PostgreSQL 튜닝(work_mem·pgss) — 공유 인스턴스 합의', type: 'MANUAL', owner: '전산', isBlocking: false },

  // ── G. 하드웨어/AI (수동/config) ──
  { area: 'G', key: 'hw.printer', title: '라벨 프린터(ZPL) 실기기 연동', type: 'HARDWARE', owner: '전산', isBlocking: false },
  { area: 'G', key: 'hw.webusb', title: 'WEBUSB 디바이스 I/O', type: 'HARDWARE', owner: '전산', isBlocking: false },
  { area: 'G', key: 'ai.werub', title: 'WeRU.B AI 서버 활성(STT GPU)', type: 'CONFIG_GATE', owner: '전산·AI', sourceKey: 'ai.server.enabled', targetMode: 'OFF', isBlocking: false },
  { area: 'G', key: 'ai.scribeStt', title: '앰비언트 스크라이브 STT GPU(large-v3 OOM 해소 — AI팀)', type: 'EXTERNAL', owner: 'AI팀', isBlocking: false },
  {
    area: 'G', key: 'ai.draftProvenanceSchema', title: 'AI 초안 프로비넌스 스키마 일반화 결정(진료 AI 보조·퇴원요약·동의서)', type: 'MANUAL',
    owner: '진료부·전산(스키마 승인)', isBlocking: false, drillDown: '/admin/audit',
    note: '2026-08-19 — AI 초안이 폼에 적용된 사실은 현재 감사 원장(AuditLog resourceType=AiDraftApply)에만 남는다(Encounter.aiScribed 는 스크라이브 전용). '
      + '개시 전 결정: ① 이대로 감사 원장만으로 개시(기록 본문에는 표식 없음) ② Encounter.aiAssistSource/aiDraftSnapshot·DischargeSummary/Consent.aiAssisted 컬럼 추가(db push 승인). '
      + '판단 근거는 감사 원장의 AiDraftApply 건수(0건이면 화면이 부르지 않는 것일 수 있다 — 쓰기 경로를 눌러본다).',
  },

  // ── H. 서비스 개시 설정 확정 ─────────────────────────────────────────────────────
  // 개발/시연을 위해 열어둔 설정과, 임상·법무 승인 후에 열어야 하는 설정을 **개시 전 확정 대상**으로 분리.
  // sourceKey `flag:<configKey>=<target>` — target 'false'/'true'=자동 판정, 'DECIDE'=현재값만 보여주고 운영 결정.
  // 개발 전용 기능이 실서비스에 남는 것이 가장 위험하므로 그 항목만 isBlocking(기본 true).
  {
    area: 'H', key: 'flag.aiBriefBatch', title: '환자 AI 브리핑 야간 배치(다음날 예약+재원 · 결정론) ON 여부', type: 'SERVICE_FLAG',
    owner: '진료부·전산', drillDown: '/admin/ai-settings', sourceKey: 'flag:ai.brief.batch.enabled=DECIDE', isBlocking: false,
    note: '2026-08-19 신설(chart-ai-assistant-agent P0 하이브리드). LLM 을 부르지 않는 결정론 브리핑이라 PHI 외부 전송은 없다. 진료 진입 시 lazy 계산은 항상 동작 — 배치는 지연 단축용. 켤 때 대상 수·실패 수를 야간 로그에서 확인.',
  },
  {
    area: 'H', key: 'flag.aiBriefLlm', title: '환자 AI 브리핑 배치 B(야간 LLM 사전 검사해석) ON 여부', type: 'SERVICE_FLAG',
    owner: '진료부·AI팀·개인정보보호', drillDown: '/admin/ai-settings', sourceKey: 'flag:ai.brief.llm.enabled=DECIDE', isBlocking: false,
    note: '2026-08-19 신설(chart-ai-assistant-agent P1). 🔴 켜면 야간에 검사 결과·활성약·문제목록이 AI 서버로 전송된다(PHI 외부 전송) — 폐쇄망/위탁 결정·PHI 최소 전송 확인 뒤에만. 검사 결과가 있는 환자만 · 검증층 통과분만 저장 · 환자당 예산(ai.brief.patientBudgetSec) 초과분은 미계산으로 셈한다.',
  },
  {
    area: 'H', key: 'flag.uiA11yDefaults', title: '접근성 기본값 확정(본문 배율·대비·색 외 상태 기호)', type: 'MANUAL',
    owner: '간호부·환자안전위', drillDown: '/admin/ai-settings', isBlocking: false,
    // 🔴 2026-09-03 정정: 종전 문구는 statusShape 도 "2026-08-20 배선 완료"라 말했지만,
    //    그때는 스위치와 기호 부품만 있고 **기호를 그리는 소비처가 0**이라 켜도 어느 화면도
    //    달라지지 않았다("저장했지만 적용되지 않았다"를 말하지 않는 상태). 정본 StatusBadge 가
    //    기호를 그리도록 배선한 것이 2026-09-03 이다 — 관제 문구는 실제 배선 시점을 말해야 한다.
    note: '배선: textScale·contrast 2026-08-20 · statusShape 2026-09-03(정본 StatusBadge 44파일 일괄) — 기본값은 현행 유지라 화면이 달라지지 않는다. '
      + '야간 근무 조도·저시력·색각 이상을 고려한 값을 간호부가 정해 넣는다. 🔴 값을 바꾸면 임상 화면 글자 크기가 달라지므로 현장 공지가 선행돼야 한다.',
  },
  {
    area: 'H', key: 'flag.devDemoDateRoll', title: '개발 전용: 데모 날짜 롤포워드 비활성', type: 'SERVICE_FLAG',
    owner: '전산', drillDown: '/admin/ai-settings', sourceKey: 'flag:dev.demoDateRoll=false',
    note: '데모 데이터를 오늘로 시프트하는 개발 기능. 실환자 데이터가 들어온 뒤 켜져 있으면 진료일이 이동될 위험 — 개시 전 반드시 false.',
  },
  {
    area: 'H', key: 'flag.demoSeedPurge', title: '개발 전용: 데모/시드·TEST- 픽스처 정리', type: 'MANUAL',
    owner: '전산·원무', drillDown: '/admin/data-quality',
    // 🔴 명령이 없으면 체크박스는 자가신고로 남는다 — 세어 보는 경로를 항목에 적는다(2026-09-21 · 인바운드 H3).
    //    `--apply` 없이 돌리면 한 행도 지우지 않고 **얼마나 섞여 있는지만** 찍는다. REAL 모드에서는 실행이 거부된다.
    //    🔴 이 도구가 세는 것은 시드 표식 네 가지 중 둘뿐이다(스크립트 머리말) — "0건"을 전량 제거로 읽지 않는다.
    note: '데모 환자·리허설 결재·LIS 종단검증 TEST-MRG-* 픽스처 파기. LIS 회신 수신 후 실행. '
      + '세어 보기: `cd apps/api && npx ts-node --transpile-only prisma/purge-demo-seed.ts`(드라이런 기본).',
  },
  // 개발 중 임시 개방 — 개시 전 유지/원복을 명시적으로 결정
  {
    area: 'H', key: 'flag.voiceEmrEnabled', title: '음성 EMR(조회) 개방 여부 확정', type: 'SERVICE_FLAG',
    owner: '진료부·전산', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.enabled=DECIDE', isBlocking: false,
    note: '개발 중 전 의료진 개방(READ). 개시 시 파일럿 한정(voiceEmr.pilotUserIds)으로 좁힐지 결정.',
  },
  {
    area: 'H', key: 'flag.ambientEnabled', title: '앰비언트 대화 기록 개방 여부 확정', type: 'SERVICE_FLAG',
    owner: '진료부·법무', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.ambient.enabled=DECIDE', isBlocking: false,
    note: '환자 대화 상시 전사. 개시 전 녹음 동의서(법무)·보호자 동석 시 동의 범위 확정 선결.',
  },
  {
    area: 'H', key: 'flag.ambientAiDraft', title: '앰비언트 AI 초안 사용 여부 확정', type: 'SERVICE_FLAG',
    owner: '진료부·AI', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.ambient.aiDraft.enabled=DECIDE', isBlocking: false,
    note: 'SOAP 제안에 WeRU.B 사용. OFF 면 규칙 제안만. GPU 경합(외래 피크)·A필드 SaMD 경계 검토 후 결정.',
  },
  {
    area: 'H', key: 'flag.scribeEnabled', title: '스크라이브(녹음→초안) 개방 여부 확정', type: 'SERVICE_FLAG',
    owner: '진료부·법무', drillDown: '/admin/ai-settings', sourceKey: 'flag:scribe.enabled=DECIDE', isBlocking: false,
    note: '개발 중 개방. 전사는 GPU 대기(scribe.transcription.enabled OFF) — 녹음만 되는 상태를 개시 시 허용할지 결정.',
  },
  // 임상 승인 후 개방 대상(현재 OFF)
  {
    area: 'H', key: 'flag.voiceWrite', title: '음성 활력 입력(T1) 개방 승인', type: 'SERVICE_FLAG',
    owner: '진료부·간호부', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.write.enabled=DECIDE', isBlocking: false,
    note: '확정 시 활력 정본에 실제 기록됨(이상치 알림·NEWS2 동반). 임상 승인 후 개방.',
  },
  {
    area: 'H', key: 'flag.voiceOrder', title: '음성 오더(T3) 개방 승인', type: 'SERVICE_FLAG',
    owner: '진료부·약제', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.order.enabled=DECIDE', isBlocking: false,
    note: '오더는 정본 CPOE EP 로 제출(DUR·step-up 강제). 파일럿 프로토콜(PA-0~3) 합의 후 개방.',
  },
  {
    area: 'H', key: 'flag.voiceDictate', title: '음성 구술(T2) 개방 승인', type: 'SERVICE_FLAG',
    owner: '진료부', drillDown: '/admin/ai-settings', sourceKey: 'flag:voiceEmr.dictate.enabled=DECIDE', isBlocking: false,
    note: 'SOAP/간호 구술. STT 정확도 실측(발화 스크립트) 후 결정.',
  },
  {
    area: 'H', key: 'flag.qualityAi', title: '데이터 품질 AI(컨시어지) 개방 승인', type: 'SERVICE_FLAG',
    owner: '원무·전산', drillDown: '/admin/data-quality', sourceKey: 'flag:quality.ai.enabled=DECIDE', isBlocking: false,
    note: '브리핑·중복 판별·다국어 아웃리치 초안. 전부 Human-in-loop(발송·병합은 사람).',
  },
  {
    area: 'H', key: 'flag.consentAiTranslate', title: '동의서 AI 번역 초안 검토·활성화', type: 'MANUAL',
    owner: '법무·국제진료', drillDown: '/consent/templates', isBlocking: false, // 🔴 종전 '/admin/consent-templates' 는 없는 라우트 — '상세 →' 가 404 였다
    note: '법적 문서라 번역 초안의 사람 검토가 선결. 언어판 입력 완료 후 활성화.',
  },
  {
    area: 'H', key: 'flag.clinicalEapprovalGates', title: '임상 기록지 전자결재 게이트 4종 활성화', type: 'MANUAL',
    owner: '진료부·간호부·원무', drillDown: '/admin/approvals-dashboard', isBlocking: false, // 🔴 종전 '/admin/eapproval' 은 없는 라우트 — '상세 →' 가 404 였다
    note: 'INTERNAL 리허설 4/4 완주 상태. 현업 판단만 남음(활성화=config 토글).',
  },
];
