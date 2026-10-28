import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InfectionControlService } from '../../src/modules/infection-control/infection-control.service';
import { KCDC_CHANNEL, KONIS_CHANNEL, classifyNotifiableTransmission } from '../../src/modules/infection-control/external-reporting';

/**
 * 🔴 감염관리 법정보고(KCDC·KONIS) — 화면 실사용 점검 W7(2026-08-14).
 *
 * 종전 결함(전부 실측 확인):
 *  ① 법정감염병 신고가 아무 데도 전송되지 않는데 `status:'SUBMITTED'` + `KCDC-<ts>` 접수번호를
 *     적어 화면이 초록 '신고완료'를 보여줬다(감염병예방법 §11). 한 번 누르면 재제출이 막혀
 *     **영구 미신고**로 굳었고, `ackAt`·`errorLog` 는 채워지지 않았다.
 *  ② KONIS 보고도 FE 플래그를 그대로 저장했을 뿐이고, `konisPending` 이 ACTIVE 로 한정돼
 *     종결하는 순간 미보고인 채 지표에서 사라졌다.
 *  ③ `reportKonis()` 는 전송도 저장도 없이 'SUBMITTED' 를 반환했다.
 *  ④ `createResistanceSurveillance()` 는 prisma 호출이 없어 등록이 사라졌다.
 *  ⑤ `recordStaffExposure()` 는 니들스틱 사고를 프로세스 메모리에 담아 배포마다 소실됐다.
 *     → 2026-08-18 전용 모델 `StaffExposureIncident` 로 영속화(아래 ⑤ 참조).
 *
 * 이 스펙은 **나가지 않았다는 사실이 그대로 기록되는지**를 계약으로 고정한다.
 */
