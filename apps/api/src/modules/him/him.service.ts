import { joinPatientName } from '@hospital-run/shared';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { NotificationService } from '../notification/notification.service';

export interface Deficiency {
  type: 'DISCHARGE_SUMMARY' | 'UNSIGNED_ENCOUNTER' | 'UNSIGNED_NURSING_NOTE' | 'MISSING_DIAGNOSIS';
  refId: string;
  patient: { mrn: string; name: string };
  responsibleId: string | null;
  responsibleName: string;
  since: Date;
  overdueDays: number;
  detail: string;
  /**
   * 미서명 진료기록만(2026-10-10) — 작성자가 활성 의사인가. 아니면 책임자(responsibleId)를 비운다:
   * 🔴 관리자 계정이 만든 미서명 진료(운영 168건)의 독촉·회수 알림이 전부 그 관리자 한 명에게 갔다.
   */
  authorIsDoctor?: boolean;
  /** 그 진료에 처방을 단 의사(책임 처방의 — 미지정이면 입력자) · 이름은 users 에서 */
  prescribers?: Array<{ id: string; name: string | null }>;
  /** 서술·SOAP·진단·처방이 모두 비었다(빈 초안) */
  empty?: boolean;
}

/**
 * 미비기록(HIM·의무기록 완결도) 관리 — 2026-07 전체검토 R3-2.
 * 신규 모델 없이 실시간 집계(퇴원요약·미서명 진료기록·미서명 간호기록) + 독촉 알림.
 * 기한 config: him.summaryDueDays(7)·him.encounterDueDays(3)·him.noteDueDays(1)·him.lookbackDays(90)
 */
