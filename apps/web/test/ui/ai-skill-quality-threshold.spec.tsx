import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 스킬 **품질 임계** 가드 — 기획서 `chart-ai-assistant-agent.plan.md` §4.6 계측 · §6-1 모델 품질 기준.
 *
 * 배경(2026-08-20): "검증 폐기율이 X% 넘는 스킬은 탭에서 내린다"는 문서 안의 사람 게이트였다.
 * 이제 운영이 `/admin/ai-settings` 에서 임계를 정하고, 진료 보조 패널이 그 판정을 화면으로 옮긴다.
 *
 * 🔴 이 가드가 지키는 사실(각 항목은 **결함을 재주입하면 실패한다** — 전부 실제로 재주입해 확인함) —
 *  ① 저장은 **기존 맵을 읽어 병합**한 전체 맵을 PUT 한다. 스칼라/단일 키만 보내면 다른 스킬 임계가 사라진다.
 *     (`{ value: 0.4 }` 또는 `{ value: { realtimeDdx: 0.4 } }` 로 되돌리면 실패)
 *  ② `effect==='HIDE'` 여도 탭은 남고 **사유를 화면이 밝힌다**. 탭을 배열에서 빼거나 사유 문구를 지우면 실패.
 *  ③ 통과율은 `<Ratio>`(분모 병기) — 맨 퍼센트로 그리면 실패(표본 0 은 0% 가 아니라 산출 불가).
 *  ④ 다이얼로그는 **실측 근거를 먼저** 보여준다(감으로 임계를 넣지 않게). 근거 블록을 지우면 실패.
 *  ⑤ `role="dialog"`·`aria-modal`·`aria-labelledby`·ESC·배경 클릭·첫 입력 포커스가 없으면 실패.
 */

const { get, put, post, apiFetch, toastSuccess, toastError, toastWarning } = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), post: vi.fn(), apiFetch: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(), toastWarning: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (p: string, q?: unknown) => get(p, q),
    put: (p: string, b?: unknown) => put(p, b),
    post: (p: string, b?: unknown) => post(p, b),
    fetch: (p: string, o?: unknown) => apiFetch(p, o),
    del: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/stores/toast-store', () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning, info: vi.fn() },
}));

import { AiSkillQuality } from '../../src/components/admin/AiSkillQuality';
import { AiAssistantPanel } from '../../src/app/(main)/patients/[id]/encounter/new/components/AiAssistantPanel';

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** 운영 실측(2026-08-20) 그대로 — 감별 5/14 · 검사해석 2/9 · SOAP 7/8 · 약물추천 5/7 */
const QUALITY = {
  windowDays: 30,
  generatedAt: '2026-08-20T09:00:00+09:00',
  note: 'Ai*Outcome 감사행 기준',
  skills: [
    { skill: 'RealtimeDdx', label: '감별진단', calls: 14, aiOk: 5, aiRate: 0.357, threshold: { minAiRate: null, minCalls: 20, action: 'OFF' }, status: 'UNCONFIGURED', effect: 'NONE', basis: '임계 미설정 — 아무것도 내리지 않습니다' },
    { skill: 'InterpretLab', label: '검사해석', calls: 9, aiOk: 2, aiRate: 0.222, threshold: { minAiRate: 0.6, minCalls: 5, action: 'WARN' }, status: 'DEGRADED', effect: 'WARN', basis: '최근 30일 AI 통과 2/9(22.2%) < 임계 60.0%' },
    { skill: 'AutoSoap', label: 'SOAP 초안', calls: 8, aiOk: 7, aiRate: 0.875, threshold: { minAiRate: 0.9, minCalls: 5, action: 'BLOCK' }, status: 'DEGRADED', effect: 'HIDE', basis: '최근 30일 AI 통과 7/8(87.5%) < 임계 90.0%' },
    { skill: 'RecommendDrugs', label: '약물추천', calls: 0, aiOk: 0, aiRate: null, threshold: { minAiRate: 0.7, minCalls: 20, action: 'BLOCK' }, status: 'INSUFFICIENT_SAMPLE', effect: 'NONE', basis: '표본 0건 < 최소 20건 — 판정하지 않습니다' },
  ],
};

/** 이미 다른 스킬 임계가 들어 있는 config 맵 — 병합하지 않으면 이 값들이 사라진다 */
const EXISTING = {
  'ai.skill.quality.minAiRate': { autoSoap: 0.9, interpretLab: 0.6 },
  'ai.skill.quality.minCalls': { autoSoap: 5, interpretLab: 5 },
  'ai.skill.quality.action': { autoSoap: 'BLOCK', interpretLab: 'WARN' },
};

