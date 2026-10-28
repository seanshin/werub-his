import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LATERALITY_REQUIRED_KEYWORDS } from '../../common/laterality-keywords';
import { AI_SKILL_ACTION_DEFAULT, AI_SKILL_MIN_CALLS_DEFAULT } from '../../common/ai-skill-quality';
import { DOCTOR_SIGN_REQUIRED_CONSENT_TYPES } from '../../common/consent-types';
// 중환자 병동 판정 패턴 정본 — 기본값을 여기 다시 적으면 코드 폴백과 갈라진다(순수 상수 파일이라 순환 없음)
import { DEFAULT_ICU_WARD_PATTERNS } from '../order/care-context';
// 의무기록 발급 수수료 기본표 — 설명에 실제 금액을 적기 위해(값은 null=미설정 유지)
import { DEFAULT_FEE_RULES } from '../medical-record-issuance/fee-rules';
import { AI_DEFAULT_DISCLAIMER, NUMERIC_POLICIES, isDevSeedConfigLabel, type ConfigSource } from '@hospital-run/shared';

import { configEnvOverride } from '../../common/config-env-overrides';
// 병원 정체(hospital.*) DB 행 전용 판독 — 순수 파일이라 순환 없음(DEFAULTS 플레이스홀더로 떨어지지 않게 하는 정본)
import {
  HOSPITAL_CONTEXT_KEYS, readHospitalConfig, readHospitalFacts, hospitalHoursLines, formatHospitalContextWith,
  type HospitalContextKey, type HospitalFacts,
} from './hospital-facts';

export interface ConfigEntry {
  key: string;
  value: unknown;
  description: string;
  category: string;
}

/**
 * 목록 응답 한 줄 — `ConfigEntry` 에 **출처**를 더한 것.
 *
 * 🔴 `value` 만 내려주면 화면은 "설정됨"과 "기본값으로 떨어짐"을 구분할 수 없다.
 *    ERP 진단이 실제로 여기서 막혔다(shared `ConfigSource` 주석).
 * 🔴 `registered:false` 는 **DEFAULTS 미등재인데 DB 행이 있는** 키다 — 종전엔 목록에서
 *    통째로 빠져 되돌릴 방법이 없었다.
 */
export interface ConfigListEntry extends ConfigEntry {
  source: ConfigSource;
  registered: boolean;
  /** 개발 시드가 넣은 행(label 표식 · 2026-10-27) — 원내가 정한 값이 아니다 · 시드 행일 때만 싣는다 */
  seeded?: true;
}

/** 설정 행 label 칸 길이(VarChar 200) */
const CONFIG_LABEL_MAX = 200;
export const configLabel = (text: string) => (text.length > CONFIG_LABEL_MAX ? text.slice(0, CONFIG_LABEL_MAX) : text);

// 기본값 정의
/** 🔴 설정 키 정본 — 다른 모듈이 "이 키가 실재하는가"를 기계로 대조할 수 있게 내보낸다 */

