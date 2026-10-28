import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, randomInt } from 'crypto';
import * as QRCode from 'qrcode';
import { Observable, Subject, merge, of } from 'rxjs';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PasskeyService } from '../passkey/passkey.service';
import { NotificationService } from '../../notification/notification.service';
import { AuthService } from '../auth.service';
import { AppKeyService } from '../../mobile/app-key/app-key.service';
import { SmsOtpService } from '../../patient-auth/services/sms-otp.service';

/** 스탭 등록 2차 인증 — 환자 OTP 와 **다른 purpose** 라 저장·시도제한이 섞이지 않는다 */
const STAFF_ENROLL_OTP_PURPOSE = 'STAFF_DEVICE_ENROLL';

const ENROLL_TTL = 300; // 5분 (FR-32)
const MAX_ATTEMPTS = 5; // FR-32
const HIGH_ASSURANCE_ROLES = ['DOCTOR']; // 대면 등록 필수(FR-43)

type EnrollStatus = 'PENDING' | 'VERIFYING' | 'AWAITING_CONFIRM' | 'COMPLETED';

interface EnrollSession {
  staffUserId: string;
  code: string;
  adminId: string;
  enrollMode: 'IN_PERSON' | 'REMOTE';
  deviceName?: string;
  status: EnrollStatus;
  attempts: number;
  deviceId?: string; // register 후 채워짐
  /** 원격 등록 2차 인증 통과 여부 — 등록 코드와 **다른 secret·다른 저장소** */
  remoteFactorVerified?: boolean;
  /** OTP 를 보낸 HR 등록 채널(마스킹) — 화면이 "어디로 갔는지"를 말할 수 있게 */
  remoteFactorChannel?: string;
}

