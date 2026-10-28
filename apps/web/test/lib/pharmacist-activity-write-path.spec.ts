import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 약사 임상활동 **쓰기 경로** 가드(2026-08-26).
 *
 * 착수 시 운영 실측: `pharmacist_interventions` 0행 · `tdm_requests` 0행 ·
 * `adverse_reaction_reports` 0행. "시드에 없다"가 아니었다 —
 * 네 개 등록 폼이 전부 **"환자 ID *" 자유 입력**(placeholder `pt-001`)이었고
 * 서버는 UUID 를 요구한다. **아무도 이 폼을 통과할 수 없었다.**
 * ("데이터 0행"을 믿기 전에 쓰기 경로를 눌러본다 — 이 저장소에서 4번째 사례)
 *
 * 같이 지키는 것:
 *  · 화면이 값을 지어내지 않는다(ASP 검토 의견 `'승인'`/`'부적절'` 하드코딩).
 *  · 쓰기 폼의 초기값은 미선택이다(중증도 `MODERATE`·결과 `RECOVERED`로 시작하지 않는다).
 *  · 조건식에서 미설정을 폴백하지 않는다(TDM 목표범위 null → 전부 "범위 밖" 빨강).
 *  · `queryFn` 안에서 실패를 기본값으로 접지 않는다.
 */

const DIR = join(process.cwd(), 'src', 'app', '(main)', 'pharmacist-activity');
const page = readFileSync(join(DIR, 'page.tsx'), 'utf8');
const counsel = readFileSync(join(DIR, 'components', 'CounselTab.tsx'), 'utf8');
const naranjo = readFileSync(join(DIR, 'components', 'NaranjoDialog.tsx'), 'utf8');
const all = [page, counsel, naranjo];

/**
 * 🔴 이 파일의 첫 판이 **제 주석에 걸려 오탐**을 냈다 — 옛 결함(`comment: '승인'`)을
 * 설명한 주석 문장을 코드로 읽었다. 소스 텍스트 가드는 주석을 먼저 걷어내고 본다.
 */
function codeOf(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')  // JSX 주석
    .replace(/\/\*[\s\S]*?\*\//g, '')      // 블록 주석
    .replace(/^\s*\/\/.*$/gm, '');         // 줄 주석
}
const pageCode = codeOf(page);
const counselCode = codeOf(counsel);

describe('🔴 환자는 선택하는 것이지 UUID 를 타이핑하는 것이 아니다', () => {
  it('환자 ID 자유 입력이 되살아나지 않는다', () => {
    for (const src of all) {
      expect(src).not.toMatch(/placeholder="pt-\d+"/);
      // `patientId` 를 직접 받는 text/기본 input 이 없어야 한다
      expect(src).not.toMatch(/<input[^>]*value=\{[a-zA-Z]+Form\.patientId\}/);
    }
  });

  it('네 개 쓰기 폼(중재·TDM·ADR·ASP)이 전부 PatientSelector 를 쓴다', () => {
    expect(page).toContain("import PatientSelector from '@/components/ui/PatientSelector'");
    const uses = page.match(/<PatientSelector/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
    // 복약상담 탭도 같은 규약
    expect(counsel).toMatch(/<PatientSelector/);
  });

  it('대조군 — 폼 자체는 살아 있다(입력 필드를 통째로 지워서 통과하지 않는다)', () => {
    expect(page).toMatch(/suspectedDrug/);
    expect(page).toMatch(/antimicrobialName/);
    expect(page).toMatch(/drugName/);
  });
});

describe('🔴 화면이 사람 대신 문장을 쓰지 않는다', () => {
  it('ASP 승인·거절 코멘트를 하드코딩하지 않는다', () => {
    expect(pageCode).not.toMatch(/comment:\s*'[^']+'/);
    expect(pageCode).not.toMatch(/reviewComment:\s*'[^']+'/);
  });

  it('검토 의견은 사람이 쓴 것만 보낸다(비면 필드를 보내지 않는다)', () => {
    expect(pageCode).toMatch(/reviewComment:\s*comment\.trim\(\)\s*\|\|\s*undefined/);
  });
});

describe('🔴 쓰기 폼의 초기값은 미선택이다', () => {
  it('임상 판단 필드가 정상값으로 시작하지 않는다', () => {
    // 값 뒤가 `,` 또는 `}` 인 것만 = 객체 리터럴의 초기값(타입 union `'DOSE' | …` 과 구분)
    expect(pageCode).not.toMatch(/severity:\s*'MODERATE'\s*[,}]/);
    expect(pageCode).not.toMatch(/outcome:\s*'RECOVERED'\s*[,}]/);
    expect(pageCode).not.toMatch(/causalityAssessment:\s*'POSSIBLE'\s*[,}]/);
    expect(pageCode).not.toMatch(/\btype:\s*'DOSE'\s*[,}]/);
    // 단위도 약물마다 다르다 — 화면이 골라두면 1000배 어긋난 목표가 저장된다
    expect(pageCode).not.toMatch(/targetUnit:\s*'mcg\/mL'\s*[,}]/);
    // 복약상담 폼도 같은 규약(상담 종류를 화면이 대신 고르지 않는다)
    expect(counselCode).not.toMatch(/counselType:\s*'INITIAL'\s*[,}]/);
  });

  it('대조군 — 선택지는 그대로 있다(옵션을 지워서 통과하지 않는다)', () => {
    expect(page).toContain('MODERATE');
    expect(page).toContain('RECOVERED');
    expect(page).toContain('mcg/mL');
    expect(page).toContain('선택하세요');
  });
});

