import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// 🔴 응답 모양은 **서버 정본 함수**로 만든다 — 화면 테스트가 제 가정 모양을 쓰면 계약 불일치가 통과한다(P11 이 그렇게 살아 있었다)
import { toTransferClinicalView } from '../../../api/src/modules/transfer/transfer-clinical-view';

/**
 * 🔴 전원 상세 — 진단·투약·알레르기 계약(P11) · 2026-09-15.
 *
 * 화면은 `diagnoses[].name`·`medications[].name` 을 읽었지만 서비스는 그런 키를 저장한 적이 없다:
 * 송신 스냅샷은 Prisma 행(`diagnosisCode.nameKo`·`medicationCode.nameKo`), 수신은 FHIR 정규화(`text`).
 * 송신 건 진단 칩은 빈 칸이었고 투약은 섹션 자체가 없었다.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (p: string) => get(p), patch: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't-1' }), useRouter: () => ({ push: vi.fn() }) }));

import TransferDetailPage from '../../src/app/(main)/transfer/[id]/page';

/** 서비스 findOne 응답 — 저장 JSON 원본 + 서버 정본이 만든 clinical */
function detailOf(stored: { diagnoses: unknown; medications: unknown; allergies: unknown }) {
  return {
    id: 't-1', transferType: 'OUTGOING_REFERRAL', status: 'REQUESTED', urgency: 'URGENT', reason: '전원 사유',
    requestedAt: '2026-09-15T01:00:00.000Z', metadata: null,
    patient: { familyName: '김', givenName: '환자', mrn: 'MRN-1', dateOfBirth: '1990-01-01' },
    ...stored,
    clinical: toTransferClinicalView(stored),
  };
}

const section = (id: string) => within(screen.getByTestId(id));
const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TransferDetailPage />
  </QueryClientProvider>,
);

beforeEach(() => vi.clearAllMocks());

describe('전원 상세 — 서비스 저장 모양의 이름을 그린다', () => {
  it('🔴 송신 스냅샷(Prisma 행 JSONB) → 진단명·약품명·알레르기명이 보인다', async () => {
    const stored = JSON.parse(JSON.stringify({
      diagnoses: [{ id: 'ed-1', type: 'PRIMARY', diagnosisCode: { code: 'I21.9', codeSystem: 'KCD-8', nameKo: '급성 심근경색증', nameEn: null } }],
      medications: [{ id: 'rx-1', type: 'MEDICATION', dosage: '100mg', frequency: 'QD', status: 'ACTIVE', medicationCode: { code: '645100010', nameKo: '아스피린장용정100mg', nameEn: null, ingredient: 'aspirin' } }],
      allergies: [{ id: 'al-1', allergen: '페니실린', severity: 'SEVERE', reaction: '두드러기' }],
    }));
    get.mockResolvedValue({ data: detailOf(stored) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('transfer-diagnoses')).toBeTruthy());
    expect(section('transfer-diagnoses').getByText('급성 심근경색증')).toBeTruthy();
    expect(section('transfer-diagnoses').getByText('I21.9')).toBeTruthy();
    expect(section('transfer-medications').getByText('아스피린장용정100mg')).toBeTruthy();
    expect(section('transfer-medications').getByText('100mg QD')).toBeTruthy();
    expect(section('transfer-allergies').getByText('페니실린')).toBeTruthy();
    expect(screen.queryByText('원문 없음')).toBeNull();
  });

  it('수신 FHIR 보존 모양(`text`) → 이름이 보인다', async () => {
    get.mockResolvedValue({ data: detailOf({
      diagnoses: [{ code: 'I10', system: 'http://hl7.org/fhir/sid/icd-10', text: '본태성 고혈압' }],
      medications: [{ text: 'Amlodipine 5mg', dosage: '1T QD', status: 'active' }],
      allergies: [{ name: 'Peanut', severity: 'high' }],
    }) });
    renderPage();

    await waitFor(() => expect(screen.getByText('본태성 고혈압')).toBeTruthy());
    expect(section('transfer-medications').getByText('Amlodipine 5mg')).toBeTruthy();
    expect(section('transfer-allergies').getByText('Peanut')).toBeTruthy();
  });

  it('대조군 — 과거 `{code, name}` 모양도 이름을 그린다', async () => {
    get.mockResolvedValue({ data: detailOf({ diagnoses: [{ code: 'J18.9', name: '폐렴' }], medications: [{ name: '세프트리악손', dosage: '1g' }], allergies: [] }) });
    renderPage();

    await waitFor(() => expect(screen.getByText('폐렴')).toBeTruthy());
    expect(section('transfer-medications').getByText('세프트리악손')).toBeTruthy();
    expect(section('transfer-allergies').getByText('없음')).toBeTruthy();
  });

  it('🔴 어느 모양에도 이름이 없으면 "원문 없음" — 코드를 이름으로 지어내지 않는다', async () => {
    get.mockResolvedValue({ data: detailOf({ diagnoses: [{ code: 'Z99' }], medications: [{ dosage: '1T' }], allergies: [{ severity: 'MILD' }] }) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('transfer-diagnoses')).toBeTruthy());
    expect(section('transfer-diagnoses').getByText('Z99')).toBeTruthy();
    expect(section('transfer-diagnoses').getByText('원문 없음')).toBeTruthy();
    expect(section('transfer-medications').getByText('원문 없음')).toBeTruthy();
    expect(section('transfer-allergies').getByText('원문 없음')).toBeTruthy();
  });

  it('섹션 미상(null)과 없음([])을 같은 화면으로 그리지 않는다', async () => {
    get.mockResolvedValue({ data: detailOf({ diagnoses: null, medications: [], allergies: null }) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('transfer-diagnoses')).toBeTruthy());
    expect(section('transfer-diagnoses').getByText('없음이 아니라 미상')).toBeTruthy();
    expect(section('transfer-medications').getByText('없음')).toBeTruthy();
    expect(section('transfer-allergies').getByText('없음이 아니라 미상')).toBeTruthy();
  });
});
