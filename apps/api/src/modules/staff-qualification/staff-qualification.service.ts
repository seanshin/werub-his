import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';

/** 목록 상한 — 화면은 `total`/`truncated` 로 잘렸음을 반드시 말해야 한다(상한 무표식 금지). */
const LIST_LIMIT = 200;
/** 대시보드 패널 상한 */
const PANEL_LIMIT = 20;
/** 임박 지평선(일) */
const HORIZON_DAYS = 30;

/**
 * 자격 실효 상태 정본 — 🔴 종전엔 판정이 두 벌이었다.
 *   · 카드(집계): `expiresAt < now` 만 셌다
 *   · 표(행): `expiresAt < now ? 'EXPIRED' : status`
 * 그래서 관리자가 상태를 EXPIRED/SUSPENDED 로 **직접 바꾼 건**을 카드가 세지 않았다.
 * 집계와 행이 같은 함수를 쓰게 한다.
 */
export function effectiveCredentialStatus(status: string, expiresAt: Date | null | undefined, now: Date): string {
  if (expiresAt && expiresAt < now) return 'EXPIRED';
  return status;
}

/** 활성 임상직 — 면허 원장(SQE)의 최소 등재 대상. 등록률의 분모는 여기서만 온다(추정 금지). */
const CLINICAL_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH];

