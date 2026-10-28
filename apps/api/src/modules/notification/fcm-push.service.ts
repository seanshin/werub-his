import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * FCM Push Service — Firebase Cloud Messaging을 통한 환자 푸시 알림 발송
 *
 * firebase-admin이 설치되지 않은 환경에서는 graceful하게 비활성화됩니다.
 * 환경변수 GOOGLE_APPLICATION_CREDENTIALS 또는 FCM_SERVICE_ACCOUNT_JSON이 있을 때만 활성화.
 */
@Injectable()
export class FcmPushService implements OnModuleInit {
  private readonly logger = new Logger(FcmPushService.name);
  private messaging: any = null; // firebase-admin.messaging.Messaging
  private enabled = false;

  constructor(private readonly prisma: PrismaService, @Optional() private readonly configRuntime?: ConfigRuntimeService) {}

  async onModuleInit() {
    try {
      const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
      const hasCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS || serviceAccountJson;
      if (!hasCredentials) {
        this.logger.warn('No Firebase credentials found — FCM push disabled');
        return;
      }

      // firebase-admin v13 모듈러 API(subpath) — 레거시 admin.messaging() 동적 import 인터롭 회피.
      // @ts-ignore — firebase-admin is optional dependency
      const appMod = await import('firebase-admin/app').catch(() => null);
      // @ts-ignore — firebase-admin is optional dependency
      const msgMod = await import('firebase-admin/messaging').catch(() => null);
      if (!appMod || !msgMod) {
        this.logger.warn('firebase-admin not installed — FCM push disabled');
        return;
      }
      const { initializeApp, applicationDefault, cert, getApps } = appMod;
      const { getMessaging } = msgMod;

      const apps = getApps();
      const app = apps.length
        ? apps[0]
        : initializeApp({
            credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault(),
          });
      this.messaging = getMessaging(app);
      this.enabled = true;
      this.logger.log('FCM Push Service initialized');
    } catch (e) {
      this.logger.warn(`FCM init failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** FCM 토큰 등록/갱신 */
  async registerToken(accountId: string, deviceId: string, fcmToken: string) {
    await this.prisma.patientDevice.updateMany({
      where: { accountId, deviceId },
      data: { fcmToken },
    });
    this.logger.debug(`FCM token registered for account ${accountId}, device ${deviceId}`);
  }

  /** 특정 환자 계정에 푸시 알림 발송 */
  async sendToAccount(accountId: string, payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<{ sent: number; failed: number }> {
    if (!this.enabled) {
      this.logger.debug('FCM disabled — skipping push');
      return { sent: 0, failed: 0 };
    }

    // 알림 설정 확인
    const settings = await this.prisma.notificationSetting.findMany({
      where: { accountId },
    });
    // pushEnabled가 명시적으로 false인 타입이 있으면 해당 타입 스킵
    // 전체 푸시가 꺼져있는지 확인 (type='GLOBAL' pushEnabled=false)
    const globalSetting = settings.find(s => s.type === 'GLOBAL');
    if (globalSetting && !globalSetting.pushEnabled) {
      this.logger.debug(`Push disabled for account ${accountId}`);
      return { sent: 0, failed: 0 };
    }

    // 활성 기기의 FCM 토큰 조회
    const devices = await this.prisma.patientDevice.findMany({
      where: { accountId, isActive: true, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });

    if (devices.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const tokens = devices.map(d => d.fcmToken!).filter(Boolean);
    if (tokens.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data ?? {},
        android: {
          priority: 'high' as const,
          notification: { channelId: 'hospital-run', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });

      sent = response.successCount ?? 0;
      failed = response.failureCount ?? 0;

      // 실패한 토큰 비활성화 (등록 해제된 토큰)
      if (response.responses) {
        const invalidTokenIds: string[] = [];
        response.responses.forEach((resp: any, idx: number) => {
          if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
            invalidTokenIds.push(devices[idx].id);
          }
        });
        if (invalidTokenIds.length > 0) {
          await this.prisma.patientDevice.updateMany({
            where: { id: { in: invalidTokenIds } },
            data: { fcmToken: null },
          });
          this.logger.log(`Cleared ${invalidTokenIds.length} invalid FCM tokens`);
        }
      }

      this.logger.debug(`FCM sent to account ${accountId}: ${sent} success, ${failed} failed`);
    } catch (e) {
      this.logger.error(`FCM send failed: ${e instanceof Error ? e.message : String(e)}`);
      failed = tokens.length;
    }

    return { sent, failed };
  }

  /** 임의 FCM 토큰들에 직접 발송 (스태프 호출·Code, FR-42/48/49). 페이로드 비식별 권장. */
  async sendToTokens(
    tokens: string[],
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<{ sent: number; failed: number }> {
    if (!this.enabled) {
      this.logger.debug('FCM disabled — skipping staff push');
      return { sent: 0, failed: 0 };
    }
    const valid = tokens.filter(Boolean);
    if (!valid.length) return { sent: 0, failed: 0 };
    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens: valid,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { priority: 'high' as const, notification: { channelId: 'hospital-run', sound: 'default' } },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      });
      return { sent: response.successCount ?? 0, failed: response.failureCount ?? 0 };
    } catch (e) {
      this.logger.error(`FCM sendToTokens failed: ${e instanceof Error ? e.message : String(e)}`);
      return { sent: 0, failed: valid.length };
    }
  }

  /** PatientNotification 생성 시 자동 푸시 */
  async pushPatientNotification(notificationId: string) {
    const notification = await this.prisma.patientNotification.findUnique({
      where: { id: notificationId },
      select: { accountId: true, title: true, body: true, type: true, data: true },
    });
    if (!notification) return;

    // 타입별 설정 확인
    const typeSetting = await this.prisma.notificationSetting.findFirst({
      where: { accountId: notification.accountId, type: notification.type },
    });
    if (typeSetting && !typeSetting.pushEnabled) return;

    const dataPayload: Record<string, string> = {
      notificationId,
      type: notification.type,
    };
    if (notification.data && typeof notification.data === 'object') {
      Object.entries(notification.data as Record<string, unknown>).forEach(([k, v]) => {
        dataPayload[k] = String(v);
      });
    }

    // P0-4(배치중립 N3): FCM은 Google 경유 — 임상 문구가 제3자 인프라를 지나지 않도록 제네릭 본문 기본.
    // 상세는 앱 내 조회(data의 notificationId로 딥링크). push.genericBody=false로만 원문 푸시(비권장).
    const generic = String((await this.configRuntime?.get('push.genericBody').catch(() => 'true')) ?? 'true') !== 'false';
    await this.sendToAccount(notification.accountId, {
      title: generic ? '새 알림' : notification.title,
      body: generic ? '새 알림이 도착했습니다 — 앱에서 확인하세요' : notification.body,
      data: dataPayload,
    });

    // sentVia 업데이트
    await this.prisma.patientNotification.update({
      where: { id: notificationId },
      data: { sentVia: 'PUSH' },
    }).catch(() => {});
  }

  get isEnabled() {
    return this.enabled;
  }
}
