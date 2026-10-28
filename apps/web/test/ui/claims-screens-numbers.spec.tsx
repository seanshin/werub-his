/**
 * 청구 목록·상세·대시보드·납입확인서 숫자(2026-10-14 결함 발굴 수납·청구 P4-3·P4-4·P4-5).
 *  · 🔴 청구 목록 카드가 요약(groupBy 배열)을 평면 객체로 읽어 늘 폴백 → 최근 20건으로 셌다(잘림 고지 없음)
 *  · 🔴 XML 다운로드 `window.open` — 인증 헤더 없어 늘 401
 *  · 🔴 '심사중' = 미전송 SUBMITTED · 상세 심사결과/이의신청은 원장에 없는 칸을 읽어 늘 안 보임 · 미심사 청구를 전액 삭감으로
 *  · 🔴 납입확인서 탭이 환자 포털 EP 를 직원 계정으로 불러 401
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimCounts } from '@/lib/claims-summary';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n');

describe('🔴 청구 목록 숫자', () => {
  it('요약 정본 파서 — 상태별 배열에서 청구액·인정액 전체 합', () => {
    const c = claimCounts([{ status: 'SUBMITTED', _count: 3, _sum: { claimedAmount: 300, approvedAmount: null } }, { status: 'APPROVED', _count: 2, _sum: { claimedAmount: 200, approvedAmount: 180 } }]);
    expect(c).toMatchObject({ reviewing: 3, approved: 2, totalClaimed: 500, totalApproved: 180 });
  });
  it('목록 화면 — 정본 파서·20건 폴백 없음·잘림 고지·XML 은 인증 헤더로', () => {
    const s = src('src/app/(main)/claims/page.tsx');
    expect(s).toMatch(/claimCounts\(_summaryRows\)/);
    expect(s).not.toMatch(/claimsList\.reduce\(\(s: number, c: ClaimItem\) => s \+ \(c\.claimedAmount/);
    expect(s).toMatch(/data-claims-truncated/);
    expect(s).not.toMatch(/window\.open\(`\$\{apiUrl\}\/api\/v1\/claims/);
    expect(src('src/app/(main)/claims/[id]/page.tsx')).not.toMatch(/window\.open\(`\$\{apiUrl\}\/api\/v1\/claims/);
  });
  it('상세 — 심사결과는 원장 상태·사유는 rejectReason · 미심사 청구 삭감액은 기록값(청구 − 0 아님)', () => {
    const s = src('src/app/(main)/claims/[id]/page.tsx');
    expect(s).toMatch(/const reviewResultView = /);
    expect(s).toMatch(/reducedAmount=\{claim\.reducedAmount \?\? undefined\}/);
  });
  it('대시보드 — SUBMITTED 를 "심사중"이라 부르지 않는다', () => {
    expect(src('src/app/(main)/dashboard/components/AdminDashboard.tsx')).not.toMatch(/<T k="심사중" \/>/);
    expect(src('src/app/(main)/dashboard/components/widgets/ext/ClaimsWidget.tsx')).not.toMatch(/label: '심사중'/);
  });
  it('납입확인서 — 원무 EP(환자 지정) · 포털 EP 를 부르지 않는다 · 입원 일수 모르면 -', () => {
    const s = src('src/app/(main)/print/receipt/[billingId]/page.tsx');
    expect(s).not.toMatch(/\/api\/v1\/portal\/medical-expenses/);
    expect(s).toMatch(/\/api\/v1\/billing\/patients\/\$\{receiptPatientId\}\/annual-payment/);
    expect(s).toMatch(/d\.inpatientDays \?\? '-'/);
  });
});

describe('🔴 XML 다운로드 — 인증 헤더 · 실패 사유', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  it('Bearer 헤더를 싣는다 · 422 는 서버 사유를 돌려준다', async () => {
    const { apiClient } = await import('@/lib/api-client');
    apiClient.setToken('tok-1');
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: { message: '청구 파일에 실을 사실을 확인할 수 없어 만들지 않습니다' } }) });
    const { downloadClaimXml } = await import('@/lib/claim-xml-download');
    const err = await downloadClaimXml('c1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1');
    expect(err).toContain('확인할 수 없어');
  });
});
