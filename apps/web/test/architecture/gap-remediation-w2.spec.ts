import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * gap-remediation R-W2 배선 가드 — Code Blue/RRT(R4)·UDI 기기 추적(R5)·보유/파기 관제(R6).
 * 세 축 모두 "EP 는 있는데 소비처 0"이었다(2026-09-06 실측 — R4 7EP·R5 4EP·R6 7EP 전 고아).
 * import 는 세지 않는다 — 주석·import 제거 후 사용만 센다. JSX 는 [\s/>] 경계(접미사 치환 무동작 함정).
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const body = (s: string) =>
  s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '');

describe('R4 — Code Blue / RRT 화면이 EP 를 소비하고 정직하게 그린다', () => {
  const page = read('app/(main)/code-blue/page.tsx');
  const b = body(page);

  it('기록·RRT·통계 EP 를 전부 소비한다', () => {
    // 경계 필수 — toContain 은 접미사 치환(statsX)을 통과시켰다(재주입 실측 2026-09-06)
    expect(b).toMatch(/\/api\/v1\/code-blue['"`]/);
    expect(b).toMatch(/\/api\/v1\/code-blue\/rrt['"`]/);
    expect(b).toMatch(/\/api\/v1\/code-blue\/stats[^A-Za-z0-9]/);
  });

  it('시각 자동 각인이 없다 — "지금"은 명시 클릭 버튼이다', () => {
    // 발생·종결·활성화·응답 시각 전부 빈 값이 초기값(자동 now 채움 금지)
    expect(page.match(/지금/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(b).not.toMatch(/useState\(nowLocal\(\)\)/);
  });

  it('표본 0 의 비율은 산출 불가(정본 RATIO_UNAVAILABLE)로 말하고, 비율에는 분모를 병기한다', () => {
    expect(b).toMatch(/roscRate == null/);
    expect(b).toMatch(/\{RATIO_UNAVAILABLE\}/); // 자체 리터럴 금지 — 임상 UX 가드 기준선과 정합
    expect(page).toContain('분모');
  });

  it('음수 SLA(시간 역전 기록)를 숨기지 않고 표기한다 · 절단(200건)을 밝힌다', () => {
    expect(page).toContain('시간 역전 기록');
    expect(page).toContain('최근 200건');
  });

  it('진행 중(미종결) 워크리스트가 있다 — 줄어드는 목록', () => {
    expect(b).toMatch(/outcome === 'ONGOING'/);
    expect(b).toMatch(/!r\.respondedAt/);
  });
});

describe('R5 — UDI 기기 추적이 배선되어 있다', () => {
  const surgery = read('app/(main)/surgery/[id]/page.tsx');
  const panel = read('app/(main)/surgery/components/DeviceUsagePanel.tsx');
  const recall = read('app/(main)/admin/device-recall/page.tsx');

  it('수술 상세가 DeviceUsagePanel 을 렌더한다', () => {
    expect(body(surgery)).toMatch(/<DeviceUsagePanel[\s/>]/);
  });

  it('패널이 파싱·기록·환자별 이력 EP 를 소비한다', () => {
    const b = body(panel);
    expect(b).toContain('/api/v1/device-usage/scan');
    expect(b).toContain("'/api/v1/device-usage'");
    expect(b).toContain('/api/v1/device-usage/patient/');
  });

  it('리콜 역추적이 recall EP 를 소비하고 AND 결합·절단·0건≠해당없음을 말한다', () => {
    const b = body(recall);
    expect(b).toContain('/api/v1/device-usage/recall');
    expect(recall).toContain('AND');
    expect(b).toMatch(/truncated/);
    expect(recall).toContain('해당 없음');
  });
});

describe('R6 — 보유/파기 관제가 배선되어 있고 없는 능력을 약속하지 않는다', () => {
  const page = read('app/(main)/admin/retention/page.tsx');
  const b = body(page);

  it('정책·DRY-RUN·요청·승인 EP 를 소비한다', () => {
    expect(b).toContain('/api/v1/retention/policies');
    expect(b).toContain('/api/v1/retention/report');
    expect(b).toContain('/api/v1/retention/purge-request');
    expect(b).toContain('/approve');
  });

  it('🔴 파기 실행 EP 를 직접 부르지 않는다 — 실행 버튼은 그리지 않는다(가짜 게이트 금지의 역)', () => {
    expect(b).not.toMatch(/\/api\/v1\/retention\/purge['"`]/);
  });

  it('supported=false 는 0건이 아니라 "세지 않음"으로 말한다', () => {
    expect(page).toContain('세지 않음(핸들러 없음)');
    expect(b).toMatch(/r\.supported \?/);
  });

  it('승인 목록은 RETENTION_PURGE 만 가른다(서버는 무필터 — 실측)', () => {
    expect(b).toMatch(/action === 'RETENTION_PURGE'/);
  });

  it('DRY-RUN 을 마운트 시 자동 실행하지 않는다 — GET 이지만 쓰기 부작용(lastRunAt)이 있다', () => {
    // report 는 버튼 클릭 mutation 으로만 부른다 — report EP 가 등장하는 함수 블록이 useMutation 인지 본다
    const idx = b.indexOf('/api/v1/retention/report');
    expect(idx).toBeGreaterThan(-1);
    const before = b.slice(Math.max(0, idx - 200), idx);
    expect(before).toContain('useMutation');
    expect(before).not.toContain('useQuery');
  });

  it('nav·화면번호 정본 등재 — 신규 3화면', () => {
    const frozen = read('components/layout/screen-codes.frozen.ts');
    const sidebar = read('components/layout/Sidebar.tsx');
    expect(frozen).toMatch(/'\/code-blue':\s*'1305'/);
    expect(frozen).toMatch(/'\/admin\/device-recall':\s*'3407'/);
    expect(frozen).toMatch(/'\/admin\/retention':\s*'3408'/);
    for (const href of ['/code-blue', '/admin/device-recall', '/admin/retention']) {
      expect(sidebar).toContain(`'${href}'`);
    }
  });
});
