import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from 'next/cache';
import { POST } from '@/app/api/revalidate/route';

/**
 * 🔴 재검증 비밀 공개 폴백 — 2026-09-13 · 상용 릴리즈 T4 잔여.
 * 종전: `REVALIDATE_SECRET || '<저장소 리터럴>'` → 값을 안 넣은 판매본에서 누구나 아는 비밀로 캐시 무효화.
 * 지킨다: 미설정이면 **어떤 헤더로도** 503(리터럴로 떨어지지 않는다) · 틀린 비밀 401 · 맞는 비밀은 동작(대조군).
 * 재주입: 라우트에 `|| '<리터럴>'` 폴백을 되살리거나 미설정 분기를 지우면 첫 두 it 이 실패한다.
 */
const req = (secret?: string) =>
  new NextRequest('http://localhost/api/revalidate', { method: 'POST', headers: secret == null ? {} : { 'x-revalidate-secret': secret } });

describe('/api/revalidate — 비밀 없으면 거부', () => {
  const saved = process.env.REVALIDATE_SECRET;
  beforeEach(() => { vi.mocked(revalidatePath).mockClear(); });
  afterEach(() => { if (saved == null) delete process.env.REVALIDATE_SECRET; else process.env.REVALIDATE_SECRET = saved; });

  it('미설정이면 헤더가 무엇이든 503 — 종전 공개 리터럴로도 통과하지 않는다', async () => {
    delete process.env.REVALIDATE_SECRET;
    for (const s of [undefined, '', 'hospitalrun-revalidate', 'hispdf-revalidate']) {
      const res = await POST(req(s));
      expect(res.status).toBe(503);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('공백만 있는 값도 미설정으로 본다(503)', async () => {
    process.env.REVALIDATE_SECRET = '   ';
    const res = await POST(req('   '));
    expect(res.status).toBe(503);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('설정돼 있으면 틀린·빠진 비밀은 401', async () => {
    process.env.REVALIDATE_SECRET = 'real-secret-value';
    expect((await POST(req('wrong'))).status).toBe(401);
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('real-secret-valuX'))).status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('대조군 — 맞는 비밀이면 무효화한다(기능을 죽이지 않았다)', async () => {
    process.env.REVALIDATE_SECRET = 'real-secret-value';
    const res = await POST(req('real-secret-value'));
    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalled();
  });
});