@Injectable()
export class HimService {
  private readonly logger = new Logger(HimService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  private async days(key: string, def: number): Promise<number> {
    const v = await this.config?.get(key).catch(() => null);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  }

  private overdue(since: Date, dueDays: number): number {
    return Math.floor((Date.now() - since.getTime()) / 86400_000) - dueDays;
  }

  /**
   * @param patientId (2026-10-02) 환자 차트 '의무기록' 탭 — 그 환자의 미비만. 기한·조회 기간 정책은 병원 목록과 같다.
   */
  async getDeficiencies(onlyOverdue = false, patientId?: string) {
    const [summaryDue, encounterDue, noteDue, lookback] = await Promise.all([
      this.days('him.summaryDueDays', 7),
      this.days('him.encounterDueDays', 3),
      this.days('him.noteDueDays', 1),
      this.days('him.lookbackDays', 90),
    ]);
    const lookbackFrom = new Date(Date.now() - lookback * 86400_000);
    const items: Deficiency[] = [];

    // 1) 퇴원요약 미비 — 퇴원했는데 요약이 없거나 DRAFT
    const discharged = await this.prisma.admission.findMany({
      where: {
        status: 'DISCHARGED',
        dischargeDate: { gte: lookbackFrom },
        ...(patientId ? { patientId } : {}),
        OR: [{ dischargeSummaryDoc: null }, { dischargeSummaryDoc: { status: 'DRAFT' } }],
      },
      select: {
        id: true, dischargeDate: true, attendingDoctorId: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
        dischargeSummaryDoc: { select: { status: true } },
        chargeOfCare: { where: { role: 'ATTENDING' }, orderBy: { assignedAt: 'desc' }, take: 1, select: { doctorId: true, doctor: { select: { familyName: true, givenName: true } } } },
      },
      take: 500,
    });
    for (const a of discharged) {
      const coc = a.chargeOfCare[0];
      items.push({
        type: 'DISCHARGE_SUMMARY',
        refId: a.id,
        patient: { mrn: a.patient.mrn, name: `${a.patient.familyName}${a.patient.givenName}` },
        responsibleId: a.attendingDoctorId ?? coc?.doctorId ?? null,
        responsibleName: coc?.doctor ? `${coc.doctor.familyName}${coc.doctor.givenName}` : '(담당의 미지정)',
        since: a.dischargeDate!,
        overdueDays: this.overdue(a.dischargeDate!, summaryDue),
        detail: a.dischargeSummaryDoc ? '퇴원요약 미서명(DRAFT)' : '퇴원요약 미작성',
      });
    }

    // 2) 미서명 진료기록 — DRAFT encounter (작성 후 기한 경과 판단은 overdueDays로)
    const draftEncounters = await this.prisma.encounter.findMany({
      where: { status: 'DRAFT', createdAt: { gte: lookbackFrom }, ...(patientId ? { patientId } : {}) },
      select: {
        id: true, createdAt: true, doctorId: true,
        subjective: true, objective: true, assessment: true, plan: true, chiefComplaint: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true, role: true, isActive: true } },
        prescriptions: { select: { prescriberId: true, createdBy: true } },
        _count: { select: { diagnoses: true } },
      },
      take: 500,
    });
    // 처방을 단 의사 이름 — 처방 행에는 사용자 관계가 없어 한 번에 찾는다
    const prescriberIds = [...new Set(draftEncounters.flatMap((e) => (e.prescriptions ?? []).map((p) => p.prescriberId ?? p.createdBy)).filter((x): x is string => !!x))];
    const prescriberNames = new Map<string, string>();
    if (prescriberIds.length) {
      const users = await this.prisma.user.findMany({ where: { id: { in: prescriberIds } }, select: { id: true, familyName: true, givenName: true } });
      for (const u of users) prescriberNames.set(u.id, joinPatientName(u.familyName, u.givenName));
    }
    for (const e of draftEncounters) {
      const authorIsDoctor = e.doctor?.role === 'DOCTOR' && e.doctor?.isActive !== false;
      const rxIds = [...new Set((e.prescriptions ?? []).map((p) => p.prescriberId ?? p.createdBy).filter((x): x is string => !!x))];
      const textEmpty = [e.subjective, e.objective, e.assessment, e.plan, e.chiefComplaint].every((v) => v == null || String(v).trim() === '');
      items.push({
        type: 'UNSIGNED_ENCOUNTER',
        refId: e.id,
        patient: { mrn: e.patient.mrn, name: `${e.patient.familyName}${e.patient.givenName}` },
        // 작성자가 활성 의사가 아니면 책임자를 지어내지 않는다(독촉이 관리자에게 몰리지 않게) — 처방의는 따로 보인다
        responsibleId: authorIsDoctor ? e.doctorId : null,
        responsibleName: `${e.doctor.familyName}${e.doctor.givenName}`,
        since: e.createdAt,
        overdueDays: this.overdue(e.createdAt, encounterDue),
        detail: '진료기록 미서명(DRAFT)',
        authorIsDoctor,
        prescribers: rxIds.map((id) => ({ id, name: prescriberNames.get(id) ?? null })),
        empty: textEmpty && rxIds.length === 0 && (e._count?.diagnoses ?? 0) === 0,
      });
    }

    // 3) 미서명 간호기록 — DRAFT note
    const draftNotes = await this.prisma.nursingNote.findMany({
      where: { status: 'DRAFT', recordedAt: { gte: lookbackFrom }, ...(patientId ? { admission: { patientId } } : {}) },
      select: {
        id: true, recordedAt: true, nurseId: true,
        nurse: { select: { familyName: true, givenName: true } },
        admission: { select: { patient: { select: { mrn: true, familyName: true, givenName: true } } } },
      },
      take: 500,
    });
    for (const n of draftNotes) {
      items.push({
        type: 'UNSIGNED_NURSING_NOTE',
        refId: n.id,
        patient: { mrn: n.admission.patient.mrn, name: `${n.admission.patient.familyName}${n.admission.patient.givenName}` },
        responsibleId: n.nurseId,
        responsibleName: `${n.nurse.familyName}${n.nurse.givenName}`,
        since: n.recordedAt,
        overdueDays: this.overdue(n.recordedAt, noteDue),
        detail: '간호기록 미서명(DRAFT)',
      });
    }

