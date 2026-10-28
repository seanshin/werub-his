import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationPipe, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LabService } from '../../src/modules/lab/lab.service';
import { AcknowledgeCriticalValueDto } from '../../src/modules/lab/dto/lab-result.dto';
import { LAB_METRICS } from '../../src/modules/data-quality/quality-registry';
import { DiagnosticsBoardService } from '../../src/modules/lab/diagnostics-board.service';

/**
 * 위급검사값 복창(read-back) 실체화 계약 — IPSG.2 / NPSG.02.03.01 · 인증기준 2.3.2·2.3.6
 *
 * 🔴 이 파일이 막는 것(2026-08-18 이전에 실제로 그랬던 상태):
 *   ① 서버가 `data.readBack ?? true` 라 **본문이 비어도 "복창했다"고 법정기록에 적었다.**
 *      화면은 체크박스 없이 늘 `readBack: true` 를 보냈다 — 아무도 복창하지 않았다.
 *   ② `@Roles(DOCTOR, ADMIN)` 뿐이라 **아무 의사나 남의 환자 위급값을 종결**했다.
 *   ③ 담당의 미상 경보(doctorId=NULL)가 **누구의 목록에도 뜨지 않는 고아**가 됐다.
 *   ④ 원자료(위급 flag)에 있는데 경보가 없는 건을 아무도 세지 않아 화면이 초록을 띄웠다.
 *
 * 🔴 가드 규약: 각 테스트는 **결함을 재주입하면 반드시 실패**해야 한다(재주입 검증 완료 — 보고서 참조).
 *    통과 이유가 "표본이 없어 분기가 실행되지 않아서"가 되지 않도록, 픽스처는 분기를 실제로 태운다.
 */

// ── 공통 픽스처 ─────────────────────────────────────────────────────────
const MINE = 'doc-mine';
const OTHER = 'doc-other';

function makeService(alert: Record<string, unknown> | null) {
  const update = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...alert, ...data }));
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma: any = {
    criticalValueAlert: {
      findUnique: vi.fn().mockResolvedValue(alert),
      update,
      findMany,
    },
    patient: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new LabService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma, update, findMany };
}

const ALERT_BASE = {
  id: 'alert-1', labResultId: 'lr-1', patientId: 'p-1', doctorId: MINE,
  testName: '칼륨', value: '7.2', unit: 'mEq/L', reason: '기준치 위급 고치',
  status: 'PENDING', readBackConfirmed: false, acknowledgedBy: null, acknowledgedAt: null,
};

