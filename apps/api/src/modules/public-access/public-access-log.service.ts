import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 무인증(공개) 채널 접근 원장.
 *
 * 🔴 왜 별도 원장인가 — `AuditLog.userId` 는 User FK(NOT NULL)라 **주체가 사람이 아닌 접근을 담을 수 없다.**
 *    감사 인터셉터도 `if (!user?.id) return;` 로 탈락한다. 그래서 공개 예약 챗·무인 키오스크의 조회가
 *    **개통 이래 한 건도 기록되지 않았다**(2026-08-19 실측). 외부 앱을 `SmartAccessLog` 로 따로 남긴 것과 같은 이유다.
 *
 * 🔴 원장이 열거 소스가 되지 않게 한다 — 등록번호 원문을 적지 않고 해시로만 남긴다.
 *    `patientId` 는 **본인확인을 통과한 뒤에만** 적는다.
 *
 * 🔴 기록 실패가 업무를 막지 않는다(비차단). 다만 조용히 넘기지 않고 로거에 남긴다.
 */
export type PublicChannel = 'BOOKING' | 'KIOSK' | 'STATION' | 'DISPLAY';
export type PublicAction = 'verify' | 'lookup' | 'pay' | 'checkin' | 'message';
export type PublicResult = 'OK' | 'FAIL' | 'LOCKED' | 'BLOCKED';

export interface PublicAccessEntry {
  channel: PublicChannel;
  action: PublicAction;
  path: string;
  result: PublicResult;
  /** 시도한 식별자 원문(MRN 등) — 저장 전에 해시된다. 원문은 DB 에 들어가지 않는다 */
  subject?: string | null;
  patientId?: string | null;
  sessionRef?: string | null;
  detail?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class PublicAccessLogService {
  private readonly logger = new Logger(PublicAccessLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 식별자 해시 — 같은 대상에 대한 반복 시도를 셀 수 있을 만큼만 남긴다(원문 복원 불가) */
  static hashSubject(subject?: string | null): string | null {
    const v = (subject ?? '').trim();
    if (!v) return null;
    return createHash('sha256').update(`public-access:${v.toUpperCase()}`).digest('hex');
  }

  async record(entry: PublicAccessEntry): Promise<void> {
    try {
      await this.prisma.publicAccessLog.create({
        data: {
          channel: entry.channel,
          action: entry.action,
          path: entry.path.slice(0, 300),
          result: entry.result,
          subjectHash: PublicAccessLogService.hashSubject(entry.subject),
          patientId: entry.patientId ?? null,
          sessionRef: entry.sessionRef ?? null,
          detail: (entry.detail ?? undefined) as never,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
        },
      });
    } catch (e) {
      // 🔴 기록 실패가 공개 창구 업무를 막지 않는다 — 다만 남기지 않고 넘어가지도 않는다
      this.logger.error(
        `공개 접근 기록 실패 ${entry.channel}/${entry.action}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** 같은 대상에 대한 최근 실패 횟수 — 무인증 채널의 대입 시도 탐지용 */
  async recentFailures(subject: string, withinMinutes = 15): Promise<number> {
    const hash = PublicAccessLogService.hashSubject(subject);
    if (!hash) return 0;
    return this.prisma.publicAccessLog.count({
      where: {
        subjectHash: hash,
        result: { in: ['FAIL', 'LOCKED'] },
        at: { gte: new Date(Date.now() - withinMinutes * 60_000) },
      },
    });
  }
}
