import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { dateOnlyValue, requireDateParam } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { buildSegmentWhere } from './segment-rules';
import { CrmChannelService } from './crm-channel.service';
import { CRM_OUTBOUND_JOB_LIST } from './crm-reminder-jobs';
import { ScheduleService } from '../schedule/schedule.service';
import { AppointmentStatus } from '@prisma/client';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channel: CrmChannelService,
    private readonly schedule: ScheduleService,
  ) {}

  // ── 대시보드 ──

  async getDashboard() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      campaignCount,
      checkupTargets,
      foreignCases,
      churnRisk,
      recentCampaigns,
      segmentStats,
    ] = await Promise.all([
      this.prisma.crmCampaign.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.checkupFollowUp.count({
        where: { completedAt: null },
      }),
      this.prisma.crmForeignPatientCase.count({
        where: { status: { notIn: ['CLOSED'] } },
      }),
      this.prisma.patient.count({
        where: { churnRisk: 'HIGH' },
      }),
      this.prisma.crmCampaign.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, type: true, channel: true, status: true,
          sentCount: true, deliveredCount: true, createdAt: true,
        },
      }),
      this.prisma.crmSegment.findMany({
        where: { isActive: true },
        take: 10,
        orderBy: { patientCount: 'desc' },
        select: { id: true, name: true, type: true, patientCount: true },
      }),
    ]);

    return {
      stats: {
        campaignCount,
        checkupTargets,
        foreignCases,
        churnRisk,
      },
      recentCampaigns,
      segmentStats,
    };
  }

  // ── 캠페인 CRUD ──

  async createCampaign(data: {
    name: string;
    type: string;
    channel: string;
    segmentId?: string;
    templateId?: string;
    subject?: string;
    content: string;
    variables?: Prisma.InputJsonValue;
    scheduledAt?: Date;
  }, userId: string) {
    let targetCount = 0;
    if (data.segmentId) {
      const seg = await this.prisma.crmSegment.findUnique({ where: { id: data.segmentId } });
      if (seg) targetCount = seg.patientCount;
    }

    // 🔴 (B4) 읽는 키만 — 종전 `...data` 는 호출자가 넣은 status·sentCount 까지 Prisma 로 보냈다
    return this.prisma.crmCampaign.create({
      data: {
        name: data.name, type: data.type, channel: data.channel, content: data.content,
        segmentId: data.segmentId || undefined, templateId: data.templateId || undefined,
        subject: data.subject, variables: data.variables, scheduledAt: data.scheduledAt,
        targetCount,
        createdBy: userId,
      },
    });
  }

  async findCampaigns(query: { status?: string; type?: string; page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: Prisma.CrmCampaignWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    const [data, total] = await Promise.all([
      this.prisma.crmCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { segment: { select: { name: true } }, template: { select: { name: true } } },
      }),
      this.prisma.crmCampaign.count({ where }),
    ]);

    return { data, meta: { total, page, limit } };
  }

  async getCampaign(id: string) {
    const campaign = await this.prisma.crmCampaign.findUnique({
      where: { id },
      include: {
        segment: true,
        template: true,
        logs: { take: 100, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');
    return campaign;
  }

  async updateCampaign(id: string, data: Partial<{
    name: string;
    type: string;
    channel: string;
    content: string;
    subject: string;
    segmentId: string | null;
    templateId: string | null;
    scheduledAt: Date | string | null;
  }>) {
    const campaign = await this.prisma.crmCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');
    if (campaign.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태에서만 수정 가능합니다');
    // 🔴 (B4) 종전엔 본문 전체(`Record<string, unknown>`)가 그대로 data 였다 — status·sentCount·createdBy 까지 바뀌었다
    const patch: Prisma.CrmCampaignUncheckedUpdateInput = {
      name: data.name, type: data.type, channel: data.channel, content: data.content, subject: data.subject,
    };
    if (data.segmentId !== undefined) patch.segmentId = data.segmentId || null;
    if (data.templateId !== undefined) patch.templateId = data.templateId || null;
    if (data.scheduledAt !== undefined) patch.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    return this.prisma.crmCampaign.update({ where: { id }, data: patch });
  }

  async sendCampaign(id: string) {
    const campaign = await this.prisma.crmCampaign.findUnique({
      where: { id },
      include: { segment: true, template: true },
    });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new BadRequestException('발송 가능한 상태가 아닙니다');
    }

    // 발송 시간 제한 (08:00~21:00, 정보통신망법 제50조의8)
    const hour = new Date().getHours();
    if (hour < 8 || hour >= 21) {
      throw new BadRequestException('광고성 메시지는 08:00~21:00에만 발송 가능합니다 (정보통신망법)');
    }

    // 대상 환자 조회
    const patients = await this.getSegmentPatients(campaign.segmentId);
    const now = new Date();

    // 동의 확인 + 발송 파이프라인
    let sentCount = 0;      // 실제로 나간 것
    let simulatedCount = 0; // 제공자가 없어 기록만 된 것(나가지 않았다)
    let failedCount = 0;
    const campaignLogs: { campaignId: string; patientId: string; channel: string; status: string; sentAt: Date | null; errorMessage: string | null }[] = [];
    const commLogs: { patientId: string; channel: string; direction: string; type: string; subject: string; content: string; status: string; campaignId: string }[] = [];

    // 마케팅 동의 배치 선조회 — 대상 최대 5,000명 루프 내 개별 findUnique(N+1) 제거 (2026-07 전체검토 D-1)
    const needsConsent = ['PROMOTION', 'SURVEY', 'REENGAGEMENT', 'ANNOUNCEMENT'].includes(campaign.type);
    const consentedSet = new Set<string>();
    if (needsConsent && patients.length) {
      const consents = await this.prisma.patientConsentCrm.findMany({
        where: { patientId: { in: patients.map((x) => x.id) }, channel: campaign.channel, type: 'MARKETING', consented: true },
        select: { patientId: true },
      });
      for (const c of consents) consentedSet.add(c.patientId);
    }

    for (const p of patients) {
      // 마케팅 동의 확인 (진료 목적 REMINDER는 동의 불필요)
      if (needsConsent) {
        if (!consentedSet.has(p.id)) {
          campaignLogs.push({
            campaignId: id, patientId: p.id, channel: campaign.channel,
            status: 'FAILED', sentAt: null, errorMessage: 'CONSENT_DENIED',
          });
          failedCount++;
          continue;
        }
      }

      // 변수 치환 — 대상 조회에서 이미 동봉된 필드를 쓴다(루프 내 재조회는 N+1 이었다)
      const content = campaign.content
        .replace(/\{\{patientName\}\}/g, `${p.familyName}${p.givenName}`)
        .replace(/\{\{phone\}\}/g, p.phone ?? '');

      // 🔴 수신처가 없으면 보낼 수 없다 — 종전엔 phone/email 이 null 이어도 'SENT' 로 셌다(2026-08-13 W6)
      const to = campaign.channel === 'EMAIL' ? p.email : p.phone;
      if (!to) {
        campaignLogs.push({
          campaignId: id, patientId: p.id, channel: campaign.channel,
          status: 'FAILED', sentAt: null, errorMessage: 'NO_CONTACT',
        });
        failedCount++;
        continue;
      }

      // 🔴 실제로 발송을 시도하고 **그 결과를 그대로** 기록한다. 종전엔 채널 호출이 한 줄도 없이
      //    전원 'SENT' 를 찍고 `deliveredCount = sentCount` 로 도달률 100%를 정의상 참으로 만들었다.
      const res = await this.channel.send(campaign.channel, to, campaign.subject || campaign.name, content);
      const status = !res.success ? 'FAILED' : res.simulated ? 'SIMULATED' : 'SENT';

      campaignLogs.push({
        campaignId: id, patientId: p.id, channel: campaign.channel,
        status, sentAt: res.success ? now : null,
        errorMessage: res.success ? (res.simulated ? 'SIMULATED_NO_PROVIDER' : null) : (res.error ?? 'SEND_FAILED'),
      });
      commLogs.push({
        patientId: p.id, channel: campaign.channel, direction: 'OUTBOUND',
        type: 'CAMPAIGN', subject: campaign.subject || campaign.name,
        content, status, campaignId: id,
      });
      if (!res.success) failedCount++;
      else if (res.simulated) simulatedCount++;
      else sentCount++;
    }

    // 일괄 저장
    await this.prisma.$transaction([
      this.prisma.crmCampaign.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          sentAt: now,
          completedAt: now,
          sentCount,
          // 🔴 도달은 별개 사실이다(발송 콜백/웹훅이 있어야 안다). 발송수를 복사하면
          //    도달률 100%가 정의상 참이 된다 — 확인 경로가 생기기 전까지 0으로 둔다.
          deliveredCount: 0,
          failedCount: failedCount + simulatedCount,
          targetCount: patients.length,
        },
      }),
      ...(campaignLogs.length > 0
        ? [this.prisma.crmCampaignLog.createMany({ data: campaignLogs })]
        : []),
    ]);

    if (commLogs.length > 0) {
      await this.prisma.patientCommunicationLog.createMany({ data: commLogs });
    }

    return { sentCount, failedCount, totalTargets: patients.length };
  }

  async cancelCampaign(id: string) {
    return this.prisma.crmCampaign.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * 캠페인 발송 기록(환자별) — 기획 `GET campaigns/:id/logs`.
   *
   * 🔴 발송 판정은 `sendCampaign` 이 적은 그대로 돌려준다: SENT=채널이 받음 · SIMULATED=제공자가 없어 **나가지 않음** ·
   *    FAILED=사유(`CONSENT_DENIED`·`NO_CONTACT`·채널 오류). 캠페인 머리의 `failedCount` 는 SIMULATED 를 합쳐 세므로
   *    요약은 상태별로 **갈라서** 준다. 도달(`deliveredAt`)은 발송 콜백이 없어 아무도 적지 않는다 — `deliveryTracking`
   *    으로 그 사실을 말하고, 도달률을 만들지 않는다.
   */
  async getCampaignLogs(id: string, q: { status?: string; page?: number; limit?: number }) {
    const campaign = await this.prisma.crmCampaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const where: Prisma.CrmCampaignLogWhereInput = { campaignId: id, ...(q.status ? { status: q.status } : {}) };

    const [rows, total, byStatusReason] = await Promise.all([
      this.prisma.crmCampaignLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { patient: { select: { familyName: true, givenName: true } } },
      }),
      this.prisma.crmCampaignLog.count({ where }),
      // 요약은 필터와 무관하게 캠페인 전체 — 거른 목록만 보고 "실패 0" 으로 읽지 않게
      this.prisma.crmCampaignLog.groupBy({ by: ['status', 'errorMessage'], where: { campaignId: id }, _count: { _all: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of byStatusReason) byStatus[g.status] = (byStatus[g.status] ?? 0) + g._count._all;
    const deliveredRecorded = rows.some((r) => r.deliveredAt != null);

    return {
      data: rows.map((r) => ({
        id: r.id,
        patientId: r.patientId,
        patientName: r.patient ? `${r.patient.familyName}${r.patient.givenName}` : null,
        channel: r.channel,
        status: r.status,
        reason: r.errorMessage,
        sentAt: r.sentAt,
        deliveredAt: r.deliveredAt,
        openedAt: r.openedAt,
        createdAt: r.createdAt,
      })),
      meta: { total, page, limit },
      summary: {
        total: byStatusReason.reduce((n, g) => n + g._count._all, 0),
        byStatus,
        byReason: byStatusReason
          .filter((g) => g.status !== 'SENT')
          .map((g) => ({ status: g.status, reason: g.errorMessage, count: g._count._all }))
          .sort((a, b) => b.count - a.count),
        // 발송 콜백·웹훅이 없어 도달은 기록되지 않는다 — 기록이 한 건이라도 있으면 그때 'RECORDED'
        deliveryTracking: deliveredRecorded || (byStatus.DELIVERED ?? 0) > 0 ? 'RECORDED' : 'NOT_AVAILABLE',
      },
    };
  }

  // ── 세그먼트 ──

  async createSegment(data: {
    name: string;
    description?: string;
    type: string;
    rules: Prisma.InputJsonValue;
  }) {
    const segment = await this.prisma.crmSegment.create({
      data: { name: data.name, description: data.description, type: data.type, rules: data.rules },
    });
    // 환자 수 계산
    const count = await this.countSegmentPatients(segment.id, data.rules);
    return this.prisma.crmSegment.update({
      where: { id: segment.id },
      data: { patientCount: count, lastRefreshedAt: new Date() },
    });
  }

  async findSegments() {
    return this.prisma.crmSegment.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSegment(id: string) {
    const segment = await this.prisma.crmSegment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException('세그먼트를 찾을 수 없습니다');

    const patients = await this.getSegmentPatients(id);
    return { ...segment, patients };
  }

  async refreshSegment(id: string) {
    const segment = await this.prisma.crmSegment.findUnique({ where: { id } });
    if (!segment) throw new NotFoundException('세그먼트를 찾을 수 없습니다');

    const count = await this.countSegmentPatients(id, segment.rules);
    return this.prisma.crmSegment.update({
      where: { id },
      data: { patientCount: count, lastRefreshedAt: new Date() },
    });
  }

  async deleteSegment(id: string) {
    return this.prisma.crmSegment.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── 템플릿 ──

  async createTemplate(data: {
    name: string;
    type: string;
    channel: string;
    locale?: string;
    subject?: string;
    content: string;
  }) {
    return this.prisma.crmTemplate.create({
      data: { name: data.name, type: data.type, channel: data.channel, locale: data.locale, subject: data.subject, content: data.content },
    });
  }

  async findTemplates(query?: { type?: string; channel?: string; locale?: string }) {
    const where: Prisma.CrmTemplateWhereInput = { isActive: true };
    if (query?.type) where.type = query.type;
    if (query?.channel) where.channel = query.channel;
    if (query?.locale) where.locale = query.locale;
    return this.prisma.crmTemplate.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async updateTemplate(id: string, data: Partial<{
    name: string; type: string; channel: string; subject: string; content: string; locale: string;
  }>) {
    // 🔴 (B4) 읽는 키만 — 종전엔 본문 전체가 data 였다(isActive·createdAt 포함)
    return this.prisma.crmTemplate.update({
      where: { id },
      data: { name: data.name, type: data.type, channel: data.channel, subject: data.subject, content: data.content, locale: data.locale },
    });
  }

  async deleteTemplate(id: string) {
    return this.prisma.crmTemplate.update({ where: { id }, data: { isActive: false } });
  }

  async previewTemplate(id: string, variables: Record<string, string>) {
    const template = await this.prisma.crmTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('템플릿을 찾을 수 없습니다');

    let preview = template.content;
    for (const [key, val] of Object.entries(variables)) {
      preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }
    return { subject: template.subject, content: preview };
  }

  // ── 환자 CRM 프로필 ──

  async getPatientProfile(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true, familyName: true, givenName: true, mrn: true,
        dateOfBirth: true, gender: true, phone: true, email: true,
        nationality: true, patientSource: true, tags: true,
        preferredLanguage: true, insuranceType: true,
        crmScore: true, churnRisk: true, rfmSegment: true,
        preferredChannel: true, lastContactAt: true,
      },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    const [visitSummary, communications, consents, checkups] = await Promise.all([
      this.prisma.encounter.aggregate({
        where: { patientId },
        _count: true,
        _max: { createdAt: true },
      }),
      this.prisma.patientCommunicationLog.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.patientConsentCrm.findMany({
        where: { patientId },
      }),
      this.prisma.checkupVisit.findMany({
        where: { patientId },
        select: {
          id: true, scheduledDate: true, status: true,
          program: { select: { name: true } },
        },
        orderBy: { scheduledDate: 'desc' },
        take: 5,
      }),
    ]);

    const hasAbnormalFindings = await this.prisma.checkupFollowUp.count({
      where: { visit: { patientId }, completedAt: null },
    }) > 0;

    return {
      patient,
      visitCount: visitSummary._count,
      lastVisitAt: visitSummary._max.createdAt,
      communications,
      consents,
      checkups,
      hasAbnormalFindings,
    };
  }

  async getPatientCommunications(patientId: string, page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.patientCommunicationLog.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.patientCommunicationLog.count({ where: { patientId } }),
    ]);
    return { data, meta: { total, page, limit } };
  }

  async updatePatientConsent(patientId: string, data: {
    channel: string;
    type: string;
    consented: boolean;
    source?: string;
  }) {
    const now = new Date();
    return this.prisma.patientConsentCrm.upsert({
      where: {
        patientId_channel_type: {
          patientId,
          channel: data.channel,
          type: data.type,
        },
      },
      create: {
        patientId,
        channel: data.channel,
        type: data.type,
        consented: data.consented,
        source: data.source,
        consentedAt: data.consented ? now : undefined,
        withdrawnAt: data.consented ? undefined : now,
      },
      update: {
        consented: data.consented,
        consentedAt: data.consented ? now : undefined,
        withdrawnAt: data.consented ? undefined : now,
        source: data.source,
      },
    });
  }

  // ── 검진 CRM ──

  async getCheckupTargets(query: {
    category?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    // 검진 추적 대상 + 미완료 건 조회
    const where: Prisma.CheckupFollowUpWhereInput = {};
    if (query.status === 'PENDING') where.completedAt = null;
    if (query.status === 'COMPLETED') where.completedAt = { not: null };

    const [data, total] = await Promise.all([
      this.prisma.checkupFollowUp.findMany({
        where,
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          visit: {
            include: {
              patient: {
                select: {
                  id: true, familyName: true, givenName: true, mrn: true,
                  phone: true, dateOfBirth: true, gender: true,
                },
              },
              program: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.checkupFollowUp.count({ where }),
    ]);

    return { data, meta: { total, page, limit } };
  }

  async getCheckupAnalytics() {
    const [byProgram, byStatus, recentVisits] = await Promise.all([
      this.prisma.checkupVisit.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.checkupFollowUp.groupBy({
        by: ['followUpType'],
        _count: true,
      }),
      this.prisma.checkupVisit.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return { byProgram, byStatus, recentVisits };
  }

  // ── 해외환자 CRM ──

  async createForeignCase(data: {
    patientId: string;
    source: string;
    agencyName?: string;
    arrivalDate?: Date;
    departureDate?: Date;
    accommodation?: string;
    interpreterLang?: string;
    packageType?: string;
    estimatedCost?: number;
    note?: string;
  }, userId: string) {
    return this.prisma.crmForeignPatientCase.create({
      data: {
        patientId: data.patientId, source: data.source, agencyName: data.agencyName,
        arrivalDate: data.arrivalDate, departureDate: data.departureDate, accommodation: data.accommodation,
        interpreterLang: data.interpreterLang, packageType: data.packageType, note: data.note,
        estimatedCost: data.estimatedCost ? new Prisma.Decimal(data.estimatedCost) : undefined,
        assignedTo: userId,
      },
      include: {
        patient: {
          select: {
            id: true, familyName: true, givenName: true, mrn: true,
            nameEn: true, nationality: true, phone: true,
          },
        },
      },
    });
  }

  async findForeignCases(query: {
    status?: string;
    assignedTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: Prisma.CrmForeignPatientCaseWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.assignedTo) where.assignedTo = query.assignedTo;

    const [data, total] = await Promise.all([
      this.prisma.crmForeignPatientCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          patient: {
            select: {
              id: true, familyName: true, givenName: true, mrn: true,
              nameEn: true, nationality: true, phone: true, preferredLanguage: true,
            },
          },
          assignee: { select: { id: true, familyName: true, givenName: true } },
        },
      }),
      this.prisma.crmForeignPatientCase.count({ where }),
    ]);

    return { data, meta: { total, page, limit } };
  }

  async getForeignCase(id: string) {
    const c = await this.prisma.crmForeignPatientCase.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true, familyName: true, givenName: true, mrn: true,
            nameEn: true, nationality: true, phone: true, email: true,
            preferredLanguage: true, patientSource: true, travelInsurance: true,
            interpreterNeeded: true, embassyContact: true,
          },
        },
        assignee: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (!c) throw new NotFoundException('케이스를 찾을 수 없습니다');
    return c;
  }

  async updateForeignCase(id: string, data: Partial<{
    status: string;
    assignedTo: string;
    arrivalDate: Date | string | null;
    departureDate: Date | string | null;
    accommodation: string;
    interpreterLang: string;
    packageType: string;
    estimatedCost: number;
    actualCost: number;
    satisfactionScore: number;
    note: string;
  }>) {
    // 🔴 (B4) 읽는 키만 — 종전 `{ ...data }` 는 본문 전체(patientId·createdAt 포함)가 Prisma data 였다
    const updateData: Prisma.CrmForeignPatientCaseUncheckedUpdateInput = {
      status: data.status, assignedTo: data.assignedTo, accommodation: data.accommodation,
      interpreterLang: data.interpreterLang, packageType: data.packageType,
      satisfactionScore: data.satisfactionScore, note: data.note,
    };
    // `@db.Date` — 'YYYY-MM-DD' 문자열을 그대로 넘기면 Prisma 가 거부했다(500). 정본 비교값으로 저장한다
    for (const k of ['arrivalDate', 'departureDate'] as const) {
      const v = data[k];
      if (v === undefined) continue;
      if (!v) { updateData[k] = null; continue; }
      const d = dateOnlyValue(v);
      if (!d) throw new BadRequestException('도착일·출국일 형식이 올바르지 않습니다(YYYY-MM-DD)');
      updateData[k] = d;
    }
    if (data.estimatedCost !== undefined) {
      updateData.estimatedCost = new Prisma.Decimal(data.estimatedCost);
    }
    if (data.actualCost !== undefined) {
      updateData.actualCost = new Prisma.Decimal(data.actualCost);
    }
    return this.prisma.crmForeignPatientCase.update({ where: { id }, data: updateData });
  }

  async getForeignAnalytics() {
    const [byStatus, byNationality, bySource] = await Promise.all([
      this.prisma.crmForeignPatientCase.groupBy({ by: ['status'], _count: true }),
      this.prisma.$queryRaw<{ nationality: string; count: bigint }[]>`
        SELECT p.nationality, COUNT(*) as count
        FROM crm_foreign_patient_cases c
        JOIN patients p ON c.patient_id = p.id
        GROUP BY p.nationality
        ORDER BY count DESC
        LIMIT 10
      `,
      this.prisma.crmForeignPatientCase.groupBy({ by: ['source'], _count: true }),
    ]);

    return {
      byStatus,
      byNationality: byNationality.map(r => ({ ...r, count: Number(r.count) })),
      bySource,
    };
  }

  /**
   * 에이전시별 실적 집계 — 별도 Agency 모델 없이 케이스의 agencyName 을 축으로 집계(2026-08-04).
   * 화면(에이전시 관리)이 "Phase 2 예정" 스텁이던 것을 실데이터로 보완 — 계약 CRUD 는 여전히 범위 밖.
   */
  async getAgencyStats() {
    const rows = await this.prisma.$queryRaw<{
      agency: string; cases: bigint; active: bigint; closed: bigint;
      est: number | null; actual: number | null; sat: number | null; last: Date | null;
    }[]>`
      SELECT COALESCE(NULLIF(TRIM(agency_name), ''), '(직접 유치)') AS agency,
             COUNT(*) AS cases,
             COUNT(*) FILTER (WHERE status NOT IN ('CLOSED')) AS active,
             COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed,
             SUM(estimated_cost)::float AS est,
             SUM(actual_cost)::float AS actual,
             AVG(satisfaction_score)::float AS sat,
             MAX(created_at) AS last
      FROM crm_foreign_patient_cases
      GROUP BY 1
      ORDER BY cases DESC
    `;
    return rows.map((r) => ({
      agency: r.agency,
      cases: Number(r.cases),
      active: Number(r.active),
      closed: Number(r.closed),
      estimatedCost: r.est ?? 0,
      actualCost: r.actual ?? 0,
      satisfaction: r.sat != null ? Math.round(r.sat * 10) / 10 : null,
      lastCaseAt: r.last,
    }));
  }

  // ── 상담/대행 ──

  async searchPatients(q: string) {
    return this.prisma.patient.findMany({
      where: {
        OR: [
          { mrn: { contains: q } },
          { familyName: { contains: q } },
          { givenName: { contains: q } },
          { phone: { contains: q } },
        ],
      },
      select: {
        id: true, familyName: true, givenName: true, mrn: true,
        dateOfBirth: true, gender: true, phone: true, email: true,
        nationality: true, tags: true, crmScore: true, churnRisk: true,
      },
      take: 20,
    });
  }

  async logCommunication(data: {
    patientId: string;
    channel: string;
    direction: string;
    type: string;
    subject?: string;
    content?: string;
    status: string;
  }, userId: string) {
    return this.prisma.patientCommunicationLog.create({
      data: {
        patientId: data.patientId, channel: data.channel, direction: data.direction, type: data.type,
        subject: data.subject, content: data.content, status: data.status, sentBy: userId,
      },
    });
  }

  // ── 포털 배너 ──

  async createBanner(data: {
    type: string;
    title: string;
    content?: string;
    imageUrl?: string;
    linkUrl?: string;
    linkType?: string;
    segmentId?: string;
    targetAll?: boolean;
    publishFrom: Date;
    publishUntil: Date;
    showOncePerDay?: boolean;
    sortOrder?: number;
  }, userId: string) {
    return this.prisma.crmPortalBanner.create({
      data: {
        type: data.type, title: data.title, content: data.content, imageUrl: data.imageUrl, linkUrl: data.linkUrl,
        linkType: data.linkType, segmentId: data.segmentId || undefined, targetAll: data.targetAll,
        publishFrom: data.publishFrom, publishUntil: data.publishUntil, showOncePerDay: data.showOncePerDay,
        sortOrder: data.sortOrder, createdBy: userId,
      },
    });
  }

  async findBanners(active = true) {
    const now = new Date();
    const where: Prisma.CrmPortalBannerWhereInput = active
      ? { isActive: true, publishFrom: { lte: now }, publishUntil: { gte: now } }
      : {};
    return this.prisma.crmPortalBanner.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateBanner(id: string, data: Partial<{
    title: string; content: string; imageUrl: string; linkUrl: string;
    publishFrom: Date | string; publishUntil: Date | string; isActive: boolean; sortOrder: number;
  }>) {
    // 🔴 (B4) 읽는 키만 — 종전엔 본문 전체가 data 였다(clickCount·impressionCount·createdBy 위조 가능)
    return this.prisma.crmPortalBanner.update({
      where: { id },
      data: {
        title: data.title, content: data.content, imageUrl: data.imageUrl, linkUrl: data.linkUrl,
        publishFrom: data.publishFrom !== undefined ? new Date(data.publishFrom) : undefined,
        publishUntil: data.publishUntil !== undefined ? new Date(data.publishUntil) : undefined,
        isActive: data.isActive, sortOrder: data.sortOrder,
      },
    });
  }

  async deleteBanner(id: string) {
    return this.prisma.crmPortalBanner.update({ where: { id }, data: { isActive: false } });
  }

  async clickBanner(id: string) {
    return this.prisma.crmPortalBanner.update({
      where: { id },
      data: { clickCount: { increment: 1 } },
    });
  }

  // ── 자동화 ──

  async getAutomationStatus() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [pendingReminders, upcomingFollowUps, churnRiskCount] = await Promise.all([
      this.prisma.appointment.count({
        where: {
          scheduledAt: { gte: now, lte: tomorrow },
          status: 'SCHEDULED',
        },
      }),
      this.prisma.checkupFollowUp.count({
        where: {
          dueDate: { lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) },
          completedAt: null,
        },
      }),
      this.prisma.patient.count({ where: { churnRisk: { in: ['HIGH', 'MEDIUM'] } } }),
    ]);

    return { pendingReminders, upcomingFollowUps, churnRiskCount };
  }

  /**
   * 자동 연락 크론 현황 — 기획 `GET automation/reminders`.
   *
   * 작업 목록·주기·기록 제목은 크론과 같은 정본(`CRM_OUTBOUND_JOBS`)에서. 발송 결과는 크론이 적는
   * `PatientCommunicationLog`(SENT/SIMULATED/FAILED)를 작업별로 모은다.
   * 🔴 말하지 않는 것: ① "마지막 실행 시각" — 크론 실행 원장이 없고 대상 0 이면 기록도 없다(마지막 **발송 기록** 시각만 준다)
   *    ② 도달 — 기록은 발송 시도다. ③ 수동 실행 — 대외 발신 3조건(설정 기본 OFF·승인)이 이 크론들에 없어 만들지 않는다(사람 결정).
   */
  async getReminderAutomation(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const subjects = CRM_OUTBOUND_JOB_LIST.flatMap((j) => [...j.subjects]);
    const [groups, lastBySubject] = await Promise.all([
      this.prisma.patientCommunicationLog.groupBy({
        by: ['subject', 'status'],
        where: { direction: 'OUTBOUND', subject: { in: subjects }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.patientCommunicationLog.groupBy({
        by: ['subject'],
        where: { direction: 'OUTBOUND', subject: { in: subjects } },
        _max: { createdAt: true },
      }),
    ]);

    const jobs = CRM_OUTBOUND_JOB_LIST.map((j) => {
      const tally: Record<string, number> = {};
      for (const g of groups) if (g.subject && j.subjects.includes(g.subject)) tally[g.status] = (tally[g.status] ?? 0) + g._count._all;
      const lasts = lastBySubject
        .filter((g) => g.subject && j.subjects.includes(g.subject) && g._max.createdAt)
        .map((g) => g._max.createdAt as Date);
      return {
        key: j.key,
        label: j.label,
        cron: j.cron,
        logType: j.logType,
        windowDays: days,
        tally,
        attempted: Object.values(tally).reduce((a, b) => a + b, 0),
        lastRecordedAt: lasts.length ? new Date(Math.max(...lasts.map((d) => d.getTime()))) : null,
      };
    });

    return {
      jobs,
      lastRunAt: null,
      lastRunAtReason: 'NO_RUN_LEDGER',
      configGate: null,
      approvalGate: null,
      manualRun: { available: false, reason: 'OUTBOUND_THREE_CONDITIONS_UNRESOLVED' },
    };
  }

  async getRfmDashboard() {
    const segments = await this.prisma.patient.groupBy({
      by: ['rfmSegment'],
      where: { rfmSegment: { not: null }, isDeceased: false, mergedIntoId: null },
      _count: true,
      _avg: { crmScore: true },
    });

    const churnDistribution = await this.prisma.patient.groupBy({
      by: ['churnRisk'],
      where: { churnRisk: { not: null }, isDeceased: false, mergedIntoId: null },
      _count: true,
    });

    const totalPatients = await this.prisma.patient.count({
      where: { isDeceased: false, mergedIntoId: null },
    });

    const scoredPatients = await this.prisma.patient.count({
      where: { crmScore: { not: null, gt: 0 }, isDeceased: false, mergedIntoId: null },
    });

    return {
      rfmSegments: segments.map(s => ({
        segment: s.rfmSegment,
        count: s._count,
        // 🔴 (2026-09-21 H) 종전 `?? 0` — 그 세그먼트 환자의 `crmScore` 가 **한 건도 산출되지 않았을 때**
        //    (Prisma `_avg` = null) "평균 0점"이라고 말했다. 0점은 CRM 최하 등급이라 **미산출이
        //    최악 등급으로** 읽혔다. `count` 는 환자 수이지 점수 표본 수가 아니라서 분모 노릇도 못 했다.
        avgScore: s._avg.crmScore != null ? Math.round(s._avg.crmScore) : null,
      })),
      churnDistribution: churnDistribution.map(c => ({
        risk: c.churnRisk,
        count: c._count,
      })),
      totalPatients,
      scoredPatients,
    };
  }

  // ── A/B 테스트 ──

  async createAbTest(campaignId: string, data: {
    variantContent: string;
    variantSubject?: string;
    splitRatio: number; // A에 할당할 % (예: 50)
  }, userId: string) {
    const original = await this.prisma.crmCampaign.findUnique({ where: { id: campaignId } });
    if (!original) throw new NotFoundException('원본 캠페인을 찾을 수 없습니다');
    if (original.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태에서만 A/B 테스트 가능');

    // 원본을 A로 마킹
    await this.prisma.crmCampaign.update({
      where: { id: campaignId },
      data: { abTestEnabled: true, abVariantName: 'A', abSplitRatio: data.splitRatio },
    });

    // B 변형 생성
    const variant = await this.prisma.crmCampaign.create({
      data: {
        name: `${original.name} [B]`,
        type: original.type,
        channel: original.channel,
        status: 'DRAFT',
        segmentId: original.segmentId,
        content: data.variantContent,
        subject: data.variantSubject || original.subject,
        abTestEnabled: true,
        abVariantName: 'B',
        abParentId: campaignId,
        abSplitRatio: 100 - data.splitRatio,
        createdBy: userId,
      },
    });

    return { original: { id: campaignId, variant: 'A' }, variant: { id: variant.id, variant: 'B' } };
  }

  async getAbTestResults(campaignId: string) {
    const campaign = await this.prisma.crmCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');

    // A와 B 모두 조회
    const variants = await this.prisma.crmCampaign.findMany({
      where: { OR: [{ id: campaignId }, { abParentId: campaignId }] },
      select: {
        id: true, name: true, abVariantName: true,
        sentCount: true, deliveredCount: true, openedCount: true, clickedCount: true,
        conversionCount: true, failedCount: true,
      },
    });

    return variants.map(v => ({
      ...v,
      openRate: v.sentCount > 0 ? Math.round((v.openedCount / v.sentCount) * 100) : 0,
      clickRate: v.sentCount > 0 ? Math.round((v.clickedCount / v.sentCount) * 100) : 0,
      conversionRate: v.sentCount > 0 ? Math.round((v.conversionCount / v.sentCount) * 100) : 0,
    }));
  }

  // ── 코호트 리텐션 분석 ──

  async getRetentionCohort() {
    const now = new Date();
    const cohorts: { month: string; total: number; retained: number; rate: number }[] = [];

    // 최근 6개월 코호트
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      // 해당 월에 첫 방문한 환자 수
      const firstVisitors = await this.prisma.encounter.groupBy({
        by: ['patientId'],
        where: { createdAt: { gte: start, lt: end } },
      });
      const total = firstVisitors.length;

      // 그 환자 중 이후 재방문한 수
      let retained = 0;
      if (total > 0 && i > 0) {
        const patientIds = firstVisitors.map(f => f.patientId);
        const revisits = await this.prisma.encounter.findMany({
          where: {
            patientId: { in: patientIds }, // 전체 코호트 대상(상한 제거 — 500 초과 시 재방문율 과소계산 버그)
            createdAt: { gte: end },
          },
          distinct: ['patientId'],
          select: { patientId: true },
        });
        retained = revisits.length;
      }

      cohorts.push({
        month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        total,
        retained,
        rate: total > 0 ? Math.round((retained / total) * 100) : 0,
      });
    }

    return cohorts;
  }

  // ── 캠페인 성과 요약 ──

  async getCampaignPerformance() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const campaigns = await this.prisma.crmCampaign.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: thirtyDaysAgo } },
      select: {
        id: true, name: true, type: true, channel: true,
        sentCount: true, deliveredCount: true, openedCount: true, clickedCount: true,
        conversionCount: true, abVariantName: true, completedAt: true,
      },
      orderBy: { completedAt: 'desc' },
    });

    const totals = campaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + c.sentCount,
        delivered: acc.delivered + c.deliveredCount,
        opened: acc.opened + c.openedCount,
        clicked: acc.clicked + c.clickedCount,
        conversions: acc.conversions + c.conversionCount,
      }),
      { sent: 0, delivered: 0, opened: 0, clicked: 0, conversions: 0 },
    );

    return {
      campaigns,
      totals,
      avgOpenRate: totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 100) : 0,
      avgClickRate: totals.sent > 0 ? Math.round((totals.clicked / totals.sent) * 100) : 0,
    };
  }

  async runChurnAnalysis() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    // 마지막 방문일 기준 이탈 위험 분류 (cron churnDetection 과 임계값 다름 — 보존).
    const patients = await this.prisma.patient.findMany({
      where: { isDeceased: false, mergedIntoId: null },
      select: { id: true },
    });

    // 환자별 마지막 방문일 — 단일 groupBy(per-patient findFirst N+1 제거)
    const lastByPatient = await this.prisma.encounter.groupBy({
      by: ['patientId'],
      _max: { createdAt: true },
    });
    const lastMap = new Map(lastByPatient.map((g) => [g.patientId, g._max.createdAt]));

    // 분류(기존 동일): 없음/365일 초과=HIGH, 90~365일=MEDIUM(기존 <180·<90 두 분기 합집합=<90),
    //   90일 이내=LOW.
    const high: string[] = [], medium: string[] = [], low: string[] = [];
    for (const p of patients) {
      const last = lastMap.get(p.id);
      if (!last || last < yearAgo) high.push(p.id);
      else if (last < ninetyDaysAgo) medium.push(p.id);
      else low.push(p.id);
    }

    const setRisk = async (ids: string[], risk: string) => {
      for (let i = 0; i < ids.length; i += 1000) {
        await this.prisma.patient.updateMany({
          where: { id: { in: ids.slice(i, i + 1000) } },
          data: { churnRisk: risk },
        });
      }
    };
    await setRisk(high, 'HIGH');
    await setRisk(medium, 'MEDIUM');
    await setRisk(low, 'LOW');

    return { highCount: high.length, mediumCount: medium.length, lowCount: low.length, total: patients.length };
  }

  // ── 예약·접수 대행 ──

  // 🔴 (2026-09-14) 예약 대행 4종이 `prisma.appointment` 를 직접 만들고 바꿔 예약 정본을 우회했다 —
  //    휴진·진료 세션·충돌 검증(validateBookable·의사 락)·여정 이벤트가 없었고, 가용 시간대는 시간표와 무관한
  //    09:00~17:00 고정 슬롯을 지어냈다. 전부 ScheduleService 정본으로 보낸다(행위자는 CRM 사용자로 기록).
  async proxyCreateAppointment(data: { patientId: string; doctorId: string; scheduledAt: string; reason?: string }, userId: string) {
    return this.schedule.create(
      { patientId: data.patientId, doctorId: data.doctorId, scheduledAt: data.scheduledAt, reason: data.reason ?? 'CRM 예약 대행', bookedVia: 'CRM' },
      userId,
    );
  }

  async proxyRescheduleAppointment(id: string, scheduledAt: string, userId: string) {
    return this.schedule.update(id, { scheduledAt }, userId);
  }

  async proxyCancelAppointment(id: string, cancelReason: string, userId: string) {
    return this.schedule.changeStatus(id, { status: AppointmentStatus.CANCELLED, cancelReason }, userId);
  }

  async proxyGetAvailableSlots(doctorId: string, date: string) {
    requireDateParam(date, '조회할 날짜');
    return this.schedule.getAvailability({ doctorId, date, duration: 30 });
  }

  // ── 포털 메시지 ──

  async sendPortalMessage(data: {
    patientId: string;
    subject: string;
    content: string;
    type?: string;
  }, userId: string) {
    // 🔴 (2026-10-13 결함 발굴 C3) 종전엔 환자 포털 계정이 없어 알림을 만들지 않았는데도 통신 로그 SENT·success:true
    //    (대량 발송 수에도 셌다). 받을 곳이 없으면 보내지 않은 것이다 — FAILED + 이유 · 응답도 그렇게 말한다.
    const account = await this.prisma.patientAccount.findFirst({
      where: { patientId: data.patientId },
    });

    if (account) {
      await this.prisma.patientNotification.create({
        data: {
          accountId: account.id,
          type: data.type ?? 'MARKETING',
          title: data.subject,
          body: data.content,
        },
      });
    }

    // 커뮤니케이션 로그 — 포털 알림함에 넣었으면 SENT(알림함 도달 · 읽음은 따로) · 계정이 없으면 FAILED
    await this.prisma.patientCommunicationLog.create({
      data: {
        patientId: data.patientId,
        channel: 'PORTAL',
        direction: 'OUTBOUND',
        type: data.type ?? 'CAMPAIGN',
        subject: data.subject,
        content: data.content,
        status: account ? 'SENT' : 'FAILED',
        sentBy: userId,
      },
    });

    return account ? { success: true as const } : { success: false as const, reason: 'NO_PORTAL_ACCOUNT' as const };
  }

  async sendPortalMessageBulk(data: {
    patientIds: string[];
    subject: string;
    content: string;
    type?: string;
  }, userId: string) {
    let sent = 0;
    let noAccount = 0;
    for (const pid of data.patientIds) {
      const r = await this.sendPortalMessage({ patientId: pid, subject: data.subject, content: data.content, type: data.type }, userId);
      if (r.success) sent++; else noAccount++;
    }
    return { sentCount: sent, notSentCount: noAccount, requested: data.patientIds.length };
  }
  // ── 캠페인 예약 발송 ──

  async scheduleCampaign(id: string, scheduledAt: Date) {
    const campaign = await this.prisma.crmCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('캠페인을 찾을 수 없습니다');
    if (campaign.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태에서만 예약 가능');

    return this.prisma.crmCampaign.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledAt },
    });
  }

  // ── 내부 헬퍼 ──

  private async getSegmentPatients(segmentId: string | null) {
    if (!segmentId) {
      return this.prisma.patient.findMany({
        where: { isDeceased: false, mergedIntoId: null },
        // 발송 변수치환용 필드 동봉 — 루프 내 개별 findUnique(N+1) 제거(2026-07 N+1 전수)
        select: { id: true, familyName: true, givenName: true, phone: true, email: true },
        take: 1000,
      });
    }

    const segment = await this.prisma.crmSegment.findUnique({ where: { id: segmentId } });
    if (!segment) return [];

    // 규칙 해석은 정본 하나로(발송·갱신·크론이 갈라져 조건이 무시되던 것 — 2026-08-13 W6)
    const { where, unsupportedKeys } = buildSegmentWhere(segment.rules);
    if (unsupportedKeys.length > 0) {
      // 🔴 해석하지 못한 조건이 있으면 **대상을 넓히지 않는다** — 조용히 전체 환자에게 나가는 것보다
      //    발송을 막는 편이 안전하다.
      throw new BadRequestException(
        `세그먼트 조건 중 지원하지 않는 항목이 있어 대상자를 확정할 수 없습니다: ${unsupportedKeys.join(', ')}`,
      );
    }

    return this.prisma.patient.findMany({
      where,
      select: { id: true, familyName: true, givenName: true, phone: true, email: true }, // N+1 제거용 필드 동봉
      take: 5000,
    });
  }

  private async countSegmentPatients(segmentId: string, rules: unknown) {
    const { where } = buildSegmentWhere(rules);
    return this.prisma.patient.count({ where });
  }
}