describe('🔴 조건식에서 미설정을 폴백하지 않는다', () => {
  it('목표범위가 없으면 범위 내/밖을 판정하지 않는다', () => {
    // 종전: `tdm.resultLevel >= tdm.targetRangeMin` — null 이 0 으로 강등돼 전부 "범위 밖" 빨강
    expect(page).toMatch(/const hasTarget = tdm\.targetRangeMin != null && tdm\.targetRangeMax != null/);
    expect(page).toMatch(/inRange === null/);
    expect(page).toContain('판정 불가');
  });

  it('Naranjo 미평가를 0 점으로 그리지 않는다', () => {
    expect(page).toMatch(/adr\.naranjoScore != null/);
    expect(page).toContain('미평가');
    expect(page).not.toMatch(/naranjoScore\s*\?\?\s*0/);
  });
});

describe('🔴 queryFn 안에서 실패를 기본값으로 접지 않는다', () => {
  it('.catch 로 조회 실패를 "없음"으로 번역하지 않는다', () => {
    for (const src of all) {
      const lines = src.split('\n');
      const offenders = lines.filter((l) => /queryFn:/.test(l) && /\.catch\(/.test(l));
      expect(offenders).toEqual([]);
      expect(src).not.toMatch(/queryFn:[\s\S]{0,200}?\.catch\(\s*\(\)\s*=>/);
    }
  });

  it('조회 실패에는 QueryErrorFallback 이 실제로 도달한다(isError 분기)', () => {
    expect(page).toMatch(/tdmIsError \? <QueryErrorFallback/);
    expect(page).toMatch(/adrIsError \? <QueryErrorFallback/);
    expect(page).toMatch(/aspIsError \? <QueryErrorFallback/);
    expect(page).toMatch(/statsIsError \? <QueryErrorFallback/);
    expect(counsel).toMatch(/history\.isError \?/);
  });
});

describe('🔴 스프레드로 payload 를 보내지 않는다(whitelist 가 조용히 지운다)', () => {
  it('쓰기 mutation 이 폼 객체를 통째로 넘기지 않는다', () => {
    for (const src of [page, counsel]) {
      expect(src).not.toMatch(/apiClient\.(post|patch)\([^)]*\{\s*\.\.\.[a-zA-Z]+Form/);
    }
  });
});

describe('🔴 회수한 고아 EP 를 화면이 실제로 부른다', () => {
  it('복약지도 3경로(등록·환자별 이력·후보)', () => {
    expect(counsel).toContain("apiClient.post('/api/v1/pharmacy/counsel'");
    expect(counsel).toMatch(/\/api\/v1\/pharmacy\/counsel\/patient\/\$\{patientId\}/);
    expect(counsel).toMatch(/\/api\/v1\/pharmacy\/counsel\/candidates\/\$\{patientId\}/);
  });

  it('Naranjo 인과성 계산', () => {
    expect(naranjo).toContain("'/api/v1/pharmacy/adr/naranjo'");
    // 🔴 배점표를 화면이 베끼면 정본이 둘이 된다 — 점수는 서버가 계산한다
    expect(naranjo).not.toMatch(/\[\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\]/);
    expect(naranjo).toMatch(/NARANJO_QUESTIONS\.length/);
  });

  it('Naranjo 문항 초기값은 미선택이다(모름으로 시작하면 0점=희박이 공짜로 나온다)', () => {
    expect(naranjo).toMatch(/NARANJO_QUESTIONS\.map\(\(\) => null\)/);
    expect(naranjo).toMatch(/answeredCount === NARANJO_QUESTIONS\.length/);
  });
});

describe('자르면 잘랐다고 말한다', () => {
  it('meta.truncated 를 화면이 읽는다', () => {
    expect(page).toMatch(/meta\?:\s*\{\s*truncated/);
    expect(page).toMatch(/<TruncationNote/);
  });
});
