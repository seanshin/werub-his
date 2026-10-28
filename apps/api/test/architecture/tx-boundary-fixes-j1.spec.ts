import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';

import { scanTxBoundaries } from './tx-boundary-scan';

/**
 * J1 이 묶은 자리(2026-09-16 트랜잭션 5차) — F3·G3·H4·I2 와 같은 방식으로 **정본 스캐너 판정**으로 못박는다.
 *
 * 🔴 소스에 `$transaction` 이라는 글자가 있는지로 보지 않는다(F3 의 재주입이 그렇게 통과했다).
 *    `scanTxBoundaries` 가 그 메서드를 **트랜잭션 밖 다중쓰기로 집어내지 않는다**는 사실로 판정한다.
 *
 * 🔴 이번 절반은 **I2 가 고친 ESS 승인 콜백의 신청·취소 쪽 쌍둥이**였다. I2 는 "승인되면 연차가 차감되지 않는다"를
 *    고쳤는데, 같은 파일의 **취소 경로**(쓴 연차가 돌아오지 않는다)와 **신청 경로**(신청만 커밋되고 결재가 없는데
 *    겹침·중복 검사가 재신청을 막는다)가 그대로 남아 있었다. 한 가족은 한 번에 본다.
 */
const MODULES = resolve(__dirname, '../../src/modules');
const { rows } = scanTxBoundaries(MODULES);
const multiWrite = new Set(rows.map((r) => `${r.file}#${r.method}`));

/** 고친 자리 — 스캐너가 더는 '트랜잭션 밖 다중쓰기'로 세지 않아야 한다 */
const SEALED: { file: string; method: string; half: string }[] = [
  { file: 'ess/ess.service.ts', method: 'applyLeaveCancel', half: '휴가는 WITHDRAWN 인데 쓴 연차가 잔여로 돌아오지 않는다 — 재시도는 멱등 분기에 막혀 영원히 복원되지 않는다' },
  { file: 'ess/ess.service.ts', method: 'requestLeave', half: '신청만 커밋되고 결재 릴레이가 없는데 겹침 검사가 같은 기간 재신청을 막는다' },
  { file: 'ess/ess.service.ts', method: 'requestAttendanceCorrection', half: '정정 신청만 커밋되고 결재가 없는데 중복 검사가 재신청을 막는다' },
  { file: 'ess/ess.service.ts', method: 'submitConsentApproval', half: '결재선 없는 PENDING relay 가 남아 수술·마취 동의서 확약 재상신이 막힌다' },
  { file: 'checkup/checkup.service.ts', method: 'completeInterpretation', half: '판독은 COMPLETED 인데 결과 항목에 임상 판정이 없다 — E1 가드가 재시도를 막아 영원히 안 붙는다' },
  { file: 'referral-letter/referral-letter.service.ts', method: 'send', half: '의뢰서는 전송됨인데 수신과 알림이 조용히 사라진다(상태 검사가 재전송을 막는다)' },
  { file: 'referral-letter/referral-letter.service.ts', method: 'signAndSend', half: '같은 쌍둥이 — 서명·전송 후 수신과 알림 유실' },
  { file: 'patient-auth/patient-auth.service.ts', method: 'signup', half: '계정은 생겼는데 법정 필수 동의 이력이 없고, 재가입은 "이미 가입된 계정"으로 막힌다' },
  { file: 'patient/patient.service.ts', method: 'create', half: '동의 기록 없는 환자가 남고 재시도는 MRN 이 다른 중복 환자를 만든다' },
  { file: 'consent-template/consent-template.service.ts', method: 'update', half: 'isLatest 해제만 커밋되면 최신 서식이 하나도 없는 창이 생긴다(법정 서식)' },
  { file: 'consent-template/consent-template.service.ts', method: 'restoreVersion', half: '같은 쌍둥이 — 복원본 생성 전에 최신본이 사라진다' },
];

describe('🔴 J1 — 반쪽 상태가 남던 자리는 한 트랜잭션이다', () => {
  it.each(SEALED)('$file#$method — 트랜잭션 밖 다중쓰기가 아니다 (종전: $half)', ({ file, method }) => {
    expect(multiWrite.has(`${file}#${method}`), `${file}#${method} 가 여전히 트랜잭션 밖 다중쓰기다`).toBe(false);
  });

  /** 🔴 대조군 — 탐지기가 살아 있는지. 전건 통과가 "고쳐서"인지 "못 보고"인지 구분하지 못하면 증거가 아니다. */
  it('대조군 — 아직 묶지 않은 자리는 스캐너가 집어낸다', () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(multiWrite.has('consent/consent.service.ts#sign'), '동의서 서명은 아직 다중쓰기로 집혀야 한다').toBe(true);
  });
});

