import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

export interface ErpRosterUser {
  email: string;
  erpRole?: string;
  active?: boolean; // 기본 true
  employeeCode?: string;
}

export interface ErpAccessSyncResult {
  mode: 'replace' | 'merge';
  total: number;
  matched: number;
  unmatched: string[]; // ERP 명단에 있으나 HIS 직원(활성 이메일) 없음
  deactivated: string[]; // active=false 로 접근 회수된 이메일(매칭된 것만)
  allowedUserIds: number; // 동기화 후 개별 허용 사용자 수
  at: string;
}

// ERP 명단 → HIS 일괄 동기화 (ERP=소스 오브 트루스).
// ERP 가 명단(이메일·활성)을 푸시 → HIS 가 이메일로 직원 매칭 → erp.allowedUserIds 갱신.
// HIS 는 ERP "접근(SSO)" 허용 대상만 관리(개별). ERP 내부 역할은 ERP 에서 별도 관리.
@Injectable()
export class ErpAccessSyncService {
  private readonly logger = new Logger(ErpAccessSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
  ) {}

  async sync(users: ErpRosterUser[], mode: 'replace' | 'merge' = 'replace'): Promise<ErpAccessSyncResult> {
    const norm = (e: string) => (e ?? '').trim().toLowerCase();
    const roster = (users ?? []).filter((u) => u && u.email).map((u) => ({ ...u, email: norm(u.email) }));
    const emails = [...new Set(roster.map((u) => u.email))];

    // HIS 직원 매칭 — 이메일(소문자) 기준. 활성 직원만 접근 대상.
    const hisUsers = emails.length
      ? await this.prisma.user.findMany({
          where: { email: { in: emails, mode: 'insensitive' } },
          select: { id: true, email: true, isActive: true },
        })
      : [];
    const byEmail = new Map(hisUsers.map((u) => [norm(u.email), u]));

    const matchedActive: string[] = []; // userId
    const matchedInactiveEmails: string[] = []; // active=false 로 회수
    const unmatched: string[] = [];

    for (const r of roster) {
      const hit = byEmail.get(r.email);
      const erpActive = r.active !== false;
      if (!hit || !hit.isActive) {
        // HIS 에 없거나 비활성 직원 → 접근 부여 불가(미매칭 보고)
        unmatched.push(r.email);
        continue;
      }
      if (erpActive) matchedActive.push(hit.id);
      else matchedInactiveEmails.push(r.email);
    }

    const matchedActiveIds = [...new Set(matchedActive)];
    const inactiveIds = new Set(
      matchedInactiveEmails.map((e) => byEmail.get(e)?.id).filter((x): x is string => !!x),
    );

    const prev = ((await this.configRuntime.get('erp.allowedUserIds')) as string[] | null) ?? [];
    let next: string[];
    if (mode === 'merge') {
      // 추가(활성) + 명시적 비활성 제거
      next = [...new Set([...prev, ...matchedActiveIds])].filter((id) => !inactiveIds.has(id));
    } else {
      // replace(기본): ERP 명단이 권위 — 활성 매칭분으로 전체 대체
      next = matchedActiveIds;
    }

    await this.configRuntime.set('erp.allowedUserIds', next);

    const result: ErpAccessSyncResult = {
      mode,
      total: roster.length,
      matched: matchedActiveIds.length,
      unmatched: [...new Set(unmatched)],
      deactivated: [...new Set(matchedInactiveEmails)],
      allowedUserIds: next.length,
      at: new Date().toISOString(),
    };
    await this.configRuntime.set('erp.accessSyncMeta', result as unknown as Record<string, unknown>);
    this.logger.log(`ERP 접근 동기화(${mode}): total=${result.total} matched=${result.matched} unmatched=${result.unmatched.length}`);
    return result;
  }
}
