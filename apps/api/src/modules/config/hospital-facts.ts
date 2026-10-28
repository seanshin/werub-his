import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 🔴 병원 안내 사실(이름·주소·전화·진료시간) — 환자·AI 에게 말하는 병원 정체의 **키 정본**.
 *
 * 왜 `ConfigRuntimeService.get()` 이 아니라 **DB 행만** 읽는가:
 *   `get()` 은 DB 행이 없으면 DEFAULTS 로 떨어진다. 그런데 `hospital.*` 의 DEFAULTS 는 개발 플레이스홀더다
 *   ('Hospital RUN 병원'·'서울시 강남구'·'02-1234-5678'·'09:00~18:00' — go-live 가 이 값들을 "미확정"으로 센다).
 *   이것을 환자·AI 에게 사실로 말하면 날조다(P15). 실제로 AI 프롬프트가 CMS 정본(평일 ~17:30)과 어긋난
 *   '평일 09:00~18:00' 을 병원 사실로 말하고 있었다(2026-09-11).
 *   → 사람이 넣은 DB 행만 사실이다. 없으면 `null` 이고, 호출부는 "확인되지 않음"으로 말한다.
 *
 * 이 파일은 설정 서비스(`config-runtime.service.ts`)를 import 하지 않는다(순환 없음).
 * 키 리터럴이 여기 있어야 미배선 스캐너(`unwired-config-baseline.spec.ts`)가 소비처로 센다 —
 * 정의 파일 안에만 두면 "읽는 코드가 없는 설정"으로 잡힌다(실제로 그렇게 잡혔다).
 */
export const HOSPITAL_CONTEXT_KEYS = [
  'hospital.name', 'hospital.city', 'hospital.address', 'hospital.phone',
  'hospital.hours.weekday', 'hospital.hours.saturday', 'hospital.hours.lunch', 'hospital.hours.closed', 'hospital.emergency',
] as const;
export type HospitalContextKey = (typeof HOSPITAL_CONTEXT_KEYS)[number];
export type HospitalFacts = Record<HospitalContextKey, string | null>;

type SystemConfigReader = { systemConfig: Pick<PrismaService['systemConfig'], 'findMany'> };

/** DB 행 값 → 표시 문자열. 빈 문자열·비문자 값은 "없음"(null) — 그럴듯한 값으로 메우지 않는다 */
function hospitalFactValue(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? v.trim() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * `hospital.*` 를 **DB 행에서만** 읽는다(DEFAULTS 플레이스홀더로 떨어지지 않는다) — 한 번의 조회.
 * DI 없이 prisma 만으로 부를 수 있게 모듈 함수로 둔다(챗 서비스들이 모듈 import 를 늘리지 않도록).
 * 🔴 조회 실패는 삼키지 않는다(전파) — "실패"를 "미설정"으로 번역하지 않는다.
 */
export async function readHospitalConfig<K extends string>(prisma: SystemConfigReader, keys: readonly K[]): Promise<Record<K, string | null>> {
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: [...keys] } }, select: { key: true, value: true } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<K, string | null>;
  for (const k of keys) out[k] = hospitalFactValue(byKey.get(k));
  return out;
}

/** 병원 안내 사실(프롬프트·안내 문구용 9키) */
export function readHospitalFacts(prisma: SystemConfigReader): Promise<HospitalFacts> {
  return readHospitalConfig(prisma, HOSPITAL_CONTEXT_KEYS);
}

/**
 * 병원 정보 문단 — 설정된 값만 "라벨: 값" 으로 싣고, 미설정 항목은 **미설정이라고** 한 줄로 밝힌다
 * (빈 칸을 모델이 그럴듯하게 채우지 않도록). 라벨은 호출부가 준다(설정 서비스가 DEFAULTS 설명을 넘긴다).
 */
export function formatHospitalContextWith(facts: HospitalFacts, label: (k: HospitalContextKey) => string): string {
  const lines = HOSPITAL_CONTEXT_KEYS.filter((k) => facts[k]).map((k) => `${label(k)}: ${facts[k]}`);
  const missing = HOSPITAL_CONTEXT_KEYS.filter((k) => !facts[k]).map(label);
  if (missing.length) lines.push(`확인되지 않은 항목(기관 설정 없음 — 추측해 안내하지 않음): ${missing.join(', ')}`);
  return lines.join('\n');
}