function mockGet(overrides: Record<string, unknown> = {}) {
  get.mockImplementation((p: string) => {
    if (p.startsWith('/api/v1/ai/skill-quality')) return Promise.resolve({ data: overrides.quality ?? QUALITY });
    if (p.startsWith('/api/v1/ai/brief/')) return Promise.resolve({ data: null });
    const cfg = Object.keys(EXISTING).find((k) => p.includes(encodeURIComponent(k)) || p.includes(k));
    if (cfg) return Promise.resolve({ data: (overrides as Record<string, unknown>)[cfg] ?? EXISTING[cfg as keyof typeof EXISTING] });
    return Promise.resolve({ data: null });
  });
}

beforeEach(() => {
  get.mockReset(); put.mockReset(); post.mockReset(); apiFetch.mockReset();
  toastSuccess.mockReset(); toastError.mockReset(); toastWarning.mockReset();
  put.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  apiFetch.mockResolvedValue({ data: {} });
  mockGet();
});
afterEach(() => cleanup());

const openDialogFor = async (skillLabel: string) => {
  const { container } = render(<AiSkillQuality />);
  await screen.findByText(skillLabel);
  const row = container.querySelector(`tr[data-skill-row]`) as HTMLElement;
  expect(row).toBeTruthy();
  const target = [...container.querySelectorAll('tr[data-skill-row]')]
    .find((tr) => tr.textContent?.includes(skillLabel)) as HTMLElement;
  fireEvent.click(within(target).getByRole('button', { name: '임계 설정' }));
  const dialog = await screen.findByRole('dialog');
  return { container, dialog };
};

describe('AiSkillQuality 카드 — 실측을 분모와 함께 낸다', () => {
  it('③ 통과율은 `n / N (p%)` 로 그린다 — 맨 퍼센트가 아니다', async () => {
    const { container } = render(<AiSkillQuality />);
    await screen.findByText('감별진단');
    const ddx = [...container.querySelectorAll('tr[data-skill-row]')].find((tr) => tr.getAttribute('data-skill-row') === 'RealtimeDdx')!;
    expect(ddx.textContent).toContain('5 / 14');
    expect(ddx.textContent).toContain('35.7%');
    // 🔴 표본 0 은 0% 가 아니라 산출 불가
    const drug = [...container.querySelectorAll('tr[data-skill-row]')].find((tr) => tr.getAttribute('data-skill-row') === 'RecommendDrugs')!;
    expect(drug.querySelector('[data-ratio="unavailable"]')).toBeTruthy();
    expect(drug.textContent).toContain('산출 불가');
    // 통과율 칸이 `0%`(다른 사실)로 그려지면 실패 — 표본 부재는 값 0 이 아니다
    expect(drug.querySelectorAll('td')[1].textContent).not.toMatch(/%/);
  });

  it('상태는 색만으로 말하지 않는다 — 텍스트 배지가 함께 있다', async () => {
    const { container } = render(<AiSkillQuality />);
    await screen.findByText('감별진단');
    const byStatus = (s: string) => container.querySelector(`[data-skill-status="${s}"]`)?.textContent ?? '';
    expect(byStatus('UNCONFIGURED')).toContain('임계 미설정');
    expect(byStatus('DEGRADED')).toContain('임계 미달');
    expect(byStatus('INSUFFICIENT_SAMPLE')).toContain('표본 부족');
  });

  it('카드가 "기본값은 미설정 · 값을 넣기 전까지 아무것도 내리지 않는다" 를 말한다', async () => {
    const { container } = render(<AiSkillQuality />);
    await screen.findByText('감별진단');
    expect(container.textContent).toContain('위원회가 과거 실측에서');
    expect(container.textContent).toContain('값을 넣기 전까지 화면은 아무것도 내리지 않습니다');
  });

  it('적용 효과를 문구로 낸다(없음/화면에 경고/탭 내림)', async () => {
    const { container } = render(<AiSkillQuality />);
    await screen.findByText('감별진단');
    expect(container.querySelector('[data-skill-effect="WARN"]')?.textContent).toContain('화면에 경고');
    expect(container.querySelector('[data-skill-effect="HIDE"]')?.textContent).toContain('탭 내림');
    expect(container.querySelector('[data-skill-effect="NONE"]')?.textContent).toContain('없음');
  });
});

