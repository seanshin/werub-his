import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 간호 I/O(섭취·배설) FE↔서버 계약 가드 — 시드 흐름 전수 검토 9단계(2026-08-24).
 *
 * 서버 `IntakeOutput` 원장 컬럼은
 *   `recordedAt · intakeType · intakeAmount · intakeDetail · outputType · outputAmount · outputDetail`
 * 이다(`apps/api/src/modules/nursing/dto/create-intake-output.dto.ts` · Prisma `intake_outputs`).
 *
 * 그런데 화면 두 곳이 **서버에 없는 이름**(`type` / `category` / `amount` / `recordTime`)을 읽고 썼다:
 *   · 환자차트 간호기록 탭   — `filter(i => i.type === 'INTAKE')` 가 늘 빈 배열 → **섭취 0 mL · 배출 0 mL**
 *     (운영 실측 2026-08-24: 9입원 92행 = 섭취 36,100 mL · 배출 37,663 mL 가 0 으로 표시)
 *   · 간호 스테이션 I/O 탭   — 읽기는 `섭취 0 / 배설 NaN`(초록 배지), 쓰기는 `{type,category,amount}` 가
 *     전역 `whitelist:true` 에 통째로 지워져 **금액 없는 빈 행**이 201 과 함께 저장된다
 *     (운영 원장에 그런 행 0개 = 이 경로는 아직 눌린 적이 없다 — 구조적 결함이고 실피해는 없다).
 *
 * 정본은 처음부터 같은 데이터를 옳게 읽던 전용 화면 `/inpatient/[admissionId]/nursing/io` 다.
 *
 * 🔴 대조군 포함 — "고쳐 놓고 통과"가 아니라 **되돌리면 실패**해야 가드다.
 */

const WEB = process.cwd();
const FILES = {
  chartTab: join(WEB, 'src', 'app', '(main)', 'patients', '[id]', 'components', 'NursingRecordTab.tsx'),
  station: join(WEB, 'src', 'app', '(main)', 'nurse-station', 'page.tsx'),
  canonical: join(WEB, 'src', 'app', '(main)', 'inpatient', '[admissionId]', 'nursing', 'io', 'page.tsx'),
};
/** I/O 계약과 무관한 화면 — 실패 정직성만 본다(계약 루프에 넣으면 엉뚱한 것을 요구한다) */
const BOARD = join(WEB, 'src', 'app', '(main)', 'nursing-station', 'page.tsx');
/**
 * 🔴 주석을 지우고 본다 — 첫 판에 이 가드가 **내가 쓴 주석의 옛 이름**을 잡아 실패했다
 *    ("내 도구가 먼저 거짓말한다"). 코드가 무엇을 하는가만 재야 한다.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p: string) => stripComments(readFileSync(p, 'utf8'));

/**
 * 서버에 없는 이름으로 **원장 행을 읽는** 형태만 잡는다.
 * 🔴 조준을 좁히는 것은 완화가 아니다 — 첫 판은 모달의 로컬 폼 값(`body.type`)까지 잡아
 *    결함이 아닌 것을 결함이라 말했다. 대상이 0 이 되지 않도록 아래 대조군이 탐지기를 검사한다.
 */
