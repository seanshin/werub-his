import { joinPatientName } from '@hospital-run/shared';
import { JourneyService } from '../journey/journey.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { NotificationService } from './notification.service';
import { FcmPushService } from './fcm-push.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PatientPushGateService } from './patient-push-gate.service';
import { patientPushResult, type PatientPushResult } from './patient-push.contract';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly fcmPush: FcmPushService,
    private readonly prisma: PrismaService,
    private readonly patientPush: PatientPushGateService,
    @Optional() private readonly config?: ConfigRuntimeService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /**
   * 직원 알림 정책 오버라이드(§7 P1) — config `notification.policy` 의 유형별 항목에서
   * 대상 roles·중복 억제 시간(dedupHours)만 개정 가능. 형식 위반·미설정 유형=코드 기본(fail-safe).
   * 미등록 role 문자열은 무시(전 항목 무효면 기본 roles 유지 — 통보 공백 방지).
   */
  private async policyFor(type: string, defaults: { roles: string[]; dedupHours: number }) {
    const raw = await this.config?.get('notification.policy').catch(() => null);
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[type] : null;
    const e = (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}) as { roles?: unknown; dedupHours?: unknown };
    const validRoles = Array.isArray(e.roles)
      ? (e.roles as unknown[]).filter((r): r is UserRole => typeof r === 'string' && r in UserRole)
      : [];
    const dedupNum = Number(e.dedupHours);
    return {
      roles: validRoles.length ? validRoles : (defaults.roles as UserRole[]),
      dedupHours: Number.isFinite(dedupNum) && dedupNum >= 0 ? dedupNum : defaults.dedupHours,
    };
  }

  /** 정책 대상 역할의 활성 사용자 — 브로드캐스트 수신자 */
  private async policyTargets(roles: UserRole[]) {
    return this.prisma.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
  }

  @OnEvent('imaging.report_completed')
  async handleImagingReportCompleted(payload: {
    orderId: string;
    accessionNumber: string;
    patientId?: string;
    encounterId?: string;
    finding?: string;
    impression?: string;
  }) {
    try {
      // Find the ordering doctor via encounter
      if (!payload.encounterId) return;

      const encounter = await this.prisma.encounter.findUnique({
        where: { id: payload.encounterId },
        select: {
          doctorId: true,
          patient: { select: { familyName: true, givenName: true } },
        },
      });
      if (!encounter) return;

      const patientName = `${encounter.patient?.familyName || ''}${encounter.patient?.givenName || ''}`;

      const notification = await this.notificationService.create(encounter.doctorId, {
        type: 'IMAGING_REPORT',
        title: '영상 판독 완료',
        message: `${patientName} 환자의 영상 판독이 완료되었습니다. ${payload.impression ? `소견: ${payload.impression.slice(0, 100)}` : ''}`,
        severity: 'INFO',
        refType: 'ORDER',
        refId: payload.orderId,
      });

      // SSE 실시간 푸시
      this.notificationService.pushNotification(encounter.doctorId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        refType: notification.refType ?? undefined,
        refId: notification.refId ?? undefined,
      });

      this.logger.log(`Notification sent to doctor for order ${payload.orderId}`);
    } catch (e) {
      this.logger.error(
        `Failed to create imaging report notification`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * 🔴 2026-08-20 — 이 리스너는 **개통 이래 한 번도 발화한 적이 없다.**
   *
   * 구독은 `lab.result_completed`(밑줄)인데 실제 발행은 `lab.result.completed`(점)다
   * (`lab.service.ts:412·1047` · 다른 구독자 3곳은 점 표기를 쓰고 있었다). 어휘가 갈라져
   * **직원 검사 알림이 한 번도 나가지 않았다.**
   *
   * 이름만 고치면 그 순간 **모든 검사 완료마다** 주치의에게 알림이 나간다 — 게이트도 억제도 없이.
   * 그래서 함께 붙였다:
   *  · 설정 게이트 `notification.staffLabResult.enabled` — **기본 OFF**
   *    (켜는 것은 원내 위원회 결정 `policy.labResult.staffNotify` — `/admin/decisions`)
   *  · 🔴 **위급값 결과는 건너뛴다** — `lab.critical.value` 가 더 급한 경로로 이미 알린다.
   *    같은 사실을 두 번 알리면 급한 쪽이 묻힌다
   *  · 중복 억제 60분(같은 의사·같은 오더)
   *
   * 🔴 페이로드에 `testName` 이 없다(실측) — 문구는 '검사'로 나간다. 지어내지 않는다.
   */
  @OnEvent('lab.result.completed')
  async handleLabResultCompleted(payload: {
    orderId: string;
    patientId?: string;
    encounterId?: string;
    testName?: string;
    hasCritical?: boolean;
  }) {
    try {
      if (!payload.encounterId) return;

      // 🔴 꺼져 있으면 조용히 통과하지 않는다 — 왜 안 갔는지 남긴다
      //
      // 🔴 (2026-09-17 L2) 종전 `.catch(() => false)` 는 **조회 실패까지 "설정=false"** 로 적었다.
      //    `config.get()` 은 미설정 키에 `null` 을 돌려주므로 그 catch 가 삼킨 것은 실패뿐인데,
      //    로그는 `notification.staffLabResult.enabled=false` 라고 **설정을 단정**했다.
      //    관리자가 끈 것과 못 읽은 것은 다른 사실이다 — 실패는 실패로 남기고 이번 발송만 건너뛴다.
      let on: boolean;
      try {
        on = (await this.config?.get('notification.staffLabResult.enabled')) === true;
      } catch (e) {
        this.logger.error(`직원 검사 알림: 설정 조회 실패로 이번 발송을 건너뜀(order=${payload.orderId}) — 꺼져 있다는 뜻이 아니다: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!on) {
        this.logger.debug(`직원 검사 알림: 설정으로 꺼져 있어 발송하지 않음(order=${payload.orderId} · notification.staffLabResult.enabled=false)`);
        return;
      }
      // 🔴 위급값은 `lab.critical.value` 가 이미 더 급하게 알린다 — 여기서 또 보내면 그쪽이 묻힌다
      if (payload.hasCritical) {
        this.logger.debug(`직원 검사 알림: 위급값 포함 결과라 일반 알림은 생략(위급 경로가 담당) order=${payload.orderId}`);
        return;
      }

      const encounter = await this.prisma.encounter.findUnique({
        where: { id: payload.encounterId },
        select: {
          doctorId: true,
          patient: { select: { familyName: true, givenName: true } },
        },
      });
      if (!encounter) return;

      const patientName = `${encounter.patient?.familyName || ''}${encounter.patient?.givenName || ''}`;

      // 중복 억제 60분 — 같은 의사·같은 오더. 재검증·부분 확정이 여러 번 발행될 수 있다
      const recent = await this.prisma.notification.findFirst({
        where: {
          userId: encounter.doctorId, type: 'LAB_RESULT', refId: payload.orderId,
          createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
        },
        select: { id: true },
      });
      if (recent) {
        this.logger.debug(`직원 검사 알림: 60분 내 동일 알림 존재 — 억제(order=${payload.orderId})`);
        return;
      }

      const notification = await this.notificationService.create(encounter.doctorId, {
        type: 'LAB_RESULT',
        title: '검사 결과 완료',
        message: `${patientName} 환자의 ${payload.testName || '검사'} 결과가 완료되었습니다.`,
        severity: 'INFO',
        refType: 'ORDER',
        refId: payload.orderId,
      });

      // SSE 실시간 푸시
      this.notificationService.pushNotification(encounter.doctorId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        refType: notification.refType ?? undefined,
        refId: notification.refId ?? undefined,
      });

      // 주치의에게도 알림 (처방의와 다른 경우)
      await this.notifyAttendingDoctor(payload.patientId, encounter.doctorId, {
        type: 'LAB_RESULT',
        title: '담당 환자 검사 결과',
        message: `${patientName} 환자의 ${payload.testName || '검사'} 결과가 완료되었습니다.`,
        severity: 'INFO',
        refType: 'ORDER',
        refId: payload.orderId,
      });

      this.logger.log(`Notification sent to doctor for lab order ${payload.orderId}`);
    } catch (e) {
      this.logger.error(
        `Failed to create lab result notification`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /** 위급검사값(Critical Value) 자동 통보 + read-back 확인 추적 — IPSG.2 */
  @OnEvent('lab.critical.value')
  async handleCriticalValue(payload: {
    labResultId: string;
    orderId: string;
    patientId?: string;
    encounterId?: string;
    criticalValues: { testName: string; value: string; unit: string; reason: string }[];
    message?: string;
  }) {
    try {
      // clinical.lab.criticalNotify 게이트(R9-②) — 🔴 fail-open: 명시적 false 일 때만 억제.
      // 억제 대상은 **통보(알림/푸시)뿐** — 위급값 영구기록(CriticalValueAlert)은 결과 저장
      // 트랜잭션에서 이미 확정 영속됐고(IPSG.2), 미확인 목록(getPendingCriticalAlerts)에도 그대로 뜬다.
      // 발행 4곳에 각자 끼우면 "넷에 각자"가 재발한다 — 게이트는 이 리스너 진입부 한 곳이다.
      const notifyEnabled = await this.config?.get('clinical.lab.criticalNotify').catch(() => null);
      if (notifyEnabled === false || notifyEnabled === 'false') {
        this.logger.warn(`위급검사값 통보 억제(clinical.lab.criticalNotify=false): labResult ${payload.labResultId} — 기록·미확인 목록은 유지됨`);
        return;
      }
      let doctorId: string | undefined;
      let patientName = '';
      if (payload.encounterId) {
        const encounter = await this.prisma.encounter.findUnique({
          where: { id: payload.encounterId },
          select: { doctorId: true, patient: { select: { familyName: true, givenName: true } } },
        });
        doctorId = encounter?.doctorId;
        patientName = `${encounter?.patient?.familyName || ''}${encounter?.patient?.givenName || ''}`;
      }

      // 위급값 영구 기록(CriticalValueAlert)은 결과 저장 흐름(lab.submitResult)에서 확정 영속 —
      // 리스너 실패로 read-back 레코드가 유실되던 것 봉합. 여기서는 담당의 알림/푸시만(best-effort).
      //
      // 🔴 담당의 미상(진료 맥락 없는 오더 등)일 때 종전엔 여기서 warn 후 return 했다.
      //    그런데 경보 레코드는 doctor_id=NULL 로 남고, 미확인 목록은 담당의로 조회한다 →
      //    **누구에게도 통보되지 않고 누구의 화면에도 뜨지 않는 고아 경보**가 된다(위급값 방치).
      //    여기서는 주치의 해석 경로(입원 주치의 → ChargeOfCare → 최근 진료의)로 한 번 더 찾아 통보한다.
      //    그래도 못 찾으면 조용히 끝내지 않는다 — LabService.getPendingCriticalAlerts 가
      //    담당의 미지정 경보를 DOCTOR·ADMIN 목록에 함께 실어 보이게 한다(진단검사 보드도 전건 표시).
      if (!doctorId) {
        this.logger.warn(`위급값 발생했으나 담당의 미상 (labResult ${payload.labResultId}) — 주치의 경로로 통보 시도`);
        const delivered = await this.notifyAttendingDoctor(payload.patientId, '', {
          type: 'CRITICAL_VALUE',
          title: '🚨 담당 환자 위급검사값 (담당의 미지정)',
          message: `${payload.message ?? payload.criticalValues.map((c) => `${c.testName} ${c.value}${c.unit}`).join(', ')} · read-back 확인 필요`,
          severity: 'CRITICAL',
          refType: 'LAB_RESULT',
          refId: payload.labResultId,
        });
        if (!delivered) {
          this.logger.error(
            `🔴 위급값 통보 대상 없음 — labResult ${payload.labResultId} (담당의·주치의 모두 미상). ` +
            `경보는 '담당의 미지정'으로 미확인 목록/진단검사 보드에 노출된다`,
          );
        }
        return;
      }

      // 2. 담당의 CRITICAL 알림 + 실시간 푸시
      const notification = await this.notificationService.create(doctorId, {
        type: 'CRITICAL_VALUE',
        title: '🚨 위급검사값 통보 (확인 필요)',
        message: `${patientName} — ${payload.message ?? payload.criticalValues.map((c) => `${c.testName} ${c.value}${c.unit}`).join(', ')} · read-back 확인 필요`,
        severity: 'CRITICAL',
        refType: 'LAB_RESULT',
        refId: payload.labResultId,
      });
      this.notificationService.pushNotification(doctorId, {
        id: notification.id, type: notification.type, title: notification.title,
        message: notification.message, severity: notification.severity,
        refType: notification.refType ?? undefined, refId: notification.refId ?? undefined,
      });

      // 3. 주치의(처방의와 다른 경우)에게도 통보
      await this.notifyAttendingDoctor(payload.patientId, doctorId, {
        type: 'CRITICAL_VALUE',
        title: '🚨 담당 환자 위급검사값',
        message: `${patientName} — ${payload.message ?? ''} · read-back 확인 필요`,
        severity: 'CRITICAL',
        refType: 'LAB_RESULT',
        refId: payload.labResultId,
      });

      this.logger.log(`위급값 통보 완료: labResult ${payload.labResultId} → 담당의 ${doctorId}`);
    } catch (e) {
      this.logger.error('위급값 통보 실패', e instanceof Error ? e.stack : String(e));
    }
  }

  /** B3 — 조기경보(EWS) 고위험/escalation 시 주치의 능동 통지(환자 악화 알림) */
  @OnEvent('ews.recorded')
  async handleEwsRecorded(payload: { patientId?: string; ewsId?: string; riskLevel?: string; totalScore?: number; escalationRequired?: boolean }) {
    try {
      if (!payload?.patientId || !payload?.ewsId) return;
      // 고위험 또는 escalation 필요 시에만 통지(과알림 방지)
      if (!(payload.escalationRequired || payload.riskLevel === 'HIGH')) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const high = payload.riskLevel === 'HIGH';
      const delivered = await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'EWS_ALERT',
        title: high ? '⚠ 조기경보 고위험(악화 의심)' : '⚠ 조기경보 상승(escalation)',
        message: `${name} — NEWS2 ${payload.totalScore ?? ''}점 (${payload.riskLevel ?? ''}) · 신속 평가 권고`,
        severity: high ? 'CRITICAL' : 'WARNING',
        refType: 'EWS',
        refId: payload.ewsId,
      });

      // 🔴 `escalation_notified` 는 컬럼만 있고 **쓰는 곳이 없었다** — 그래서 환자 안전바의
      //    '보고 미통보'(빨강) 배지가 통보 후에도 영원히 켜져 있었다. 거짓 경보는 진짜 경보를 죽인다.
      //    🔴 전송을 흉내내지 않는다 — 실제로 알림이 생성·푸시된 경우(delivered)에만 참으로 적는다.
      //       주치의·최근 진료의를 못 찾으면 아무도 통보받지 못한 것이 사실이고, 배지는 빨강으로 남는다.
      if (delivered) {
        await this.prisma.earlyWarningScore
          .update({ where: { id: payload.ewsId }, data: { escalationNotified: true, escalationNotifiedAt: new Date() } })
          .catch((e) => this.logger.warn(`EWS 통보 표기 실패 ews=${payload.ewsId}: ${e instanceof Error ? e.message : String(e)}`));
        this.logger.log(`EWS 악화 통지: patient ${payload.patientId} (${payload.riskLevel})`);
      } else if (payload.escalationRequired) {
        // 통보 대상을 못 찾은 상태 — 조용히 지나가면 '보고 미통보'의 원인을 아무도 모른다
        this.logger.warn(`EWS 에스컬레이션 통보 대상 없음(주치의·최근 진료의 부재) patient=${payload.patientId} ews=${payload.ewsId}`);
      }
    } catch (e) {
      this.logger.warn(`EWS 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 골든타임 프로토콜(STEMI/뇌졸중/패혈증) 활성화 시 담당의 능동 통지 */
  @OnEvent('goldenpathway.activated')
  async handleGoldenPathwayActivated(payload: { pathwayId?: string; patientId?: string; pathwayType?: string; primaryMetric?: string; targetMinutes?: number }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const delivered = await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'GOLDEN_PATHWAY_ALERT',
        title: `⏱ 골든타임 프로토콜 활성화 (${payload.pathwayType ?? ''})`,
        message: `${name} — ${payload.primaryMetric ?? ''} 목표 ${payload.targetMinutes ?? ''}분 · 시간-임계 대응`,
        severity: 'CRITICAL',
        refType: 'GOLDEN_PATHWAY',
        refId: payload.pathwayId,
      });
      if (delivered) this.logger.log(`골든타임 활성화 통지: patient ${payload.patientId} (${payload.pathwayType})`);
      else this.logger.warn(`골든타임 통지 대상(주치의/진료의) 없음 — 미전달: patient ${payload.patientId}`);
    } catch (e) {
      this.logger.warn(`골든타임 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 낙상 고위험 평가 시 주치의 능동 통지(낙상 예방 중재 트리거) */
  @OnEvent('fall.high')
  async handleFallHigh(payload: { patientId?: string; assessmentId?: string; score?: number }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const delivered = await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'FALL_RISK_ALERT',
        title: '⚠ 낙상 고위험',
        message: `${name} — 낙상 위험 ${payload.score ?? ''}점(HIGH) · 낙상 예방 중재 권고`,
        severity: 'WARNING',
        refType: 'FALL_RISK',
        refId: payload.assessmentId,
      });
      if (delivered) this.logger.log(`낙상 고위험 통지: patient ${payload.patientId} (${payload.score})`);
      else this.logger.warn;
    } catch (e) {
      this.logger.warn(`낙상 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 정신건강 자살위험 HIGH 평가 시 주치의 능동 통지(1:1 관찰·안전조치 트리거) */
  @OnEvent('psych.suicide.high')
  async handlePsychSuicideHigh(payload: { patientId?: string; examId?: string; trigger?: string; phq9Item9?: number | null }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      // 트리거 구분 — 수동 HIGH 분류인지, PHQ-9 문항9 양성(자살 사고)인지 명시.
      const cause = payload.trigger === 'PHQ9_ITEM9'
        ? `PHQ-9 문항9(자살 사고) 양성${payload.phq9Item9 != null ? `(${payload.phq9Item9}점)` : ''}`
        : '자살위험 HIGH 평가';
      const delivered = await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'SUICIDE_RISK_ALERT',
        title: '🚨 자살위험 고위험',
        message: `${name} — ${cause} · 1:1 관찰·안전조치 확인 권고`,
        severity: 'CRITICAL',
        refType: 'PSYCH_EXAM',
        refId: payload.examId,
      });
      if (delivered) this.logger.log;
      else this.logger.warn;
    } catch (e) {
      this.logger.warn(`자살위험 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 신생아 위중(5분 Apgar<7·NICU 입원) 시 산모 담당의 능동 통지(소아과/NICU 평가) */
  @OnEvent('newborn.critical')
  async handleNewbornCritical(payload: { deliveryId?: string; newbornId?: string; motherPatientId?: string; reasons?: string }) {
    try {
      if (!payload?.motherPatientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.motherPatientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const delivered = await this.notifyAttendingDoctor(payload.motherPatientId, '', {
        type: 'NEWBORN_CRITICAL_ALERT',
        title: '🚨 신생아 집중관리 필요',
        message: `${name} 산모 신생아 — ${payload.reasons ?? ''} · 소아과/NICU 평가 권고`,
        severity: 'CRITICAL',
        refType: 'NEWBORN',
        refId: payload.newbornId,
      });
      if (delivered) this.logger.log(`신생아 위중 통지: mother ${payload.motherPatientId} (${payload.reasons})`);
      else this.logger.warn;
    } catch (e) {
      this.logger.warn(`신생아 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 마약류 실사 불일치(유용 의심) 시 약사 · 관리자 능동 통지(대상은 알림 정책으로 바꿀 수 있다) */
  @OnEvent('controlled.discrepancy')
  async handleControlledDiscrepancy(payload: { stockId?: string; drugName?: string; deaSchedule?: string; location?: string; bookBalance?: string; countedQty?: string; discrepancy?: string }) {
    try {
      // 공개판: 기본 대상을 알림 등록부(alert-registry)와 같게 — 약사 · 관리자
      const policy = await this.policyFor('CONTROLLED_DISCREPANCY', { roles: ['PHARMACIST', 'ADMIN'], dedupHours: 0 });
      const admins = await this.policyTargets(policy.roles);
      const msg = `${payload.drugName ?? ''}(${payload.location ?? ''}) 실사 불일치 — 장부 ${payload.bookBalance ?? ''} vs 실사 ${payload.countedQty ?? ''} (차이 ${payload.discrepancy ?? ''}). 유용 여부 확인 필요`;
      for (const a of admins) {
        const n = await this.notificationService.create(a.id, {
          type: 'CONTROLLED_DISCREPANCY',
          title: '🚨 마약류 재고 불일치(유용 의심)',
          message: msg,
          severity: 'CRITICAL',
          refType: 'CS_STOCK',
          refId: payload.stockId,
        });
        this.notificationService.pushNotification(a.id, {
          id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity,
          refType: n.refType ?? undefined, refId: n.refId ?? undefined,
        });
      }
      this.logger.log;
    } catch (e) {
      this.logger.warn(`마약류 불일치 알림 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 주치의에게 알림 — 처방의와 다른 경우에만 */
  /** 신체보호대 점검 지연(점검 간격 초과)·처방 만료 시 주치의 능동 통지(순환/피부 점검·재오더). Cron 소스. */
  @OnEvent('restraint.overdue')
  async handleRestraintOverdue(payload: { patientId?: string; orderId?: string; reason?: string; lastCheckMinutesAgo?: number | null }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const expired = payload.reason === 'ORDER_EXPIRED';
      await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'RESTRAINT_ALERT',
        title: expired ? '⚠ 신체보호대 처방 만료' : '⚠ 신체보호대 점검 지연',
        // 🔴 점검 기록이 없으면 null — 종전엔 '점검 2시간+분 경과'라는 깨진 문장이 갔다(한 번도 점검하지 않은 것을 경과 시간으로 말하지 않는다)
        message: `${name} — ${expired ? '처방 기한 경과 · 재평가/재오더 필요' : payload.lastCheckMinutesAgo == null ? '점검 기록 없음 · 순환/피부 점검 필요' : `점검 ${payload.lastCheckMinutesAgo}분 경과 · 순환/피부 점검 필요`}`,
        severity: 'WARNING', refType: 'RESTRAINT', refId: payload.orderId,
      }, 6);
    } catch (e) { this.logger.warn(`보호대 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 낙상·욕창 등 위험 재평가 기한 초과 시 주치의 능동 통지(재평가 유도). Cron 소스. */
  @OnEvent('risk.reassessment.overdue')
  async handleRiskReassessmentOverdue(payload: { patientId?: string; scheduleId?: string; assessmentType?: string }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const label = payload.assessmentType === 'FALL_RISK' ? '낙상' : payload.assessmentType === 'PRESSURE_ULCER' ? '욕창' : (payload.assessmentType ?? '위험');
      await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'REASSESSMENT_OVERDUE',
        title: '⚠ 위험 재평가 기한 초과',
        message: `${name} — ${label} 위험 재평가 기한 경과 · 재평가 필요`,
        severity: 'WARNING', refType: 'RISK_REASSESSMENT', refId: payload.scheduleId,
      }, 12);
    } catch (e) { this.logger.warn(`재평가 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 적신호/치명 안전사건 — 질관리·경영진(ADMIN) 브로드캐스트 + 환자 주치의 통지(JCI QPS.7). */
  @OnEvent('incident.critical')
  async handleIncidentCritical(payload: { incidentId?: string; patientId?: string; severity?: string; type?: string }) {
    try {
      const sevLabel = payload.severity === 'SENTINEL' ? '적신호사건' : '치명 안전사건';
      const policy = await this.policyFor('SAFETY_INCIDENT_CRITICAL', { roles: ['ADMIN'], dedupHours: 6 });
      const admins = await this.policyTargets(policy.roles);
      for (const a of admins) {
        const recent = policy.dedupHours > 0
          ? await this.prisma.notification.findFirst({ where: { userId: a.id, type: 'SAFETY_INCIDENT_CRITICAL', refId: payload.incidentId, createdAt: { gte: new Date(Date.now() - policy.dedupHours * 3600 * 1000) } }, select: { id: true } })
          : null;
        if (recent) continue;
        const n = await this.notificationService.create(a.id, {
          type: 'SAFETY_INCIDENT_CRITICAL', title: `🚨 ${sevLabel} 보고`,
          message: `${payload.type ?? ''} — 즉시 통보 + 45일 내 근본원인분석(RCA) 필요(JCI QPS.7)`,
          severity: 'CRITICAL', refType: 'SAFETY_INCIDENT', refId: payload.incidentId,
        });
        this.notificationService.pushNotification(a.id, { id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined });
      }
      if (payload.patientId) {
        await this.notifyAttendingDoctor(payload.patientId, '', {
          type: 'SAFETY_INCIDENT_CRITICAL', title: `🚨 ${sevLabel}`,
          message: `담당 환자 안전사건(${payload.type ?? ''}) 발생 — 확인 필요`,
          severity: 'CRITICAL', refType: 'SAFETY_INCIDENT', refId: payload.incidentId,
        }, 6);
      }
      this.logger.log;
    } catch (e) { this.logger.warn(`안전사건 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** RCA 45일 기한 초과 — 담당(owner)·질관리(ADMIN) 통지. Cron 소스. */
  /**
   * 질 지표 경보(QI 흐름 2026-10-08) — 월 마감이 발행한다. 대상 = 지표 담당(있으면) + 질향상위원회(QPS) 위원 + 정책 역할(기본 관리자).
   * 🔴 판정 불가는 발행하지 않는다(월 마감이 미달만 낸다) · 같은 지표·달은 하루 한 번.
   */
  private async qiTargets(type: string, ownerId: string | null | undefined) {
    const targets = new Set<string>();
    if (ownerId) targets.add(ownerId);
    const policy = await this.policyFor(type, { roles: ['ADMIN'], dedupHours: 24 });
    (await this.policyTargets(policy.roles)).forEach((u) => targets.add(u.id));
    const qps = await this.prisma.committee.findUnique({ where: { code: 'QPS' }, select: { id: true } });
    if (qps) (await this.prisma.committeeMember.findMany({ where: { committeeId: qps.id, isActive: true }, select: { userId: true } })).forEach((m) => targets.add(m.userId));
    return { targets, dedupHours: policy.dedupHours };
  }

  /** 질 지표 알림 한 건 — 같은 사람·지표·제목은 dedupHours 안에 한 번 */
  private async notify(uid: string, m: { type: string; refId: string; title: string; message: string }, dedupHours: number) {
    const { type, refId, title, message } = m;
    const recent = dedupHours > 0
      ? await this.prisma.notification.findFirst({ where: { userId: uid, type, refId, title, createdAt: { gte: new Date(Date.now() - dedupHours * 3600 * 1000) } }, select: { id: true } })
      : null;
    if (recent) return;
    const n = await this.notificationService.create(uid, { type, title, message, severity: 'WARNING', refType: 'QUALITY_INDICATOR', refId });
    this.notificationService.pushNotification(uid, { id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined });
  }

  @OnEvent('qi.target.missed')
  async handleQiTargetMissed(p: { indicatorId: string; name: string; period: string; value: number; target: number; ownerId?: string | null }) {
    try {
      const { targets, dedupHours } = await this.qiTargets('QI_TARGET_MISSED', p.ownerId);
      for (const uid of targets) await this.notify(uid, { type: 'QI_TARGET_MISSED', refId: p.indicatorId, title: `질 지표 목표 미달 — ${p.name}`, message: `${p.period} 값 ${p.value} · 목표 ${p.target} — 질 지표 화면에서 관리도·개선 활동을 확인하십시오` }, dedupHours);
    } catch (e) { this.logger.warn(`질 지표 미달 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  @OnEvent('qi.measurement.missing')
  async handleQiMeasurementMissing(p: { indicatorId: string; name: string; period: string; ownerId?: string | null }) {
    try {
      const { targets, dedupHours } = await this.qiTargets('QI_MEASUREMENT_MISSING', p.ownerId);
      for (const uid of targets) await this.notify(uid, { type: 'QI_MEASUREMENT_MISSING', refId: p.indicatorId, title: `질 지표 측정 미입력 — ${p.name}`, message: `${p.period} 측정이 없습니다(자동 산출 공급원 없는 수기 지표) — 입력하거나 측정하지 않는 사유를 남기십시오` }, dedupHours);
    } catch (e) { this.logger.warn(`질 지표 미입력 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  @OnEvent('qi.indicator.directEdit')
  async handleQiDirectEdit(p: { indicatorId: string; name: string; fields: string[]; reason: string | null; actorId?: string }) {
    try {
      const { targets, dedupHours } = await this.qiTargets('QI_DEFINITION_CHANGED', null);
      if (p.actorId) targets.delete(p.actorId);
      for (const uid of targets) await this.notify(uid, { type: 'QI_DEFINITION_CHANGED', refId: p.indicatorId, title: `질 지표 정의·목표 직접 변경 — ${p.name}`, message: `변경 항목: ${p.fields.join(', ')} · 사유: ${p.reason ?? '-'} — 위원회 의결 경로를 거치지 않은 변경입니다` }, Math.min(dedupHours, 0));
    } catch (e) { this.logger.warn(`질 지표 직접 변경 통지 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  @OnEvent('rca.overdue')
  async handleRcaOverdue(payload: { rcaId?: string; incidentId?: string; owner?: string }) {
    try {
      const targets = new Set<string>();
      if (payload.owner) targets.add(payload.owner);
      const policy = await this.policyFor('RCA_OVERDUE', { roles: ['ADMIN'], dedupHours: 24 });
      const admins = await this.policyTargets(policy.roles);
      admins.forEach((a) => targets.add(a.id));
      for (const uid of targets) {
        const recent = policy.dedupHours > 0
          ? await this.prisma.notification.findFirst({ where: { userId: uid, type: 'RCA_OVERDUE', refId: payload.incidentId, createdAt: { gte: new Date(Date.now() - policy.dedupHours * 3600 * 1000) } }, select: { id: true } })
          : null;
        if (recent) continue;
        const n = await this.notificationService.create(uid, {
          type: 'RCA_OVERDUE', title: '⚠ RCA 기한 초과',
          message: '적신호사건 근본원인분석(RCA) 45일 기한 경과 — 완료·승인 필요',
          severity: 'WARNING', refType: 'SAFETY_INCIDENT', refId: payload.incidentId,
        });
        this.notificationService.pushNotification(uid, { id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined });
      }
    } catch (e) { this.logger.warn(`RCA 기한 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 전자간증 위험(중증 고혈압+요단백) 시 산모 담당의 능동 통지(P3). */
  @OnEvent('obgyn.preeclampsia')
  async handlePreeclampsia(payload: { patientId?: string; examId?: string; bloodPressure?: string; urineProtein?: string }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'PREECLAMPSIA_ALERT', title: '🚨 전자간증 위험',
        message: `${name} — 중증 고혈압(${payload.bloodPressure ?? ''}) + 요단백(${payload.urineProtein ?? ''}) · 전자간증 평가 권고`,
        severity: 'CRITICAL', refType: 'OBGYN_EXAM', refId: payload.examId,
      }, 6);
    } catch (e) { this.logger.warn(`전자간증 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 태아곤란(FHR 정상범위 이탈) 시 산모 담당의 능동 통지(P3). */
  @OnEvent('labor.fetal_distress')
  async handleFetalDistress(payload: { deliveryId?: string; patientId?: string; fhr?: number; type?: string }) {
    try {
      if (!payload?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const label = payload.type === 'BRADYCARDIA' ? '서맥' : '빈맥';
      await this.notifyAttendingDoctor(payload.patientId, '', {
        type: 'FETAL_DISTRESS_ALERT', title: '🚨 태아곤란 의심',
        message: `${name} — 태아심박수 ${payload.fhr ?? ''}bpm(${label}) · 즉시 평가 권고`,
        severity: 'CRITICAL', refType: 'DELIVERY', refId: payload.deliveryId,
      }, 1);
    } catch (e) { this.logger.warn(`태아곤란 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /**
   * 면역억제제 TDM 목표범위 이탈(2026-10-10) — 이식 수술의 + 환자 담당의(기록자 본인 제외) · 같은 TDM 행에 한 번.
   * 🔴 종전엔 기록한 사람의 화면 토스트가 전부였다(거부·독성 감시의 용량 조정이 기억에 기댔다).
   */
  @OnEvent('transplant.tdm.out_of_range')
  async handleTransplantTdmOutOfRange(payload: { transplantId?: string; tdmId?: string; patientId?: string; surgeonId?: string; recordedBy?: string | null; drug?: string; trough?: number | null; targetLow?: number | null; targetHigh?: number | null }) {
    try {
      if (!payload?.patientId || !payload.tdmId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } });
      const name = joinPatientName(p?.familyName, p?.givenName);
      const message = `${name} — ${payload.drug ?? ''} trough ${payload.trough ?? ''}(목표 ${payload.targetLow ?? ''}~${payload.targetHigh ?? ''}) · 용량 조정 검토`;
      const surgeonId = payload.surgeonId;
      const toSurgeon = !!surgeonId && surgeonId !== payload.recordedBy;
      if (toSurgeon && surgeonId) {
        const n = await this.notificationService.create(surgeonId, {
          type: 'TRANSPLANT_TDM_OUT_OF_RANGE', title: '⚠ 면역억제제 농도 목표범위 이탈', message,
          severity: 'WARNING', refType: 'TRANSPLANT', refId: payload.transplantId,
        });
        this.notificationService.pushNotification(surgeonId, { id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity ?? undefined, refType: n.refType ?? undefined, refId: n.refId ?? undefined });
      }
      // 담당의(입원 주치의·없으면 최근 진료의) — 방금 받은 수술의(또는 기록자 본인)면 다시 보내지 않는다
      await this.notifyAttendingDoctor(payload.patientId, (toSurgeon ? payload.surgeonId : payload.recordedBy) ?? '', {
        type: 'TRANSPLANT_TDM_OUT_OF_RANGE', title: '⚠ 면역억제제 농도 목표범위 이탈', message,
        severity: 'WARNING', refType: 'TRANSPLANT', refId: payload.transplantId,
      });
    } catch (e) { this.logger.warn(`TDM 이탈 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 완화의료 심한 통증(ESAS pain≥7) 시 담당의 능동 통지 — 통증 재평가·오피오이드 조정(P3). */
  @OnEvent('hospice.severe_pain')
  async handleHospiceSeverePain(payload: { registrationId?: string; assessmentId?: string; pain?: number }) {
    try {
      if (!payload?.registrationId) return;
      const reg = await this.prisma.hospiceRegistration.findUnique({ where: { id: payload.registrationId }, select: { patientId: true } });
      if (!reg?.patientId) return;
      const p = await this.prisma.patient.findUnique({ where: { id: reg.patientId }, select: { familyName: true, givenName: true } });
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      await this.notifyAttendingDoctor(reg.patientId, '', {
        type: 'HOSPICE_SEVERE_PAIN', title: '⚠ 완화의료 심한 통증',
        message: `${name} — ESAS 통증 ${payload.pain ?? ''}점(중증) · 통증 재평가·오피오이드 조정 권고`,
        severity: 'WARNING', refType: 'HOSPICE', refId: payload.assessmentId,
      }, 6);
    } catch (e) { this.logger.warn(`호스피스 통증 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** 진단검사 위험소견(critical result) — 오더 주치의 직접 통보 + 환자 주치의(closed-loop·R3). */
  @OnEvent('diagnostic.critical')
  async handleDiagnosticCritical(payload: { patientId?: string; testId?: string; testName?: string; criticalNote?: string; orderedBy?: string }) {
    try {
      const p = payload.patientId ? await this.prisma.patient.findUnique({ where: { id: payload.patientId }, select: { familyName: true, givenName: true } }) : null;
      const name = `${p?.familyName ?? ''}${p?.givenName ?? ''}`.trim();
      const noti = { type: 'DIAGNOSTIC_CRITICAL', title: '🚨 진단검사 위험소견', message: `${name} — ${payload.testName ?? ''} 위험소견(${payload.criticalNote ?? ''}) · 즉시 확인`, severity: 'CRITICAL', refType: 'DIAGNOSTIC_TEST', refId: payload.testId };
      if (payload.orderedBy) {
        const recent = await this.prisma.notification.findFirst({ where: { userId: payload.orderedBy, type: 'DIAGNOSTIC_CRITICAL', refId: payload.testId, createdAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) } }, select: { id: true } });
        if (!recent) {
          const n = await this.notificationService.create(payload.orderedBy, noti);
          this.notificationService.pushNotification(payload.orderedBy, { id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity, refType: n.refType ?? undefined, refId: n.refId ?? undefined });
        }
      }
      if (payload.patientId) await this.notifyAttendingDoctor(payload.patientId, payload.orderedBy ?? '', noti, 3);
    } catch (e) { this.logger.warn(`진단검사 위험소견 알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }

  private async notifyAttendingDoctor(
    patientId: string | undefined,
    orderingDoctorId: string,
    notificationData: { type: string; title: string; message: string; severity: string; refType?: string; refId?: string },
    dedupWithinHours?: number,
  ) {
    if (!patientId) return false;

    try {
      // 현재 입원 → ChargeOfCare → 주치의
      const admission = await this.prisma.admission.findFirst({
        where: { patientId, status: 'ADMITTED' },
        select: { id: true, attendingDoctorId: true },
      });
      let attendingId: string | null = null;
      if (admission) {
        const charge = await this.prisma.chargeOfCare.findFirst({
          where: { admissionId: admission.id, releasedAt: null, role: 'ATTENDING' },
          select: { doctorId: true },
        });
        attendingId = charge?.doctorId || admission.attendingDoctorId || null;
      }
      // 폴백 — 입원 주치의가 없으면(ER·외래 등) 최근 진료의에게 통지. 고위험 알림(골든타임·자살·낙상·신생아)이
      // 미입원 환자에서 아무에게도 전달되지 않던 문제 해소.
      if (!attendingId) {
        const enc = await this.prisma.encounter.findFirst({
          where: { patientId },
          orderBy: { createdAt: 'desc' },
          select: { doctorId: true },
        });
        attendingId = enc?.doctorId ?? null;
      }
      if (!attendingId || attendingId === orderingDoctorId) return false;

      // Cron 반복 통지 스팸 방지 — 최근 N시간 내 동일 대상·유형·대상건 통지가 있으면 재발송 생략.
      if (dedupWithinHours && notificationData.refId) {
        const since = new Date(Date.now() - dedupWithinHours * 3600 * 1000);
        const recent = await this.prisma.notification.findFirst({
          where: { userId: attendingId, type: notificationData.type, refId: notificationData.refId, createdAt: { gte: since } },
          select: { id: true },
        });
        if (recent) return false;
      }

      const notification = await this.notificationService.create(attendingId, {
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        severity: notificationData.severity,
        refType: notificationData.refType,
        refId: notificationData.refId,
      });

      this.notificationService.pushNotification(attendingId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        refType: notification.refType ?? undefined,
        refId: notification.refId ?? undefined,
      });

      this.logger.log(`Attending doctor ${attendingId} notified for patient ${patientId}`);
      return true;
    } catch (e) {
      this.logger.warn(`Failed to notify attending doctor: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  // ── 동의서 이벤트 ──

  @OnEvent('consent.created')
  async handleConsentCreated(payload: { consentId: string; patientId: string; doctorId?: string; consentType: string; templateName: string }) {
    try {
      // 1. 환자 알림 (PatientNotification)
      const account = await this.prisma.patientAccount.findFirst({ where: { patientId: payload.patientId } });
      if (account) {
        const pn = await this.prisma.patientNotification.create({
          data: {
            accountId: account.id,
            type: 'CONSENT',
            title: '동의서 서명 요청',
            body: `${payload.templateName} 동의서 서명이 필요합니다. 앱에서 확인해주세요.`,
            data: { consentId: payload.consentId, consentType: payload.consentType } as any,
          },
        });
        // FCM 푸시
        this.fcmPush.pushPatientNotification(pn.id).catch(e =>
          this.logger.warn(`FCM push failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      }

      // 2. 여정 이벤트
      this.journey?.emit({
          patientId: payload.patientId,
          eventType: 'CONSENT_REQUESTED', refType: 'ConsentForm', refId: payload.consentId, // 여정 P0-5
          title: '동의서 요청',
          description: `${payload.templateName} 동의서 서명 요청`,
          severity: 'WARNING',
        });

      this.logger.log(`Consent ${payload.consentId} → patient ${payload.patientId} notified`);
    } catch (e) {
      this.logger.warn(`Consent notification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @OnEvent('consent.patient_signed')
  async handleConsentPatientSigned(payload: { consentId: string; patientId: string; doctorId?: string; needsMoreSigners: boolean }) {
    try {
      // 의사에게 알림
      if (payload.doctorId) {
        await this.notificationService.create(payload.doctorId, {
          type: 'CONSENT_SIGNED',
          title: '환자 동의서 서명 완료',
          message: `환자가 동의서에 서명했습니다.${payload.needsMoreSigners ? ' 의사 서명이 필요합니다.' : ''}`,
          severity: 'INFO',
          refType: 'CONSENT',
          refId: payload.consentId,
        });
        this.notificationService.pushNotification(payload.doctorId, {
          id: payload.consentId, type: 'CONSENT_SIGNED', title: '환자 동의서 서명 완료',
          message: payload.needsMoreSigners ? '의사 서명이 필요합니다' : '서명 완료',
        });
      }

      // 여정 이벤트
      this.journey?.emit({
          patientId: payload.patientId,
          eventType: 'CONSENT_SIGNED', refType: 'ConsentForm', refId: payload.consentId, // 여정 P0-5
          title: '동의서 서명',
          description: '환자 동의서 서명 완료',
          severity: 'INFO',
        });
    } catch (e) {
      this.logger.warn(`Consent signed notification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @OnEvent('consent.completed')
  async handleConsentCompleted(payload: { consentId: string; patientId: string }) {
    try {
      this.journey?.emit({
          patientId: payload.patientId,
          eventType: 'CONSENT_COMPLETED', refType: 'ConsentForm', refId: payload.consentId, // 여정 P0-5
          title: '동의서 완료',
          description: '모든 서명이 완료되었습니다',
          severity: 'INFO',
        });
    } catch (e) {
      this.logger.warn(`Consent completed notification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 환자 여정 이벤트 → FCM 푸시 ──
  //
  // 🔴 아래 4종은 **대외 발신**이다(환자 휴대폰에 실제로 도달한다). 그래서 발화 여부는
  //    `PatientPushGateService` 한 곳이 정한다 — 마스터 AND 타입별 설정(기본 전부 OFF) ·
  //    직원이 누르는 것은 `notifyPatient` 옵트인 추가 필요 · 야간 억제 · 중복 억제.
  //    핸들러는 **문구만** 책임진다(문구는 개통 이래 여기 있던 것 그대로 — 지어내지 않았다).
  //    반환값(`PatientPushResult`)은 `emitAsync` 로 발행부에 되돌아가 화면이 사유를 그대로 말한다.
  //
  // 🔴 배선하지 않은 것: `admission.round_scheduled`(회진 **예정** 시각이 스키마에 없다 — `Round.roundedAt`
  //    은 회진이 끝난 시각이다) · `appointment.reminder`(리마인더 크론이 없고, 예약 통보 어댑터
  //    `APPOINTMENT_NOTIFY_ADAPTER` 가 미구현이다). 발화 지점이 없으므로 핸들러도 두지 않는다 —
  //    죽은 핸들러가 남아 있으면 다음 사람이 "있다"고 읽는다.

  @OnEvent('patient.called')
  async handlePatientCalled(payload: {
    patientId: string;
    departmentName?: string;
    roomName?: string;
    notifyPatient?: boolean;
  }): Promise<PatientPushResult> {
    return this.patientPush.deliver(
      payload.patientId,
      'CALLED',
      '진료 호출',
      `${payload.departmentName ?? '진료실'}에서 호출되었습니다. 진료실로 이동해주세요.`,
      { requested: payload.notifyPatient === true },
    );
  }

  /**
   * 진료 차례 임박(포털 B3 · 2026-10-26) — 발행부(대기열)가 기준·대기표 중복을 이미 걸렀다. 대기표 id 를 원장에 남긴다(두 번 보내지 않는 근거).
   * 문구에 이름·진료실을 싣지 않는다(잠금 화면) — 진료과와 앞 인원만.
   */
  @OnEvent('patient.queue_near')
  async handlePatientQueueNear(payload: { patientId: string; queueId: string; departmentName?: string; aheadCount: number }): Promise<PatientPushResult> {
    return this.patientPush.deliver(
      payload.patientId,
      'QUEUE_NEAR',
      '진료 차례가 다가왔습니다',
      payload.aheadCount > 0
        ? `${payload.departmentName ?? '진료과'} 앞 대기 ${payload.aheadCount}명입니다. 진료실 근처에서 기다려 주세요.`
        : `${payload.departmentName ?? '진료과'} 다음 차례입니다. 진료실 근처에서 기다려 주세요.`,
      { data: { queueId: payload.queueId } },
    );
  }

  @OnEvent('lab.patient_result_ready')
  async handlePatientLabResult(payload: { patientId: string; testName?: string }): Promise<PatientPushResult> {
    return this.patientPush.deliver(
      payload.patientId,
      'LAB_RESULT',
      '검사 결과 완료',
      `${payload.testName ?? '검사'} 결과가 나왔습니다. 앱에서 확인하세요.`,
    );
  }

  @OnEvent('billing.patient_pending')
  async handleBillingPending(payload: {
    patientId: string;
    amount?: number;
    notifyPatient?: boolean;
  }): Promise<PatientPushResult> {
    // 🔴 금액은 실제 본인부담금이 있을 때만 넣는다(없으면 핸들러 폴백 문구 — 지어내지 않는다)
    const amountStr = payload.amount ? ` (${payload.amount.toLocaleString()}원)` : '';
    return this.patientPush.deliver(
      payload.patientId,
      'BILLING',
      '수납 대기',
      `수납 처리가 필요합니다${amountStr}. 수납 창구를 방문해주세요.`,
      { requested: payload.notifyPatient === true },
    );
  }

  /**
   * 서류 발급 완료(개별) → 환자 앱(2026-10-10). 실손 번들 소속은 번들 알림이 맡는다(같은 것을 두 번 알리지 않는다).
   * 발행: `issuance.service.issue()`·`issueBGroup()` · 설정 둘 다 필요(기본 OFF) · 수령 방법에 따라 문구만 다르다.
   */
  @OnEvent('document.ready')
  async handleDocumentReadyForPatient(payload: { requestId: string; patientId: string }): Promise<PatientPushResult> {
    const req = await this.prisma.documentRequest.findUnique({ where: { id: payload.requestId }, select: { bundleId: true, deliveryMethod: true } });
    if (!req) return patientPushResult('NOT_APPLICABLE');
    if (req.bundleId) return patientPushResult('NOT_APPLICABLE');
    // 수령 방법별 완결 문장(조립하지 않는다)
    const body = req.deliveryMethod === 'PORTAL' ? '신청하신 서류가 발급되었습니다. 앱 서류발급에서 내려받을 수 있습니다.'
      : req.deliveryMethod === 'VISIT' ? '신청하신 서류가 발급되었습니다. 창구에서 수령하실 수 있습니다.'
        : '신청하신 서류가 발급되었습니다. 신청하신 방법으로 보내 드립니다.';
    return this.patientPush.deliver(payload.patientId, 'DOCUMENT_READY', '서류 발급 완료', body);
  }

  /** 서류 발급 반려 → 환자 앱(2026-10-10). 🔴 사유는 싣지 않는다(잠금 화면) — 앱의 신청 내역에서 본다 */
  @OnEvent('document.rejected')
  async handleDocumentRejectedForPatient(payload: { requestId: string; patientId: string }): Promise<PatientPushResult> {
    return this.patientPush.deliver(payload.patientId, 'DOCUMENT_REJECTED', '서류 발급 반려', '신청하신 서류가 반려되었습니다. 앱 서류발급에서 사유를 확인해 주세요.');
  }

  /**
   * 담당의 답변 → 환자 앱(대외 발신). 🔴 답변 내용은 싣지 않는다 — 잠금 화면에 진료 조언이 뜨지 않게, 앱을 열어 본다.
   * 발행: `patient-message.service.reply()` · 옵트인(notifyPatient) + 설정 둘 다 필요.
   */
  @OnEvent('patient.message_replied')
  async handlePatientMessageReplied(payload: {
    patientId: string;
    messageId?: string;
    notifyPatient?: boolean;
  }): Promise<PatientPushResult> {
    return this.patientPush.deliver(
      payload.patientId,
      'MESSAGE',
      '담당의 답변',
      '담당의가 메시지에 답변했습니다. 앱에서 확인해주세요.',
      { requested: payload.notifyPatient === true },
    );
  }

  @OnEvent('prescription.ready')
  async handlePrescriptionReady(payload: {
    patientId: string;
    notifyPatient?: boolean;
  }): Promise<PatientPushResult> {
    return this.patientPush.deliver(
      payload.patientId,
      'PHARMACY',
      '약 조제 완료',
      '처방약 조제가 완료되었습니다. 약국에서 수령해주세요.',
      { requested: payload.notifyPatient === true },
    );
  }

  @OnEvent('checkup.result_ready')
  async handleCheckupResultReady(payload: { patientId: string; visitId: string; overallGrade?: string }) {
    const grade = payload.overallGrade ?? '-';
    await this.createPatientPush(
      payload.patientId,
      'CHECKUP_RESULT',
      '건강검진 결과 안내',
      `검진 결과가 준비되었습니다 (종합판정: ${grade}). 포털에서 확인하세요.`,
    );
  }

  /** F-2 복약 리마인더 — cron(portal/medication-reminder.cron)이 발행. 문구는 중립(원외 실조제 여부 미상 — 복용 지시 금지) */
  @OnEvent('portal.medication_reminder')
  async handleMedicationReminder(payload: { patientId: string; prescriptionId: string; slot: string; medicationName?: string }) {
    await this.createPatientPush(
      payload.patientId,
      'MEDICATION_REMINDER',
      '복약 확인 시간이에요',
      `${payload.slot} — ${payload.medicationName ?? '처방약'} 복용을 확인해 주세요.`,
      { prescriptionId: payload.prescriptionId, slot: payload.slot, route: '/(tabs)/medication' },
    );
  }

  /** 치료일정 D-1 리마인더 — cron(patient-schedule/schedule-reminder.cron)이 환자별 1건으로 묶어 발행 */
  @OnEvent('treatment.schedule.reminder')
  async handleTreatmentScheduleReminder(payload: { patientId: string; date: string; count: number; firstTitle: string }) {
    const dateStr = new Date(`${payload.date}T00:00:00+09:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    await this.createPatientPush(
      payload.patientId,
      'TREATMENT_SCHEDULE',
      '내일 치료 일정 안내',
      `${dateStr} 예정된 일정 ${payload.count}건 — ${payload.firstTitle}${payload.count > 1 ? ' 외' : ''}. 포털 치료 일정에서 확인하세요.`,
      { date: payload.date },
    );
  }

  /** F-4 실손보험 서류 번들 — 전량 자동발급 세트가 신청 즉시 전 구성 READY 된 경우(document-bundle.service 발행) */
  @OnEvent('portal.document_bundle_ready')
  async handleDocumentBundleReady(payload: { bundleId: string; patientId: string }) {
    await this.notifyBundleReady(payload.patientId, payload.bundleId);
  }

  /**
   * F-4 — 직원/의사 작성분(입퇴원확인서 등) 발급 완료 시 번들 완성 검사(설계 §4.3).
   * 번들 소속이 아닌 요청은 무시(기존 document.ready 발행처 동작 불변 — 신규 소비자만 추가).
   */
  @OnEvent('document.ready')
  async handleDocumentReadyForBundle(payload: { requestId: string; patientId: string; issueNo?: string }) {
    try {
      const req = await this.prisma.documentRequest.findUnique({
        where: { id: payload.requestId },
        select: { bundleId: true, patientId: true },
      });
      if (!req?.bundleId) return;
      const siblings = await this.prisma.documentRequest.findMany({
        where: { bundleId: req.bundleId },
        select: { status: true },
      });
      if (!siblings.length || !siblings.every((s) => s.status === 'READY' || s.status === 'DELIVERED')) return;
      await this.notifyBundleReady(req.patientId, req.bundleId);
    } catch (e) {
      this.logger.warn(`bundle ready check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** DOCUMENT_READY — 설정 기본 목록(patient-auth defaultTypes)과 동일 문자열(설계 §1.4 정합). data.route 로 모바일 딥링크 호환 */
  private async notifyBundleReady(patientId: string, bundleId: string) {
    await this.createPatientPush(
      patientId,
      'DOCUMENT_READY',
      '보험 청구 서류 준비 완료',
      '신청하신 실손보험 청구 서류가 모두 준비되었습니다. 서류발급에서 내려받으세요.',
      { bundleId, route: '/(tabs)/documents' },
    );
  }

  /**
   * 환자 푸시 공통 — PatientNotification 생성 + FCM 발송. data는 딥링크(route)·참조 id(모바일 usePushNotifications가 route 우선 소비).
   *
   * 🔴 쓰기 자체는 `PatientPushGateService.rawCreate` 하나가 한다(정본이 둘이 되지 않게).
   *    여기 남은 호출자(검진 결과·복약 리마인더·치료일정·서류 번들)는 **각자 이미 자기 게이트**를 갖고 있어
   *    종전 동작 그대로다 — 새 마스터 스위치는 위 4종(대외 발신 신규 배선)에만 적용한다.
   *    (돌고 있는 기능을 새 기본값 OFF 로 끄지 않는다.)
   */
  private async createPatientPush(patientId: string, type: string, title: string, body: string, data?: Record<string, unknown>) {
    try {
      await this.patientPush.rawCreate(patientId, type, title, body, data);
    } catch (e) {
      this.logger.warn(`Patient push ${type} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
