import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { isDiagnosticTestType, DIAGNOSTIC_TEST_TYPE_CODES } from '@hospital-run/shared';
import { DiagnosticTestService } from '../../src/modules/diagnostic-test/diagnostic-test.service';

/**
 * 기초검사 자리 큐 · 검사값 저장 가드 — 2026-08-26.
 *
 * 🔴 봉합한 실결함:
 *   ① 자리 설정 코드가 코드 마스터와 하나도 안 맞으면 **부서 전체(LAB)로 폴백**해서,
 *      심전도·폐기능·내시경·청력·심장 다섯 자리가 전부 같은 채혈 오더를 보고 있었다.
 *      → 설정이 없으면 **빈 목록 + `configured:false`**. 폴백은 없다.
 *   ② 자리 설정이 없는데 대기 건수를 `0` 으로 세면 사람이 한가한 줄 안다 → `null`(산출 불가).
 *   ③ 판독이 기사가 먼저 저장한 측정값을 통째로 덮어 지웠다 → 병합.
 *   ④ 숫자 항목을 문자열로 저장하면 델타체크(`Number(v)`)가 조용히 어긋난다 → 숫자로 정규화.
 *   ⑤ 정본에 없는 키를 whitelist 로 지우면 입력값이 성공 토스트와 함께 사라진다 → 미지 키 보존.
 */

type Row = Record<string, unknown>;

function makePrisma(opts: {
  station?: Row | null;
  stations?: Row[];
  tests?: Row[];
  test?: Row | null;
}) {
  const updates: Row[] = [];
  const prisma = {
    workstationConfig: {
      findUnique: async () => opts.station ?? null,
      findMany: async () => opts.stations ?? [],
      update: async (args: { data: Row }) => { updates.push(args.data); return args.data; },
      create: async (args: { data: Row }) => args.data,
      aggregate: async () => ({ _max: { sortOrder: 0 } }),
    },
    diagnosticTest: {
      findMany: async () => opts.tests ?? [],
      findFirst: async () => null,
      count: async () => (opts.tests ?? []).length,
      findUnique: async () => opts.test ?? null,
      update: async (args: { data: Row }) => { updates.push(args.data); return args.data; },
    },
    user: { findMany: async () => [] },
  };
  return { prisma, updates };
}

const svc = (prisma: unknown) => new DiagnosticTestService(prisma as never);

const patient = { id: 'p1', mrn: 'M1', familyName: '홍', givenName: '길동', gender: 'MALE', dateOfBirth: new Date('1980-01-01') };

describe('자리 큐 — 설정이 없으면 폴백하지 않는다', () => {
  it('🔴 설정 코드가 정본 어휘와 교집합 0 이면 빈 목록 + configured:false (남의 오더를 보여주지 않는다)', async () => {
    // 운영 실측: 내시경실 order_codes = EGD/COLONOSCOPY/ERCP/EUS/CAPSULE (정본은 ENDOSCOPY_UPPER/LOWER)
    const { prisma } = makePrisma({
      station: { stationId: 'diag-endoscopy', label: '내시경실', category: 'DIAGNOSTIC', isActive: true, orderCodes: ['EGD', 'COLONOSCOPY'] },
      tests: [{ id: 't1', testType: 'ENDOSCOPY_UPPER' }],
    });
    const res = await svc(prisma).getStationQueue('diag-endoscopy');
    expect(res.items).toEqual([]);
    expect(res.meta.configured).toBe(false);
    expect(res.meta.unknownCodes).toEqual(['EGD', 'COLONOSCOPY']);
  });

  it('대조군 — 올바로 설정된 자리는 실제로 목록을 돌려준다(무조건 빈 목록이면 위 검사가 헛돈다)', async () => {
    const { prisma } = makePrisma({
      station: { stationId: 'diag-ecg', label: '심전도실', category: 'DIAGNOSTIC', isActive: true, orderCodes: ['EKG', 'HOLTER'] },
      tests: [
        { id: 't1', patientId: 'p1', testType: 'EKG', testName: '심전도', status: 'ORDERED', priority: 'ROUTINE', scheduledAt: null, performedAt: null, createdAt: new Date(Date.now() - 30 * 60000), roomName: null, equipmentName: null, targetTatMinutes: null, measurements: null, performedBy: null, patient },
        { id: 't2', patientId: 'p2', testType: 'HOLTER', testName: 'Holter', status: 'IN_PROGRESS', priority: 'STAT', scheduledAt: null, performedAt: null, createdAt: new Date(Date.now() - 5 * 60000), roomName: null, equipmentName: null, targetTatMinutes: 20, measurements: { hrAvg: 70 }, performedBy: null, patient },
      ],
    });
    const res = await svc(prisma).getStationQueue('diag-ecg');
    expect(res.meta.configured).toBe(true);
    expect(res.items.length).toBe(2);
    // STAT 이 먼저
    expect(res.items[0].id).toBe('t2');
    expect(res.items[1].waitingMinutes).toBeGreaterThanOrEqual(29);
    expect(res.items[0].measuredCount).toBe(1);
  });

  it('🔴 목표 소요시간이 없으면 지연 여부를 판정하지 않는다(null — false 로 "정상"이라 말하지 않는다)', async () => {
    const { prisma } = makePrisma({
      station: { stationId: 'diag-ecg', label: '심전도실', category: 'DIAGNOSTIC', isActive: true, orderCodes: ['EKG'] },
      tests: [{ id: 't1', patientId: 'p1', testType: 'EKG', testName: '심전도', status: 'ORDERED', priority: 'ROUTINE', scheduledAt: null, performedAt: null, createdAt: new Date(Date.now() - 600 * 60000), roomName: null, equipmentName: null, targetTatMinutes: null, measurements: null, performedBy: null, patient }],
    });
    const res = await svc(prisma).getStationQueue('diag-ecg');
    expect(res.items[0].tatOverdue).toBeNull();
  });
});