const PHANTOM_READS = [
  /\b(r|i|io|rec|record|row)\.type\s*===\s*['"](INTAKE|OUTPUT)['"]/,
  /\b(r|i|io|rec|record|row)\.recordTime\b/,
  /\b(r|i|io|rec|record|row)\.amount\b/,
  /\b(r|i|io|rec|record|row)\.category\b/,
];

describe('간호 I/O 화면은 서버 원장 컬럼 이름으로 읽는다', () => {
  for (const [name, path] of Object.entries(FILES)) {
    const src = read(path);
    it(`${name} — 서버에 없는 이름(type/amount/recordTime)으로 읽지 않는다`, () => {
      const hits = PHANTOM_READS.filter((re) => re.test(src)).map(String);
      expect(hits).toEqual([]);
    });
    it(`${name} — 원장 컬럼(intakeAmount/outputAmount)을 실제로 읽는다`, () => {
      expect(src).toMatch(/intakeAmount/);
      expect(src).toMatch(/outputAmount/);
    });
  }
});

describe('간호 I/O 쓰기는 서버 DTO 이름으로 보낸다', () => {
  const src = read(FILES.station);
  it('POST 본문이 intakeType/intakeAmount · outputType/outputAmount 를 쓴다', () => {
    const at = src.indexOf('apiClient.post(`/api/v1/admissions/${body.admissionId}/intake-outputs`');
    expect(at).toBeGreaterThan(-1);
    const post = src.slice(at, at + 400);
    expect(post).toMatch(/intakeType:/);
    expect(post).toMatch(/intakeAmount:/);
    expect(post).toMatch(/outputType:/);
    expect(post).toMatch(/outputAmount:/);
  });
  it('DTO 에 없는 키(category)를 본문에 싣지 않는다 — whitelist 가 조용히 지운다', () => {
    expect(src).not.toMatch(/category:\s*body\.category/);
  });
  it('선택지는 Prisma enum 값만이다 — 저장할 수 없는 어휘를 고르게 하지 않는다', () => {
    // IntakeType = ORAL|IV|OTHER · OutputType = URINE|DRAIN|EMESIS|OTHER
    expect(src).not.toMatch(/intakeCategories\s*=\s*\[\s*'/);   // 문자열 리터럴 배열로 되돌리면 실패
    expect(src).not.toMatch(/outputCategories\s*=\s*\[\s*'/);
    expect(src).toMatch(/const IO_INTAKE_TYPES[\s\S]{0,200}ORAL[\s\S]{0,80}IV[\s\S]{0,80}OTHER/);
    expect(src).toMatch(/const IO_OUTPUT_TYPES[\s\S]{0,240}URINE[\s\S]{0,80}DRAIN[\s\S]{0,80}EMESIS[\s\S]{0,80}OTHER/);
    expect(src).not.toMatch(/IO_INTAKE_TYPES[\s\S]{0,240}'(PO|BLOOD|STOOL)'/);
  });
});

describe('오늘 날짜는 UTC 가 아니라 서버·사용자의 달력 날짜다', () => {
  it('nurse-station 이 toISOString().slice(0,10) 으로 "오늘"을 만들지 않는다', () => {
    // 🔴 KST 00:00~08:59 에는 UTC 기준 어제가 나온다 — 야간 근무 내내 어제 I/O 를 보게 된다
    expect(read(FILES.station)).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

describe('대조군 — 정본 화면은 처음부터 옳았고 그대로 남아 있다', () => {
  it('전용 I/O 화면이 여전히 원장 컬럼을 읽는다(고친 곳만 보지 않는다)', () => {
    const src = read(FILES.canonical);
    expect(src).toMatch(/intakeAmount/);
    expect(src).toMatch(/outputAmount/);
  });
  it('가드가 아무 파일에나 통과하지 않는다 — 유령 이름 탐지기가 실제로 동작한다', () => {
    const sample = `const x = ios.filter(i => i.type === 'INTAKE').reduce((s, i) => s + i.amount, 0);`;
    // 종전 코드 4종 모두 걸려야 한다(하나만 걸리면 나머지는 되살아나도 통과한다)
    expect(PHANTOM_READS.filter((re) => re.test(sample)).length).toBeGreaterThanOrEqual(2);
    expect(PHANTOM_READS.some((re) => re.test(`<span>{safeDateTime(io.recordTime)}</span>`))).toBe(true);
    expect(PHANTOM_READS.some((re) => re.test(`<span>{r.category}</span>`))).toBe(true);
    // 대조군 — 모달의 로컬 폼 값은 원장 읽기가 아니다(결함 아닌 것을 결함이라 말하지 않는다)
    expect(PHANTOM_READS.some((re) => re.test(`body.type === 'INTAKE' ? a : b`))).toBe(false);
  });
});

describe('간호 스테이션 보드는 조회 실패를 0 으로 말하지 않는다', () => {
  const src = read(BOARD);
  it('isError 분기가 있다 — 종전엔 6개 KPI 가 전부 `?? 0` 이었다', () => {
    expect(src).toMatch(/isError/);
    expect(src).toMatch(/QueryErrorFallback/);
  });
  it('실패 분기가 KPI 와 목록보다 먼저 온다 — "재원 환자가 없습니다"로 접히지 않는다', () => {
    const errAt = src.indexOf('isError ?');
    const emptyAt = src.indexOf('재원 환자가 없습니다');
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(errAt).toBeLessThan(emptyAt);
  });
  it('대조군 — 성공 경로의 빈 상태는 그대로 남아 있다(모든 0 을 실패라 말하지 않는다)', () => {
    expect(src).toContain('재원 환자가 없습니다');
  });
});

describe('낙상위험 칸은 서버가 주지 않는 값을 읽지 않는다', () => {
  const src = read(FILES.chartTab);
  it('응답에 없는 fallRiskScore 를 읽지 않는다', () => {
    // 🔴 종전: `assessment.fallRiskScore` — 서버 응답에 없는 키라 **개통 이래 항상 `-`**,
    //    `>= 45` 강조는 구조적으로 발동 불가였다(운영 실측: fall_risk_assessment_id 41행 전건 NULL).
    expect(src).not.toMatch(/fallRiskScore/);
  });
  it('연계가 없으면 "-" 가 아니라 없다고 말한다 — `-` 는 "위험 없음"으로 읽힌다', () => {
    expect(src).toMatch(/연계 없음/);
  });
});