describe('임계 다이얼로그 — 근거 · 접근성 · 저장', () => {
  it('⑤ role="dialog" · aria-modal · aria-labelledby · 첫 입력 포커스', async () => {
    const { dialog } = await openDialogFor('감별진단');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby!)?.textContent).toContain('품질 임계 설정');
    // 첫 입력(최소 AI 통과율)에 포커스
    const first = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    expect(document.activeElement).toBe(first);
  });

  it('⑤ ESC · 배경 클릭으로 닫힌다', async () => {
    await openDialogFor('감별진단');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const { container } = await openDialogFor('감별진단');
    fireEvent.click(container.ownerDocument.querySelector('[data-threshold-backdrop]')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('④ 실측 근거를 먼저 보여준다 — "최근 30일 실측 AI 통과 5 / 14"', async () => {
    const { dialog } = await openDialogFor('감별진단');
    const basis = dialog.querySelector('[data-threshold-basis]')!;
    expect(basis.textContent).toContain('임계를 정하는 근거(실측)');
    expect(basis.textContent).toContain('최근 30일 실측 AI 통과');
    expect(basis.textContent).toContain('5 / 14');
    expect(basis.textContent).toContain('표본 14건');
  });

  it('④ 표본이 없으면 "표본 없음 — 임계를 정할 근거가 아직 없습니다"(0% 로 접지 않는다)', async () => {
    const { dialog } = await openDialogFor('약물추천');
    const basis = dialog.querySelector('[data-threshold-basis]')!;
    expect(basis.querySelector('[data-threshold-no-sample]')).toBeTruthy();
    expect(basis.textContent).toContain('표본 없음 — 임계를 정할 근거가 아직 없습니다');
  });

  it('BLOCK 을 고르면 "왜 내렸는지 화면이 밝힙니다 — 숨기면 방치됩니다" 경고가 뜬다', async () => {
    const { dialog } = await openDialogFor('감별진단');
    expect(dialog.querySelector('[data-block-warning]')).toBeNull();
    fireEvent.click(within(dialog as HTMLElement).getByRole('radio', { name: /BLOCK/ }));
    await waitFor(() => expect(dialog.querySelector('[data-block-warning]')).toBeTruthy());
    expect(dialog.querySelector('[data-block-warning]')!.textContent).toContain('숨기면 방치됩니다');
  });

  it('🔴 ① 저장은 기존 맵을 읽어 **병합한 전체 맵**을 PUT 한다 — 다른 스킬 임계가 살아남는다', async () => {
    const { dialog } = await openDialogFor('감별진단');
    const inputs = dialog.querySelectorAll('input[type="number"]');
    fireEvent.change(inputs[0], { target: { value: '40' } });
    fireEvent.change(inputs[1], { target: { value: '10' } });
    fireEvent.click(within(dialog as HTMLElement).getByRole('radio', { name: /BLOCK/ }));
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: '임계 저장' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
    const byKey = Object.fromEntries(put.mock.calls.map(([p, b]) => [decodeURIComponent(String(p)).replace('/api/v1/config/', ''), (b as { value: unknown }).value]));

    // 🔴 스칼라 PUT 재주입 차단 — 값은 반드시 맵이어야 한다
    for (const [k, v] of Object.entries(byKey)) {
      expect(typeof v, `${k} 에 스칼라를 보내면 다른 스킬 설정이 통째로 사라진다`).toBe('object');
      expect(Array.isArray(v)).toBe(false);
    }
    // 🔴 병합 없이 이 스킬 키만 보내는 재주입 차단 — 기존 키가 남아 있어야 한다
    expect(byKey['ai.skill.quality.minAiRate']).toEqual({ autoSoap: 0.9, interpretLab: 0.6, realtimeDdx: 0.4 });
    expect(byKey['ai.skill.quality.minCalls']).toEqual({ autoSoap: 5, interpretLab: 5, realtimeDdx: 10 });
    expect(byKey['ai.skill.quality.action']).toEqual({ autoSoap: 'BLOCK', interpretLab: 'WARN', realtimeDdx: 'BLOCK' });
    // 저장 전에 반드시 읽는다(GET 3회 이상)
    expect(get.mock.calls.filter(([p]) => String(p).includes('ai.skill.quality')).length).toBeGreaterThanOrEqual(3);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('통과율을 비우면 그 스킬 키를 맵에서 지운다(= 미설정) — 다른 스킬은 그대로', async () => {
    const { dialog } = await openDialogFor('검사해석');
    const inputs = dialog.querySelectorAll('input[type="number"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('60.0'); // 현재 임계를 % 로 채운다
    fireEvent.change(inputs[0], { target: { value: '' } });
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: '임계 저장' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
    const rate = put.mock.calls.find(([p]) => String(p).includes('minAiRate'))![1] as { value: Record<string, unknown> };
    expect(rate.value).toEqual({ autoSoap: 0.9 }); // interpretLab 키만 사라진다
  });

  it('🔴 서버가 무시할 값(0%)을 "저장했다"고 말하지 않는다 — 아예 보내지 않는다', async () => {
    // BE 정본 `resolveMinAiRate` 는 0 초과 1 이하만 채택한다. 0 을 보내면 저장된 척하고 무시된다.
    const { dialog } = await openDialogFor('감별진단');
    fireEvent.change(dialog.querySelectorAll('input[type="number"]')[0], { target: { value: '0' } });
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: '임계 저장' }));
    await waitFor(() => expect(dialog.textContent).toContain('0 초과 100 이하'));
    expect(put).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('🔴 저장 실패를 성공이라 말하지 않는다 — 실패 문구를 남기고 다이얼로그를 닫지 않는다', async () => {
    put.mockRejectedValue(Object.assign(new Error('권한이 없습니다(ADMIN 필요)'), { message: '권한이 없습니다(ADMIN 필요)' }));
    const { dialog } = await openDialogFor('감별진단');
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: '임계 저장' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(dialog.textContent).toContain('저장되지 않았습니다');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('🔴 기존 값이 맵이 아니라 스칼라면 저장을 멈춘다(덮어쓰면 다른 스킬 설정이 사라진다)', async () => {
    mockGet({ 'ai.skill.quality.minAiRate': 0.5 });
    const { dialog } = await openDialogFor('감별진단');
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: '임계 저장' }));
    await waitFor(() => expect(dialog.textContent).toContain('저장을 중단했습니다'));
    expect(put).not.toHaveBeenCalled();
  });
});

/* ── 진료 보조 패널 적용 ── */

const PANEL_PROPS = { patientId: 'p-1', soap: { subjective: '', objective: '', assessment: '', plan: '' }, encounterId: null };

const renderPanel = async () => {
  localStorage.setItem('encounter.aiPanel.open', '1');
  const r = render(<AiAssistantPanel {...PANEL_PROPS} />);
  await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).startsWith('/api/v1/ai/skill-quality'))).toBe(true));
  return r;
};