/**
 * 문서에 찍는 "미설정" 표지 — 값이 없을 때 **그럴듯한 값 대신 비어 있다는 사실**을 보이게 한다.
 * 다른 기관·환자에게 건네는 문서(회송서·영수증·영문 진단서)에서 빈칸은 "누락"으로도 읽히므로 표지를 찍는다.
 * 🔴 표지는 정본 하나 — 호출부가 자기 문구를 두면 같은 사실을 다르게 말한다(P12).
 */
export const HOSPITAL_UNSET_KO = {
  'hospital.name': '(기관명 미설정)',
  'hospital.address': '(주소 미설정)',
  'hospital.phone': '(대표전화 미설정)',
} as const;
/** 영문 문서용 표지 — ASCII 만(영문 PDF 의 WinAnsi 로도 찍힌다) */
export const HOSPITAL_UNSET_EN = {
  'hospital.name': '[Institution name not configured]',
  'hospital.address': '[Institution address not configured]',
  'hospital.phone': '[Institution phone not configured]',
  'hospital.license': '[Institution license no. not configured]',
} as const;

/** 대외 제출물 기관 식별이 미설정일 때의 오류 코드 — 화면·테스트가 이 코드로 가른다 */
export const HOSPITAL_IDENTITY_UNSET = 'HOSPITAL_IDENTITY_UNSET';

/**
 * 🔴 **대외 제출물**(심평원 청구 XML·EDI 명세서)의 기관 식별 — DB 행만 읽고, 하나라도 비었으면 **만들지 않는다**(422).
 *
 * 종전엔 `<청구기관명>Hospital RUN` · `<청구기관코드>12345678` 이 코드에 박혀 있었고(설정조차 읽지 않음),
 * EDI 명세서는 `config.get(...).catch(() => null) ?? 'Hospital RUN'` 으로 **조회 실패와 미설정을 둘 다** 날조값으로 메웠다.
 * 기관 밖으로 나가는 파일에 지어낸 기관명·요양기관기호를 싣지 않는다 — 자리표시자(표지)도 싣지 않는다
 * (표지가 든 청구 파일도 "만들어진 파일"로 유통된다). 무엇이 비었는지는 `details.missing` 으로 준다.
 * 🔴 조회 실패는 삼키지 않는다(전파) — "실패"를 "미설정"으로 번역하지 않는다.
 * 🔴 어떤 키에 **등록 명칭**을 담을지는 사람 결정 `identity.legalNameSplit` 대기 — 지금은 `hospital.name`.
 */
export async function requireHospitalIdentityForSubmission<K extends string>(
  prisma: SystemConfigReader,
  keys: readonly K[],
): Promise<Record<K, string>> {
  const got = await readHospitalConfig(prisma, keys);
  const missing = keys.filter((k) => !got[k]);
  if (missing.length) {
    throw new UnprocessableEntityException({
      code: HOSPITAL_IDENTITY_UNSET,
      message: '기관 정보 미설정 — 대외 제출물에 기관명·요양기관기호를 지어 넣지 않습니다. /admin/ai-settings(시스템 설정)에서 누락 항목(details.missing)을 입력하세요',
      missing,
    });
  }
  return got as Record<K, string>;
}

/**
 * SMS 머리말 `[기관명] ` — 기관명이 미설정이면 **빈 문자열**(머리말을 지어내지 않는다 · 본문은 그대로 나간다).
 * 🔴 조회 실패는 전파한다(미설정으로 접지 않는다).
 */
export async function readSmsHeader(prisma: SystemConfigReader): Promise<string> {
  const { 'hospital.name': name } = await readHospitalConfig(prisma, ['hospital.name'] as const);
  return name ? `[${name}] ` : '';
}

/** 설정된 진료시간 줄만(평일·토·점심·휴진·응급) — 하나도 없으면 빈 배열(시간을 지어내지 않는다) */
export function hospitalHoursLines(facts: HospitalFacts): string[] {
  const rows: [HospitalContextKey, string][] = [
    ['hospital.hours.weekday', '평일'], ['hospital.hours.saturday', '토요일'], ['hospital.hours.lunch', '점심시간'],
    ['hospital.hours.closed', '휴진'], ['hospital.emergency', '응급실'],
  ];
  return rows.filter(([k]) => facts[k]).map(([k, l]) => `${l}: ${facts[k]}`);
}
