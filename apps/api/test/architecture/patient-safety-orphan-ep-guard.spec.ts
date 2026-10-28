import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { isVerbalOrder, VERBAL_ORDER_SOURCES, canConfirmReadBack } from '@hospital-run/shared';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

/**
 * 환자안전 고아 EP 회수 가드 — 2026-08-26 (레인 F3).
 *
 * 배경: 쓰기 EP 는 있는데 **부르는 화면이 없어서** 개통 이래 한 번도 실행된 적 없던 것들.
 * 여기서 못 박는 것은 세 가지다.
 *
 *  ① **호출부가 다시 사라지지 않는다** — EP 를 만든 것과 부르는 화면이 있는 것은 다른 일이다.
 *     화면에서 배선을 지우면 이 가드가 깨진다(그것이 이 결함의 실제 모양이었다).
 *  ② **복창은 자동으로 통과하지 않는다** — 서면 지시에 복창을 찍을 수 없고, 이미 확인된 건을 덮지 않는다.
 *  ③ **대조는 셀 것이 있어야 대조다** — 신생아 식별밴드를 입력하는 칸이 화면에 있어야
 *     `verify-match` 가 구조적 실패에서 벗어난다(v4.5.0 "계수 입력 UI 부재"와 같은 형태).
 *
 * 🔴 각 가드에는 **대조군**을 둔다 — 정상 입력을 실패로 말하지 않는지도 함께 본다
 *    (무조건 통과·무조건 실패하는 가드는 가드가 아니다).
 */

const REPO = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

type Row = Record<string, unknown>;

/* ═══════════════════════════════════════════════════════════
   ① 호출부 재소실 방지 — 화면이 실제로 그 EP 를 부르는가
   ═══════════════════════════════════════════════════════════ */

