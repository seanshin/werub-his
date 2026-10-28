import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 만성질환 지표 어휘 미러 기계 대조 — 정본은 shared `record-copy-labels.ts` 의 CHRONIC_OBSERVATION_LABEL(2026-10-13 · 의무기록 사본과 포털이 같이 쓴다 — 종전 정본은 HealthTab 로컬 표),
 * 모바일은 shared 를 import 못해 `apps/mobile/src/lib/chronic-labels.ts` 에 **의도적 미러**를 둔다.
 * 🔴 어휘는 미러에서 갈라진다(예방접종 문구 미러와 같은 관례) — 두 파일의 Record 리터럴을 그대로 대조한다.
 */

const WEB = join(process.cwd(), '..', '..', 'packages', 'shared', 'src', 'record-copy-labels.ts');
const MOBILE = join(process.cwd(), '..', 'mobile', 'src', 'lib', 'chronic-labels.ts');

const extractLabelMap = (src: string): Record<string, string> => {
  const m = /CHRONIC_(?:OBSERVATION_)?LABEL[^=]*=\s*\{([^}]*)\}/.exec(src);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const pair of m[1].matchAll(/(\w+):\s*'([^']*)'/g)) out[pair[1]] = pair[2];
  return out;
};

describe('만성질환 어휘 — web 정본 ↔ mobile 미러 기계 대조', () => {
  it('🔴 두 CHRONIC_LABEL 이 키·라벨까지 같다(미러가 갈라지면 앱과 포털이 같은 지표를 다르게 부른다)', () => {
    expect(existsSync(MOBILE), '모바일 미러 파일이 없습니다 — 경로가 바뀌었으면 이 가드도 옮겨야 합니다').toBe(true);
    const web = extractLabelMap(readFileSync(WEB, 'utf8'));
    const mobile = extractLabelMap(readFileSync(MOBILE, 'utf8'));
    // 대조군 — 추출기가 깨지면 빈 객체 둘이 "같다"로 통과한다
    expect(Object.keys(web).length, '정본 추출이 깨졌습니다 — 가드가 헛돕니다').toBeGreaterThan(5);
    expect(mobile).toEqual(web);
  });

  it('모바일 SMBG 목록이 서버 ALLOWED(포털 chronic-observations)와 같다', () => {
    const server = readFileSync(join(process.cwd(), '..', 'api', 'src', 'modules', 'portal', 'portal.controller.ts'), 'utf8');
    const m = /const ALLOWED = \[([^\]]*)\]/.exec(server);
    expect(m, '서버 ALLOWED 목록을 찾지 못했습니다').toBeTruthy();
    const serverCodes = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    const mobileSrc = readFileSync(MOBILE, 'utf8');
    const mm = /SMBG_CODES[^=]*=\s*\[([\s\S]*?)\];/.exec(mobileSrc);
    const mobileCodes = [...(mm?.[1] ?? '').matchAll(/code:\s*'(\w+)'/g)].map((x) => x[1]).sort();
    expect(mobileCodes.length, '모바일 SMBG 목록 추출이 깨졌습니다').toBeGreaterThan(2);
    expect(mobileCodes, '앱이 서버가 거부할 코드를 보여주거나, 가능한 코드를 숨기고 있습니다').toEqual(serverCodes);
  });
});