// ── ① 복창은 기본값이 아니다 ────────────────────────────────────────────
describe('① 복창(read-back)은 기본값이 아니라 검증 대상이다', () => {
  it('🔴 readBack=false 는 false 로 남는다 — 서버가 대신 "복창했다"고 적지 않는다', async () => {
    const { service, update } = makeService({ ...ALERT_BASE });
    await service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: false, responseAction: '주치의 보고' });
    expect(update).toHaveBeenCalledTimes(1);
    // 재주입 지점: `readBackConfirmed: data.readBack ?? true` 로 되돌리면 여기서 true 가 되어 실패한다.
    expect(update.mock.calls[0][0].data.readBackConfirmed).toBe(false);
    expect(update.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
  });

  it('🔴 readBack 이 아예 누락돼도 "복창했다"로 적지 않는다 — 서비스 층 방어(DTO 하나만 믿지 않는다)', async () => {
    // 🔴 원래 결함은 `readBackConfirmed: data.readBack ?? true` 였다. DTO 필수화만으로는
    //    서비스를 직접 부르는 다른 경로(내부 호출·향후 배선)가 같은 거짓 기록을 다시 만들 수 있다.
    const { service, update } = makeService({ ...ALERT_BASE });
    await service.acknowledgeCriticalAlert('alert-1', MINE, {} as never);
    expect(update.mock.calls[0][0].data.readBackConfirmed).toBe(false);
  });

  it('🔴 readBack=true 라도 되읽은 값이 통보값과 다르면 확인되지 않는다(400) — 기록도 남지 않는다', async () => {
    const { service, update } = makeService({ ...ALERT_BASE });
    await expect(
      service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: true, readBackValue: '2.7', responseAction: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled(); // 잘못 들은 값으로 종결되면 안 된다
  });

  it('readBack=true 인데 되읽은 값이 없으면 400', async () => {
    const { service, update } = makeService({ ...ALERT_BASE });
    await expect(
      service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: true, readBackValue: '  ', responseAction: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('되읽은 값이 일치하면 확인으로 기록된다(표기 차이는 복창 오류가 아니다)', async () => {
    for (const spoken of ['7.2', ' 7.20 ', '+7.2']) {
      const { service, update } = makeService({ ...ALERT_BASE });
      await service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: true, readBackValue: spoken, responseAction: 'KCl 중단' });
      expect(update.mock.calls[0][0].data.readBackConfirmed).toBe(true);
    }
  });

  it('🔴 숫자 아닌 통보값도 문자열로 대조한다 — 아무 문자열이나 통과하지 않는다', async () => {
    const qualitative = { ...ALERT_BASE, value: 'POSITIVE', unit: '' };
    const bad = makeService({ ...qualitative });
    await expect(
      bad.service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: true, readBackValue: 'NEGATIVE', responseAction: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const good = makeService({ ...qualitative });
    await good.service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: true, readBackValue: 'positive', responseAction: 'x' });
    expect(good.update.mock.calls[0][0].data.readBackConfirmed).toBe(true);
  });
});

