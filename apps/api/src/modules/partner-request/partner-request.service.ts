import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { localDateTimeKey } from '../../common/day-range';
import { safeFetch } from '../../common/util/safe-fetch';
import { hashClientSecret } from '../smart-auth/smart-secret.util';
import { API_ACCESS_INSTRUMENTATION, apiAccessMeasurement, errorRateOf } from './api-access-instrumentation';

@Injectable()
export class PartnerRequestService {
  private readonly logger = new Logger('PartnerRequestService');

  constructor(private readonly prisma: PrismaService) {}

  async apply(dto: {
    orgName: string;
    orgType: string;
    orgCode?: string;
    country: string;
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    techContactName?: string;
    techContactEmail?: string;
    fhirBaseUrl?: string;
    purpose?: string[];
    requestedScopes?: string[];
    ipWhitelist?: string[];
    rateLimit?: number;
  }) {
    return this.prisma.partnerRequest.create({
      data: { ...dto, status: 'PENDING' },
    });
  }

  async getStatus(id: string) {
    const req = await this.prisma.partnerRequest.findUnique({
      where: { id },
      select: { status: true, reviewNote: true, createdAt: true },
    });
    if (!req) throw new NotFoundException('신청을 찾을 수 없습니다');
    return req;
  }

  async findAll(status?: string) {
    const where = status ? { status } : {};
    return this.prisma.partnerRequest.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const req = await this.prisma.partnerRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('신청을 찾을 수 없습니다');
    return req;
  }

