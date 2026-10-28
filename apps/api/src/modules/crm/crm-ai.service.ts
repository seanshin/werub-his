import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readHospitalConfig } from '../config/hospital-facts';

@Injectable()
export class CrmAiService {
  private readonly logger = new Logger(CrmAiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 최적 발송 시간 추천
   * - 과거 캠페인 오픈율 분석 → 오픈율 높은 시간대 추천
   * - 기본값: 09:00~10:00 (한국), 현지 시간 고려 (해외)
   */
  async recommendSendTime(segmentId?: string): Promise<{
    recommendedHour: number;
    reason: string;
    hourlyStats: { hour: number; openRate: number; count: number }[];
  }> {
    // 시간대별 오픈율 분석
    const logs = await this.prisma.crmCampaignLog.findMany({
      where: { status: { in: ['SENT', 'DELIVERED', 'OPENED'] } },
      select: { sentAt: true, status: true },
      take: 5000,
      orderBy: { createdAt: 'desc' },
    });

    const hourlyMap = new Map<number, { sent: number; opened: number }>();
    for (let h = 8; h <= 20; h++) hourlyMap.set(h, { sent: 0, opened: 0 });

    for (const log of logs) {
      if (!log.sentAt) continue;
      const hour = log.sentAt.getHours();
      if (hour < 8 || hour > 20) continue;
      const bucket = hourlyMap.get(hour) || { sent: 0, opened: 0 };
      bucket.sent++;
      if (log.status === 'OPENED') bucket.opened++;
      hourlyMap.set(hour, bucket);
    }

    const hourlyStats = Array.from(hourlyMap.entries()).map(([hour, stats]) => ({
      hour,
      openRate: stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
      count: stats.sent,
    }));

    // 최적 시간 (가장 높은 오픈율, 최소 10건 이상)
    const significant = hourlyStats.filter(h => h.count >= 10);
    const best = significant.length > 0
      ? significant.reduce((a, b) => a.openRate > b.openRate ? a : b)
      : { hour: 9, openRate: 0 };

    return {
      recommendedHour: best.hour,
      reason: significant.length > 0
        ? `과거 데이터 분석 결과 ${best.hour}시 오픈율 ${best.openRate}%로 가장 높습니다`
        : '데이터 부족 — 기본 추천 시간 09:00',
      hourlyStats,
    };
  }

  /**
   * 세그먼트 자동 추천
   * - 캠페인 유형별 최적 타겟 세그먼트 추천
   */
  async recommendSegment(campaignType: string): Promise<{
    segments: { id: string; name: string; patientCount: number; reason: string }[];
  }> {
    const allSegments = await this.prisma.crmSegment.findMany({
      where: { isActive: true },
      orderBy: { patientCount: 'desc' },
    });

    const recommendations: { id: string; name: string; patientCount: number; reason: string }[] = [];

    for (const seg of allSegments) {
      const rules = seg.rules as Record<string, unknown>;
      let match = false;
      let reason = '';

      switch (campaignType) {
        case 'REENGAGEMENT':
          if (rules.churnRisk === 'HIGH' || rules.churnRisk === 'MEDIUM') {
            match = true;
            reason = '이탈 위험 환자 대상 — 재활성화에 적합';
          }
          if (rules.rfmSegment === 'CHURNED' || rules.rfmSegment === 'AT_RISK') {
            match = true;
            reason = 'RFM 이탈/위험 세그먼트 — 재방문 유도 적합';
          }
          break;

        case 'PROMOTION':
          if (rules.rfmSegment === 'LOYAL' || rules.rfmSegment === 'CHAMPION') {
            match = true;
            reason = '충성/챔피언 고객 — 프로모션 전환율 높음';
          }
          if (rules.tags && (rules.tags as string[]).includes('VIP')) {
            match = true;
            reason = 'VIP 고객 — 프리미엄 프로모션 타겟';
          }
          break;

        case 'REMINDER':
        case 'RECALL':
          if (rules.tags && (rules.tags as string[]).includes('검진')) {
            match = true;
            reason = '검진 대상 — 리마인더/리콜 적합';
          }
          break;

        case 'FOLLOW_UP':
          if (rules.nationality && rules.nationality !== 'KR') {
            match = true;
            reason = '해외 환자 — 사후관리 대상';
          }
          break;

        case 'SURVEY':
          match = true;
          reason = `${seg.patientCount}명 — 설문 대상`;
          break;
      }

      if (match) {
        recommendations.push({ id: seg.id, name: seg.name, patientCount: seg.patientCount, reason });
      }
    }

    // 추천 없으면 가장 큰 세그먼트 반환
    if (recommendations.length === 0 && allSegments.length > 0) {
      recommendations.push({
        id: allSegments[0].id,
        name: allSegments[0].name,
        patientCount: allSegments[0].patientCount,
        reason: '가장 큰 세그먼트 (기본 추천)',
      });
    }

    return { segments: recommendations };
  }

  /**
   * AI 캠페인 콘텐츠 생성
   * - 캠페인 유형 + 세그먼트 → 메시지 초안
   */
  async generateContent(data: {
    campaignType: string;
    channel: string;
    targetSegment?: string;
    locale?: string;
  }): Promise<{ subject: string; content: string; variables: string[] }> {
    const locale = data.locale || 'ko';
    // 🔴 대표전화는 정본 `hospital.phone`(DB 행만) — 종전엔 '02-1234-5678'(개발 플레이스홀더)을 환자에게 나갈 초안에 박았다.
    //    미설정이면 전화번호 문장을 빼고 만든다(번호를 지어내지 않는다). 조회 실패는 전파한다.
    const { 'hospital.phone': phone } = await readHospitalConfig(this.prisma, ['hospital.phone'] as const);
    const templates = this.getContentTemplates(data.campaignType, data.channel, locale, phone);

    return {
      subject: templates.subject,
      content: templates.content,
      variables: templates.variables,
    };
  }

  /**
   * `{{hospitalPhone}}` 은 캠페인 변수가 아니다 — 초안을 만들 때 정본 대표전화로 채운다(`variables` 에 싣지 않는다).
   * 대표전화가 미설정이면 그 문장이 없는 변형을 쓴다(자리표시자를 남기지도, 번호를 지어내지도 않는다).
   */
  private getContentTemplates(type: string, channel: string, locale: string, phone: string | null) {
    const isShort = channel === 'SMS' || channel === 'PUSH';
    const withPhone = (p: string, t: { subject: string; content: string; variables: string[] }) =>
      ({ ...t, content: t.content.split('{{hospitalPhone}}').join(p) });

    if (locale === 'ko') {
      switch (type) {
        case 'REMINDER':
          return isShort
            ? { subject: '예약 리마인더', content: '{{patientName}}님, {{appointmentDate}} {{department}} 예약이 있습니다. 내원 부탁드립니다.', variables: ['patientName', 'appointmentDate', 'department'] }
            : phone
              ? withPhone(phone, { subject: '진료 예약 안내', content: '안녕하세요, {{patientName}}님.\n\n{{appointmentDate}}에 {{department}} 진료가 예약되어 있습니다.\n\n변경이 필요하시면 ☎ {{hospitalPhone}}로 연락 부탁드립니다.\n\n감사합니다.', variables: ['patientName', 'appointmentDate', 'department'] })
              : { subject: '진료 예약 안내', content: '안녕하세요, {{patientName}}님.\n\n{{appointmentDate}}에 {{department}} 진료가 예약되어 있습니다.\n\n변경이 필요하시면 병원으로 연락 부탁드립니다.\n\n감사합니다.', variables: ['patientName', 'appointmentDate', 'department'] };

        case 'PROMOTION':
          return isShort
            ? { subject: '건강검진 프로모션', content: '[광고] {{patientName}}님, 프리미엄 건강검진 특별 할인! 지금 예약하세요. 수신거부: 포털>알림설정', variables: ['patientName'] }
            : { subject: '건강검진 특별 프로모션 안내', content: '안녕하세요, {{patientName}}님.\n\n이번 달 한정 프리미엄 건강검진 프로모션을 안내드립니다.\n\n지금 예약하시면 특별 할인이 적용됩니다.\n\n감사합니다.', variables: ['patientName'] };

        case 'REENGAGEMENT':
          return isShort
            ? phone
              ? withPhone(phone, { subject: '건강 안부', content: '{{patientName}}님, 건강은 안녕하세요? 정기 진료를 권장합니다. 예약: {{hospitalPhone}}', variables: ['patientName'] })
              : { subject: '건강 안부', content: '{{patientName}}님, 건강은 안녕하세요? 정기 진료를 권장합니다.', variables: ['patientName'] }
            : { subject: '건강 안부 인사', content: '안녕하세요, {{patientName}}님.\n\n마지막 방문 이후 시간이 지났습니다. 건강 관리를 위해 정기 진료를 권장드립니다.\n\n편하신 시간에 내원해 주세요.\n\n감사합니다.', variables: ['patientName'] };

        case 'SURVEY':
          return { subject: '진료 만족도 설문', content: '{{patientName}}님, 최근 진료 경험은 어떠셨나요? 30초 설문에 참여해 더 나은 서비스를 만들어주세요.', variables: ['patientName'] };

        default:
          return { subject: '안내', content: '{{patientName}}님, 안녕하세요.', variables: ['patientName'] };
      }
    }

    // 영어 (해외환자)
    switch (type) {
      case 'REMINDER':
        return { subject: 'Appointment Reminder', content: 'Dear {{patientName}}, this is a reminder for your appointment on {{appointmentDate}}.', variables: ['patientName', 'appointmentDate'] };
      case 'FOLLOW_UP':
        return { subject: 'Follow-up Care', content: 'Dear {{patientName}}, we hope you are doing well. Please let us know if you have any concerns about your recovery.', variables: ['patientName'] };
      default:
        return { subject: 'Notice', content: 'Dear {{patientName}}, thank you for choosing our hospital.', variables: ['patientName'] };
    }
  }
}