@Injectable()
export class StaffQualificationService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: IntegrationOutboxService) {}

  private async attachUsers<T extends { userId: string }>(rows: T[]): Promise<(T & { user: { familyName: string; givenName: string; role: string; department: string | null } | null })[]> {
    const ids = [...new Set(rows.map((r) => r.userId))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true, role: true, department: true } })
      : [];
    const umap = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: umap.get(r.userId) ?? null }));
  }

  // ── 자격/면허 (Credential) ──

  /** 🔴 반환 shape 변경: 배열 → `{ items, total, limit, truncated }`. 상한 200 을 넘긴 사실을 화면이 말해야 한다. */
  async listCredentials(params: { userId?: string; type?: string; status?: string }) {
    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    const [total, rows] = await Promise.all([
      this.prisma.staffCredential.count({ where }),
      this.prisma.staffCredential.findMany({ where, orderBy: [{ expiresAt: 'asc' }], take: LIST_LIMIT }),
    ]);
    // 만료 자동 반영(읽기 시 계산) — 집계와 같은 정본 함수를 쓴다
    const now = new Date();
    const withExpiry = rows.map((r) => ({ ...r, effectiveStatus: effectiveCredentialStatus(r.status, r.expiresAt, now) }));
    return { items: await this.attachUsers(withExpiry), total, limit: LIST_LIMIT, truncated: total > rows.length };
  }

  async createCredential(data: { userId: string; type: string; name: string; number?: string; issuer?: string; issuedAt?: string; expiresAt?: string; fileUrl?: string }) {
    const c = await this.prisma.staffCredential.create({
      data: {
        userId: data.userId, type: data.type, name: data.name, number: data.number, issuer: data.issuer,
        issuedAt: data.issuedAt ? new Date(data.issuedAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        fileUrl: data.fileUrl,
      },
    });
    void this.outbox.enqueue('hr', 'staff.qualification_changed', `hr:cred:${c.id}`, { credentialId: c.id, userId: c.userId, type: c.type, name: c.name, expiresAt: c.expiresAt, status: c.status });
    return c;
  }

  async verifyCredential(id: string, verifiedBy: string) {
    const c = await this.prisma.staffCredential.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('자격 정보를 찾을 수 없습니다');
    return this.prisma.staffCredential.update({ where: { id }, data: { verifiedBy, verifiedAt: new Date() } });
  }

  async updateCredentialStatus(id: string, status: string) {
    // 🔴 (B7) 없는 id 는 Prisma P2025(500) 대신 404 — verifyCredential 과 같게
    const c = await this.prisma.staffCredential.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('자격 정보를 찾을 수 없습니다');
    return this.prisma.staffCredential.update({ where: { id }, data: { status } });
  }

  // ── 교육 (Education) ──

  /** 🔴 반환 shape 변경: 배열 → `{ items, total, limit, truncated }`(상한 표식). */
  async listEducation(params: { userId?: string; category?: string; status?: string; courseName?: string }) {
    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.category) where.category = params.category;
    if (params.status) where.status = params.status;
    if (params.courseName) where.courseName = params.courseName; // 정합 백필용 정확 일치(edu 로컬 id 매핑)
    const [total, rows] = await Promise.all([
      this.prisma.staffEducation.count({ where }),
      this.prisma.staffEducation.findMany({ where, orderBy: [{ completedAt: 'desc' }], take: LIST_LIMIT }),
    ]);
    return { items: await this.attachUsers(rows), total, limit: LIST_LIMIT, truncated: total > rows.length };
  }

  /** edu 정합 백필용 lean 조회 — 로컬 id 매핑에 필요한 최소 필드만(user attach 없이). userId·courseName 필터. */
  async listEducationForBackfill(params: { userId?: string; courseName?: string }) {
    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.courseName) where.courseName = params.courseName;
    return this.prisma.staffEducation.findMany({
      where,
      select: { id: true, userId: true, courseName: true, category: true, completedAt: true, expiresAt: true, idempotencyKey: true },
      orderBy: [{ completedAt: 'desc' }],
      take: 500,
    });
  }

  async recordEducation(data: { userId: string; courseName: string; category: string; completedAt?: string; expiresAt?: string; dueDate?: string; hours?: number; certificateUrl?: string; idempotencyKey?: string }) {
    const completed = data.completedAt ? new Date(data.completedAt) : new Date();
    return this.prisma.staffEducation.create({
      data: {
        userId: data.userId, courseName: data.courseName, category: data.category,
        completedAt: completed,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        hours: data.hours as never,
        certificateUrl: data.certificateUrl,
        idempotencyKey: data.idempotencyKey ?? undefined,
        status: 'COMPLETED',
      },
    });
  }

  /**
   * 멱등 이수기록(edu 연동·P0-3) — 재전송 중복 방지.
   * 1순위 Idempotency-Key(유니크), 2순위 자연키(userId·courseName·완료일 KST).
   */
  async recordEducationIdempotent(data: { userId: string; courseName: string; category: string; completedAt?: string; expiresAt?: string; dueDate?: string; hours?: number; certificateUrl?: string; idempotencyKey?: string }) {
    if (!data.userId || !data.courseName || !data.category) {
      throw new BadRequestException('userId·courseName·category는 필수입니다');
    }
    if (data.idempotencyKey) {
      const dup = await this.prisma.staffEducation.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      // 🔴 같은 키로 **다른 내용**이 오면 "이미 있다"고 삼키지 않는다.
      //    보내는 쪽 키에 과정명이 빠져 `userId::완료시각` 모양으로 오는 것이 관측됐다 — 같은 순간에 끝난
      //    다른 과정이 **한 건으로 합쳐지면 이수 기록이 사라진다**(교육 이수는 법정 근거가 되는 기록이다).
      if (dup && (dup.courseName !== data.courseName || dup.category !== data.category)) {
        throw new ConflictException({
          error: 'IDEMPOTENCY_KEY_REUSED',
          message: '같은 Idempotency-Key 로 다른 교육 내용이 전송되었습니다. 키에 과정명을 포함해 주세요.',
          details: { idempotencyKey: data.idempotencyKey, storedCourseName: dup.courseName, storedCategory: dup.category },
        });
      }
      if (dup) return { record: dup, idempotent: true };
    }
    const completed = data.completedAt ? new Date(data.completedAt) : new Date();
    // KST 당일 경계(서버 TZ 무관) — completedAt을 KST로 이동해 날짜 추출, 그 KST 자정의 UTC 시각으로 경계 구성
    const kst = new Date(completed.getTime() + 9 * 3600000);
    const dayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const existing = await this.prisma.staffEducation.findFirst({
      where: { userId: data.userId, courseName: data.courseName, category: data.category, completedAt: { gte: dayStart, lt: dayEnd } },
    });
    if (existing) return { record: existing, idempotent: true };
    try {
      const record = await this.recordEducation(data);
      return { record, idempotent: false };
    } catch (e) {
      // 동시 재전송(같은 idempotencyKey) → 유니크 위반 시 기존 반환
      if (data.idempotencyKey) {
        const dup = await this.prisma.staffEducation.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
        // 🔴 이 폴백도 1순위 경로와 **같은 대조**를 지난다(2026-09-23). 종전에는 대조 없이 기존 행을 돌려줘,
        //    동시 재전송 레이스에서 **다른 과정**이 같은 키로 오면 앞 기록을 "이미 있다"며 삼켰다 — 1순위에서 막은 결함이
        //    실패 경로에서 되살아나는 자리다(주석으로 적어둔 규칙을 실패 경로가 어긴다).
        if (dup && (dup.courseName !== data.courseName || dup.category !== data.category)) {
          throw new ConflictException({
            error: 'IDEMPOTENCY_KEY_REUSED',
            message: '같은 Idempotency-Key 로 다른 교육 내용이 전송되었습니다. 키에 과정명을 포함해 주세요.',
            details: { idempotencyKey: data.idempotencyKey, storedCourseName: dup.courseName, storedCategory: dup.category },
          });
        }
        if (dup) return { record: dup, idempotent: true };
      }
      throw e;
    }
  }

  // ── 대시보드 (SQE 종합) ──

  async getDashboard() {
    const now = new Date();
    const in30 = new Date(now.getTime() + HORIZON_DAYS * 86400000);

    // 🔴 만료 집계 정본화 — 종전엔 `expiresAt < now` 만 셌다. 관리자가 상태를 직접 EXPIRED 로 바꾼 건이
    //    카드에서 빠져 표(effectiveStatus)와 숫자가 갈렸다.
    const expiredWhere = { OR: [{ expiresAt: { lt: now } }, { status: 'EXPIRED' }] };

    const [
      totalCreds, expiredCreds, suspendedCreds, expiringSoonTotal, expiringSoon, unverified,
      totalEdu, credUserGroups, clinicalStaffActive, hrLicenseRows,
    ] = await Promise.all([
      this.prisma.staffCredential.count(),
      this.prisma.staffCredential.count({ where: expiredWhere }),
      this.prisma.staffCredential.count({ where: { status: 'SUSPENDED', expiresAt: null } }),
      this.prisma.staffCredential.count({ where: { expiresAt: { gte: now, lt: in30 } } }),
      this.prisma.staffCredential.findMany({ where: { expiresAt: { gte: now, lt: in30 } }, orderBy: { expiresAt: 'asc' }, take: PANEL_LIMIT }),
      this.prisma.staffCredential.count({ where: { verifiedAt: null } }),
      this.prisma.staffEducation.count(),
      this.prisma.staffCredential.groupBy({ by: ['userId'], _count: { id: true } }),
      this.prisma.user.count({ where: { isActive: true, role: { in: CLINICAL_ROLES } } }),
      // 🔴 면허 정본이 둘이다 — 인사 원장 `staff.license_number` 에는 실제 면허번호가 있는데
      //    SQE 는 `staff_credentials`(User FK) 만 본다. **합치지 않는다**(설계 판단 대기).
      //    화면이 "원장 미구축"과 "다른 곳에 N건이 있다"를 동시에 말할 수 있게 건수만 제공한다.
      this.prisma.staff.count({ where: { status: 'ACTIVE', licenseNumber: { not: null } } }),
    ]);

    // 재이수 추적 — 🔴 종전엔 `category: 'MANDATORY'` 한 종에만 걸려 있었다.
    //    실측 분포는 INFECTION 13 · CE 7 · MANDATORY 9 · PATIENT_SAFETY 1 로,
    //    감염관리·환자안전 같은 법정 필수가 통째로 추적 밖이었다.
    //    카테고리를 임의로 고르지 않고, **재이수 기한(expiresAt)이 설정된 기록 전부**를 추적하고
    //    행마다 category 를 실어 보내 화면이 분류를 그대로 말하게 한다.
    // 🔴 그리고 '초과(이미 실효)'와 '임박(도래 예정)'을 분리한다 — 섞으면 위반이 완화 표기된다.
    const overdueWhere = { expiresAt: { lt: now } };
    const dueSoonWhere = { expiresAt: { gte: now, lt: in30 } };
    const [overdueTotal, dueSoonTotalEdu, overdueRows, dueSoonRows, eduByCategory] = await Promise.all([
      this.prisma.staffEducation.count({ where: overdueWhere }),
      this.prisma.staffEducation.count({ where: dueSoonWhere }),
      this.prisma.staffEducation.findMany({ where: overdueWhere, orderBy: { expiresAt: 'asc' }, take: PANEL_LIMIT }),
      this.prisma.staffEducation.findMany({ where: dueSoonWhere, orderBy: { expiresAt: 'asc' }, take: PANEL_LIMIT }),
      this.prisma.staffEducation.groupBy({ by: ['category'], _count: { id: true } }),
    ]);

    const withDays = <T extends { expiresAt: Date | null }>(rows: T[]) =>
      rows.map((r) => ({ ...r, daysLeft: r.expiresAt ? Math.ceil((r.expiresAt.getTime() - now.getTime()) / 86400000) : null }));

    const staffWithCredential = credUserGroups.length;

    return {
      credentials: {
        total: totalCreds, expired: expiredCreds, suspended: suspendedCreds, unverified,
        expiringSoon: await this.attachUsers(withDays(expiringSoon)),
        expiringSoonTotal,
        expiringSoonTruncated: expiringSoonTotal > expiringSoon.length,
        /**
         * 원장 구축 상태 — 🔴 표본 0 은 "이상 없음"이 아니다.
         * 등록 자격 0건인데 화면이 초록 ✓ 로 "임박한 만료가 없습니다"라고 안심시키던 것이 원 결함이다.
         */
        ledger: {
          built: totalCreds > 0,
          rows: totalCreds,
          clinicalStaffActive,
          staffWithCredential,
          /** 활성 임상직 대비 자격 등재 인원 비율(0~1). 분모가 0이면 산출 불가(null). */
          registrationRate: clinicalStaffActive > 0 ? staffWithCredential / clinicalStaffActive : null,
          /** 별도 원장(미통합) — 인사 Staff.license_number 보유 재직자 수 */
          hrLicenseNumberRows: hrLicenseRows,
          hrLedgerNote: '인사 원장(staff.license_number)과 SQE 자격 원장(staff_credentials)은 별개입니다 — 자동 통합하지 않습니다(설계 판단 대기)',
        },
      },
      education: {
        total: totalEdu,
        byCategory: eduByCategory.map((g) => ({ category: g.category, count: g._count.id })),
        /** 재이수 기한 경과(초과) */
        overdue: { total: overdueTotal, truncated: overdueTotal > overdueRows.length, items: await this.attachUsers(withDays(overdueRows)) },
        /** 재이수 기한 도래 예정(30일 내) */
        dueSoon: { total: dueSoonTotalEdu, truncated: dueSoonTotalEdu > dueSoonRows.length, items: await this.attachUsers(withDays(dueSoonRows)) },
        /** 기한이 설정되지 않아 추적할 수 없는 기록 수(초록 ✓ 의 근거를 갉아먹는 값) */
        withoutDueDate: await this.prisma.staffEducation.count({ where: { expiresAt: null } }),
      },
      panelLimit: PANEL_LIMIT,
      generatedAt: now.toISOString(),
    };
  }
}
