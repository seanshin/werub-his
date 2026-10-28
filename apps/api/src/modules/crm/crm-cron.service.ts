import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CrmChannelService } from './crm-channel.service';
import { buildSegmentWhere } from './segment-rules';
import { CRM_OUTBOUND_JOBS as J } from './crm-reminder-jobs';
import { localeTimeText } from '@hospital-run/shared';

@Injectable()
export class CrmCronService {
  private readonly logger = new Logger(CrmCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channel: CrmChannelService,
  ) {}


  /**
   * 🔴 발송 시도 ≠ 도달 — 2026-08-14(W6).
   *
   * 리마인더 크론 4종(예약 D-1·검진 D-7/D-1·치과 리콜)은 **채널을 한 번도 부르지 않고**
   * `PatientCommunicationLog` 에 `status:'SENT'` 만 적었다. SMS·PUSH 제공자는 아직
   * 붙어 있지도 않다. 그래서 CRM 이력 화면은 환자에게 **가지 않은 문자를 '발송 완료'**
   * 로 보여줬고, 로그도 "N건 발송"이라고 말했다. 환자가 "연락 못 받았다"고 하면
   * 기록이 환자를 반박한다.
   *
   * 실제로 보내고, **나간 대로 적는다** — 미구현 채널이나 SMTP 미설정은 `SIMULATED`.
   */
  private async deliver(args: {
    patientId: string;
    channel: string;
    to: string | null | undefined;
    type: string;
    subject: string;
    content: string;
  }): Promise<'SENT' | 'SIMULATED' | 'FAILED'> {
    let status: 'SENT' | 'SIMULATED' | 'FAILED';
    if (!args.to) {
      // 연락처가 없으면 보낼 수 없다 — '발송'으로 적지 않는다.
      status = 'FAILED';
    } else {
      const r = await this.channel
        .send(args.channel, args.to, args.subject, args.content)
        .catch(() => ({ success: false, simulated: false }));
      status = !r.success ? 'FAILED' : r.simulated ? 'SIMULATED' : 'SENT';
    }

    await this.prisma.patientCommunicationLog.create({
      data: {
        patientId: args.patientId,
        channel: args.channel,
        direction: 'OUTBOUND',
        type: args.type,
        subject: args.subject,
        content: args.content,
        status,
      },
    });
    return status;
  }