describe('감염관리 법정보고 — 전송하지 않은 것을 전송했다고 적지 않는다', () => {
  let service: InfectionControlService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      patient: {
        findUnique: vi.fn().mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notifiableDiseaseReport: { findUnique: vi.fn(), update: vi.fn((a: any) => Promise.resolve({ id: 'n1', diseaseName: '홍역', ...a.data })), findMany: vi.fn() },
      haiCase: { findUnique: vi.fn(), update: vi.fn((a: any) => Promise.resolve({ id: 'h1', ...a.data })), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
      mdroRegistry: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn((a: any) => Promise.resolve({ id: 'm1', ...a.data })), groupBy: vi.fn().mockResolvedValue([]) },
      isolationPrecaution: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      staff: {
        findUnique: vi.fn().mockResolvedValue({ id: 'staff-1' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'staff-1' }),
        // 목록·상세가 UUID 대신 이름을 보여주려고 배치 조회한다(스키마에 relation 이 없다)
        findMany: vi.fn().mockResolvedValue([
          { id: 'staff-1', familyName: '김', givenName: '간호', department: '외과병동', position: '간호사' },
        ]),
      },
      staffExposureIncident: {
        create: vi.fn((a: any) => Promise.resolve({ id: 'exp-1', reportedAt: new Date(), closedAt: null, ...a.data })),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn((a: any) => Promise.resolve({ id: 'exp-1', ...a.data })),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    service = new InfectionControlService(prisma);
  });

  // ── ① 법정감염병 신고 ────────────────────────────────────────────────
  describe('submitNotifiable', () => {
    it('🔴 전송 채널이 없으면 SUBMITTED 가 아니라 LOCAL_RECORDED 로 적고, 전송 시각을 지어내지 않는다', async () => {
      prisma.notifiableDiseaseReport.findUnique.mockResolvedValue({ id: 'n1', status: 'DRAFT', diseaseName: '홍역', reportRef: null, submittedAt: null });

      const r = await service.submitNotifiable('n1', 'user-1');
      const data = prisma.notifiableDiseaseReport.update.mock.calls[0][0].data;

      expect(data.status).toBe('LOCAL_RECORDED');
      expect(data.status).not.toBe('SUBMITTED');
      expect(data.submittedAt).toBeNull(); // 나가지 않았으므로 전송 시각이 없다
      expect(data.reportRef).toMatch(/^LOCAL-KCDC-/); // 질병관리청이 준 번호가 아님을 드러낸다
      expect(data.reportRef).not.toMatch(/^KCDC-/);
      expect(data.errorLog).toContain('[미전송]');
      expect(data.errorLog).toContain('user-1');
      expect(r.transmission.transmitted).toBe(false);
      expect(r.transmission.label).not.toBe('신고완료');
    });

    it('🔴 미전송 건은 다시 제출할 수 있다 — 영구 미신고를 막는다', async () => {
      prisma.notifiableDiseaseReport.findUnique.mockResolvedValue({ id: 'n1', status: 'LOCAL_RECORDED', diseaseName: '홍역', reportRef: 'LOCAL-KCDC-ABC', submittedAt: null });
      await expect(service.submitNotifiable('n1')).resolves.toBeTruthy();
    });

    it('🔴 연동 이전에 남은 시뮬레이션 SUBMITTED(KCDC-DEMO01)도 재제출을 막지 않는다 — 저장값은 그대로 두고 읽기에서 구분', async () => {
      prisma.notifiableDiseaseReport.findUnique.mockResolvedValue({ id: 'n1', status: 'SUBMITTED', diseaseName: '홍역', reportRef: 'KCDC-DEMO01', submittedAt: new Date() });
      await expect(service.submitNotifiable('n1')).resolves.toBeTruthy();
      // 종전 접수번호는 지우지 않고 errorLog 에 보존한다(기록 소실 금지)
      expect(prisma.notifiableDiseaseReport.update.mock.calls[0][0].data.errorLog).toContain('KCDC-DEMO01');
    });

    it('없는 신고는 404', async () => {
      prisma.notifiableDiseaseReport.findUnique.mockResolvedValue(null);
      await expect(service.submitNotifiable('nope')).rejects.toThrow(NotFoundException);
    });

    it('목록은 건별 전송 사실을 함께 준다 — 저장된 SUBMITTED 를 신고완료로 번역하지 않는다', async () => {
      prisma.notifiableDiseaseReport.findMany.mockResolvedValue([
        { id: 'n1', status: 'SUBMITTED', reportRef: 'KCDC-DEMO01', submittedAt: new Date() },
        { id: 'n2', status: 'LOCAL_RECORDED', reportRef: 'LOCAL-KCDC-X', submittedAt: null },
      ]);
      const rows = await service.listNotifiable();
      expect(rows[0].transmission.state).toBe('UNVERIFIED');
      expect(rows[0].transmission.transmitted).toBe(false);
      expect(rows[1].transmission.state).toBe('LOCAL_ONLY');
      expect(rows[1].reportRef).toBe('LOCAL-KCDC-X'); // 저장값 변조 없음
    });
  });

  // ── ② KONIS 보고 ────────────────────────────────────────────────────
  describe('resolveHaiCase / haiStats', () => {
    beforeEach(() => prisma.haiCase.findUnique.mockResolvedValue({ id: 'h1', haiType: 'CLABSI', notes: null, status: 'ACTIVE', reportedToKonis: false }));

    it('🔴 reportedToKonis:true 플래그만으로는 보고완료가 되지 않는다(전송 코드 없음)', async () => {
      const r = await service.resolveHaiCase('h1', { reportedToKonis: true }, 'user-1');
      const data = prisma.haiCase.update.mock.calls[0][0].data;

      expect(data.status).toBe('RESOLVED');
      expect(data.reportedToKonis).toBeUndefined(); // false 로 남는다
      expect(data.notes).toContain('[미전송]');
      expect(r.konis.transmitted).toBe(false);
      expect(r.konis.state).toBe('NOT_TRANSMITTED');
    });

    it('사람이 KONIS 웹에 수기 보고하고 근거번호를 주면 보고완료로 기록한다(누가·언제 남는다)', async () => {
      const r = await service.resolveHaiCase('h1', { reportedToKonis: true, konisManualRef: 'K-2026-0001' }, 'user-1');
      const data = prisma.haiCase.update.mock.calls[0][0].data;

      expect(data.reportedToKonis).toBe(true);
      expect(data.notes).toContain('[KONIS 수기보고]');
      expect(data.notes).toContain('K-2026-0001');
      expect(data.notes).toContain('user-1');
      expect(r.konis.state).toBe('MANUAL_ATTESTED');
      expect(r.konis.transmitted).toBe(false); // 자동 전송이 아니다
    });

    it('🔴 konisPending 은 종결 여부와 무관하게 미보고를 센다 — 종결하면 사라지던 것', async () => {
      await service.haiStats();
      const pendingWhere = prisma.haiCase.count.mock.calls.find((c: any[]) => c[0]?.where?.reportedToKonis === false && !c[0].where.status)?.[0].where;
      expect(pendingWhere).toEqual({ reportedToKonis: false });
    });
  });

  // ── ③ KONIS 집계 보고 ───────────────────────────────────────────────
  describe('reportKonis', () => {
    it('🔴 전송도 저장도 하지 않았다는 사실을 응답에 싣는다(종전: status SUBMITTED)', async () => {
      const r = await service.reportKonis({ facilityCode: 'H-1', eventsCount: 2, patientDays: 1000 });
      expect(r.status).toBe('NOT_TRANSMITTED');
      expect(r.transmitted).toBe(false);
      expect(r.persisted).toBe(false);
      expect(String(r.id)).toMatch(/^LOCAL-KONIS-/);
      expect(r.warning).toContain('전송되지 않았고');
    });

    it('분모가 없으면 감염률을 0.00 으로 채우지 않는다(표본 부재 ≠ 0)', async () => {
      const r = await service.reportKonis({ eventsCount: 2 });
      expect(r.rate).toBeNull();
    });
  });

  describe('getKonisStats', () => {
    it('🔴 건수는 HaiCase 실측 · 분모 없는 감염률과 출처 없는 전국 벤치마크는 만들지 않는다', async () => {
      prisma.haiCase.groupBy.mockResolvedValue([{ haiType: 'CLABSI', _count: { id: 3 } }]);
      prisma.haiCase.count.mockResolvedValue(3);

      const s = await service.getKonisStats('2026-08');
      expect(s.hai.CLABSI.events).toBe(3);
      expect(s.hai.CLABSI.rate).toBeNull();
      expect(s.hai.CAUTI.events).toBe(0); // 등록이 없으면 0 — 상수 1.61 이 아니다
      expect(s.benchmark).toBeNull();
      expect(s.trend).toHaveLength(3);
      expect(s.trend.every((t) => t.totalEvents === 3)).toBe(true); // 실측 count 로만 채운다
    });
  });

  // ── ④ 내성 감시 등록 ────────────────────────────────────────────────
  describe('createResistanceSurveillance', () => {
    it('🔴 등록이 저장된다 — 종전엔 prisma 호출이 없어 그대로 사라졌다', async () => {
      const r = await service.createResistanceSurveillance({
        patientId: '11111111-1111-1111-1111-111111111111',
        organism: 'Klebsiella pneumoniae',
        resistanceType: 'CRE',
        specimen: 'Blood',
        antibioticsTested: ['Meropenem', 'Colistin'],
        resistantTo: ['Meropenem'],
        sensitiveTo: ['Colistin'],
      });

      expect(prisma.mdroRegistry.create).toHaveBeenCalled();
      const data = prisma.mdroRegistry.create.mock.calls[0][0].data;
      expect(data.organism).toBe('Klebsiella pneumoniae');
      expect(data.mdroType).toBe('CRE');
      expect(data.notes).toContain('내성감시');
      expect(data.notes).toContain('Meropenem'); // 감수성 상세는 컬럼이 없어 notes 에 보존
      expect(r.persisted).toBe(true);
    });

    it('환자·검출균이 없으면 400 — "Unknown" 으로 만들어 저장하지 않는다', async () => {
      await expect(service.createResistanceSurveillance({ organism: 'X' })).rejects.toThrow(BadRequestException);
      await expect(service.createResistanceSurveillance({ patientId: '11111111-1111-1111-1111-111111111111' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getResistancePatterns', () => {
    it('🔴 하드코딩 내성률표를 쓰지 않는다 — 실측 검출 건수만, 내성률은 산출 불가', async () => {
      prisma.mdroRegistry.groupBy.mockResolvedValue([{ organism: 'MRSA', mdroType: 'MRSA', _count: { id: 2 } }]);
      const r = await service.getResistancePatterns();
      expect(r.patterns).toHaveLength(1);
      expect(r.patterns[0].detectedCount).toBe(2);
      expect(r.patterns[0].resistanceRate).toBeNull();
      expect(r.rateNote).toContain('산출할 수 없습니다');
    });

    it('검출이 없으면 빈 목록 — 표본 부재의 정답은 폴백이 아니다', async () => {
      prisma.mdroRegistry.groupBy.mockResolvedValue([]);
      expect((await service.getResistancePatterns()).patterns).toEqual([]);
    });
  });

  // ── ⑤ 직원 노출 사고 (2026-08-18 영속화) ─────────────────────────────
  describe('recordStaffExposure — 원장에 남는다', () => {
    const dto = { exposureType: 'NEEDLESTICK' } as any;

    it('🔴 프로세스 메모리가 아니라 StaffExposureIncident 원장에 쓴다(배포마다 소실되던 것)', async () => {
      const e = await service.recordStaffExposure(dto, 'user-1');
      expect(prisma.staffExposureIncident.create).toHaveBeenCalledTimes(1);
      expect(e.persisted).toBe(true);
      expect(e.followUpStatus).toBe('OPEN');
      expect(prisma.staffExposureIncident.create.mock.calls[0][0].data.reportedBy).toBe('user-1');
    });

    it('🔴 원환자 감염상태를 보내지 않으면 null(미상)로 남는다 — 음성으로 단정하지 않는다', async () => {
      const e = await service.recordStaffExposure(dto, 'user-1');
      const data = prisma.staffExposureIncident.create.mock.calls[0][0].data;
      expect(data.sourceHbv).toBeNull();
      expect(data.sourceHcv).toBeNull();
      expect(data.sourceHiv).toBeNull();
      expect(data.sourceHbv).not.toBe(false); // false = '음성'이라는 다른 사실
      expect(e.sourceStatus.hbv).toBe('UNKNOWN');
      expect(e.sourceStatus.anyUnknown).toBe(true);
      expect(e.sourceStatusNote).toContain('음성으로 간주하지 마십시오');
    });

    it('원환자를 지목했는데 존재하지 않으면 기록하지 않는다', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.recordStaffExposure({ ...dto, sourcePatientId: '22222222-2222-2222-2222-222222222222' }, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.staffExposureIncident.create).not.toHaveBeenCalled();
    });

    it('직원 원장에서 본인을 찾지 못하면 임의로 만들지 않고 거부한다(fail-closed)', async () => {
      prisma.staff.findFirst.mockResolvedValue(null);
      await expect(service.recordStaffExposure(dto, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.staffExposureIncident.create).not.toHaveBeenCalled();
    });

    it('미래 시각은 사고 발생 시각이 될 수 없다', async () => {
      const future = new Date(Date.now() + 7 * 86400000).toISOString();
      await expect(service.recordStaffExposure({ ...dto, occurredAt: future }, 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('🔴 0 건은 "사고 없음"이 아니라 "접수된 기록 없음"이라고 말한다', async () => {
      const r = await service.getStaffExposures();
      expect(r.persisted).toBe(true);
      expect(r.totalCount).toBe(0);
      expect(r.zeroMeaning).toContain('접수된 노출 사고 기록이 없습니다');
    });

    it('추적관찰 종결일 때만 closedAt 이 박힌다 — 재개하면 지운다', async () => {
      prisma.staffExposureIncident.findUnique.mockResolvedValue({ id: 'exp-1', closedAt: null });
      await service.updateStaffExposureFollowUp('exp-1', { followUpStatus: 'IN_FOLLOW_UP' } as any);
      expect(prisma.staffExposureIncident.update.mock.calls[0][0].data.closedAt).toBeNull();

      await service.updateStaffExposureFollowUp('exp-1', { followUpStatus: 'CLOSED' } as any);
      expect(prisma.staffExposureIncident.update.mock.calls[1][0].data.closedAt).toBeInstanceOf(Date);
    });

    it('추적 갱신에서 보내지 않은 혈청 항목은 건드리지 않는다 — 미상을 음성으로 덮지 않는다', async () => {
      prisma.staffExposureIncident.findUnique.mockResolvedValue({ id: 'exp-1', closedAt: null });
      await service.updateStaffExposureFollowUp('exp-1', { followUpStatus: 'IN_FOLLOW_UP', sourceHbv: true } as any);
      const data = prisma.staffExposureIncident.update.mock.calls[0][0].data;
      expect(data.sourceHbv).toBe(true);
      expect('sourceHcv' in data).toBe(false);
      expect('sourceHiv' in data).toBe(false);
    });
  });

  // ── 채널 계약 ───────────────────────────────────────────────────────
  describe('전송 채널 선언', () => {
    it('🔴 구현되지 않은 채널은 구현되지 않았다고 선언한다', () => {
      expect(KCDC_CHANNEL.implemented).toBe(false);
      expect(KONIS_CHANNEL.implemented).toBe(false);
    });

    it('채널 미구현 동안에는 어떤 상태도 transmitted=true 로 읽히지 않는다', () => {
      for (const status of ['DRAFT', 'LOCAL_RECORDED', 'SEND_FAILED', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED']) {
        expect(classifyNotifiableTransmission({ status, reportRef: 'KCDC-DEMO01' }).transmitted).toBe(false);
      }
    });
  });
});
