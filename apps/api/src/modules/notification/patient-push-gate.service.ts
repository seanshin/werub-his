import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { FcmPushService } from './fcm-push.service';
import {
  PATIENT_PUSH_MASTER_KEY,
  PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY,
  PATIENT_PUSH_QUIET_HOURS_KEY,
  PATIENT_PUSH_TYPES,
  PATIENT_PUSH_TYPE_LIST,
  isQuietHour,
  kstHour,
  normalizeQueueNearAhead,
  normalizeQuietHours,
  patientPushResult,
  type PatientPushResult,
  type PatientPushType,
} from './patient-push.contract';

/**
 * 환자 푸시 대외 발신 게이트 — **판정과 쓰기의 유일한 자리**.
 *
 * 발행부(대기열 호출·조제 검수·검사 확정·수납 생성)는 "사실이 참이 됐다"만 이벤트로 알리고,
 * 켜짐(마스터 AND 타입별)·야간 억제·중복 억제 판정은 여기서만 한다.
 *
 * 🔴 꺼져 있을 때 조용히 통과하지 않는다 — 왜 안 나갔는지를 로그로 남기고 `reason` 으로 돌려준다.
 *    "켰는데 안 나간다"를 사람이 알 수 있어야 한다.
 * 🔴 계정이 없는 것은 실패가 아니다(앱 미설치) — 그러나 "보냈다"고도 하지 않는다(`NO_PATIENT_ACCOUNT`).
 */
