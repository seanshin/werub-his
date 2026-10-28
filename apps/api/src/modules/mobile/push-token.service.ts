import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExternalCredentialsService } from './external-credentials.service';

export type PushRegisterResult = {
  registered: boolean;
  /** 🔴 등록은 됐지만 **발송 준비는 별개다** — 조용히 성공으로 접지 않는다 */
  deliveryReady: boolean;
  reason: string | null;
};

/**
 * 푸시 토큰 등록 — PUSH-01. 저장 위치는 스탭/환자로 나뉘지만 **모바일 계약은 하나**다.
 *
 * 🔴 Firebase 미설정 시 **조용히 성공으로 접지 않는다.** 토큰은 받아 두되
 *    `deliveryReady:false` 와 사유를 함께 돌려준다(요청서 PUSH-01 요구와 같다).
 */
@Injectable()
export class PushTokenService {
  private readonly logger = new Logger(PushTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ExternalCredentialsService,
  ) {}

  private deliveryState(): { ready: boolean; reason: string | null } {
    const ready = this.credentials.isConfigured('push.provider');
    return { ready, reason: ready ? null : 'PUSH_PROVIDER_NOT_CONFIGURED' };
  }

  async registerStaff(userId: string, input: { token: string; deviceId?: string }): Promise<PushRegisterResult> {
    const device = input.deviceId
      ? await this.prisma.staffDevice.findFirst({ where: { id: input.deviceId, userId } })
      : await this.prisma.staffDevice.findFirst({
          where: { userId, status: 'ACTIVE' },
          orderBy: { verifiedAt: 'desc' },
        });
    if (!device) {
      // 🔴 "등록 성공"이라 말하지 않는다 — 담을 기기가 없으면 그 알림은 아무 데도 가지 않는다
      throw new BadRequestException({
        code: 'DEVICE_ENROLLMENT_REQUIRED',
        message: '승인된 기기가 없어 푸시 토큰을 등록할 수 없습니다.',
      });
    }
    if (device.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'DEVICE_NOT_ACTIVE', message: '승인되지 않은 기기입니다.' });
    }
    await this.prisma.staffDevice.update({
      where: { id: device.id },
      data: { fcmToken: input.token, fcmTokenAt: new Date() },
    });
    const d = this.deliveryState();
    return { registered: true, deliveryReady: d.ready, reason: d.reason };
  }

  async registerPatient(
    accountId: string,
    input: { token: string; deviceId: string; platform?: string; appVersion?: string; osVersion?: string },
  ): Promise<PushRegisterResult> {
    await this.prisma.patientDevice.upsert({
      where: { accountId_deviceId: { accountId, deviceId: input.deviceId } },
      create: {
        accountId,
        deviceId: input.deviceId,
        platform: input.platform ?? 'iOS',
        appVersion: input.appVersion ?? null,
        osVersion: input.osVersion ?? null,
        fcmToken: input.token,
      },
      update: {
        fcmToken: input.token,
        lastActiveAt: new Date(),
        ...(input.appVersion ? { appVersion: input.appVersion } : {}),
        ...(input.osVersion ? { osVersion: input.osVersion } : {}),
      },
    });
    const d = this.deliveryState();
    return { registered: true, deliveryReady: d.ready, reason: d.reason };
  }

  async unregisterStaff(userId: string, deviceId?: string) {
    const r = await this.prisma.staffDevice.updateMany({
      where: { userId, ...(deviceId ? { id: deviceId } : {}) },
      data: { fcmToken: null, fcmTokenAt: null },
    });
    return { cleared: r.count };
  }

  async unregisterPatient(accountId: string, deviceId?: string) {
    const r = await this.prisma.patientDevice.updateMany({
      where: { accountId, ...(deviceId ? { deviceId } : {}) },
      data: { fcmToken: null },
    });
    return { cleared: r.count };
  }

  /** readiness — 🔴 미설정이 초록으로 보이지 않게 한다 */
  readiness() {
    const d = this.deliveryState();
    return { provider: 'FCM', ready: d.ready, reason: d.reason };
  }
}