describe('AiAssistantPanel — 품질 임계를 화면이 말한다', () => {
  it('🔴 ② HIDE 여도 탭은 남고, 클릭하면 **사유**가 그려진다(조용히 사라지지 않는다)', async () => {
    const { container } = await renderPanel();
    const soapTab = await waitFor(() => {
      const b = [...container.querySelectorAll('button[data-tab-quality-effect]')].find((x) => x.textContent?.includes('SOAP초안'));
      expect(b).toBeTruthy();
      return b as HTMLElement;
    });
    expect(soapTab.getAttribute('data-tab-quality-effect')).toBe('HIDE');
    expect(soapTab.getAttribute('title')).toContain('품질 미달로 내림');
    expect(soapTab.textContent).toContain('품질 미달로 내림');

    fireEvent.click(soapTab);
    const notice = await waitFor(() => {
      const n = container.querySelector('[data-quality-effect="HIDE"]');
      expect(n).toBeTruthy();
      return n as HTMLElement;
    });
    expect(notice.textContent).toContain('품질 임계 미달로 운영이 내렸습니다');
    expect(notice.textContent).toContain('최근 30일 AI 통과 7/8(87.5%) < 임계 90.0%');
    expect(notice.textContent).toContain('관리자 > AI 설정에서 임계를 조정할 수 있습니다');
    // 실행 버튼은 없다(내린 스킬을 돌릴 수 없다)
    expect(container.textContent).not.toContain('SOAP 초안 생성');
  });

  it('② WARN 이면 탭 콘텐츠 위에 경고가 뜨고 **결과는 그대로 쓸 수 있다**', async () => {
    const { container } = await renderPanel();
    const labTab = await waitFor(() => {
      const b = [...container.querySelectorAll('button[data-tab-quality-effect]')].find((x) => x.textContent?.includes('검사해석'));
      expect(b).toBeTruthy();
      return b as HTMLElement;
    });
    expect(labTab.getAttribute('data-tab-quality-effect')).toBe('WARN');
    expect(labTab.getAttribute('title')).toContain('품질 경고'); // 색(●)만으로 말하지 않는다
    fireEvent.click(labTab);
    const warn = await waitFor(() => {
      const w = container.querySelector('[data-quality-effect="WARN"]');
      expect(w).toBeTruthy();
      return w as HTMLElement;
    });
    expect(warn.textContent).toContain('최근 30일');
    expect(warn.textContent).toContain('검증 통과율이 임계 미만입니다');
    expect(warn.textContent).toContain('결과를 특히 주의해서 확인하세요');
    // 내리지 않았으므로 실행 버튼은 살아 있다
    expect(container.textContent).toContain('해석');
  });

  it('임계 조회에 실패해도 패널은 정상 동작한다 — 아무것도 내리지 않고, 화면에 노이즈도 만들지 않는다', async () => {
    get.mockImplementation((p: string) => {
      if (p.startsWith('/api/v1/ai/skill-quality')) return Promise.reject(new Error('503'));
      if (p.startsWith('/api/v1/ai/brief/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: null });
    });
    const { container } = await renderPanel();
    await waitFor(() => expect(container.querySelectorAll('button[data-tab-quality-effect]').length).toBeGreaterThan(0));
    for (const b of container.querySelectorAll('button[data-tab-quality-effect]')) {
      expect(b.getAttribute('data-tab-quality-effect')).toBe('NONE');
    }
    expect(container.querySelector('[data-quality-effect="WARN"]')).toBeNull();
    expect(container.querySelector('[data-quality-effect="HIDE"]')).toBeNull();
    expect(container.textContent).not.toContain('품질 미달로 내림');
  });
});

describe('소스 규약 — 재주입 차단(정적)', () => {
  const CARD = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'admin', 'AiSkillQuality.tsx'), 'utf8');
  const PANEL = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'AiAssistantPanel.tsx'), 'utf8');

  it('🔴 ① 저장 경로가 "읽고 → 병합 → 전체 맵 PUT" 세 단계를 실제로 밟는다', () => {
    // 읽지 않고 바로 PUT 하는 코드로 되돌리면 이 단언들이 깨진다
    expect(CARD).toMatch(/async function readConfigMap/);
    expect(CARD).toMatch(/export async function putMergedConfigMap/);
    const fn = CARD.slice(CARD.indexOf('export async function putMergedConfigMap'), CARD.indexOf('const labelOf'));
    expect(fn).toMatch(/const map = await readConfigMap\(key\)/);
    expect(fn).toMatch(/map\[skillKey\] = value/);
    expect(fn).toMatch(/apiClient\.put\([^\n]*\{ value: map \}\)/);
    // 다이얼로그는 이 정본만 쓴다 — 직접 PUT 하는 경로가 없다
    const dialog = CARD.slice(CARD.indexOf('function ThresholdDialog'), CARD.indexOf('export function AiSkillQuality'));
    expect(dialog).not.toMatch(/apiClient\.put/);
    expect((dialog.match(/putMergedConfigMap\(/g) ?? []).length).toBe(3);
  });

  it('③ 카드가 비율 정본(<Ratio>)을 쓴다 — 직접 백분율 문자열을 만들지 않는다', () => {
    expect(CARD).toMatch(/<Ratio numerator=/);
    expect(CARD).not.toMatch(/aiRate[^\n]*\*\s*100/);
    expect(CARD).not.toMatch(/toFixed\(/);
  });

  it('② 패널이 HIDE 를 "탭 제거"로 처리하지 않는다 — 탭 배열은 그대로고 콘텐츠만 사유로 바뀐다', () => {
    // 탭 목록에서 필터링해 없애는 코드가 재주입되면 실패
    expect(PANEL).not.toMatch(/\.filter\([^\n]*qualityEffectOf/);
    expect(PANEL).not.toMatch(/effect !== 'HIDE'\s*\)\s*\.map/);
    expect(PANEL).toMatch(/data-tab-quality-effect=\{eff\}/);
    expect(PANEL).toMatch(/품질 임계 미달로 운영이 내렸습니다/);
    expect(PANEL).toMatch(/관리자 &gt; AI 설정에서 임계를 조정할 수 있습니다/);
    // 조회 실패를 기본값으로 삼키지 않는다 — 상태로 구분
    expect(PANEL).toMatch(/setQualityState\('error'\)/);
    expect(PANEL).not.toMatch(/skill-quality[\s\S]{0,400}catch\s*\(\s*\)\s*=>\s*\(?\{\s*effect/);
  });

  it('법정·안전 고지는 11px 미만을 쓰지 않는다(경고/사유 블록)', () => {
    const warnBlock = PANEL.slice(PANEL.indexOf("activeEffect === 'WARN' && ("), PANEL.indexOf('{/* DDx Tab */}'));
    expect(warnBlock).toMatch(/text-\[11px\]/);
    expect(warnBlock).not.toMatch(/text-\[(7|8|9|10)px\]/);
  });
});
