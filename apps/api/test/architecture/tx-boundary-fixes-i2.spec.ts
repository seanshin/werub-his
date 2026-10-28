import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripForScan } from './egress-scan';
import { scanTxBoundaries } from './tx-boundary-scan';

/**
 * I2 가 묶은 자리(2026-09-16 트랜잭션 4차) — F3·G3·H4 와 같은 방식으로 **정본 스캐너 판정**으로 못박는다.
 *
 * 🔴 소스에 `$transaction` 이라는 글자가 있는지로 보지 않는다(F3 의 재주입이 그렇게 통과했다).
 *    `scanTxBoundaries` 가 그 메서드를 **트랜잭션 밖 다중쓰기로 집어내지 않는다**는 사실로 판정한다.
 *
 * 🔴 H4 의 절반이 쌍둥이 경로였듯, 이번에도 CSSD 패키지 원장(사용·반납·리콜) 3경로가 한 가족이었다.
 *    한 곳만 고치면 나머지가 남는다.
 */
const MODULES = resolve(__dirname, '../../src/modules');
const { rows, escapes } = scanTxBoundaries(MODULES);
const multiWrite = new Set(rows.map((r) => `${r.file}#${r.method}`));

/** 고친 자리 — 스캐너가 더는 '트랜잭션 밖 다중쓰기'로 세지 않아야 한다 */
const SEALED: { file: string; method: string; half: string }[] = [
  { file: 'ess/ess.service.ts', method: 'applyCorrectionDecision', half: '정정은 APPROVED 인데 근태 기록이 없다 — 재시도는 멱등 분기에 막혀 그 기록이 영원히 생기지 않는다' },
  { file: 'cssd/cssd-package.service.ts', method: 'usePackage', half: '패키지는 IN_USE 인데 어느 진료에 나갔는지 원장에 없다(인증 심사 추적성)' },
  { file: 'partner-request/partner-request.service.ts', method: 'approve', half: 'scope 를 가진 SMART 클라이언트는 만들어졌는데 신청은 PENDING — 화면에 안 보이는 고아 자격' },
  { file: 'checkup/checkup-station.service.ts', method: 'complete', half: '스테이션은 완료인데 검사 항목은 PENDING(전 항목 완료 판정이 영영 안 선다)' },
  { file: 'protocol/protocol.service.ts', method: 'completeStep', half: '단계는 DONE 인데 인스턴스의 현재 단계가 그 DONE 단계를 가리킨다(수술 안전 프로토콜 보드)' },
  { file: 'clinical-pathway/clinical-pathway.service.ts', method: 'recordOutcome', half: '이탈은 기록됐는데 이탈 카운트가 안 올라간다 — 재기록은 delta 0 이라 영원히 집계되지 않는다' },
  { file: 'medical-record-issuance/issuance.service.ts', method: 'authorCertificate', half: '증명서 본문은 작성됐는데 요청 상태가 그대로라 검토 목록에 뜨지 않는다(법정 서식)' },
  { file: 'chemo/chemo.service.ts', method: 'startCycle', half: 'D2+ 일정은 깔렸는데 사이클은 미개시 — 다음 시도가 같은 일정을 또 깐다' },
];

describe('🔴 I2 — 반쪽 상태가 남던 자리는 한 트랜잭션이다', () => {
  it.each(SEALED)('$file#$method — 트랜잭션 밖 다중쓰기가 아니다 (종전: $half)', ({ file, method }) => {
    expect(multiWrite.has(`${file}#${method}`), `${file}#${method} 가 여전히 트랜잭션 밖 다중쓰기다`).toBe(false);
  });

  /** 🔴 대조군 — 탐지기가 살아 있는지. 전건 통과가 "고쳐서"인지 "못 보고"인지 구분하지 못하면 증거가 아니다. */
  it('대조군 — 아직 묶지 않은 자리는 스캐너가 집어낸다', () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(multiWrite.has('consent/consent.service.ts#sign'), '동의서 서명은 아직 다중쓰기로 집혀야 한다').toBe(true);
  });

  /**
   * 🔴 다중쓰기 판정만으로는 **부분 이탈**을 못 잡는다 — 묶은 쓰기 중 하나만 바깥 `this.prisma` 로
   *    빼면 남은 바깥 쓰기가 1회라 행이 서지 않는다(재주입 R6 이 그렇게 통과했다).
   *    스캐너의 `escapes`(트랜잭션 콜백 안인데 바깥 prisma 수신자) 를 정확값으로 동결해 그 자리를 막는다.
   *    지금 1건은 재고 게이트 위반 로그 — 규약상 tx 밖에 남겨야 하는 자리다(차단 롤백에도 남아야 한다).
   */
  it('트랜잭션 콜백 안에서 바깥 prisma 로 쓰는 자리는 정확히 1건(재고 게이트 로그)', () => {
    expect(escapes.map((e) => `${e.file}#${e.model}`)).toEqual(['inventory/inventory.service.ts#gateViolationLog']);
  });
});