  // ── 1. 예약 리마인더 D-1 (매일 09:00) ──
  @Cron(J.appointment.cron, { name: J.appointment.key })
  async appointmentReminder() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        scheduledAt: { gte: tomorrow, lt: dayAfter },
        status: 'SCHEDULED',
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, phone: true } },
        doctor: { select: { department: true } },
      },
    });

    const tally = { SENT: 0, SIMULATED: 0, FAILED: 0 };
    for (const apt of appointments) {
      const time = localeTimeText(apt.scheduledAt, 'ko-KR', { hour: '2-digit', minute: '2-digit' });
      const status = await this.deliver({
        patientId: apt.patient.id,
        channel: 'PUSH',
        to: apt.patient.phone,
        type: J.appointment.logType,
        subject: J.appointment.subjects[0],
        content: `${apt.patient.familyName}${apt.patient.givenName}님, 내일 ${time} ${apt.doctor.department ?? ''} 예약이 있습니다.`,
      });
      tally[status]++;
    }

    if (appointments.length > 0) {
      this.logger.log(`[예약 리마인더] 대상 ${appointments.length} — 발송 ${tally.SENT} · 미발송(채널 미구현) ${tally.SIMULATED} · 실패 ${tally.FAILED}`);
    }
  }

  // ── 2. 검진 리마인더 D-7 (매일 09:30) ──
  @Cron(J.checkup.cron, { name: J.checkup.key })
  async checkupReminder() {
    const now = new Date();
    const d7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const d1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // D-7 리마인더
    const d7Targets = await this.prisma.checkupFollowUp.findMany({
      where: {
        dueDate: {
          gte: new Date(d7.toISOString().slice(0, 10)),
          lt: new Date(new Date(d7.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
        },
        completedAt: null,
        reminderSent: false,
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true , phone: true } },
      },
    });

    const tally = { SENT: 0, SIMULATED: 0, FAILED: 0 };
    for (const fu of d7Targets) {
      tally[await this.deliver({
        patientId: fu.patient.id,
        channel: 'SMS',
        to: fu.patient.phone,
        type: J.checkup.logType,
        subject: J.checkup.subjects[0],
        content: `${fu.patient.familyName}${fu.patient.givenName}님, 재검진 예정일이 일주일 앞입니다. 예약을 확인해주세요.`,
      })]++;
    }

    // D-1 리마인더
    const d1Targets = await this.prisma.checkupFollowUp.findMany({
      where: {
        dueDate: {
          gte: new Date(d1.toISOString().slice(0, 10)),
          lt: new Date(new Date(d1.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
        },
        completedAt: null,
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, phone: true } },
      },
    });

    for (const fu of d1Targets) {
      const status = await this.deliver({
        patientId: fu.patient.id,
        channel: 'PUSH',
        to: fu.patient.phone,
        type: J.checkup.logType,
        subject: J.checkup.subjects[1],
        content: `${fu.patient.familyName}${fu.patient.givenName}님, 내일 재검진 예정입니다. 공복 유지를 잊지 마세요.`,
      });
      tally[status]++;
      // 🔴 나가지 않았으면 '리마인더 보냄' 표시를 세우지 않는다 — 세우면 다시는 안 보낸다.
      if (status === 'SENT') {
        await this.prisma.checkupFollowUp.update({ where: { id: fu.id }, data: { reminderSent: true } });
      }
    }

    const total = d7Targets.length + d1Targets.length;
    if (total > 0) {
      this.logger.log(`[검진 리마인더] 대상 D-7 ${d7Targets.length} · D-1 ${d1Targets.length} — 발송 ${tally.SENT} · 미발송(채널 미구현) ${tally.SIMULATED} · 실패 ${tally.FAILED}`);
    }
  }

  // ── 3. 치과 리콜 D-14 (매일 10:00) ──
  @Cron(J.dental.cron, { name: J.dental.key })
  async dentalRecall() {
    const d14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const nextDay = new Date(d14.getTime() + 24 * 60 * 60 * 1000);

    const recalls = await this.prisma.dentalRecall.findMany({
      where: {
        scheduledDate: { gte: d14, lt: nextDay },
        status: 'SCHEDULED',
      },
    });

    const tally = { SENT: 0, SIMULATED: 0, FAILED: 0 };
    for (const r of recalls) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: r.patientId },
        select: { id: true, familyName: true, givenName: true, phone: true },
      });
      if (!patient) continue;

      tally[await this.deliver({
        patientId: patient.id,
        channel: 'SMS',
        to: patient.phone,
        type: J.dental.logType,
        subject: J.dental.subjects[0],
        content: `${patient.familyName}${patient.givenName}님, 정기 치과 검진 시기입니다. 예약을 권장합니다.`,
      })]++;
    }

    if (recalls.length > 0) {
      this.logger.log(`[치과 리콜] 대상 ${recalls.length} — 발송 ${tally.SENT} · 미발송(채널 미구현) ${tally.SIMULATED} · 실패 ${tally.FAILED}`);
    }
  }

  // ── 4. 이탈 감지 (매주 월요일 06:00) ──
  @Cron('0 6 * * 1', { name: 'crm-churn-detection' })
  async churnDetection() {
    const now = Date.now();
    const d90 = new Date(now - 90 * 24 * 60 * 60 * 1000);
    const d180 = new Date(now - 180 * 24 * 60 * 60 * 1000);

    // 활성 환자만
    const patients = await this.prisma.patient.findMany({
      where: { isDeceased: false, mergedIntoId: null },
      select: { id: true },
    });

    // 환자별 마지막 진료일 — 단일 groupBy(per-patient findFirst N+1 제거)
    const lastByPatient = await this.prisma.encounter.groupBy({
      by: ['patientId'],
      _max: { createdAt: true },
    });
    const lastMap = new Map(lastByPatient.map((g) => [g.patientId, g._max.createdAt]));

    // 분류(기존 로직 동일): 마지막 진료 없음/180일 초과=HIGH(기존 d365 분기는 d180 HIGH에 포함),
    //   90~180일=MEDIUM, 90일 이내=LOW.
    const high: string[] = [], medium: string[] = [], low: string[] = [];
    for (const p of patients) {
      const last = lastMap.get(p.id);
      if (!last || last < d180) high.push(p.id);
      else if (last < d90) medium.push(p.id);
      else low.push(p.id);
    }

    await this.bulkSetChurn(high, 'HIGH');
    await this.bulkSetChurn(medium, 'MEDIUM');
    await this.bulkSetChurn(low, 'LOW');

    this.logger.log(`[이탈 감지] HIGH: ${high.length}, MEDIUM: ${medium.length}, LOW: ${low.length} / 전체 ${patients.length}`);
  }

  // churnRisk 일괄 갱신 — IN 절 파라미터 한계 회피 위해 1000개씩 청크.
  private async bulkSetChurn(ids: string[], risk: string) {
    for (let i = 0; i < ids.length; i += 1000) {
      await this.prisma.patient.updateMany({
        where: { id: { in: ids.slice(i, i + 1000) } },
        data: { churnRisk: risk },
      });
    }
  }

  // ── 5. RFM 자동 계산 (매주 월요일 07:00) ──
  @Cron('0 7 * * 1', { name: 'crm-rfm-calculation' })
  async rfmCalculation() {
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const patients = await this.prisma.patient.findMany({
      where: { isDeceased: false, mergedIntoId: null },
      select: { id: true },
    });

    // R/F/M 사전계산 — 3개 groupBy(per-patient 3쿼리 N+1 제거)
    const [recency, freq, monetary] = await Promise.all([
      // Recency: 마지막 방문일(전체 기간 최신 — findFirst desc 와 동일)
      this.prisma.encounter.groupBy({ by: ['patientId'], _max: { createdAt: true } }),
      // Frequency: 1년 내 방문 횟수
      this.prisma.encounter.groupBy({ by: ['patientId'], _count: true, where: { createdAt: { gte: oneYearAgo } } }),
      // Monetary: 1년 내 총 수납액
      this.prisma.billing.groupBy({ by: ['patientId'], _sum: { totalAmount: true }, where: { createdAt: { gte: oneYearAgo } } }),
    ]);
    const lastMap = new Map(recency.map((g) => [g.patientId, g._max.createdAt]));
    const freqMap = new Map(freq.map((g) => [g.patientId, g._count]));
    const moneyMap = new Map(monetary.map((g) => [g.patientId, Number(g._sum.totalAmount ?? 0)]));

    // (crmScore, rfmSegment) 조합별로 묶어 updateMany — per-patient 계산은 기존과 동일.
    const buckets = new Map<string, { score: number; segment: string; ids: string[] }>();
    for (const p of patients) {
      const lastVisit = lastMap.get(p.id) ?? null;
      const frequency = freqMap.get(p.id) ?? 0;
      const totalAmount = moneyMap.get(p.id) ?? 0;

      // 점수 계산 (각 1~5)
      const daysSinceVisit = lastVisit
        ? Math.floor((now.getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000))
        : 999;

      const r = daysSinceVisit <= 30 ? 5 : daysSinceVisit <= 90 ? 4 : daysSinceVisit <= 180 ? 3 : daysSinceVisit <= 365 ? 2 : 1;
      const f = frequency >= 12 ? 5 : frequency >= 6 ? 4 : frequency >= 3 ? 3 : frequency >= 1 ? 2 : 1;
      const m = totalAmount >= 5000000 ? 5 : totalAmount >= 2000000 ? 4 : totalAmount >= 500000 ? 3 : totalAmount >= 100000 ? 2 : 1;

      // 세그먼트 분류
      const score = Math.round((r + f + m) / 3 * 20); // 0~100
      let segment = 'NEW';
      // 방문 이력 전무 = 신규(이탈 아님) — 우선 분류. 아래 r<=2&&f<=2 CHURNED보다 앞에 둬야
      // 가입만 하고 첫 방문 전인 환자가 CHURNED로 오분류(이탈방지 캠페인 오발송)되지 않음
      if (frequency === 0 && !lastVisit) segment = 'NEW';
      else if (r >= 4 && f >= 4 && m >= 4) segment = 'CHAMPION';
      else if (r >= 4 && f >= 3) segment = 'LOYAL';
      else if (r >= 4 && m >= 4) segment = 'POTENTIAL';
      else if (r <= 2 && f >= 3) segment = 'AT_RISK';
      else if (r <= 2 && f <= 2) segment = 'CHURNED';
      else if (frequency <= 1) segment = 'NEW';

      const key = `${score}|${segment}`;
      const b = buckets.get(key);
      if (b) b.ids.push(p.id);
      else buckets.set(key, { score, segment, ids: [p.id] });
    }

    let updated = 0;
    for (const { score, segment, ids } of buckets.values()) {
      for (let i = 0; i < ids.length; i += 1000) {
        await this.prisma.patient.updateMany({
          where: { id: { in: ids.slice(i, i + 1000) } },
          data: { crmScore: score, rfmSegment: segment },
        });
      }
      updated += ids.length;
    }

    this.logger.log(`[RFM] ${updated}명 계산 완료`);
  }

  // ── 6. 세그먼트 환자 수 자동 갱신 (매일 05:00) ──
  @Cron('0 5 * * *', { name: 'crm-segment-refresh' })
  async segmentAutoRefresh() {
    const segments = await this.prisma.crmSegment.findMany({
      where: { isActive: true },
    });

    for (const seg of segments) {
      // 규칙 해석 정본 — 크론만 rfmSegment 를 알아 화면 '갱신'과 결과가 갈리던 것 해소(W6)
      const { where } = buildSegmentWhere(seg.rules);
      const count = await this.prisma.patient.count({ where });

      await this.prisma.crmSegment.update({
        where: { id: seg.id },
        data: { patientCount: count, lastRefreshedAt: new Date() },
      });
    }

    if (segments.length > 0) this.logger.log(`[세그먼트] ${segments.length}개 갱신`);
  }

  // ── 7. 해외환자 사후관리 자동 발송 (매일 11:00) ──
  /**
   * 🔴 W6 봉합에서 이 경로만 빠져 있었다(2026-08-14 W8).
   *
   * 리마인더 4종은 `deliver()` 로 모아 **나간 대로** 적게 고쳤는데, 해외환자 사후관리
   * 4경로(D+1·D+7·D+30·D+180)는 `logComm()` 이라는 **두 번째 기록 경로**를 그대로 써서
   * `status:'SENT'` 를 무조건 찍었다. 채널 결과를 아예 보지도 않았다.
   * WHATSAPP·WECHAT 제공자는 스텁(`crm-channel.service.ts`)이라 **실발송 0인데 전건 '발송 완료'**.
   * 게다가 수신처로 `c.patient.email || c.patient.id` 를 넘겨 **환자 UUID 를 WhatsApp 번호로**
   * 보내고 있었다(연락처가 없다는 사실이 UUID 로 가려졌다).
   * → 리마인더와 **같은 `deliver()`** 를 쓴다: 성공=SENT · 미구현 채널=SIMULATED ·
   *   연락처 없음/실패=FAILED. 판정 로직을 새로 만들지 않는다(세 번째 정본 금지).
   */
  @Cron(J.foreign.cron, { name: J.foreign.key })
  async foreignPatientFollowUp() {
    const now = new Date();
    const tally = { SENT: 0, SIMULATED: 0, FAILED: 0 };

    // DISCHARGED 상태 케이스 → 사후관리 자동 전이 + 연락
    const cases = await this.prisma.crmForeignPatientCase.findMany({
      where: { status: { in: ['DISCHARGED', 'FOLLOW_UP'] } },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true, nameEn: true, email: true, phone: true, preferredLanguage: true } },
      },
    });

    for (const c of cases) {
      const daysSinceUpdate = Math.floor((now.getTime() - c.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
      const name = c.patient.nameEn || `${c.patient.familyName}${c.patient.givenName}`;
      const lang = c.interpreterLang || c.patient.preferredLanguage || 'en';
      const ch = this.channel.getChannelForLanguage(lang);
      // WhatsApp·WeChat 수신처는 전화번호다 — 없으면 없는 것이다(환자 UUID 로 대체하지 않는다).
      const im = c.patient.phone;
      const run = async (channel: string, to: string | null | undefined, subject: string, content: string) => {
        const s = await this.deliver({ patientId: c.patient.id, channel, to, type: J.foreign.logType, subject, content });
        tally[s]++;
      };

      // D+1: 만족도 설문
      if (c.status === 'DISCHARGED' && daysSinceUpdate === 1) {
        await this.prisma.crmForeignPatientCase.update({ where: { id: c.id }, data: { status: 'FOLLOW_UP' } });
        await run(ch, im, J.foreign.subjects[0],
          `Dear ${name}, thank you for visiting our hospital. Please share your experience.`);
      }

      // D+7: 결과 요약 이메일
      if (c.status === 'FOLLOW_UP' && daysSinceUpdate >= 7 && daysSinceUpdate < 8) {
        const html = this.channel.renderEmailTemplate(
          'Your Medical Report Summary',
          `<p>Dear ${name},</p><p>Your medical report summary is now available. Please contact us if you have any questions.</p>`,
        );
        await run('EMAIL', c.patient.email, J.foreign.subjects[1], html);
      }

      // D+30: Follow-up 연락
      if (c.status === 'FOLLOW_UP' && daysSinceUpdate >= 30 && daysSinceUpdate < 31) {
        await run(ch, im, J.foreign.subjects[2],
          `Dear ${name}, we hope you are doing well. How is your recovery?`);
      }

      // D+180: 재방문 유도
      if (c.status === 'FOLLOW_UP' && daysSinceUpdate >= 180 && daysSinceUpdate < 181) {
        await run(ch, im, J.foreign.subjects[3],
          `Dear ${name}, it's been 6 months. We recommend an annual health checkup.`);
      }
    }

    const total = tally.SENT + tally.SIMULATED + tally.FAILED;
    if (total > 0) {
      this.logger.log(`[해외환자 사후관리] 발송 ${tally.SENT} · 미전송(제공자 없음) ${tally.SIMULATED} · 실패 ${tally.FAILED}`);
    }
    return tally;
  }
}