    // 4) 상병 미입력 서명 — 서명은 끝났는데 상병(진단)이 없다.
    //    🔴 서명 = 청구 트리거다. 상병이 없으면 심사 삭감·반려로 이어지는데 종전엔 **어디에도 안 보였다**
    //    (서명 게이트는 기본 WARN 이라 통과시키고, 미비기록은 DRAFT 만 세고 있었다 — 2026-08-10 실측 79건).
    //    내용(진단)은 시스템이 만들 수 없다 → **담당 의사에게 보여 채우게 하는 것**이 유일한 해소 경로다.
    const signedNoDx = await this.prisma.encounter.findMany({
      where: {
        status: 'SIGNED',
        createdAt: { gte: lookbackFrom },
        diagnoses: { none: {} },
        ...(patientId ? { patientId } : {}),
      },
      select: {
        id: true, createdAt: true, signedAt: true, doctorId: true,
        patient: { select: { mrn: true, familyName: true, givenName: true } },
        doctor: { select: { familyName: true, givenName: true } },
      },
      take: 500,
    });
    for (const e of signedNoDx) {
      const since = e.signedAt ?? e.createdAt; // 기한은 서명 시점부터
      items.push({
        type: 'MISSING_DIAGNOSIS',
        refId: e.id,
        patient: { mrn: e.patient.mrn, name: `${e.patient.familyName}${e.patient.givenName}` },
        responsibleId: e.doctorId,
        responsibleName: `${e.doctor.familyName}${e.doctor.givenName}`,
        since,
        overdueDays: this.overdue(since, encounterDue),
        detail: '상병(진단) 미입력 — 청구 삭감·반려 위험',
      });
    }

    const filtered = onlyOverdue ? items.filter((i) => i.overdueDays > 0) : items;
    filtered.sort((a, b) => b.overdueDays - a.overdueDays);
    return {
      items: filtered,
      counts: {
        total: filtered.length,
        overdue: filtered.filter((i) => i.overdueDays > 0).length,
        byType: {
          DISCHARGE_SUMMARY: filtered.filter((i) => i.type === 'DISCHARGE_SUMMARY').length,
          UNSIGNED_ENCOUNTER: filtered.filter((i) => i.type === 'UNSIGNED_ENCOUNTER').length,
          UNSIGNED_NURSING_NOTE: filtered.filter((i) => i.type === 'UNSIGNED_NURSING_NOTE').length,
          MISSING_DIAGNOSIS: filtered.filter((i) => i.type === 'MISSING_DIAGNOSIS').length,
        },
      },
      policy: { summaryDueDays: summaryDue, encounterDueDays: encounterDue, noteDueDays: noteDue, lookbackDays: lookback },
    };
  }

  /** 독촉 — 기한 초과 미비 보유 책임자에게 알림(책임자별 1건 묶음) */
  async remind() {
    const { items } = await this.getDeficiencies(true);
    const byUser = new Map<string, Deficiency[]>();
    for (const it of items) {
      if (!it.responsibleId) continue;
      const list = byUser.get(it.responsibleId) ?? [];
      list.push(it);
      byUser.set(it.responsibleId, list);
    }
    let sent = 0;
    for (const [userId, list] of byUser) {
      try {
        await this.notifications?.create(userId, {
          type: 'HIM_DEFICIENCY',
          title: `미비기록 ${list.length}건 — 완결 요청`,
          message: `기한 초과 미비기록 ${list.length}건: ${list.slice(0, 3).map((d) => `${d.detail}(${d.patient.name})`).join(', ')}${list.length > 3 ? ' 외' : ''}`,
          severity: 'WARNING',
          refType: 'HIM',
        });
        await this.notifications?.pushNotification?.(userId, { title: '미비기록 완결 요청', message: `기한 초과 ${list.length}건` } as never);
        sent += 1;
      } catch (e) {
        this.logger.warn(`HIM 독촉 실패(비차단) user=${userId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { notified: sent, deficiencies: items.length };
  }
}
