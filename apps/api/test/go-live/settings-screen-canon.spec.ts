import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 「시스템 설정」의 정본은 하나다 — 외부 실측 S8(2026-09-13).
 *
 * 설치본에서 **제목이 「시스템 설정」인 화면이 둘**이었다:
 *   · `/admin/ai-settings` — 왼쪽 메뉴가 가는 곳이고, **값을 바꾸는 유일한 화면**(`PUT /api/v1/config/:key`)
 *   · `/admin/config`      — 같은 값을 출처 배지와 함께 **보기만** 하는 화면(쓰기 호출이 없다)
 *
 * 그런데 구축 가이드·Go-Live 드릴다운·결정 등록부 드릴다운·서버의 "기관 정보 미설정" 메시지는 **읽기 전용 쪽**을
 * 가리켰다. "시스템 설정에서 AI 스위치를 끄세요"를 따라간 사람이 **끌 수 없는 화면**에 도착한다.
 *
 * 이 가드가 못박는 것(전부 반증 가능 — 되돌리면 실패한다):
 *   ① 이름이 겹치지 않는다 — nav 에서 '시스템 설정' 라벨은 하나뿐이고, `/admin/config` 는 제 이름을 쓴다.
 *   ② `/admin/config` 에는 설정 **쓰기 호출이 없다**(읽기 전용이라는 주장의 기계 대조) + 화면이 그 사실을 스스로 말한다.
 *   ③ `/admin/ai-settings` 에는 쓰기 호출이 있다(대조군 — 정본이 실제로 고칠 수 있는 화면이다).
 *   ④ 설정을 고치러 가라는 drillDown(go-live · 결정 등록부 본체+증분 배치 전부)은 **읽기 전용 화면을 가리키지 않는다.**
 *   ⑤ 서버가 "입력하세요"라고 말하는 자리도 편집 화면을 가리킨다.
 *
 * 🔴 `/admin/config` 라는 문자열 자체를 금지하지 않는다 — "출처 배지를 확인하라"(verifyHow)는 읽기 전용 화면이 맞다.
 *    겨누는 것은 **값을 바꾸러 보내는 자리**(drillDown·입력 안내)뿐이다.
 */