/**
 * 스캐너가 여전히 세는 두 메서드 — 다른 분기에 별도 쓰기가 남아 있어 행 자체는 남는다.
 * 그래서 **원장↔상태 쌍이 같은 트랜잭션 콜백 안에 있는지**를 직접 본다(쌍만 보는 판정).
 */
describe('원장과 상태는 같은 트랜잭션 콜백 안에 있다', () => {
  const read = (f: string) => stripForScan(readFileSync(join(MODULES, f), 'utf8')).blanked;

  /** `marker` 가 가리키는 `$transaction(` 의 인자 블록 — 괄호 균형으로 자른다(문자열은 이미 지워져 있다) */
  const txBody = (code: string, marker: string) => {
    const at = code.indexOf(marker);
    expect(at, `트랜잭션 표식을 찾지 못했다: ${marker}`).toBeGreaterThan(-1);
    const open = code.indexOf('(', at + marker.length - 1);
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) return code.slice(open, i + 1); }
    }
    throw new Error('트랜잭션 인자 블록을 닫지 못했다');
  };

  it('응급 처분 — 원장(처분 기록)과 방문 상태가 한 콜백에 있다', () => {
    const body = txBody(read('emergency/emergency.service.ts'), 'record = await this.prisma.$transaction');
    expect(body).toContain('tx.emergencyDispositionRecord.create');
    expect(body).toContain('tx.emergencyVisit.update');
  });

  it('휴가 결재 콜백 — 상태 claim·릴레이 종결·연차 차감이 한 콜백에 있다', () => {
    const body = txBody(read('ess/ess.service.ts'), 'const claimedCount = await this.prisma.$transaction');
    expect(body).toContain('tx.leaveRequest.updateMany');
    expect(body).toContain('tx.eApprovalRelay.updateMany');
    expect(body).toContain('tx.leaveBalance.updateMany');
  });
});

/**
 * 🔴 CSSD 반납·리콜은 **스캐너가 애초에 못 보던 자리**다 — 원장 쓰기가 헬퍼(`this.event()`) 안에 있어
 *    메서드 본문에는 prisma 쓰기가 1회만 보였다. 그래서 `multiWrite` 로 판정하면 결함을 되돌려 넣어도
 *    그대로 통과한다(재주입에서 실제로 통과했다 — 공허한 가드였다). 동작으로 판정한다:
 *    **상태와 원장이 같은 tx 클라이언트로 나가고, 바깥 prisma 로는 나가지 않는다.**
 *    (이 사각 때문에 인벤토리 수는 헬퍼 뒤에 숨은 원장 쓰기를 **과소 계상**한다.)
 */
