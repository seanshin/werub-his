import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PatientSafetyService } from '../patient-safety/patient-safety.service';
import { evaluateVitals, mergeVitalsThresholdsDetailed, canScoreNews2, VITALS_THRESHOLDS, type VitalsThresholds } from './vitals-evaluate';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import type { PreVisitVitals, FlowSheetEntry } from '@prisma/client';
import { AdmissionVitalsReader } from './admission-vitals.reader';
import { normalizeShiftBoundaries, shiftWindowAt } from '@hospital-run/shared';
import {
  VitalsIngestService,
  type VitalsSourceMeta,
  type VitalsIngestStatus,
  type VitalsPendingReason,
  type VitalsTimeFlag,
} from './vitals-ingest.service';

/**
 * 활력 기록 결과 — **행 + 수집 판정**. 🔴 저장되지 않은 것을 `null` 하나로 말하지 않는다.
 *   `status`        STORED / DUPLICATE(중복 재수신) / PENDING(저장 보류)
 *   `dedupeChecked` false 는 "중복 없음"이 아니라 **판정 불가**다(측정 시각을 모른다)
 *   `measuredAt`    모르면 `null` — 수신 시각을 측정 시각처럼 돌려주지 않는다
 */
export interface VitalsRecordOutcome {
  vitals: PreVisitVitals | FlowSheetEntry | null;
  /**
   * 어느 원장에 저장했는가(2026-10-10). 재원 중 환자의 대기열·진료 문맥 없는 측정은 **입원 원장**(`FlowSheetEntry`)으로 간다 —
   * 종전엔 외래 원장에 쌓여 플로시트·병동 보드·회진 목록이 "기록 없음"이라 말했다.
   */
  ledger: 'PREVISIT' | 'FLOWSHEET';
  admissionId: string | null;
  ingest: {
    status: VitalsIngestStatus;
    pendingReason: VitalsPendingReason | null;
    duplicateOfId: string | null;
    timeFlags: VitalsTimeFlag[];
    dedupeChecked: boolean;
    measuredAt: Date | null;
  };
}

export interface VitalsInput {
  patientId: string;
  /** 재원 — 주면 그 재원(재원 중·같은 환자)의 입원 원장에 쓴다. 안 주면 대기열·진료 문맥이 없을 때 재원 중 입원을 찾는다 */
  admissionId?: string;
  encounterId?: string;
  queueId?: string;
  systolicBp?: number;
  diastolicBp?: number;
  heartRate?: number;
  temperature?: number;
  spo2?: number;
  respiratoryRate?: number;
  weight?: number;
  height?: number;
  painScore?: number;
  notes?: string;
  /** NEWS2 요소 — **관측했을 때만** 채운다(미관측=undefined). 하드코딩 금지 */
  supplementalO2?: boolean;
  /** ACVPU(ALERT|CONFUSION|VOICE|PAIN|UNRESPONSIVE) — 미관측=undefined */
  consciousness?: string;
  /** SpO2 목표범위 척도 1=일반, 2=COPD(고탄산혈증 위험) */
  spO2Scale?: number;
  /**
   * 측정 시각 — 🔴 **모르면 넘기지 않는다**(now() 로 채우지 않는다).
   * 넘기지 않으면 `PreVisitVitals.measuredAt` 의 DB 기본값(=삽입 시각)이 들어가고,
   * 그 사실은 `record()` 의 반환 `ingest.timeFlags` 가 말한다(수신 시각 컬럼은 스키마에 없다).
   */
  measuredAt?: Date | string;
  /** 🔴 받되 **저장되지 않는다**(출처 컬럼 부재 — 기획 §5.1 승인 대기) */
  source?: VitalsSourceMeta;
}

/**
 * 활력징후 — **정본 쓰기 경로**(2026-07-30 통합).
 *
 * 저장소 정본은 PreVisitVitals(별도 VitalSign 모델 없음·외래/간호/원격/음성 공용).
 * 종전엔 쓰기가 두 갈래였고 부가 로직이 nurse-station 쪽에만 붙어 있어, `POST /api/v1/vitals`
 * (원격진료 간호차트 등)로 들어온 측정은 BMI·이상치 알림·NEWS2·만성추이 미러링이 **전부 누락**됐다.
 * 이제 어느 경로로 들어와도 동일한 부가 로직을 받는다(입원 병동 정본은 FlowSheetEntry — 별개).
 */
