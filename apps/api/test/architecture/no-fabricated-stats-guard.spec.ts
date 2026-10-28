import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 지표를 지어내지 않는다 — 화면 실사용 점검 W6(2026-08-14).
 *
 * 만족도 화면은 표본이 없을 때 부서별 NPS·응답 수·문항 점수·8개월 추이를 **난수로**
 * 만들어 냈고(`randomBetween(35, 78)`), 환자앱 검진 내비게이션은 방별 대기 인원을
 * `Math.floor(Math.random() * 5)` 로 채워 "3명 대기 · 예상 15분 · 혼잡"을 보여줬다.
 * 새로고침할 때마다 값이 바뀌는데도 경영 지표·환자 안내로 읽혔다(P15).
 *
 * `Math.random()` 자체는 죄가 없다 — ID·파일명·OTP 생성에는 정당하다.
 * 금지되는 것은 **화면에 사실로 그려지는 수치**를 난수로 만드는 것이다.
 * 그래서 아래는 전면 금지가 아니라 **표시 지표를 만드는 서비스**만 동결한다.
 */
const SRC = join(process.cwd(), 'src');

/** 난수로 지표를 만들던 이력이 있어 재발을 막는 파일 */
const STAT_SERVICES = [
  'modules/satisfaction/satisfaction.service.ts',
  'modules/portal/portal.service.ts',
];

/**
 * 난수가 정당한 용도 — ID·토큰·파일명·OTP.
 * 이 목록에 해당하는 줄만 예외로 둔다(용도를 밝히지 않은 난수는 통과하지 못한다).
 */
const LEGITIMATE = /serialNumber|jobId|mrn\b|barcode|filename|uniqueSuffix|randomBytes|otp|code\s*=|roomId|\bseq\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return f.endsWith('.ts') ? [p] : [];
  });
}

describe('지표 날조 방지', () => {
  it('🔴 지표 서비스에 난수로 만든 수치가 없다', () => {
    const offenders: string[] = [];
    for (const rel of STAT_SERVICES) {
      const src = readFileSync(join(SRC, rel), 'utf-8');
      src.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//')) return;
        if (!/Math\.random/.test(line)) return;
        if (LEGITIMATE.test(line)) return;
        offenders.push(`${rel}:${i + 1} ${t.slice(0, 90)}`);
      });
    }
    expect(offenders, '표본이 없으면 난수가 아니라 null/빈 목록으로 알린다').toEqual([]);
  });

  it('🔴 만족도 벤치마크에 하드코딩 점수표가 없다 — 출처 없는 전국 평균 비교 금지', () => {
    const src = readFileSync(join(SRC, 'modules/satisfaction/satisfaction.service.ts'), 'utf-8');
    const bench = src.slice(src.indexOf('async getBenchmark('));
    const body = bench.slice(0, bench.indexOf('\n  async ') + 1 || undefined);
    expect(body).not.toMatch(/national:\s*\d/);
    expect(body).not.toMatch(/hospital:\s*\d/);
  });

  it('🔴 감성 분석이 예시 문장을 지어내 AI 에 넣지 않는다', () => {
    const src = readFileSync(join(SRC, 'modules/satisfaction/satisfaction.service.ts'), 'utf-8');
    // 종전 폴백 문장 — 아무 환자도 하지 않은 말이 '환자 목소리'로 요약됐다
    expect(src).not.toContain('의사 선생님이 매우 친절하게 설명해주셨습니다');
    expect(src).not.toContain('sampleTexts');
  });

  it('🔴 새 서비스가 난수 지표를 들여오지 않는다(전역 스캔)', () => {
    // 시뮬레이터는 설계상 난수가 본업이라 제외한다(개발 시뮬레이션 레지스트리 등재).
    const EXEMPT = /modules\/simulator\//;
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = f.replace(SRC + '/', '');
      if (EXEMPT.test(rel) || rel.endsWith('.spec.ts')) continue;
      const src = readFileSync(f, 'utf-8');
      src.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//')) return;
        if (!/Math\.random/.test(line)) return;
        if (LEGITIMATE.test(line)) return;
        offenders.push(`${rel}:${i + 1} ${t.slice(0, 90)}`);
      });
    }
    // 기준선 — 데모/시드 생성기만 남는다. 여기에 새 파일을 추가하지 말 것.
    const BASELINE = [
      'modules/telehealth/telehealth.service.ts', // createDemoSession — 데모 세션 주소증
      'modules/patient-auth/patient-auth.service.ts', // seedCheckupJourney — 데모 검진 여정
      'modules/encounter/encounter.service.ts', // 첨부 파일명
      'modules/voc/voc.controller.ts', // 업로드 파일명
      'modules/patient/patient.controller.ts', // 업로드 파일명
      'modules/agent-session/agent-session.service.ts', // 데모 MRN
      'modules/checkup/checkup-contract.service.ts', // 외부 계약 MRN 채번
    ];
    const unexpected = offenders.filter((o) => !BASELINE.some((b) => o.startsWith(b)));
    expect(unexpected, '표시 지표를 난수로 만들지 말 것').toEqual([]);
  });
});
