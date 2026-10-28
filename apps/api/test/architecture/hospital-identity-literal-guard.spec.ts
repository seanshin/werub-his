import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 🔴 병원 정체(기관명·주소·대표전화·진료시간)를 코드에 적지 않는다 — 정본은 system_configs `hospital.*` (2026-09-11).
 *
 * 발단: 의무기록 사본 PDF 헤더가 'Hospital RUN Medical Center · Teheran-ro 123 · 02-1234-5678',
 *   영문 영수증이 'Hospital RUN Medical Center', 예약 챗이 '서울시 강남구 · 강남역 3번 출구 · 02-1234-5678',
 *   AI 프롬프트가 '평일 09:00~18:00'(CMS 정본 ~17:30 과 어긋남)을 병원 사실로 말하고 있었다(P15).
 *   실병원 값을 적은 곳도 **상수 사본**이라(P12) 설정을 바꿔도 따라오지 않는다.
 *
 * 🔴 이 가드는 "0 이 아니면 실패"가 아니라 **파일별 개수 동결**이다 — 남은 자리는 사람 결정·범위 밖이라
 *    한 번에 다 고치지 않았다(다 고쳤다고 말하지 않는다). 늘어도 실패, 줄어도 실패(줄면 기준선을 낮춘다).
 * 🔴 주석은 벗기고 센다 — 결함 이력을 설명한 주석이 잡히면 가드가 헛돈다(이 저장소가 겪은 함정).
 */
const SRC = join(process.cwd(), 'src');

const LITERALS = [
  'Hospital RUN Medical Center',
  'Teheran-ro',
  '테헤란로',
  '02-1234-5678',
  '09:00~18:00',
  '09:00 ~ 18:00',
  '강남역',
  // 실병원 대표전화도 코드 사본은 정본이 둘이 되는 것이다(설정을 바꿔도 따라오지 않는다)
  '02-000-0000',
  // 기관명 폴백·상수(2026-09-11 추가) — 청구 XML `<청구기관명>`·EDI·SMS 머리말·번호표·영수증에서 회수했다.
  //   제품(시스템) 이름으로 쓰인 자리도 같은 문자열이라 함께 세고, 기준선에 사유를 붙여 남긴다.
  'Hospital RUN',
  // 요양기관기호 플레이스홀더(2026-09-11 추가) — 청구 XML `<청구기관코드>`·EDI 헤더·파이프 레코드에 박혀 있었다.
  //   **대외 제출물의 기관 식별**이라 이 회수를 동결해 둔다(되살아나면 심평원에 없는 기관번호가 나간다).
  '12345678',
] as const;

/**
 * 기준선 — 남아 있는 자리와 남긴 이유.
 *   · config-runtime.service.ts : DEFAULTS 개발 플레이스홀더(정본 판독기는 DB 행만 읽어 이 값을 쓰지 않는다)
 *   · go-live.service.ts / quality-registry.ts : 플레이스홀더 **탐지기**(이 값이면 "미확정"으로 센다 — 정당)
 *   · (회수 2026-09-11) crm-ai 캠페인 초안 대표전화 · portal 기본 공지 진료시간 · referral-letter 꼬리말 대표전화
 *     → 전부 정본 hospital.*(DB 행만)에서 읽고, 미설정이면 문장을 빼거나 "미설정"이라고 찍는다.
 *   'Hospital RUN' 잔존(범위 밖 · 보고 목록):
 *   · main.ts : Swagger 제목·기동 로그 — 제품 이름(기관 정체 아님)
 *   · medical-record-copy/pdf-generation.service.ts : 발급 문서 꼬리말 "Hospital RUN 시스템/HIS" — 제품 이름 표기
 *     (기관 정체는 같은 파일 `hospitalIdentity*()` 가 정본에서 읽는다)
 *   · fhir.controller.ts : FHIR Organization 이름(범위 밖 — P0 정본 접근자 이후)
 *   · clinic-integration.controller.ts : env `HOSPITAL_NAME` 폴백(범위 밖)
 *   · metaverse.service.ts : 메타버스 병원명 상수(범위 밖)
 */
