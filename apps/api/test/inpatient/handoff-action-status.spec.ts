/**
 * 인계 조치 항목 완료/되돌림(2026-10-04 · 스테이션 보드 1번).
 *  🔴 종전엔 조치 목록이 읽기 전용 — "남은 조치"가 끝내 줄지 않았다(체크할 길이 없음).
 *  · 인계 당사자(인계자·인수자)만 · ADMIN 예외 · 완료 = 상태 + 완료자·시각 · 되돌림 = 그 셋을 지운다
 *  · index 는 화면과 같은 규칙(shared handoffActionsOf — 모양이 틀린 칸 건너뜀)으로 센 위치
 *  · 화면이 본 글자와 다르면 409 · 조치 목록이 배열이 아니면 409 · 행 잠금
 * 재주입: 당사자 검사·건너뛰기 규칙·글자 대조·완료자 기록·되돌림 정리·잠금을 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handoffActionsOf } from '@hospital-run/shared';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

const LIST = [
  { action: '22시 혈당 재측정', status: 'PENDING' },
  'garbage', // 모양이 틀린 칸 — 화면은 건너뛴다
  { action: '통증 재평가', status: 'DONE', doneAt: '2026-10-04T00:00:00Z', doneById: 'n1', doneByName: '박하번' },
];

function mk(actionList: unknown = LIST) {
  const update = vi.fn(async (a: any) => ({ id: 'h1', actionList: a.data.actionList }));
  const tx: any = {
    $queryRaw: vi.fn(async () => []),
    clinicalHandoff: { findUnique: vi.fn(async () => ({ actionList, fromDoctorId: 'n1', toDoctorId: 'n9' })), update },
    user: { findUnique: vi.fn(async () => ({ familyName: '최', givenName: '상번' })) },
  };
  const prisma: any = { $transaction: async (cb: any) => cb(tx) };
  return { svc: new InpatientService(prisma), tx, update };
}

describe('조치 항목 완료', () => {
  it('🔴 인수자가 완료 — 상태·완료자·시각을 그 항목에 · 다른 칸은 그대로 · 행 잠금', async () => {
    const { svc, tx, update } = mk();
    await svc.setHandoffActionStatus('h1', 0, { status: 'DONE', action: '22시 혈당 재측정' }, 'n9', 'NURSE');
    expect(String(tx.$queryRaw.mock.calls[0][0].join('?'))).toMatch(/FOR UPDATE/);
    const saved = update.mock.calls[0][0].data.actionList;
    expect(saved[0]).toMatchObject({ action: '22시 혈당 재측정', status: 'DONE', doneById: 'n9', doneByName: '최상번' });
    expect(typeof saved[0].doneAt).toBe('string');
    expect(saved[1]).toBe('garbage');
    expect(saved[2]).toEqual(LIST[2]);
  });

  it('🔴 index 는 화면 규칙(모양 틀린 칸 건너뜀)으로 — 화면의 두 번째 항목 = 원본 세 번째', async () => {
    expect(handoffActionsOf(LIST)!.items[1].action).toBe('통증 재평가');
    const { svc, update } = mk();
    await svc.setHandoffActionStatus('h1', 1, { status: 'PENDING', action: '통증 재평가' }, 'n1', 'NURSE');
    const saved = update.mock.calls[0][0].data.actionList;
    // 되돌림 — 완료자·시각을 지운다
    expect(saved[2]).toEqual({ action: '통증 재평가', status: 'PENDING' });
  });

  it('🔴 당사자 아니면 403 · 관리자는 된다', async () => {
    const a = mk();
    await expect(a.svc.setHandoffActionStatus('h1', 0, { status: 'DONE', action: '22시 혈당 재측정' }, 'other', 'NURSE'))
      .rejects.toMatchObject({ response: { code: 'NOT_HANDOFF_PARTY' } });
    expect(a.update).not.toHaveBeenCalled();
    const b = mk();
    await b.svc.setHandoffActionStatus('h1', 0, { status: 'DONE', action: '22시 혈당 재측정' }, 'admin', 'ADMIN');
    expect(b.update).toHaveBeenCalled();
  });

  it('🔴 그 사이 글자가 바뀌었으면 409 · 목록이 배열이 아니면 409 · 범위 밖 404', async () => {
    const a = mk();
    await expect(a.svc.setHandoffActionStatus('h1', 0, { status: 'DONE', action: '다른 글자' }, 'n9', 'NURSE'))
      .rejects.toMatchObject({ response: { code: 'ACTION_CHANGED' } });
    await expect(mk('문자열').svc.setHandoffActionStatus('h1', 0, { status: 'DONE', action: 'x' }, 'n9', 'NURSE'))
      .rejects.toMatchObject({ response: { code: 'ACTION_LIST_UNREADABLE' } });
    await expect(mk().svc.setHandoffActionStatus('h1', 5, { status: 'DONE', action: 'x' }, 'n9', 'NURSE')).rejects.toThrow(/조치 항목을 찾을 수 없습니다/);
    expect(a.update).not.toHaveBeenCalled();
  });
});

describe('라우트·DTO', () => {
  it('PATCH handoffs/:id/actions/:index · 상태 어휘는 shared 정본 · 글자 필수', () => {
    const c = readFileSync(join(__dirname, '../../src/modules/inpatient/inpatient.controller.ts'), 'utf8');
    expect(c).toMatch(/@Patch\('handoffs\/:id\/actions\/:index'\)/);
    expect(c).toMatch(/@Param\('index', ParseIntPipe\) index: number/);
    const d = readFileSync(join(__dirname, '../../src/modules/inpatient/dto/inpatient.dto.ts'), 'utf8');
    const blk = d.slice(d.indexOf('export class SetHandoffActionStatusDto'), d.indexOf('export class SetHandoffActionStatusDto') + 500);
    expect(blk).toMatch(/@IsIn\(\[\.\.\.HANDOFF_ACTION_STATUS\]\)/);
    expect(blk).toMatch(/@IsNotEmpty\(\)\s*action: string;/);
  });
});