@Injectable()
export class VitalsService {
  private readonly logger = new Logger(VitalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** 🔴 활력 저장·이벤트는 전부 수집 포트를 지난다(직접 prisma 쓰기 금지 — 구조 가드가 동결) */
    private readonly ingest: VitalsIngestService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly safetyService?: PatientSafetyService,
    @Optional() private readonly config?: ConfigRuntimeService, // 임계 오버라이드(clinical.vitals.thresholds)
    @Optional() private readonly drift?: DriftRecorderService, // 임계 오버라이드가 조용히 버려지는 것 관측(axis C)
    /** 두 원장 읽기 정본(2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
  ) {}

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  /**
   * 지금 적용되는 활력 임계(2026-10-01) — 화면이 임계 숫자를 따로 적지 않고 서버 판정을 받게 하려는 읽기용.
   *  · `source` CONFIGURED = 환자안전위 개정(`clinical.vitals.thresholds`)이 1개 항목 이상 반영됨 · DEFAULT = 코드 정본 기본값
   *  · 버려진 오버라이드(미상 키·역전)는 그대로 밝힌다 — "설정했는데 적용 안 됨"을 숨기지 않는다
   *  · 조회 실패는 전파한다(실패를 "기본값"으로 번역하지 않는다)
   */
  async effectiveThresholds(): Promise<{ thresholds: VitalsThresholds; source: 'CONFIGURED' | 'DEFAULT'; droppedKeys: string[]; invertedKeys: string[] }> {
    if (!this.config) return { thresholds: VITALS_THRESHOLDS, source: 'DEFAULT', droppedKeys: [], invertedKeys: [] };
    const raw = await this.config.get('clinical.vitals.thresholds');
    const merged = mergeVitalsThresholdsDetailed(raw);
    const applied = raw && typeof raw === 'object'
      ? Object.keys(raw as Record<string, unknown>).filter((k) => k in VITALS_THRESHOLDS && !merged.invertedKeys.includes(k)).length
      : 0;
    return { thresholds: merged.thresholds, source: applied > 0 ? 'CONFIGURED' : 'DEFAULT', droppedKeys: merged.droppedKeys, invertedKeys: merged.invertedKeys };
  }

  /**
   * 정본 기록 — BMI·이상치 판정·만성추이 이벤트·태스크 완료·이상 알림·NEWS2 일괄 수행.
   *
   * 저장·정규화·멱등·시각검사·이벤트는 **수집 포트**(`VitalsIngestService`)가 한다.
   * 여기 남는 것은 외래 경로 고유의 부가 로직뿐이다(이상 알림·태스크 완료·NEWS2).
   *
   * 🔴 2026-08-20 — 반환을 `{ vitals, ingest }` 로 넓혔다.
   *
   * 종전엔 저장된 행만 돌려줘서 `DUPLICATE`·`PENDING` 이면 호출부가 **`null` 만** 받았다.
   * 그래서 화면은 200 응답에 `data: null` 을 받고도 **왜 저장이 안 됐는지 알 수 없었고**,
   * 그 사실은 서버 로그에만 남았다(입력한 간호사는 아무것도 못 본다).
   * 이 정보는 런타임 판정이라 **출처 스키마를 기다릴 필요가 없다** — 응답 `meta` 로 낸다.
   * 🔴 임상 입력을 새로 막지는 않는다(막으면 방치된다) — 사실을 말할 뿐이다.
   */
  async record(input: VitalsInput, nurseId: string): Promise<VitalsRecordOutcome> {
    const thrOverride = await this.config?.get('clinical.vitals.thresholds').catch(() => null);
    /**
     * 🔴 관측점(axis C): 환자안전위 개정 표면의 오버라이드가 오타 키·역전 범위로 **조용히 버려지면**
     *    화면은 "적용됨"인데 판정은 기본값이다. 버려진 것을 원장에 남긴다(판정 자체는 fail-safe 그대로).
     */
    const mergedThr = mergeVitalsThresholdsDetailed(thrOverride);
    if (mergedThr.droppedKeys.length || mergedThr.invertedKeys.length) {
      this.drift?.record({
        kind: 'KEY_MISSING',
        producer: 'config.clinical.vitals.thresholds',
        consumer: 'vitals.mergeThresholds',
        detail: `버려진 오버라이드 — 미상 키: [${mergedThr.droppedKeys.join(', ')}] · 역전 무시: [${mergedThr.invertedKeys.join(', ')}]`,
      });
    }
    const ev = evaluateVitals(input, mergedThr.thresholds);

    // 원장 고르기(2026-10-10) — 재원 중이면 입원 원장. 🔴 대기열·진료 문맥이 있으면 외래 그대로(외래 진료 중 측정)
    const admission = await this.resolveAdmission(input);
    const shiftBoundaries = admission ? normalizeShiftBoundaries(await this.config?.get('nursing.shift.boundaries')) : null;

    const result = await this.ingest.ingest<PreVisitVitals | FlowSheetEntry>({
      route: admission ? 'INPATIENT' : 'OUTPATIENT',
      admissionId: admission?.id,
      patientId: input.patientId,
      encounterId: input.encounterId,
      queueId: input.queueId,
      recordedBy: nurseId,
      measuredAt: input.measuredAt,
      source: input.source,
      values: {
        systolicBp: input.systolicBp,
        diastolicBp: input.diastolicBp,
        heartRate: input.heartRate,
        temperature: input.temperature,
        spo2: input.spo2,
        respiratoryRate: input.respiratoryRate,
        weight: input.weight,
        height: input.height,
        painScore: input.painScore,
        supplementalO2: input.supplementalO2,
        consciousness: input.consciousness,
      },
      extras: {
        bmi: ev.bmi, isAbnormal: ev.isAbnormal, notes: input.notes,
        // 입원 원장의 근무조 — 측정 시각(모르면 지금)이 든 교대 · 교대 경계 설정 정본(종전 수집 포트 기본 'DAY' 고정)
        ...(admission ? { shiftType: shiftWindowAt(input.measuredAt ?? new Date(), shiftBoundaries ?? undefined).shift } : {}),
      },
    });

    const outcome = (vitals: PreVisitVitals | FlowSheetEntry | null): VitalsRecordOutcome => ({
      vitals,
      ledger: admission ? 'FLOWSHEET' : 'PREVISIT',
      admissionId: admission?.id ?? null,
      ingest: {
        status: result.status,
        pendingReason: result.pendingReason,
        duplicateOfId: result.duplicateOfId,
        timeFlags: result.timeFlags,
        dedupeChecked: result.dedupeChecked,
        measuredAt: result.measuredAt,
      },
    });

    if (result.status !== 'STORED' || !result.stored) {
      // 중복 재수신·미결속은 저장하지 않는다. 🔴 저장한 척하지 않는다 — 부가 로직도 돌지 않는다.
      this.logger.warn(
        `활력 미저장(${result.status}${result.pendingReason ? `/${result.pendingReason}` : ''}) 환자 ${input.patientId}`,
      );
      return outcome(null);
    }
    const vitals = result.stored;

    // VITALS 간호 태스크 자동 완료(대기열 문맥이 있을 때만)
    if (input.queueId) {
      await this.prisma.nurseTask.updateMany({
        where: { queueId: input.queueId, taskType: 'VITALS', status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    if (ev.isAbnormal) {
      // clinical.vitals.criticalAlert 게이트(R9-①) — 🔴 fail-open: 명시적 false 일 때만 억제.
      // 조회 실패로 위급 통보가 조용히 꺼지는 것이 최악의 실패다(경보를 조용히 끄는 실패 금지).
      // 억제해도 기록(vitals 저장·판정)은 그대로 — 끄는 것은 통보뿐이며 로그에 남긴다.
      const alertEnabled = await this.config?.get('clinical.vitals.criticalAlert').catch(() => null);
      if (alertEnabled === false || alertEnabled === 'false') {
        this.logger.warn(`이상 바이탈 통보 억제(clinical.vitals.criticalAlert=false): 환자 ${input.patientId} — ${ev.abnormalLabels.join(', ')}`);
      } else {
        await this.notifyAbnormal(input.patientId, nurseId, ev.abnormalLabels);
      }
    }
    if (canScoreNews2(input)) await this.scoreNews2(input, nurseId);

    return outcome(vitals);
  }

  /**
   * 재원 판정 — 명시한 재원은 검증(같은 환자·재원 중이 아니면 400 — 남의 재원에 붙이지 않는다).
   * 명시하지 않았으면 대기열·진료 문맥이 없을 때만 재원 중 입원을 찾는다(둘 이상이면 가장 최근 입원).
   */
  private async resolveAdmission(input: VitalsInput): Promise<{ id: string } | null> {
    if (input.admissionId) {
      const a = await this.prisma.admission.findUnique({ where: { id: input.admissionId }, select: { id: true, patientId: true, status: true } });
      if (!a || a.patientId !== input.patientId || a.status !== 'ADMITTED') {
        throw new BadRequestException({ code: 'VITALS_ADMISSION_MISMATCH', message: '이 환자의 재원 중 입원이 아닙니다 — 활력을 저장하지 않았습니다.' });
      }
      return { id: a.id };
    }
    if (input.queueId || input.encounterId) return null;
    // 🔴 입원 원장에는 체중·키 칸이 없다 — 재면 버려진다. 그 측정은 외래 원장에 둔다(읽기 정본이 재원 기간으로 함께 본다)
    if (input.weight != null || input.height != null) return null;
    return this.prisma.admission.findFirst({
      where: { patientId: input.patientId, status: 'ADMITTED' },
      orderBy: { admitDate: 'desc' },
      select: { id: true },
    });
  }

  /** 이상 바이탈 알림 — 담당 간호사 ∪ 주치의 ∪ 기록자. non-blocking(실패해도 기록은 유지) */
  private async notifyAbnormal(patientId: string, nurseId: string, labels: string[]) {
    this.logger.warn(`이상 바이탈 감지: 환자 ${patientId} — ${labels.join(', ')}`);
    if (!this.notificationService) return;
    try {
      const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true, mrn: true } });
      const pName = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '환자';
      const alertMsg = `${pName}(${patient?.mrn ?? ''}) 이상 바이탈: ${labels.join(', ')}`;

      const assignments = await this.prisma.nursePatientAssignment.findMany({
        where: { admission: { patientId, status: 'ADMITTED' }, releasedAt: null },
        select: { nurseId: true },
      });
      const admission = await this.prisma.admission.findFirst({
        where: { patientId, status: 'ADMITTED' },
        select: { attendingDoctorId: true },
      });

      const targets = new Set<string>(assignments.map((a) => a.nurseId));
      if (admission?.attendingDoctorId) targets.add(admission.attendingDoctorId);
      targets.add(nurseId);

      for (const uid of targets) {
        try {
          const notif = await this.notificationService.create(uid, {
            type: 'VITAL_ALERT', title: '⚠ 이상 바이탈 감지', message: alertMsg,
            severity: 'CRITICAL', refType: 'PATIENT', refId: patientId,
          });
          this.notificationService.pushNotification(uid, {
            id: notif.id, type: notif.type, title: notif.title, message: notif.message,
            severity: notif.severity ?? undefined, refType: notif.refType ?? undefined, refId: notif.refId ?? undefined,
          });
        } catch (e) {
          this.logger.error(`알림 발송 실패: ${uid}`, e);
        }
      }
    } catch (e) {
      this.logger.error('이상 바이탈 알림 처리 실패(non-blocking)', e);
    }
  }

  /**
   * NEWS2 자동 산출 — **7요소 전부 관측된 경우에만**(`canScoreNews2` 가 게이트).
   *
   * 🔴 종전엔 `supplementalO2: false` · `consciousness: 'ALERT'` 를 **하드코딩**해
   *    관측하지 않은 값을 법정기록(EarlyWarningScore)에 사실로 남겼다. 산소 투여 중이거나
   *    의식이 저하된 환자의 점수가 최대 5점 낮게 기록된다 — 조기경보가 조용히 죽는다.
   *    이제 두 요소가 없으면 **산출하지 않는다**(추정하지 않는다).
   *    사용하는 NEWS2 정본은 `PatientSafetyService.calculateNews2`(RCP 밴드) 하나다.
   */
  private async scoreNews2(input: VitalsInput, nurseId: string) {
    if (!this.safetyService) return;
    try {
      const r = await this.safetyService.calculateAndSaveEws(input.patientId, nurseId, {
        respiratoryRate: input.respiratoryRate!,
        spO2: input.spo2!,
        supplementalO2: input.supplementalO2!,
        spO2Scale: input.spO2Scale ?? 1,
        systolicBp: input.systolicBp!,
        heartRate: input.heartRate!,
        consciousness: input.consciousness!,
        temperature: input.temperature!,
      });
      if (r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM') {
        this.logger.warn(`NEWS2 ${r.riskLevel}: 환자 ${input.patientId}, 점수 ${r.totalScore}`);
      }
    } catch (e) {
      this.logger.error('EWS 자동 계산 실패 (non-blocking)', e);
    }
  }

  /** @deprecated record() 사용 — 이름 호환용 별칭(기존 호출부 무중단) */
  create(input: VitalsInput, nurseId: string) {
    return this.record(input, nurseId);
  }

  /**
   * 환자 최근 활력 — 🔴 (2026-10-10) 두 원장(외래 + 모든 재원의 입원 원장)을 합쳐 최근 순.
   * 종전엔 외래 원장만 봐 입원 중 플로시트 활력이 차트 옆 칸에 없었다. 행마다 `ledger` · 시각은 `measuredAt` 로 맞춘다.
   */
  listRecent(patientId: string, limit = 5) {
    return this.admissionVitals.recentForPatient(patientId, Math.min(Math.max(limit, 1), 50));
  }

}