describe('자리 목록 — 미설정은 0 이 아니라 null', () => {
  it('🔴 설정이 없는 자리의 대기 건수는 null(산출 불가)', async () => {
    const { prisma } = makePrisma({
      stations: [
        { stationId: 'diag-ecg', label: '심전도실', category: 'DIAGNOSTIC', department: '내과', location: null, sortOrder: 1, isActive: true, orderCodes: ['EKG'] },
        { stationId: 'diag-hearing', label: '청력검사실', category: 'DIAGNOSTIC', department: '이비인후과', location: null, sortOrder: 2, isActive: true, orderCodes: ['PTA'] },
      ],
      tests: [{ id: 't1' }],
    });
    const { stations, unassignedTestTypes } = await svc(prisma).listStations();
    expect(stations[0].waiting).toBe(1);        // 설정된 자리는 실제로 센다(대조군)
    expect(stations[1].waiting).toBeNull();     // 미설정은 0 이 아니다
    expect(stations[1].configured).toBe(false);
    // 어느 자리에도 없는 종류를 숨기지 않는다
    expect(unassignedTestTypes).toContain('AUDIOMETRY');
    expect(unassignedTestTypes).not.toContain('EKG');
  });
});

describe('자리 설정 저장', () => {
  it('🔴 기초검사 자리가 아니면 거부한다 — 검사실 자리의 수가코드 설정을 덮으면 그 큐가 죽는다', async () => {
    const { prisma } = makePrisma({
      station: { stationId: 'lab-chemistry', label: '생화학검사실', category: 'LAB', isActive: true, orderCodes: ['CBC'] },
    });
    await expect(svc(prisma).setStationTestTypes('lab-chemistry', { testTypes: ['EKG'] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('대조군 — 기초검사 자리는 저장된다', async () => {
    const { prisma, updates } = makePrisma({
      station: { stationId: 'diag-ecg', label: '심전도실', category: 'DIAGNOSTIC', isActive: true, orderCodes: [] },
    });
    await svc(prisma).setStationTestTypes('diag-ecg', { testTypes: ['EKG', 'HOLTER'], location: '본관 2층' });
    expect(updates[0]).toMatchObject({ orderCodes: ['EKG', 'HOLTER'], location: '본관 2층' });
  });
});

describe('검사값 저장', () => {
  const baseTest = { id: 't1', patientId: 'p1', testType: 'EKG', status: 'IN_PROGRESS', roomName: '심전도실', measurements: null, performedBy: 'u1', performedAt: new Date() };

  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let updates: Row[];
  beforeEach(() => {
    const m = makePrisma({ test: { ...baseTest } });
    prisma = m.prisma; updates = m.updates;
  });

  it('빈 문자열은 값이 아니다 — 저장하지 않고, 전부 비면 "저장했다"고 말하지 않는다', async () => {
    await expect(svc(prisma).saveMeasurements('t1', { heartRate: '', rhythm: '   ' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 숫자 항목은 숫자로 저장된다(문자열로 두면 델타체크가 조용히 어긋난다)', async () => {
    await svc(prisma).saveMeasurements('t1', { heartRate: '72', qtc: 430 }, 'u1');
    expect(updates[0].measurements).toEqual({ heartRate: 72, qtc: 430 });
  });

  it('물리적으로 불가능한 값은 400 으로 거절한다(조용히 저장하지 않는다)', async () => {
    await expect(svc(prisma).saveMeasurements('t1', { heartRate: '5000' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc(prisma).saveMeasurements('t1', { heartRate: '없음' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('선택지에 없는 값은 거절한다', async () => {
    await expect(svc(prisma).saveMeasurements('t1', { rhythm: '지어낸리듬' }, 'u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 정본에 없는 키는 버리지 않는다(장비별 항목 — whitelist 로 지우면 입력이 사라진다)', async () => {
    await svc(prisma).saveMeasurements('t1', { vendorSpecificIndex: '3.2' }, 'u1');
    expect(updates[0].measurements).toEqual({ vendorSpecificIndex: '3.2' });
  });

  it('부분 입력은 기존 값을 지우지 않고 병합한다(이어쓰기)', async () => {
    const m = makePrisma({ test: { ...baseTest, measurements: { heartRate: 60, axis: '정상축' } } });
    await svc(m.prisma).saveMeasurements('t1', { qtc: '430' }, 'u1');
    expect(m.updates[0].measurements).toEqual({ heartRate: 60, axis: '정상축', qtc: 430 });
  });

  it('아직 시작 처리를 안 한 검사에 값을 넣으면 시행 중으로 넘기되 이미 있는 시각은 지어내지 않는다', async () => {
    const performedAt = new Date('2026-08-20T01:00:00Z');
    const m = makePrisma({ test: { ...baseTest, status: 'ORDERED', performedBy: 'u9', performedAt } });
    await svc(m.prisma).saveMeasurements('t1', { heartRate: '72' }, 'u1');
    expect(m.updates[0].status).toBe('IN_PROGRESS');
    expect(m.updates[0].performedBy).toBe('u9');
    expect(m.updates[0].performedAt).toBe(performedAt);
  });
});

describe('판독', () => {
  it('🔴 판독이 기사가 먼저 저장한 측정값을 덮어 지우지 않는다', async () => {
    const m = makePrisma({
      test: { id: 't1', patientId: 'p1', testType: 'EKG', status: 'IN_PROGRESS', roomName: null, measurements: { heartRate: 72, axis: '정상축' }, requestedBy: 'd1' },
    });
    await svc(m.prisma).report('t1', { findings: 'NSR', conclusion: 'NORMAL', measurements: { qtc: '430' } });
    expect(m.updates[0].measurements).toEqual({ heartRate: 72, axis: '정상축', qtc: 430 });
  });

  it('측정값을 안 보내도 이미 있던 값이 남는다', async () => {
    const m = makePrisma({
      test: { id: 't1', patientId: 'p1', testType: 'EKG', status: 'IN_PROGRESS', roomName: null, measurements: { heartRate: 72 }, requestedBy: 'd1' },
    });
    await svc(m.prisma).report('t1', { findings: 'NSR', conclusion: 'NORMAL' });
    expect(m.updates[0].measurements).toEqual({ heartRate: 72 });
  });
});

describe('검사 시행', () => {
  it('완료·취소된 검사는 다시 시작할 수 없다', async () => {
    const done = makePrisma({ test: { id: 't1', status: 'COMPLETED', testType: 'EKG', roomName: null } });
    await expect(svc(done.prisma).perform('t1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('시행 자리를 기록하되 이미 적힌 검사실은 덮지 않는다', async () => {
    const fresh = makePrisma({ test: { id: 't1', status: 'ORDERED', testType: 'EKG', roomName: null }, station: { label: '심전도실' } });
    await svc(fresh.prisma).perform('t1', 'u1', 'diag-ecg');
    expect(fresh.updates[0].roomName).toBe('심전도실');

    const already = makePrisma({ test: { id: 't2', status: 'ORDERED', testType: 'EKG', roomName: '먼저 적힌 방' }, station: { label: '심전도실' } });
    await svc(already.prisma).perform('t2', 'u1', 'diag-ecg');
    expect(already.updates[0].roomName).toBe('먼저 적힌 방');
  });
});

describe('시드가 정본 어휘를 쓴다', () => {
  // 🔴 "어휘 정본을 만든 것"과 "시드가 그것을 쓰는 것"은 다른 일이다.
  //    DB 만 고치면 다음 시드에서 옛 어휘가 되살아나 큐가 다시 영원히 빈다.
  const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'seed.ts'), 'utf8');
  const rows = [...seed.matchAll(/\{\s*stationId:\s*'(diag-[a-z0-9-]+)'[^}]*?category:\s*'DIAGNOSTIC'[^}]*?orderCodes:\s*\[([^\]]*)\]/g)];

  it('시드에 기초검사 자리가 실제로 있다(정규식이 헛돌지 않는지)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('🔴 모든 기초검사 자리의 orderCodes 가 검사 종류 정본 안에 있다', () => {
    const bad: string[] = [];
    for (const m of rows) {
      const codes = m[2].split(',').map((c) => c.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      for (const c of codes) if (!isDiagnosticTestType(c)) bad.push(`${m[1]}: ${c}`);
    }
    expect(bad, `시드 어휘가 정본과 갈라졌다:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 정본 11종이 모두 어딘가의 자리에 배정돼 있다(빠지면 그 검사는 아무 화면에도 안 뜬다)', () => {
    const assigned = new Set(rows.flatMap((m) => m[2].split(',').map((c) => c.trim().replace(/^['"]|['"]$/g, ''))));
    const missing = DIAGNOSTIC_TEST_TYPE_CODES.filter((c) => !assigned.has(c));
    expect(missing, `담당 자리 없는 검사 종류: ${missing.join(', ')}`).toEqual([]);
  });
});
