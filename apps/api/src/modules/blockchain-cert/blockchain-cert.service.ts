import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { publicKeyProblem } from '../../common/util/signature-verify';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class BlockchainCertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
    /** 안내 발송 정본 — 직접 prisma.notification.create 는 SSE 푸시가 빠진다(정본 주석 규약) */
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /**
   * 🔴 (2026-09-03) 관리 화면 '직원에게 인증서 설정 안내 발송' 버튼이 **발송 코드 없이
   *    toast.success 만** 띄우고 있었다(P16 — 실행하지 않고 성공 상태만 표시).
   *    실제 원내 알림으로 배선한다. 결과는 {attempted, sent, failed} — 보낸 척하지 않는다.
   */
  async notifySetup(target: 'ALL' | 'DOCTOR' | 'NURSE' | 'PHARMACIST') {
    if (!this.notifications) {
      // 미주입이면 보낸 척하지 않는다 — 배선 결함을 그 자리에서 말한다
      throw new BadRequestException('알림 서비스가 배선되지 않아 발송할 수 없습니다(NotificationModule 미주입).');
    }
    const roles: UserRole[] = target === 'ALL' ? ['DOCTOR', 'NURSE', 'PHARMACIST'] : [target];
    const users = await this.prisma.user.findMany({
      where: { role: { in: roles }, isActive: true },
      select: { id: true },
    });
    const withCert = await this.prisma.blockchainCertificate.findMany({
      where: { ownerType: 'STAFF', status: 'ACTIVE', userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    const has = new Set(withCert.map((c) => c.userId));
    const targets = users.filter((u) => !has.has(u.id));
    let sent = 0;
    let failed = 0;
    for (const u of targets) {
      try {
        await this.notifications.notify(u.id, {
          type: 'CERT_SETUP_NOTICE',
          title: '전자서명 인증서 설정 안내',
          message: '전자서명에 쓰는 인증서는 보안상 본인 브라우저에서 직접 발급해야 합니다. 설정 → 내 인증서에서 개인키를 생성하고 인증서를 발급받아 주세요.',
          severity: 'INFO',
        });
        sent += 1;
      } catch {
        failed += 1; // 실패를 성공으로 세지 않는다
      }
    }
    return { attempted: targets.length, sent, failed };
  }

  /**
   * 자체발급 게이트 — sign 단독발급 전환 시(blockchain.selfIssuanceEnabled=false) HIS minting 차단.
   * HIS = 요청자·기록자, 발급자 아님. 인증서 발급은 sign(HSM-앵커 CA)에 위임.
   */
  private async assertSelfIssuanceAllowed() {
    const enabled = await this.configRuntime.get('blockchain.selfIssuanceEnabled');
    if (enabled === false) {
      throw new ForbiddenException({
        error: 'SELF_ISSUANCE_DISABLED',
        message: 'HIS 자체 인증서 발급이 폐지되었습니다 — sign(HSM-앵커 CA)에 발급 위임(sign.mode=EXTERNAL).',
      });
    }
  }

  /** sign 인증서 현황(읽기전용 미러) — 직원별 sign 발급 serial(user.signCertSerial). sign 단독 전환 후 HIS 가시성. */
  async signCertStatus(): Promise<{ total: number; enrolled: number; staff: Array<{ userId: string; name: string; role: string; department: string | null; signCertSerial: string | null; enrolled: boolean }> }> {
    const staff = await this.prisma.user.findMany({
      select: { id: true, familyName: true, givenName: true, role: true, department: true, signCertSerial: true },
      orderBy: [{ role: 'asc' }, { familyName: 'asc' }],
    });
    const rows = staff.map((u) => ({
      userId: u.id,
      name: `${u.familyName ?? ''}${u.givenName ?? ''}`,
      role: String(u.role),
      department: u.department ?? null,
      signCertSerial: u.signCertSerial ?? null,
      enrolled: !!u.signCertSerial,
    }));
    return { total: rows.length, enrolled: rows.filter((r) => r.enrolled).length, staff: rows };
  }

  /**
   * 환자 sign 인증서 현황(읽기전용 미러) — patient.signCertSerial(enroll 또는 서명 webhook 반영).
   *
   * 🔴 W8 — '발급일'이 `patient.updatedAt` 이었다. 주소 한 줄만 고쳐도 인증서 발급일이 오늘로 바뀌는,
   *    **인증서와 아무 관계 없는 시각**이다(법정 기록 화면에서 특히 위험).
   *    sign 이 발급한 인증서의 발급 시각은 HIS 에 없을 수 있다 — 그럴 때의 정답은
   *    다른 컬럼으로 때우는 것이 아니라 **'미상'(null)** 이다(모르는 시각은 원장에 박지 않는다).
   *    HIS 원장(blockchain_certificates)에 같은 serial 이 있으면 그 `issuedAt` 만 쓴다.
   */
  async patientSignCerts(): Promise<{ total: number; patients: Array<{ patientId: string; name: string; mrn: string | null; signCertSerial: string | null; issuedAt: string | null }> }> {
    const rows = await this.prisma.patient.findMany({
      where: { signCertSerial: { not: null } },
      select: { id: true, familyName: true, givenName: true, mrn: true, signCertSerial: true },
      orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
    });

    const serials = rows.map((p) => p.signCertSerial).filter((s): s is string => !!s);
    const known = serials.length
      ? await this.prisma.blockchainCertificate.findMany({
          where: { serialNumber: { in: serials } },
          select: { serialNumber: true, issuedAt: true },
        })
      : [];
    const issuedBySerial = new Map(known.map((c) => [c.serialNumber, c.issuedAt]));

    const patients = rows.map((p) => ({
      patientId: p.id,
      name: `${p.familyName ?? ''}${p.givenName ?? ''}`,
      mrn: p.mrn ?? null,
      signCertSerial: p.signCertSerial ?? null,
      // 실제 발급 시각을 아는 경우에만 적는다 — 모르면 null(화면은 '미상'으로 표시)
      issuedAt: (p.signCertSerial ? issuedBySerial.get(p.signCertSerial) : undefined)?.toISOString() ?? null,
    }));
    return { total: patients.length, patients };
  }

  /** 발급 가능 여부(sign 단독 전환 반영) — FE 가 자체발급 UI 노출 결정에 사용. */
  async capability(): Promise<{ selfIssuanceEnabled: boolean; issuer: 'his' | 'sign'; message: string | null }> {
    const enabled = (await this.configRuntime.get('blockchain.selfIssuanceEnabled')) !== false;
    return {
      selfIssuanceEnabled: enabled,
      issuer: enabled ? 'his' : 'sign',
      message: enabled ? null : '전자서명 인증서는 서명 시 sign(전자서명 서비스)에서 자동 발급·관리됩니다. 별도 발급이 필요 없습니다.',
    };
  }

  /** 인증서 발급 — 즉시 ACTIVE (승인/갱신 불필요, 무기한) */
  async issue(data: {
    ownerType: string;
    userId?: string;
    patientId?: string;
    subjectDn: string;
    publicKey: string;
    algorithm: string;
    licenseNumber?: string;
    licenseType?: string;
    department?: string;
    specialty?: string;
    patientMrn?: string;
    identityVerified?: boolean;
    keyCustody?: string; // HSM Phase 4 — 개인키 수탁 출처. 기본 CLIENT_SE(개인키는 클라이언트 보관, HIS 미수탁).
    attestationRef?: string;
  }) {
    await this.assertSelfIssuanceAllowed();
    // 🔴 (2026-09-15 N2) 공개키 형식 입구 검증 — 종전엔 아무 문자열이나 공개키로 받아 인증서를 만들었다
    //    (포털이 `base64('portal-patient-<시각>')` 로 개인키가 존재하지 않는 인증서를 발급받았다).
    const keyProblem = publicKeyProblem(data.publicKey, data.algorithm);
    if (keyProblem) {
      throw new BadRequestException({ code: 'PUBLIC_KEY_INVALID', message: '공개키 형식이 올바르지 않습니다(SPKI 공개키·지원 알고리즘 ECDSA-P256/RSA-2048)', details: { reason: keyProblem } });
    }

    // 기존 ACTIVE 인증서가 있으면 자동 폐기 (1인 1인증서)
    const existing = await this.prisma.blockchainCertificate.findFirst({
      where: {
        ownerType: data.ownerType,
        ...(data.userId ? { userId: data.userId } : {}),
        ...(data.patientId ? { patientId: data.patientId } : {}),
        status: 'ACTIVE',
      },
    });
    if (existing) {
      await this.prisma.blockchainCertificate.update({
        where: { id: existing.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: '새 키 생성으로 자동 폐기' },
      });
      await this.writeAuditLog(existing.id, data.userId, data.patientId, data.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'REVOKED', { reason: '새 인증서 발급으로 자동 교체' });
    }

    const serialNumber = `CERT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const certHash = createHash('sha256').update(data.publicKey).digest('hex');
    const fingerprint = createHash('sha256').update(`${serialNumber}:${data.publicKey}`).digest('hex');

    const cert = await this.prisma.blockchainCertificate.create({
      data: {
        ownerType: data.ownerType,
        userId: data.userId,
        patientId: data.patientId,
        serialNumber,
        subjectDn: data.subjectDn,
        publicKey: data.publicKey,
        algorithm: data.algorithm,
        issuedAt: new Date(),
        expiresAt: new Date('2099-12-31'), // 사실상 무기한
        status: 'ACTIVE', // 즉시 활성화 (승인 불필요)
        licenseNumber: data.licenseNumber,
        licenseType: data.licenseType,
        department: data.department,
        specialty: data.specialty,
        patientMrn: data.patientMrn,
        identityVerified: data.identityVerified,
        certHash,
        fingerprint,
        keyCustody: data.keyCustody ?? 'CLIENT_SE', // 개인키는 클라이언트 보관 — HIS는 publicKey만 수탁
        attestationRef: data.attestationRef,
        previousCertId: existing?.id,
      },
    });

    await this.writeAuditLog(cert.id, data.userId, data.patientId, data.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'ISSUED');

    return cert;
  }

  /**
   * 🔴 W7(2026-08) 자체발급 명의 위조 봉합 — 컨트롤러가 `@Body()` 를 그대로 issue() 에 넘겨
   * `userId`·`subjectDn`·`licenseNumber`·`identityVerified` 를 요청자가 지정할 수 있었다.
   * 타인 명의 발급이 가능했고, 1인1증서 규칙 때문에 **피해자의 기존 ACTIVE 인증서가 자동 REVOKE** 됐다.
   *
   * 명의는 토큰(userId)에서만 취하고, 표시 항목(subjectDn·부서·면허번호)은 서버가 DB 에서 구성한다.
   * - identityVerified 는 세우지 않는다 — 자체발급 경로는 본인확인을 증명하지 않는다(하지 않은 것을 했다고 적지 않는다).
   * - licenseNumber 는 Staff 정본에서만 읽는다(요청 본문 자기신고 금지). 없으면 비운다.
   */
  async issueForSelf(
    userId: string,
    data: { publicKey: string; algorithm: string; keyCustody?: string; attestationRef?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, familyName: true, givenName: true, role: true, department: true, specialty: true },
    });
    if (!user) throw new NotFoundException('직원을 찾을 수 없습니다');

    const staff = await this.prisma.staff.findUnique({
      where: { userId },
      select: { licenseNumber: true, department: true, specialty: true, position: true },
    });

    const fullName = `${user.familyName ?? ''}${user.givenName ?? ''}`;
    const department = staff?.department ?? user.department ?? null;

    return this.issue({
      ownerType: 'STAFF',
      userId: user.id,
      subjectDn: `CN=${fullName}, OU=${department ?? String(user.role)}, O=WERUBYHOSP, C=KR`,
      publicKey: data.publicKey,
      algorithm: data.algorithm,
      licenseNumber: staff?.licenseNumber ?? undefined,
      licenseType: staff?.position ?? undefined,
      department: department ?? undefined,
      specialty: staff?.specialty ?? user.specialty ?? undefined,
      keyCustody: data.keyCustody,
      attestationRef: data.attestationRef,
    });
  }

  /**
   * 🔴 W7 객체수준 인가 — 인증서 소유 검증. 없는 인증서와 남의 인증서를 **똑같이 404** 로 답한다
   * (존재 여부를 알려주지 않음). renew·pin-fail·pin-success·상세조회가 certId 만 알면
   * 타인 인증서를 재발급(명의 서명 위조)·정지(10회 실패)·잠금 해제할 수 있던 것을 막는다.
   */
  async requireOwnership(certId: string, userId: string) {
    const cert = await this.prisma.blockchainCertificate.findUnique({
      where: { id: certId },
      select: { id: true, userId: true },
    });
    if (!cert || !cert.userId || cert.userId !== userId) {
      throw new NotFoundException('인증서를 찾을 수 없습니다');
    }
    return cert;
  }

  /** 내 인증서 목록 */
  async getMyCerts(userId: string) {
    return this.prisma.blockchainCertificate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 인증서 상세 (갱신 체인 포함) */
  async getCertById(id: string) {
    const cert = await this.prisma.blockchainCertificate.findUnique({
      where: { id },
      include: {
        previousCert: true,
        renewedBy: true,
        user: { select: { id: true, familyName: true, givenName: true } },
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
      },
    });
    if (!cert) throw new NotFoundException('인증서를 찾을 수 없습니다');
    return cert;
  }

  /**
   * 인증서 승인(PENDING → ACTIVE).
   *
   * 🔴 (2026-09-15 D3) 종전에는 **아무것도 하지 않고**(`no-op, 이미 ACTIVE`) 인증서를 그대로 돌려줬다.
   *    그런데 관리 화면은 `status === 'PENDING'` 인 행에 '승인' 버튼을 그리고, 성공하면
   *    "인증서가 승인되었습니다."라고 말한다 — 눌러도 상태는 PENDING 그대로였다(P16: 실행하지 않고
   *    성공만 기록). 발급 경로가 즉시 ACTIVE 로 만들 뿐, 스키마 기본값은 PENDING 이라 그런 행은 실제로 남는다.
   *    이제 PENDING 이면 실제로 활성화하고, 아니면 **바뀐 것이 없다는 사실**을 응답이 말한다.
   */
  async approve(id: string, approvedBy?: string) {
    const cert = await this.requireCert(id);
    if (cert.status !== 'PENDING') {
      return { ...cert, approved: false as const, reason: 'NOT_PENDING' as const };
    }
    const updated = await this.prisma.blockchainCertificate.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.writeAuditLog(id, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'APPROVED', approvedBy ? { approvedBy } : undefined);
    return { ...updated, approved: true as const, reason: null };
  }

  /** @deprecated 간소화 — revoke() 사용 권장 */
  async reject(id: string, reason: string) {
    return this.revoke(id, reason);
  }

  /** 키 교체 (rekey) — 기존 키 폐기 + 새 키로 재발급. issue()가 자동 처리. */
  async renew(id: string, newPublicKey: string) {
    // issue()에서 기존 ACTIVE 인증서를 자동 폐기하므로, 호출만 하면 됨
    const oldCert = await this.requireCert(id);
    return this.issue({
      ownerType: oldCert.ownerType,
      userId: oldCert.userId ?? undefined,
      patientId: oldCert.patientId ?? undefined,
      subjectDn: oldCert.subjectDn,
      publicKey: newPublicKey,
      algorithm: oldCert.algorithm,
      licenseNumber: oldCert.licenseNumber ?? undefined,
      licenseType: oldCert.licenseType ?? undefined,
      department: oldCert.department ?? undefined,
      specialty: oldCert.specialty ?? undefined,
      patientMrn: oldCert.patientMrn ?? undefined,
      identityVerified: oldCert.identityVerified ?? undefined,
    });
  }

  /** 인증서 일시정지 */
  async suspend(id: string) {
    const cert = await this.requireCert(id);
    if (cert.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 인증서만 일시정지 가능');

    const updated = await this.prisma.blockchainCertificate.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
    await this.writeAuditLog(id, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'SUSPENDED');
    return updated;
  }

  /** 인증서 폐기 */
  async revoke(id: string, reason: string) {
    const cert = await this.requireCert(id);

    const updated = await this.prisma.blockchainCertificate.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
    });
    await this.writeAuditLog(id, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'REVOKED', { reason });
    return updated;
  }

  /** 인증서 복원 (SUSPENDED → ACTIVE) */
  async restore(id: string) {
    const cert = await this.requireCert(id);
    if (cert.status !== 'SUSPENDED') throw new BadRequestException('SUSPENDED 상태만 복원 가능');

    const updated = await this.prisma.blockchainCertificate.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    await this.writeAuditLog(id, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'RESTORED');
    return updated;
  }

  /** CRL (Certificate Revocation List) */
  async getCrl() {
    return this.prisma.blockchainCertificate.findMany({
      where: { status: { in: ['REVOKED', 'SUSPENDED'] } },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        revokedAt: true,
        revokeReason: true,
        fingerprint: true,
      },
      orderBy: { revokedAt: 'desc' },
    });
  }

  /** 지문(fingerprint) 기반 인증서 검증 */
  async verifyByFingerprint(fingerprint: string) {
    const cert = await this.prisma.blockchainCertificate.findFirst({
      where: { fingerprint },
      select: {
        id: true,
        serialNumber: true,
        status: true,
        ownerType: true,
        subjectDn: true,
        expiresAt: true,
        revokedAt: true,
        fingerprint: true,
      },
    });
    if (!cert) return { valid: false, message: '인증서를 찾을 수 없습니다' };

    const isActive = cert.status === 'ACTIVE';

    return { valid: isActive, cert };
  }

  /** 감사 로그 조회 */
  async getAuditLog(filters: {
    certificateId?: string;
    userId?: string;
    eventType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const where: Record<string, unknown> = {};
    if (filters.certificateId) where.certificateId = filters.certificateId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.eventType) where.eventType = filters.eventType;

    const [data, total] = await Promise.all([
      this.prisma.certificateAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.certificateAuditLog.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** PIN 실패 기록 (5회=10분 잠금, 10회=일시정지) */
  async recordPinFail(certId: string) {
    const cert = await this.requireCert(certId);
    const newCount = cert.pinFailCount + 1;

    const updateData: any = { pinFailCount: newCount };

    if (newCount >= 10) {
      updateData.status = 'SUSPENDED';
      await this.writeAuditLog(certId, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'PIN_LOCKED', { pinFailCount: newCount, action: 'SUSPENDED' });
    } else if (newCount >= 5) {
      updateData.pinLockedUntil = new Date(Date.now() + 10 * 60 * 1000);
      await this.writeAuditLog(certId, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'PIN_LOCKED', { pinFailCount: newCount, lockedMinutes: 10 });
    } else {
      await this.writeAuditLog(certId, cert.userId, cert.patientId, cert.ownerType === 'PATIENT' ? 'PATIENT' : 'STAFF', 'PIN_FAILED', { pinFailCount: newCount });
    }

    return this.prisma.blockchainCertificate.update({
      where: { id: certId },
      data: updateData,
    });
  }

  /** PIN 성공 — 실패 카운터 초기화 */
  async recordPinSuccess(certId: string) {
    return this.prisma.blockchainCertificate.update({
      where: { id: certId },
      data: { pinFailCount: 0, pinLockedUntil: null },
    });
  }

  /** 상태별 통계 */
  async getStats() {
    const results = await this.prisma.blockchainCertificate.groupBy({
      by: ['status'],
      _count: { id: true },
    });
    const stats: Record<string, number> = {};
    for (const r of results) {
      stats[r.status] = r._count.id;
    }
    return stats;
  }

  /** 관리자용 전체 인증서 목록 (검색, 페이징) */
  async getAllCerts(filters: {
    status?: string;
    ownerType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.ownerType) where.ownerType = filters.ownerType;
    if (filters.search) {
      where.OR = [
        { serialNumber: { contains: filters.search, mode: 'insensitive' } },
        { subjectDn: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.blockchainCertificate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, familyName: true, givenName: true } },
          patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        },
      }),
      this.prisma.blockchainCertificate.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** @deprecated 무기한 인증서 — 만료 개념 없음. 하위호환 유지, 빈 배열 반환. */
  async getExpiringCerts(_days: number) {
    return [];
  }

  // ─── helpers ───────────────────────────────────────────────────

  private async requireCert(id: string) {
    const cert = await this.prisma.blockchainCertificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('인증서를 찾을 수 없습니다');
    return cert;
  }

  private async writeAuditLog(
    certificateId: string | null,
    userId: string | null | undefined,
    patientId: string | null | undefined,
    actorType: string,
    eventType: string,
    eventDetail?: Record<string, any>,
  ) {
    await this.prisma.certificateAuditLog.create({
      data: {
        certificateId,
        userId: userId ?? undefined,
        patientId: patientId ?? undefined,
        actorType,
        eventType,
        eventDetail: eventDetail ? (eventDetail as never) : undefined,
      },
    });
  }
}
