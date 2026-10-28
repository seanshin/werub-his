import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ClinicIntegrationController, WebhookController } from '../../src/modules/clinic-integration/clinic-integration.controller';
import { UserRole } from '@prisma/client';
import { createHmac } from 'node:crypto';

describe('ClinicIntegrationController', () => {
  let controller: ClinicIntegrationController;
  let mockPrisma: any;
  let mockConfig: any;
  let mockClinicApi: any;

  beforeEach(() => {
    mockPrisma = {
      staff: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
      },
      clinicSyncLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      webhookSubscription: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    mockConfig = {
      get: vi.fn(),
    };

    mockClinicApi = {
      fetchClinicStaff: vi.fn(),
      pushStaffToClinic: vi.fn(),
      sendNotification: vi.fn(),
      sendUrgentNotification: vi.fn(),
      sendChannelMessage: vi.fn(),
      sendHandoff: vi.fn(),
      getChannels: vi.fn(),
      syncCalendarEvents: vi.fn(),
      syncSurgerySchedule: vi.fn(),
      getAttendance: vi.fn(),
      getLeaveBalance: vi.fn(),
      requestLeave: vi.fn(),
      requestApproval: vi.fn(),
      getApprovalStatus: vi.fn(),
      searchWiki: vi.fn(),
      getWikiPage: vi.fn(),
      createWikiPage: vi.fn(),
      subscribeWebhook: vi.fn(),
      unsubscribeWebhook: vi.fn(),
    };

    controller = new ClinicIntegrationController(mockPrisma, mockConfig, mockClinicApi);
  });

  describe('getStatus', () => {
    it('should return integration status with configuration', async () => {
      mockConfig.get.mockReturnValue('test-value');
      mockPrisma.staff.count.mockResolvedValue(5);

      const result = await controller.getStatus();

      expect(result.data.configured).toBe(true);
      expect(result.data.staffMapping.linked).toBe(5);
    });

    it('should indicate not configured when missing environment variables', async () => {
      mockConfig.get.mockReturnValue('');
      mockPrisma.staff.count.mockResolvedValue(0);

      const result = await controller.getStatus();

      expect(result.data.configured).toBe(false);
    });

    it('should return separate linked and total staff counts', async () => {
      mockConfig.get.mockReturnValue('test-value');
      mockPrisma.staff.count
        .mockResolvedValueOnce(3) // linked
        .mockResolvedValueOnce(10); // total

      const result = await controller.getStatus();

      expect(result.data.staffMapping.linked).toBe(3);
      expect(result.data.staffMapping.total).toBe(10);
    });
  });

  describe('getRoleMappings', () => {
    it('should return staff with role mappings', async () => {
      const mockStaff = [
        {
          id: 's-1',
          userId: 'u-1',
          clinicUserId: 'c-1',
          familyName: 'Kim',
          givenName: 'Chul',
          category: 'MEDICAL',
          department: 'Cardiology',
          position: 'Doctor',
          specialty: 'Cardiology',
        },
      ];
      mockPrisma.staff.findMany.mockResolvedValue(mockStaff);

      const result = await controller.getRoleMappings();

      expect(result.data.mappings).toHaveLength(1);
      expect(result.data.mappings[0].staffId).toBe('s-1');
      expect(result.data.mappings[0].linked).toBe(true);
    });

    it('should map category to role name correctly', async () => {
      const mockStaff = [
        {
          id: 's-1',
          category: 'MEDICAL',
          clinicUserId: null,
        },
      ];
      mockPrisma.staff.findMany.mockResolvedValue(mockStaff);

      const result = await controller.getRoleMappings();

      expect(result.data.mappings[0].linked).toBe(false);
    });

    it('should order by department and name', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);

      await controller.getRoleMappings();

      expect(mockPrisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ department: 'asc' }, { familyName: 'asc' }],
        }),
      );
    });
  });

  describe('updateRoleMapping', () => {
    it('should update staff clinic user ID', async () => {
      const staffId = 's-1';
      const clinicUserId = 'c-1';
      const updated = { id: staffId, clinicUserId };
      mockPrisma.staff.update.mockResolvedValue(updated);

      const result = await controller.updateRoleMapping({ staffId, clinicUserId });

      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: staffId },
          data: expect.objectContaining({ clinicUserId }),
        }),
      );
      expect(result.data.id).toBe(staffId);
    });

    it('should accept valid DTO with staffId and clinicUserId', async () => {
      mockPrisma.staff.update.mockResolvedValue({ id: 's-1', clinicUserId: 'c-1' });

      const result = await controller.updateRoleMapping({ staffId: 's-1', clinicUserId: 'c-1' });
      expect(result.data).toBeDefined();
    });

    it('should pass DTO fields to prisma update', async () => {
      mockPrisma.staff.update.mockResolvedValue({ id: 's-1' });

      await controller.updateRoleMapping({ staffId: 's-1', clinicUserId: 'c-2' });
      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's-1' } }),
      );
    });

    it('should optionally update department', async () => {
      mockPrisma.staff.update.mockResolvedValue({});

      await controller.updateRoleMapping({
        staffId: 's-1',
        clinicUserId: 'c-1',
        department: 'Cardiology',
      });

      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ department: 'Cardiology' }),
        }),
      );
    });
  });

  describe('syncStaff', () => {
    it('should sync staff from Clinic and link to HIS', async () => {
      const clinicStaff = [
        { id: 'c-1', email: 'kim@clinic.example', name: 'Kim' },
        { id: 'c-2', email: 'lee@clinic.example', name: 'Lee' },
      ];
      mockClinicApi.fetchClinicStaff.mockResolvedValue(clinicStaff);
      mockPrisma.staff.findFirst
        .mockResolvedValueOnce({ id: 's-1', clinicUserId: null })
        .mockResolvedValueOnce({ id: 's-2', clinicUserId: 'c-2' });
      mockPrisma.staff.update.mockResolvedValue({});

      const result = await controller.syncStaff();

      expect(result.data.totalFromClinic).toBe(2);
      expect(result.data.linked).toBe(1);
      expect(result.data.skipped).toBe(1);
    });

    it('should skip staff already linked', async () => {
      const clinicStaff = [{ id: 'c-1', email: 'kim@clinic.example' }];
      mockClinicApi.fetchClinicStaff.mockResolvedValue(clinicStaff);
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 's-1',
        clinicUserId: 'c-1',
      });

      const result = await controller.syncStaff();

      expect(result.data.skipped).toBe(1);
      expect(result.data.linked).toBe(0);
    });
  });

  describe('pushStaff', () => {
    // 🔴 초기 비밀번호는 코드에 박지 않는다 — 환경값이 있어야 일괄 등록이 나간다
    beforeEach(() => {
      mockConfig.get.mockImplementation((k: string, d?: string) => (k === 'CLINIC_INITIAL_PASSWORD' ? '기관이-정한-값' : (d ?? '')));
    });

    it('🔴 초기 비밀번호가 설정되지 않으면 보내지 않는다 — 종전엔 개발 시드 값이 코드에 박혀 있었다', async () => {
      mockConfig.get.mockImplementation((_k: string, d?: string) => d ?? '');
      mockPrisma.staff.findMany.mockResolvedValue([{ email: 'kim@his.example', familyName: 'Kim', givenName: 'Chul', category: 'MEDICAL' }]);
      await expect(controller.pushStaff('user-1')).rejects.toMatchObject({
        response: { code: 'CLINIC_INITIAL_PASSWORD_UNSET' },
      });
      expect(mockClinicApi.pushStaffToClinic).not.toHaveBeenCalled();
    });

    it('설정된 값이 그대로 실린다(코드 상수가 아니다)', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([{ email: 'kim@his.example', familyName: 'Kim', givenName: 'Chul', category: 'MEDICAL' }]);
      mockClinicApi.pushStaffToClinic.mockResolvedValue({ registered: 1, skipped: 0, errors: [] });
      await controller.pushStaff('user-1');
      expect(mockClinicApi.pushStaffToClinic).toHaveBeenCalledWith([
        expect.objectContaining({ password: '기관이-정한-값' }),
      ]);
    });

    it('should push HIS staff to Clinic', async () => {
      const staffList = [
        {
          email: 'kim@his.example',
          familyName: 'Kim',
          givenName: 'Chul',
          department: 'Cardiology',
          category: 'MEDICAL',
        },
      ];
      mockPrisma.staff.findMany.mockResolvedValue(staffList);
      mockClinicApi.pushStaffToClinic.mockResolvedValue({
        registered: 1,
        skipped: 0,
      });
      mockPrisma.clinicSyncLog.create.mockResolvedValue({});

      const result = await controller.pushStaff('user-1');

      expect(result.data.total).toBe(1);
      expect(result.data.registered).toBe(1);
      expect(mockPrisma.clinicSyncLog.create).toHaveBeenCalled();
    });

    it('should handle push errors gracefully', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      mockClinicApi.pushStaffToClinic.mockRejectedValue(new Error('API error'));
      mockPrisma.clinicSyncLog.create.mockResolvedValue({});

      const result = await controller.pushStaff('user-1');

      expect(mockPrisma.clinicSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
          }),
        }),
      );
    });

    it('should log sync with userId', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      mockClinicApi.pushStaffToClinic.mockResolvedValue({});
      mockPrisma.clinicSyncLog.create.mockResolvedValue({});

      await controller.pushStaff('user-123');

      expect(mockPrisma.clinicSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            executedBy: 'user-123',
          }),
        }),
      );
    });
  });

  describe('getSyncLogs', () => {
    it('should return last 50 sync logs', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          syncType: 'PUSH_STAFF',
          status: 'SUCCESS',
          executedAt: new Date(),
        },
      ];
      mockPrisma.clinicSyncLog.findMany.mockResolvedValue(mockLogs);

      const result = await controller.getSyncLogs();

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.clinicSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });

    it('should order logs by execution date descending', async () => {
      mockPrisma.clinicSyncLog.findMany.mockResolvedValue([]);

      await controller.getSyncLogs();

      expect(mockPrisma.clinicSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { executedAt: 'desc' },
        }),
      );
    });
  });

  describe('getHospitalInfo', () => {
    it('should return hospital information with features', async () => {
      mockConfig.get.mockReturnValue('HOSP001');
      mockPrisma.staff.count.mockResolvedValue(50);
      mockPrisma.staff.groupBy.mockResolvedValue([
        { department: 'Cardiology' },
        { department: 'Surgery' },
      ]);

      const result = await controller.getHospitalInfo();

      expect(result.data.code).toBe('HOSP001');
      expect(result.data.staffCount).toBe(50);
      expect(result.data.hisEnabled).toBe(true);
      expect(result.data.features.emr).toBe(true);
    });

    it('should list all available departments', async () => {
      mockConfig.get.mockReturnValue('HOSP001');
      mockPrisma.staff.count.mockResolvedValue(50);
      mockPrisma.staff.groupBy.mockResolvedValue([
        { department: 'Cardiology' },
        { department: 'Surgery' },
      ]);

      const result = await controller.getHospitalInfo();

      expect(result.data.departments).toContain('Cardiology');
      expect(result.data.departments).toContain('Surgery');
    });
  });

  describe('Notifications', () => {
    it('should send notification', async () => {
      mockClinicApi.sendNotification.mockResolvedValue({});

      const result = await controller.sendNotification({
        recipients: ['user-1'],
        title: 'Test',
        message: 'Test message',
      });

      expect(result.data.sent).toBe(true);
      expect(mockClinicApi.sendNotification).toHaveBeenCalled();
    });

    it('should send urgent notification', async () => {
      mockClinicApi.sendUrgentNotification.mockResolvedValue({});

      const result = await controller.sendUrgentNotification({
        channel: 'cardiology',
        title: 'Urgent',
        message: 'Urgent message',
        assignees: ['doctor-1'],
      });

      expect(result.data.sent).toBe(true);
    });
  });

  describe('Channel Management', () => {
    it('should send message to channel', async () => {
      mockClinicApi.sendChannelMessage.mockResolvedValue({});

      const result = await controller.sendChannelMessage({
        channelName: '#cardiology',
        content: 'Test message',
      });

      expect(result.data.sent).toBe(true);
    });

    it('should send handoff note', async () => {
      mockClinicApi.sendHandoff.mockResolvedValue({});

      const result = await controller.sendHandoff({
        department: 'Cardiology',
        content: 'Patient status report',
        fromUser: 'doctor-1',
        toUser: 'doctor-2',
      });

      expect(result.data.sent).toBe(true);
    });

    it('should get list of channels', async () => {
      const mockChannels = [{ id: 'ch-1', name: '#cardiology' }];
      mockClinicApi.getChannels.mockResolvedValue(mockChannels);

      const result = await controller.getChannels();

      expect(result.data.channels).toHaveLength(1);
    });
  });

  describe('Calendar & Attendance', () => {
    it('should sync calendar events', async () => {
      const events = [{ id: 'e-1', title: 'Surgery' }];
      mockClinicApi.syncCalendarEvents.mockResolvedValue({ synced: 1 });

      const result = await controller.syncCalendar({ events });

      expect(mockClinicApi.syncCalendarEvents).toHaveBeenCalledWith(events);
    });

    it('should sync surgery schedule', async () => {
      mockClinicApi.syncSurgerySchedule.mockResolvedValue({});

      const result = await controller.syncSurgerySchedule({
        surgeryIds: ['surg-1'],
        includeAttendants: true,
      });

      expect(result.data.synced).toBe(true);
    });

    it('should get attendance records', async () => {
      const mockRecords = [{ userId: 'u-1', checkIn: new Date() }];
      mockClinicApi.getAttendance.mockResolvedValue(mockRecords);

      const result = await controller.getAttendance();

      expect(result.data.records).toHaveLength(1);
    });

    it('should get leave balance for user', async () => {
      const balance = { userId: 'u-1', total: 15, used: 5, remaining: 10 };
      mockClinicApi.getLeaveBalance.mockResolvedValue(balance);

      const result = await controller.getLeaveBalance('u-1');

      expect(result.data.remaining).toBe(10);
    });

    it('should request leave', async () => {
      mockClinicApi.requestLeave.mockResolvedValue({ status: 'PENDING' });

      const result = await controller.requestLeave({
        userId: 'u-1',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        reason: 'Vacation',
      });

      expect(mockClinicApi.requestLeave).toHaveBeenCalled();
    });
  });

  describe('Approval & Wiki', () => {
    it('should request approval', async () => {
      mockClinicApi.requestApproval.mockResolvedValue({ docId: 'doc-1' });

      const result = await controller.requestApproval({
        templateId: 'tmpl-1',
        title: 'Request',
        drafter: 'u-1',
        approvers: ['u-2'],
        content: {},
        callbackUrl: 'https://api.hospitalrun.kr/webhook',
      });

      expect(result.data.docId).toBe('doc-1');
    });

    it('should check approval status', async () => {
      mockClinicApi.getApprovalStatus.mockResolvedValue({
        status: 'APPROVED',
        approvers: [],
      });

      const result = await controller.getApprovalStatus('doc-1');

      expect(result.data.status).toBe('APPROVED');
    });

    it('should search wiki with required query', async () => {
      const mockPages = [{ id: 'p-1', title: 'Test' }];
      mockClinicApi.searchWiki.mockResolvedValue(mockPages);

      const result = await controller.searchWiki('test');

      expect(result.data.pages).toHaveLength(1);
    });

    it('should throw error if wiki search query missing', async () => {
      await expect(controller.searchWiki('')).rejects.toThrow(HttpException);
    });

    it('should get wiki page', async () => {
      const mockPage = { id: 'p-1', title: 'Test', content: '# Test' };
      mockClinicApi.getWikiPage.mockResolvedValue(mockPage);

      const result = await controller.getWikiPage('p-1');

      expect(result.data.title).toBe('Test');
    });

    it('should create wiki page', async () => {
      mockClinicApi.createWikiPage.mockResolvedValue({ id: 'p-1' });

      const result = await controller.createWikiPage({
        title: 'New Page',
        content: '# New Page',
        path: '/docs/new-page',
      });

      expect(result.data.id).toBe('p-1');
    });
  });

  describe('Webhook Management', () => {
    it('should subscribe to webhook', async () => {
      const subscription = {
        id: 'sub-1',
        url: 'https://api.hospitalrun.kr/webhook',
        events: ['wsign.approved'],
        isActive: true,
      };
      mockClinicApi.subscribeWebhook.mockResolvedValue({ subscribed: true });
      mockPrisma.webhookSubscription.create.mockResolvedValue(subscription);

      const result = await controller.subscribeWebhook({
        url: subscription.url,
        events: subscription.events,
        secret: 'secret-key',
      });

      expect(result.data.id).toBe('sub-1');
      expect(result.data.isActive).toBe(true);
      expect(mockPrisma.webhookSubscription.create).toHaveBeenCalled();
    });

    it('should list active webhook subscriptions', async () => {
      const subscriptions = [
        {
          id: 'sub-1',
          url: 'https://api.hospitalrun.kr/webhook',
          events: ['wsign.approved'],
          isActive: true,
        },
      ];
      mockPrisma.webhookSubscription.findMany.mockResolvedValue(subscriptions);

      const result = await controller.listWebhookSubscriptions();

      expect(result.data.subscriptions).toHaveLength(1);
      expect(mockPrisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });

    it('should unsubscribe from webhook', async () => {
      const subscription = { id: 'sub-1', isActive: true };
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(subscription);
      mockClinicApi.unsubscribeWebhook.mockResolvedValue({});
      mockPrisma.webhookSubscription.update.mockResolvedValue({
        ...subscription,
        isActive: false,
      });

      const result = await controller.unsubscribeWebhook('sub-1');

      expect(result.data.unsubscribed).toBe(true);
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        }),
      );
    });

    it('should throw error for non-existent webhook', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(controller.unsubscribeWebhook('sub-999')).rejects.toThrow(
        HttpException,
      );
    });
  });
});

