import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

describe('WaitingQueueService', () => {
  let service: WaitingQueueService;
  let mockPrisma: any;
  let mockJourney: any;

  beforeEach(() => {
    mockPrisma = {
      waitingQueue: {
        // 지금 대기 / 예약 대기 분리(2026-08-13)
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
      },
      clinicSchedule: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      clinicClosure: {
        findMany: vi.fn(),
      },
      encounter: {
        create: vi.fn(),
      },
      // 큐번호 advisory lock 트랜잭션 — tx 는 동일 목을 재사용
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };

    mockJourney = {
      emit: vi.fn(),
    };

    // emitAsync = 환자 푸시 결과를 되돌려받는 경로(수신자 0 이면 빈 배열 → NO_LISTENER)
    const mockEventEmitter = { emit: vi.fn(), emitAsync: vi.fn(async () => []) };
    service = new WaitingQueueService(mockPrisma, mockEventEmitter as any, mockJourney);
  });

  describe('maskName', () => {
    it('should mask 3+ character names', () => {
      const result = service.maskName('김', '영수');
      expect(result).toBe('김○수');
    });

    it('should mask 2 character names with circle', () => {
      const result = service.maskName('박', '수');
      expect(result).toBe('박○');
    });

    it('should return single character names unchanged', () => {
      const result = service.maskName('이', '');
      expect(result).toBe('이');
    });

    it('should handle long names', () => {
      const result = service.maskName('김', '영수철');
      expect(result).toBe('김○철');
    });

    it('should preserve family and given name order', () => {
      const result = service.maskName('이', '지은');
      expect(result).toBe('이○은');
    });
  });

  describe('buildTtsText', () => {
    // 🔴 방송 문구는 부분 문자열이 아니라 **정확 문자열**로 고정한다.
    //    toContain 은 조사 깨짐("…실번 진료실로")을 통과시켰던 실적이 있다(TV 보드 축 교훈).
    it('진료실 번호 배정 — 정확 문구', () => {
      expect(service.buildTtsText('내과', 5, '김○수', '진료실 1', 1))
        .toBe('내과 5번 김○수님, 1번 진료실로 오세요');
    });

    it('실데이터 roomName 포맷("3진료실")도 번호만 뽑는다', () => {
      expect(service.buildTtsText('순환기내과', 12, '홍○동', '3진료실', 1))
        .toBe('순환기내과 12번 홍○동님, 3번 진료실로 오세요');
    });

    it('재호출 접미(callCount=2)', () => {
      expect(service.buildTtsText('신경과', 3, '박○', '진료실 2', 2))
        .toBe('신경과 3번 박○님, 2번 진료실로 오세요 (재호출)');
    });

    it('최종호출 접미(callCount>=3)', () => {
      expect(service.buildTtsText('정형외과', 10, '이○은', '진료실 3', 3))
        .toBe('정형외과 10번 이○은님, 3번 진료실로 오세요 (최종호출)');
    });

    it('진료실 미배정(null) — 조사 안 깨지고 접수 창구로(v3.95 봉합)', () => {
      const result = service.buildTtsText('치과', 2, '김○철', null, 1);
      expect(result).toBe('치과 2번 김○철님, 접수 창구로 오세요');
      expect(result).not.toContain('님로');
      expect(result).not.toContain('진료실');
    });

    // 🔴 검사실 roomName(진료실 아님) — 종전 "심전도실번 진료실로 오세요"로 깨져 방송되던 실결함.
    //    '실'(ㄹ받침)→'로', 숫자 끝→'로'. '진료실' 문구를 강제하지 않는다.
    it('검사실 roomName — "심전도실로 오세요"(ㄹ받침 조사·진료실 강제 금지)', () => {
      expect(service.buildTtsText('순환기내과', 8, '홍○동', '심전도실', 1))
        .toBe('순환기내과 8번 홍○동님, 심전도실로 오세요');
    });

    it('검사실 roomName — "운동부하실로 오세요"', () => {
      expect(service.buildTtsText('순환기내과', 9, '박○수', '운동부하실', 1))
        .toBe('순환기내과 9번 박○수님, 운동부하실로 오세요');
    });

    it('검사실 roomName 숫자 끝 — "내시경실1로 오세요"(진료실 문구 없음)', () => {
      const result = service.buildTtsText('소화기내과', 4, '이○민', '내시경실1', 1);
      expect(result).toBe('소화기내과 4번 이○민님, 내시경실1로 오세요');
      expect(result).not.toContain('번 진료실'); // '…실번 진료실로' 깨짐 회귀 차단
    });
  });

  describe('getNextQueueNumber', () => {
    it('should return 1 for first queue of day', async () => {
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);

      const result = await service.getNextQueueNumber('내과');

      expect(result).toBe(1);
    });

    it('should increment from last queue number', async () => {
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue({
        queueNumber: 42,
      });

      const result = await service.getNextQueueNumber('신경과');

      expect(result).toBe(43);
    });

    it('should filter by department', async () => {
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);

      await service.getNextQueueNumber('수술과');

      expect(mockPrisma.waitingQueue.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ departmentName: '수술과' }),
        orderBy: { queueNumber: 'desc' },
      });
    });

    it('should filter by today only', async () => {
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);

      await service.getNextQueueNumber('내과');

      const callArgs = (mockPrisma.waitingQueue.findFirst as any).mock.calls[0][0];
      expect(callArgs.where.checkedInAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('checkIn', () => {
    it('should check in patient with auto-assigned doctor', async () => {
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.clinicSchedule.findFirst).mockResolvedValue({
        roomName: '진료실 1',
      });

      const mockAutoAssign = vi.spyOn(service as any, 'autoAssignDoctor').mockResolvedValue('doctor-1');

      vi.mocked(mockPrisma.waitingQueue.create).mockResolvedValue({
        id: 'queue-1',
        patientId: 'p-1',
        doctorId: 'doctor-1',
        departmentName: '내과',
        queueNumber: 1,
        patient: { id: 'p-1', mrn: '12345', familyName: '김', givenName: '영수' },
        doctor: { id: 'doctor-1', familyName: '이', givenName: '의사' },
      });

      const result = await service.checkIn({
        patientId: 'p-1',
        departmentName: '내과',
      });

      // checkIn 은 큐를 그대로 반환한다(컨트롤러가 { data } 로 감싸므로 이중 래핑 제거 — 2026-07 종단 검토)
      expect(result.id).toBe('queue-1');
      expect(mockPrisma.waitingQueue.create).toHaveBeenCalled();
    });

    it('should use provided doctorId if specified', async () => {
      vi.mocked(mockPrisma.clinicSchedule.findFirst).mockResolvedValue({
        roomName: '진료실 2',
      });

      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.waitingQueue.create).mockResolvedValue({
        id: 'queue-1',
        doctorId: 'doctor-specified',
      });

      await service.checkIn({
        patientId: 'p-1',
        doctorId: 'doctor-specified',
        departmentName: '신경과',
      });

      const callArgs = (mockPrisma.waitingQueue.create as any).mock.calls[0][0];
      expect(callArgs.data.doctorId).toBe('doctor-specified');
    });

    it('should throw error if no doctor available', async () => {
      const mockAutoAssign = vi.spyOn(service as any, 'autoAssignDoctor').mockResolvedValue(undefined);

      await expect(
        service.checkIn({
          patientId: 'p-1',
          departmentName: '치과',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should set type to APPOINTMENT if appointmentId provided', async () => {
      vi.spyOn(service as any, 'autoAssignDoctor').mockResolvedValue('doctor-1');
      vi.mocked(mockPrisma.clinicSchedule.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);

      vi.mocked(mockPrisma.waitingQueue.create).mockResolvedValue({
        id: 'queue-1',
        type: 'APPOINTMENT',
      });

      await service.checkIn({
        patientId: 'p-1',
        departmentName: '내과',
        appointmentId: 'apt-1',
      });

      const callArgs = (mockPrisma.waitingQueue.create as any).mock.calls[0][0];
      expect(callArgs.data.type).toBe('APPOINTMENT');
    });

    it('should emit journey event', async () => {
      vi.spyOn(service as any, 'autoAssignDoctor').mockResolvedValue('doctor-1');
      vi.mocked(mockPrisma.clinicSchedule.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.waitingQueue.findFirst).mockResolvedValue(null);

      vi.mocked(mockPrisma.waitingQueue.create).mockResolvedValue({
        id: 'queue-1',
        queueNumber: 5,
        patientId: 'p-1',
        departmentName: '내과',
      });

      await service.checkIn({
        patientId: 'p-1',
        departmentName: '내과',
      });

      expect(mockJourney.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p-1',
          eventType: 'RECEPTION_CHECKIN',
        })
      );
    });
  });

  describe('autoAssignDoctor', () => {
    it('should return undefined if no schedules available', async () => {
      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue([]);

      const result = await service['autoAssignDoctor']('내과');

      expect(result).toBeUndefined();
    });

    it('should assign doctor with least waiting', async () => {
      const schedules = [
        { doctorId: 'dr-1', maxPatients: 20 },
        { doctorId: 'dr-2', maxPatients: 20 },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(schedules);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([
        { doctorId: 'dr-1', _count: 10 },
        { doctorId: 'dr-2', _count: 5 },
      ]);

      const result = await service['autoAssignDoctor']('신경과');

      expect(result).toBe('dr-2');
    });

    it('should exclude doctors at max capacity', async () => {
      const schedules = [
        { doctorId: 'dr-1', maxPatients: 10 },
        { doctorId: 'dr-2', maxPatients: 10 },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(schedules);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([
        { doctorId: 'dr-1', _count: 10 },
        { doctorId: 'dr-2', _count: 3 },
      ]);

      const result = await service['autoAssignDoctor']('내과');

      expect(result).toBe('dr-2');
    });

    it('should exclude closed doctors', async () => {
      const schedules = [
        { doctorId: 'dr-1', maxPatients: 20 },
        { doctorId: 'dr-2', maxPatients: 20 },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([
        { doctorId: 'dr-1', period: 'AM' },
      ]);

      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue([
        { doctorId: 'dr-2', maxPatients: 20 },
      ]);

      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([
        { doctorId: 'dr-2', _count: 5 },
      ]);

      const result = await service['autoAssignDoctor']('신경과');

      expect(result).toBe('dr-2');
    });
  });

  describe('findAll', () => {
    it('should return all queues for today', async () => {
      const mockQueues = [
        {
          id: 'queue-1',
          queueNumber: 1,
          departmentName: '내과',
          patient: { familyName: '김', givenName: '영수' },
        },
      ];

      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue(mockQueues);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
    });

    it('should filter by department', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findAll({ department: '신경과' });

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.where.departmentName).toBe('신경과');
    });

    it('should filter by status', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findAll({ status: 'WAITING' });

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.where.status).toBe('WAITING');
    });

    it('should filter by specific date', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findAll({ date: '2026-05-13' });

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.where.checkedInAt).toBeDefined();
    });

    it('should order by queueNumber ascending', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findAll({});

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ queueNumber: 'asc' });
    });
  });

  describe('findMyQueue', () => {
    it('should return doctor\'s queue for today', async () => {
      const mockQueues = [
        { id: 'queue-1', queueNumber: 1, status: 'WAITING' },
        { id: 'queue-2', queueNumber: 2, status: 'CALLED' },
      ];

      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue(mockQueues);

      const result = await service.findMyQueue('doctor-1');

      expect(result.data).toHaveLength(2);
    });

    it('should filter by doctor ID', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findMyQueue('doctor-123');

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.where.doctorId).toBe('doctor-123');
    });

    it('should only show WAITING and CALLED status', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findMyQueue('doctor-1');

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.where.status.in).toEqual(['WAITING', 'CALLED']);
    });

    it('should order by queueNumber', async () => {
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([]);

      await service.findMyQueue('doctor-1');

      const callArgs = (mockPrisma.waitingQueue.findMany as any).mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ queueNumber: 'asc' });
    });
  });

  describe('callNext', () => {
    it('should transition WAITING to CALLED and generate TTS', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'WAITING',
        patient: { familyName: '김', givenName: '영수' },
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
        departmentName: '내과',
        queueNumber: 5,
        roomName: '진료실 1',
        callCount: 1,
        patient: { familyName: '김', givenName: '영수' },
      });

      const result = await service.callNext('queue-1');

      expect(result.data.status).toBe('CALLED');
      expect(result.data.ttsText).toBeDefined();
    });

    it('should increment call count', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
        patient: { familyName: '박', givenName: '수' },
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
        callCount: 2,
      });

      await service.callNext('queue-1');

      const callArgs = (mockPrisma.waitingQueue.update as any).mock.calls[0][0];
      expect(callArgs.data.callCount.increment).toBe(1);
    });

    it('should throw NotFoundException if queue not found', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue(null);

      await expect(service.callNext('invalid')).rejects.toThrow(NotFoundException);
    });

    it('should throw error if status is not WAITING or CALLED', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'COMPLETED',
      });

      await expect(service.callNext('queue-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('startConsultation', () => {
    it('should create encounter and transition to IN_CONSULTATION', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
        patientId: 'p-1',
        doctorId: 'dr-1',
      });

      vi.mocked(mockPrisma.encounter.create).mockResolvedValue({
        id: 'enc-1',
        patientId: 'p-1',
        doctorId: 'dr-1',
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'IN_CONSULTATION',
        encounterId: 'enc-1',
      });

      const result = await service.startConsultation('queue-1');

      expect(result.data.status).toBe('IN_CONSULTATION');
      expect(result.data.encounter).toBeDefined();
    });

    it('should throw NotFoundException if queue not found', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue(null);

      await expect(service.startConsultation('invalid')).rejects.toThrow(NotFoundException);
    });

    it('should throw error if status is not CALLED', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'WAITING',
      });

      await expect(service.startConsultation('queue-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete', () => {
    it('should transition IN_CONSULTATION to COMPLETED', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'IN_CONSULTATION',
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'COMPLETED',
        completedAt: new Date(),
      });

      const result = await service.complete('queue-1');

      expect(result.data.status).toBe('COMPLETED');
    });

    it('should throw error if status is not IN_CONSULTATION', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
      });

      await expect(service.complete('queue-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('should cancel WAITING queue', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'WAITING',
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'CANCELLED',
      });

      const result = await service.cancel('queue-1');

      expect(result.data.status).toBe('CANCELLED');
    });

    it('should throw error if already terminated', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'COMPLETED',
      });

      await expect(service.cancel('queue-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('noShow', () => {
    it('should mark queue as NO_SHOW', async () => {
      vi.mocked(mockPrisma.waitingQueue.findUnique).mockResolvedValue({
        id: 'queue-1',
        status: 'CALLED',
      });

      vi.mocked(mockPrisma.waitingQueue.update).mockResolvedValue({
        id: 'queue-1',
        status: 'NO_SHOW',
      });

      const result = await service.noShow('queue-1');

      expect(result.data.status).toBe('NO_SHOW');
    });
  });

  describe('getStats', () => {
    it('should return status counts and average wait times', async () => {
      const mockStats = [
        { departmentName: '내과', status: 'WAITING', _count: 5 },
        { departmentName: '내과', status: 'CALLED', _count: 2 },
      ];

      const mockCompleted = [
        {
          departmentName: '내과',
          checkedInAt: new Date('2026-05-13T08:00:00'),
          startedAt: new Date('2026-05-13T08:10:00'),
        },
      ];

      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue(mockStats);
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue(mockCompleted);

      const result = await service.getStats();

      expect(result.data.statusCounts).toBeDefined();
      expect(result.data.avgWaitMinutes).toBeDefined();
    });

    it('should calculate wait time in minutes', async () => {
      const checkedInAt = new Date('2026-05-13T08:00:00');
      const startedAt = new Date('2026-05-13T08:15:00'); // 15 minutes later

      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.waitingQueue.findMany).mockResolvedValue([
        { departmentName: '신경과', checkedInAt, startedAt },
      ]);

      const result = await service.getStats();

      expect(result.data.avgWaitMinutes['신경과']).toBe(15);
    });
  });
});
