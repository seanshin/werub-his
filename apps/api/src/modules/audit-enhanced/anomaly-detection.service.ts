import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { dayRange } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ZERO_UUID } from '../audit/audit-routes';
import { vipFlagWhere } from './vip-canonical';

export interface AnomalyAlert {
  type: 'BULK_ACCESS' | 'AFTER_HOURS' | 'VIP_ACCESS';
  userId: string;
  message: string;
  detectedAt: Date;
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);
  /** VIP 열람 스캔 커서 — 같은 열람으로 매 주기 반복 경보하지 않기 위한 것(거짓 경보는 진짜 경보를 죽인다) */
  private lastVipScanAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async checkBulkAccess(userId: string): Promise<AnomalyAlert | null> {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    // 열람 감사는 대상 환자(resourceId)에 귀속되므로 도메인(resourceType) 무관하게 집계한다.
    // 종전 `resourceType: 'Patient'` 고정은 환자 기본정보 조회만 세어, 차트·검사결과 대량 열람을 놓쳤음.
    const count = await this.prisma.auditLog.groupBy({
      by: ['resourceId'],
      where: {
        userId,
        action: 'READ',
        resourceId: { not: ZERO_UUID }, // 대상 미특정 조회는 '환자 수'에 넣지 않음
        timestamp: { gte: oneHourAgo },
      },
    });

    if (count.length >= 10) {
      return {
        type: 'BULK_ACCESS',
        userId,
        message: `1시간 내 ${count.length}명 환자 기록 열람 감지`,
        detectedAt: new Date(),
      };
    }
    return null;
  }

  /**
   * 🔴 W8 — 두 가지가 동시에 고장나 있었다.
   *  ① 읽는 곳이 `vip_patients`(0행) 였다 — 화면이 찍는 정본(`patient_flags` flagType='VIP')과 달라
   *     **어떤 VIP 를 지정해도 경보가 걸릴 수 없었다**. → 정본 조건식 `vipFlagWhere` 로 통일.
   *  ② 이 함수를 **아무도 호출하지 않았다**(있는 줄 알았던 통제가 없었다). → 아래
   *     `detectVipAccess()` 를 주기 점검에 배선했다.
   */
  async checkVipAccess(patientId: string, userId: string): Promise<AnomalyAlert | null> {
    const vip = await this.prisma.patientFlag.count({ where: vipFlagWhere(patientId) });
    if (vip > 0) {
      return {
        type: 'VIP_ACCESS',
        userId,
        message: `VIP 환자 기록 접근 감지 (patientId: ${patientId})`,
        detectedAt: new Date(),
      };
    }
    return null;
  }

  /**
   * VIP 열람 감지(배치) — 감사 로그의 열람(READ)에서 **VIP 로 표식된 환자** 대상 건을 찾는다.
   * 열람 감사는 대상 환자(resourceId=patientId)에 귀속된다(`audit-routes.ts` 규약).
   * `since` 이후분만 보고, (직원·환자) 쌍당 1건으로 줄인다 — 같은 열람을 매 주기 다시 알리면
   * 경보가 소음이 되어 진짜 경보를 죽인다.
   */
  async detectVipAccess(since: Date): Promise<AnomalyAlert[]> {
    const vipFlags = await this.prisma.patientFlag.findMany({
      where: vipFlagWhere(),
      select: { patientId: true },
    });
    const vipIds = [...new Set(vipFlags.map((f) => f.patientId))];
    if (vipIds.length === 0) return []; // 지정된 VIP 가 없다 = 감지 대상 없음(경보 0건이 사실)

    const reads = await this.prisma.auditLog.findMany({
      where: { action: 'READ', resourceId: { in: vipIds }, timestamp: { gte: since } },
      select: { userId: true, resourceId: true, timestamp: true },
      take: 500,
    });

    const seen = new Set<string>();
    const alerts: AnomalyAlert[] = [];
    for (const r of reads) {
      const key = `${r.userId}:${r.resourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      alerts.push({
        type: 'VIP_ACCESS',
        userId: r.userId,
        message: `VIP 환자 기록 접근 감지 (patientId: ${r.resourceId})`,
        detectedAt: r.timestamp,
      });
    }
    return alerts;
  }

  async checkAfterHoursAccess(userId: string): Promise<AnomalyAlert | null> {
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 6) {
      return {
        type: 'AFTER_HOURS',
        userId,
        message: `비근무 시간(${hour}시) 접근 감지`,
        detectedAt: new Date(),
      };
    }
    return null;
  }

  /**
   * 🔴 2026-08-14(W7) 수리 — 날짜 경계와 커버리지.
   *
   * ① `new Date('2026-08-13')` 은 **항상 UTC 자정**이라(pm2 TZ 와 무관) 같은 날짜를
   *    `gte`/`lte` 로 넣으면 **폭이 0 인 구간**이 됐다. 실측: `?dateFrom=2026-08-13&
   *    dateTo=2026-08-13` → 총 접근 **0**, 그날 실제 감사 로그는 **21건**.
   *    감사 화면이 "그날 아무도 환자 기록을 열지 않았다"고 말했다.
   * ② 상한이 `lte: 자정` 이라 **끝나는 날 하루가 통째로 빠졌다** → `lt: 다음날 자정`.
   * ③ BTG 카드만 `dateTo` 를 무시해 옆 목록과 분모가 달랐다 → 같은 구간 적용.
   * ④ **SMART 앱 접근이 통째로 빠져 있었다** — SMART 토큰은 주체가 클라이언트라
   *    AuditLog(User FK)에 담기지 않고 `SmartAccessLog` 에 따로 쌓인다. 같은 창에서
   *    AuditLog 130건 / SmartAccessLog **12,078건** — 화면은 실제 접근의 **1.1%** 만
   *    보여주면서 그것을 '총 접근'이라 불렀다. 별도 축으로 함께 내보낸다.
   *
   * 🔴 W8 추가 — ④ 는 이 대시보드에서만 고쳐져 **`/admin/audit`(감사 로그) 화면과 분모가 갈라졌다**
   *    (실측: SmartAccessLog 27,102건을 그 화면은 통째로 누락, 리소스 유형도 상위 10종만 노출해
   *    나머지 94종은 필터조차 불가). 새 병합 로직을 또 만들면 세 번째 정본이 되므로,
   *    **두 화면이 이 함수 하나를 쓰도록** `last24h`(양 채널)·리소스 전량을 여기서 함께 낸다.
   */
  async getDashboardStats(dateFrom?: string, dateTo?: string) {
    const range = dayRange(dateFrom, dateTo);
    const where: Prisma.AuditLogWhereInput = range ? { timestamp: range } : {};
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalAccess, byAction, byResource, btgCount, smartAccess, smartPatientScoped,
      last24hAudit, last24hSmart, vipDesignated,
    ] = await Promise.all([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.groupBy({ by: ['action'], where, _count: true }),
        this.prisma.auditLog.groupBy({ by: ['resourceType'], where, _count: true }),
        this.prisma.breakTheGlassAccess.count({
          where: range ? { accessedAt: range } : undefined,
        }),
        // 🔴 형제 카운트(auditLog·breakTheGlass·patientFlag)는 실패를 전파한다. SMART 접근만
        //    `.catch(() => 0)` 로 삼키면, smartAccessLog 조회가 특정하게 실패했을 때 보안 대시보드가
        //    외부 앱 접근을 **0으로 undercount**(실제보다 덜 위험하게) 말한다 — SmartAccessLog 는
        //    표준 모델이라 항상 존재하고, DB 가 넓게 죽으면 형제 count 가 어차피 던진다. 형제처럼 전파한다.
        this.prisma.smartAccessLog.count({ where: range ? { at: range } : {} }),
        this.prisma.smartAccessLog
          .count({ where: { ...(range ? { at: range } : {}), patientId: { not: null } } }),
        // 최근 24시간은 조회 구간과 무관한 '지금 기준' 지표다(구간을 좁혀도 같은 값).
        this.prisma.auditLog.count({ where: { timestamp: { gte: since24h } } }),
        this.prisma.smartAccessLog.count({ where: { at: { gte: since24h } } }),
        this.prisma.patientFlag.count({ where: vipFlagWhere() }),
      ]);

    // 리소스 유형은 대소문자가 섞여 저장돼 같은 것이 두 줄로 갈라졌다(PRESCRIPTION 8 / Prescription 43).
    const resourceAcc = new Map<string, number>();
    for (const r of byResource) {
      const key = String(r.resourceType ?? '(미지정)');
      const norm = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
      resourceAcc.set(norm, (resourceAcc.get(norm) ?? 0) + r._count);
    }

    return {
      totalAccess,
      byAction: byAction.map(a => ({ action: a.action, count: a._count })),
      byResource: [...resourceAcc.entries()]
        .map(([resource, count]) => ({ resource, count }))
        .sort((a, b) => b.count - a.count),
      btgCount,
      /** 🔴 외부 SMART 앱 접근 — AuditLog 에 담기지 않는 별도 축 */
      smartAccess,
      smartPatientScoped,
      totalAccessAllChannels: totalAccess + smartAccess,
      /** 최근 24시간(조회 구간 무관·양 채널) — 감사 로그 화면과 대시보드가 같은 값을 쓴다 */
      last24hAudit,
      last24hSmart,
      last24hAllChannels: last24hAudit + last24hSmart,
      /**
       * VIP 접근 경보 관제 — 정본은 `patient_flags(flagType='VIP')` 하나(vip-canonical.ts).
       * `vipAlertInstrumented` 는 "감지가 실제로 배선되어 있는가"다. 지정 0명이면 경보 0건은
       * '이상 없음'이 아니라 **'감시 대상이 없음'** 이므로 화면이 구분해 말할 수 있게 함께 낸다.
       */
      vipDesignated,
      vipAlertInstrumented: true,
      /**
       * 🔴 Break-the-Glass 가드가 **어느 컨트롤러에도 붙어 있지 않다**(provider 등록만).
       * 즉 "BTG 0건"은 "긴급열람이 없었다"가 아니라 **"기록될 경로가 없다"** 이다.
       * 화면이 이 둘을 구분할 수 있게 알린다.
       */
      btgInstrumented: false,
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async runPeriodicCheck(): Promise<void> {
    try {
      this.logger.log('Running periodic anomaly detection check...');

      // Get all active users from past hour
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const activeUsers = await this.prisma.auditLog.findMany({
        where: { timestamp: { gte: oneHourAgo } },
        select: { userId: true },
        distinct: ['userId'],
        take: 100,
      });

      const alerts: AnomalyAlert[] = [];

      for (const { userId } of activeUsers) {
        // Check for each type of anomaly
        const bulkAccessAlert = await this.checkBulkAccess(userId);
        const afterHoursAlert = await this.checkAfterHoursAccess(userId);

        if (bulkAccessAlert) alerts.push(bulkAccessAlert);
        if (afterHoursAlert) alerts.push(afterHoursAlert);
      }

      // 🔴 VIP 열람 감지 — 종전에는 checkVipAccess() 가 정의만 되고 **호출되지 않았다**.
      //    커서(lastVipScanAt) 이후분만 보고 커서를 전진시켜 같은 열람의 반복 경보를 막는다.
      //
      // 🔴 탐지기를 격리한다 — 화면 실사용 점검 W8(2026-08-14).
      //    이 호출을 바깥 try 에 그대로 두었더니, VIP 조회가 던지는 순간 **이미 탐지해 둔
      //    대량조회·시간외접근 경보까지 통째로 사라지고** 로그에는 "Periodic check failed" 한 줄만 남았다
      //    (통합 스펙이 이걸 잡았다 — 통보 2건 기대 / 실제 0건).
      //    이상탐지는 **하나가 실패해도 나머지는 나가야** 한다. 실패는 삼키지 않고 경고로 남긴다.
      const vipSince = this.lastVipScanAt ?? oneHourAgo;
      const scanStartedAt = new Date();
      try {
        const vipAlerts = await this.detectVipAccess(vipSince);
        this.lastVipScanAt = scanStartedAt;
        alerts.push(...vipAlerts);
      } catch (e) {
        // 🔴 커서를 전진시키지 않는다 — 다음 회차가 이 구간을 다시 본다(놓친 열람이 영구 유실되지 않게).
        this.logger.error(`VIP access detection failed (다른 탐지는 계속): ${(e as Error).message}`);
      }

      if (alerts.length > 0) {
        this.logger.warn(`Detected ${alerts.length} anomalies: ${alerts.map(a => a.type).join(', ')}`);
        // PHI 접근 이상은 로그로 끝내면 관측되지 않는다 — ADMIN 통보까지가 통제(감사/EMR 인증).
        await this.escalate(alerts);
      } else {
        this.logger.debug('No anomalies detected');
      }
    } catch (error) {
      this.logger.error(`Periodic check failed: ${(error as Error).message}`);
    }
  }

  /** 이상징후 → ADMIN 통보(정본 notify 경로·SSE 포함). 대상 사용자명은 조사 착수용 최소 정보만. */
  private async escalate(alerts: AnomalyAlert[]): Promise<void> {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    if (admins.length === 0) return;

    const byType = alerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(byType).map(([t, n]) => `${t} ${n}건`).join(' · ');
    const actors = [...new Set(alerts.map((a) => a.userId))];

    for (const admin of admins) {
      await this.notifications?.notify(admin.id, {
        type: 'AUDIT_ANOMALY',
        title: '⚠️ 감사 이상징후 탐지',
        message: `최근 1시간 PHI 접근 이상 ${alerts.length}건 (${summary}) — 대상 계정 ${actors.length}명. 감사 로그에서 확인하세요.`,
        severity: 'WARNING',
        refType: 'AuditLog',
        refId: actors[0],
      }).catch(() => undefined);
    }
  }
}
