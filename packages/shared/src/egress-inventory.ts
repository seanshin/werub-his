/**
 * 🔴 외부 전송 경로 정본(egress inventory) — **무엇이 어느 목적지로 어떤 성격의 데이터를 보내는가.**
 *
 * 왜(2026-09-13 · 상용 릴리즈 기획 T10-4): 저장 위치·국외 이전을 판정하는 코드가 **0**이었다.
 * UAE 는 보건 데이터의 국내 저장·처리가 원칙이고(연방법 2019-2호 · 예외 10종 · 아부다비 ADHICS 클라우드 제한),
 * 판매 국가(`country.institutionProfile`)·아카이브 저장소 형태는 **사람 결정 대기**다. 그러나
 * "어떤 코드가 어느 목적지로 무엇을 보내는가"는 결정과 무관한 **코드 사실**이라 먼저 고정한다.
 *
 * 규약
 *   · 🔴 **국가별 허용/금지 판정을 넣지 않는다** — 국가 프로파일 결정 전이다. 화면은 "판정 없음"을 말한다.
 *   · 🔴 **운영 설정값을 추정하지 않는다** — 목적지는 코드가 가리키는 것만 적는다(고정 호스트 / env 키 / 설정 키 / DB 행).
 *     "운영에서 원내 주소로 설정돼 있다"는 이 파일이 알 수 없는 사실이다 → 설정으로 바뀌는 목적지는 `CONFIGURED`.
 *   · 🔴 **데이터 성격을 모르면 `UNKNOWN`** — 자유 입력 본문·호출부마다 다른 본문을 비PHI 로 둔갑하지 않는다.
 *   · 코드 위치(`codeRefs`)는 **호출 지점 수까지** 적는다 — 동결 가드(`apps/api/test/architecture/egress-inventory-guard.spec.ts`)가
 *     실제 코드의 호출 지점 수와 정확히 대조한다(새 호출이 생기면 실패 · 사라지면 죽은 항목으로 실패).
 *   · 대외 **메시지 채널**(SMS·메일·푸시 발송 가능 여부)은 `outbound-channel.registry.ts` 가 정본이다 — 이 파일은 그 옆이 아니라
 *     **그 아래층(네트워크 호출 지점)** 의 정본이다. 같은 관제 화면(`/admin/outbound-channels`)에 함께 나간다.
 */

/** 보내는 데이터 성격 — 실제 payload 를 읽어 판정했다(모르면 UNKNOWN) */
export type EgressDataClass = 'PHI' | 'PSEUDONYMOUS' | 'NON_PHI' | 'UNKNOWN';

/**
 * 목적지가 어떻게 정해지는가.
 *  - FIXED_EXTERNAL: 코드에 공개 호스트가 박혀 있다(원외가 확정).
 *  - CONFIGURED: env·설정·DB 행이 정한다 — 원내일 수도 원외일 수도 있다(코드는 보장하지 않는다).
 */
export type EgressNetwork = 'FIXED_EXTERNAL' | 'CONFIGURED';

/**
 * 국외 이전 검토 필요도 — **판정이 아니라 검토 대상 분류**다(국가 결정 전).
 *  - review: 원외로 나갈 수 있고 PHI·가명 데이터가 실린다.
 *  - unknown: 데이터 성격을 모른다(검토 대상에서 빼지 않는다).
 *  - none: 원외로 나가도 비PHI 다.
 *  - internal: 코드가 원내 목적지를 **보장**한다(현재 해당 경로 0 — 설정으로 바뀌지 않는 원내 고정 목적지가 없다).
 */
export type EgressCrossBorderRisk = 'review' | 'unknown' | 'none' | 'internal';

export interface EgressCodeRef {
  /** 저장소 루트 상대 경로 */
  file: string;
  /** 이 경로에 해당하는 호출 지점 수(파일 전체가 아니라 이 항목 몫) */
  calls: number;
}

export interface EgressRoute {
  id: string;
  /** 화면 라벨(한국어 원문 = i18n 키) */
  label: string;
  /** 목적지 — 코드가 가리키는 것만(`host:`·`env:`·`config:`·`db:` 접두) */
  destination: string;
  network: EgressNetwork;
  dataClass: EgressDataClass;
  codeRefs: EgressCodeRef[];
  /** 판정 근거(개발자·검토자용 · 화면에는 코드 위치로 대신한다) */
  note: string;
}

const A = 'apps/api/src/';

