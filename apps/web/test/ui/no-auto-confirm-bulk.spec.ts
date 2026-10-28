import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **화면이 표준 매핑을 한 번에 확정하지 않는다**(2026-09-09 R8).
 *
 * 발단: `/admin/codes` 의 "제안 전체 적용" 버튼이 `POST /api/v1/codes/auto-map` 에
 * `autoConfirm: true` 를 실어 **확인창도 미리보기도 없이 확정**했다. 표준 매핑(SNOMED/LOINC/MedDRA)은
 * 청구·기관 간 교환에 쓰이고, 이 저장소에는 대조할 표준 코드 사전이 **없다** — AI 가 낸 코드가
 * 실재하는지 확인할 방법이 없는 채로 확정되고 있었다. 확정은 건별 검토 화면(`/mapping-review`)의 일이다.
 *
 * 🔴 **"안 보내면 된다"가 아니다.** 서버(`auto-mapper.service.ts`)는 `params.autoConfirm ?? true` 로
 *    읽는다 — 키를 빼면 **자동확정으로 되돌아간다**. 그래서 화면은 명시적으로 `false` 를 보내야 하고,
 *    이 가드는 `autoConfirm: true` 리터럴이 web 소스에 **한 개도 없음**을 못박는다.
 *    (`useState(true)` 같은 체크박스 기본값은 이 패턴이 아니다 — 사용자가 고르는 스위치는 대상이 아니다)
 */
const SRC = join(process.cwd(), 'src');
const PANEL = join(SRC, 'app/(main)/admin/codes/auto-mapping-dashboard.tsx');
const DETAIL = join(SRC, 'app/(main)/admin/codes/code-detail-panel.tsx');

/** 🔴 Node 20 에도 있는 것만 쓴다 — `fs.globSync`(22+)로 가드 둘이 조용히 죽은 적이 있다 */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(spec|test)\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

/**
 * 🔴 주석을 벗기고 센다. 벗기지 않으면 "종전에는 `autoConfirm:true` 였다"고 **설명한 주석**이
 *    위반으로 잡혀 가드가 헛돈다(이 저장소가 실제로 겪은 함정).
 */
const stripComments = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const AUTO_CONFIRM_TRUE = /autoConfirm\s*:\s*true\b/;

const files = walk(SRC);
const offenders = files.filter((f) => AUTO_CONFIRM_TRUE.test(stripComments(readFileSync(f, 'utf8'))));

describe('🔴 화면이 표준 매핑을 자동확정하지 않는다', () => {
  it('스캐너가 실제로 파일을 훑었다 — 0건 스캔이면 아래가 전부 자동 통과한다(대조군)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(PANEL);
    expect(files).toContain(DETAIL);
  });

  it('패턴 매처가 작동한다 — 재주입을 실제로 잡는다(대조군)', () => {
    expect(AUTO_CONFIRM_TRUE.test("apiClient.post('/x', { autoConfirm: true })")).toBe(true);
    expect(AUTO_CONFIRM_TRUE.test('{ autoConfirm:true }')).toBe(true);
    // 주석은 위반이 아니다 — 벗겨내는 로직이 작동하는지도 함께 본다
    expect(AUTO_CONFIRM_TRUE.test(stripComments('// 종전엔 autoConfirm: true 였다'))).toBe(false);
    // 사용자가 고르는 체크박스 상태는 대상이 아니다(오탐 대조군)
    expect(AUTO_CONFIRM_TRUE.test('const [autoConfirm, setAutoConfirm] = useState(true);')).toBe(false);
  });

  it('web 소스 어디에도 `autoConfirm: true` 리터럴이 없다', () => {
    expect(offenders, `자동확정으로 되돌아간 화면: ${offenders.join(', ')}`).toEqual([]);
  });

  it('🔴 매핑 제안 경로는 명시적으로 false 를 보낸다 — 키를 빼면 서버가 true 로 읽는다', () => {
    for (const f of [PANEL, DETAIL]) {
      const src = stripComments(readFileSync(f, 'utf8'));
      expect(src, f).toMatch(/autoConfirm\s*:\s*false/);
    }
  });
});

describe('🔴 확정이 아니라 "검토 대기로 보내기"라고 말한다', () => {
  const panel = readFileSync(PANEL, 'utf8');

  it('버튼 문구가 건수와 함께 검토 대기임을 밝힌다', () => {
    expect(panel).toMatch(/검토 대기로 보내기\(\$\{sendCount\}건\)/);
    // 종전 문구가 남아 있으면 화면이 여전히 "적용"이라고 말하는 것이다
    expect(panel).not.toContain('제안 전체 적용');
  });

  it('확인창(ConfirmDialog 정본)을 거친다 — 청구 직결 행위를 한 번에 실행하지 않는다', () => {
    expect(panel).toContain("import ConfirmDialog from '@/components/ui/ConfirmDialog'");
    expect(panel).toMatch(/<ConfirmDialog[\s\S]{0,600}onConfirm=\{handleSendToReview\}/);
  });

  it('완료 후 건별 승인 화면(/mapping-review)으로 안내한다', () => {
    expect(panel).toContain('/mapping-review');
  });

  it('🔴 대기에 쌓이지 않은 건을 뭉개지 않는다 — 분모(요청 건수)와 사유를 함께 말한다', () => {
    expect(panel).toMatch(/sendResult\.pended/);
    expect(panel).toMatch(/sendResult\.requested/);
    expect(panel).toContain('대기 적재 안 됨');
  });
});