@Injectable()
export class PatientPushGateService {
  private readonly logger = new Logger(PatientPushGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmPush: FcmPushService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** SystemConfig boolean — 미설정/형식 위반은 false(기본 OFF). 문자열 'true' 도 받는다(관리 화면 호환) */
  private async flag(key: string): Promise<boolean> {
    const v = await this.config?.get(key).catch(() => null);
    return v === true || v === 'true';
  }

  /**
   * 원장 쓰기 — PatientNotification 생성 + FCM 발송 예약.
   * 🔴 유일한 쓰기 경로다(listener 의 `createPatientPush` 도 여기로 위임한다 — 정본이 둘이 되지 않게).
   * @returns 계정이 없어 만들지 못했으면 false(실패가 아니라 "보낼 곳이 없음")
   */
  async rawCreate(
    patientId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<boolean> {
    const account = await this.prisma.patientAccount.findFirst({ where: { patientId } });
    if (!account) return false;

    const pn = await this.prisma.patientNotification.create({
      data: { accountId: account.id, type, title, body, ...(data ? { data: data as never } : {}) },
    });

    this.fcmPush
      .pushPatientNotification(pn.id)
      .catch((e) => this.logger.warn(`FCM push failed for ${type}: ${e instanceof Error ? e.message : String(e)}`));

    this.logger.debug(`Patient push: ${type} → ${patientId}`);
    return true;
  }

  /**
   * 게이트를 거쳐 보낸다. 판정 순서는 **사람이 이해할 수 있는 순서**로 둔다 —
   * 요청 여부 → 마스터 → 타입 → 야간 → 계정 → 중복.
   * (요청하지도 않은 것을 "설정이 꺼져 있어 미발송"이라 말하면 설정을 켜라고 오해한다.)
   */
  async deliver(
    patientId: string,
    type: PatientPushType,
    title: string,
    body: string,
    opts?: { requested?: boolean; data?: Record<string, unknown>; now?: Date },
  ): Promise<PatientPushResult> {
    const def = PATIENT_PUSH_TYPES[type];
    if (!def) {
      // 배선되지 않은 유형 — 계약에 없으면 보내지 않는다(등록부·설정·억제가 정의되지 않았다)
      this.logger.warn(`환자 푸시 미배선 유형: ${type} — 발송하지 않음`);
      return patientPushResult('NOT_APPLICABLE');
    }

    if (def.requiresOptIn && opts?.requested !== true) {
      this.logger.debug(`환자 푸시 미요청 — 발송하지 않음(type=${type}·notifyPatient 미체크)`);
      return patientPushResult('NOT_REQUESTED');
    }

    if (!(await this.flag(PATIENT_PUSH_MASTER_KEY))) {
      this.logger.warn(
        `환자 푸시: 설정으로 꺼져 있어 발송하지 않음(type=${type} · ${PATIENT_PUSH_MASTER_KEY}=false)`,
      );
      return patientPushResult('DISABLED_BY_CONFIG');
    }
    if (!(await this.flag(def.configKey))) {
      this.logger.warn(`환자 푸시: 설정으로 꺼져 있어 발송하지 않음(type=${type} · ${def.configKey}=false)`);
      return patientPushResult('TYPE_DISABLED');
    }

    if (!def.quietHoursExempt) {
      const quiet = normalizeQuietHours(await this.config?.get(PATIENT_PUSH_QUIET_HOURS_KEY).catch(() => null));
      const hour = kstHour(opts?.now);
      if (isQuietHour(hour, quiet)) {
        // 🔴 예약 발송 큐가 없다 — 지연이 아니라 미발송이다. 그렇게 적는다.
        this.logger.debug(
          `환자 푸시: 야간 억제로 발송하지 않음(type=${type} · KST ${hour}시 · 창 ${quiet.startHour}~${quiet.endHour}시 · 재시도 없음)`,
        );
        return patientPushResult('QUIET_HOURS');
      }
    }

    try {
      const account = await this.prisma.patientAccount.findFirst({
        where: { patientId },
        select: { id: true },
      });
      if (!account) {
        this.logger.debug(`환자 푸시: 환자앱 계정 없음 — 보낼 곳이 없다(type=${type})`);
        return patientPushResult('NO_PATIENT_ACCOUNT');
      }

      // 중복 억제 — 선례 `schedule.service` 도착확인(10분). 같은 계정·같은 유형·억제 창.
      const recent = await this.prisma.patientNotification.findFirst({
        where: {
          accountId: account.id,
          type,
          createdAt: { gte: new Date((opts?.now?.getTime() ?? Date.now()) - def.dedupMinutes * 60_000) },
        },
        select: { id: true },
      });
      if (recent) {
        this.logger.debug(`환자 푸시: ${def.dedupMinutes}분 내 동일 알림 존재 — 억제(type=${type})`);
        return patientPushResult('DUPLICATE_SUPPRESSED');
      }

      const created = await this.rawCreate(patientId, type, title, body, { ...(opts?.data ?? {}), route: def.route });
      // 🔴 인앱 알림 생성과 **단말 푸시**는 다른 층이다. FCM 자격이 없으면 원장에는 남지만
      //    폰은 울리지 않는다 — 화면이 `sent:true` 를 "폰으로 갔다"로 읽지 않게 상태를 함께 낸다.
      const channel = this.fcmPush.isEnabled ? 'ATTEMPTED' : 'UNAVAILABLE';
      if (created && !this.fcmPush.isEnabled) {
        this.logger.warn(`환자 푸시 ${type}: 앱 알림은 기록됐으나 FCM 자격이 없어 단말 푸시는 나가지 않았다`);
      }
      return patientPushResult(created ? 'SENT' : 'NO_PATIENT_ACCOUNT', channel);
    } catch (e) {
      this.logger.warn(`환자 푸시 ${type} 실패: ${e instanceof Error ? e.message : String(e)}`);
      return patientPushResult('ERROR');
    }
  }

  /**
   * 현재 설정 — 관리 화면이 토글을 그릴 수 있게. 🔴 값을 지어내지 않는다(미설정=false 를 그대로 낸다).
   */
  async settings() {
    const quiet = normalizeQuietHours(await this.config?.get(PATIENT_PUSH_QUIET_HOURS_KEY).catch(() => null));
    const hour = kstHour();
    const master = await this.flag(PATIENT_PUSH_MASTER_KEY);
    // 차례 임박 기준(원내 정책 · 기본값 없음) — 미설정이면 유형을 켜도 만들지 않는다(발행부가 기준을 읽는다)
    const queueNearAhead = normalizeQueueNearAhead(await this.config?.get(PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY));
    const types = [];
    for (const d of PATIENT_PUSH_TYPE_LIST) {
      const enabled = await this.flag(d.configKey);
      const thresholdUnset = d.type === 'QUEUE_NEAR' && queueNearAhead == null;
      types.push({
        type: d.type,
        label: d.label,
        configKey: d.configKey,
        enabled,
        /** 마스터 AND 타입(AND 차례 임박 기준) — 한쪽만 보면 "켰는데 안 나간다"가 된다 */
        effective: master && enabled && !thresholdUnset,
        /** 켰는데 안 나가는 이유 — 화면이 그대로 말한다 */
        blockedBy: !enabled ? null : !master ? ('MASTER_OFF' as const) : thresholdUnset ? ('THRESHOLD_UNSET' as const) : null,
        ...(d.type === 'QUEUE_NEAR' ? { threshold: { key: PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY, aheadCount: queueNearAhead } } : {}),
        requiresOptIn: d.requiresOptIn,
        quietHoursExempt: d.quietHoursExempt,
        quietHoursNote: d.quietHoursNote,
        dedupMinutes: d.dedupMinutes,
        alertCode: d.alertCode,
      });
    }
    return {
      master: { key: PATIENT_PUSH_MASTER_KEY, enabled: master },
      /**
       * 🔴 **단말 푸시 층** — 설정을 다 켜도 FCM 자격이 없으면 폰은 울리지 않는다
       * (원장에는 남으므로 환자가 **앱을 열면** 본다). 설정 화면이 이 사실을 말해야
       * "켰는데 왜 안 와요"가 생기지 않는다.
       */
      pushChannel: {
        available: this.fcmPush.isEnabled,
        note: this.fcmPush.isEnabled
          ? '단말 푸시 발송을 시도합니다(도달까지 보장하지는 않습니다)'
          : 'FCM 자격이 설정되지 않았습니다 — 앱 알림은 기록되지만 단말 푸시는 나가지 않습니다',
      },
      quietHours: {
        key: PATIENT_PUSH_QUIET_HOURS_KEY,
        startHour: quiet.startHour,
        endHour: quiet.endHour,
        timezone: 'Asia/Seoul',
        nowKstHour: hour,
        inQuietHoursNow: isQuietHour(hour, quiet),
        /** 🔴 억제는 지연 발송이 아니다 — 창 안에 발생한 비예외 알림은 발송되지 않고 사라진다 */
        deferred: false,
      },
      types,
    };
  }
}
