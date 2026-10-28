import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EligibilityVerifyModal } from '../../src/app/(main)/reception/components/EligibilityVerifyModal';

/**
 * 🔴 접수 본인확인 모달 — 체크하지 않은 항목을 `false` 로 보냈다(2026-09-15 P2 실측).
 *    서버 판정 정본(`common/identity-check-verdict.ts`)에서 `false` 는 "대조했는데 불일치"라,
 *    성명만 체크하고 '신분증 확인'을 누르면 FAIL 로 판정돼 사유 없음 400("본인확인 기록 실패")이었다.
 *    화면 문구("체크한 항목만 기록됩니다")대로 **체크한 항목만** 보낸다 — 미대조는 키가 없는 것이다.
 */
const target = { patientId: 'p1', queueId: 'q1', name: '홍길동' };

const lastVerifyBody = () => {
  const call = post.mock.calls.filter((c) => c[0] === '/api/v1/eligibility/verify-identity').at(-1);
  return call?.[1] as Record<string, unknown> | undefined;
};

describe('본인확인 모달 — 대조한 항목만 보낸다', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation((url: string) => (url === '/api/v1/eligibility/check'
      ? Promise.resolve({ data: { status: 'VERIFIED', copayCategory: 'NHI' } })
      : Promise.resolve({ data: { id: 'c1' } })));
  });

  it('🔴 성명만 체크하고 신분증 확인 → verifiedItems 는 {name:true} 뿐(생년월일 false 를 보내지 않는다)', async () => {
    render(<EligibilityVerifyModal target={target} onClose={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]); // 성명
    fireEvent.click(screen.getByText('신분증 확인'));
    await waitFor(() => expect(lastVerifyBody()).toBeDefined());
    expect(lastVerifyBody()!.verifiedItems).toEqual({ name: true });
    expect(lastVerifyBody()).not.toHaveProperty('result');
  });

  it('대조군 — 둘 다 체크하면 두 항목 모두 true 로 보낸다', async () => {
    render(<EligibilityVerifyModal target={target} onClose={() => {}} />);
    for (const b of screen.getAllByRole('checkbox')) fireEvent.click(b);
    fireEvent.click(screen.getByText('모바일 건보증'));
    await waitFor(() => expect(lastVerifyBody()).toBeDefined());
    expect(lastVerifyBody()!.verifiedItems).toEqual({ name: true, dob: true });
  });
});
