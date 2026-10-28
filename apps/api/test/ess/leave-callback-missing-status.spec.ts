import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { EssIntegrationController } from '../../src/modules/ess/ess-integration.controller';

/**
 * 🔴 휴가 결재 콜백 — 본문에 status/result 가 없을 때 401 이 나던 자리.
 * 서명·연동키는 통과했는데 401 을 받으면 발신 쪽은 **인증 실패**로 읽는다. 본문 결손은 400 이다.
 */
function make() {
  const svc = { leaveCallback: vi.fn().mockResolvedValue({ ok: true, applied: 'APPROVED' }) };
  const configRuntime = { get: vi.fn().mockResolvedValue('erp-key') };
  const config = { get: vi.fn().mockReturnValue('cb-secret') };
  const ctl = new EssIntegrationController(svc as never, configRuntime as never, config as never);
  return { ctl, svc };
}

function signed(body: object) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = `sha256=${crypto.createHmac('sha256', 'cb-secret').update(raw).digest('hex')}`;
  return { raw, sig };
}

describe('휴가 결재 콜백 — status 결손은 400', () => {
  it('🔴 서명은 정상, status/result 둘 다 없음 → 400(401 아님)', async () => {
    const { ctl, svc } = make();
    const body = { ref: { source_module: 'hr.leave_requests', source_ref: 'lr-1' } };
    const { raw, sig } = signed(body);
    const p = ctl.leaveCallback({ rawBody: raw }, undefined, sig, body as never);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.not.toBeInstanceOf(UnauthorizedException);
    expect(svc.leaveCallback).not.toHaveBeenCalled();
  });

  it('대조군 — 연동키로 인증, status 없음 → 역시 400', async () => {
    const { ctl } = make();
    const body = { ref: { source_module: 'hr.leave_requests', source_ref: 'lr-1' } };
    await expect(ctl.leaveCallback({}, 'erp-key', undefined, body as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('대조군 — 인증 실패는 여전히 401(400 으로 뭉개지 않는다)', async () => {
    const { ctl } = make();
    const body = { ref: { source_module: 'hr.leave_requests', source_ref: 'lr-1' }, status: 'APPROVED' };
    await expect(ctl.leaveCallback({}, 'wrong-key', undefined, body as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('대조군 — 스네이크 표기 result 로 오면 정상 처리', async () => {
    const { ctl, svc } = make();
    const body = { ref: { source_module: 'hr.leave_requests', source_ref: 'lr-1' }, result: 'APPROVED', approval_id: 'ap-1' };
    const { raw, sig } = signed(body);
    const r = await ctl.leaveCallback({ rawBody: raw }, undefined, sig, body as never);
    expect(r.data).toEqual({ ok: true, applied: 'APPROVED' });
    expect(svc.leaveCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED', approvalId: 'ap-1' }));
  });
});