describe('WebhookController', () => {
  let controller: WebhookController;
  let mockPrisma: any;
  let mockConfigService: any;
  let mockErpEapproval: any;

  beforeEach(() => {
    mockPrisma = {};
    mockConfigService = {
      get: vi.fn(),
    };
    mockErpEapproval = {
      handleWsignResult: vi.fn().mockResolvedValue(undefined),
    };
    controller = new WebhookController(
      mockPrisma,
      mockConfigService,
      mockErpEapproval,
    );
  });

  describe('receiveWebhook', () => {
    /**
     * 종전 테스트들은 시크릿 없이 부르고 통과를 기대했다(= fail-open 계약).
     * 이제 인증된 경로로 부른다 — 레거시 시크릿 헤더(X-Webhook-Secret)를 정본과 일치시킨다.
     */
    const LEGACY = 'legacy-webhook-secret';
    const authed = () => {
      mockConfigService.get.mockImplementation((k: string) => (k === 'HIS_WEBHOOK_SECRET' ? LEGACY : undefined));
      return LEGACY;
    };
    /**
     * 🔴 (2026-09-16 G2) 이 자리의 종전 테스트는 **결함을 계약으로 못박고 있었다** —
     *    "should receive webhook without signature verification" 가 시크릿 미설정 시 무인증 통과를
     *    정상 동작으로 단언했다. 운영 프로브에서 서명 없이 201 이 나온 그 경로다(연동 대상 덮어쓰기 가능).
     *    이제 어느 시크릿도 없으면 거부한다.
     */
    it('🔴 시크릿이 하나도 없으면 거부한다(fail-open 금지)', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        controller.receiveWebhook({}, undefined, undefined, undefined, {
          event: 'wsign.approved',
          timestamp: new Date().toISOString(),
          hospitalCode: 'HOSP001',
          data: { docId: 'doc-1' },
        }),
      ).rejects.toThrow();
    });

    /** 대조군 — 정본 시크릿+유효 서명이면 그대로 처리된다(닫기만 하고 끝내지 않는다) */
    it('대조군 — Clinic 서명이 유효하면 처리한다', async () => {
      const secret = 'clinic-callback-secret';
      const body = {
        event: 'wsign.approved',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: { docId: 'doc-1' },
      };
      const raw = Buffer.from(JSON.stringify(body));
      const sig = createHmac('sha256', secret).update(raw).digest('hex');
      mockConfigService.get.mockImplementation((k: string) => (k === 'CLINIC_CALLBACK_SECRET' ? secret : undefined));

      const result = await controller.receiveWebhook({ rawBody: raw }, sig, undefined, undefined, body);

      expect(result.received).toBe(true);
      expect(result.event).toBe('wsign.approved');
    });

    it('should throw error if signature missing when secret configured', async () => {
      mockConfigService.get.mockReturnValue('webhook-secret');

      await expect(
        controller.receiveWebhook({}, undefined, undefined, undefined, {
          event: 'wsign.approved',
          timestamp: new Date().toISOString(),
          hospitalCode: 'HOSP001',
          data: {},
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw error if timestamp expired', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      await expect(
        controller.receiveWebhook({}, undefined, undefined, undefined, {
          event: 'wsign.approved',
          timestamp: oldTimestamp,
          hospitalCode: 'HOSP001',
          data: {},
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should accept webhook within 5 minute window', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const recentTimestamp = new Date(Date.now() - 1 * 60 * 1000).toISOString();

      const result = await controller.receiveWebhook({}, undefined, undefined, authed(), {
        event: 'wsign.approved',
        timestamp: recentTimestamp,
        hospitalCode: 'HOSP001',
        data: { docId: 'doc-1' },
      });

      expect(result.received).toBe(true);
    });

    it('should handle wsign events', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await controller.receiveWebhook({}, undefined, undefined, authed(), {
        event: 'wsign.approved',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: { docId: 'doc-1' },
      });

      expect(result.event).toBe('wsign.approved');
    });

    it('should handle attendance events', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await controller.receiveWebhook({}, undefined, undefined, authed(), {
        event: 'attendance.checkin',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: { userId: 'u-1' },
      });

      expect(result.event).toBe('attendance.checkin');
    });

    it('should handle member events', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await controller.receiveWebhook({}, undefined, undefined, authed(), {
        event: 'member.joined',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: { userId: 'u-1' },
      });

      expect(result.event).toBe('member.joined');
    });

    it('should handle unrecognized events', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const result = await controller.receiveWebhook({}, undefined, undefined, authed(), {
        event: 'unknown.event',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: {},
      });

      expect(result.received).toBe(true);
    });
  });

  describe('Webhook Security', () => {
    it('should verify HMAC signature when secret provided', async () => {
      const crypto = await import('crypto');
      const secret = 'test-secret';
      mockConfigService.get.mockReturnValue(secret);

      const body = {
        event: 'wsign.approved',
        timestamp: new Date().toISOString(),
        hospitalCode: 'HOSP001',
        data: {},
      };

      const signature = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex')}`;

      const result = await controller.receiveWebhook({}, undefined, signature, undefined, body);

      expect(result.received).toBe(true);
    });

    it('should reject invalid signature', async () => {
      mockConfigService.get.mockReturnValue('test-secret');

      await expect(
        controller.receiveWebhook({}, undefined, 'sha256=invalid', undefined, {
          event: 'wsign.approved',
          timestamp: new Date().toISOString(),
          hospitalCode: 'HOSP001',
          data: {},
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