describe('고아 EP 회수 — 부르는 화면이 존재한다', () => {
  it('구두처방 복창 확인 EP 를 `/safety` 화면이 부른다', () => {
    const page = read('apps/web/src/app/(main)/safety/page.tsx');
    expect(page).toContain('/api/v1/safety/read-back/pending');
    // 확인(PATCH)은 템플릿 리터럴로 id 를 붙인다
    expect(page).toMatch(/apiClient\.patch\(`\/api\/v1\/safety\/read-back\/\$\{[^}]+\}`/);
  });

  it('수혈반응 상세 보고 EP 를 침상 수혈 실행 화면이 부른다', () => {
    const page = read('apps/web/src/app/(main)/workstation/blood-bank/page.tsx');
    expect(page).toMatch(/apiClient\.post\(`\/api\/v1\/blood-bank\/transfusions\/\$\{[^}]+\}\/reaction-report`/);
  });

  it('모아 식별밴드 대조 EP 를 분만장 보드가 부른다', () => {
    const board = read('apps/web/src/app/(main)/obgyn/DeliveryBoard.tsx');
    expect(board).toMatch(/apiClient\.post\(`\/api\/v1\/obgyn\/newborns\/\$\{[^}]+\}\/verify-match`/);
  });

  it('🔴 대조군 — 존재하지 않는 EP 를 부른다고 단정하지 않는다(가드가 아무 문자열에나 통과하지 않는다)', () => {
    const page = read('apps/web/src/app/(main)/safety/page.tsx');
    expect(page).not.toContain('/api/v1/safety/this-endpoint-does-not-exist');
  });
});

/* ═══════════════════════════════════════════════════════════
   ② 대조에 쓸 값을 입력하는 칸이 화면에 있는가
   ═══════════════════════════════════════════════════════════ */

describe('탐지기가 셀 것 — 입력 칸이 화면에 있다', () => {
  it('신생아 기록 폼이 식별밴드 번호(신생아·산모)를 묻는다', () => {
    const board = read('apps/web/src/app/(main)/obgyn/DeliveryBoard.tsx');
    // 🔴 이 두 칸이 없으면 verify-match 는 저장된 값이 NULL 이라 **항상 실패**한다
    expect(board).toContain('idBandNo');
    expect(board).toContain('motherBandNo');
  });

  it('🔴 신생아 성별 초기값이 미선택이다 — 고르지 않고 저장하면 남아로 기록되던 것(P16)', () => {
    const board = read('apps/web/src/app/(main)/obgyn/DeliveryBoard.tsx');
    expect(board).not.toMatch(/useState\(\{\s*sex:\s*'M'/);
    expect(board).toMatch(/sex:\s*''/);
  });

  it('🔴 밴드 번호를 서버가 화면으로 내려보내지 않는다 — 정답이 보이면 대조가 아니라 베껴 쓰기다', () => {
    const svc = read('apps/api/src/modules/obgyn/obgyn.service.ts');
    // getBoard 매핑이 번호를 제거하고 등록 여부만 남긴다
    expect(svc).toMatch(/newborns:\s*r\.newborns\.map\(\(\{\s*idBandNo,\s*motherBandNo,\s*\.\.\.n\s*\}\)/);
    expect(svc).toContain('bandsRegistered');
  });

  it('🔴 verify-match 가 인라인 @Body 가 아니다 — 인라인 객체는 ValidationPipe 가 통째로 스킵한다', () => {
    const ctl = read('apps/api/src/modules/obgyn/obgyn.controller.ts');
    // 🔴 import 줄에 이름이 있다고 쓰이는 것은 아니다 — **핸들러 시그니처**를 본다
    //    (첫 판정은 `[^)]*` 가 `ParseUUIDPipe)` 에서 멈춰 재주입을 놓쳤다).
    const sig = /async verifyMatch\([\s\S]{0,240}?\)\s*\{/.exec(ctl)?.[0];
    expect(sig).toBeTruthy();
    expect(sig!).toContain('VerifyNewbornMatchDto');
    // 인라인 객체 타입이 되살아나면 여기서 걸린다
    expect(sig!).not.toMatch(/@Body\(\)\s*\w+\s*:\s*\{/);
    // 이 컨트롤러 전체에 인라인 @Body 객체 타입이 없다
    expect(ctl).not.toMatch(/@Body\(\)\s*\w+\s*:\s*\{/);
  });

  it('🔴 verify-match 를 간호사가 부를 수 있다 — 실제로 대조하는 사람이다(권한 역전)', () => {
    const ctl = read('apps/api/src/modules/obgyn/obgyn.controller.ts');
    const idx = ctl.indexOf("@Post('newborns/:id/verify-match')");
    expect(idx).toBeGreaterThan(-1);
    // 🔴 데코레이터 블록은 `@Post` 부터 **그 핸들러의 시그니처까지**다.
    //    고정 길이로 자르면 `@Roles` 를 지워도 **다음 핸들러의 @Roles** 를 읽어 통과한다
    //    (첫 판정이 실제로 그렇게 헛돌았다 — 가드가 다른 이유로 통과하면 가드가 아니다).
    const end = ctl.indexOf('async verifyMatch', idx);
    expect(end).toBeGreaterThan(idx);
    const block = ctl.slice(idx, end);
    expect(block).toContain('UserRole.NURSE');
    // 클래스 기본값(DOCTOR·ADMIN)만 남는 상태를 허용하지 않는다
    expect(block).toMatch(/@Roles\(/);
  });
});

/* ═══════════════════════════════════════════════════════════
   ③ 어휘 정본 — 지시 경로가 두 곳에 적혀 있지 않다
   ═══════════════════════════════════════════════════════════ */

describe('지시 경로 어휘 정본은 shared 한 벌', () => {
  it('복창 대상 경로는 VERBAL·TELEPHONE 이고 서면은 아니다', () => {
    expect([...VERBAL_ORDER_SOURCES].sort()).toEqual(['TELEPHONE', 'VERBAL']);
    expect(isVerbalOrder('VERBAL')).toBe(true);
    expect(isVerbalOrder('TELEPHONE')).toBe(true);
    // 🔴 대조군 — 서면·미상에는 복창 개념이 없다(없는 것을 '누락'으로 세면 분모가 오염된다)
    expect(isVerbalOrder('WRITTEN')).toBe(false);
    expect(isVerbalOrder(undefined)).toBe(false);
    expect(isVerbalOrder(null)).toBe(false);
  });

  it('🔴 API·FE 어느 쪽도 어휘를 자기 파일에 다시 적지 않는다', () => {
    const rxSvc = read('apps/api/src/modules/prescription/prescription.service.ts');
    // 인라인 비교가 되살아나면 두 벌이 되고, 한쪽에 값을 늘릴 때 조용히 갈라진다
    expect(rxSvc).not.toMatch(/orderSource\s*===\s*'VERBAL'\s*\|\|\s*orderSource\s*===\s*'TELEPHONE'/);
    expect(rxSvc).toContain('isVerbalOrder');

    const delegate = read('apps/web/src/components/prescription/PrescriberDelegate.tsx');
    expect(delegate).not.toMatch(/export const isVerbalOrder\s*=/);
    expect(delegate).toContain("from '@hospital-run/shared'");
  });

  it('🔴 복창 확인 탭이 최소 권한 직군에게 뜨지 않는다 — API 는 임상 3역할이다', () => {
    expect(canConfirmReadBack('NURSE')).toBe(true);
    expect(canConfirmReadBack('DOCTOR')).toBe(true);
    expect(canConfirmReadBack('ADMIN')).toBe(true);
    // 🔴 대조군 — 급양·원무 계정이 탭을 눌러 403 빨간 배너를 보지 않는다
    expect(canConfirmReadBack('NUTRITION')).toBe(false);
    expect(canConfirmReadBack('RECEPTIONIST')).toBe(false);
    expect(canConfirmReadBack(undefined)).toBe(false);

    // 🔴 2026-08-27 — 탭 게이트가 `page.tsx` 에서 `safety-access.ts` 로 옮겨졌다(역할 AND 권한 판정).
    //    종전 가드는 **심볼이 어느 파일에 있는지**를 못박아, 정본을 옮기자 회귀가 아닌데 실패했다.
    //    의도("복창 탭이 최소 권한 직군에게 안 뜬다")를 유지하되 **판정이 정본을 지나는지**를 본다.
    const access = read('apps/web/src/app/(main)/safety/safety-access.ts');
    expect(access).toContain('canConfirmReadBack');
    const page = read('apps/web/src/app/(main)/safety/page.tsx');
    expect(page, '화면이 탭 게이트 정본을 쓰지 않으면 자기 판정을 새로 적게 된다').toContain('visibleSafetyTabs');
    expect(page, '화면이 탭 목록을 다시 나열하면 정본과 갈라진다').not.toMatch(/key:\s*'readback'/);
  });
});

/* ═══════════════════════════════════════════════════════════
   ④ 복창 확인이 자동으로 통과하지 않는다
   ═══════════════════════════════════════════════════════════ */

function svcWithPrescription(rx: Row | null) {
  const updates: Row[] = [];
  const prisma = {
    prescription: {
      findUnique: async () => rx,
      findMany: async () => [],
      update: async (args: { data: Row }) => { updates.push(args.data); return { ...(rx ?? {}), ...args.data }; },
    },
    user: { findMany: async () => [] },
  } as unknown as ConstructorParameters<typeof PatientSafetyService>[0];
  const events = { emit: () => true } as never;
  const svc = new PatientSafetyService(prisma, events);
  return { svc, updates };
}

describe('복창 확인 — 숨기는 방향으로는 자동이 없다', () => {
  it('🔴 서면 지시에는 복창을 찍을 수 없다', async () => {
    const { svc, updates } = svcWithPrescription({ id: 'rx1', orderSource: 'WRITTEN', readBackConfirmedAt: null });
    await expect(svc.confirmReadBack('rx1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    // 거부했으면 아무것도 쓰지 않았어야 한다
    expect(updates).toHaveLength(0);
  });

  it('🔴 이미 확인된 건을 덮지 않는다 — 먼저 확인한 사람의 기록이 원장이다', async () => {
    const { svc, updates } = svcWithPrescription({ id: 'rx1', orderSource: 'VERBAL', readBackConfirmedAt: new Date('2026-08-20T00:00:00Z') });
    await expect(svc.confirmReadBack('rx1', 'u2')).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('없는 처방은 404 다', async () => {
    const { svc } = svcWithPrescription(null);
    await expect(svc.confirmReadBack('rx-none', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('🔴 대조군 — 진짜 미확인 구두처방은 확인된다(가드가 전부를 막지 않는다)', async () => {
    const { svc, updates } = svcWithPrescription({ id: 'rx1', orderSource: 'TELEPHONE', readBackConfirmedAt: null });
    await svc.confirmReadBack('rx1', 'u1');
    expect(updates).toHaveLength(1);
    expect(updates[0].readBackConfirmedBy).toBe('u1');
    // 🔴 확인 시각은 **지금**이다 — 소급 입력 경로가 없다
    expect(updates[0].readBackConfirmedAt).toBeInstanceOf(Date);
  });

  it('🔴 미확인 목록의 분모는 구두·전화뿐이다 — 서면을 섞으면 "복창 누락"이 부풀려진다', async () => {
    let captured: Row | null = null;
    const prisma = {
      prescription: {
        findMany: async (args: { where: Row }) => { captured = args.where; return []; },
      },
      user: { findMany: async () => [] },
    } as unknown as ConstructorParameters<typeof PatientSafetyService>[0];
    const svc = new PatientSafetyService(prisma, { emit: () => true } as never);
    await svc.getPendingReadBacks();
    const where = captured as unknown as { orderSource: { in: string[] }; readBackConfirmedAt: null };
    expect([...where.orderSource.in].sort()).toEqual(['TELEPHONE', 'VERBAL']);
    expect(where.readBackConfirmedAt).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
   ⑤ 수혈반응 — 보내지 않은 것을 보냈다고 적지 않는다
   ═══════════════════════════════════════════════════════════ */

describe('수혈반응 보고 화면의 정직성', () => {
  const page = () => read('apps/web/src/app/(main)/workstation/blood-bank/page.tsx');

  it('🔴 혈액원 신고 체크가 "시스템이 전송했다"고 말하지 않는다 — 전송 코드가 존재하지 않는다', () => {
    const src = page();
    // 화면이 그 한계를 그 자리에서 말한다
    expect(src).toMatch(/이 시스템은 혈액원으로 전송하지 않습니다/);
    // 실제로 전송 경로가 없다는 사실을 함께 못 박는다
    const api = read('apps/api/src/modules/blood-bank/blood-bank.service.ts');
    expect(api).not.toMatch(/(fetch|axios|httpService)[\s\S]{0,80}bloodCenter/i);
  });

  it('🔴 반응 유형·중증도 초기값이 미선택이다 — 미리 고르면 틀린 유형이 클릭 한 번에 원장에 남는다', () => {
    const src = page();
    expect(src).toMatch(/const \[reactionType, setReactionType\] = useState\(''\)/);
    expect(src).toMatch(/const \[severity, setSeverity\] = useState\(''\)/);
  });

  it('🔴 수혈이 시작되기 전에는 반응을 보고할 수 없다 — 일어날 수 없는 일을 기록하지 않는다', () => {
    const src = page();
    const idx = src.indexOf("=== 'IN_PROGRESS' || st === 'COMPLETED' || st === 'REACTION'");
    expect(idx).toBeGreaterThan(-1);
    // 대조군 — PENDING/VERIFIED 는 그 조건에 없다
    const cond = src.slice(idx - 20, idx + 70);
    expect(cond).not.toContain("'PENDING'");
  });

  it('🔴 지연성 반응을 보고할 수 있다 — 완료·반응 건을 불러오지 않으면 보고할 대상이 목록에 없다', () => {
    const src = page();
    expect(src).toContain('/api/v1/blood-bank/transfusions?status=COMPLETED');
    expect(src).toContain('/api/v1/blood-bank/transfusions?status=REACTION');
    // 🔴 실패를 "없음"으로 번역하지 않는다 — `.catch(() => [])` 가 있으면 안 된다
    expect(src).not.toMatch(/status=(COMPLETED|REACTION)[\s\S]{0,200}\.catch\(\s*\(\)\s*=>\s*\[\]\s*\)/);
  });

  it('🔴 투여량 입력이 행마다 분리돼 있다 — 한 칸을 공유하면 A 환자 값이 B 환자 원장에 실린다', () => {
    const src = page();
    expect(src).toMatch(/const \[txVolume, setTxVolume\] = useState<Record<string, string>>\(\{\}\)/);
  });
});