export const DEFAULTS: Record<string, ConfigEntry> = {
  // ── 화면 표시(UX) 공통 단위 — FE 공통컴포넌트(KDate·Money·PatientName·usePollInterval)가 소비. 전 직원 읽기 가능(비시크릿)
  'ui.dateStyle': { key: 'ui.dateStyle', value: 'dash', description: '날짜 표기 — dash(2026-07-23) | ko(2026. 7. 23.) — 전 화면 KDate 공통컴포넌트에 적용', category: 'ui' },
  'ui.time24h': { key: 'ui.time24h', value: true, description: '시간 24시간제 — true(14:30) | false(오후 2:30)', category: 'ui' },
  'ui.currencyStyle': { key: 'ui.currencyStyle', value: 'won', description: "금액 표기 — won(1,234원) | symbol(₩1,234) — Money 공통컴포넌트에 적용", category: 'ui' },
  'ui.patientNameMasking': { key: 'ui.patientNameMasking', value: 'OFF', description: '공용 화면(보드·대기열 등 maskable 표시)의 환자명 마스킹 — OFF(홍길동) | PARTIAL(홍*동). 차트 등 임상 화면은 항상 실명', category: 'ui' },
  'ui.poll.fastMs': { key: 'ui.poll.fastMs', value: 10000, description: '목록 폴링 주기(빠름·ms) — 실시간성 화면(보드·대기열). 기본 10000', category: 'ui' },
  'ui.poll.normalMs': { key: 'ui.poll.normalMs', value: 30000, description: '목록 폴링 주기(보통·ms) — 일반 목록. 기본 30000', category: 'ui' },
  'ui.poll.slowMs': { key: 'ui.poll.slowMs', value: 60000, description: '목록 폴링 주기(느림·ms) — 통계·집계 화면. 기본 60000', category: 'ui' },
  // ── 접근성(임상 UX 규약 §4.6 "색만으로 말하지 않는다"·야간 근무 조도) ──
  // 🔴 기본값은 **현행 유지**다(1.0 · NORMAL · false) — 켜기 전까지 화면은 픽셀 단위로 지금과 같다.
  //    값은 간호부·환자안전위원회가 정한다. 종전엔 키 자체가 없어 **정할 대상조차 없었다** —
  //    개발이 하는 일은 여기까지(키+배선), 기본값을 개발자가 바꿔 현장 공지 없이 임상 화면을 바꾸지 않는다.
  //    소비: web `lib/ui-settings`(parseUiSettings·a11yRootAttrs) → root data 속성 → globals.css.
  'ui.a11y.textScale': { key: 'ui.a11y.textScale', value: 1.0, description: '본문 글자 배율 — 야간 근무·저시력 대비 본문 배율 · 1.0=현행(변화 없음). 채택 범위 0.9~1.6 — 그 밖의 수·비수치는 미채택하고 기본값(1.0) 유지', category: 'ui' },
  'ui.a11y.contrast': { key: 'ui.a11y.contrast', value: 'NORMAL', description: '본문 대비 — NORMAL(현행) | HIGH=본문 대비 강화(회색조 어둡게). 그 외 문자열은 미채택하고 NORMAL 유지. 순수 흑백 극단은 쓰지 않는다(§4.6 야간 조도)', category: 'ui' },
  'ui.a11y.statusShape': { key: 'ui.a11y.statusShape', value: false, description: '상태를 색 외에 **모양/기호로도** 표시(색각 이상·야간 조도) — 색만으로 말하지 않는다. 기본 false=현행. boolean 이 아닌 값(문자열 "true" 등)은 미채택', category: 'ui' },
  // 🔴 개원 절차·거버넌스가 나라마다 다르다(개원 단계 화면이 이 값으로 항목을 거른다).
  //    미설정이면 KR 로 보되 화면이 "기본값"임을 밝힌다 — 조용히 두면 다른 나라 기관이 자기 항목을 못 본다.
  'hospital.country': { key: 'hospital.country', value: 'KR', description: '기관 소재 국가 — KR(대한민국)·AE(UAE). 개원·운영 단계 항목을 이 값으로 거른다. 🔴 UAE 는 관할이 에미리트별로 다르다(DHA·DoH·MOHAP)', category: 'general' },
  // UI 크롬 기본 언어(기관) — 개인 미설정 직원의 화면 언어. 국가에서 파생 '제안'만(확정은 기관). 기획 ui-locale-i18n
  'hospital.defaultUiLocale': { key: 'hospital.defaultUiLocale', value: 'ko', description: '기관 기본 화면 언어(ko/en/ja/ar) — 직원 개인 설정이 우선. 표시만 바꾼다(기록·인쇄 불변)', category: 'general' },
  // 🔴 코드(`i18n-review.service.ts`)가 읽는데 DEFAULTS 에 없어 **관리 화면에 뜨지 않던** 키다(2026-09-09 실측).
  //    그래서 언어별 검수자를 지정할 방법이 아무 데도 없었고, 쓰기 주체가 ADMIN 하나로 고착돼 있었다
  //    — 이 저장소가 이미 두 번 겪은 유형(위 주석 참조: "코드가 읽는데 DEFAULTS 에 없어" 게이트들).
  //    🔴 DEFAULTS 등재는 **DB 행을 만들지 않는다** — 빈 객체가 기본이고, 지정 전까지는 ADMIN 만 쓸 수 있다.
  'i18n.reviewers': { key: 'i18n.reviewers', value: {}, description: '언어팩 검수자 — 언어코드 → userId 배열 맵(예: {"en":["<uuid>"],"ja":[]}). 지정된 사용자는 비관리자여도 그 언어의 제안·승인·반려가 가능하다. 미지정이면 ADMIN 만 가능. 검수 화면 /admin/ui-locale/review', category: 'general' },
  'hospital.name': { key: 'hospital.name', value: 'Hospital RUN 병원', description: '병원 이름', category: 'general' },
  'hospital.code': { key: 'hospital.code', value: '12345678', description: '요양기관 기호 — ⚠️현재 값은 개발 모드 플레이스홀더(시드). 실 서비스 개원 시 원무가 실 기호로 확정(go-live data.hospitalInfo 추적)', category: 'general' },
  'hospital.bizNo': { key: 'hospital.bizNo', value: '', description: '사업자등록번호 (영수증) — 개발 모드 공란(시드). 실 서비스 시 원무 입력 확정', category: 'general' },
  'hospital.ceo': { key: 'hospital.ceo', value: '', description: '대표자(의료기관의 장) 성명 (영수증 서명) — 개발 모드 공란(시드). 실 서비스 시 원무 입력 확정', category: 'general' },
  'hospital.license': { key: 'hospital.license', value: '', description: '요양기관 면허/허가번호 (영수증)', category: 'general' },
  'hospital.ceoSignatureKey': { key: 'hospital.ceoSignatureKey', value: '', description: '의료기관장 서명 이미지 키 (영수증 날인)', category: 'general' },
  'hospital.phone': { key: 'hospital.phone', value: '02-1234-5678', description: '대표 전화', category: 'general' },
  'hospital.nameEn': { key: 'hospital.nameEn', value: '', description: '기관 영문명 (외국인 영문 증명서·대외문서). 미설정 시 국문명 사용', category: 'general' },
  'hospital.addressEn': { key: 'hospital.addressEn', value: '', description: '기관 영문 주소 (외국인 영문 증명서)', category: 'general' },
  'hospital.address': { key: 'hospital.address', value: '서울시 강남구', description: '병원 주소', category: 'general' },
  'hospital.city': { key: 'hospital.city', value: '서울', description: '병원 소재 도시 (날씨/위치)', category: 'general' },
  'hospital.hours.weekday': { key: 'hospital.hours.weekday', value: '09:00~18:00', description: '평일 진료시간', category: 'general' },
  'hospital.hours.saturday': { key: 'hospital.hours.saturday', value: '09:00~13:00', description: '토요일 진료시간', category: 'general' },
  'hospital.hours.lunch': { key: 'hospital.hours.lunch', value: '12:30~14:00', description: '점심시간', category: 'general' },
  'hospital.hours.closed': { key: 'hospital.hours.closed', value: '일요일, 공휴일', description: '휴진일', category: 'general' },
  'hospital.emergency': { key: 'hospital.emergency', value: '24시간', description: '응급실 운영', category: 'general' },
  // AI 설정
  'ai.greeting.enabled': { key: 'ai.greeting.enabled', value: true, description: 'AI 날씨 인사 활성화', category: 'ai' },
  'ai.model': { key: 'ai.model', value: 'qwen2.5:14b', description: 'AI 기본 모델', category: 'ai' },
  'ai.temperature': { key: 'ai.temperature', value: 0.7, description: 'AI 응답 창의성 (0~1)', category: 'ai' },
  'ai.maxTokens': { key: 'ai.maxTokens', value: 300, description: 'AI 최대 응답 길이', category: 'ai' },
  // 🔴 2026-08-19 정책 결정(운영): **인간에게 정보를 전달하는 것이 최선.**
  //    종전 문구는 브랜드명("WeRU.B")만 쓰고 "AI"라는 단어가 없었다 — 설계 원칙이
  //    "AI 단독 라벨 금지"(f7-pharmacy-review §6.5)라 의도적이었으나, AI기본법 §31 은
  //    이용자가 **AI 산출물임을 알 수 있게** 하는 것을 요구한다. 브랜드는 그 사실을 가린다.
  //    → 브랜드와 "AI"를 **병기**한다(브랜드를 지우지 않고, AI 라는 사실을 숨기지도 않는다).
  'ai.disclaimer': { key: 'ai.disclaimer', value: AI_DEFAULT_DISCLAIMER, description: 'AI 면책 조항(합성형 AI 응답 disclaimer 필드로 자동 동봉). 🔴 "AI" 표기는 AI기본법 §31 — 브랜드명만으로 대체하지 않는다', category: 'ai' },
  'ai.server.url': { key: 'ai.server.url', value: 'https://example.org/ollama', description: 'AI 서버 URL', category: 'ai' },
  'ai.server.apiKey': { key: 'ai.server.apiKey', value: '', description: 'AI 서버 API 키 (X-Medical-Key) — DB/env 설정, 코드 하드코딩 금지', category: 'ai' },
  'ai.server.gpuKey': { key: 'ai.server.gpuKey', value: '', description: 'GPU API 키 (선택, LLM 전용)', category: 'ai' },
  'ai.server.enabled': { key: 'ai.server.enabled', value: true, description: 'AI 기능 활성화', category: 'ai' },
  'ai.brief.batch.enabled': { key: 'ai.brief.batch.enabled', value: false, description: '환자 AI 브리핑 야간 배치(다음날 예약+재원 · 결정론·LLM 없음) — 기본 OFF. 진료 진입 시 lazy 계산은 항상 동작', category: 'ai' },
  'ai.brief.concurrency': { key: 'ai.brief.concurrency', value: 3, description: '브리핑 야간 배치 동시성(예산)', category: 'ai' },
  // 🔴 배치 B — 야간에 LLM 을 불러 검사해석을 미리 만든다(PHI 가 AI 서버로 나간다). 기본 OFF · 켜기 전 폐쇄망/위탁 결정·PHI 최소 전송 확인(기획서 §5 P1 게이트)
  'ai.brief.llm.enabled': { key: 'ai.brief.llm.enabled', value: false, description: '환자 AI 브리핑 배치 B(야간 LLM 사전 스킬 — 검사해석) ON 여부 — 기본 OFF. 배치 A(ai.brief.batch.enabled) 가 ON 일 때만 동작. 검사 결과가 있는 환자만 · 검증층 통과분만 저장 · PHI 가 AI 서버로 전송됨', category: 'ai' },
  'ai.brief.patientBudgetSec': { key: 'ai.brief.patientBudgetSec', value: 60, description: '배치 B 환자당 LLM 시간 예산(초) — 초과분은 미계산으로 적고 야간 로그에 셈한다', category: 'ai' },
  'ai.server.timeout': { key: 'ai.server.timeout', value: 30000, description: 'AI 요청 타임아웃 (ms)', category: 'ai' },
  // ── 진료 보조 스킬 품질 임계(기획서 chart-ai-assistant-agent §4.6·§6-1 사람 게이트를 화면으로 내린 것)
  //    🔴 기본이 **미설정 · 전부 OFF** 인 이유: 임계는 위원회(AI팀·진료부)가 **과거 실측**에서 정하는 값이다.
  //       개발자가 감으로 0.5 를 박고 경보를 울리면 그 경보는 거짓 경보가 되고, 거짓 경보는 진짜 경보를 죽인다.
  //       화면(/admin/ai-settings)이 실측치를 분모와 함께 보여주고, 위원회가 값을 넣으면 그때부터 판정한다.
  //    소비: MedicalAiService.skillQuality → GET /api/v1/ai/skill-quality
  'ai.skill.quality.minAiRate': { key: 'ai.skill.quality.minAiRate', value: {}, description: '진료 보조 스킬 최소 AI 통과율 — 스킬별 0~1 맵(예 {"recommendDrugs":0.5}). 🔴 기본 **빈 맵=미설정**(임계는 위원회가 과거 실측에서 정한다). 키: realtimeDdx·autoSoap·interpretLab·recommendDrugs — 그 외 키·형식 위반은 무시', category: 'ai' },
  'ai.skill.quality.minCalls': { key: 'ai.skill.quality.minCalls', value: { ...AI_SKILL_MIN_CALLS_DEFAULT }, description: '스킬 품질 판정 최소 표본(호출 N) 맵 — 기본 전부 20. 🔴 이 수 미만이면 판정 보류(표본 부족으로는 탭을 내리지 않는다). 스칼라를 넣으면 무시되고 기본 맵이 유지된다', category: 'ai' },
  'ai.skill.quality.action': { key: 'ai.skill.quality.action', value: { ...AI_SKILL_ACTION_DEFAULT }, description: '스킬 품질 임계 미달 시 조치 — 스킬별 OFF|WARN|BLOCK 맵(기본 전부 OFF). WARN=화면 경고 · BLOCK=탭에서 내림. 미설정 스킬=OFF', category: 'ai' },
  'ai.skill.quality.maxUnresolvedDrugRatio': { key: 'ai.skill.quality.maxUnresolvedDrugRatio', value: 0.5, description: '약물추천 검증층 DRUGS_RESOLVABLE 임계 — 약가마스터 미매칭(resolution=NONE) 추천 비율이 이 값을 넘으면 FALLBACK(존재하지 않는 약을 AI 로 내보내지 않는다). 0 초과 1 이하 · 0/비수치는 미채택(기본 0.5 유지)', category: 'ai' },
  // 🔴 상담실 AI 자동응답 — **기본 OFF**. 켜면 LLM 답변이 사람 검토 없이 환자에게 즉시 전송된다.
  //    (종전엔 게이트 자체가 없었고 세션이 AUTO 로 태어났다. 규약: modules/consult/consult-ai-gate.ts)
  'consult.ai.autoReply': { key: 'consult.ai.autoReply', value: false, description: '상담실 AI 자동응답(AUTO) 허용 — 기본 OFF. OFF 면 AI 는 초안(SUGGEST)만 만들고 직원이 검토 후 전송한다. ON 으로 바꾸면 사람 검토 없이 환자에게 전송된다', category: 'ai' },
  // ── VoiceEMR(음성 구동 EMR) — 기본 OFF·파일럿 게이트 ──
  'voiceEmr.enabled': { key: 'voiceEmr.enabled', value: false, description: 'VoiceEMR 마스터 활성화 (기본 OFF)', category: 'ai' },
  'voiceEmr.pilotUserIds': { key: 'voiceEmr.pilotUserIds', value: [], description: 'VoiceEMR 파일럿 사용자 ID(빈 배열=전체·["*"]=전체·목록=한정)', category: 'ai' },
  'voiceEmr.write.enabled': { key: 'voiceEmr.write.enabled', value: false, description: 'T1 활력/수치 음성입력 (기본 OFF)', category: 'ai' },
  'voiceEmr.dictate.enabled': { key: 'voiceEmr.dictate.enabled', value: false, description: 'T2 SOAP/간호 구술 (기본 OFF·GPU 후)', category: 'ai' },
  'voiceEmr.order.enabled': { key: 'voiceEmr.order.enabled', value: false, description: 'T3 음성 오더 (기본 OFF·임상 승인 후)', category: 'ai' },
  'voiceEmr.ambient.enabled': { key: 'voiceEmr.ambient.enabled', value: false, description: '앰비언트 대화 기록(라이브 전사 스트림·기본 OFF)', category: 'ai' },
  'voiceEmr.ambient.silenceFinalizeMs': { key: 'voiceEmr.ambient.silenceFinalizeMs', value: 1200, description: '대화 발화 경계 — 무성 지속(ms) 시 조기 확정', category: 'ai' },
  'voiceEmr.ambient.confidenceFloor': { key: 'voiceEmr.ambient.confidenceFloor', value: 0.5, description: '대화 분석 신뢰도 하한(미달 발화는 SOAP 분석 제외)', category: 'ai' },
  'voiceEmr.ambient.aiDraft.enabled': { key: 'voiceEmr.ambient.aiDraft.enabled', value: false, description: '대화 전체 분석 AI 경로(기본 OFF=규칙 제안만)', category: 'ai' },
  'voiceEmr.stt.chunkMs': { key: 'voiceEmr.stt.chunkMs', value: 1500, description: 'STT 청크 주기(ms·하한 1500)', category: 'ai' },
  'voiceEmr.stt.confHold': { key: 'voiceEmr.stt.confHold', value: 0.5, description: 'STT 신뢰도 보류 임계(미만 보류)', category: 'ai' },
  // Phase 1 성문(B2) 게이트 — WeRU.B /api/speaker/* 계약 확정 후 활성. 미가용 시 fail-open(마이크 분리 신뢰).
  'voiceEmr.speaker.enabled': { key: 'voiceEmr.speaker.enabled', value: false, description: 'V4 화자 게이트(내 음성만 명령·기본 OFF·성문 계약 후)', category: 'ai' },
  'voiceEmr.speaker.threshold': { key: 'voiceEmr.speaker.threshold', value: 0.7, description: '성문 대조 임계 τ(isOwner=score≥τ)', category: 'ai' },
  'scribe.speaker.enabled': { key: 'scribe.speaker.enabled', value: false, description: 'S2 화자 귀속(세그먼트 의사/환자·기본 OFF·성문 계약 후)', category: 'ai' },
  // 앰비언트 진료 스크라이브(녹음→전사→SOAP 초안) — 기본 OFF(무중단·점진 옵트인)
  'scribe.enabled': { key: 'scribe.enabled', value: false, description: '앰비언트 진료 스크라이브 활성화 (기본 OFF)', category: 'ai' },
  'scribe.audio.retention': { key: 'scribe.audio.retention', value: 'transcribed', description: '원음 파기 정책 (transcribed=전사 후 파기 | keep=보존)', category: 'ai' },
  'scribe.audio.encryptAtRest': { key: 'scribe.audio.encryptAtRest', value: false, description: '오디오 저장 시 암호화(ENCRYPTION_KEY) 여부', category: 'ai' },
  'scribe.transcript.retention': { key: 'scribe.transcript.retention', value: 90, description: '전사 텍스트 보존기간(일)', category: 'ai' },
  'scribe.pilotUserIds': { key: 'scribe.pilotUserIds', value: [], description: '스크라이브 파일럿 의사(userId) — 비면 전체(게이트 ON일 때)', category: 'ai' },
  'scribe.transcription.enabled': { key: 'scribe.transcription.enabled', value: false, description: '전사(오디오→WeRU.B STT) 활성화 — 기본 OFF. 개발=WeRU.B S3 경유 허용, 운영=내부 스토리지(HIS 서명URL fetch·D-9)로 전환', category: 'ai' },
  'scribe.audio.maxUploadMb': { key: 'scribe.audio.maxUploadMb', value: 10, description: '오디오 base64 업로드 상한(MB) — 서버 json 15mb 정합. 녹음은 32kbps라 10MB≈40분. 초과 진료는 P1 청크', category: 'ai' },
  // ══ 운영 모드 — 개발 / 리허설 / 리얼 (정본 shared `his-mode.ts`) ══
  // 🔴 이것은 **런타임 토글**이다. 빌드 상한(`HIS_MODE` 환경변수)보다 넓힐 수 없다 —
  //    리얼 빌드에는 시드 로그인 모듈이 아예 없어 런타임으로 되살아나지 않는다.
  //    기본값을 REAL 로 두지 않는 이유: 미설정(=null)이면 **빌드 모드를 그대로 쓴다**.
  //    여기에 REAL 을 박아두면 리허설 빌드가 항상 REAL 로 좁혀져 검수를 못 한다.
  'mode.current': { key: 'mode.current', value: null, description: '운영 모드 런타임 토글 (DEV·REHEARSAL·REAL · 비우면 배포 시 정해진 빌드 모드를 따른다 · 빌드보다 넓힐 수 없다)', category: 'mode' },

  // 진료
  'appointment.defaultDuration': { key: 'appointment.defaultDuration', value: 30, description: '기본 진료 시간(분)', category: 'clinical' },
  'appointment.workingHours': { key: 'appointment.workingHours', value: { start: '09:00', end: '18:00' }, description: '진료 시간', category: 'clinical' },
  // 🔴 종전엔 이 3키가 DEFAULTS 에 없어 **관리 화면에 아예 뜨지 않았다** — 기능(autoNoShowSweep)은
  //    있는데 켤 방법이 화면에 없어 지난 예약이 SCHEDULED 로 쌓였다(2026-08-03 실측 118건).
  'schedule.grid.dnd': { key: 'schedule.grid.dnd', value: false, description: '예약 일 뷰(시간 그리드) 드래그 이동 — 기본 OFF(기획 schedule-timegrid §7 P3 게이트). 끄면 블록 끌기 대신 상세에서 시간 변경. 켜도 서버 reschedule 검증·권한은 그대로', category: 'clinical' },
  'appointment.autoNoShow': { key: 'appointment.autoNoShow', value: false, description: '예약 자동 노쇼 전환 — 예정 시각+유예가 지나도 미접수면 NO_SHOW(10분마다). 기본 OFF', category: 'clinical' },
  'appointment.autoNoShow.graceMinutes': { key: 'appointment.autoNoShow.graceMinutes', value: 30, description: '자동 노쇼 유예(분) — 예정 시각에서 이만큼 지나야 전환. 0=유예 없음', category: 'clinical' },
  'appointment.autoNoShow.lookbackHours': { key: 'appointment.autoNoShow.lookbackHours', value: 24, description: '자동 노쇼가 되돌아보는 창(시간) — 기본 24. **0=제한 없음**(과거 누적분 일괄 정리용). 과거 대량 전환을 막으려는 안전장치라 평시엔 24 유지', category: 'clinical' },
  'clinical.queue.waitWarningMinutes': { key: 'clinical.queue.waitWarningMinutes', value: 20, description: '대기 시간 경고 기준(분)', category: 'clinical' },
  'clinical.queue.maxWaitMinutes': { key: 'clinical.queue.maxWaitMinutes', value: 60, description: '최대 허용 대기 시간(분)', category: 'clinical' },
  'clinical.queue.avgConsultMinutes': { key: 'clinical.queue.avgConsultMinutes', value: 8, description: '평균 진료 시간(분, 대기 예측용)', category: 'clinical' },
  'clinical.encounter.defaultType': { key: 'clinical.encounter.defaultType', value: 'OUTPATIENT', description: '기본 진료 유형 (OUTPATIENT|INPATIENT|EMERGENCY)', category: 'clinical' },
  // 🔴 아래 8키는 **코드가 읽는데 DEFAULTS 에 없어 관리 화면에 뜨지 않던** 게이트들이다(2026-08-03 전수 확인).
  //    기능은 다 있는데 화면에서 켜고 끌 수 없어 사실상 잠겨 있었다. 값 의미는 각 호출부 실측으로 확인함.
  'encounter.requireDiagnosisOnSign': { key: 'encounter.requireDiagnosisOnSign', value: 'WARN', description: '진료 서명 시 상병(진단) 필수 — OFF/WARN/BLOCK(기본 WARN). 서명은 청구 트리거라 상병이 없으면 심사 삭감·반려 위험. WARN=경고만·BLOCK=서명 차단', category: 'clinical' },
  'encounter.draftReminder.afterHours': { key: 'encounter.draftReminder.afterHours', value: 0, description: '처방 달린 미서명(DRAFT) 차트 회수 알림 기준(시간) — 0=OFF(기본). 예 24=하루 지난 미서명 차트를 담당의에게 매일 08시 알림. 서명 전엔 기록 미완결·수납/청구 정지', category: 'clinical' },
  'encounter.draftReminder.repeatDays': { key: 'encounter.draftReminder.repeatDays', value: 3, description: '미서명 차트 재알림 간격(일) — 같은 진료 알림을 이 간격으로 억제(매일 쏘면 알림 무시가 학습된다)', category: 'clinical' },
  'nursing.handoff.remindAfterHours': { key: 'nursing.handoff.remindAfterHours', value: 0, description: '미확인 인수인계 재알림 기준(시간) — 0=OFF(기본). 예 2=등록 2시간 미확인이면 인수자에게 매시 확인·같은 건은 이 간격으로 재알림. 최초 알림을 놓친 인계가 묻히는 것 방지', category: 'clinical' },
  // 🔴 (2026-10-10) 배설 기록 공백 표시 기준(시간) — 원내 규정. 기본 null = 미설정 → 화면은 "마지막 배설 기록 이후 N시간"(사실)만 말하고 경고하지 않는다.
  'nursing.io.noOutputAlertHours': { key: 'nursing.io.noOutputAlertHours', value: null, description: '배설 기록 공백 표시 기준(시간·1~48 정수) — 마지막 배설(양 > 0) 기록 이후 이 시간이 지나면 I/O 수지 화면이 강조한다. 미설정이면 경과 시간만 보이고 강조하지 않는다(막지 않는다)', category: 'clinical' },
  'nursing.lateEntry.graceMinutes': { key: 'nursing.lateEntry.graceMinutes', value: null, description: '늦은 기록 유예(분·0~720 정수) — 관찰 시각의 근무조가 끝난 뒤 이 시간 안에 쓴 간호기록은 늦은 기록으로 표시하지 않는다. 비우면 **미설정**(유예 0 = 근무조 종료 시각 기준으로 판정하고 화면이 "원내 규정 미설정"이라 밝힌다). 범위 밖·비수치는 미설정으로 본다. 표시만 바꾼다(기록을 막지 않는다)', category: 'clinical' },
  'nursing.shift.boundaries': { key: 'nursing.shift.boundaries', value: { day: 7, evening: 15, night: 23 }, description: '간호 교대 시작 시각 {day,evening,night}(0-23·오름차순) — 기록 shiftType 자동 판정·교대 필터가 사용. 형식이 어긋나면 기본(7/15/23)으로 동작', category: 'clinical' },
  'clinical.prescriptionRequiresOpenEncounter': { key: 'clinical.prescriptionRequiresOpenEncounter', value: false, description: '서명된 진료기록에 처방 추가 금지(옵트인) — true 면 정정(amend) 후에만 추가 가능', category: 'clinical' },
  'clinical.requireResignAfterAmend': { key: 'clinical.requireResignAfterAmend', value: false, description: '정정(AMENDED) 후 재서명 필수 — true 면 프로토콜 품질 규칙에서 AMENDED 를 미완료로 본다', category: 'clinical' },
  'queue.completeRequiresSign': { key: 'queue.completeRequiresSign', value: true, description: '대기 완료 처리 전 진료기록 서명 필수(기본 ON) — DRAFT 진료를 남긴 채 완료되는 것을 막는다', category: 'clinical' },
  // ── 2인 확인(4-eyes) 게이트 2종 — 2026-08-27 등재 ────────────────────────
  // 🔴 두 키는 **코드가 읽는데 DEFAULTS 에 없어** 관리 화면에 뜨지도, 쓰기 경로로 켜지지도 않았다.
  //    (둘 다 `prisma.systemConfig.findUnique` 로 직접 읽어서 v4.x 의 `get()` 스캔 가드에도 안 걸렸다.)
  //    안전 게이트를 **켤 방법이 없다**는 것 자체가 결함이라 등재한다.
  // 🔴 값은 **지금 코드가 행 없음일 때 떨어지는 값 그대로**다 — 등재로 동작이 바뀌면 안 된다.
  //    (DEFAULTS 등재는 DB 행을 만들지 않으므로, 직접 읽는 두 소비처의 폴백은 그대로 유지된다.
  //     즉 `clinical.verificationFourEyes` 의 `fourEyesSource` 는 여전히 'default' 다.)
  'clinical.verificationFourEyes': { key: 'clinical.verificationFourEyes', value: true, description: '임상차트(가이드라인) 검수 2인 승인(4-eyes) — **기본 true=ON**. 코드 폴백(설정 행 없음)이 on 이라 같은 값으로 등재했다. ON 이면 서로 다른 검수자 2인이 승인해야 「검증됨」이 된다(1인 승인은 IN_REVIEW 유지·자가 2차 승인은 서버가 거부). 끄려면 여기서 false 로 명시해야 한다 = 끈 사람이 남는다. `{"enabled":true}` 형태도 ON 으로 읽는다', category: 'clinical' },
  'checkup.explainerFourEyes': { key: 'checkup.explainerFourEyes', value: false, description: '검진 결과 해설(설명문) 감수 2인 승인(4-eyes) — **기본 false=OFF**(코드 폴백과 같은 값. 임의로 켜지 않는다). ON 이면 같은 본문 해시에 대해 서로 다른 감수자 2인이 승인해야 APPROVED 가 되고, 1인 승인은 IN_REVIEW(2차 대기)로 남는다. true 또는 `{"enabled":true}` 로 켠다', category: 'clinical' },
  // 🔴 중환자 병동은 Ward 에 유형 필드가 없어 **이름으로 판정**한다(order/care-context.ts).
  //    기본값은 코드 폴백 `DEFAULT_ICU_WARD_PATTERNS` 를 그대로 가져온다 — 두 곳에 적으면 갈라진다.
  'ward.icuNames': { key: 'ward.icuNames', value: DEFAULT_ICU_WARD_PATTERNS, description: '중환자 병동 이름 판정 패턴(문자열 배열·대소문자 무시 부분일치) — 오더 화면의 진료 맥락(중환자/응급/입원/외래)과 야간 당직 처리대상 판정에 쓰인다. 운영 병동명이 기본 목록과 다르면 여기서 덮어쓴다. **빈 배열·비배열은 미채택**하고 기본 목록을 유지한다', category: 'clinical' },
  // ── 급양(영양) 워크리스트 정책 — 2026-08-21 ─────────────────────────────
  // 🔴 기준값은 **원내 정책**이다. 미설정이면 화면이 "원내 정책 미확정 · 기본값 기준"이라 밝힌다
  //    (기본값을 정책인 척하지 않는다). 급양사 워크리스트가 이 값으로 대상을 뽑는다.
  'nutrition.screeningWithinHours': { key: 'nutrition.screeningWithinHours', value: 48, description: '입원 후 영양 스크리닝 기한(시간) — 지나면 급양사 워크리스트에서 기한 초과로 표시(인증 기준 연계)', category: 'clinical' },
  'nutrition.reassessDays': { key: 'nutrition.reassessDays', value: 7, description: '영양 재평가 주기(일) — 마지막 평가가 이 일수를 넘긴 재원 환자를 재평가 대상으로 표시', category: 'clinical' },
  'inpatient.dischargeGate': { key: 'inpatient.dischargeGate', value: false, description: '퇴원 전 퇴원요약 서명 필수 — true 면 미작성·DRAFT 요약이면 퇴원 차단(전원 TRANSFER 은 지연이 더 위험해 미적용)', category: 'clinical' },
  // 🔴 입원 시 낙상·욕창 재평가 스케줄 자동 생성. 기본 OFF 인 이유는 기능 미완성이 아니라
  //    주기 표(risk-reassessment.policy.ts)가 **환자안전위원회 미확정 잠정값**이기 때문이다.
  //    확정 전에 켜면 잘못된 주기로 법정기록이 쌓인다. 종료(퇴원·전원·취소) 처리는 이 키와 무관하게 항상 돈다.
  'risk.reassessment.autoCreate': { key: 'risk.reassessment.autoCreate', value: false, description: '입원 시 낙상·욕창 재평가 스케줄 자동 생성 — 기본 OFF(주기 표가 환자안전위원회 미확정 잠정값). 켜면 admission.created 마다 FALL_RISK·PRESSURE_ULCER 스케줄이 생기고 매시간 기한초과 감시가 주치의에게 통지한다', category: 'clinical' },
  // 🔴 키오스크 수납. 기본 OFF 인 이유는 기능 미완성이 아니라 **PG·VAN 연동이 없기 때문**이다.
  //    켜기 전에 실제 승인 응답을 받아 `cardApprovalNo` 를 채우는 경로가 선행돼야 한다.
  //    (2026-08-19 이전에는 게이트 없이 `KIOSK-<timestamp>` 를 승인번호로 지어내 수납을 확정하고 있었다.)
  'kiosk.payment.enabled': { key: 'kiosk.payment.enabled', value: false, description: '무인 키오스크 수납 확정 — 기본 OFF. 🔴 PG·VAN 연동이 선행돼야 켤 수 있다(승인 응답 없이 켜면 승인번호가 날조된다). OFF 여도 미납 조회·접수는 동작한다', category: 'general' },
  'nursing.bcma.enforce': { key: 'nursing.bcma.enforce', value: 'OFF', description: '투약 전 BCMA 스캔(손목밴드+약품 바코드) — OFF/WARN/BLOCK(기본 OFF). BLOCK=미스캔 투약 차단', category: 'clinical' },
  'bloodBank.bedsideScan.enforce': { key: 'bloodBank.bedsideScan.enforce', value: false, description: '수혈 전 bedside 대조 스캔(손목밴드+혈액백) 필수 — true 면 미스캔 시 시행 차단', category: 'clinical' },
  'surgery.preAnesthesiaGate': { key: 'surgery.preAnesthesiaGate', value: false, description: '수술 sign-in 전 마취전평가 완료 필수 — true 면 평가 미완료 시 sign-in 차단', category: 'clinical' },
  'clinical.encounter.followUpDays': { key: 'clinical.encounter.followUpDays', value: 14, description: '재진 기본 간격(일)', category: 'clinical' },
  'clinical.vitals.criticalAlert': { key: 'clinical.vitals.criticalAlert', value: true, description: '바이탈 위급값 자동 알림 — 명시적 false 만 통보 억제(기록·판정은 유지, 억제는 로그에 남음)', category: 'clinical' },
  'governance.enactment.enabled': { key: 'governance.enactment.enabled', value: false, description: '위원회 의결 자동 집행(CONFIG/GATE) ON/OFF — OFF=기록만(P0-b 동작)·ON=크론·수동 집행 활성', category: 'governance' },
  // 🔴 증빙 AI 판독 — **기본 OFF**. 첨부 문서가 AI 서버로 전송되므로 켜는 것이 결정이다.
  //    판독 결과는 초안이고 저장되지 않는다(사람이 확인하고 고쳐서 저장한다).
  'ai.evidenceExtract.enabled': { key: 'ai.evidenceExtract.enabled', value: false, description: '행정 증빙 문서(개설신고증·계약서 등) AI 판독 ON/OFF — 기본 OFF. ON 이면 **첨부 이미지가 AI 서버로 전송**된다. 결과는 초안이며 저장되지 않는다(사람이 확인 후 저장). PDF 는 판독하지 않는다(읽는 척하지 않는다)', category: 'ai' },
  // 🔴 위치 겹침 접촉자 후보(기획 spatial-flow-vision-3d P5 · 결정 `infection.contactCandidates`) — **기본 OFF**.
  //    켜도 후보일 뿐 확정·통보가 없다. 추정 겹침은 두 번째 설정을 따로 켜야 보인다.
  'infection.contactCandidates.enabled': { key: 'infection.contactCandidates.enabled', value: false, description: '위치 기록 겹침으로 감염 접촉자 후보 조회(관리자) ON/OFF — 기본 OFF. 후보만 보이고 확정·통보는 없다(감염관리실이 접촉자 등록)', category: 'clinical' },
  // 🔴 무선 AP 위치 수집(wifi-location.v1 · 결정 `location.wifi.collect` — 허가권자) — **기본 OFF**.
  //    켜면 수집기가 보낸 관측 중 **동의 받아 연결한 단말**만 측위·저장한다. 꺼져 있으면 수집 EP 가 503(받은 척하지 않는다).
  //    데모 시뮬레이션(출처 SIMULATED)은 이 설정과 무관하다 — REAL 모드에서 돌지 않는다.
  // 🔴 의사 할 일함 처리 기한(2026-10-10) — 원내 정책. 기본 null = 미설정 → 화면은 "늦음"을 판정하지 않고 그렇게 말한다(기본값을 정책인 척하지 않는다).
  // 🔴 서류 발급 처리 기한(2026-10-10 · 질 지표 DOC_ISSUANCE_ON_TIME) — 원내 규정. 기본 null = 미설정 → 지표는 산출 불가(신청 행의 3일 고정값을 규정인 척 쓰지 않는다)
  'qi.docIssuance.slaHours': { key: 'qi.docIssuance.slaHours', value: null, description: '서류 발급 처리 기한(시간 · 1~720 정수) — 미설정(null)이면 서류 발급 처리 기한 준수율을 산출하지 않는다', category: 'quality' },
  'doctor.inbox.dueHours': { key: 'doctor.inbox.dueHours', value: null, description: '의사 할 일함 처리 기한(시간 · 1~168 정수) — 미설정(null)이면 늦음 판정 없음. 설정하면 목록마다 가장 오래 기다린 항목이 기한을 넘었는지 표시한다(막지 않는다)', category: 'clinical' },
  'location.wifi.enabled': { key: 'location.wifi.enabled', value: false, description: '무선 AP 위치 수집 ON/OFF — 기본 OFF. ON 이면 수집기(무선 컨트롤러·태그 게이트웨이)가 보낸 관측 중 동의 받아 연결한 단말만 측위·저장한다(개인위치정보 — 결정 location.wifi.collect)', category: 'clinical' },
  // 결정 등록부 배치 10-F(2026-10-10) — 기본값 = 현행 동작 · 허용 값 정본 shared `DECIDED_SETTING_ALLOWED`(저장·집행 같은 규칙)
  'location.wifi.autoUnbindOnEnd': { key: 'location.wifi.autoUnbindOnEnd', value: false, description: '퇴원·사망으로 재원이 끝나면 그 환자의 무선 단말 연결을 자동으로 해제할지 — 기본 false(현행: 연결이 남고 관리 화면 점검 목록에 보인다 · 해제는 사람이 사유와 함께). 결정 location.wifi.autoUnbindOnEnd', category: 'integration' },
  'location.wifi.keyRotationGraceMinutes': { key: 'location.wifi.keyRotationGraceMinutes', value: null, description: '수집기 키 교체 후 이전 키를 함께 받아 주는 시간(분 · 1~1440 정수) — 미설정(null)이면 교체 즉시 이전 키 무효(현행). 결정 location.wifi.keyRotationGraceMinutes', category: 'security' },
  'documents.fee.billingLink': { key: 'documents.fee.billingLink', value: null, description: "서류 발급 수수료를 수납과 잇는 방식 — 미설정(null)이면 수수료는 접수증·발급 화면에 표시만 하고 수납 항목을 만들지 않는다(현행) · 'BILLING_ITEM' 이면 발급 때 서류가 연결된 진료의 수납 전 계산서에 비급여 줄을 한 번 더한다(진료 없는 서류·계산서 없음·수납 시작은 더하지 않음). 결정 documents.fee.billingLink", category: 'billing' },
  'nursing.reassessment.autoScheduleOnAdmission': { key: 'nursing.reassessment.autoScheduleOnAdmission', value: false, description: '입원 간호초기평가의 낙상·욕창 점수로 재평가 일정을 자동으로 만들지 — 기본 false(현행: 재평가 일정은 사람이 등록). 위원회 결정 nursing.reassessment.autoScheduleOnAdmission', category: 'clinical' },
  'nursing.initialAssessment.bradenInput': { key: 'nursing.initialAssessment.bradenInput', value: 'TOTAL', description: "간호초기평가 Braden 입력 방식 — 'TOTAL'(총점 한 칸 · 현행) · 'SUBSCORES'(하위 6항목을 고르고 총점은 합으로). 결정 nursing.initialAssessment.bradenInput", category: 'clinical' },
  'pediatrics.growth.reference': { key: 'pediatrics.growth.reference', value: null, description: "소아 성장 백분위 기준표 출처 — 미설정(null · 현행). 'WHO_2006'·'KDCA_2017' 을 골라도 기준표 데이터가 적재되기 전까지 백분위는 산출하지 않는다(입력값 거부 그대로). 결정 pediatrics.growth.reference", category: 'clinical' },
  'infection.contactCandidates.includeInferred': { key: 'infection.contactCandidates.includeInferred', value: false, description: '접촉자 후보에 추정 위치(이벤트 번역) 겹침을 별도 등급으로 포함 — 기본 OFF. 추정은 실제 위치가 아니다', category: 'clinical' },
  // 🔴 정족수 명부 게이트 — 종전에는 참석자 **배열 길이**만 셌다. 위원 0명 위원회가 의결할 수 있었다.
  //    기본 WARN: 막지 않되 원장에 남긴다(막으면 회의록이 시스템 밖으로 나간다).
  //    BLOCK 승격은 명부가 채워진 뒤 운영 판단이다.
  'governance.decisionConfigGuard': { key: 'governance.decisionConfigGuard', value: 'WARN', description: '결정에 묶인 설정을 범용 설정 화면에서 바꿀 때 — OFF(기록 안 함)|WARN(허용·결정 이력에 기록·기본)|BLOCK(실결정에 묶인 설정은 결정 경로로만). 개발 시드 결정에 묶인 설정은 막지 않는다. 결정 governance.decisionConfigGuard(운영위원회)', category: 'governance' },
  'governance.quorumRosterGate': { key: 'governance.quorumRosterGate', value: 'WARN', description: '위원회 의결 시 참석자를 **위원 명부**와 대조 — OFF|WARN|BLOCK(기본 WARN). 명부가 비었거나 참석 위원이 정족수 미만이면 위반. 참석자 신원을 못 읽는 회의는 평가하지 않는다(없는 위반을 만들지 않는다)', category: 'governance' },
  'governance.ai.enabled': { key: 'governance.ai.enabled', value: false, description: '거버넌스 안건 AI 영향 평가(브리핑) ON/OFF — Human-in-loop·판단 대체 아님. OFF=assess EP 거부. 컨텍스트는 정책 메타데이터만(PHI 미포함)', category: 'governance' },
  // 2026-08-05 드리프트 재분류 등재 — 소비 중인데 카탈로그 밖이던 실사용 키(래퍼 헬퍼 경유라 가드 사각)
  'chemo.cycleGate': { key: 'chemo.cycleGate', value: 'OFF', description: '항암 사이클 시작 nadir 랩 게이트 — OFF|WARN|BLOCK(기본 OFF). ANC·혈소판 하한 미달 시 사이클 시작 차단', category: 'clinical' },
  'chemo.gate.ancMin': { key: 'chemo.gate.ancMin', value: 1500, description: '항암 사이클 게이트 ANC 하한(/µL) — nadir 판정 기준(기본 1500)', category: 'clinical' },
  'chemo.gate.pltMin': { key: 'chemo.gate.pltMin', value: 100000, description: '항암 사이클 게이트 혈소판 하한(/µL) — nadir 판정 기준(기본 100000)', category: 'clinical' },
  // 🔴 2026-08-28: 기본값을 `true` 로 올렸다. 운영은 2026-07-22 에 이미 플립됐지만 **기본값이 false 라
  //    새 환경(개발·리허설·신규 병원)은 IDOR 차단이 꺼진 채 시작**했다. 이건 결정 사안이 아니라
  //    상시 ON 이어야 하는 보안 요구사항이다(P1-b 판정). 끄는 것이 예외이고, 끄면 그 사실이 드러나야 한다.
  //    🔴 깨질 수 있는 것: 대상 토큰을 아직 안 보내는 레거시 클라이언트는 401 이 된다 — 전환기는 끝났다.
  'erp.targetAuthEnforce': { key: 'erp.targetAuthEnforce', value: true, description: 'ERP S-3 대상별 인가 강제 — true=X-Target-Token 필수(무토큰 401·IDOR 차단). 🔴 상시 ON 요구사항(끄면 순회 가능)', category: 'integration' },
  'lis.targetAuthEnforce': { key: 'lis.targetAuthEnforce', value: true, description: 'LIS S-3 대상별 인가 강제 — true=대상 결속 토큰 필수(patientId 순회 차단). 🔴 상시 ON 요구사항', category: 'integration' },
  // 거버넌스 P3 §7 P1 표면화(2026-08-04) — 위원회 결정이 닿아야 하는데 카탈로그 밖이던 표면들
  'formulary.enforce': { key: 'formulary.enforce', value: {}, description: '원내 처방집 시행 게이트 — 영역별 OFF|WARN|BLOCK 맵(MEDICATION·LAB·IMAGING·THERAPY·DIET·ACTIVITY·NURSING). 예 {"MEDICATION":"WARN"}. 미설정 영역=OFF. 편집: /admin/formulary 정책 탭', category: 'formulary' },
  'qi.targets.doorToTriage': { key: 'qi.targets.doorToTriage', value: { LEVEL_1: 1, LEVEL_2: 10, LEVEL_3: 30, LEVEL_4: 60, LEVEL_5: 120 }, description: 'KTAS 도착→트리아지 목표(분·레벨별 맵) — 여정 흐름 분석 위반율 판정 기준. 부분 병합(누락 레벨=코드 기본)·비수치 무시', category: 'quality' },
  'qi.targets.ktasReassessMin': { key: 'qi.targets.ktasReassessMin', value: { LEVEL_1: 15, LEVEL_2: 15, LEVEL_3: 30, LEVEL_4: 60, LEVEL_5: 120 }, description: 'KTAS 재평가 목표 간격(분·레벨별 맵) — 응급 보드 재평가 지연 판정. 도어투트리아지 목표와 다른 값(별도 키·혼용 금지)', category: 'quality' },
  'qi.targets.nedocsBounds': { key: 'qi.targets.nedocsBounds', value: [20, 60, 100, 140, 180], description: 'NEDOCS 과밀 등급 경계 5개(2~6등급 진입 점수·오름차순) — 산식 계수는 Weiss 2004 표준이라 불변, 등급 경계만 개정 대상. 형식 위반 시 코드 기본(fail-safe)', category: 'quality' },
  // ── 의료질관리 흐름(QI-FLOW-001 · 2026-10-08) — 전부 위원회 의결로만 바뀐다(표면 매핑 QPS·SAFE·IC). 미설정 = 지어내지 않는다
  'qi.autoMeasure.enabled': { key: 'qi.autoMeasure.enabled', value: false, description: '질 지표 월 마감 자동 산출(매월 1일 06:30 · 공급원이 있는 지표만 전월분을 AUTO 로 기록). 기본 OFF — 분모 정의(qi.autoMeasure.incidentDenominator) 결정 전에 켜면 정의 없는 수치가 원장에 쌓인다. 화면의 "지금 계산" 미리보기는 이 값과 무관', category: 'quality' },
  'qi.autoMeasure.incidentDenominator': { key: 'qi.autoMeasure.incidentDenominator', value: null, description: '사고율 지표(낙상·욕창·투약오류) 분모 — PATIENT_DAYS(1,000재원일당) · ADMISSIONS(입원 100건당) · 비우면 미설정(사고율 자동 산출 불가 · 건수만)', category: 'quality' },
  'qi.deviceDays.source': { key: 'qi.deviceDays.source', value: null, description: '기구일수(CLABSI·CAUTI·VAP 분모) 원천 — MANUAL(병동 월 수기 입력) · DEVICE_LEDGER(기구 삽입·제거 원장 · 기록 시작일 qi.deviceLedger.coverageFrom 이후) · NONE(산출 안 함 · 건수만) · 비우면 미설정(=NONE 과 같이 동작하되 화면이 미결정이라 밝힌다)', category: 'quality' },
  'qi.autoManual.precedence': { key: 'qi.autoManual.precedence', value: 'BOTH', description: '같은 지표·달에 수기·자동 값이 다를 때 보고서·판정의 정본 — BOTH(둘 다 병기·판정은 수기) · AUTO · MANUAL', category: 'quality' },
  'qi.indicator.directEdit': { key: 'qi.indicator.directEdit', value: 'ALLOW_WITH_REASON', description: '질 지표 정의·목표를 관리자가 화면에서 직접 바꾸는 것 — ALLOW_WITH_REASON · AGENDA_ONLY(안건 경로만 · 직접 수정 거부)', category: 'quality' },
  'safety.incident.anonymous': { key: 'safety.incident.anonymous', value: false, description: '환자안전사고 익명 보고 허용 — true 면 보고자 기록 없이 접수(본인도 다시 조회 불가함을 보고 시 고지)', category: 'clinical' },
  'safety.harmLevelScale': { key: 'safety.harmLevelScale', value: null, description: '사고 위해 정도 척도 — KOPS(근접오류~사망 단계) · NCC_MERP(A~I) · INTERNAL4(원내 4단계) · 비우면 미설정(위해 정도 칸을 받지 않는다 · 어휘를 지어내지 않는다)', category: 'clinical' },
  'safety.poa.required': { key: 'safety.poa.required', value: false, description: '퇴원요약 서명 전 입원 기간 모든 진단에 POA(입원 시 존재) 값 필수 — 결정 safety.poaFlag(의무기록위원회) · 기본 false(현행: 입력은 받되 필수 아님)', category: 'quality' },
  'qi.deviceLedger.coverageFrom': { key: 'qi.deviceLedger.coverageFrom', value: null, description: '기구 삽입·제거 원장이 원내 전 기구를 빠짐없이 기록하기 시작한 날(YYYY-MM-DD) — 결정 qi.deviceDays.source = DEVICE_LEDGER 일 때 이 날 이후 달만 기구일수를 낸다 · 비우면 원장 기구일수 산출 불가(일부만 기록된 원장을 분모로 쓰면 감염률이 부풀려진다)', category: 'quality' },
  'accreditation.framework': { key: 'accreditation.framework', value: null, description: '인증 체계 — KOIHA(의료기관평가인증원) · JCI · BOTH · 비우면 미설정(기준 카탈로그를 적재하지 않는다 · 조문·점수표를 코드에 박지 않는다)', category: 'quality' },
  'qi.targets.opdWaitMinutes': { key: 'qi.targets.opdWaitMinutes', value: 30, description: '외래 접수→진료 대기 목표(분) — 여정 흐름 분석(flow-analytics) breachRate 판정 기준', category: 'quality' },
  // 🔴 설명이 실제 용도와 달랐다 — 화면 실사용 점검 W8(2026-08-14).
  //    "접수→호출 대기 목표"라 적혀 있어 flow-analytics 가 **'접수→호출' 단계에 이 값(30분)을 적용**했고,
  //    같은 호출 지연을 관제는 10분(`callDelayMinutes`)·분석은 30분으로 판정했다. 설명이 오배선을 불렀다.
  'qi.targets.cashierWaitMinutes': { key: 'qi.targets.cashierWaitMinutes', value: 30, description: '진료 종료→수납 완료 대기 목표(분) — 여정 흐름 분석(flow-analytics) 수납 단계 breachRate 판정 기준. 접수→호출 단계는 callDelayMinutes 를 쓴다', category: 'quality' },
  // 관제 보드 임계 — 종전 하드코딩(TH 상수). 보드와 분석이 같은 기준을 봐야 "관제의 지연"과 "분석의 위반율"이 일치한다.
  'qi.targets.callDelayMinutes': { key: 'qi.targets.callDelayMinutes', value: 10, description: '호출 후 미입실 지연 임계(분) — 환자여정 관제 CALL_DELAY flag 판정. 불렀는데 진료실에 안 들어온 상태', category: 'quality' },
  'qi.targets.consultDelayMinutes': { key: 'qi.targets.consultDelayMinutes', value: 40, description: '진료 지연 임계(분) — 환자여정 관제 CONSULT_DELAY flag 판정(진료실 점유 장기화)', category: 'quality' },
  'qi.targets.highUnpaidAmount': { key: 'qi.targets.highUnpaidAmount', value: 500000, description: '고액 미수 임계(원) — 환자여정 관제 HIGH_UNPAID flag 판정', category: 'quality' },
  'qi.targets.defaultAlosDays': { key: 'qi.targets.defaultAlosDays', value: 7, description: '기준 평균재원일수(일) — 장기재원 판정 기준선. 임계 = 이 값 × longStayMultiplier', category: 'quality' },
  'qi.targets.longStayMultiplier': { key: 'qi.targets.longStayMultiplier', value: 1.5, description: '장기재원 배수 — 재원일수가 defaultAlosDays × 이 배수를 넘으면 LONG_STAY flag', category: 'quality' },
  // 거버넌스 P3 §7 P1 후반(2026-08-04) — 게이트 판정 기준 표면화(모드는 기존 게이트 키·수치는 여기)
  'rehab.holdCriteria': { key: 'rehab.holdCriteria', value: { bergHighRisk: 21, bergMediumMax: 40, sbpHigh: 180, sbpLow: 90, hrHigh: 120, hrLow: 50, spo2Low: 90, tempHigh: 38, vitalsWindowHours: 72 }, description: '재활 세션 hold 판정 기준(부분 병합·비수치 무시) — Berg 낙상(미만=고위험/이하=중위험)·활력 중단 임계·활력 조회 창(시간). 게이트 모드는 rehab.sessionGate', category: 'clinical' },
  'imaging.contrastEgfr': { key: 'imaging.contrastEgfr', value: { blockBelow: 30, warnBelow: 45 }, description: '조영제 신기능 판정 eGFR 경계(부분 병합) — blockBelow 미만=고위험(ERROR)·warnBelow 미만=주의(WARNING). MDRD 산식 계수는 표준이라 불변. 게이트 모드는 imaging.contrastEnforce', category: 'clinical' },
  'radiation.doseTolerance': { key: 'radiation.doseTolerance', value: { fractionDeviationPct: 10, cumulativeOverPct: 5, planConsistencyPct: 5 }, description: '방사선 선량 허용 오차(%·부분 병합) — 분할선량 편차·누적선량 초과·처방 정합. 게이트 모드는 radiation.doseEnforce(기본 BLOCK)', category: 'clinical' },
  'dialysis.ufLimits': { key: 'dialysis.ufLimits', value: { maxRateMlKgHr: 13, underDryWeightToleranceKg: 1 }, description: '투석 UF 안전 기준(부분 병합) — 시간당 제수율 상한(mL/kg/hr·게이트 dialysis.ufRateEnforce)·건체중 하회 허용 오차(kg·상시 차단)', category: 'clinical' },
  'bloodbank.crossmatchValidHours': { key: 'bloodbank.crossmatchValidHours', value: 72, description: '교차시험(crossmatch) 유효시간(시간) — 결과 기록 시 validUntil 산정(신규 검사부터 적용·기존 레코드 소급 없음). 출고 판정·후보 추천이 저장된 validUntil 을 본다', category: 'clinical' },
  'surgery.lateralityKeywords': { key: 'surgery.lateralityKeywords', value: LATERALITY_REQUIRED_KEYWORDS, description: '오부위수술 방지 좌우구분 필수 키워드(문자열 배열 — 유효 배열이면 전량 대체·형식 위반=코드 기본). bodySite/술식명에 포함+laterality 미기재면 차단(surgery.siteVerify.enforce BLOCK 시)', category: 'clinical' },
  'notification.policy': { key: 'notification.policy', value: {}, description: '직원 알림 정책 오버라이드(유형별 부분 병합) — 예 {"SAFETY_INCIDENT_CRITICAL":{"roles":["ADMIN","NURSE"],"dedupHours":3}}. 대상 roles·중복 억제 시간만 개정 가능·미설정 유형=코드 기본', category: 'general' },
  'notification.retentionDays': { key: 'notification.retentionDays', value: { read: 90, unread: 180 }, description: '직원·환자 알림 보존일(부분 병합) — read=읽음 알림·unread=미읽음 알림. 매일 05시 정리 크론이 사용', category: 'general' },
  // ── 환자 푸시(대외 발신) 게이트 — 정본 `modules/notification/patient-push.contract.ts` · 조회 GET /api/v1/notifications/patient-push/settings
  //    🔴 기본값 **전부 false**. 환자 휴대폰에 실제로 도달하는 것이라 자동으로 켜지지 않는다.
  //       판정은 **마스터 AND 타입별** — 한쪽만 켜면 나가지 않고, 그 사실을 로그가 말한다.
  //       직원이 누르는 것(CALLED·PHARMACY·BILLING)은 요청 DTO 의 `notifyPatient=true` 가 **추가로** 필요하다.
  'sms.provider': { key: 'sms.provider', value: '', description: 'SMS 제공자명(예: 알리고·NHN Toast). 🔴 저장해도 발송되지 않는다 — CrmChannelService.providers 에 SMS 구현이 없다. 위탁계약(legal.sms.entrustment)과 코드 구현이 모두 있어야 발송된다', category: 'general' },
  'sms.senderNumber': { key: 'sms.senderNumber', value: '', description: 'SMS 발신번호(사전등록 필요). 🔴 저장해도 발송되지 않는다 — 제공자 코드 미구현', category: 'general' },
  'notification.staffLabResult.enabled': { key: 'notification.staffLabResult.enabled', value: false, description: '직원 검사 결과 알림(주치의) — 기본 OFF. 🔴 켜면 모든 검사 완료마다 알림이 나간다(위급값 결과는 제외 · 60분 중복 억제). 켜는 결정은 원내 위원회 policy.labResult.staffNotify', category: 'general' },
  // ── 상시 감시(Sentinel) 알림 — 기획 his-sentinel-monitoring.plan.md P4 ──
  // 🔴 **임상 통로와 분리한다.** 감시 알림은 관리자 인앱 알림이고 severity 는 INFO 로 고정한다 —
  //    감시 소음이 임상 경보와 같은 색으로 뜨면 진짜 경보를 죽인다.
  'sentinel.notify.enabled': { key: 'sentinel.notify.enabled', value: true, description: '상시 감시 신규 발견 알림(관리자 인앱) — 기본 ON. 🔴 신규 발생과 재발만 알리고 기존 항목은 다시 알리지 않는다. 대외로 나가지 않는다', category: 'general' },
  'sentinel.notify.severities': { key: 'sentinel.notify.severities', value: ['RED'], description: "상시 감시 알림을 보낼 심각도 — 기본 ['RED'](적색만). AMBER·INFO 를 넣으면 알림이 늘어난다. 🔴 관측 불가는 어떤 설정에서도 알리지 않는다(확인 못 함으로 사람을 깨우지 않는다)", category: 'general' },
  'sentinel.notify.weeklyDigest': { key: 'sentinel.notify.weeklyDigest', value: true, description: '상시 감시 주간 요약(월 09:30 KST · 관리자 1건) — 기본 ON. 신규 여부와 무관하게 현재 상태를 한 번 정리한다', category: 'general' },
  'notification.patientPush.enabled': { key: 'notification.patientPush.enabled', value: false, description: '환자 앱 푸시 마스터 스위치(대외 발신) — 기본 OFF. 이것이 false 면 타입별을 켜도 나가지 않는다', category: 'general' },
  'notification.patientPush.types.CALLED': { key: 'notification.patientPush.types.CALLED', value: false, description: '환자 푸시 · 진료 호출(대기열 호출) — 기본 OFF. 직원 옵트인(notifyPatient) 필요 · 야간 억제 예외', category: 'general' },
  'notification.patientPush.types.PHARMACY': { key: 'notification.patientPush.types.PHARMACY', value: false, description: '환자 푸시 · 약 조제 완료(외래 조제 검수 완료=수령 가능) — 기본 OFF. 직원 옵트인 필요 · 야간 억제 예외', category: 'general' },
  'notification.patientPush.types.BILLING': { key: 'notification.patientPush.types.BILLING', value: false, description: '환자 푸시 · 수납 대기(청구 생성) — 기본 OFF. 직원 옵트인 필요 · 야간 억제 예외', category: 'general' },
  'notification.patientPush.types.LAB_RESULT': { key: 'notification.patientPush.types.LAB_RESULT', value: false, description: '환자 푸시 · 검사 결과 확정(VERIFIED 이후에만 · 위급값 포함 결과는 미발송) — 기본 OFF. 야간 억제 적용', category: 'general' },
  'notification.patientPush.types.MESSAGE': { key: 'notification.patientPush.types.MESSAGE', value: false, description: '환자 푸시 · 담당의 메시지 답변(내용은 싣지 않음) — 기본 OFF. 의사 옵트인 필요 · 야간 억제 적용', category: 'general' },
  'notification.patientPush.types.DOCUMENT_READY': { key: 'notification.patientPush.types.DOCUMENT_READY', value: false, description: '환자 푸시 · 서류 발급 완료(개별 신청 · 실손 번들은 번들 알림) — 기본 OFF. 시스템 알림(옵트인 없음) · 야간 억제 적용', category: 'general' },
  'notification.patientPush.types.DOCUMENT_REJECTED': { key: 'notification.patientPush.types.DOCUMENT_REJECTED', value: false, description: '환자 푸시 · 서류 발급 반려(사유는 싣지 않음 — 앱에서 확인) — 기본 OFF. 시스템 알림(옵트인 없음) · 야간 억제 적용', category: 'general' },
  'notification.patientPush.types.QUEUE_NEAR': { key: 'notification.patientPush.types.QUEUE_NEAR', value: false, description: '환자 푸시 · 진료 차례 임박(오늘 대기 · 앞 인원이 기준 이하가 된 첫 순간 한 번) — 기본 OFF. 시스템 알림(옵트인 없음) · 야간 억제 예외 · 🔴 기준 인원(queueNearAhead) 미설정이면 켜도 만들지 않는다', category: 'general' },
  'notification.patientPush.queueNearAhead': { key: 'notification.patientPush.queueNearAhead', value: null, description: '진료 차례 임박 기준 — 앞 대기 인원(0~10 정수). 🔴 원내 정책이라 기본값 없음 — 비우면 **미설정**(차례 임박 알림을 만들지 않는다)', category: 'general' },
  'nursing.restraint.checkIntervalMinutes': { key: 'nursing.restraint.checkIntervalMinutes', value: 120, description: '신체보호대 점검 간격(분 · 15~480 정수) — 마지막 점검 뒤 이 시간이 지나면 점검 필요·주치의 통지. 🔴 원내 규정으로 정해 입력한다 — 비어 있으면 코드 기본값 120분으로 감시하고 화면이 "코드 기본값"이라고 말한다', category: 'nursing' },
  'nursing.pain.reassessRule': { key: 'nursing.pain.reassessRule', value: null, description: '통증 재평가 원내 규정 — { thresholdScore: NRS 1~10(이상이면 재평가 대상), withinMinutes: 15~480(기한), afterAnalgesicMinutes: 15~480 또는 null(진통제 투여 뒤 기한 · null=진통제 투여는 사건 아님) }. 🔴 기본값 없음 — 비우면 **미설정**(재평가 목록을 만들지 않는다). 관리 화면 /admin/nursing-rules', category: 'nursing' },
  'nursing.riskReassess.intervalHours': { key: 'nursing.riskReassess.intervalHours', value: null, description: '낙상·욕창 위험 재평가 주기(시간) — { FALL_RISK·PRESSURE_ULCER: { HIGH·MODERATE·LOW: 1~168 } } · 고위험 ≤ 중위험 ≤ 저위험. 🔴 원내 규정 — 비면 코드 기본값(낙상 2·4·8 · 욕창 4·8·24)으로 일정을 계속 만들고 화면이 "코드 기본값"이라고 말한다. 관리 화면 /admin/nursing-rules', category: 'nursing' },
  'nursing.handoff.ackTakeOverMode': { key: 'nursing.handoff.ackTakeOverMode', value: null, description: '간호 교대 인계 "인수 확인 ↔ 담당 인수" 방식 — OFFER_BOTH(둘 다 제공) · ALWAYS_BUNDLED(인수 확인 = 담당 인수 · 서버가 함께) · SEPARATE(묶지 않음). 비우면 코드 기본값 OFFER_BOTH(종전 동작)로 동작하고 화면이 "코드 기본값"이라고 말한다. 관리 화면 /admin/nursing-rules', category: 'nursing' },
  'notification.patientPush.quietHours': { key: 'notification.patientPush.quietHours', value: { startHour: 22, endHour: 7 }, description: '환자 푸시 야간 억제 창(Asia/Seoul 기준 시·endHour 미포함). startHour===endHour 면 억제 없음. 🔴 억제분은 나중에 보내지 않는다(예약 큐 없음·미발송). 형식 위반은 무시하고 22~7 유지', category: 'general' },
  'clinical.vitals.thresholds': { key: 'clinical.vitals.thresholds', value: '', description: '활력 이상 임계 오버라이드(JSON 부분 병합 — 예 {"systolicBp":{"high":170}}). 빈값=코드 기본(vitals-evaluate 정본). 역전값은 무시(fail-safe)', category: 'clinical' },
  'clinical.lab.criticalNotify': { key: 'clinical.lab.criticalNotify', value: true, description: '검사 위급값 자동 알림 — 명시적 false 만 통보 억제(영구기록 CriticalValueAlert·미확인 목록은 유지)', category: 'clinical' },
  'clinical.consent.requiredForSurgery': { key: 'clinical.consent.requiredForSurgery', value: true, description: '수술 전 동의서 필수 여부', category: 'clinical' },
  'approval.clinicalCertificate.enabled': { key: 'approval.clinicalCertificate.enabled', value: false, description: '기록지(증명서) 전자결재 확약 경로 — 간호/행정 기안→담당의 결재. 기본 OFF', category: 'clinical' },
  'approval.consent.enabled': { key: 'approval.consent.enabled', value: false, description: '동의서 의사 확약 전자결재 경로 — 간호 기안→담당의 doctorSign 결재. 기본 OFF', category: 'clinical' },
  'approval.clinicalNote.enabled': { key: 'approval.clinicalNote.enabled', value: false, description: '간호기록 의사 공동서명(co-sign) 전자결재 경로 — 간호 기안→담당의 확약. 기본 OFF', category: 'clinical' },
  'approval.recordCopy.enabled': { key: 'approval.recordCopy.enabled', value: false, description: '의무기록 사본 발급 승인 전자결재 경로 — 행정 기안→담당의 발급 승인(§21 대리 자격검증 선행). 기본 OFF', category: 'clinical' },
  'preauth.enforce': { key: 'preauth.enforce', value: {}, description: '사전승인 발행 게이트(유형별 OFF|WARN|BLOCK). 예 {"NARCOTIC_RX":"BLOCK"}. 미설정=OFF. 응급(STAT/emergency)은 항상 우회+사후승인', category: 'clinical' },
  'preauth.portal.enabled': { key: 'preauth.portal.enabled', value: false, description: '환자 포털 사전승인 신청(재처방·검사·의뢰·시술상담) → 행정→주치의 다단계 결재. 기본 OFF', category: 'clinical' },
  'preauth.portalIntakeStaffId': { key: 'preauth.portalIntakeStaffId', value: '', description: '환자 포털 사전승인 1차 접수(원무) 담당 직원 userId — 결재선 1단계', category: 'clinical' },
  'preauth.imaging': { key: 'preauth.imaging', value: {}, description: '고가·특수 검사 판정 { minUnitPrice?: 원, codePrefixes?: [], categories?: [] }. 하나라도 매칭이면 사전승인 대상. 게이트는 preauth.enforce.HIGH_COST_IMAGING', category: 'clinical' },
  'duty.constraint.enforce': { key: 'duty.constraint.enforce', value: 'OFF', description: '당직 근무 규칙(전이·연속야간·근무간휴식) 강제 수준(OFF|WARN|BLOCK). WARN=경고 배정·BLOCK=차단. 기본 OFF', category: 'clinical' },
  'duty.maxConsecutiveDays': { key: 'duty.maxConsecutiveDays', value: 6, description: '연속 근무일 상한(OFF 없이). 초과 시 근무 규칙 위반(전공의법 연속근무). 기본 6', category: 'clinical' },
  'duty.swap.eApproval': { key: 'duty.swap.eApproval', value: false, description: '당직 교대 요청을 전자결재(상대 직원 승인)로 처리(HR_DUTY_SWAP). 승인 시 실제 교환. 기본 OFF(자체 승인)', category: 'clinical' },
  // 개발용 데모 데이터
  'dev.demoDateRoll': { key: 'dev.demoDateRoll', value: false, description: '[개발] 매 자정 예약·접수 데모 데이터를 오늘 날짜로 롤포워드 (운영 false)', category: 'clinical' },
  // ERP 연동
  'erp.enabled': { key: 'erp.enabled', value: true, description: 'ERP 바로가기 활성화', category: 'integration' },
  'erp.handoff': { key: 'erp.handoff', value: 'token', description: 'ERP SSO 방식 (token=URL 전달 | cookie=동일호스트 쿠키)', category: 'integration' },
  'erp.url': { key: 'erp.url', value: '/erp', description: 'ERP 접근 URL (동일 호스트 /erp 또는 외부 URL)', category: 'integration' },
  'erp.ssoPath': { key: 'erp.ssoPath', value: '/api/v1/auth/sso/his', description: 'ERP SSO 수신 경로', category: 'integration' },
  'erp.allowedRoles': { key: 'erp.allowedRoles', value: ['ADMIN'], description: 'ERP 접근 허용 역할', category: 'integration' },
  'erp.allowedUserIds': { key: 'erp.allowedUserIds', value: [], description: 'ERP 접근 개별 허용 사용자(userId) — 역할과 합집합', category: 'integration' },
  'erp.accessSyncMeta': { key: 'erp.accessSyncMeta', value: null, description: 'ERP 명단 동기화 최근 결과(리포트)', category: 'integration' },
  // ERP 재고 연동
  'erp.integrationKey': { key: 'erp.integrationKey', value: '', description: 'ERP 재고 연동 키 (인바운드 입고 API 인증)', category: 'integration' },
  'erp.webhookEnabled': { key: 'erp.webhookEnabled', value: false, description: 'ERP 재고 변동 웹훅 전송', category: 'integration' },
  'erp.webhookUrl': { key: 'erp.webhookUrl', value: '', description: 'ERP 기준 주소 — 🔴 웹훅 발신과 ESS 조회(급여·연차)가 **같은 값**을 쓴다. 경로(`/api/v1/...`)는 코드가 붙이므로 **호스트까지만** 적는다(예: https://erp.example.org · 끝에 /api/v1 을 넣으면 경로가 두 번 붙어 404)', category: 'integration' },
  // PACS 영상 내보내기 (포털 소비자)
  'pacs.exportEnabled': { key: 'pacs.exportEnabled', value: false, description: '환자포털 영상/판독 내보내기 활성화', category: 'integration' },
  'pacs.exportSecret': { key: 'pacs.exportSecret', value: '', description: 'PACS 내보내기 공유 시크릿 (HS256, PACS와 동일값) — 미설정 시 비활성', category: 'integration' },
  'pacs.exportBaseUrl': { key: 'pacs.exportBaseUrl', value: '', description: 'PACS 베이스 URL (미설정 시 PACS_API_URL env 폴백)', category: 'integration' },
  'pacs.webhookSecret': { key: 'pacs.webhookSecret', value: '', description: 'PACS 웹훅 수신 시크릿 (OpenPACS가 X-Webhook-Secret로 전송·env PACS_WEBHOOK_SECRET 폴백) — 미설정 시 웹훅 fail-closed(401)', category: 'integration' },
  // 수납
  // 경영성과 벤치마크 — 공시 데이터에서 '우리 병원' 기관명. 미설정이면 동급 통계만 보이고 비교하지 않는다(HIS 에는 손익이 없다)
  'finance.benchmark.selfInstitution': { key: 'finance.benchmark.selfInstitution', value: null, description: '경영성과 벤치마크에서 우리 병원으로 볼 공시 기관명(가져온 공시 데이터의 기관명과 정확히 같아야 함) — 미설정이면 비교하지 않음', category: 'billing' },
  'billing.defaultCopayRate': { key: 'billing.defaultCopayRate', value: 0.3, description: '기본 본인부담률', category: 'billing' },
  'billing.unpaidAlertDays': { key: 'billing.unpaidAlertDays', value: 7, description: '미수납 알림 기준(일)', category: 'billing' },
  'billing.receiptFormat': { key: 'billing.receiptFormat', value: 'STANDARD', description: '영수증 형식 (STANDARD|DETAILED)', category: 'billing' },
  'billing.taxDeductionEnabled': { key: 'billing.taxDeductionEnabled', value: true, description: '연말정산 의료비 증빙 기능', category: 'billing' },
  'billing.onlinePaymentEnabled': { key: 'billing.onlinePaymentEnabled', value: false, description: '온라인 결제 활성화 (PG 연동)', category: 'billing' },
  // 수가 계산기 설정
  // 🔴 요양기관 종별 — **개설 허가가 정하는 사실**이다. 이 한 값이 세 곳을 동시에 가른다:
  //    ① ERP 로 나가는 청구 라인의 `institutionGrade`(종별가산율)
  //    ② 의료급여 본인부담(의원만 정액 1,000원, 병원급↑은 율)
  //    ③ 수가 고시 단가 열(의원단가 vs 병원급이상단가 — 실측 97.4% 가 서로 다르다)
  //    미설정이면 코드가 `?? 'CLINIC'` 으로 떨어져 **의원으로 청구된다** — 그것이 개통 이래 상태였다.
  //    편집 화면: `/admin/billing-calc` · 사람 결정: `/admin/decisions/billing.institutionType`
  'billing.institution.grade': { key: 'billing.institution.grade', value: 'CLINIC', description: '요양기관 종별 (CLINIC 의원/HOSPITAL 병원/GENERAL 종합병원/TERTIARY 상급종합) — 🔴 개설 허가와 반드시 일치시킬 것. 종별가산·의료급여 정액·수가 단가 열을 동시에 가른다', category: 'billing' },
  'billing.copay.nhi.outpatient': { key: 'billing.copay.nhi.outpatient', value: 30, description: '건강보험 외래 본인부담률 (%)', category: 'billing' },
  // 2026-10-20 — 건보 외래 본인부담률 종별 차등({CLINIC,HOSPITAL,GENERAL,TERTIARY} % · shared copay-by-grade). 🔴 기본값 없음(null = 위 단일 율) — 법정 율을 지어 넣지 않는다
  'billing.copay.nhi.outpatient.byGrade': { key: 'billing.copay.nhi.outpatient.byGrade', value: null, description: '건강보험 외래 본인부담률 종별 차등 — 비우면 단일 외래 율을 모든 종별에 쓴다. 값이 있으면 우리 기관 종별(명시 설정)의 율. 편집: /admin/billing-calc', category: 'billing' },
  'billing.copay.nhi.inpatient': { key: 'billing.copay.nhi.inpatient', value: 20, description: '건강보험 입원 본인부담률 (%)', category: 'billing' },
  'billing.copay.nhi.pharmacy': { key: 'billing.copay.nhi.pharmacy', value: 30, description: '건강보험 약국 본인부담률 (%)', category: 'billing' },
  'billing.copay.ma1.outpatient': { key: 'billing.copay.ma1.outpatient', value: 0, description: '의료급여 1종 외래 부담률 (%)', category: 'billing' },
  'billing.copay.ma1.inpatient': { key: 'billing.copay.ma1.inpatient', value: 0, description: '의료급여 1종 입원 부담률 (%)', category: 'billing' },
  'billing.copay.ma2.outpatient': { key: 'billing.copay.ma2.outpatient', value: 15, description: '의료급여 2종 외래 부담률 (%)', category: 'billing' },
  'billing.copay.ma2.inpatient': { key: 'billing.copay.ma2.inpatient', value: 10, description: '의료급여 2종 입원 부담률 (%)', category: 'billing' },
  'billing.copay.nearpoor.outpatient': { key: 'billing.copay.nearpoor.outpatient', value: 14, description: '차상위 외래 부담률 (%)', category: 'billing' },
  // 의료급여 1종 외래 정액(종별) — 공시: 의원 1,000 / 병원·종합 1,500 / 상급종합 2,000원
  'billing.copay.ma1.flat.clinic': { key: 'billing.copay.ma1.flat.clinic', value: 1000, description: '의료급여 1종 외래 정액 — 의원 (원)', category: 'billing' },
  'billing.copay.ma1.flat.hospital': { key: 'billing.copay.ma1.flat.hospital', value: 1500, description: '의료급여 1종 외래 정액 — 병원 (원)', category: 'billing' },
  'billing.copay.ma1.flat.general': { key: 'billing.copay.ma1.flat.general', value: 1500, description: '의료급여 1종 외래 정액 — 종합병원 (원)', category: 'billing' },
  'billing.copay.ma1.flat.tertiary': { key: 'billing.copay.ma1.flat.tertiary', value: 2000, description: '의료급여 1종 외래 정액 — 상급종합 (원)', category: 'billing' },
  // 의료급여 2종 외래 정액(의원만 정액 1,000원, 병원급↑은 15% 율 적용)
  'billing.copay.ma2.flat.clinic': { key: 'billing.copay.ma2.flat.clinic', value: 1000, description: '의료급여 2종 외래 정액 — 의원 (원, 병원급↑은 율)', category: 'billing' },
  'billing.copay.exemption.rate': { key: 'billing.copay.exemption.rate', value: 10, description: '산정특례 본인부담률 (%, 암 5·희귀 10 등 단일)', category: 'billing' },
  // 휴가 전자결재 (Clinic W.Sign — 개발중 시뮬레이션)
  'ess.leaveApprovalMode': { key: 'ess.leaveApprovalMode', value: 'SIMULATION', description: '휴가 결재 모드 (SIMULATION=자동승인 데모 | CLINIC=실연동)', category: 'integration' },
  'ess.leaveSimulationMaxDays': { key: 'ess.leaveSimulationMaxDays', value: 5, description: '시뮬레이션 자동승인 최대 일수(초과 시 반려)', category: 'integration' },
  // 수진자 자격조회 (건강보험공단 연계)
  'eligibility.enabled': { key: 'eligibility.enabled', value: true, description: '수진자 자격조회 기능 활성화', category: 'integration' },
  'eligibility.mode': { key: 'eligibility.mode', value: 'SIMULATION', description: '자격조회 모드 (SIMULATION|NHIS)', category: 'integration' },
  'eligibility.apiUrl': { key: 'eligibility.apiUrl', value: '', description: '공단 자격조회 API URL (NHIS 모드)', category: 'integration' },
  'eligibility.apiKey': { key: 'eligibility.apiKey', value: '', description: '공단 자격조회 연동 키 (NHIS 모드)', category: 'integration' },
  'eligibility.cacheTtlHours': { key: 'eligibility.cacheTtlHours', value: 24, description: '자격조회 캐시 유효시간(시간)', category: 'integration' },
  'eligibility.patriotApiUrl': { key: 'eligibility.patriotApiUrl', value: '', description: '보훈 자격검증 API URL (NHIS 모드·국가유공자)', category: 'integration' },
  // 외부 서명서비스(sign) 연동 — 시크릿 값은 admin이 주입(repo 비저장). EXTERNAL은 공동 게이트 후.
  'sign.mode': { key: 'sign.mode', value: 'SIMULATION', description: '외부 서명서비스 모드 (SIMULATION|EXTERNAL)', category: 'integration' },
  // 🔴 설명이 "원내 URL" 이라 호스트만 넣었다가 enroll 이 404 였다(형제 프로젝트 새 설치본 R18 · 2026-09-14).
  //    코드는 이 값에 `/certificates/enroll`·`/sign-requests` 를 그대로 이어 붙인다 — **API 버전 경로(`/v1`)까지** 넣어야 한다.
  'sign.url': { key: 'sign.url', value: '', description: 'sign 서비스 원내 URL — 🔴 API 버전 경로까지 포함(예: https://sign.example.kr/v1). 호스트만 넣으면 인증서 등록이 404', category: 'integration' },
  'sign.apiKey': { key: 'sign.apiKey', value: '', description: 'HIS→sign 인바운드 API Key (openssl rand -hex 24, admin 주입)', category: 'integration' },
  'sign.webhookSecret': { key: 'sign.webhookSecret', value: '', description: 'sign→HIS Webhook HMAC 시크릿 (openssl rand -hex 32, admin 주입)', category: 'integration' },
  'sign.webhookSecretPrev': { key: 'sign.webhookSecretPrev', value: '', description: 'Webhook 직전 시크릿(무중단 회전 윈도우 — 회전 후 비움)', category: 'integration' },
  'sign.jwksIssuer': { key: 'sign.jwksIssuer', value: 'hospitalrun', description: 'HIS SSO OIDC issuer (의료진 서명 JWT)', category: 'integration' },
  'sign.jwksUrl': { key: 'sign.jwksUrl', value: '', description: 'HIS JWKS 공개 EP URL (sign이 JWT 검증용)', category: 'integration' },
  'sign.highRiskConsentTypes': { key: 'sign.highRiskConsentTypes', value: ['SURGERY', 'ANESTHESIA', 'DNR'], description: '고위험 동의서(서명직전 PASS 재인증=APP_STEPUP) 종류', category: 'integration' },
  // 단말 제로트러스트 ② 활성화 게이트(전부 빈배열=OFF·진료 무중단). 활성화는 준비도 확인 후 단계적.
  'terminal.stepUpActions': { key: 'terminal.stepUpActions', value: [], description: 'Tier2 푸시 생체승인 강제 액션(예 ["PRESCRIPTION_CREATE","ENCOUNTER_SIGN"]) — 빈배열=OFF', category: 'terminal' },
  'terminal.stepUpPilotUserIds': { key: 'terminal.stepUpPilotUserIds', value: [], description: 'Tier2 파일럿 대상 userId(["*"]=전체). 빈배열=대상없음(inert) — 준비된 의사만 추가', category: 'terminal' },
  'terminal.approvalPin.actions': { key: 'terminal.approvalPin.actions', value: [], description: 'Tier1 데일리PIN 강제 액션 — 빈배열=OFF', category: 'terminal' },
  // 처방의(책임 처방자) 지정 규칙·가이드라인 — enabled=false면 현 동작(작성자=본인) 유지(무중단)
  'prescription.prescriberRules': {
    key: 'prescription.prescriberRules',
    value: {
      enabled: false,            // 전체 기능 ON/OFF — false=기존 동작(처방의=로그인 사용자)
      allowDelegate: false,      // 본인 외 처방의 지정(위임/대리처방) 허용
      requireDelegateAuth: true, // 위임 시 지정 처방의의 step-up(폰 생체) 인증 필수
      allowedRoles: ['DOCTOR'],  // 처방의가 될 수 있는 역할
      requireSpecialtyMatch: false, // 처방의 진료과(department)가 진료 진료과와 일치해야
      requireAttending: false,   // 입원 환자는 주치의(attendingDoctor)만 처방의 지정 가능
      departmentGuidelines: {} as Record<string, string>, // 진료과별 처방 가이드라인(화면 표시)
    },
    description: '처방의 지정 규칙(역할/전문과/주치의)·위임 인증·진료과별 가이드라인',
    category: 'prescription',
  },
  // 직종별 오더 입력 범위 조정(2026-09-29) — 빈 객체 = 코드 기본값(shared DEFAULT_ORDER_ENTRY_SCOPE, 보수적).
  // 형식 { 직종: { 유형: 'SELF'|'DELEGATE'|'NONE' } } · **낮추기만 유효**(비의사의 SELF 상한은 코드가 강제 — 설정으로 올릴 수 없다)
  // 원내 결정 `order.entryScope.policy`(결정 등록부) 가 정한다
  'order.entryScope': {
    key: 'order.entryScope',
    value: {} as Record<string, Record<string, string>>,
    description: '직종별 오더 입력 범위 조정(낮추기만) — 예 {"NURSE":{"NURSING":"DELEGATE"}} · 빈 객체=코드 기본값',
    category: 'prescription',
  },
  // 지속 처방 갱신·만료(2026-09-30) — '곧 만료' 창과 기간 없는 처방의 재검토 기한은 원내 정책이다(결정 등록부 배치 M)
  'order.renewal.soonHours': {
    key: 'order.renewal.soonHours',
    value: 24,
    description: '갱신 대기 목록의 "곧 만료" 기준(시간) — 투여 종료 예정이 이 시간 안이면 목록에 올린다',
    category: 'prescription',
  },
  'order.renewal.noEndReviewDays': {
    key: 'order.renewal.noEndReviewDays',
    value: null as number | null,
    description: '기간 없는 처방(PRN·지속 지시)의 재검토 기한(일) — 미설정이면 기한 없이 전부 목록에 올리고 "기한 미설정"이라 밝힌다',
    category: 'prescription',
  },
  'billing.fee.consultation.initial': { key: 'billing.fee.consultation.initial', value: 15890, description: '초진 진찰료 (원)', category: 'billing' },
  'billing.fee.consultation.followup': { key: 'billing.fee.consultation.followup', value: 11690, description: '재진 진찰료 (원)', category: 'billing' },
  'billing.fee.admission.general': { key: 'billing.fee.admission.general', value: 52000, description: '일반병실 입원료 (원/일)', category: 'billing' },
  'billing.fee.meal.general': { key: 'billing.fee.meal.general', value: 5200, description: '일반식 식대 (원/식)', category: 'billing' },
  'billing.fee.dispensing.internal': { key: 'billing.fee.dispensing.internal', value: 4500, description: '원내 조제료 (원)', category: 'billing' },
  'billing.fee.dispensing.external': { key: 'billing.fee.dispensing.external', value: 8000, description: '원외 처방료 (원)', category: 'billing' },
  'billing.discount.senior.rate': { key: 'billing.discount.senior.rate', value: 10, description: '경로우대 할인율 (%)', category: 'billing' },
  'billing.discount.senior.age': { key: 'billing.discount.senior.age', value: 65, description: '경로우대 기준 나이', category: 'billing' },
  'billing.discount.staff.rate': { key: 'billing.discount.staff.rate', value: 50, description: '직원가족 할인율 (%)', category: 'billing' },
  'billing.rounding': { key: 'billing.rounding', value: 10, description: '원단위 절사 기준 (10=10원 미만 절사)', category: 'billing' },
  // 보안
  'security.session.timeoutMinutes': { key: 'security.session.timeoutMinutes', value: 480, description: '세션(access token) 만료 시간(분) — 신규 발급부터 적용·5~1440 클램프·이상값은 기본 8시간 유지', category: 'security' },
  // 🔴 종전 표시값 8 — 실제 정본은 12(EMR 인증 기준)였고 이 키를 읽는 코드가 없었다.
  //    강화 전용으로 배선(유효 하한 = max(12, 설정값)) — 12 미만으로 낮춰도 적용되지 않는다.
  //    requireSpecial 키는 제거 — 특수문자 필수는 선언 기준의 일부라 완화 스위치가 성립하지 않는다(중복 정본).
  'security.password.minLength': { key: 'security.password.minLength', value: 12, description: '비밀번호 최소 길이 — 하한 12(EMR 기준·완화 불가), 12 초과로 올리면 강화 적용', category: 'security' },
  // 🔴 종전 표시값 5 — 실제 잠금은 코드 상수 10 이었고 **이 키를 읽는 코드가 없었다**.
  //    화면이 보안 통제를 실제보다 엄격하게 말하던 것이다(잘못된 안심). 실제값으로 맞추고 배선했다.
  // 🔴 직원 JWT 로 `/fhir/R4/*` 를 부를 수 있는 역할. 종전에는 **역할 검사가 아예 없어**
  //    급양·원무·의무기록 계정도 전체 환자 번들(성명·MRN·생년월일·전화·주소)을 받았다.
  //    SMART 토큰 경로는 이 값과 무관하다(자기 scope·환자 컨텍스트로 판정) — 외부 연동은 건드리지 않는다.
  //    역할을 더 열어야 하면 여기에 추가한다. 알 수 없는 값은 무시되고, 비우면 기본값으로 돌아간다.
  'security.fhir.staffRoles': { key: 'security.fhir.staffRoles', value: ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'], description: '직원 JWT 로 FHIR(/fhir/R4/*) 를 조회할 수 있는 역할 배열 — SMART 토큰은 별도(scope 판정). 알 수 없는 역할은 무시', category: 'security' },
  'security.login.maxAttempts': { key: 'security.login.maxAttempts', value: 10, description: '로그인 연속 실패 잠금 임계(회) — 초과 시 15분 잠금. auth.service·anomaly.service 가 이 값을 읽는다', category: 'security' },
  'security.login.lockMinutes': { key: 'security.login.lockMinutes', value: 15, description: '로그인 잠금 시간(분)', category: 'security' },
  'security.btg.enabled': { key: 'security.btg.enabled', value: true, description: 'Break-The-Glass 긴급접근 기능 — false=직원 응급접근 발급 거부(§7 P2 실배선)', category: 'security' },
  'security.btg.defaultMinutes': { key: 'security.btg.defaultMinutes', value: 30, description: '직원 응급접근(Break-glass) 기본 유효시간(분) — 발급 시 minutes 미지정 시 적용', category: 'security' },
  'security.btg.maxMinutes': { key: 'security.btg.maxMinutes', value: 120, description: '직원 응급접근(Break-glass) 최대 유효시간(분) — 요청값이 커도 이 값으로 클램프', category: 'security' },
  'consent.doctorSignRequiredTypes': { key: 'consent.doctorSignRequiredTypes', value: DOCTOR_SIGN_REQUIRED_CONSENT_TYPES, description: '의사 확약(전자결재) 필요 동의서 종류(문자열 배열·유효 배열=전량 대체) — ess 상신 대상·품질지표(의사 서명 누락)가 사용. PASS 재인증 대상(sign.highRiskConsentTypes)과는 별개 정책', category: 'clinical' },
  // 포털
  'portal.jwt.expiresMinutes': { key: 'portal.jwt.expiresMinutes', value: 30, description: '환자 포털 JWT 만료(분)', category: 'portal' },
  'portal.patientApp.jwtExpiresHours': { key: 'portal.patientApp.jwtExpiresHours', value: 8, description: '환자앱 JWT 만료(시간)', category: 'portal' },
  'portal.signup.enabled': { key: 'portal.signup.enabled', value: true, description: '환자 포털 회원가입 허용', category: 'portal' },
  'portal.questionnaire.reminderDays': { key: 'portal.questionnaire.reminderDays', value: 1, description: '문진표 알림 예약 전 일수', category: 'portal' },
  'portal.telehealth.enabled': { key: 'portal.telehealth.enabled', value: true, description: '원격진료 기능 활성화', category: 'portal' },
  'portal.inpatientLife': { key: 'portal.inpatientLife', value: false, description: '포털 입원 생활(식단·중간정산) 기능 (기본 OFF)', category: 'portal' },
  'portal.medicationReminder': { key: 'portal.medicationReminder', value: false, description: '포털 복약 리마인더 cron 게이트 (기본 OFF·opt-in)', category: 'portal' },
  'portal.medicationReminderTimes': { key: 'portal.medicationReminderTimes', value: { '아침 식후': '08:00', '점심 식후': '12:30', '저녁 식후': '18:30', '취침 전': '21:30' }, description: '복약 리마인더 슬롯별 발송 시각(HH:mm)', category: 'portal' },
  'portal.medicationReminderDailyCap': { key: 'portal.medicationReminderDailyCap', value: 6, description: '복약 리마인더 계정당 일일 발송 상한', category: 'portal' },
  'diagnosis.restrictionEnforce': { key: 'diagnosis.restrictionEnforce', value: { notPrimary: 'OFF', sex: 'OFF', age: 'OFF' }, description: '상병 제한(주상병불가·성별·연령) 서버 시행 — 규칙별 OFF|WARN|BLOCK (기본 OFF·위반은 항상 로그)', category: 'clinical' },
  'nursing.highAlertDoubleCheck': { key: 'nursing.highAlertDoubleCheck', value: 'WARN', description: '고위험약 투약 독립 이중확인(IPSG.3) — OFF|WARN|BLOCK (기본 WARN·BLOCK=2인 서명 미충족 시 400)', category: 'clinical' },
  'lab.fhirAutoApply': { key: 'lab.fhirAutoApply', value: 'OFF', description: '외부 LIS FHIR 결과 자동 반영(apply) — OFF|ON (기본 OFF·안전상 직원 검증 유지). ON 시 오더 매칭된 결과를 lab.fhirAutoApplyUserId 명의로 자동 apply', category: 'clinical' },
  // ── 경영 지표 목표치(경영진 대시보드 KPI) ─────────────────────────────────
  // 🔴 (2026-09-16 J3) 종전엔 `150명`·`80%`·`7일`·`50건`·`<3%` 가 **코드 상수**인데 화면은 병원 목표처럼
  //    그리고 달성률까지 냈다 — 그 목표를 정한 사람은 없다. 기본값을 정책인 척하지 않는다:
  //    비우면 **미설정**이고, 미설정이면 달성률을 만들지 않는다(목표는 경영진이 정한다).
  'exec.target.dailyOutpatients': { key: 'exec.target.dailyOutpatients', value: null, description: '경영 KPI 목표 — 일평균 외래환자(명). 비우면 미설정(달성률을 내지 않는다)', category: 'general' },
  'exec.target.bedOccupancyPct': { key: 'exec.target.bedOccupancyPct', value: null, description: '경영 KPI 목표 — 병상 가동률(%). 비우면 미설정(달성률을 내지 않는다)', category: 'general' },
  'exec.target.avgLosDays': { key: 'exec.target.avgLosDays', value: null, description: '경영 KPI 목표 — 평균 재원일수(일·이하가 목표). 비우면 미설정(달성률을 내지 않는다)', category: 'general' },
  'exec.target.monthlySurgeries': { key: 'exec.target.monthlySurgeries', value: null, description: '경영 KPI 목표 — 월 수술건수(건). 비우면 미설정(달성률을 내지 않는다)', category: 'general' },
  'exec.target.claimReductionPct': { key: 'exec.target.claimReductionPct', value: null, description: '경영 KPI 목표 — 청구 삭감률 상한(%·이하가 목표). 비우면 미설정(달성률을 내지 않는다)', category: 'general' },
  'lab.criticalValue.escalateAfterMinutes': { key: 'lab.criticalValue.escalateAfterMinutes', value: null, description: '위급값 경보 허용시간(분) — 이 시간 안에 확인되지 않은 경보를 ESCALATED 로 표시(크론). 기본 미설정=상향 보고 안 함(허용시간은 위원회·원내 규정이 정한다 — 코드가 30분을 정하지 않는다). 원내 알림 수신자 라우팅은 alert-registry 승인 전이라 발송하지 않고 워크리스트에 표시만', category: 'clinical' },
  'lab.fhirAutoApplyUserId': { key: 'lab.fhirAutoApplyUserId', value: null, description: '외부 LIS FHIR 결과 자동 반영 시 기록될 시스템 서비스계정 User id(UUID). 미설정 시 자동 반영 생략', category: 'clinical' },
  'pharmacy.highAlertDoubleCheck': { key: 'pharmacy.highAlertDoubleCheck', value: 'BLOCK', description: '고위험약/마약류 조제완료 독립 2인확인(ISMP) — OFF|WARN|BLOCK (기본 BLOCK·조제약사≠2차확인자 미충족 시 409)', category: 'clinical' },
  'controlled.stockEnforce': { key: 'controlled.stockEnforce', value: 'BLOCK', description: '마약류 영속재고 부족 불출/폐기 차단 — OFF|WARN|BLOCK (기본 BLOCK·장부 잔량 초과 불출 시 409·실사 불일치는 항상 증인+경보)', category: 'clinical' },
  'bloodbank.issueEnforce': { key: 'bloodbank.issueEnforce', value: 'BLOCK', description: '혈액 출고 안전 게이트(ABO/Rh 적합성·교차시험·유효기간·항체·특수요구) — OFF|WARN|BLOCK (기본 BLOCK·만료는 항상 강제·긴급출고는 교차시험 우회)', category: 'clinical' },
  'bloodbank.inventoryMin': { key: 'bloodbank.inventoryMin', value: 2, description: '혈액 재고 임계 알림 — 제제×혈액형 조합별 최소 AVAILABLE 유닛 수(미만 시 경고·기본 2)', category: 'clinical' },
  'bloodbank.inventoryMinByType': { key: 'bloodbank.inventoryMinByType', value: {}, description: '혈액 재고 임계 제제유형별 차등(JSON, 예 {"PRBC":4,"FFP":2}) — 공통값(bloodbank.inventoryMin) 오버라이드', category: 'clinical' },
  'surgery.signOutEnforce': { key: 'surgery.signOutEnforce', value: 'BLOCK', description: '수술 종료 Sign-Out 게이트(기구·거즈 계수·검체 라벨·IPSG.4) — OFF|WARN|BLOCK (기본 BLOCK·잔류이물 방지)', category: 'clinical' },
  'surgery.siteVerify.enforce': { key: 'surgery.siteVerify.enforce', value: 'OFF', description: '오부위수술 방지 게이트(수술 **예약** 시점 + Sign-In 시 좌우구분 술식 laterality 미기재) — OFF|WARN|BLOCK (기본 OFF). WARN=차단하지 않고 GateViolationLog 기록+화면 경고', category: 'clinical' },
  // 미이행 탐지 요약 상신 — 건당 알림이 아니라 하루 1회 집계 1건(알림 읽음률 8.6% · 거짓 경보는 진짜 경보를 죽인다)
  'surgery.safetyDigest.enabled': { key: 'surgery.safetyDigest.enabled', value: true, description: '수술 안전(IPSG.4) 미이행 일일 요약 상신 — 매일 08:00 관리자에게 1건(미이행 0건이면 미발송)', category: 'clinical' },
  'surgery.safetyDigest.lookbackDays': { key: 'surgery.safetyDigest.lookbackDays', value: 7, description: '수술 안전 미이행 요약의 조회 기간(일) — 기본 7', category: 'clinical' },
  'surgery.countEnforce': { key: 'surgery.countEnforce', value: 'OFF', description: '수술 계수 대조 게이트(종료 시 countStatus=MISMATCH이고 해소기록 없으면 차단·잔류이물) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  // ── 회복실(PACU) 밀착감시 기준 — 원내 정책이 정하는 값이다(코드 폴백은 `pacu.service.ts` PACU_MONITORING_DEFAULTS).
  //    🔴 기본값을 **비워 둔다(null)**. 여기에 15·120·36 을 박으면 `get()` 이 DB 행 없이도 그 수를 돌려주고
  //       `PacuService.getMonitoringSettings` 의 `source` 가 DEFAULT→CONFIG 로 뒤집힌다 — 그러면 회복실 화면
  //       두 곳(`(main)/pacu`·`workstation/post-op`)이 "원내 정책 미설정 — 기본값 적용 중"을 **멈추고**
  //       개발자가 고른 수를 병원이 정한 정책인 것처럼 말한다. 감시 임계 자체는 폴백으로 그대로 유지된다.
  //       (계약 가드: `test/config/defaults-coverage.spec.ts` — 값을 채우면 실패한다)
  // 2026-10-04 간호 스테이션 보드 — 병동 활력 측정 경과 강조 기준. 비우면 **미설정**: 보드는 경과만 보이고 '지연'을 판정하지 않는다(폴백 수 없음)
  'nursing.roster.wardDepartments': { key: 'nursing.roster.wardDepartments', value: null, description: '간호 스테이션 보드 — 근무표 부서 ↔ 병동 연결 { "<병동 id>": ["근무표 부서", ...] }. 비우면 **미설정**(보드는 병원 전체 근무표를 부서와 함께 보인다 · 이름으로 짝짓지 않는다). 보드에서 관리자가 병동별로 고른다', category: 'clinical' },
  'nursing.vitals.boardStaleHours': { key: 'nursing.vitals.boardStaleHours', value: null, description: '간호 스테이션 보드 — 마지막 활력 측정 후 이 시간(시)이 지나면 강조·집계. 비우면 **미설정**(경과만 보이고 지연을 판정하지 않는다 · 기본값 없음). 1~72 정수만 채택', category: 'clinical' },
  // 2026-10-05 수술실 질 지표 — 첫 수술 정시 시작 허용 지연(분). 비우면 **미설정**: 정시율을 내지 않고 지연 분포(중앙값·90분위)만 보인다(기본값 없음)
  'orders.tracking.attentionMin': { key: 'orders.tracking.attentionMin', value: null, description: '오더 실시간 추적 — 발행 이후 이 분이 지나도 끝나지 않은 오더를 "주의"로 표시(긴급도별 · 예 {"STAT":30,"URGENT":60,"ROUTINE":240}). 비우면 **미설정**(경과만 표시 · 지연 판정 안 함)', category: 'clinical' },
  'surgery.qi.firstCaseOnTimeToleranceMin': { key: 'surgery.qi.firstCaseOnTimeToleranceMin', value: null, description: '수술실 질 지표 — 첫 수술 정시 시작으로 볼 허용 지연(분 · 0~120 정수). 비우면 **미설정**(정시율 산출 안 함 · 지연 분포만)', category: 'clinical' },
  'pacu.vitalsIntervalMin': { key: 'pacu.vitalsIntervalMin', value: null, description: '회복실 활력 재측정 주기(분) — 비우면 **미설정**(코드 폴백 15분·ASPAN Phase I q15 적용, 화면이 "원내 정책 미설정"이라 밝힌다). 0 이하·비수치는 미채택하고 폴백 유지', category: 'clinical' },
  'pacu.prolongedStayMin': { key: 'pacu.prolongedStayMin', value: null, description: '회복실 체류 지연 판정 기준(분) — 비우면 **미설정**(코드 폴백 120분·Phase I 통상 60~90분 초과분을 지연 회복으로 표시). 0 이하·비수치는 미채택하고 폴백 유지', category: 'clinical' },
  'pacu.hypothermiaWarnC': { key: 'pacu.hypothermiaWarnC', value: null, description: '회복실 저체온 경고 임계(℃·이 값 미만이면 가온 중재 대상) — 비우면 **미설정**(코드 폴백 36.0℃=정상체온 하한). 35℃ 미만 저체온 경보를 대체하지 않는다. 0 이하·비수치는 미채택하고 폴백 유지', category: 'clinical' },
  // 퇴실 기준(2026-09-30) — 원내 기준은 사람 결정 `pacu.dischargeCriteria`. 비우면 코드 폴백 9(화면이 "원내 기준 미설정"이라 밝힌다)
  'pacu.vitalAlertThresholds': { key: 'pacu.vitalAlertThresholds', value: null, description: '회복실 활력 경보 임계(JSON 부분 덮어쓰기 — 예 {"spo2Low":94,"hrHigh":110}) — 키: spo2Low·hrLow·hrHigh·rrLow·rrHigh·sbpLow·sbpHigh(미만/초과)·tempLow(미만)·tempHigh(이상). 비우면 **미설정**(코드 폴백 SpO2<92·HR<50/>120·RR<8/>24·SBP<90/>180·BT<35/≥38.5 — 활력 정본보다 의도적으로 엄격). 미상 키·범위 밖·짝 역전은 버리고 화면이 밝힌다', category: 'clinical' },
  'pacu.aldrete.dischargeMin': { key: 'pacu.aldrete.dischargeMin', value: null, description: 'PACU 퇴실(병동·ICU) Aldrete 기준 점수(6항목 0~12) — 비우면 **미설정**(코드 폴백 9). 0점 항목이 있으면 총점과 관계없이 미달. 1~12 정수만 채택', category: 'clinical' },
  'pacu.padss.dischargeMin': { key: 'pacu.padss.dischargeMin', value: null, description: 'PACU 귀가(HOME) PADSS 기준 점수(5항목 0~10) — 비우면 **미설정**(코드 폴백 9). 1~10 정수만 채택', category: 'clinical' },
  'asp.enforce': { key: 'asp.enforce', value: 'OFF', description: '항생제 스튜어드십(ASP) 조제 게이트(제한항생제인데 ASP 미승인 시 조제 차단) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'cdss.enforce': { key: 'cdss.enforce', value: 'OFF', description: 'CPOE CDSS 게이트(알레르기 원장·신기능 용량·연령 금기 — DUR 별도) — OFF|WARN|BLOCK (기본 OFF·BLOCK=ERROR 시 overrideCdss 없이 차단·override는 CdssLog에 who/why 감사)', category: 'clinical' },
  'dur.enforce': { key: 'dur.enforce', value: 'BLOCK', description: 'CPOE DUR 게이트(병용금기·임부금기·알레르기·연령·용량 ERROR 시 처방 차단 — create·copy·repeat 전 경로) — OFF|WARN|BLOCK (기본 BLOCK=종전 하드코딩 차단 유지·override는 overrideDur+사유 감사·위반은 GateViolationLog)', category: 'clinical' },
  'preauth.postFacto.autoCancelOnReject': { key: 'preauth.postFacto.autoCancelOnReject', value: 'true', description: '사후승인(우회 발행 소급 결재) 반려 시 발행 처방 자동취소 — true|false (기본 true·이미 시행분은 감사 보존·실패 시 수동 조치 경고 로그)', category: 'clinical' },
  'inpatient.stayBilling.enabled': { key: 'inpatient.stayBilling.enabled', value: false, description: '퇴원 시 입원료 Billing 자동 생성(입원 EDI 청구 P1) — true|false (기본 false·수동은 POST /inpatient/:id/stay-billing 상시 가능)', category: 'billing' },
  'inpatient.bedRateCodes': { key: 'inpatient.bedRateCodes', value: {}, description: '병상등급→입원료 수가코드 매핑(JSON, 예 {"GENERAL":"AB1A0100","ICU":"AJ100"}) — 미매핑 등급은 stayBilling.defaultCode 폴백. 실코드 큐레이션=admin/codes', category: 'billing' },
  'emergency.edBedCount': { key: 'emergency.edBedCount', value: 20, description: '응급실(ED) 병상 수 — NEDOCS 과밀지수 분모(Bed 모델에 응급 구분이 없어 config 정본·기본 20)', category: 'clinical' },
  'emergency.emsKey': { key: 'emergency.emsKey', value: '', description: '119/이송기관 사전통보 수신 키(X-Integration-Key — POST /integration/ems/prenotify) — 미설정 시 fail-closed 401. 발급/회전은 여기서(값은 마스킹 표시)', category: 'integration' },
  'quality.ai.enabled': { key: 'quality.ai.enabled', value: false, description: '데이터 품질 AI 컨시어지(C1 브리핑·C2 중복판별) — 기본 OFF·Human-in-loop(쓰기 0)·집계/최소필드만 전달·ai.server.enabled kill switch 상위 적용', category: 'ai' },
  'quality.snapshot.retentionDays': { key: 'quality.snapshot.retentionDays', value: 365, description: '데이터 품질 스냅샷 보존일(숫자만 저장·개인정보 무포함) — 추이 그래프 소스', category: 'general' },
  'integration.pseudonymizeChartNo': { key: 'integration.pseudonymizeChartNo', value: false, description: 'P0-1 egress 가명화(배치중립 N3) — 외부 발신 이벤트의 chartNo(MRN)를 patientRef(HMAC 앞16hex)로 치환. 기본 OFF(ERP 병행 개시 합의 후 ON·원본/토큰 동시발행 금지)', category: 'integration' },
  'push.genericBody': { key: 'push.genericBody', value: true, description: 'P0-4 FCM 푸시 비식별(배치중립 N3) — 제3자(Google) 경유 페이로드를 제네릭 문구로 치환(상세=앱 내 조회). 기본 ON(안전 기본값)·false=원문 푸시(비권장)', category: 'integration' },
  'integration.cutoverRequireSeparation': { key: 'integration.cutoverRequireSeparation', value: true, description: 'Phase0 컷오버 직무분리(4-eyes) — 승인자≠실행자 강제. 단일 관리자 환경은 false. 보호 config가 아니므로 관리자 조정 가능', category: 'integration' },
  'integration.cutoverApproval': { key: 'integration.cutoverApproval', value: {}, description: 'Phase0 가명화 컷오버 승인 기록(JSON: approvedBy/approvedAt/reason/checklist) — 승인 없이는 pseudonymizeChartNo 플립 불가(법무 승인 게이팅). 관리=관리자>Phase0 컷오버', category: 'integration' },
  'integration.pseudonymKey': { key: 'integration.pseudonymKey', value: '', description: 'patientRef 가명화 HMAC 시크릿(양측 공용 계약 — ERP 대사표 이관 시 동일 키). ON인데 미설정이면 chartNo 제거(fail-closed). 회전은 런북 절차 준수', category: 'integration' },
  'emergency.staleVisitAutoCloseHours': { key: 'emergency.staleVisitAutoCloseHours', value: 0, description: '미종결 응급 방문 자동 종결 기준(시간) — 0=OFF(기본). 예 168=7일 경과한 미완료 방문을 매일 새벽 COMPLETED 처리(NEDOCS 왜곡 방지·처분 미지정은 DISCHARGE). 실환자 운영은 신중히', category: 'clinical' },
  'er.cleaning.slaMinutes': { key: 'er.cleaning.slaMinutes', value: 30, description: 'ER 베드 청소 SLA(분) — CLEANING 경과가 초과하면 베드 보드에 청소 지연 표시. 청소완료(→가용) 전환은 사람 판단이라 수동(ER 베드 보드 P1)', category: 'clinical' },
  'er.boarding.warnMinutes': { key: 'er.boarding.warnMinutes', value: 120, description: 'ER 입원대기(boarding) 경고 기준(분) — 입원 결정 후 병상 배정까지 경과가 초과하면 베드 카드 경고. 병상 회전 압박의 근거 데이터(ER 베드 보드 P1)', category: 'clinical' },
  'er.reception.separated': { key: 'er.reception.separated', value: true, description: '응급 원무(접수 전용) 분리 운영(D10) — true=베드 보드에 접수 트랙 패널(신원 확인 중·보호자 미등록), false=일반 접수 데스크에 응급 도착 배너. 화면 흐름만 바꾸고 데이터 정본은 동일', category: 'clinical' },
  'er.registration.guardianGate': { key: 'er.registration.guardianGate', value: 'WARN', description: '응급 접수 보호자 등록 게이트(D11) — WARN=보호자 미등록 재실 환자를 접수 트랙에 표시(진료는 막지 않음·KTAS 1·2 선진료 원칙), OFF=표시 안 함. BLOCK 없음', category: 'clinical' },
  'er.bedDisplay.nameMasking': { key: 'er.bedDisplay.nameMasking', value: false, description: 'ER 베드사이드 디스플레이 환자명 마스킹(P2) — false=실명(베드 곁 본인 확인 목적·기본), true=홍*동(공용 벽면 겸용 시). 서버 적용 — URL 로 우회 불가', category: 'clinical' },
  'er.bedDisplay.fields': { key: 'er.bedDisplay.fields', value: { allergies: true, fallRisk: true, doctor: true, complaint: true, mrn: true, guardian: true }, description: 'ER 베드사이드 디스플레이 표시 필드(P2·MAP) — 병원 정책별 항목 온오프(예: 주호소 비노출). 서버에서 필터링', category: 'clinical' },
  'er.reassessNotify.enabled': { key: 'er.reassessNotify.enabled', value: false, description: 'ER KTAS 재평가 지연 담당의 알림 크론(P3) — 기본 OFF(보드 배지가 1차). ON 시 10분 주기·방문당 60분 dedupe. 기준=qi.targets.ktasReassessMin', category: 'clinical' },
  'reception.staleQueueAutoCloseHours': { key: 'reception.staleQueueAutoCloseHours', value: 0, description: '묵은 외래 대기 자동 마감 기준(시간) — 0=OFF(기본). 예 24=하루 넘게 대기(WAITING/CALLED)인 접수를 매일 새벽 미방문(NO_SHOW) 처리. 대기 인원·평균 대기시간·상황판 왜곡 방지(진료중·수납대기는 대상 아님)', category: 'clinical' },

  // ══ 2026-08-03 일괄 등재 — 코드가 읽는데 DEFAULTS 에 없어 관리 화면에 뜨지 않던 48키 ══
  // 설명은 각 호출부 실측 기반(추정 금지). 기본값은 코드의 폴백값과 동일하게 맞춘다 —
  // 다르면 "화면에 보이는 기본"과 "실제 동작 기본"이 갈라진다.
  // ── 예약·접수 ──
  'appointment.autoAssign': { key: 'appointment.autoAssign', value: true, description: '의사 미지정 예약 자동배정(부하 기준) — 기본 ON. OFF 면 doctorId 필수', category: 'clinical' },
  'appointment.checkinCreatesQueue': { key: 'appointment.checkinCreatesQueue', value: true, description: '예약 체크인 시 진료 대기열 자동 생성 — 기본 ON', category: 'clinical' },
  'appointment.staffAutoConfirm': { key: 'appointment.staffAutoConfirm', value: true, description: '직원 접수 예약 즉시 확정(CONFIRMED) — 기본 ON. OFF 면 별도 확정 필요', category: 'clinical' },
  'appointment.reminder.send': { key: 'appointment.reminder.send', value: false, description: '예약 알림 실발송 — 기본 OFF(시뮬 로그만). ON 은 SMS/카카오 어댑터 계약 후(현재 어댑터 미구현)', category: 'clinical' },
  // ── 입원·병상 ──
  'bed.cleaningOnDischarge': { key: 'bed.cleaningOnDischarge', value: false, description: '퇴원 병상을 청소중(CLEANING)으로 전환 — 기본 OFF(즉시 AVAILABLE). ON 이면 청소 완료 처리 후 배정 가능', category: 'clinical' },
  'inpatient.dailyRate': { key: 'inpatient.dailyRate', value: 50000, description: '입원료 기본 일당(원) — 병상등급 수가(inpatient.bedRates) 미해당 시 폴백', category: 'billing' },
  'inpatient.bedRates': { key: 'inpatient.bedRates', value: null, description: '병상등급별 일당(원) JSON — 예 {"GENERAL":50000,"ICU":150000}. 미설정 시 dailyRate 폴백', category: 'billing' },
  // 🔴 2026-10-22 소비처 0 — 중간정산이 자격 정본 급여율(퇴원 입원료 청구와 같은 함수)로 바뀌었다 · 설정 화면이 '쓰이지 않음'을 말한다
  'inpatient.insuranceRate': { key: 'inpatient.insuranceRate', value: 0.8, description: '(쓰이지 않음 — 2026-10-22부터 자격별 급여율) 입원료 보험 부담률', category: 'billing' },
  // ── 청구 ──
  'billing.autoRecalcOnAmend': { key: 'billing.autoRecalcOnAmend', value: false, description: '진료 정정(amend) 시 청구 자동 재계산 — 기본 OFF', category: 'billing' },
  'billing.copayCap.preCoverageEnabled': { key: 'billing.copayCap.preCoverageEnabled', value: false, description: '본인부담상한 사전급여 — 기본 OFF. ON 이어도 소득분위가 확정(explicit)된 환자만 적용(추정분위 미적용)', category: 'billing' },
  // ── 임상 연계 ──
  'clinical.diagnosisToProblem': { key: 'clinical.diagnosisToProblem', value: false, description: '진단 입력 시 문제목록(Problem List) 자동 반영 — 기본 OFF(옵트인)', category: 'clinical' },
  'preOrder.autoActivation': { key: 'preOrder.autoActivation', value: false, description: '사전처방 자동 발효 — 기본 OFF(승인 시 DUR 재검증 수동 발효)', category: 'clinical' },
  'preauth.approvalValidHours': { key: 'preauth.approvalValidHours', value: 72, description: '사전승인 유효시간 — 승인 후 이 시간 내 발행만 인정(기본 72h·0=무제한)', category: 'clinical' },
  'treatmentSchedule.reminder': { key: 'treatmentSchedule.reminder', value: false, description: '치료 일정 내일분 리마인더 발송 — 기본 OFF', category: 'clinical' },
  // ── 간호 AI ──
  'nursing.aiAssist.enabled': { key: 'nursing.aiAssist.enabled', value: false, description: '간호기록 AI 보조(초안 생성) — 기본 OFF. Human-in-loop(검토·서명은 간호사)', category: 'ai' },
  'nursing.aiAssist.wards': { key: 'nursing.aiAssist.wards', value: [], description: 'AI 보조 파일럿 병동명 배열 — 빈 배열=전체 허용', category: 'ai' },
  // ── 근무 ──
  'duty.maxWeeklyHours.doctor': { key: 'duty.maxWeeklyHours.doctor', value: 80, description: '주당 근무시간 상한(의사) — 근무표 검증 기준(기본 80h·전공의법)', category: 'general' },
  'duty.maxWeeklyHours.other': { key: 'duty.maxWeeklyHours.other', value: 52, description: '주당 근무시간 상한(그 외 직군) — 기본 52h(근로기준법)', category: 'general' },
  // ── ESS·온보딩 ──
  'ess.approval.reminder.enabled': { key: 'ess.approval.reminder.enabled', value: false, description: '결재 지연 리마인더 크론 — 기본 OFF', category: 'general' },
  'ess.approval.remindAfterDays': { key: 'ess.approval.remindAfterDays', value: 2, description: '결재 리마인더 기준(일) — 기안 후 이 일수 경과 시 결재자 알림', category: 'general' },
  'ess.approval.escalateAfterDays': { key: 'ess.approval.escalateAfterDays', value: 4, description: '결재 에스컬레이션 기준(일) — 경과 시 상위 보고', category: 'general' },
  'ess.leave.unified': { key: 'ess.leave.unified', value: false, description: '휴가 신청 통합 모드 — ON 이면 근무표측 휴가 신청을 막고 ESS 휴가로 일원화', category: 'general' },
  'ess.payrollRelay.enabled': { key: 'ess.payrollRelay.enabled', value: false, description: '급여 기초정보 ERP 릴레이 — 주민번호는 HIS 미보관·ERP 로 릴레이(운영 활성 이력 있음 — DB 값 우선)', category: 'general' },
  'ess.team.leaveWarnRatio': { key: 'ess.team.leaveWarnRatio', value: 0.3, description: '팀 동시 휴가 경고 비율(0~1) — 같은 날 팀원 휴가가 이 비율을 넘으면 경고(기본 0.3)', category: 'general' },
  'onboarding.fourEyes': { key: 'onboarding.fourEyes', value: true /* 공개판: 기본 켬 */, description: '계정 개통 4-eyes 승인 — ON 이면 관리자 승인(ACCOUNT_BOOT) 없이 개통 불가', category: 'security' },
  'onboarding.welcome': { key: 'onboarding.welcome', value: null, description: '온보딩 웰컴 콘텐츠 JSON({version,locales,sections}) — 미설정 시 빈 콘텐츠', category: 'general' },
  // ── 포털 ──
  'portal.selfBooking': { key: 'portal.selfBooking', value: false, description: '환자 포털 셀프 예약 — 기본 OFF', category: 'portal' },
  'portal.aiDrugExplain': { key: 'portal.aiDrugExplain', value: false, description: '포털 복약 AI 설명 — 기본 OFF', category: 'portal' },
  'portal.insuranceDocBundle': { key: 'portal.insuranceDocBundle', value: false, description: '실손보험 서류 세트 발급 — 기본 OFF', category: 'portal' },
  // ── 연동(FHIR·ERP·이메일) ──
  'fhir.serviceRequestInbound.enabled': { key: 'fhir.serviceRequestInbound.enabled', value: false, description: '외부 FHIR ServiceRequest 인바운드 수용 — 기본 OFF(차단)', category: 'integration' },
  'fhir.pathologyEdiPrefixes': { key: 'fhir.pathologyEdiPrefixes', value: null, description: '병리 오더 판정 EDI 접두어 배열 — 미설정 시 내장 기본 접두어 사용', category: 'integration' },
  // 🔴 서명 검증은 fail-closed 가 기본이다 — OFF 면 서명 없이도 수용한다(이 저장소가 이미 겪은 fail-open 유형)
  'erp.financeWebhookEnforce': { key: 'erp.financeWebhookEnforce', value: true, description: 'ERP 재무 웹훅 서명 검증 강제 — OFF 면 서명 없이도 수용(fail-open). 🔴 상시 ON 요구사항', category: 'integration' },
  'erp.financeWebhookLegacyAccept': { key: 'erp.financeWebhookLegacyAccept', value: false, description: 'ERP 재무 웹훅 구(舊) 서명 형식 병행 수용 — 마이그레이션 창에서만 ON', category: 'integration' },
  'erp.piiReadStrict': { key: 'erp.piiReadStrict', value: false, description: 'ERP 개인정보 조회 전용키 강제 — ON 이면 piiReadKey 없는 조회 거부', category: 'integration' },
  // 🔴 CRM 범용 이메일(Nodemailer/SMTP) — 코드가 읽는데 DEFAULTS 에 없어 화면에 뜨지 않았고,
  //    직접 SQL 말고는 켤 방법이 없었다(2026-08-27 등재). `null`=미설정 = 지금 상태 그대로
  //    (`host` 가 비면 발송 코드는 로그만 남기는 시뮬레이션이고, 대외 발신 관제도 '안 나감'으로 읽는다).
  // 🔴 이 값을 채우면 **실제로 메일이 나간다**(대외 발신 3조건 중 '설정'). 그리고 아래 경고를 지키지 않으면
  //    비밀번호가 노출된다 — 설정 응답 마스킹은 **키 이름**(*secret/*password/*token/*Key)으로만 판정하므로
  //    `smtp.config` 안의 `pass` 는 마스킹되지 않고 로그인한 전 직원이 GET /api/v1/config 로 볼 수 있다.
  'smtp.config': { key: 'smtp.config', value: null, description: 'CRM 이메일 발송 SMTP 설정(JSON) — 비우면 발송하지 않고 로그만 남긴다(시뮬레이션). 형식 {"host":"smtp.example.com","port":587,"from":"보내는이 <noreply@…>"} · host 가 있어야 실제로 나간다(port 465=SSL). 🔴 인증(user/pass)도 코드는 읽지만 **이 키는 응답 마스킹 대상이 아니라** 저장하면 로그인한 전 직원에게 비밀번호가 보인다 — 마스킹 보강 전에는 인증 정보를 넣지 말 것', category: 'integration' },
  'email.provider': { key: 'email.provider', value: 'SIMULATION', description: '검진권 이메일 발송 채널 — SIMULATION(로그만)/RESEND. RESEND 는 email.resendApiKey 필요', category: 'integration' },
  'email.from': { key: 'email.from', value: 'WERUBYHOSP 검진권 <noreply@example.org>', description: '검진권 이메일 발신자 표기', category: 'integration' },
  'email.dealerPortalUrl': { key: 'email.dealerPortalUrl', value: '', description: '딜러 포털 URL(이메일 링크) — 빈값이면 공개 base URL + /distributor', category: 'integration' },
  // ── 시크릿(응답 마스킹 자동 적용: *key/*secret/*token 패턴) — 값은 화면에서 ••••로 표시 ──
  'edu.integrationKey': { key: 'edu.integrationKey', value: '', description: 'edu(교육/SQE) 연동 인증키 — 빈값=연동 비활성', category: 'integration' },
  // 🔴 외부 점검 — 이 셋이 DEFAULTS 에 없어서 `PUT /config/edu.url` 이 `category=general` 로 저장됐고,
  //    런처가 읽는 `?category=integration` 목록에 나타나지 않아 **설정 화면으로 고칠 길이 없었다**.
  //    그 사이 런처는 코드에 박힌 다른 기관 도메인으로 staff-token(10분)을 URL 에 실어 열고 있었다.
  'edu.enabled': { key: 'edu.enabled', value: true, description: '사내교육(edu) 런처 노출 — 주소(edu.url)가 비어 있으면 켜져 있어도 버튼은 나오지 않는다', category: 'integration' },
  'edu.url': { key: 'edu.url', value: '', description: 'edu 기준 주소(예: https://edu.example.org) — 🔴 미설정이면 런처를 숨긴다(기본 도메인으로 토큰을 보내지 않는다)', category: 'integration' },
  'edu.ssoPath': { key: 'edu.ssoPath', value: '/sso', description: 'edu SSO 진입 경로(기준 주소 뒤에 붙는다)', category: 'integration' },
  'lis.integrationKey': { key: 'lis.integrationKey', value: '', description: 'LIS 연동 인증키(md5 대조) — 빈값=연동 비활성', category: 'integration' },
  'erp.financeWebhookSecret': { key: 'erp.financeWebhookSecret', value: '', description: 'ERP 재무 웹훅 HMAC 시크릿', category: 'integration' },
  'erp.payrollHmacKey': { key: 'erp.payrollHmacKey', value: '', description: '급여 릴레이 HMAC 키', category: 'integration' },
  'erp.piiReadKey': { key: 'erp.piiReadKey', value: '', description: 'ERP 개인정보 조회 전용키(디렉터리 조회)', category: 'integration' },
  'erp.signOriginationKey': { key: 'erp.signOriginationKey', value: '', description: 'sign 발신 검증키(ERP 발 문서 서명 요청)', category: 'integration' },
  'ess.targetTokenSecret': { key: 'ess.targetTokenSecret', value: '', description: 'ESS 대상자 토큰 서명 시크릿(X-Target-Token)', category: 'security' },
  'integration.inboundWebhookSecret': { key: 'integration.inboundWebhookSecret', value: '', description: '외부 인바운드 웹훅 공용 시크릿', category: 'integration' },
  'email.resendApiKey': { key: 'email.resendApiKey', value: '', description: 'Resend 이메일 API 키(email.provider=RESEND 시)', category: 'integration' },
  'fx.bokApiKey': { key: 'fx.bokApiKey', value: '', description: '한국은행 환율 API 키(외화 voucher 환산)', category: 'integration' },
  'sign.allowedHosts': { key: 'sign.allowedHosts', value: [], description: 'sign 서비스 SSRF 허용 호스트 배열 — 빈 배열=내장 기본. **완화 방향 수정 주의**(허용 확대는 보안 검토 후)', category: 'security' },
  // 🔴 의무기록·제증명 수수료 오버라이드 — 코드가 읽는데 DEFAULTS 에 없어 화면에 뜨지 않았다(2026-08-27 등재).
  //    값 `null` = **미설정**이며, 이것이 "행 없음"과 정확히 같은 상태다(둘 다 코드 기본표 DEFAULT_FEE_RULES 적용·
  //    영수증/견적의 `ruleSource` 가 'DEFAULT' 로 표시된다). 여기에 기본표를 박아 넣지 않는 이유는
  //    저장하는 순간 `ruleSource` 가 'CONFIG'(=기관이 정한 금액)로 뒤집혀 화면이 거짓말하기 때문이다.
  'medical_record.fee_rules': {
    key: 'medical_record.fee_rules', value: null, category: 'billing',
    description: `의무기록 사본·제증명 발급 수수료 오버라이드(JSON·type 별 부분 병합) — 비우면(null) 코드 기본표 적용: ${Object.entries(DEFAULT_FEE_RULES).map(([t, r]) => `${r.label} ${r.pageTier ? `${r.pageTier.firstUnit}원/매(${r.pageTier.firstQty}매 초과 ${r.pageTier.nextUnit}원)` : `${r.base}원`}`).join(' · ')}. 형식 {"DIAGNOSIS_CERT":{"label":"진단서(일반)","base":20000,"perExtraCopy":1000}} · 사본류는 pageTier{firstQty,firstUnit,nextUnit} 누진. 🔴 값을 넣으면 영수증·견적의 산출근거가 '기관 설정(CONFIG)'으로 표시된다`,
  },
  'inpatient.stayBilling.defaultCode': { key: 'inpatient.stayBilling.defaultCode', value: 'AB1A0100', description: '입원료 기본 수가코드(bedRateCodes 미매핑 시) — 기본 AB1A0100(상급종합 6인실 입원료·큐레이션 전 임시값)', category: 'billing' },
  'pharmacy.durGate.enforce': { key: 'pharmacy.durGate.enforce', value: 'OFF', description: '약국 조제 DUR 게이트(미해결 DUR 경고 처방은 오버라이드 사유 없이 조제 불가·§37) — OFF|WARN|BLOCK (기본 OFF·구 true/false 값은 true=BLOCK 호환·위반은 GateViolationLog)', category: 'clinical' },
  'obgyn.newbornId.enforce': { key: 'obgyn.newbornId.enforce', value: 'OFF', description: '신생아 식별밴드 게이트(밴드 없이 신생아 등록 거부·모아 오식별 방지) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'immunization.enforce': { key: 'immunization.enforce', value: 'OFF', description: '예방접종 검증 게이트(로트번호 필수·차수/간격 위반 차단) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'transplant.compatEnforce': { key: 'transplant.compatEnforce', value: 'BLOCK', description: '장기이식 적합성 게이트(ABO·교차시험 음성·장기유형·기증자 승인) — OFF|WARN|BLOCK (기본 BLOCK)', category: 'clinical' },
  'radiation.doseEnforce': { key: 'radiation.doseEnforce', value: 'BLOCK', description: '방사선 조사 과선량 게이트(분할선량 ±10%·누적선량 총선량 초과) — OFF|WARN|BLOCK (기본 BLOCK)', category: 'clinical' },
  'radiation.igrtEnforce': { key: 'radiation.igrtEnforce', value: 'OFF', description: '방사선 IGRT 게이트(IMRT/VMAT/SBRT 등 영상유도 필요 기법인데 셋업검증 미완 시 조사 차단·오부위 RT) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'imaging.contrastEnforce': { key: 'imaging.contrastEnforce', value: 'OFF', description: '영상 조영제 안전게이트(조영제 알레르기 이력·eGFR<30 신독성) — OFF|WARN|BLOCK (기본 OFF·BLOCK=overrideSafety 없이 시행 차단·override는 safetyChecks에 감사)', category: 'clinical' },
  'imaging.pregnancyEnforce': { key: 'imaging.pregnancyEnforce', value: 'OFF', description: '영상 임신확인 게이트(가임기 여성 전리방사선 검사 — PREGNANT=차단·미확인=경고) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  // ── 네이티브 앱 운영 설정(CONFIG-01) — 🔴 미설정을 "제한 없음"으로 지어내지 않는다(값 없으면 null 로 응답) ──
  'mobile.patient.release': { key: 'mobile.patient.release', value: {}, description: '환자 앱 최소/최신 버전·업데이트 정책 — { minimumVersion, latestVersion, updatePolicy: OPTIONAL|RECOMMENDED|REQUIRED }. 비어 있으면 앱은 강제 업데이트를 걸지 않는다', category: 'mobile' },
  'mobile.staff.release': { key: 'mobile.staff.release', value: {}, description: '스탭 앱 최소/최신 버전·업데이트 정책 — 환자 앱과 동일 구조', category: 'mobile' },
  'mobile.maintenance': { key: 'mobile.maintenance', value: { enabled: false }, description: '모바일 점검 모드 — { enabled, message, endsAt }. 켜면 앱이 점검 안내를 띄운다(권한 통제를 대신하지 않는다)', category: 'mobile' },
  'imaging.doseAlertMsv': { key: 'imaging.doseAlertMsv', value: 100, description: '진단 피폭 누적선량 경보기준(mSv·최근 1년) — 초과 시 촬영 시 경고 표출(차단 아님)', category: 'clinical' },
  'psychiatry.seclusionEnforce': { key: 'psychiatry.seclusionEnforce', value: 'WARN', description: '§75 격리·강박 지시자 정신건강의학과 전문의 게이트 — OFF|WARN|BLOCK (기본 WARN·법정 최대시간 격리12h/강박4h은 모드 무관 항상 산출·중복지시 항상 차단)', category: 'clinical' },
  'psychiatry.ectConsentEnforce': { key: 'psychiatry.ectConsentEnforce', value: 'BLOCK', description: 'ECT 처방 동의 게이트(서명된 유효 동의서 필수) — OFF|WARN|BLOCK (기본 BLOCK·신규 기능이라 기존 운영 영향 없음)', category: 'clinical' },
  'rehab.sessionGate': { key: 'rehab.sessionGate', value: 'OFF', description: '재활치료 세션 시작 안전게이트(낙상 Berg<21·활력징후 hold: SBP>180/<90·HR>120/<50·SpO2<90·발열≥38) — OFF|WARN|BLOCK (기본 OFF·BLOCK=overrideGate 없이 보류·safetyChecks 감사 영속)', category: 'clinical' },
  'patient.supportedLanguages': { key: 'patient.supportedLanguages', value: [
    { code: 'ko', label: '한국어' }, { code: 'en', label: 'English' }, { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' }, { code: 'ru', label: 'Русский' }, { code: 'vi', label: 'Tiếng Việt' },
    { code: 'mn', label: 'Монгол' }, { code: 'ar', label: 'العربية' }, { code: 'th', label: 'ไทย' }, { code: 'kk', label: 'Қазақша' },
  ], description: '지원 언어 마스터 — 외국인 등록 선호언어·언어별 동의서 템플릿의 단일 소스. 관리자 화면(동의서 템플릿 관리)에서 추가/삭제', category: 'patient' },
  'cssd.biCiEnforce': { key: 'cssd.biCiEnforce', value: 'OFF', description: 'CSSD 멸균 BI/CI 게이트(생물학적·화학적 지표 PASS 없이 STERILE 확정 차단·비멸균 출고) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'dialysis.ufRateEnforce': { key: 'dialysis.ufRateEnforce', value: 'OFF', description: '투석 UF율 게이트(시간당 제수율 mL/kg/hr 상한 초과 시 처방 차단·투석중 저혈압) — OFF|WARN|BLOCK (기본 OFF)', category: 'clinical' },
  'cssd.sterileValidDays': { key: 'cssd.sterileValidDays', value: 30, description: '멸균 유효기간(일)', category: 'cssd' },
  'inventory.alertThreshold': { key: 'inventory.alertThreshold', value: 10, description: '안전재고 기본값', category: 'inventory' },
  'inventory.expiryIssueEnforce': { key: 'inventory.expiryIssueEnforce', value: 'WARN', description: '만료/리콜 LOT 불출 게이트 — OFF|WARN|BLOCK (기본 WARN). 만료/리콜 LOT은 모드 무관 FEFO 소진에서 항상 제외·LOT 직접 지정 출고는 WARN 이상에서 차단. BLOCK=유효 LOT 부족+만료 잔존 시 불출 자체 차단', category: 'inventory' },
  'equipment.useEnforce': { key: 'equipment.useEnforce', value: 'WARN', description: '사용중지 장비(BROKEN/UNDER_MAINTENANCE/RETIRED) 사용일지 게이트 — OFF|WARN|BLOCK (기본 WARN). 점검 FAIL 시 자동 사용중지 전환은 항상 동작', category: 'inventory' },
  // emr.locale 은 폐기(2026-09-06 ui-locale-i18n P0) — 소비처 0 이던 키. 정본은 hospital.defaultUiLocale + UserUiPreference.uiLocale.
  // 약국 설정
  'pharmacy.defaultType': { key: 'pharmacy.defaultType', value: 'INTERNAL', description: '기본 조제 유형 (INTERNAL|EXTERNAL)', category: 'pharmacy' },
  'pharmacy.externalEnabled': { key: 'pharmacy.externalEnabled', value: true, description: '원외 처방 허용 여부', category: 'pharmacy' },
  'pharmacy.rxValidDays': { key: 'pharmacy.rxValidDays', value: 3, description: '원외 처방전 유효일수', category: 'pharmacy' },
  // 블록체인 인증서 정책
  'blockchain.allowedAlgorithms': { key: 'blockchain.allowedAlgorithms', value: ['ECDSA_P256', 'RSA_2048'], description: '허용 서명 알고리즘', category: 'blockchain' },
  'blockchain.pinLength': { key: 'blockchain.pinLength', value: 6, description: 'PIN 자릿수', category: 'blockchain' },
  'blockchain.pinLockAttempts': { key: 'blockchain.pinLockAttempts', value: 5, description: 'PIN 잠금 실패 횟수', category: 'blockchain' },
  'blockchain.pinLockMinutes': { key: 'blockchain.pinLockMinutes', value: 10, description: 'PIN 잠금 시간(분)', category: 'blockchain' },
  'blockchain.pinAutoSuspendAttempts': { key: 'blockchain.pinAutoSuspendAttempts', value: 10, description: 'PIN 자동정지 실패 횟수', category: 'blockchain' },
  'blockchain.anchorInterval': { key: 'blockchain.anchorInterval', value: '1h', description: '블록체인 앵커링 주기', category: 'blockchain' },
  // 제로 트러스트 단말 보안(terminal-zero-trust) — blockchain.pin*(인증서 서명PIN)과 별개 네임스페이스
  'terminal.pin.length': { key: 'terminal.pin.length', value: 6, description: '데일리 PIN 자릿수', category: 'terminal' },
  'terminal.pin.lockAttempts': { key: 'terminal.pin.lockAttempts', value: 5, description: '데일리 PIN 실패 잠금 횟수', category: 'terminal' },
  'terminal.pin.lockMinutes': { key: 'terminal.pin.lockMinutes', value: 10, description: '데일리 PIN 잠금 시간(분)', category: 'terminal' },
  'terminal.lock.publicSec': { key: 'terminal.lock.publicSec', value: 180, description: '공용 단말 미입력 잠금(초)', category: 'terminal' },
  'terminal.lock.privateSec': { key: 'terminal.lock.privateSec', value: 600, description: '전용 단말 미입력 잠금(초)', category: 'terminal' },
  'terminal.draft.ttlSec': { key: 'terminal.draft.ttlSec', value: 1800, description: 'Atomic Draft 보존(초)', category: 'terminal' },
  'staffPortal.platform': { key: 'staffPortal.platform', value: 'WEB', description: '스탭 생체인증 포털 플랫폼 (WEB=개발|APP=운영 전용앱)', category: 'terminal' },
  'terminal.failmode.highRisk': { key: 'terminal.failmode.highRisk', value: 'fail-secure', description: '네트워크/Redis 장애 시 고위험 행위 정책', category: 'terminal' },
  'terminal.failmode.lowRisk': { key: 'terminal.failmode.lowRisk', value: 'grace', description: '네트워크/Redis 장애 시 저위험 조회 정책', category: 'terminal' },
  'terminal.failmode.graceSec': { key: 'terminal.failmode.graceSec', value: 300, description: '네트워크 단절 grace 유예(초)', category: 'terminal' },
  // 데이터 보유/파기(security-governance G1) — 전역 파기 스위치(기본 false=DRY-RUN만, 법무 확정 후 활성)
  'retention.purgeEnabled': { key: 'retention.purgeEnabled', value: false, description: '데이터 실제 파기 전역 활성(false=DRY-RUN 리포트만)', category: 'retention' },
  'blockchain.patientCertPolicy': { key: 'blockchain.patientCertPolicy', value: 'manual', description: '환자 인증서 발급 정책 (manual|auto-verified|auto-email|auto-all)', category: 'blockchain' },
  // sign 단독발급 전환 게이트. true=HIS 자체 minting 허용(레거시·SIMULATION), false=폐지(sign 위임·EXTERNAL).
  //  false 시 BlockchainCertService.issue()·portal.requestCertificate()·cert-admin 발급이 SELF_ISSUANCE_DISABLED.
  'blockchain.selfIssuanceEnabled': { key: 'blockchain.selfIssuanceEnabled', value: true, description: 'HIS 자체 인증서 발급 허용 (false=sign 단독발급 위임)', category: 'blockchain' },
  'blockchain.autoIssuePolicy': {
    key: 'blockchain.autoIssuePolicy',
    value: {
      admission: false,
      discharge: false,
      surgeryConsent: false,
      prescriptionSign: false,
      labReport: false,
    },
    description: '이벤트별 인증서 자동발급 정책',
    category: 'blockchain',
  },

  // ── VoC(고객의 소리) — voc-service.plan.md ──
  'voc.enabled': { key: 'voc.enabled', value: true, description: 'VoC 접수 활성', category: 'voc' },
  'voc.allowAnonymous': { key: 'voc.allowAnonymous', value: true, description: '비회원(본인확인 실패) 문의 허용', category: 'voc' },
  'voc.autoCloseDays': { key: 'voc.autoCloseDays', value: 7, description: 'ANSWERED 후 환자 무응답 자동 종결(일)', category: 'voc' },
  'voc.sla.QUESTION': { key: 'voc.sla.QUESTION', value: 2, description: '질문 SLA(영업일)', category: 'voc' },
  'voc.sla.COMPLAINT': { key: 'voc.sla.COMPLAINT', value: 1, description: '불만 SLA(영업일)', category: 'voc' },
  'voc.sla.SUGGESTION': { key: 'voc.sla.SUGGESTION', value: 5, description: '건의 SLA(영업일)', category: 'voc' },
  'voc.sla.COMPLIMENT': { key: 'voc.sla.COMPLIMENT', value: 3, description: '칭찬 회신 SLA(영업일)', category: 'voc' },
  'voc.routing': { key: 'voc.routing', value: {}, description: '카테고리→부서 매핑(JSON)', category: 'voc' },
  'voc.consult.autoOnlineOnLogin': { key: 'voc.consult.autoOnlineOnLogin', value: true, description: '데스크 로그인 시 상담원 ONLINE 자동전환(D1)', category: 'voc' },
  'voc.consult.offlineFallback': { key: 'voc.consult.offlineFallback', value: true, description: '온라인 상담원 0명/시간외 → 비동기 접수 폴백(D1/D2)', category: 'voc' },
  // 🔴 상담 운영 정책 — 종전엔 **환경변수**였고 운영 .env 에 **하나도 설정돼 있지 않았다**.
  //    즉 영업시간·SLA 임계가 화면 어디에도 없는 코드 상수였다(형제인 voc.sla.* 는 화면에 있다).
  //    규약: "기준값이 원내 정책이면 config 로 두고 미설정임을 밝힌다."
  //    🔴 **기본값은 전부 종전 동작과 같다** — 배포만으로 운영이 달라지지 않는다.
  'voc.consult.hourStart': { key: 'voc.consult.hourStart', value: 9, description: '상담 영업 시작 시각(0~23·서버시각) — 이 시각부터 실시간 상담을 받는다', category: 'voc' },
  'voc.consult.hourEnd': { key: 'voc.consult.hourEnd', value: 18, description: '상담 영업 종료 시각(1~24·서버시각·미만) — 평일만 적용(주말은 시간과 무관하게 영업시간 밖)', category: 'voc' },
  'voc.consult.slaWarnSec': { key: 'voc.consult.slaWarnSec', value: 300, description: '상담 미응답 경고 임계(초) — 초과 시 담당자 알림', category: 'voc' },
  'voc.consult.slaEscalateSec': { key: 'voc.consult.slaEscalateSec', value: 900, description: '상담 미응답 에스컬레이션 임계(초) — 초과 시 팀장 상신. 경고 임계보다 커야 한다', category: 'voc' },
  'voc.consult.autoClassify': { key: 'voc.consult.autoClassify', value: false, description: '첫 환자 메시지의 문의 유형을 AI 가 자동 분류·재라우팅 — 기본 OFF(분류가 틀리면 엉뚱한 담당자에게 간다)', category: 'voc' },
  'voc.ai.enabled': { key: 'voc.ai.enabled', value: false, description: 'VoC AI 마스터(기본 OFF·Human-in-loop)', category: 'voc' },
  'voc.ai.classify': { key: 'voc.ai.classify', value: false, description: 'C1 자동 분류', category: 'voc' },
  'voc.ai.autoReply': { key: 'voc.ai.autoReply', value: false, description: 'C2 즉답 초안', category: 'voc' },
  'voc.ai.replyAssist': { key: 'voc.ai.replyAssist', value: false, description: 'C3 답변 초안 보조', category: 'voc' },
  'voc.ai.translate': { key: 'voc.ai.translate', value: false, description: 'C4 다국어', category: 'voc' },
  'voc.ai.cluster': { key: 'voc.ai.cluster', value: false, description: 'C5 유사문의 클러스터', category: 'voc' },
};

// ── 수치 표시 정밀도(ui.precision.*) — numeric-policy 레지스트리 비잠금 도메인만 관리 노출.
//    잠금(법정·안전: 금액·본인부담·검사·BSA·재원일·만나이)은 config 로 열지 않는다(위원회 의결로만).
//    "체온 소수 2자리" 같은 규칙을 관리 화면에서 이 키로 조정 → FE formatNum override 반영.
for (const p of Object.values(NUMERIC_POLICIES)) {
  if (p.locked || p.decimals == null) continue;
  DEFAULTS[`ui.precision.${p.key}`] = {
    key: `ui.precision.${p.key}`,
    value: p.decimals,
    description: `${p.label} 표시 소수 자릿수 (기본 ${p.decimals}·${p.standard ?? '표준'} 정렬) — 화면·formatNum 공통 적용`,
    category: 'ui',
  };
}

/**
 * 🔴 범용 설정 목록이 **절대 담지 않는** 카테고리 — 전용 EP·화면(접근 권한 관리)이 관리한다.
 *    `GET /api/v1/config` 는 역할 가드가 없다(전 직원 읽기). 여기에 접근제어 행이 섞이면
 *    저권한 계정이 ACL 을 통째로 읽는다. 그래서 **카테고리 파라미터로도 뚫리면 안 된다.**
 */
export const CONFIG_LIST_EXCLUDED_CATEGORIES = ['access', 'role-data-access'] as const;

/**
 * AI 프롬프트용 병원 정보 문단 — 라벨은 설정 정본(DEFAULTS.description)을 쓴다(라벨 사본을 두지 않는다).
 * 키·DB 행 전용 판독은 `./hospital-facts`(순환 없는 순수 파일) — 여기서 다시 내보내 호출부 import 를 하나로 둔다.
 */
export function formatHospitalContext(facts: HospitalFacts): string {
  return formatHospitalContextWith(facts, (k) => DEFAULTS[k]?.description ?? k);
}
export { HOSPITAL_CONTEXT_KEYS, readHospitalConfig, readHospitalFacts, hospitalHoursLines };
export type { HospitalContextKey, HospitalFacts };

@Injectable()
export class ConfigRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * 전체 설정 목록 — **값과 함께 그 값이 어디서 왔는지**를 내려준다.
   *
   * 🔴 종전엔 DB 행 값과 코드 기본값이 **같은 모양**으로 나갔다. 화면은 둘을 구분할 수 없었고,
   *    그래서 "이 값은 누가 정한 것인가"에 아무도 답할 수 없었다(ERP 진단이 여기서 막혔다).
   * 🔴 그리고 목록을 `DEFAULTS` 에서만 만들었기 때문에, **DB 행은 있는데 미등재인 키**는
   *    관리 화면에서 보이지도 않았다 — 시드 잔재가 정책을 정해버려도 되돌릴 자리가 없었다.
   *    이제 그런 행도 `registered:false` 로 함께 드러낸다(막지는 않는다 · CLAUDE.md §4).
   */
  async getAll(category?: string): Promise<ConfigListEntry[]> {
    // 🔴 (2026-09-23 · R33 잔여) 카탈로그 등재 키는 **행이 가진 category 와 무관하게** 함께 읽는다.
    //    미등재 시절에 만들어진 행은 `set()` 의 create 폴백으로 `category='general'` 로 굳어 있다. 종전 질의는
    //    `where: { category }` 뿐이라 그런 행을 못 가져왔고, 아래 루프가 `db` 를 못 찾아 **저장된 값이 있는데도
    //    코드 기본값을 `source:'default'` 로** 내보냈다 — "사람이 정한 값"을 "아무도 정한 적 없다"고 말하던 자리다.
    //    (env 덮어쓰기는 그대로 맨 앞이다 — 이 질의는 DB 행을 더 찾을 뿐 우선순위를 바꾸지 않는다.)
    const defaultKeysInCategory = category
      ? Object.values(DEFAULTS).filter((e) => e.category === category).map((e) => e.key)
      : [];
    const dbConfigs = await this.prisma.systemConfig.findMany({
      where: category
        ? { OR: [{ category }, ...(defaultKeysInCategory.length ? [{ key: { in: defaultKeysInCategory } }] : [])] }
        : { category: { notIn: [...CONFIG_LIST_EXCLUDED_CATEGORIES] } },
    });

    // 기본값 + DB 덮어쓰기
    const result: ConfigListEntry[] = [];
    const dbMap = new Map(dbConfigs.map(c => [c.key, c]));

    const defaultEntries = Object.values(DEFAULTS);
    const filtered = category ? defaultEntries.filter(e => e.category === category) : defaultEntries;

    for (const def of filtered) {
      const db = dbMap.get(def.key);
      const env = configEnvOverride(def.key);
      result.push({
        key: def.key,
        value: env !== undefined ? env : db ? (db.value as Prisma.JsonValue) : def.value,
        description: def.description,
        category: def.category,
        source: env !== undefined ? 'env' : db ? 'db' : 'default',
        registered: true,
        ...(env === undefined && db && isDevSeedConfigLabel(db.label) ? { seeded: true as const } : {}),
      });
    }

    // 🔴 DEFAULTS 미등재인데 DB 행이 있는 키 — 종전엔 통째로 시야 밖이었다.
    //    설명을 지어내지 않는다 — 행이 가진 label·category 를 그대로 쓴다(둘 다 NOT NULL 컬럼).
    for (const db of dbConfigs) {
      if (db.key in DEFAULTS) continue;
      // 🔴 제외 카테고리는 `?category=access` 로 불러도 담지 않는다 — 종전 목록이 DEFAULTS 에서만
      //    만들어져 우연히 비어 있던 자리다. 미등재 행을 드러내려다 ACL 을 열지 않는다.
      if ((CONFIG_LIST_EXCLUDED_CATEGORIES as readonly string[]).includes(db.category)) continue;
      result.push({
        key: db.key,
        value: db.value as Prisma.JsonValue,
        description: db.label,
        category: db.category,
        source: 'db',
        registered: false,
        ...(isDevSeedConfigLabel(db.label) ? { seeded: true as const } : {}),
      });
    }
    return result;
  }

  /** DEFAULTS 카탈로그 등재 여부 — 거버넌스 집행 바인딩의 게이트(미등재 키 거부) */
  hasDefault(key: string): boolean { return key in DEFAULTS; }
  getDefault(key: string): unknown { return DEFAULTS[key]?.value ?? null; }

  async get(key: string): Promise<any> {
    const env = configEnvOverride(key);
    if (env !== undefined) return env;
    const db = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (db) return db.value;
    return DEFAULTS[key]?.value ?? null;
  }

  /**
   * 값 **과 출처**를 함께 읽는다 — `get()` 과 값은 같고, 그 값이 어디서 왔는지가 더 붙는다.
   *
   * 🔴 `get()` 을 바꾸지 않는다: 값만 필요한 호출부가 수십 곳이고, 모양을 바꾸면 그 전부가 깨진다.
   *    "무엇을 아는가"를 더 말하려고 "이미 아는 것"을 부수지 않는다.
   * 🔴 `unset` 은 `default` 와 다른 사실이다 — DB 행도 없고 카탈로그 등재도 없어서
   *    값 자체가 없는 것이다. 이것을 "기본값"이라 부르면 없는 정책을 있다고 말하는 것이 된다.
   */
  /**
   * 여러 설정의 **자세한 모습** — 값·출처(env/db/default/unset)·코드 기본값·설명·범주·마지막 변경(시각·계정).
   * 결정 화면이 "이 결정이 무엇을 바꾸는가"를 설정 단위로 말하는 데 쓴다(2026-10-11). 한 번에 읽는다.
   */
  async describeMany(keys: string[]): Promise<Map<string, {
    value: unknown; source: ConfigSource; registered: boolean; defaultValue: unknown; description: string | null; category: string | null;
    updatedAt: string | null; updatedBy: string | null; seeded?: true;
  }>> {
    const out = new Map();
    const uniq = [...new Set(keys)];
    if (!uniq.length) return out;
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: uniq } }, select: { key: true, value: true, category: true, label: true, updatedAt: true, updatedBy: true } });
    const db = new Map(rows.map((r) => [r.key, r]));
    for (const k of uniq) {
      const def = DEFAULTS[k];
      const env = configEnvOverride(k);
      const row = db.get(k);
      const source: ConfigSource = env !== undefined ? 'env' : row ? 'db' : def ? 'default' : 'unset';
      out.set(k, {
        value: env !== undefined ? env : row ? row.value : def ? def.value : null,
        source, registered: !!def, defaultValue: def ? def.value : null,
        description: def?.description ?? null, category: def?.category ?? row?.category ?? null,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null, updatedBy: row?.updatedBy ?? null,
        ...(env === undefined && row && isDevSeedConfigLabel(row.label) ? { seeded: true as const } : {}),
      });
    }
    return out;
  }

  async getWithSource(key: string): Promise<{ value: unknown; source: ConfigSource; registered: boolean; seeded?: boolean }> {
    const registered = key in DEFAULTS;
    const env = configEnvOverride(key);
    if (env !== undefined) return { value: env, source: 'env', registered };
    const db = await this.prisma.systemConfig.findUnique({ where: { key } });
    // seeded — 개발 시드가 넣은 행(label 표식 · 사람이 저장하면 set() 이 label 을 되돌려 표식이 사라진다)
    if (db) return { value: db.value, source: 'db', registered, ...(isDevSeedConfigLabel(db.label) ? { seeded: true } : {}) };
    if (registered) return { value: DEFAULTS[key].value, source: 'default', registered };
    return { value: null, source: 'unset', registered };
  }

  /**
   * 여러 키를 **한 번에** 읽는다 — 목록 화면이 항목 수만큼 왕복하지 않게(결정 등록부 56항목에서 드러났다).
   * 🔴 `get()` 과 같은 규칙이다: DB 행이 없으면 DEFAULTS, 그것도 없으면 `null`.
   *    "없음"과 "기본값"을 여기서 뒤바꾸지 않는다(호출부가 기본값을 결정으로 읽으면 안 되므로).
   */
  async getMany(keys: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    if (!keys.length) return out;
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: [...new Set(keys)] } } });
    const db = new Map(rows.map((r) => [r.key, r.value]));
    for (const k of keys) out.set(k, db.has(k) ? db.get(k) : (DEFAULTS[k]?.value ?? null));
    return out;
  }

  async set(key: string, value: unknown, updatedBy?: string) {
    const def = DEFAULTS[key];
    // 수치 정책(ui.precision.*) 변경은 이전값을 잡아 이력·서명 봉인 이벤트로 발행한다(§3.7).
    const pm = /^ui\.precision\.(.+)$/.exec(key);
    const prevValue = pm ? await this.get(key) : undefined;
    const res = await this.prisma.systemConfig.upsert({
      where: { key },
      // 🔴 (2026-09-23 · R33 잔여) 등재 키는 쓸 때마다 category 를 정본으로 되돌린다 — 등재 전에 `general` 로
      //    굳은 행이 다음 쓰기에서 스스로 고쳐진다. 미등재 키는 손대지 않는다(정본에 없는 키를 재분류하지 않는다).
      // 🔴 (2026-10-27) label 은 VarChar(200) — 설명문이 200자를 넘는 등재 키(통증 재평가 규정 등 4개)는 **처음 저장이 칸 길이 초과로 실패**했다 → 잘라 넣는다.
      //    사람이 저장하면 label 을 등재 설명으로 되돌린다 — 개발 시드 표식(DEV-SEED)이 그 순간 사라져 "원내 설정"이 된다.
      update: { value: value as Prisma.InputJsonValue, updatedBy, ...(def ? { category: def.category, label: configLabel(def.description) } : {}) },
      create: { key, value: value as Prisma.InputJsonValue, category: def?.category ?? 'general', label: configLabel(def?.description ?? key), updatedBy },
    });
    if (pm && prevValue !== value) {
      // sign 모듈이 구독 → recordSignAuditEvent 해시체인 봉인(순환 회피 위해 이벤트). best-effort.
      this.events.emit('numericPolicy.changed', { domain: pm[1], key, prevValue, newValue: value, updatedBy });
    }
    return res;
  }

  async getCategories() {
    const categories = [...new Set(Object.values(DEFAULTS).map(e => e.category))];
    return categories.map(c => ({
      category: c,
      count: Object.values(DEFAULTS).filter(e => e.category === c).length,
    }));
  }

  /**
   * 병원 기본 정보 (AI 시스템 프롬프트용).
   * 🔴 종전엔 `get()` 으로 읽어 DB 행이 없으면 DEFAULTS 플레이스홀더('09:00~18:00'·'02-1234-5678')를
   *    병원 사실로 프롬프트에 실었다. 이제 DB 행만 싣고, 미설정은 미설정이라고 밝힌다(`formatHospitalContext`).
   */
  async getHospitalContext(): Promise<string> {
    return formatHospitalContext(await readHospitalFacts(this.prisma));
  }
}