  async review(id: string, status: string, reviewNote: string | undefined, reviewerId: string) {
    await this.findOne(id);
    return this.prisma.partnerRequest.update({
      where: { id },
      data: { status, reviewNote, reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  async approve(id: string, reviewerId: string, reviewNote?: string) {
    const req = await this.findOne(id);

    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex');

    // 🔴 (2026-09-16 I2) 기관·외부 앱 자격·신청 상태를 한 트랜잭션에서 쓴다. 종전엔 셋이 따로 나가
    //    중간에 실패하면 **scope 를 가진 SMART 클라이언트(외부 앱 접근 자격)는 만들어졌는데 신청은
    //    PENDING** 인 상태가 남았다 — 관리 화면 어디에도 안 보이는 자격이고, 다시 승인하면 기관·자격이
    //    한 벌 더 생긴다(고아 자격 + 중복 발급).
    const { org, client, updated } = await this.prisma.$transaction(async (tx) => {
      // 1. Organization 생성
      const createdOrg = await tx.organization.create({
        data: {
          code: req.orgCode ?? `PARTNER-${Date.now()}`,
          name: req.orgName,
          orgType: req.orgType,
          country: req.country,
          fhirEndpoint: req.fhirBaseUrl,
        },
      });

      // 2. SmartClient 생성 — 시크릿 해시 저장(평문 미보관) · 원문은 응답에서 1회만 반환
      const createdClient = await tx.smartClient.create({
        data: {
          clientId,
          clientSecret: hashClientSecret(clientSecret),
          name: `${req.orgName} Client`,
          orgId: createdOrg.id,
          scopes: req.requestedScopes ?? [],
        },
      });

      // 3. PartnerRequest 업데이트
      const updatedReq = await tx.partnerRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          // 승인 메모 — 화면이 보내는데 저장되지 않던 값(미전송 시 기존 메모 유지)
          ...(reviewNote !== undefined ? { reviewNote } : {}),
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          orgId: createdOrg.id,
          smartClientId: createdClient.id,
        },
      });
      return { org: createdOrg, client: createdClient, updated: updatedReq };
    });

    this.logger.log(`Partner request ${id} approved → org=${org.id}, client=${client.id}`);
    return { request: updated, organization: org, smartClient: { id: client.id, clientId, clientSecret } };
  }

  /** 파트너 연결 테스트 (FHIR metadata 호출) */
  async testConnection(id: string) {
    const req = await this.findOne(id);
    if (!req.fhirBaseUrl) {
      return { success: false, error: 'FHIR Base URL이 설정되지 않았습니다' };
    }

    try {
      const response = await safeFetch(`${req.fhirBaseUrl}/metadata`, {
        headers: { Accept: 'application/fhir+json' },
      }); // SSRF 검증(G2) — 사설/loopback 차단
      const data: any = await response.json().catch(() => null);
      return {
        success: response.ok,
        statusCode: response.status,
        fhirVersion: data?.fhirVersion ?? null,
        resourceCount: data?.rest?.[0]?.resource?.length ?? 0,
        responseTimeMs: Date.now(),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ═══════════════════════════════════════
  // 파트너 모니터링
  // ═══════════════════════════════════════

  /**
   * 전체 모니터링 통계.
   *
   * 🔴 `ApiAccessLog` 를 **쓰는 코드가 저장소에 없다**(운영 실측 0행). 그런데 종전 코드는
   *    `errorRate = total > 0 ? … : 0` 으로 항상 0 을 냈고, 화면은 초록 "에러율 0.0%"와
   *    "알림 없음"을 영원히 보여줬다 — 파트너 연동이 전부 죽어도 똑같이 초록이다.
   *    **측정하지 않은 것은 0 이 아니라 '측정되지 않음'** 이다(P17·P1). 규약: `api-access-instrumentation.ts`.
   */
  async getMonitoringStats() {
    const measurement = apiAccessMeasurement();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // 실제로 측정되고 있는 값 — 계측 배선과 무관하게 참이다.
    const [activePartners, transfersThisMonth] = await Promise.all([
      this.prisma.smartClient.count({ where: { isActive: true } }),
      // 🔴 종전 하드코딩 0. TransferRecord 는 실제로 쓰이는 테이블이므로 세어서 말한다.
      this.prisma.transferRecord.count({ where: { requestedAt: { gte: monthStart } } }),
    ]);

    if (!measurement.measured) {
      // 계측이 없으므로 호출·에러·응답시간은 **산출 불가**(null). 0 으로 내려보내지 않는다.
      return {
        measurement,
        totalCalls: null, todayCalls: null, errorCalls: null, errorRate: null, avgResponseTime: null,
        activePartners,
        transfersThisMonth,
        partnerTraffic: [],
        recentAlerts: [],
      };
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalCalls, errorCalls, avgResponseTime, recentAlerts] = await Promise.all([
      this.prisma.apiAccessLog.count(),
      this.prisma.apiAccessLog.count({ where: { statusCode: { gte: 400 } } }),
      this.prisma.apiAccessLog.aggregate({ _avg: { responseTime: true } }),
      this.prisma.apiAccessLog.findMany({
        where: { statusCode: { gte: 500 }, createdAt: { gte: since24h } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    // FE 호환: partnerTraffic 집계 — 기관별 호출·에러를 **같은 창(24h)** 에서 함께 센다.
    const [trafficRaw, errorRaw] = await Promise.all([
      this.prisma.apiAccessLog.groupBy({ by: ['orgId'], _count: true, where: { createdAt: { gte: since24h } } }),
      this.prisma.apiAccessLog.groupBy({ by: ['orgId'], _count: true, where: { createdAt: { gte: since24h }, statusCode: { gte: 400 } } }),
    ]);
    const errMap = Object.fromEntries(errorRaw.map((e) => [e.orgId ?? '', e._count]));
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: trafficRaw.map(t => t.orgId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));
    const partnerTraffic = trafficRaw
      .filter(t => t.orgId)
      // 🔴 종전 `errorRate: 0` 하드코딩 — 기관별 에러율을 재본 적 없이 전부 초록으로 그렸다.
      .map(t => ({ orgName: orgMap[t.orgId!] ?? t.orgId, calls: t._count, errorRate: errorRateOf(t._count, errMap[t.orgId!] ?? 0) }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    return {
      measurement,
      totalCalls,
      todayCalls: totalCalls,
      errorCalls,
      errorRate: errorRateOf(totalCalls, errorCalls),
      // 🔴 (2026-09-21 H) 종전 `?? 0` — 호출은 있는데 `responseTime` 이 **한 건도 기록되지 않은**
      //    경우(Prisma `_avg` 는 그때 `null` 을 준다) 화면이 "평균 0ms" 라고 말했다.
      //    0ms 는 가능한 값이 아니라 **가장 빠른 값**이라, 미계측이 최고 성능으로 읽혔다.
      avgResponseTime: avgResponseTime._avg.responseTime != null ? Math.round(avgResponseTime._avg.responseTime) : null,
      activePartners,
      transfersThisMonth,
      partnerTraffic,
      recentAlerts: recentAlerts.map(a => ({
        message: `${a.path} → ${a.statusCode} ${a.errorMessage ?? ''}`.trim(),
        level: a.statusCode >= 500 ? 'CRITICAL' : 'WARNING',
        time: localDateTimeKey(a.createdAt),
      })),
    };
  }

  /** 기관별 상세 모니터링 */
  async getOrgMonitoring(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('기관을 찾을 수 없습니다');

    const measurement = apiAccessMeasurement();
    if (!measurement.measured) {
      // 🔴 계측 미배선 — 기관별 호출·에러도 '0' 이 아니라 '산출 불가'다.
      return {
        organization: { id: org.id, name: org.name, code: org.code },
        measurement,
        totalCalls: null, errorCalls: null, errorRate: null, avgResponseTime: null, dailyCalls: null,
      };
    }

    const [totalCalls, errorCalls, avgResponseTime, callsByDay] = await Promise.all([
      this.prisma.apiAccessLog.count({ where: { orgId } }),
      this.prisma.apiAccessLog.count({ where: { orgId, statusCode: { gte: 400 } } }),
      this.prisma.apiAccessLog.aggregate({ where: { orgId }, _avg: { responseTime: true } }),
      this.prisma.apiAccessLog.groupBy({
        by: ['createdAt'],
        where: { orgId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        _count: true,
      }),
    ]);

    return {
      organization: { id: org.id, name: org.name, code: org.code },
      measurement,
      totalCalls,
      errorCalls,
      errorRate: errorRateOf(totalCalls, errorCalls),
      // 🔴 위와 같은 이유 — 미계측(`_avg` 가 null)을 0ms 로 번역하지 않는다.
      avgResponseTime: avgResponseTime._avg.responseTime != null ? Math.round(avgResponseTime._avg.responseTime) : null,
      dailyCalls: callsByDay.length,
    };
  }

  /** 기관별 호출 이력 — 목록이 비어도 '호출 없음'이 아니라 '미계측'일 수 있다. */
  async getOrgLogs(orgId: string, page = 1, limit = 50) {
    const measurement = apiAccessMeasurement();
    if (!measurement.measured) return { logs: [], total: null, page, limit, measurement };
    const [logs, total] = await Promise.all([
      this.prisma.apiAccessLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.apiAccessLog.count({ where: { orgId } }),
    ]);
    return { logs, total, page, limit, measurement };
  }

  /**
   * 이상 감지 알림.
   * 🔴 계측이 없으면 "알림 없음"은 **연동이 건강하다는 뜻이 아니다** — 아무것도 보고 있지 않은 것이다.
   */
  async getAlerts() {
    const measurement = apiAccessMeasurement();
    if (!measurement.measured) return { alerts: [], recentErrors: [], measurement };
    // 최근 24시간 내 에러율 급증 기관 탐지
    const recentErrors = await this.prisma.apiAccessLog.findMany({
      where: {
        statusCode: { gte: 400 },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { orgId: true, clientId: true, statusCode: true, path: true, errorMessage: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 기관별 에러 집계
    const orgErrors: Record<string, number> = {};
    for (const e of recentErrors) {
      if (e.orgId) orgErrors[e.orgId] = (orgErrors[e.orgId] ?? 0) + 1;
    }

    const alerts = Object.entries(orgErrors)
      .filter(([, count]) => count >= 3) // 3건 이상 에러
      .map(([orgId, count]) => ({
        type: 'ERROR_SPIKE',
        orgId,
        count,
        severity: count >= 10 ? 'CRITICAL' : count >= 5 ? 'WARNING' : 'INFO',
        message: `24시간 내 ${count}건 에러 발생`,
        detectedAt: new Date().toISOString(),
      }));

    return { alerts, recentErrors: recentErrors.slice(0, 20), measurement };
  }
}

// 계측 배선 선언 재수출 — 스펙/화면이 같은 정본을 참조한다(P12 방지).
export { API_ACCESS_INSTRUMENTATION };
