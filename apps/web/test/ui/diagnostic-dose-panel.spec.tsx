import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as fs from 'fs';
import * as path from 'path';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

import { DiagnosticDosePanel } from '../../src/app/(main)/patients/[id]/components/DiagnosticDosePanel';

/**
 * 누적 진단 피폭선량 패널 — 2026-08-27 신설(EP 의 **첫 소비처**).
 *
 * 🔴 이 화면이 반드시 지켜야 하는 것:
 *   ① 기록이 없으면 `0 mSv` 가 아니라 "산출 불가" — 몰라서 없는 것과 재서 0인 것은 다른 사실이다.
 *   ② **분모를 함께** 말한다. 누적 mSv 만 보면 "적게 쬐었다"로 읽히지만, 실제로는 선량을 안 적은
 *      촬영이 대부분일 수 있다(선량 입력은 촬영 화면의 **선택** 입력이다).
 *   ③ 진단 피폭(mSv)과 방사선치료(Gy)를 **섞지 않는다** — 이 축이 오래 이연된 바로 그 이유다.
 *
 * 재주입: 서버 `null` 을 `0` 으로 그리거나 분모/치료선량 구분 문구를 지우면 실패한다.
 */
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const base = {
  items: [], itemsTruncated: false, itemLimit: 100,
  summary: {
    totalCount: 0, dosedCount: 0, totalEffectiveMsv: null, totalEffectiveUnavailableReason: 'NO_RECORD',
    last12moCount: 0, last12moDosedCount: 0, last12moEffectiveMsv: null, last12moEffectiveUnavailableReason: 'NO_RECORD',
    estimatedCount: 0, ionizingStudies: 6, studiesWithDose: 0, byModality: {},
  },
};

describe('누적 진단 피폭선량 패널', () => {
  it('🔴 기록 0건을 "0 mSv" 로 그리지 않는다 — 산출 불가로 말한다', async () => {
    get.mockResolvedValue({ data: base });
    const { container } = wrap(<DiagnosticDosePanel patientId="p1" />);
    await screen.findAllByText(/산출 불가/);
    const t = container.textContent ?? '';
    expect(t).toContain('산출 불가');
    expect(t).toContain('선량 기록이 없습니다');
    // 🔴 0 을 그리면 "피폭이 없었다"는 다른 사실이 된다 — 어떤 숫자도 mSv 로 찍히면 안 된다
    expect(t).not.toMatch(/\d+\.\d+\s*mSv/);
    // 자릿수·단위는 shared NUMERIC_POLICIES.radiationDoseMsv 가 정한다(화면이 toFixed 로 정하지 않는다)
    expect(fs.readFileSync(path.join(__dirname, '../../src/app/(main)/patients/[id]/components/DiagnosticDosePanel.tsx'), 'utf-8'))
      .not.toMatch(/toFixed\(/);
  });

  it('🔴 분모를 함께 말한다 — 누적값이 하한임을 밝힌다', async () => {
    get.mockResolvedValue({
      data: { ...base, summary: { ...base.summary,
        totalCount: 1, dosedCount: 1, totalEffectiveMsv: 2.4, totalEffectiveUnavailableReason: null,
        last12moCount: 1, last12moDosedCount: 1, last12moEffectiveMsv: 2.4, last12moEffectiveUnavailableReason: null,
        ionizingStudies: 10, studiesWithDose: 1 } },
    });
    const { container } = wrap(<DiagnosticDosePanel patientId="p1" />);
    await screen.findAllByText(/2\.40/);
    const t = container.textContent ?? '';
    expect(t).toContain('2.40');
    expect(t).toContain('선량이 기록된 촬영');
    expect(t).toContain('하한');           // 9건 미기록 → 누적값은 하한이다
  });

  it('🔴 추정치가 섞였으면 장비 실측값과 구분해 말한다', async () => {
    get.mockResolvedValue({
      data: { ...base, summary: { ...base.summary,
        totalCount: 2, dosedCount: 2, totalEffectiveMsv: 9, totalEffectiveUnavailableReason: null,
        last12moCount: 2, last12moDosedCount: 2, last12moEffectiveMsv: 9, last12moEffectiveUnavailableReason: null,
        estimatedCount: 1, ionizingStudies: 2, studiesWithDose: 2 } },
    });
    const { container } = wrap(<DiagnosticDosePanel patientId="p1" />);
    await screen.findAllByText(/9\.00/);
    expect(container.textContent).toContain('추정한 유효선량 1건');
  });

  it('🔴 진단 피폭(mSv)과 방사선치료(Gy)를 섞지 않는다 — 화면이 먼저 구분해 말한다', async () => {
    get.mockResolvedValue({ data: base });
    const { container } = wrap(<DiagnosticDosePanel patientId="p1" />);
    await screen.findAllByText(/산출 불가/);
    const t = container.textContent ?? '';
    expect(t).toContain('mSv');
    expect(t).toContain('방사선치료 선량(Gy)');
    expect(t).toContain('방사선종양 탭');
  });
});

describe('붙인 자리 — 개념이 섞이지 않는다(기계 대조)', () => {
  const dir = path.join(__dirname, '../../src/app/(main)/patients/[id]/components');
  it('🔴 진단 피폭 패널은 영상 탭에만 있고 방사선종양 탭에는 없다', () => {
    const imaging = fs.readFileSync(path.join(dir, 'ImagingTab.tsx'), 'utf-8');
    expect(imaging, '영상 탭이 이 EP 의 첫 소비처다').toContain('DiagnosticDosePanel');
    const radiation = fs.readFileSync(path.join(dir, 'RadiationTab.tsx'), 'utf-8');
    expect(radiation, '방사선종양 탭은 치료선량(Gy) 이다 — 진단 피폭(mSv)을 넣으면 단위·개념이 섞인다')
      .not.toContain('DiagnosticDosePanel');
  });
});