const ROOT = resolve(process.cwd(), '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 🔴 주석을 지우고 본다 — 내가 쓴 설명문("/admin/config 는 …")이 검사에 걸리면 가드가 헛돈다 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SIDEBAR = 'apps/web/src/components/layout/Sidebar.tsx';
const READ_ONLY = 'apps/web/src/app/(main)/admin/config/page.tsx';
const EDITABLE = 'apps/web/src/app/(main)/admin/ai-settings/page.tsx';
const GO_LIVE = 'apps/api/src/modules/go-live/go-live.registry.ts';
const DECISION_DIR = 'apps/api/src/modules/decision-registry';
const HOSPITAL_FACTS = 'apps/api/src/modules/config/hospital-facts.ts';

/** 결정 등록부 정본 = 본체 + 증분 배치 파일 전부(`decision.registry*.ts`) — 한 파일만 보면 배치에 남은 것이 산다 */
const decisionRegistryFiles = () =>
  readdirSync(resolve(ROOT, DECISION_DIR))
    .filter((f) => /^decision\.registry(\.batch-[\w-]+)?\.ts$/.test(f))
    .map((f) => `${DECISION_DIR}/${f}`);

describe('「시스템 설정」 정본은 하나다(S8)', () => {
  it('① nav 에서 라벨 「시스템 설정」은 정확히 한 번만 쓰이고, /admin/config 는 제 이름을 쓴다', () => {
    const src = stripComments(read(SIDEBAR));
    const items = [...src.matchAll(/href: '([^']+)', label: '([^']+)'/g)].map((m) => ({ href: m[1], label: m[2] }));
    const named = items.filter((i) => i.label === '시스템 설정');
    expect(named.map((i) => i.href)).toEqual(['/admin/ai-settings']);
    const readOnly = items.filter((i) => i.href === '/admin/config');
    expect(readOnly, 'OFF_NAV 에 /admin/config 가 있어야 화면번호 3163 이 산다').toHaveLength(1);
    expect(readOnly[0].label).toBe('설정값 목록(읽기 전용)');
  });

  it('② `/admin/config` 는 설정을 쓰지 않고(읽기 전용), 그 사실을 화면이 스스로 말한다', () => {
    const src = stripComments(read(READ_ONLY));
    expect(/apiClient\.(put|post|patch|delete)\(/.test(src), '읽기 전용 화면에 쓰기 호출이 생겼다 — 이름을 다시 정하라').toBe(false);
    expect(src).toContain("apiClient.get<{ data: ConfigItem[] }>('/api/v1/config')");
    expect(src).toContain('k="설정값 목록(읽기 전용)"');
    // 사람은 코드를 읽지 않는다 — "여기서는 못 바꾼다"와 바꾸는 화면으로 가는 링크가 화면에 있어야 한다
    expect(src).toContain('이 화면에서는 값을 바꿀 수 없습니다');
    expect(src).toContain('href="/admin/ai-settings"');
    // 제목을 「시스템 설정」으로 되돌리면 이름이 다시 둘이 된다
    expect(/<h2[^>]*><T k="시스템 설정" \/><\/h2>/.test(src)).toBe(false);
  });

  it('③ 대조군 — `/admin/ai-settings` 는 실제로 설정을 쓰고 「시스템 설정」이라는 이름을 갖는다', () => {
    const src = stripComments(read(EDITABLE));
    expect(src).toMatch(/apiClient\.put\(`\/api\/v1\/config\//);
    expect(/<h2[^>]*><T k="시스템 설정" \/><\/h2>/.test(src)).toBe(true);
    // 읽기 전용 목록으로 가는 길도 안내한다(출처 배지는 그쪽에만 있다)
    expect(src).toContain('href="/admin/config"');
  });

  it('④ 설정을 고치러 가는 drillDown 이 읽기 전용 화면을 가리키지 않는다(go-live · 결정 등록부 전 파일)', () => {
    const files = [GO_LIVE, ...decisionRegistryFiles()];
    // 🔴 배치 파일이 하나도 안 잡히면 이 검사는 본체만 보는 검사로 조용히 줄어든다
    expect(files.length, '결정 등록부 배치 파일을 찾지 못했다').toBeGreaterThan(2);
    for (const path of files) {
      const src = stripComments(read(path));
      const bad = [...src.matchAll(/drillDown: '([^']+)'/g)].map((m) => m[1]).filter((h) => h === '/admin/config');
      expect(bad, `${path}: 값을 고칠 수 없는 화면으로 보내고 있다`).toEqual([]);
    }
    // 대조군 — 드릴다운 자체가 0 이 되면 이 검사는 아무것도 보증하지 않는다
    const goLive = stripComments(read(GO_LIVE));
    expect(goLive.match(/drillDown: '\/admin\/ai-settings'/g)?.length ?? 0).toBeGreaterThan(0);
    const decisions = decisionRegistryFiles().map((p) => stripComments(read(p))).join('\n');
    expect(decisions.match(/drillDown: '\/admin\/ai-settings'/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it('⑤ 서버의 "기관 정보 미설정 — 입력하세요" 메시지도 편집 화면을 가리킨다', () => {
    const src = stripComments(read(HOSPITAL_FACTS));
    const msg = src.match(/message: '([^']*누락 항목[^']*)'/);
    expect(msg, 'HOSPITAL_IDENTITY_UNSET 메시지를 찾지 못했다').toBeTruthy();
    expect(msg![1]).toContain('/admin/ai-settings');
    expect(msg![1]).not.toContain('/admin/config ');
  });
});