/** 🔴 전송 래퍼 자신 — 목적지가 아니라 통로다(호출부가 각 항목으로 등재된다) */
export const EGRESS_TRANSPORT_WRAPPERS: readonly EgressCodeRef[] = [
  { file: `${A}common/util/safe-fetch.ts`, calls: 1 },
  { file: `${A}common/util/ai-egress-fetch.ts`, calls: 1 },
];

const RAW_ROUTES: EgressRoute[] = [
  // ── AI 서버(WeRU.B) — 목적지는 설정 `ai.server.url`(또는 env MEDICAL_AI_URL) · aiEgressFetch 가 호스트 허용 목록으로 막는다 ──
  { id: 'ai.medical', label: '의료 AI 판정 요청', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/medical-ai/medical-ai.service.ts`, calls: 1 }], note: '임상 판정·판독 요청 — 환자 임상 데이터' },
  { id: 'ai.concierge', label: '환자 컨시어지 AI', destination: 'env:MEDICAL_AI_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/concierge/concierge.service.ts`, calls: 2 }], note: '환자 이름·질문·환자 실제 데이터 요약이 프롬프트에 실린다' },
  { id: 'ai.drugExplain', label: '복약 안내 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/portal/drug-explain.service.ts`, calls: 1 }], note: '환자 DUR 점검 결과 목록' },
  { id: 'ai.scribe', label: '진료 녹취 분석 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/scribe/scribe-ai.client.ts`, calls: 3 }], note: '진료 녹취 업로드·분석·작업 조회' },
  { id: 'ai.stt', label: '음성 받아쓰기 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/voice-emr/stt-chunk.client.ts`, calls: 1 }], note: '진료 녹취 원음 조각' },
  { id: 'ai.translation', label: '번역 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/i18n/translation.service.ts`, calls: 1 }], note: '상담 메시지(환자 대화) 번역·답변 초안 — 동의서 템플릿·병원 소식 번역도 같은 경로' },
  { id: 'ai.voc', label: '고객의 소리 분류 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/voc/voc-ai.service.ts`, calls: 1 }], note: '문의 제목·본문 자유 입력 — 건강정보 포함 여부는 본문에 따라 다르다' },
  { id: 'ai.dataQuality', label: '데이터 품질 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'PSEUDONYMOUS',
    codeRefs: [{ file: `${A}modules/data-quality/data-quality.service.ts`, calls: 1 }], note: '집계 숫자 · 동일인 판별 특징(성별·전화 끝 4자리·국적·출생연도) — 실명·생일은 redactForAiEgress 로 제거' },
  { id: 'ai.formulary', label: '처방집 큐레이션 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/formulary/formulary.service.ts`, calls: 1 }], note: '주제·약품 마스터 후보' },
  { id: 'ai.governance', label: '위원회 안건 검토 AI', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/gld/governance.service.ts`, calls: 1 }], note: '안건 초안·시스템 표면 컨텍스트' },
  { id: 'ai.modelTags', label: 'AI 모델 목록 조회', destination: 'config:ai.server.url', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/ai-call-log/ai-call-log.service.ts`, calls: 1 }], note: 'GET /api/tags — 본문 없음' },

  // ── 영상(OpenPACS) — 기본값은 루프백이지만 env 로 바뀐다 ──
  { id: 'pacs.proxy', label: '영상 서버(PACS) 프록시', destination: 'env:OPENPACS_API_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/pacs-proxy/pacs-proxy.service.ts`, calls: 3 }], note: '기본 http://127.0.0.1:8000 · 로그인·검사·영상 조회' },
  { id: 'pacs.portal', label: '환자 포털 영상 조회', destination: 'env:PACS_API_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/portal/portal.controller.ts`, calls: 6 }, { file: `${A}modules/portal/pacs-study-ownership.ts`, calls: 1 }], note: '기본 http://127.0.0.1:8000 · 환자 MRN 으로 검사·판독·PDF·업로드 중계 · 본인 검사 소유 확인(썸네일·PDF·선택 반출 공용 정본 — 2026-09-28 자리 이동)' },
  { id: 'pacs.export', label: '환자 영상 반출', destination: 'env:PACS_API_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/portal/pacs-export.service.ts`, calls: 1 }], note: '환자 MRN 서명 토큰으로 영상 반출' },

  // ── 원격진료 녹화(Jitsi 부가 API) — 2026-09-21 외부 점검 로 브라우저 직접 호출을 서버 프록시로 옮기며 등재 ──
  //    🔴 새 목적지가 아니다 — 종전에는 브라우저가 같은 서비스를 동일 출처 `/meet-api` 로 직접 불렀다(서버 관측 밖).
  { id: 'telehealth.recordings', label: '원격진료 녹화 관리', destination: 'env:TELEHEALTH_RECORDINGS_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/telehealth/telehealth-recordings.service.ts`, calls: 1 }], note: '녹화 목록·메모·삭제·다운로드 중계 — 진료 영상 파일과 방 이름(환자 식별 가능). 미설정이면 호출하지 않는다(503)' },

  // ── 문서·서명 ──
  { id: 'doc.pdfRender', label: '문서 PDF 렌더러', destination: 'env:PDF_SERVICE_URL', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/document/document.service.ts`, calls: 1 }], note: '기본 http://localhost:3505 · 렌더러가 발급 문서 인쇄 페이지(환자 정보)를 불러온다' },
  { id: 'sign.service', label: '전자서명 서비스', destination: 'config:sign.url', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/sign-integration/sign-integration.service.ts`, calls: 6 }], note: '서명 요청(환자 이름·CI·전화)·인증서 발급·감사 이벤트 · 허용 호스트 기본 127.0.0.1·localhost·sign.example.org' },

  // ── ERP 연동 — 설정 `erp.webhookUrl` ──
  { id: 'erp.billingInvoice', label: 'ERP 진료비 조회', destination: 'config:erp.webhookUrl', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/billing/billing.service.ts`, calls: 1 }, { file: `${A}modules/portal/portal.service.ts`, calls: 1 }], note: '차트번호·진료 ID 로 청구서 조회' },
  { id: 'erp.drugMap', label: 'ERP 약품 코드 매핑', destination: 'config:erp.webhookUrl', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/billing/billing.service.ts`, calls: 1 }], note: '확정 약품 보험코드 매핑 조회' },
  { id: 'erp.ess', label: 'ERP 인사·급여(직원 셀프서비스)', destination: 'config:erp.webhookUrl', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/ess/ess.service.ts`, calls: 3 }], note: '직원 인사·급여·증명서 — 환자 정보는 아니지만 직원 개인정보다' },
  { id: 'erp.eapprovalCallback', label: 'ERP 전자결재 결과 콜백', destination: 'db:eApprovalRelay.callbackUrl', network: 'CONFIGURED', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/clinic-integration/erp-eapproval.service.ts`, calls: 1 }, { file: `${A}modules/integration/integration-outbox.service.ts`, calls: 1 }],
    note: '결재 결과 본문 — 기록지·사전승인 결재는 환자 관련일 수 있다(본문 전수 미확인) · 즉시 3회 실패분은 아웃박스 EAPPROVAL 포맷으로 자동 재시도(같은 본문·서명 · 2026-10-01)' },
  { id: 'integration.outbox', label: '연동 이벤트 발송(ERP·등록 웹훅)', destination: 'db:integrationOutbox.targetUrl', network: 'CONFIGURED', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/integration/integration-outbox.service.ts`, calls: 1 }], note: '도메인 이벤트 payload — 등록 웹훅(Slack 형식 포함)으로도 나간다 · 이벤트별 본문 전수 미확인' },
  { id: 'integration.webhookPing', label: '웹훅 연결 시험', destination: 'db:hisWebhook.targetUrl', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/integration/integration-outbox.service.ts`, calls: 1 }], note: 'ping 본문({ok, at})만' },

  // ── 클리닉(원외 협력) — env CLINIC_API_URL ──
  { id: 'clinic.ssoStaff', label: '클리닉 SSO·직원 동기화', destination: 'env:CLINIC_API_URL', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/clinic-integration/clinic-api.service.ts`, calls: 3 }], note: 'SSO 토큰 검증·직원 목록 push/조회 — 직원 개인정보' },
  { id: 'clinic.notify', label: '클리닉 알림·범용 호출', destination: 'env:CLINIC_API_URL', network: 'CONFIGURED', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/clinic-integration/clinic-api.service.ts`, calls: 3 }], note: 'HIS 알림·긴급 알림·범용 호출 — 알림 제목·본문은 호출부가 정한다' },

  // ── 트윈·전원·기관 FHIR ──
  { id: 'twin.cdsHooks', label: '디지털 트윈 위험 카드', destination: 'env:TWIN_BASE_URL', network: 'CONFIGURED', dataClass: 'PSEUDONYMOUS',
    codeRefs: [{ file: `${A}modules/twin/twin.controller.ts`, calls: 1 }], note: '동의한 환자의 내부 환자 ID 만(CDS Hooks patient-view)' },
  { id: 'fhir.transfer', label: '전원 기관 FHIR 전송', destination: 'db:transfer.fhirEndpoint', network: 'CONFIGURED', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/transfer/transfer.service.ts`, calls: 2 }], note: 'SMART 토큰 요청 1 · 환자 전원 FHIR 번들 전송 1' },
  { id: 'fhir.metadata', label: '기관 FHIR 서버 확인', destination: 'db:organization.fhirEndpoint', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/organization/organization.service.ts`, calls: 1 }, { file: `${A}modules/partner-request/partner-request.service.ts`, calls: 1 }], note: 'GET /metadata(CapabilityStatement)' },

  // ── 고정 공개 호스트 ──
  { id: 'push.fcm', label: '모바일 푸시(FCM)', destination: 'host:fcm.googleapis.com', network: 'FIXED_EXTERNAL', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/notification/fcm-push.service.ts`, calls: 2 }], note: 'firebase-admin · 제목·본문은 호출부가 정한다 — 에스컬레이션 호출 메시지·상담 사유는 자유 입력' },
  { id: 'email.resend', label: '검진권 이메일(Resend)', destination: 'host:api.resend.com', network: 'FIXED_EXTERNAL', dataClass: 'PHI',
    codeRefs: [{ file: `${A}modules/voucher/voucher-email.service.ts`, calls: 2 }], note: '수신 이메일·검진권 활성화 코드 — 건강서비스 이용 사실이 드러나는 개인정보' },
  { id: 'email.smtpCrm', label: 'CRM 메일(SMTP)', destination: 'config:smtp.config', network: 'CONFIGURED', dataClass: 'UNKNOWN',
    codeRefs: [{ file: `${A}modules/crm/crm-channel.service.ts`, calls: 1 }], note: '캠페인 본문은 관리자 작성 — nodemailer 미설치라 현재는 발송되지 않는다(outbound-channel 정본)' },
  { id: 'homepage.revalidate', label: '공개 홈페이지 캐시 갱신·최신성 확인', destination: 'env:HOMEPAGE_PUBLIC_URL', network: 'CONFIGURED', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/hospital-info/hospital-info.service.ts`, calls: 3 }], note: '기본 https://hospital.example.org · 경로 목록·빌드 스탬프·소스 커밋(build-source.txt)' },
  { id: 'public.holiday', label: '공휴일 공공 API', destination: 'host:apis.data.go.kr', network: 'FIXED_EXTERNAL', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/holiday/holiday.service.ts`, calls: 1 }], note: '연·월 파라미터만' },
  { id: 'public.fxBok', label: '환율 공공 API(한국은행)', destination: 'host:ecos.bok.or.kr', network: 'FIXED_EXTERNAL', dataClass: 'NON_PHI',
    codeRefs: [{ file: `${A}modules/voucher/voucher-fx.service.ts`, calls: 1 }], note: '통화·기간 파라미터만' },
];

/**
 * 검토 필요도 파생 — 🔴 저장하지 않고 **규칙으로만** 만든다(두 곳에 적으면 갈라진다).
 *  UNKNOWN 은 어떤 경우에도 none 으로 접히지 않는다.
 */
export function egressCrossBorderRiskOf(r: Pick<EgressRoute, 'network' | 'dataClass'>): EgressCrossBorderRisk {
  if (r.dataClass === 'UNKNOWN') return 'unknown';
  if (r.dataClass === 'PHI' || r.dataClass === 'PSEUDONYMOUS') return 'review';
  return 'none';
}

export const EGRESS_ROUTES: readonly (EgressRoute & { crossBorderRisk: EgressCrossBorderRisk })[] =
  RAW_ROUTES.map((r) => ({ ...r, crossBorderRisk: egressCrossBorderRiskOf(r) }));

export interface EgressSummary {
  total: number;
  review: number;
  unknown: number;
  none: number;
  internal: number;
  /** 🔴 원외 확정(고정 공개 호스트) 경로 중 검토 대상 + 불명(불명을 빼면 덜 안전하게 말한다) */
  fixedExternalReview: number;
  /** 국가 프로파일이 정해지기 전이라 허용/금지를 판정하지 않았다는 사실 */
  verdict: null;
}

/** 분모와 함께 말한다 — 불명을 0 으로 접지 않는다 */
export function egressSummary(routes: readonly (EgressRoute & { crossBorderRisk: EgressCrossBorderRisk })[] = EGRESS_ROUTES): EgressSummary {
  const count = (k: EgressCrossBorderRisk) => routes.filter((r) => r.crossBorderRisk === k).length;
  return {
    total: routes.length,
    review: count('review'),
    unknown: count('unknown'),
    none: count('none'),
    internal: count('internal'),
    fixedExternalReview: routes.filter((r) => r.network === 'FIXED_EXTERNAL' && r.crossBorderRisk !== 'none').length,
    verdict: null,
  };
}