@Injectable()
export class DeviceEnrollService {
  private readonly logger = new Logger(DeviceEnrollService.name);
  private readonly qrBaseUrl: string;
  private readonly streams = new Map<string, Subject<MessageEvent>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly passkey: PasskeyService,
    private readonly notify: NotificationService,
    private readonly auth: AuthService,
    // 🔴 @Optional 이 아니다 — 미주입이면 앱키 폐기가 **조용한 no-op** 이 된다
    private readonly appKeys: AppKeyService,
    private readonly otp: SmsOtpService,
  ) {
    this.qrBaseUrl = this.config.get<string>('ENROLL_QR_BASE_URL') || 'http://localhost:3000';
  }

  private key(sessionId: string) {
    return `enroll:${sessionId}`;
  }

  private async load(sessionId: string): Promise<EnrollSession> {
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) throw new BadRequestException({ code: 'ENROLL_EXPIRED', message: '등록 세션이 만료되었습니다.' });
    return JSON.parse(raw) as EnrollSession;
  }

  private async save(sessionId: string, s: EnrollSession, ttl = ENROLL_TTL) {
    await this.redis.set(this.key(sessionId), JSON.stringify(s), 'EX', ttl);
  }

  private publish(sessionId: string, status: EnrollStatus, extra: Record<string, unknown> = {}) {
    const subject = this.streams.get(sessionId);
    if (subject) subject.next({ data: { status, ...extra } } as MessageEvent);
  }

  // ── 관리자: 등록 세션 시작 (FR-30/43) ──
  async start(adminId: string, staffUserId: string, mode?: 'IN_PERSON' | 'REMOTE', deviceName?: string) {
    const staff = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!staff || !staff.isActive) throw new NotFoundException('대상 직원을 찾을 수 없습니다.');

    // FR-43: 고보증 역할은 대면 등록 필수
    const enrollMode: 'IN_PERSON' | 'REMOTE' =
      HIGH_ASSURANCE_ROLES.includes(staff.role) ? 'IN_PERSON' : (mode ?? 'REMOTE');

    const sessionId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const session: EnrollSession = {
      staffUserId,
      code,
      adminId,
      enrollMode,
      deviceName,
      status: 'PENDING',
      attempts: 0,
    };
    await this.save(sessionId, session);

    const expiresAt = new Date(Date.now() + ENROLL_TTL * 1000).toISOString();
    const qrUrl = `${this.qrBaseUrl}/staff/enroll/${sessionId}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 240, margin: 2 }).catch(() => undefined); // 서버 로컬 생성(외부 API 금지)
    return {
      sessionId,
      code,
      enrollMode,
      qrUrl,
      qrDataUrl,
      expiresAt,
      staffName: `${staff.familyName}${staff.givenName}`,
    };
  }

  // SSE 스트림 (관리자 화면 실시간)
  getStream(sessionId: string): Observable<MessageEvent> {
    let subject = this.streams.get(sessionId);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.streams.set(sessionId, subject);
    }
    const initial = of({ data: { status: 'CONNECTED', sessionId } } as MessageEvent);
    return merge(initial, subject.asObservable());
  }

  /**
   * 원격 등록 2차 인증 발송 — **HR 정본 연락처**로만 보낸다.
   *
   * 🔴 등록 코드와 다른 secret·다른 저장소·별도 시도 제한을 쓴다(요청서 AUTH-S-06).
   * 🔴 발송 결과를 `{sent, delivery}` 로 정직하게 돌려준다 — 제공자가 없으면 "보냈다"고 하지 않는다.
   *    채널은 마스킹해서만 보여준다(연락처 전체를 등록 화면에 뿌리지 않는다).
   */
  async sendRemoteFactor(sessionId: string) {
    const s = await this.load(sessionId);
    if (s.status !== 'PENDING') throw new BadRequestException('이미 진행 중이거나 완료된 세션입니다.');
    if (s.enrollMode !== 'REMOTE') {
      throw new BadRequestException({ code: 'REMOTE_FACTOR_NOT_APPLICABLE', message: '대면 등록 세션입니다.' });
    }

    const staff = await this.prisma.staff.findFirst({
      where: { userId: s.staffUserId },
      select: { phone: true, status: true },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'STAFF_EMPLOYMENT_INACTIVE',
        message: '재직 상태가 아닌 계정입니다.',
      });
    }
    if (!staff.phone) {
      // 🔴 "보낼 곳이 없다"를 조용히 통과시키지 않는다 — 없으면 원격 등록은 성립하지 않는다
      throw new BadRequestException({
        code: 'REMOTE_FACTOR_CHANNEL_MISSING',
        message: '인사 정보에 등록된 연락처가 없어 원격 등록을 할 수 없습니다. 대면 등록을 이용하세요.',
      });
    }

    const result = await this.otp.send(staff.phone, STAFF_ENROLL_OTP_PURPOSE);
    s.remoteFactorChannel = staff.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2');
    await this.save(sessionId, s);
    this.publish(sessionId, 'PENDING', { remoteFactor: 'SENT' });
    return {
      channel: s.remoteFactorChannel,
      sent: result.sent,
      delivery: result.delivery,
      message: result.message,
      expiresInSeconds: result.expiresInSeconds,
    };
  }

  async verifyRemoteFactor(sessionId: string, code: string) {
    const s = await this.load(sessionId);
    if (s.enrollMode !== 'REMOTE') {
      throw new BadRequestException({ code: 'REMOTE_FACTOR_NOT_APPLICABLE', message: '대면 등록 세션입니다.' });
    }
    const staff = await this.prisma.staff.findFirst({
      where: { userId: s.staffUserId },
      select: { phone: true },
    });
    if (!staff?.phone) {
      throw new BadRequestException({ code: 'REMOTE_FACTOR_CHANNEL_MISSING', message: '등록된 연락처가 없습니다.' });
    }
    await this.otp.verify(staff.phone, code, STAFF_ENROLL_OTP_PURPOSE);
    s.remoteFactorVerified = true;
    await this.save(sessionId, s);
    this.publish(sessionId, 'PENDING', { remoteFactor: 'VERIFIED' });
    return { verified: true };
  }

  /** 등록 진행 상태 — 앱이 **다음 단계를 스스로 정하지 못하게** 서버가 nextAction 을 준다 */
  async enrollStatus(sessionId: string) {
    const s = await this.load(sessionId);
    const nextAction =
      s.status === 'PENDING'
        ? s.enrollMode === 'REMOTE' && !s.remoteFactorVerified
          ? 'REMOTE_FACTOR'
          : 'CLAIM'
        : s.status === 'VERIFYING'
          ? 'REGISTER_PASSKEY'
          : s.status === 'AWAITING_CONFIRM'
            ? 'WAIT_ADMIN_CONFIRM'
            : 'DONE';
    return {
      status: s.status,
      enrollMode: s.enrollMode,
      remoteFactorVerified: !!s.remoteFactorVerified,
      remoteFactorChannel: s.remoteFactorChannel ?? null,
      deviceId: s.deviceId ?? null,
      nextAction,
    };
  }

  // ── 직원 디바이스: 코드 입력 → 패스키 등록 옵션 (FR-30/32) ──
  async claim(sessionId: string, code: string) {
    const s = await this.load(sessionId);
    if (s.status !== 'PENDING') {
      throw new BadRequestException('이미 진행 중이거나 완료된 세션입니다.');
    }
    // FR-32: 발급 코드 일치 검증 + 시도 제한
    if (s.code !== code) {
      s.attempts += 1;
      if (s.attempts >= MAX_ATTEMPTS) {
        await this.redis.del(this.key(sessionId));
        this.publish(sessionId, 'PENDING', { failed: true });
        throw new BadRequestException({ code: 'ENROLL_LOCKED', message: '시도 횟수 초과로 세션이 폐기되었습니다.' });
      }
      await this.save(sessionId, s);
      throw new BadRequestException({
        code: 'ENROLL_CODE_INVALID',
        message: `인증번호가 일치하지 않습니다. (남은 시도 ${MAX_ATTEMPTS - s.attempts}회)`,
      });
    }

    /**
     * 🔴 원격 등록은 **6자리 코드만으로 완료할 수 없다.**
     *    종전에는 여기 주석이 "인사DB 매칭(+OTP는 후속 강화 TODO)" 였고 실제 2차 인증이 없었다 —
     *    QR/코드가 새어나가면 그것만으로 대상 직원의 패스키 등록 단계에 들어갈 수 있었다.
     *
     *    2차 요소는 **HR 에 미리 등록된 채널**로만 보낸다. 등록 화면에서 입력한 번호는 쓰지 않는다
     *    (그 번호를 쓰면 공격자가 자기 번호를 넣어 스스로 인증하게 된다).
     */
    if (s.enrollMode === 'REMOTE' && !s.remoteFactorVerified) {
      throw new BadRequestException({
        code: 'REMOTE_FACTOR_REQUIRED',
        message: '원격 등록은 등록된 연락처로 보낸 2차 인증을 먼저 완료해야 합니다.',
      });
    }

    // 본인확인: IN_PERSON=관리자 육안(사전), REMOTE=HR 채널 2차 인증(위에서 확인)
    s.status = 'VERIFYING';
    await this.save(sessionId, s);
    this.publish(sessionId, 'VERIFYING');

    // 패스키 등록 옵션 발급 (대상 직원 기준, 챌린지는 webauthn:reg:{staffUserId})
    const options = await this.passkey.getRegistrationOptions(s.staffUserId);
    return options;
  }

  // ── 직원 디바이스: 패스키 등록 검증 → StaffDevice 생성 (FR-30) ──
  async register(sessionId: string, code: string, response: RegistrationResponseJSON, deviceName?: string) {
    const s = await this.load(sessionId);
    if (s.status !== 'VERIFYING' || s.code !== code) {
      throw new BadRequestException('잘못된 등록 단계입니다.');
    }

    const finalName = deviceName ?? s.deviceName ?? '등록 기기';
    const cred = await this.passkey.verifyRegistration(s.staffUserId, response, finalName);

    /**
     * 🔴 credential 생성과 기기 연결 사이에서 실패하면 **기기에 묶이지 않은 ACTIVE 패스키**가 남는다.
     *    패스키 로그인은 기기가 없는 credential 을 레거시로 보고 통과시키므로(passkey.service),
     *    그 고아 credential 이 곧 관리자 확정을 건너뛴 로그인 수단이 된다.
     *    한 트랜잭션으로 묶고, 그래도 실패하면 **방금 만든 credential 을 폐기한다**(남겨두지 않는다).
     */
    let device: { id: string };
    try {
      device = await this.prisma.$transaction(async (tx) => {
        const d = await tx.staffDevice.create({
          data: {
            userId: s.staffUserId,
            deviceName: finalName,
            status: 'PENDING_CONFIRM',
            enrollChannel: 'ADMIN_QR',
            enrollMode: s.enrollMode,
            enrolledBy: s.adminId,
          },
        });
        await tx.webAuthnCredential.update({ where: { id: cred.id }, data: { deviceId: d.id } });
        return d;
      });
    } catch (e) {
      await this.prisma.webAuthnCredential
        .update({ where: { id: cred.id }, data: { status: 'REVOKED' } })
        .catch(() => undefined);
      this.logger.error(`기기 등록 실패 — 고아 패스키 폐기 cred=${cred.id}: ${(e as Error).message}`);
      throw e;
    }

    s.status = 'AWAITING_CONFIRM';
    s.deviceId = device.id;
    await this.save(sessionId, s);
    this.publish(sessionId, 'AWAITING_CONFIRM', { deviceId: device.id, deviceName: finalName });
    return { deviceId: device.id, deviceName: finalName };
  }

  // ── 관리자: 이중확인 → 등록 확정 (FR-30) ──
  async confirm(adminId: string, sessionId: string) {
    const s = await this.load(sessionId);
    if (s.status !== 'AWAITING_CONFIRM' || !s.deviceId) {
      throw new BadRequestException('확정 가능한 상태가 아닙니다.');
    }
    // 🔴 `verifiedAt` 은 스키마 기본값(`now()`) 때문에 **등록 시각**이 박혀 있다.
    //    관리자가 확정한 시각이 곧 병원이 이 기기를 승인한 시각이므로 여기서 다시 쓴다
    //    (확정한 관리자는 아래 감사 로그의 `userId` 에 남는다 — 기기 행에는 담을 자리가 없다).
    await this.prisma.staffDevice.update({
      where: { id: s.deviceId },
      data: { status: 'ACTIVE', verifiedAt: new Date() },
    });
    s.status = 'COMPLETED';
    await this.save(sessionId, s, 30);
    this.publish(sessionId, 'COMPLETED', { deviceId: s.deviceId });

    // FR-30: 본인 통지(무단등록 탐지) + 감사
    const n = await this.notify.create(s.staffUserId, {
      type: 'SECURITY',
      title: '새 기기가 등록되었습니다',
      message: '본인이 등록하지 않았다면 즉시 관리자에게 알리세요.',
      severity: 'WARNING',
      refType: 'StaffDevice',
      refId: s.deviceId,
    }).catch(() => null);
    if (n) this.notify.pushNotification(s.staffUserId, {
      id: n.id, type: 'SECURITY', title: n.title, message: n.message, severity: 'WARNING',
      refType: 'StaffDevice', refId: s.deviceId,
    });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'CREATE', resourceType: 'STAFF_DEVICE', resourceId: s.deviceId,
        changes: { action: 'ENROLL_CONFIRM', staffUserId: s.staffUserId, enrollMode: s.enrollMode } },
    }).catch(() => undefined);

    this.logger.log(`StaffDevice 등록 확정 device=${s.deviceId} by admin=${adminId}`);
    setTimeout(() => this.streams.delete(sessionId), 1000);
    return { deviceId: s.deviceId, status: 'ACTIVE' };
  }

  // ── 스태프 FCM 토큰 등록 (FR-42/49) — 3자 정합(디바이스=본인) ──
  async registerFcmToken(userId: string, fcmToken: string, deviceId?: string) {
    const device = deviceId
      ? await this.prisma.staffDevice.findFirst({ where: { id: deviceId, userId, status: 'ACTIVE' } })
      : await this.prisma.staffDevice.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { verifiedAt: 'desc' } });
    if (!device) throw new NotFoundException('등록된 활성 디바이스가 없습니다. 먼저 기기를 등록하세요.');
    await this.prisma.staffDevice.update({
      where: { id: device.id },
      data: { fcmToken, fcmTokenAt: new Date() },
    });
    return { deviceId: device.id };
  }

  // ── 관리자: 디바이스 목록 (FR-31) ──
  async list() {
    const devices = await this.prisma.staffDevice.findMany({
      where: { status: { not: 'REVOKED' } },
      include: { user: { select: { familyName: true, givenName: true, role: true, department: true } } },
      orderBy: { verifiedAt: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      status: d.status,
      enrollMode: d.enrollMode,
      staff: `${d.user.familyName}${d.user.givenName}`,
      role: d.user.role,
      department: d.user.department,
      verifiedAt: d.verifiedAt,
    }));
  }

  // ── 관리자: 디바이스 교체/해제 (FR-31) ──
  async revoke(adminId: string, deviceId: string, reason?: string) {
    const device = await this.prisma.staffDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('디바이스를 찾을 수 없습니다.');
    if (device.status === 'REVOKED') throw new ForbiddenException('이미 해제된 디바이스입니다.');

    await this.prisma.$transaction([
      this.prisma.webAuthnCredential.updateMany({
        where: { deviceId },
        data: { status: 'REVOKED' },
      }),
      this.prisma.staffDevice.update({
        where: { id: deviceId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason ?? null, fcmToken: null, fcmTokenAt: null },
      }),
    ]);

    /**
     * 🔴 기기를 끊는다는 것은 **그 기기로 하던 일 전부**를 끊는다는 뜻이다.
     *    종전에는 여기 `TODO` 만 있어서, 폐기 후에도
     *    ① 이미 발급된 access/refresh 세션이 살아 있었고
     *    ② 푸시가 그 기기로 계속 갔으며
     *    ③ 앱 설치 개별키가 ACTIVE 로 남았다.
     *    끊은 개수를 세어 감사에 남긴다 — **몇 개를 끊었는지 모르면 끊었다고 말할 수 없다.**
     */
    const revokedSessions = await this.auth
      .revokeSessionsByStaffDevice(device.userId, deviceId)
      .catch((e: Error) => {
        this.logger.error(`기기 폐기 — 세션 연쇄 실패 device=${deviceId}: ${e.message}`);
        return -1;
      });
    const revokedAppKeys = this.appKeys
      ? await this.appKeys.revokeByStaffDevice(deviceId, reason ?? 'DEVICE_REVOKED').catch((e: Error) => {
          this.logger.error(`기기 폐기 — 앱키 연쇄 실패 device=${deviceId}: ${e.message}`);
          return -1;
        })
      : 0;
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'UPDATE', resourceType: 'STAFF_DEVICE', resourceId: deviceId,
        changes: {
          action: 'REVOKE', staffUserId: device.userId, reason: reason ?? null,
          // 🔴 부분 실패는 `-1` 로 남긴다 — 실패를 0("끊을 것이 없었다")으로 접지 않는다
          cascade: { sessions: revokedSessions, appKeys: revokedAppKeys, fcmToken: 'CLEARED' },
        } },
    }).catch(() => undefined);
    this.logger.warn(
      `StaffDevice 해제 device=${deviceId} by admin=${adminId} reason=${reason ?? '-'} ` +
      `sessions=${revokedSessions} appKeys=${revokedAppKeys}`,
    );
    return {
      deviceId,
      status: 'REVOKED',
      cascade: { sessions: revokedSessions, appKeys: revokedAppKeys },
    };
  }
}