/**
 * 🔴 검진권 배치는 **트랜잭션이 아니라 멱등 반환의 정직성**이 결함이었다.
 *    발행은 청크 트랜잭션으로 나뉘어 있어 중간 실패 시 배치는 DRAFT·검진권은 일부만 생긴다(금전 가치).
 *    그런데 재호출은 `quantity: existing.quantity`(=요청 수량)를 돌려주며 **전량 발행된 것처럼** 답했다.
 */
describe('🔴 J1 — 검진권 배치 멱등 반환은 실제 발행 수를 말한다', () => {
  /**
   * 🔴 (2026-09-17 L1) 전량 발행인데 **앵커가 없는** 배치는 이 분기에서 이어서 앵커한다 —
   *    그래서 목에 `ledger`·`policy` 가 필요하다(정본이 실제로 부르는 모양). 앵커가 이미 있는 배치는
   *    부르지 않는다(L1 스펙의 대조군이 그것을 본다).
   */
  const makeSvc = async (
    batch: { id: string; quantity: number; status: string; anchorId?: string | null; merkleRoot?: string | null },
    issued: number,
  ) => {
    const { VoucherService } = await import('../../src/modules/voucher/voucher.service');
    const prisma = {
      voucherBatch: { findUnique: vi.fn().mockResolvedValue({ anchorId: 'anchor-1', merkleRoot: 'root-1', ...batch }) },
      checkupVoucher: { count: vi.fn().mockResolvedValue(issued) },
    };
    const policy = { getActive: vi.fn().mockResolvedValue({ anchorChainType: 'INTERNAL' }) };
    const ledger = { anchorBatch: vi.fn().mockResolvedValue({ merkleRoot: 'root-1', anchorId: 'anchor-1' }) };
    return new VoucherService(prisma as never, policy as never, ledger as never, {} as never, {} as never);
  };

  /**
   * 🔴 (병합) J4 가 같은 자리를 더 멀리 고쳤다 — 부분 발행이면 **빠진 일련번호만 이어서 발행**한다.
   *    그래서 "200장만 있다고 말한다"가 아니라 "이어서 채우고 미완료였음을 말한다"가 계약이다.
   *    J1 이 잡은 속성(상태를 함께 본다)은 아래 세 번째 케이스로 남는다.
   */
  it('🔴 부분 발행(청크 중간 실패)이면 빠진 것을 이어서 발행하고 미완료였음을 말한다', async () => {
    const svc = await makeSvc({ id: 'b1', quantity: 500, status: 'DRAFT' }, 200);
    const fill = vi.spyOn(svc as never, 'fillBatch' as never).mockResolvedValue({ issued: 500, resumedFrom: 200 } as never);
    const r = await svc.issueBatch({ idempotencyKey: 'k1' } as never, 'admin');
    expect(fill).toHaveBeenCalledTimes(1); // 이어서 발행했다(요청 수량만 되돌려주고 끝내지 않는다)
    expect(r).toMatchObject({ quantity: 500, issued: 500, incomplete: true, idempotent: true });
  });

  it('대조군 — 전량 발행(ISSUED)이면 incomplete 가 아니다', async () => {
    const svc = await makeSvc({ id: 'b2', quantity: 500, status: 'ISSUED' }, 500);
    const r = await svc.issueBatch({ idempotencyKey: 'k2' } as never, 'admin');
    expect(r.quantity).toBe(500);
    expect(r).toMatchObject({ incomplete: false, idempotent: true, partial: false });
  });

  it('🔴 수량은 맞는데 배치가 DRAFT 로 남은 경우도 미완료로 말한다(상태를 함께 본다)', async () => {
    const svc = await makeSvc({ id: 'b3', quantity: 10, status: 'DRAFT' }, 10);
    const r = await svc.issueBatch({ idempotencyKey: 'k3' } as never, 'admin');
    expect(r).toMatchObject({ incomplete: true });
  });
});