// ── ① DTO — 파이프가 실제로 검증하는가 ─────────────────────────────────
describe('① DTO 계약 — ValidationPipe 가 실제로 실행된다', () => {
  // 전역 파이프와 동일 설정(main.ts) — whitelist:true 는 DTO 에 없는 키를 조용히 지운다.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
  const meta = { type: 'body' as const, metatype: AcknowledgeCriticalValueDto, data: '' };

  it('🔴 readBack 을 보내지 않으면 400 — 서버가 기본값을 정하지 않는다', async () => {
    await expect(pipe.transform({ responseAction: '조치' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 readBack=true 인데 readBackValue 가 없으면 400', async () => {
    await expect(pipe.transform({ readBack: true, responseAction: '조치' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('readBack=false 는 readBackValue 없이 통과한다(정당한 경로)', async () => {
    const out = await pipe.transform({ readBack: false, responseAction: '조치' }, meta);
    expect(out.readBack).toBe(false);
  });

  it('🔴 화면이 보내는 키가 whitelist 에 전부 살아남는다(조용한 삭제 방지)', async () => {
    const out = await pipe.transform(
      { readBack: true, readBackValue: '7.2', delegationReason: '담당의 수술 중', responseAction: '조치' },
      meta,
    );
    expect(out).toMatchObject({ readBack: true, readBackValue: '7.2', delegationReason: '담당의 수술 중', responseAction: '조치' });
  });
});

// ── ② 확인 권한 ────────────────────────────────────────────────────────
describe('② 확인 권한 — 본인 / 담당의 미지정 / 대리(사유 필수)', () => {
  it('🔴 남의 위급값을 사유 없이 종결할 수 없다(403)', async () => {
    const { service, update } = makeService({ ...ALERT_BASE, doctorId: MINE });
    await expect(
      service.acknowledgeCriticalAlert('alert-1', OTHER, { readBack: false, responseAction: '조치' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('🔴 형식적 사유(".")로 우회할 수 없다', async () => {
    const { service } = makeService({ ...ALERT_BASE, doctorId: MINE });
    await expect(
      service.acknowledgeCriticalAlert('alert-1', OTHER, { readBack: false, responseAction: '조치', delegationReason: '  .  ' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 담당의 부재 시 위급값이 방치되지 않는다 — 사유를 남기면 당직의가 대리 확인할 수 있다', async () => {
    const { service, update } = makeService({ ...ALERT_BASE, doctorId: MINE });
    await service.acknowledgeCriticalAlert('alert-1', OTHER, {
      readBack: true, readBackValue: '7.2', responseAction: 'KCl 중단 지시', delegationReason: '담당의 수술 중, 야간 당직 대응',
    });
    const data = update.mock.calls[0][0].data;
    expect(data.acknowledgedBy).toBe(OTHER);           // 실제 확인자
    expect(data.readBackConfirmed).toBe(true);
    // 통보 대상 담당의(doctorId)는 덮어쓰지 않는다 → acknowledgedBy ≠ doctorId 가 대리 확인의 기계적 증거
    expect(data.doctorId).toBeUndefined();
    expect(String(data.responseAction)).toContain(LabService.DELEGATED_ACK_PREFIX);
    expect(String(data.responseAction)).toContain('담당의 수술 중');
  });

  it('담당의 미지정 경보는 대리가 아니다 — 사유 없이 확인 가능하고 그 사실이 기록된다', async () => {
    const { service, update } = makeService({ ...ALERT_BASE, doctorId: null });
    await service.acknowledgeCriticalAlert('alert-1', OTHER, { readBack: false, responseAction: '조치' });
    const data = update.mock.calls[0][0].data;
    expect(data.acknowledgedBy).toBe(OTHER);
    expect(String(data.responseAction)).toContain('담당의 미지정');
  });

  it('본인 확인은 사유를 묻지 않고 대리 표식도 남기지 않는다', async () => {
    const { service, update } = makeService({ ...ALERT_BASE, doctorId: MINE });
    await service.acknowledgeCriticalAlert('alert-1', MINE, { readBack: false, responseAction: '조치' });
    expect(String(update.mock.calls[0][0].data.responseAction)).not.toContain(LabService.DELEGATED_ACK_PREFIX);
  });

  it('없는 경보는 404', async () => {
    const { service } = makeService(null);
    await expect(service.acknowledgeCriticalAlert('nope', MINE, { readBack: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── ③ 고아 경보 ────────────────────────────────────────────────────────
describe('③ 담당의 미지정 경보가 아무에게도 보이지 않던 것', () => {
  it('🔴 DOCTOR 목록은 내 것 + 담당의 미지정(+ 2026-09-30 허용시간 초과로 상향된 경보)을 함께 조회한다', async () => {
    const { service, findMany } = makeService({ ...ALERT_BASE });
    await service.getPendingCriticalAlerts(MINE, 'DOCTOR');
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['PENDING', 'ESCALATED'] },
      OR: [{ doctorId: MINE }, { doctorId: null }, { status: 'ESCALATED' }],
    });
  });

  it('확인 권한 없는 직군(NURSE)에게는 담당의 미지정 PENDING 을 띄우지 않는다 — 상향된 경보만 함께 본다(2026-09-30)', async () => {
    // 행동 검증은 critical-value-escalated-visibility.spec.ts(인메모리 where 평가)
    const { service, findMany } = makeService({ ...ALERT_BASE });
    await service.getPendingCriticalAlerts('nurse-1', 'NURSE');
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['PENDING', 'ESCALATED'] },
      OR: [{ doctorId: 'nurse-1' }, { status: 'ESCALATED' }],
    });
  });

  it('목록의 각 건은 unassigned/isMine 으로 구분된다(화면이 뒤섞지 않도록)', async () => {
    const { service, findMany } = makeService({ ...ALERT_BASE });
    findMany.mockResolvedValueOnce([
      { ...ALERT_BASE, id: 'a1', doctorId: MINE },
      { ...ALERT_BASE, id: 'a2', doctorId: null },
    ]);
    const rows = await service.getPendingCriticalAlerts(MINE, 'DOCTOR');
    expect(rows.map((r) => [r.isMine, r.unassigned])).toEqual([[true, false], [false, true]]);
  });
});

// ── ④ 원자료와 경보의 괴리 ─────────────────────────────────────────────
describe('④ 원자료에 위급 flag 가 있는데 경보가 없는 것을 드러낸다', () => {
  const metric = LAB_METRICS.find((m) => m.key === 'lab.criticalUnalerted')!;

  it('지표가 등록되어 있고 드릴다운이 있다(규약)', () => {
    expect(metric).toBeTruthy();
    expect(metric.drillDown).toBeTruthy();
  });

  it('🔴 경보가 없는 위급 flag 결과를 센다 — 분모(위급 flag 전체)도 함께 낸다', async () => {
    const p: any = {
      labResultItem: { groupBy: vi.fn().mockResolvedValue([{ labResultId: 'lr-1' }, { labResultId: 'lr-2' }, { labResultId: 'lr-3' }]) },
      criticalValueAlert: { findMany: vi.fn().mockResolvedValue([{ labResultId: 'lr-2' }]) },
    };
    const r = await metric.compute(p);
    expect(r).toEqual({ value: 2, total: 3 }); // lr-1·lr-3 은 경보 없음
    // 원자료 훑기는 flag 정본 목록을 쓴다(HH/LL 만 손으로 적으면 정성 위급 AA 를 놓친다)
    const flags = p.labResultItem.groupBy.mock.calls[0][0].where.flag.in;
    expect(flags).toEqual(expect.arrayContaining(['HH', 'LL', 'AA']));
  });

  it('🔴 위급 flag 결과가 아예 없으면 0/0 — "괴리 0"이 표본 부재임이 드러난다', async () => {
    const p: any = { labResultItem: { groupBy: vi.fn().mockResolvedValue([]) }, criticalValueAlert: { findMany: vi.fn() } };
    expect(await metric.compute(p)).toEqual({ value: 0, total: 0 });
  });

  it('🔴 복창 누락 지표는 분모를 함께 낸다 — 확인 건이 0 이면 "누락 0"은 성과가 아니다', async () => {
    const rb = LAB_METRICS.find((m) => m.key === 'lab.readBackMissing')!;
    const count = vi.fn()
      .mockResolvedValueOnce(3)   // 분자: readBackConfirmed=false
      .mockResolvedValueOnce(10); // 분모: 확인 완료 전체
    const r = await rb.compute({ criticalValueAlert: { count } } as any);
    expect(r).toEqual({ value: 3, total: 10 });
    expect(count.mock.calls[1][0].where.readBackConfirmed).toBeUndefined(); // 분모에 분자 조건이 섞이면 안 된다
  });

  it('🔴 진단검사 보드가 경보 부재를 요약에 싣는다 — "경보 0"만 보고 초록을 띄우지 못하게', async () => {
    const prisma: any = {
      criticalValueAlert: { findMany: vi.fn() },
      labResultItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'i1', labResultId: 'lr-1', testName: 'Glucose', value: '646', unit: 'mg/dL', flag: 'HH' },
          { id: 'i2', labResultId: 'lr-2', testName: 'Na', value: '99.6', unit: 'mEq/L', flag: 'LL' },
        ]),
      },
      labResult: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([{ id: 'lr-1', patientId: 'p1', completedAt: new Date(), createdAt: new Date(), status: 'COMPLETED', patient: { familyName: '홍', givenName: '길동', mrn: 'M1' } }]) },
      imagingResult: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
      diagnosticTest: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findMany: vi.fn().mockResolvedValue([]) },
    };
    // 미확인 경보 0건(첫 호출) · 위급 flag 결과 중 경보 보유 0건(두 번째 호출) = 종전이면 초록이 뜨던 상태
    prisma.criticalValueAlert.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const board = await new DiagnosticsBoardService(prisma).getBoard();
    expect(board.summary.criticalPending).toBe(0);
    expect(board.summary.criticalUnalerted).toBe(2);
    expect(board.summary.criticalFlagTotal).toBe(2);
    expect(board.criticalUnalertedList).toHaveLength(2);
  });
});