describe('CSSD 패키지 — 상태와 원장이 같은 트랜잭션 클라이언트로 나간다(동작)', () => {
  const build = (status: string) => {
    const tx = {
      sterilePackage: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'p-1', status: 'RECALLED' }),
      },
      packageEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
      sterilePackage: {
        findUnique: vi.fn().mockResolvedValue({ id: 'p-1', status, expiresAt: new Date('2099-01-01') }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'p-1' }),
      },
      packageEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    return { prisma, tx };
  };

  const svcOf = async (prisma: any) => {
    const { CssdPackageService } = await import('../../src/modules/cssd/cssd-package.service');
    return new (CssdPackageService as any)(prisma, {}, undefined, undefined);
  };

  it('반납 — 원장(packageEvent)이 tx 로 나가고 바깥 prisma 로는 나가지 않는다', async () => {
    const { prisma, tx } = build('IN_USE');
    await (await svcOf(prisma)).returnPackage('p-1', 'u-1');
    expect(tx.sterilePackage.updateMany, '상태 변경이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(tx.packageEvent.create, '원장 기록이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(prisma.packageEvent.create, '원장 기록이 바깥 prisma 로 나갔다(상태 실패해도 적힌다)').not.toHaveBeenCalled();
  });

  it('리콜 — 원장이 tx 로 나가고 바깥 prisma 로는 나가지 않는다', async () => {
    const { prisma, tx } = build('STERILE');
    await (await svcOf(prisma)).recallPackage('p-1', 'u-1', '리콜 사유');
    expect(tx.sterilePackage.update, '상태 변경이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(tx.packageEvent.create, '원장 기록이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(prisma.packageEvent.create, '원장 기록이 바깥 prisma 로 나갔다').not.toHaveBeenCalled();
  });

  it('사용(출고) — 선점과 원장이 같은 tx 로 나간다', async () => {
    const { prisma, tx } = build('STERILE');
    await (await svcOf(prisma)).usePackage('p-1', 'u-1', 'enc-1');
    expect(tx.sterilePackage.updateMany).toHaveBeenCalled();
    expect(tx.packageEvent.create).toHaveBeenCalled();
    expect(prisma.packageEvent.create).not.toHaveBeenCalled();
  });

  /** 대조군 — 이미 반납된 패키지는 아무것도 쓰지 않는다(멱등) */
  it('대조군 — 이미 RETURNED 면 쓰지 않는다', async () => {
    const { prisma, tx } = build('RETURNED');
    await (await svcOf(prisma)).returnPackage('p-1', 'u-1');
    expect(tx.sterilePackage.updateMany).not.toHaveBeenCalled();
    expect(tx.packageEvent.create).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 소스 판정만으로는 "정말 그 트랜잭션 클라이언트로 썼는가"를 못 본다 —
 *    실제로 서비스를 돌려 **연차 차감이 tx 클라이언트에 실리는지**를 본다.
 *    (집 스타일 목은 `$transaction(fn)` 에 자기 자신을 넘겨 안팎이 구분되지 않는다. 여기서는 일부러 갈라 둔다.)
 */
describe('휴가 승인 — 연차 차감은 트랜잭션 클라이언트로 나간다(동작)', () => {
  const build = () => {
    const tx = {
      leaveRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      eApprovalRelay: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      leaveBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
      leaveRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'lr-1', userId: 'u-1', status: 'REQUESTED', type: 'ANNUAL', days: 2,
          fromDate: new Date('2026-09-01'), toDate: new Date('2026-09-02'),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leaveBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      eApprovalRelay: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn() },
      staff: { findUnique: vi.fn().mockResolvedValue(null) },
      dutyEntry: { count: vi.fn().mockResolvedValue(0) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return { prisma, tx };
  };

  const callback = async (prisma: any) => {
    const { EssService } = await import('../../src/modules/ess/ess.service');
    const svc = new (EssService as any)(prisma, { enqueue: vi.fn() }, { get: vi.fn() }, { get: vi.fn() }, {}, {}, {}, { get: vi.fn() });
    return svc.leaveCallback({
      ref: { source_module: 'hr.leave_requests', source_ref: 'lr-1' },
      status: 'APPROVED',
      approvalId: 'ap-1',
    });
  };

  it('연차 차감·상태 claim 이 tx 로 나가고, 바깥 prisma 로는 나가지 않는다', async () => {
    const { prisma, tx } = build();
    await callback(prisma);
    expect(tx.leaveRequest.updateMany, '상태 claim 이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(tx.leaveBalance.updateMany, '연차 차감이 트랜잭션 밖에서 나갔다').toHaveBeenCalled();
    expect(prisma.leaveBalance.updateMany, '연차 차감이 바깥 prisma 로 나갔다').not.toHaveBeenCalled();
    expect(prisma.leaveRequest.updateMany, '상태 claim 이 바깥 prisma 로 나갔다').not.toHaveBeenCalled();
  });

  /** 대조군 — 이미 종결된 신청은 차감하지 않는다(멱등) */
  it('대조군 — 이미 APPROVED 인 신청은 차감하지 않는다', async () => {
    const { prisma, tx } = build();
    prisma.leaveRequest.findUnique.mockResolvedValue({
      id: 'lr-1', userId: 'u-1', status: 'APPROVED', type: 'ANNUAL', days: 2,
      fromDate: new Date('2026-09-01'), toDate: new Date('2026-09-02'),
    });
    const r = await callback(prisma);
    expect(r.idempotent).toBe(true);
    expect(tx.leaveBalance.updateMany).not.toHaveBeenCalled();
  });
});
