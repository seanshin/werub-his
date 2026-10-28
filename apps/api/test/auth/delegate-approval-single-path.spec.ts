/**
 * 위임 처방 승인 요청은 한 길뿐(2026-10-13 결함 발굴 A3).
 *  · 🔴 종전 `POST auth/step-up/push/delegate/request` 가 요청자가 보낸 bodyHash·summary 를 그대로 저장 —
 *    처방의 폰에 요청자가 쓴 요약이 떴고(실제 처방과 다른 요약으로 승인 가능), 처방의 자격·직종 범위 검사가 없었다.
 *  · 정본: `POST encounters/:id/prescriptions/delegate-request`(서버가 처방 본문으로 해시·요약 생성)
 *  · 가드: 옆문 라우트 없음 · `requestDelegate` 호출부는 처방 서비스 하나 · 대조군: 정본 EP 는 있다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PushApprovalController } from '../../src/modules/auth/step-up/push-approval.controller';
import { PrescriptionController } from '../../src/modules/prescription/prescription.controller';

const routes = (cls: { prototype: object }) =>
  Object.getOwnPropertyNames(cls.prototype)
    .map((k) => Reflect.getMetadata(PATH_METADATA, (cls.prototype as Record<string, unknown>)[k] as object))
    .filter((p): p is string => typeof p === 'string');

describe('🔴 위임 승인 요청 — 클라이언트 해시·요약을 받는 옆문이 없다', () => {
  it('push-approval 에 delegate/request 라우트 없음 · 대조군: 처방 정본 EP 는 있다', () => {
    expect(routes(PushApprovalController)).not.toContain('delegate/request');
    expect(routes(PushApprovalController)).toContain('delegate/status/:id'); // 같은 컨트롤러의 다른 라우트는 읽힌다(판정기가 돈다)
    expect(routes(PrescriptionController)).toContain('encounters/:encounterId/prescriptions/delegate-request');
  });
  it('requestDelegate 를 부르는 곳은 처방 서비스 하나', () => {
    const root = join(__dirname, '../../src');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
    const callers = walk(root).filter((f) => /\.requestDelegate\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1));
    expect(callers).toEqual(['modules/prescription/prescription.service.ts']);
  });
});