const BASELINE: Record<string, Record<string, number>> = {
  'Hospital RUN Medical Center': {},
  'Teheran-ro': {},
  '테헤란로': {},
  '02-1234-5678': {
    'modules/config/config-runtime.service.ts': 1,
    'modules/go-live/go-live.service.ts': 1,
    'modules/data-quality/quality-registry.ts': 1,
  },
  '09:00~18:00': {
    'modules/config/config-runtime.service.ts': 1,
  },
  '09:00 ~ 18:00': {},
  '강남역': {},
  '02-000-0000': {},
  'Hospital RUN': {
    'main.ts': 2,
    'modules/clinic-integration/clinic-integration.controller.ts': 1,
    'modules/config/config-runtime.service.ts': 1,
    'modules/data-quality/quality-registry.ts': 1,
    'modules/fhir/fhir.controller.ts': 1,
    'modules/go-live/go-live.service.ts': 1,
    'modules/medical-record-copy/pdf-generation.service.ts': 3,
    'modules/metaverse/metaverse.service.ts': 1,
  },
  /**
   * '12345678' 잔존 — 전부 정당(기관 식별로 쓰이는 자리는 남지 않았다):
   *   · config-runtime.service.ts : DEFAULTS 플레이스홀더 자체
   *   · go-live.service.ts / quality-registry.ts : 플레이스홀더 **탐지기**(이 값이면 "미확정"으로 센다)
   *   · go-live.registry.ts / decision.registry.ts : 사람에게 "지금 플레이스홀더다"라고 말하는 안내 문구
   *   · billing/dto/pay-billing.dto.ts : 카드 승인번호 예시(기관 정체가 아니다)
   */
  '12345678': {
    'modules/billing/dto/pay-billing.dto.ts': 1,
    'modules/config/config-runtime.service.ts': 1,
    'modules/data-quality/quality-registry.ts': 1,
    'modules/decision-registry/decision.registry.ts': 1,
    'modules/go-live/go-live.registry.ts': 1,
    'modules/go-live/go-live.service.ts': 1,
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 블록 주석·줄 주석 제거 — `://`(URL)은 줄 주석이 아니다 */
const stripComments = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function scan(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = Object.fromEntries(LITERALS.map((l) => [l, {}]));
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    if (/(^|\/)seeds?(\/|[-.])/.test(rel)) continue; // 시드는 대상이 아니다(시드는 src 밖 prisma/ 에 있다 — 방어적 제외)
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const lit of LITERALS) {
      const n = count(code, lit);
      if (n) found[lit][rel] = n;
    }
  }
  return found;
}

describe('🔴 병원 정체 리터럴 동결 — 정본은 system_configs hospital.*', () => {
  const found = scan();

  it('대조군 — 스캐너가 실제로 리터럴을 찾는다(0건이면 이 가드는 아무것도 지키지 않는다)', () => {
    expect(walk(SRC).length).toBeGreaterThan(500);
    expect(found['02-1234-5678']['modules/go-live/go-live.service.ts'], '탐지기 자리를 못 찾으면 스캔이 헛도는 것이다').toBe(1);
    // 주석 제거 대조군 — 결함 이력을 적은 주석(pdf-generation.service.ts)은 세지 않는다
    expect(found['테헤란로']['modules/medical-record-copy/pdf-generation.service.ts']).toBeUndefined();
  });

  for (const lit of LITERALS) {
    it(`'${lit}' 자리가 기준선과 같다(늘면 정본 hospital.* 를 읽는다 · 줄면 기준선을 낮춘다)`, () => {
      expect(found[lit], `병원 정체 리터럴 '${lit}' 의 자리가 바뀌었다 — 새 자리는 설정(hospital.*)에서 읽어야 한다`).toEqual(BASELINE[lit]);
    });
  }
});
