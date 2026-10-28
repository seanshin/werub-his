import { Injectable, Inject, Logger, Optional, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException, ConflictException, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, PrescriptionType, PrescriptionStatus } from '@prisma/client';
import { dosingWindow } from '@hospital-run/shared';
import { myOrdersPrescriptionWhere } from '../order/my-orders-scope';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { DurService, DurWarning } from './dur/dur.service';
import { OrderService, TYPE_TO_DEPARTMENT, buildOrderData, emitOrderCreated } from '../order/order.service';
import { OrderSignLogService } from '../order-sign-log/order-sign-log.service';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { CdssService, CdssResult } from '../cdss/cdss.service';
import { ControlledSubstanceService } from '../controlled-substance/controlled-substance.service';
import { gateMode } from '../../common/gate-mode';
import { StepUpService } from '../auth/step-up/step-up.service';
import { PushApprovalService } from '../auth/step-up/push-approval.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import { isVerbalOrder, orderEntryMode, orderEntryModes, resolveProfession, canExecuteOrder, ORDER_ENTRY_TYPES, type OrderEntryScopeOverride, type OrderEntryMode } from '@hospital-run/shared';
import { recordGateViolation } from '../../common/gate-violation-record';
import { todayRange } from '../../common/day-range';

/**
 * 처방 본문(약품 내용) 정규 해시 — 위임 step-up 토큰 바인딩용.
 * 지정 처방의가 폰에서 "무엇을" 승인했는지를 토큰에 고정하여, 승인 후 본문(약품/용량) 변조를 차단한다.
 * delegate-request(요청)와 create(저장)에서 동일 필드·동일 순서로 계산되어야 일치한다(키 순서 비의존).
 */
export function hashPrescriptionBody(d: {
  type?: string | null;
  medicationCodeId?: string | null;
  procedureCodeId?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;
  quantity?: number | null;
  route?: string | null;
}): string {
  const canonical = [
    d.type ?? '',
    d.medicationCodeId ?? '',
    d.procedureCodeId ?? '',
    d.dosage ?? '',
    d.frequency ?? '',
    d.duration ?? '',
    d.quantity ?? '',
    d.route ?? '',
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** 처방의 지정 규칙(SystemConfig: prescription.prescriberRules) */
export interface PrescriberRules {
  enabled: boolean;
  allowDelegate: boolean;
  requireDelegateAuth: boolean;
  allowedRoles: string[];
  requireSpecialtyMatch: boolean;
  requireAttending: boolean;
  departmentGuidelines: Record<string, string>;
}

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);

  /**
   * DUR 강제게이트(CDSS) — config dur.enforce OFF|WARN|BLOCK(기본 BLOCK=종전 하드코딩 차단과 동일).
   * ERROR 경고 존재 시: BLOCK=차단(override 시 감사 통과)·WARN=경고 통과·OFF=기록만.
   * 위반/override는 GateViolationLog에 영속(관제 /admin/safety-gates) — tx 밖에서 호출할 것(차단 롤백에도 기록 보존).
   */
  private async applyDurGate(
    durWarnings: DurWarning[],
    ctx: { encounterId: string; path: 'CREATE' | 'COPY' | 'REPEAT'; override?: { flag?: boolean; reason?: string } },
  ): Promise<void> {
    const errors = durWarnings.filter((w) => w.severity === 'ERROR');
    if (errors.length === 0) return;
    const mode = gateMode(await this.config.get('dur.enforce'), 'BLOCK');
    const summary = `[${ctx.path}] ${errors.map((e) => `${e.type}: ${e.message}`).join(' / ')}`.slice(0, 1900);
    // 🔴 기록 실패를 삼키지 않는다 — override 가 원장에 안 남으면 관제는 "위반 0"으로 그린다(정본 `common/gate-violation-record`)
    const record = (severity: string) => {
      void recordGateViolation(this.prisma, this.logger, {
        gateKey: 'dur.enforce', severity, message: summary, refType: 'ENCOUNTER', refId: ctx.encounterId,
      });
    };
    if (mode === 'OFF') {
      record('OFF');
      return;
    }
    if (ctx.override?.flag) {
      // 🔴 **사유 없는 우회는 우회가 아니라 구멍이다.** 이 설정의 설명과 바로 위 주석이
      //    "override 는 overrideDur + 사유 감사"라고 약속해 왔는데, 코드는 사유 없이 통과시켰다
      //    (2026-09-15 외부 실호출: dur.enforce=BLOCK 에서 `overrideDur: true` 만 보내면 201 ·
      //     dur_override_reason·dur_override_by 모두 NULL 로 남아 약국·심사가 추적할 근거가 없었다).
      //    막는 대신 기록으로 가는 것이 이 축의 규칙이지만, 기록이 비면 막지도 기록하지도 않은 것이다.
      const reason = ctx.override.reason?.trim();
      if (!reason) {
        record('BLOCK'); // 실제로 막혔으므로 BLOCK 으로 센다 — 어휘를 새로 만들지 않는다
        throw new BadRequestException({
          code: 'DUR_OVERRIDE_REASON_REQUIRED',
          message: 'DUR 경고를 무시하고 강제 처방하려면 사유(overrideReason)를 입력해야 합니다.',
          durWarnings,
        });
      }
      record('OVERRIDE');
      return;
    }
    if (mode === 'WARN') {
      record('WARN');
      this.logger.warn(`DUR gate WARN 통과 — ${summary}`);
      return;
    }
    record('BLOCK');
    throw new BadRequestException({
      code: 'DUR_CHECK_FAILED',
      message: 'DUR 점검에서 위험 경고가 발생했습니다. 강제 처방하려면 overrideDur: true를 전송하세요.',
      durWarnings,
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly durService: DurService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly config: ConfigRuntimeService,
    private readonly stepUp: StepUpService,
    private readonly pushApproval: PushApprovalService,
    private readonly audit: AuditService,
    private readonly preAuthGate: PreAuthGateService,
    @Optional() private readonly cdssService?: CdssService,
    @Optional() private readonly controlledSubstance?: ControlledSubstanceService,
    // 오더 서명 로그 — 부가 기능이라 미주입이어도 처방 취소는 그대로 동작한다
    @Optional() private readonly orderSignLog?: OrderSignLogService,
    // 🔴 원내 처방집 시행 게이트(W8-R2 F1) — PrescriptionModule 이 provider 로 등록하므로 실서비스에선 항상 존재.
    //    @Optional 은 기존 스펙의 위치 인자 생성만을 위한 것이며, 배선 누락은 가드 스펙이 잡는다.
    @Optional() private readonly formularyGate?: FormularyGateService,
  ) {}

  /**
   * 원내 처방집 게이트(공유 choke point) — 발행 직전 위원회 승인 여부 확인.
   * create·copy·repeat 모든 발행 경로가 이 헬퍼를 호출한다.
   * 🔴 W8-R2 F1 — 종전엔 서버 집행이 0건이고 FE 한 화면(진료 작성)만 확인창을 띄웠다.
   *    모바일·워크스테이션·API 직접 호출은 게이트를 그대로 통과했는데 관리 화면은 "시행 중"이라 말했다.
   *    현재 운영 모드는 MEDICATION=WARN(막지 않고 기록)·나머지 OFF 이므로 오늘 막히는 처방은 없다.
   */
  private async assertFormularyForOrder(
    item: { type: string; medicationCodeId?: string | null; procedureCodeId?: string | null },
    ctx: { encounterId?: string | null; path: 'CREATE' | 'COPY' | 'REPEAT' },
  ): Promise<void> {
    if (!this.formularyGate) return;
    await this.formularyGate.assertOrderAllowed(item, ctx);
  }

  /**
   * 환자 담당 의료군(care group) 의사 id — 입원 환자의 합법적 처방 주체 집합.
   * = 주치의 + 입원담당의 + 해당 진료의 + 활성 협진의(Consultation) + 추가 지정의.
   * 의료법 §18(직접 진찰한 의사)에 부합: 단일 주치의 아닌 실제 담당 의료진 전원.
   */
  private async careGroupDoctorIds(enc: { id: string; admissionId: string | null; doctorId?: string | null }): Promise<string[]> {
    const ids = new Set<string>();
    if (enc.doctorId) ids.add(enc.doctorId);
    let encounterIds = [enc.id];
    if (enc.admissionId) {
      // admission·입원내 encounter·지정의는 모두 admissionId 만 의존 → 병렬 조회(순차 3회 → 1라운드)
      const [adm, encs, desig] = await Promise.all([
        this.prisma.admission.findUnique({
          where: { id: enc.admissionId },
          select: { attendingDoctorId: true, admittingDoctorId: true },
        }),
        this.prisma.encounter.findMany({ where: { admissionId: enc.admissionId }, select: { id: true } }),
        this.prisma.admissionDesignatedDoctor.findMany({
          where: { admissionId: enc.admissionId, active: true },
          select: { doctorId: true },
        }),
      ]);
      if (adm?.attendingDoctorId) ids.add(adm.attendingDoctorId);
      if (adm?.admittingDoctorId) ids.add(adm.admittingDoctorId);
      if (encs.length) encounterIds = encs.map((e) => e.id);
      desig.forEach((d) => ids.add(d.doctorId));
    }
    // 활성 협진의(타과 자문) — 수락/회신된 협진의 자문의는 본인 영역 처방 권한(encounterIds 의존)
    const consults = await this.prisma.consultation.findMany({
      where: { encounterId: { in: encounterIds }, status: { in: ['ACCEPTED', 'REPLIED'] } },
      select: { toDoctorId: true, replyDoctorId: true },
    });
    consults.forEach((c) => { if (c.toDoctorId) ids.add(c.toDoctorId); if (c.replyDoctorId) ids.add(c.replyDoctorId); });
    if (!ids.size) return [];
    // 활성 사용자만 — 퇴사/비활성 의사가 담당 의료군에 남지 않도록
    const active = await this.prisma.user.findMany({ where: { id: { in: [...ids] }, isActive: true }, select: { id: true } });
    return active.map((u) => u.id);
  }

  // ── 입원별 추가 지정의(특수환자 담당 의료군 배치) ──
  async listDesignatedDoctors(admissionId: string) {
    const rows = await this.prisma.admissionDesignatedDoctor.findMany({
      where: { admissionId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids = rows.map((r) => r.doctorId);
    const docs = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true, department: true, role: true, isActive: true } }) : [];
    const dmap = new Map(docs.map((d) => [d.id, d]));
    return rows.map((r) => ({
      id: r.id, doctorId: r.doctorId, reason: r.reason, assignedBy: r.assignedBy, createdAt: r.createdAt,
      name: `${dmap.get(r.doctorId)?.familyName ?? ''}${dmap.get(r.doctorId)?.givenName ?? ''}`.trim(),
      department: dmap.get(r.doctorId)?.department ?? null,
      role: dmap.get(r.doctorId)?.role ?? null,
      inactive: dmap.get(r.doctorId)?.isActive === false, // 퇴사/비활성 표시(담당군에선 자동 제외됨)
    }));
  }

  async addDesignatedDoctor(admissionId: string, doctorId: string, reason: string | undefined, actorId: string) {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, status: true } });
    if (!adm) throw new NotFoundException('Admission not found');
    if (adm.status === 'DISCHARGED' || adm.status === 'CANCELLED') throw new BadRequestException({ code: 'ADMISSION_NOT_ACTIVE', message: '퇴원/취소된 입원에는 지정의를 배치할 수 없습니다.' });
    const doc = await this.prisma.user.findUnique({ where: { id: doctorId }, select: { id: true, role: true, isActive: true } });
    if (!doc || !doc.isActive || doc.role !== 'DOCTOR') throw new BadRequestException({ code: 'DESIGNATED_INVALID', message: '활성 의사만 지정의로 배치할 수 있습니다.' });
    const row = await this.prisma.admissionDesignatedDoctor.upsert({
      where: { admissionId_doctorId: { admissionId, doctorId } },
      update: { active: true, reason: reason ?? null, assignedBy: actorId },
      create: { admissionId, doctorId, reason: reason ?? null, assignedBy: actorId },
    });
    await this.audit.safeLog({ userId: actorId, action: AuditAction.CREATE, resourceType: 'ADMISSION_DESIGNATED_DOCTOR', resourceId: row.id, changes: { admissionId: { old: null, new: admissionId }, doctorId: { old: null, new: doctorId }, reason: { old: null, new: reason ?? null } } });
    return row;
  }

  async removeDesignatedDoctor(admissionId: string, doctorId: string, actorId: string) {
    const row = await this.prisma.admissionDesignatedDoctor.findUnique({ where: { admissionId_doctorId: { admissionId, doctorId } } });
    if (!row) throw new NotFoundException('지정의 배치를 찾을 수 없습니다');
    await this.prisma.admissionDesignatedDoctor.update({ where: { id: row.id }, data: { active: false } });
    await this.audit.safeLog({ userId: actorId, action: AuditAction.DELETE, resourceType: 'ADMISSION_DESIGNATED_DOCTOR', resourceId: row.id, changes: { active: { old: true, new: false } } });
    return { removed: true };
  }

  /**
   * 오더 입력 범위(직종별) — 정본 shared `order-entry-scope`. 원내 설정 `order.entryScope` 는 **낮추기만**(상한은 shared 가 강제).
   * 🔴 종전엔 "비처방 역할이면 어떤 오더든 의사 승인" 한 가지라, 간호사가 자기 업무 범위의 간호 중재를 기록할 때도
   *    의사 승인을 받아야 했고, 치료사는 역할이 없어 입력 경로 자체가 없었다(2026-09-29).
   */
  private async entryScopeOverride(): Promise<OrderEntryScopeOverride | null> {
    const v = await this.config.get('order.entryScope');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as OrderEntryScopeOverride) : null;
  }

  async getEntryScope(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, profession: true } });
    const override = await this.entryScopeOverride();
    const { profession, source } = resolveProfession(u?.role, u?.profession);
    return {
      role: u?.role ?? null,
      profession,
      /** SET=계정에 지정 · ROLE_DEFAULT=역할 기본 · MISMATCH_IGNORED=역할과 맞지 않아 무시 · NONE=직종 없음 */
      professionSource: source,
      modes: orderEntryModes(u?.role, u?.profession, override),
      /** 유형별 완료·결과 기록 가능 여부(정본 shared canExecuteOrder) — 화면이 완료 버튼·결과 기록 칸을 가른다 */
      executes: Object.fromEntries(ORDER_ENTRY_TYPES.map((t) => [t, canExecuteOrder(u?.role, u?.profession, t)])) as Record<string, boolean>,
      /** 원내 설정으로 기본 범위를 조정했는가 — 조정 없으면 코드 기본값(보수적)이 적용 중이다 */
      overrideConfigured: !!override && Object.keys(override).length > 0,
    };
  }

  private async entryModeOf(actor: { role: string; profession?: string | null }, type: string | null | undefined): Promise<OrderEntryMode> {
    return orderEntryMode(actor.role, actor.profession ?? null, type ?? '', await this.entryScopeOverride());
  }

  /**
   * 비의사가 오더를 붙일 **진행 중 진료** — 새 진료를 열지 않는다(진료 개시는 의사 몫).
   * 🔴 (2026-09-29) `/orders` 새 처방 창은 환자를 고르면 무조건 `POST /encounters`(의사·관리자 전용)를 불러
   *    간호사·의료기사는 환자 선택 단계에서 403 '진료 생성 실패'로 멈췄다 — 비의사 입력 경로가 개통 이래 없었다.
   * 우선순위: 재원 중 입원의 진료(최신) → 오늘 진료(최신). 없으면 null + 사유(지어내지 않는다).
   */
  async findOrderEncounter(patientId: string): Promise<{ encounterId: string | null; context: 'ADMISSION' | 'TODAY' | null; doctorName: string | null; createdAt: Date | null; reason: string | null }> {
    const pick = { id: true, createdAt: true, doctor: { select: { familyName: true, givenName: true } } } as const;
    const adm = await this.prisma.admission.findFirst({
      // TRANSFERRED 는 전원으로 끝난 입원이다 — 진행 중인 입원은 ADMITTED 뿐
      where: { patientId, status: 'ADMITTED' },
      orderBy: { admitDate: 'desc' },
      select: { id: true },
    });
    if (adm) {
      const enc = await this.prisma.encounter.findFirst({ where: { admissionId: adm.id }, orderBy: { createdAt: 'desc' }, select: pick });
      if (enc) return { encounterId: enc.id, context: 'ADMISSION', doctorName: `${enc.doctor?.familyName ?? ''}${enc.doctor?.givenName ?? ''}` || null, createdAt: enc.createdAt, reason: null };
    }
    const today = await this.prisma.encounter.findFirst({ where: { patientId, createdAt: todayRange() }, orderBy: { createdAt: 'desc' }, select: pick });
    if (today) return { encounterId: today.id, context: 'TODAY', doctorName: `${today.doctor?.familyName ?? ''}${today.doctor?.givenName ?? ''}` || null, createdAt: today.createdAt, reason: null };
    return { encounterId: null, context: null, doctorName: null, createdAt: null, reason: 'NO_ACTIVE_ENCOUNTER' };
  }

  /** 처방의 규칙 조회(기본 OFF) */
  async getPrescriberRules(): Promise<PrescriberRules> {
    const r = (await this.config.get('prescription.prescriberRules')) as Partial<PrescriberRules> | null;
    return {
      enabled: r?.enabled ?? false,
      allowDelegate: r?.allowDelegate ?? false,
      requireDelegateAuth: r?.requireDelegateAuth ?? true,
      allowedRoles: Array.isArray(r?.allowedRoles) && r!.allowedRoles!.length ? r!.allowedRoles! : ['DOCTOR'],
      requireSpecialtyMatch: r?.requireSpecialtyMatch ?? false,
      requireAttending: r?.requireAttending ?? false,
      departmentGuidelines: (r?.departmentGuidelines as Record<string, string>) ?? {},
    };
  }

  /**
   * 처방 추가 가능한 진료기록 상태 가드(옵트인) — SystemConfig: clinical.prescriptionRequiresOpenEncounter.
   * 기본 OFF(현행 유지·무회귀). ON 이면 **SIGNED(서명 완료·봉인)** 진료기록에 새 처방 추가를 차단한다.
   *   - DRAFT(작성 중): 정상 처방 흐름 → 허용
   *   - AMENDED(정정 중): 합법적 정정 흐름(추가 후 재서명) → 허용 ([[clinical.requireResignAfterAmend]] 게이트가 재서명 강제)
   *   - SIGNED(봉인): 정정(amend)으로 AMENDED 전환 또는 재진료 생성이 정도(正道) → 차단
   * 봉인된 기록에 처방을 끼워넣어 서명 무결성을 우회하는 것을 막는다.
   */
  private async assertEncounterPrescribable(encounter: { status: string }): Promise<void> {
    const flag = await this.config.get('clinical.prescriptionRequiresOpenEncounter');
    if (flag !== true && flag !== 'true') return; // 옵트인 — 미설정 시 현행 동작
    if (encounter.status === 'SIGNED') {
      throw new BadRequestException({
        code: 'ENCOUNTER_NOT_PRESCRIBABLE',
        message: '이미 서명된 진료기록에는 처방을 추가할 수 없습니다. 정정(amend) 후 추가하거나 재진료를 생성하세요.',
      });
    }
  }

  /** 처방의 규칙 저장(관리자) */
  async setPrescriberRules(rules: Partial<PrescriberRules>, updatedBy: string): Promise<PrescriberRules> {
    const cur = await this.getPrescriberRules();
    // 처방 권한 역할은 의료법상 의사로 한정(+ADMIN 시스템 오버라이드) — FE prescriber-rules ROLE_OPTS 와 일치.
    //   NURSE/PHARMACIST 등은 처방 책임자가 될 수 없으므로 화이트리스트에서 제외(API 우회 설정 차단).
    const VALID_ROLES = ['DOCTOR', 'ADMIN'];
    const reqRoles = Array.isArray(rules.allowedRoles) ? rules.allowedRoles.filter((r) => VALID_ROLES.includes(r)) : [];
    const next: PrescriberRules = {
      enabled: rules.enabled ?? cur.enabled,
      allowDelegate: rules.allowDelegate ?? cur.allowDelegate,
      requireDelegateAuth: rules.requireDelegateAuth ?? cur.requireDelegateAuth,
      allowedRoles: reqRoles.length ? reqRoles : cur.allowedRoles, // 유효 역할만·빈배열 거부(기존 유지)
      requireSpecialtyMatch: rules.requireSpecialtyMatch ?? cur.requireSpecialtyMatch,
      requireAttending: rules.requireAttending ?? cur.requireAttending,
      departmentGuidelines: rules.departmentGuidelines ?? cur.departmentGuidelines,
    };
    await this.config.set('prescription.prescriberRules', next, updatedBy);
    return next;
  }

  /**
   * 진료(encounter)에 대해 처방의로 지정 가능한 사용자 목록 + 적용 가이드라인 — 처방 작성 화면용.
   * 규칙(역할/전문과 일치/주치의)을 그대로 반영. 미활성 시 본인만.
   */
  async getAuthorizedPrescribers(encounterId: string, actingUserId: string) {
    const rules = await this.getPrescriberRules();
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: {
        id: true, admissionId: true,
        doctor: { select: { id: true, department: true } },
        admission: { select: { attendingDoctorId: true, admittingDoctorId: true } },
      },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');
    const encDept = encounter.doctor?.department ?? null;
    const guideline = encDept ? (rules.departmentGuidelines[encDept] ?? null) : null;

    const me = await this.prisma.user.findUnique({ where: { id: actingUserId }, select: { id: true, role: true } });
    // 유형별 입력 모드 — 화면이 탭마다 '본인 권한 / 의사 승인 / 불가'를 그린다(delegationRequired 는 구 호출부 호환)
    const entryScope = await this.getEntryScope(actingUserId);
    // 비처방 역할(간호사·임상병리사)은 **규칙 on/off 와 무관하게** 지정이 강제되므로,
    // 규칙이 꺼져 있다고 후보 목록을 비우면 화면에서 아무도 고를 수 없어 입력 자체가 막힌다.
    const delegationRequired = !!me && me.role !== 'ADMIN' && !rules.allowedRoles.includes(me.role);
    if (!rules.enabled && !delegationRequired) {
      return { enabled: false, allowDelegate: false, delegationRequired: false, entryScope, guideline, encounterDepartment: encDept, prescribers: me ? [{ id: actingUserId, self: true }] : [] };
    }

    // 후보: 역할 허용 + 활성. 입원+requireAttending 이면 담당 의료군(care group)으로 제한
    //   (주치의·입원담당의·해당진료의·활성 협진의·추가 지정의). 협진의는 타과라도 포함되어야
    //   하므로 care group 모드에선 전문과 일치를 추가로 강제하지 않음.
    let where: Prisma.UserWhereInput = { isActive: true, role: { in: rules.allowedRoles as any } };
    let careGroup: string[] | null = null;
    if (rules.requireAttending && encounter.admissionId) {
      careGroup = await this.careGroupDoctorIds({ id: encounter.id, admissionId: encounter.admissionId, doctorId: encounter.doctor?.id });
      where = { ...where, id: { in: careGroup.length ? careGroup : ['00000000-0000-0000-0000-000000000000'] } };
    } else if (rules.requireSpecialtyMatch && encDept) {
      where = { ...where, department: encDept };
    }
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, familyName: true, givenName: true, role: true, department: true, specialty: true },
      orderBy: [{ familyName: 'asc' }],
      take: 200,
    });
    const attendingId = encounter.admission?.attendingDoctorId ?? null;
    return {
      enabled: true,
      allowDelegate: rules.allowDelegate,
      requireDelegateAuth: rules.requireDelegateAuth,
      guideline,
      encounterDepartment: encDept,
      admissionId: encounter.admissionId,
      careGroupMode: !!careGroup,
      /** 이 사용자는 지정 처방의 + 승인 없이는 처방을 저장할 수 없다(간호사·임상병리사) */
      delegationRequired,
      entryScope,
      prescribers: users.map((u) => ({
        id: u.id,
        name: `${u.familyName ?? ''}${u.givenName ?? ''}`.trim(),
        role: u.role,
        department: u.department,
        specialty: u.specialty,
        self: u.id === actingUserId,
        attending: u.id === attendingId,
      })),
    };
  }

  /**
   * 처방의(책임 처방자) 결정·검증. 위임 시 지정 처방의의 step-up 토큰 소비.
   * 반환: 저장할 prescriberId. 미활성 시 actingUserId.
   */
  private async resolvePrescriber(
    encounter: { id: string; admissionId: string | null },
    actingUserId: string,
    designated?: string,
    prescriberStepUpToken?: string,
    body?: Parameters<typeof hashPrescriptionBody>[0],
    orderType?: string,
  ): Promise<string> {
    const rules = await this.getPrescriberRules();

    // 작성자가 **처방 권한 역할이 아닌 경우**(간호사 구두처방 대리입력·임상병리사 워크인 검사 등록):
    // 규칙 on/off 와 무관하게 지정 처방의 + 그 의사의 승인을 강제한다(fail-closed).
    // 규칙이 꺼져 있다는 이유로 대리입력자가 책임 처방자로 기록되면 의료법상 처방 주체가 뒤바뀐다.
    // ADMIN 은 운영 계정이라 종전 동작(본인 명의)을 유지한다.
    const actor = await this.prisma.user.findUnique({ where: { id: actingUserId }, select: { role: true, profession: true } });
    const actorMayPrescribe = !!actor && (actor.role === 'ADMIN' || rules.allowedRoles.includes(actor.role));
    if (!actorMayPrescribe) {
      // 직종별 입력 범위(2026-09-29) — NONE 은 거부, SELF 는 본인이 책임자(간호사의 간호 오더), DELEGATE 는 아래 종전 흐름
      const mode = actor ? await this.entryModeOf(actor, orderType ?? body?.type) : 'NONE';
      if (mode === 'NONE') {
        throw new ForbiddenException({ code: 'ORDER_SCOPE_DENIED', message: '이 직종의 입력 범위에 없는 오더 유형입니다.' });
      }
      if (mode === 'SELF') return actingUserId;
      const target = designated?.trim();
      if (!target || target === actingUserId) {
        throw new ForbiddenException({
          code: 'PRESCRIBER_REQUIRED',
          message: '처방 권한이 없는 역할은 책임 처방의를 지정해야 합니다.',
        });
      }
      await this.assertPrescriberEligible(encounter, target, rules);
      if (!prescriberStepUpToken) {
        throw new UnauthorizedException({
          code: 'PRESCRIBER_AUTH_REQUIRED',
          message: '지정 처방의의 승인(인증)이 필요합니다.',
          prescriberId: target,
        });
      }
      const claims = await this.stepUp.consume(prescriberStepUpToken, target, 'PRESCRIPTION_CREATE', {
        resourceId: encounter.id,
        bodyHash: body ? hashPrescriptionBody(body) : undefined,
      });
      if (body && !claims.bodyHash) {
        throw new UnauthorizedException({ code: 'STEPUP_BODY_UNBOUND', message: '승인 토큰이 처방 내용에 바인딩되어 있지 않습니다. 처방의 승인을 다시 요청하세요.' });
      }
      return target;
    }

    // 규칙 비활성 시 지정(designated)은 **무시**하고 작성자 본인 강제 — 규칙 엔진이 없으면
    //   검증·인증이 없으므로 임의 지정을 허용하면 타인 사칭이 된다(보안 수정).
    if (!rules.enabled) return actingUserId;
    const prescriberId = designated?.trim() || actingUserId;

    await this.assertPrescriberEligible(encounter, prescriberId, rules);

    // 위임(본인 외 지정): 허용 여부 + 지정 처방의 인증
    if (prescriberId !== actingUserId) {
      if (!rules.allowDelegate) throw new ForbiddenException({ code: 'DELEGATE_NOT_ALLOWED', message: '대리(위임) 처방이 허용되지 않습니다.' });
      if (rules.requireDelegateAuth) {
        if (!prescriberStepUpToken) {
          throw new UnauthorizedException({ code: 'PRESCRIBER_AUTH_REQUIRED', message: '지정 처방의의 승인(인증)이 필요합니다.', prescriberId });
        }
        // 지정 처방의(sub=prescriberId) 토큰만 유효 — 입력자 토큰으로 우회 불가.
        // bodyHash 로 약품 내용까지 바인딩 — 폰에서 승인한 처방과 실제 저장 처방이 다르면 거부(부인방지).
        const claims = await this.stepUp.consume(prescriberStepUpToken, prescriberId, 'PRESCRIPTION_CREATE', {
          resourceId: encounter.id,
          bodyHash: body ? hashPrescriptionBody(body) : undefined,
        });
        // 토큰이 처방 내용에 바인딩되지 않았으면 거부 — bodyHash 없는 토큰(구 경로)으로 임의 약품 저장 차단.
        if (body && !claims.bodyHash) {
          throw new UnauthorizedException({ code: 'STEPUP_BODY_UNBOUND', message: '승인 토큰이 처방 내용에 바인딩되어 있지 않습니다. 처방의 승인을 다시 요청하세요.' });
        }
      }
    }
    return prescriberId;
  }

  /**
   * 지정 처방의 자격 검증(위임 토큰 소비 제외) — resolvePrescriber 와 delegate-request 가 공유.
   * 존재·활성·역할·담당 의료군(입원)·전문과 일치를 강제. 실패 시 throw.
   */
  private async assertPrescriberEligible(
    encounter: { id: string; admissionId: string | null },
    prescriberId: string,
    rules: PrescriberRules,
  ): Promise<void> {
    const prescriber = await this.prisma.user.findUnique({
      where: { id: prescriberId },
      select: { id: true, role: true, department: true, isActive: true },
    });
    if (!prescriber || !prescriber.isActive) throw new BadRequestException({ code: 'PRESCRIBER_INVALID', message: '지정한 처방의가 유효하지 않습니다.' });
    if (!rules.allowedRoles.includes(prescriber.role)) {
      throw new BadRequestException({ code: 'PRESCRIBER_ROLE', message: '해당 사용자는 처방 권한이 없습니다.' });
    }

    // 입원 환자: 담당 의료군(주치의·협진의·지정의 등) 멤버만 — 의료법 §18(직접 진찰한 의사) 부합.
    //   협진의는 타과라도 포함되므로 care group 모드에선 전문과 일치를 추가 강제하지 않음.
    if (rules.requireAttending && encounter.admissionId) {
      const enc = await this.prisma.encounter.findUnique({ where: { id: encounter.id }, select: { doctor: { select: { id: true } } } });
      const group = await this.careGroupDoctorIds({ id: encounter.id, admissionId: encounter.admissionId, doctorId: enc?.doctor?.id });
      if (!group.includes(prescriberId)) {
        throw new BadRequestException({ code: 'PRESCRIBER_NOT_IN_CARE_GROUP', message: '입원 환자는 담당 의료군(주치의·협진의·지정의)만 처방의로 지정할 수 있습니다. 필요 시 지정의를 배치하세요.' });
      }
    } else if (rules.requireSpecialtyMatch) {
      const enc = await this.prisma.encounter.findUnique({ where: { id: encounter.id }, select: { doctor: { select: { department: true } } } });
      if (enc?.doctor?.department && prescriber.department !== enc.doctor.department) {
        throw new BadRequestException({ code: 'PRESCRIBER_SPECIALTY_MISMATCH', message: `처방의 진료과가 진료 진료과(${enc.doctor.department})와 일치하지 않습니다.` });
      }
    }
  }

  /**
   * 위임 처방 승인 요청(서버 권위적) — 입력자가 지정 처방의에게 폰 승인 요청.
   * bodyHash·summary 를 **서버에서** 처방 본문으로 계산해 토큰에 바인딩 → FE 가 임의 해시를 보내 우회할 수 없음.
   * resolvePrescriber 와 동일한 자격·규칙 검증을 통과해야 요청 발송.
   */
  async requestPrescriberDelegate(
    encounterId: string,
    requesterId: string,
    prescriberId: string,
    body: Parameters<typeof hashPrescriptionBody>[0],
  ): Promise<{ requestId: string; expiresAt: string }> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, admissionId: true },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');

    const rules = await this.getPrescriberRules();
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId }, select: { role: true, profession: true } });
    const requesterMayPrescribe = !!requester && (requester.role === 'ADMIN' || rules.allowedRoles.includes(requester.role));
    if (!requesterMayPrescribe) {
      // 🔴 (2026-09-29) 종전엔 이 EP 가 규칙 OFF 면 무조건 거부했다 — 그런데 저장(resolvePrescriber)은 비처방 역할에게
      //    **규칙과 무관하게** 승인 토큰을 요구한다. 운영은 규칙 OFF 라 간호사 구두처방 대리입력이 **저장 불가**였다
      //    (토큰을 받을 길이 없음). 비처방 역할의 승인 요청은 직종 범위(DELEGATE)가 허가한다 — 규칙 on/off 는 의사 간 위임에만.
      const mode = requester ? await this.entryModeOf(requester, body.type) : 'NONE';
      if (mode === 'NONE') throw new ForbiddenException({ code: 'ORDER_SCOPE_DENIED', message: '이 직종의 입력 범위에 없는 오더 유형입니다.' });
      if (mode === 'SELF') throw new BadRequestException({ code: 'DELEGATE_NOT_NEEDED', message: '본인 권한으로 등록하는 오더입니다 — 의사 승인이 필요 없습니다.' });
    } else {
      if (!rules.enabled) throw new BadRequestException({ code: 'PRESCRIBER_RULES_DISABLED', message: '처방의 지정 규칙이 비활성 상태입니다.' });
      if (!rules.allowDelegate) throw new ForbiddenException({ code: 'DELEGATE_NOT_ALLOWED', message: '대리(위임) 처방이 허용되지 않습니다.' });
    }
    if (!prescriberId?.trim() || prescriberId === requesterId) {
      throw new BadRequestException({ code: 'DELEGATE_SELF', message: '본인에게는 위임 승인을 요청할 수 없습니다.' });
    }

    await this.assertPrescriberEligible({ id: encounter.id, admissionId: encounter.admissionId ?? null }, prescriberId, rules);

    // 요약(폰 표시)·bodyHash 모두 서버에서 처방 본문 기준으로 생성
    const TYPE_LABEL: Record<string, string> = { MEDICATION: '약 처방', LAB: '검사 처방', IMAGING: '영상 처방', THERAPY: '치료 처방', DIET: '식이 처방', ACTIVITY: '활동 처방', NURSING: '간호 오더' };
    const typeLabel = (body.type && TYPE_LABEL[body.type]) ?? (body.type ?? '처방');
    // 🔴 (2026-10-13 결함 발굴 B1) 종전 요약은 `코드 <uuid>` — 처방의가 폰에서 **무슨 약인지 모른 채** 승인했다.
    //    원장의 약품·행위 이름을 싣는다. 없는 코드면 승인 요청을 만들지 않는다(저장도 어차피 실패한다).
    const [med, proc] = await Promise.all([
      body.medicationCodeId ? this.prisma.medicationCode.findUnique({ where: { id: body.medicationCodeId }, select: { nameKo: true } }) : null,
      body.procedureCodeId ? this.prisma.procedureCode.findUnique({ where: { id: body.procedureCodeId }, select: { nameKo: true } }) : null,
    ]);
    if ((body.medicationCodeId && !med) || (body.procedureCodeId && !proc)) {
      throw new BadRequestException({ code: 'DELEGATE_CODE_NOT_FOUND', message: '처방 코드를 찾을 수 없어 승인 요청을 만들지 않았습니다.' });
    }
    const summary = [typeLabel, med?.nameKo ?? proc?.nameKo, body.dosage, body.frequency, body.duration != null ? `${body.duration}일` : null]
      .filter(Boolean)
      .join(' · ');
    const bodyHash = hashPrescriptionBody(body);

    return this.pushApproval.requestDelegate(requesterId, prescriberId, 'PRESCRIPTION_CREATE', encounterId, bodyHash, summary);
  }

  /**
   * 사전승인 발행 게이트(공유 choke point) — 마약류(control_schedule)·고가검사(config 판정) 발행 전 결재 확인.
   * create·copy·repeat 등 모든 처방 발행 경로가 이 헬퍼를 호출한다(게이트 우회 방지·F1~F3).
   * 게이트 OFF(기본) 시 no-op. preAuthRef(승인 훅)·응급(emergency+사유)·승인 존재 시 통과, BLOCK+미승인 시 차단.
   */
  private async assertPreAuthForOrder(
    item: { type: string; medicationCodeId?: string | null; procedureCodeId?: string | null; priority?: string | null },
    patientId: string, encounterId: string, userId: string,
    extra?: { preAuthRef?: string; emergency?: boolean; bypassReason?: string },
  ): Promise<{ postFactoId?: string }> {
    // ?? {} — 게이트 스텁/구버전 목이 void를 반환해도 안전(실서비스는 항상 객체 반환)
    return (await this.preAuthGate.assertOrderGate(item, {
      patientId, encounterId, requestedByUserId: userId,
      preAuthRef: extra?.preAuthRef, emergency: extra?.emergency, bypassReason: extra?.bypassReason, draft: { encounterId, item },
    })) ?? {};
  }

  async create(encounterId: string, dto: CreatePrescriptionDto, userId: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }, extra?: { prescriberId?: string; prescriberStepUpToken?: string; preAuthRef?: string; emergency?: boolean; bypassReason?: string; orderSource?: string; readBackConfirmed?: boolean; dischargeMed?: boolean; durExcludePrescriptionIds?: string[] }) {
    // 진료기록 존재 확인
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException('Encounter not found');

    // 진료기록 상태 가드(옵트인) — 봉인된(SIGNED) 기록엔 처방 추가 차단
    await this.assertEncounterPrescribable(encounter);

    // DUR 점검 (약 처방인 경우)
    let durWarnings: DurWarning[] = [];
    if (dto.type === 'MEDICATION' && dto.medicationCodeId) {
      durWarnings = await this.durService.checkInteractions(
        encounterId,
        dto.medicationCodeId,
        encounter.patientId,
        // maxDailyDose(DB) 검사용 · 퇴원약은 곧 끝날 입원 약을 비교에서 뺀다(퇴원약끼리·원외 복용약과만 본다)
        { dosage: dto.dosage, frequency: dto.frequency, ...(extra?.durExcludePrescriptionIds?.length ? { excludePrescriptionIds: extra.durExcludePrescriptionIds } : {}) },
      );

      // 고위험/LASA는 checkInteractions에서 처리됨. 여기서는 1회 최대용량(dosage 의존)만 추가 점검
      if (dto.dosage) {
        const medCode = await this.prisma.medicationCode.findUnique({ where: { id: dto.medicationCodeId }, select: { maxSingleDose: true } });
        if (medCode?.maxSingleDose) {
          const doseNum = parseFloat(dto.dosage);
          if (!isNaN(doseNum) && doseNum > Number(medCode.maxSingleDose)) {
            durWarnings.push({ type: 'MAX_DOSE', severity: 'ERROR', message: `1회 최대용량 초과: ${dto.dosage} > ${medCode.maxSingleDose}` });
          }
        }
      }

      // DUR 강제게이트 — ERROR 시 dur.enforce(기본 BLOCK) 모드별 차단/경고 + GateViolationLog 영속
      await this.applyDurGate(durWarnings, { encounterId, path: 'CREATE', override: { flag: dto.overrideDur, reason: dto.overrideReason } });
    }

    // CDSS 게이트(옵트인) — DUR 외 임상 검증(알레르기 원장·신기능 용량·연령 금기). cdss.enforce=OFF/WARN/BLOCK(기본 OFF).
    // DUR은 위에서 이미 차단했으므로 중복 실행하지 않음(skipDur). resolvePrescriber 이전에 수행해
    // 위임 step-up 토큰이 CDSS 실패로 소비되지 않게 한다(DUR과 동일 원칙).
    let cdssResult: CdssResult | null = null;
    if (dto.type === 'MEDICATION' && dto.medicationCodeId && this.cdssService) {
      const cdssMode = gateMode(await this.config.get('cdss.enforce'), 'OFF');
      if (cdssMode !== 'OFF') {
        cdssResult = await this.cdssService.check({
          patientId: encounter.patientId,
          medicationCodeId: dto.medicationCodeId,
          dosage: dto.dosage,
          frequency: dto.frequency,
          duration: dto.duration,
          route: dto.route,
          encounterId,
          skipDur: true,
          override: dto.overrideCdss ? { reason: dto.overrideReason, acknowledgerId: userId } : undefined,
        });
        if (cdssMode === 'BLOCK' && cdssResult.level === 'ERROR' && !dto.overrideCdss) {
          throw new BadRequestException({
            code: 'CDSS_CHECK_FAILED',
            message: 'CDSS 임상 검증에서 위험 경고가 발생했습니다. 강제 처방하려면 overrideCdss: true를 전송하세요.',
            cdssChecks: cdssResult.checks.filter((c) => c.level !== 'PASS'),
          });
        }
      }
    }

    // 원내 처방집 게이트 — 위원회 승인 여부(WARN=기록·BLOCK=차단). DUR/CDSS와 같은 이유로
    // resolvePrescriber 이전에 수행해 위임 step-up 토큰이 게이트 차단으로 소비되지 않게 한다.
    await this.assertFormularyForOrder(
      { type: dto.type, medicationCodeId: dto.medicationCodeId, procedureCodeId: dto.procedureCodeId },
      { encounterId, path: 'CREATE' },
    );

    // 처방의(책임 처방자) 결정·검증 — DUR 통과 후에 수행해야 위임 토큰이 DUR 실패로 소비되지 않음.
    //   규칙 미활성 시 작성자 본인. 위임 시 지정 처방의 step-up 토큰 소비(1회용).
    const prescriberId = await this.resolvePrescriber(
      { id: encounter.id, admissionId: encounter.admissionId ?? null },
      userId,
      extra?.prescriberId,
      extra?.prescriberStepUpToken,
      {
        type: dto.type,
        medicationCodeId: dto.medicationCodeId,
        procedureCodeId: dto.procedureCodeId,
        dosage: dto.dosage,
        frequency: dto.frequency,
        duration: dto.duration,
        quantity: dto.quantity,
        route: dto.route,
      },
      dto.type,
    );

    // 사전승인 발행 게이트 — 모든 발행 경로 공유 choke point(F1~F3 우회 차단). 게이트 OFF 시 no-op.
    const preAuthGateResult = await this.assertPreAuthForOrder(
      { type: dto.type, medicationCodeId: dto.medicationCodeId, procedureCodeId: dto.procedureCodeId, priority: dto.priority },
      encounter.patientId, encounterId, userId, extra,
    );

    // 지시 경로·복창 — 구두/전화가 아니면 복창 개념 자체가 없다(참으로 적지 않는다)
    // 🔴 어휘 정본은 shared `isVerbalOrder` 하나다(FE 도 같은 함수를 쓴다 — 두 벌이면 조용히 갈라진다)
    const orderSource = extra?.orderSource;
    const readBackRecorded = isVerbalOrder(orderSource) && extra?.readBackConfirmed === true;

    const { prescription, orderId } = await this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.create({
        data: {
          encounterId,
          type: dto.type,
          medicationCodeId: dto.medicationCodeId,
          procedureCodeId: dto.procedureCodeId,
          dosage: dto.dosage,
          frequency: dto.frequency,
          duration: dto.duration,
          quantity: dto.quantity,
          route: dto.route,
          instructions: dto.instructions,
          priority: dto.priority ?? 'ROUTINE',
          source: dto.source ?? 'MANUAL',
          dispensingType: dto.dispensingType ?? 'INTERNAL',
          rxValidUntil: dto.dispensingType === 'EXTERNAL' ? new Date(Date.now() + 3 * 86400000) : undefined,
          durChecked: dto.type === 'MEDICATION',
          durWarnings: durWarnings.length > 0 ? durWarnings as any : undefined,
          durOverridden: dto.overrideDur ?? false,
          // 🔴 COPY·REPEAT 는 남기는데 CREATE 만 빠져 있었다 — 같은 사실에 정본이 둘(P12).
          //    강제 처방의 who/why 가 원장에 없으면 약국·심사는 감사 로그를 뒤져야 한다.
          durOverrideReason: dto.overrideDur ? dto.overrideReason?.trim() ?? null : null,
          durOverrideBy: dto.overrideDur ? userId : null,
          durOverrideAt: dto.overrideDur ? new Date() : null,
          createdBy: userId,
          prescriberId,
          diagnosisCodeId: dto.diagnosisCodeId,
          // 지시 경로 — 미전송은 종전대로 WRITTEN(스키마 기본값)이다. 화면이 고른 값만 그대로 적는다.
          orderSource: orderSource ?? undefined,
          // 🔴 복창은 **구두·전화 처방일 때, 실제로 확인했다고 표시한 경우에만** 기록한다.
          //    기본을 참으로 두면 "복창 누락"이 구조적으로 영원히 0이 된다(v4.5.0 위급값 복창과 같은 함정).
          readBackConfirmedAt: readBackRecorded ? new Date() : undefined,
          readBackConfirmedBy: readBackRecorded ? userId : undefined,
          // 퇴원약 — 퇴원 전용 경로(createDischargePrescription)만 참으로 적는다
          ...(extra?.dischargeMed === true ? { dischargeMed: true } : {}),
        },
        include: {
          medicationCode: { select: { code: true, nameKo: true, ingredient: true } },
          procedureCode: { select: { code: true, nameKo: true } },
        },
      });

      // OCS: 처방으로부터 오더 자동 생성 — 생성 데이터는 buildOrderData 단일 정본
      const order = await tx.order.create({
        data: buildOrderData({ prescriptionId: rx.id, type: dto.type, priority: dto.priority, dispensingType: dto.dispensingType }),
      });

      return { prescription: rx, orderId: order.id };
    });

    // 여정 이벤트는 JourneyListener가 order.created를 단일 구독점으로 처리(8개 생성 경로 균일 커버)
    // Emit order.created event (after transaction success)
    this.eventEmitter.emit('order.created', {
      orderId,
      type: dto.type,
      patientId: encounter.patientId,
      encounterId,
      procedureCodeId: dto.procedureCodeId,
      priority: dto.priority ?? 'ROUTINE',
      notes: dto.instructions,
    });

    // 마약류/향정 통제원장 자동 발행 — controlSchedule 보유 약품이면 ControlledSubstanceLog(PRESCRIBED) 생성.
    // 기존엔 CPOE 마약류 처방이 원장/NIMS/2인검증 워크플로우에 전혀 진입하지 않던 갭(hospice만 연동).
    // best-effort: 원장 실패가 처방을 막지 않음(발행 차단은 사전승인 NARCOTIC_RX 게이트 소관).
    if (dto.type === 'MEDICATION' && dto.medicationCodeId && this.controlledSubstance) {
      try {
        const med = await this.prisma.medicationCode.findUnique({
          where: { id: dto.medicationCodeId },
          select: { controlSchedule: true, code: true, nameKo: true, dosageForm: true, narcoticType: true, psychotropicGroup: true },
        });
        if (med?.controlSchedule) {
          await this.controlledSubstance.prescribe({
            patientId: encounter.patientId,
            prescriptionId: prescription.id,
            drugName: med.nameKo,
            drugCode: med.code,
            deaSchedule: med.controlSchedule,
            // NIMS 분류 — 약품마스터 큐레이션 값(관리자 코드마스터 화면에서 충전) 자동 반영
            narcoticType: med.narcoticType ?? undefined,
            psychotropicGroup: med.psychotropicGroup ?? undefined,
            quantity: dto.quantity ?? 1,
            unit: med.dosageForm ?? 'EA',
            prescribedBy: prescriberId ?? userId,
            notes: `CPOE 자동발행 rx:${prescription.id}`,
          });
        }
      } catch (e) {
        console.warn(`[prescription] 마약류 원장 자동발행 실패 rx=${prescription.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // CDSS 경고 무시(override) 감사 — CdssLog(acknowledger/reason)에 더해 감사 원장에도 남긴다.
    if (dto.overrideCdss && cdssResult && cdssResult.level === 'ERROR') {
      await this.audit.safeLog({
        userId, action: AuditAction.UPDATE, resourceType: 'PRESCRIPTION_CDSS_OVERRIDE', resourceId: prescription.id,
        changes: {
          overridden: { old: false, new: true },
          overrideReason: { old: null, new: dto.overrideReason ?? '(사유 미입력)' },
          checks: { old: null, new: cdssResult.checks.filter((c) => c.level === 'ERROR').map((c) => `${c.category}: ${c.message}`).slice(0, 10) },
        },
      });
    }

    // DUR 경고 무시(override) 감사 — 약국/심사 추적(who/why). 사유(overrideReason) 포함.
    if (dto.overrideDur && durWarnings.length > 0) {
      await this.audit.safeLog({
        userId, action: AuditAction.UPDATE, resourceType: 'PRESCRIPTION_DUR_OVERRIDE', resourceId: prescription.id,
        changes: {
          durOverridden: { old: false, new: true },
          overrideReason: { old: null, new: dto.overrideReason ?? '(사유 미입력)' },
          warnings: { old: null, new: (durWarnings as any[]).map((w) => w?.message ?? w?.code ?? String(w)).slice(0, 10) },
          prescriberId: { old: null, new: prescriberId ?? null },
        },
      });
    }

    // Blockchain signature (non-blocking)
    if (blockchainSignature) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'PRESCRIPTION',
          documentId: prescription.id,
          patientId: encounter.patientId,
          signerUserId: userId,
        });
} catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    // 사후승인(우회 발행) 링크 — 소급 결재 반려 시 이 처방을 자동취소할 수 있도록 fulfilledRef 연결(best-effort)
    void this.preAuthGate.linkPostFacto?.(preAuthGateResult.postFactoId, prescription.id);

    return {
      prescription,
      durWarnings,
      // CDSS WARN/override 시 FE 표시용 — PASS 제외 경고만 동봉(게이트 OFF면 undefined)
      cdssWarnings: cdssResult ? cdssResult.checks.filter((c) => c.level !== 'PASS') : undefined,
    };
  }

  async findByEncounter(encounterId: string) {
    return this.prisma.prescription.findMany({
      where: { encounterId },
      include: {
        medicationCode: { select: { code: true, nameKo: true, unitPrice: true } },
        procedureCode: { select: { code: true, nameKo: true, unitPrice: true } },
        orders: { select: { id: true, department: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 환자별 처방 목록 — 차트 투약 이력·오더 추적의 정본.
   *
   * 🔴 종전에 이 응답이 차트에서 **두 가지 거짓말**을 만들었다(2026-08-26 실측·봉합).
   *
   *  ① **조제·검수·불출이 응답에 없었다.** `orders` 는 include 하면서 `dispensing` 은 안 했다.
   *     그래서 차트 어느 탭에도 "조제됐는지·누가 받아갔는지"가 없었다
   *     (운영 `issuedTo` **325건**·검수 시각 전량이 차트에서 보이지 않았다).
   *     게다가 오더는 **조제 완료 시점에 이미 COMPLETED** 라, `order.status` 만 읽는
   *     오더 추적 탭이 **검수 전·불출 전인 건을 '완료'** 라고 말했다(실측 5건 진행 중).
   *     → `dispensing` 을 함께 실어 화면이 단계를 말할 수 있게 한다. **상태 전이는 그대로 둔다**
   *       (소비처가 여럿이라 바꾸면 깨진다 — 고칠 곳은 화면의 말이다).
   *
   *  ② **`status`·`limit` 쿼리를 조용히 무시했다.** `OverviewTab` 은 `?status=ACTIVE&limit=20`
   *     으로 부르는데 서버가 전건을 돌려줘, **취소된 처방까지** "현재 복용 중" 카드와
   *     자동 DUR 점검 입력에 들어갔다. 필터를 흉내내면 화면은 걸러진 줄 안다.
   *     → 실제로 거른다. 알 수 없는 status 값은 **무시하지 않고 거부**한다(400).
   */
  async findByPatient(patientId: string, opts?: { status?: string; limit?: number }) {
    const status = this.normalizePrescriptionStatus(opts?.status);
    const rows = await this.prisma.prescription.findMany({
      where: { encounter: { patientId }, ...(status ? { status } : {}) },
      include: {
        medicationCode: true,
        procedureCode: true,
        orders: {
          select: {
            id: true,
            department: true,
            status: true,
            pharmacyType: true,
            receivedAt: true,
            startedAt: true,
            completedAt: true,
            priority: true,
            createdAt: true,
            // 🔴 조제 체인은 여기서만 사실을 말한다 — 오더는 조제 완료에서 닫히기 때문이다.
            //    시각은 **실제로 일어난 것만** 온다(미발생은 null — 지어내지 않는다).
            dispensing: {
              select: {
                id: true,
                status: true,
                careType: true,
                dispensedAt: true,
                secondCheckAt: true,
                verifiedAt: true,
                issuedAt: true,
                issuedTo: true,
              },
            },
          },
        },
        encounter: {
          select: {
            createdAt: true,
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(opts?.limit ? { take: opts.limit } : {}),
    });
    return rows.map((r) => this.withDosing(r));
  }

  async findActiveByPatient(patientId: string) {
    const rows = await this.prisma.prescription.findMany({
      where: { status: 'ACTIVE', encounter: { patientId } },
      include: {
        medicationCode: true,
        procedureCode: true,
        encounter: {
          select: {
            createdAt: true,
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.withDosing(r));
  }

  /**
   * 🔴 `status='ACTIVE'` 는 "지금 복용 중"이 **아니다.**
   *
   * `PrescriptionStatus` 에는 {ACTIVE, CANCELLED} 두 값뿐이고, 처방을 완료로 바꾸는
   * 코드 경로가 전역에 **0건**이다. 그래서 운영 활성 594건 중 **306건(51.5%)이
   * 이미 투여기간이 끝난 약**인데도 "현재 복용 중"으로 AI 상호작용 검사·간호 사이드레일·
   * 무균조제 대상에 흘렀다.
   *
   * 원장에 이미 있는 사실(`createdAt` + `duration` 일)로 **투여기간을 함께 돌려준다.**
   * 판정 정본은 shared `dosingWindow` 하나다(FE 가 각자 계산하면 갈라진다).
   * `duration` 미기재 186건은 `UNKNOWN` 이다 — '복용 중'도 '종료'도 아니다.
   */
  private withDosing<T extends { createdAt: Date; duration: number | null; discontinuedAt?: Date | null }>(row: T) {
    // 중단 시각이 있으면 기간보다 먼저다(2026-09-30) — 중단된 약을 '투여 중'으로 말하지 않는다
    return { ...row, dosing: dosingWindow({ createdAt: row.createdAt, duration: row.duration, discontinuedAt: row.discontinuedAt ?? null }) };
  }

  /** 알 수 없는 status 는 조용히 무시하지 않는다 — 무시하면 화면이 걸러진 줄 안다. */
  private normalizePrescriptionStatus(raw?: string): PrescriptionStatus | undefined {
    if (raw == null || String(raw).trim() === '') return undefined;
    const v = String(raw).trim().toUpperCase();
    if (v === 'ACTIVE' || v === 'CANCELLED' || v === 'DISCONTINUED') return v as PrescriptionStatus;
    throw new BadRequestException(`처방 상태 필터는 ACTIVE|CANCELLED|DISCONTINUED 만 지원합니다 (받은 값: ${v})`);
  }

  // DUR 경고 무시(오버라이드) — 사유·비고를 감사기록으로 영속(규제)
  async overrideDur(id: string, body: { reason?: string; note?: string }, actorId: string) {
    const rx = await this.prisma.prescription.findUnique({ where: { id }, select: { id: true } });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (!body?.reason) throw new BadRequestException({ code: 'DUR_OVERRIDE_REASON_REQUIRED', message: 'DUR 무시 사유는 필수입니다.' });
    return this.prisma.prescription.update({
      where: { id },
      data: {
        durOverridden: true,
        durOverrideReason: body.note ? `${body.reason} — ${body.note}` : body.reason,
        durOverrideBy: actorId,
        durOverrideAt: new Date(),
      },
      select: { id: true, durOverridden: true, durOverrideReason: true, durOverrideBy: true, durOverrideAt: true },
    });
  }

  /** 취소·중단 권한 — 규칙 활성 시 책임 처방의 / 담당 의료군 / ADMIN 만(타인 임의 취소·중단 차단) */
  private async assertCanStop(
    prescription: { prescriberId: string | null; createdBy: string; encounter: { id: string; admissionId: string | null; doctor: { id: string } | null } },
    actorId: string | undefined,
    code: 'CANCEL_NOT_ALLOWED' | 'DISCONTINUE_NOT_ALLOWED',
  ) {
    if (!actorId) return;
    const rules = await this.getPrescriberRules();
    if (!rules.enabled) return;
    const responsible = prescription.prescriberId ?? prescription.createdBy;
    let allowed = actorId === responsible;
    if (!allowed && prescription.encounter.admissionId) {
      const group = await this.careGroupDoctorIds({ id: prescription.encounter.id, admissionId: prescription.encounter.admissionId, doctorId: prescription.encounter.doctor?.id });
      allowed = group.includes(actorId);
    }
    if (!allowed) {
      const me = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (me?.role === 'ADMIN') allowed = true;
    }
    if (!allowed) {
      throw new ForbiddenException({
        code,
        message: code === 'CANCEL_NOT_ALLOWED'
          ? '책임 처방의 또는 담당 의료군만 처방을 취소할 수 있습니다.'
          : '책임 처방의 또는 담당 의료군만 처방을 중단할 수 있습니다.',
      });
    }
  }

  /**
   * 처방이 **발효됐는가**(이미 일어난 사실이 있는가) — 취소(무효)와 중단(그 시각 이후 멈춤)을 가르는 기준.
   * 투약 기록(시행·보류·거부·누락 — 간호사가 판단을 남긴 것) 또는 접수 이후로 넘어간 오더(조제·검사 시행)가 있으면 발효.
   * 예정 투약(SCHEDULED)·접수 전 오더(ORDERED)는 아직 일어나지 않은 일이라 세지 않는다.
   */
  async effectEvidence(id: string) {
    const [documentedMar, startedOrders] = await Promise.all([
      this.prisma.medicationAdministration.count({ where: { prescriptionId: id, status: { in: ['ADMINISTERED', 'HELD', 'REFUSED', 'MISSED'] } } }),
      this.prisma.order.count({ where: { prescriptionId: id, status: { in: ['RECEIVED', 'IN_PROGRESS', 'COMPLETED'] } } }),
    ]);
    return { documentedMar, startedOrders, tookEffect: documentedMar + startedOrders > 0 };
  }

  async cancel(id: string, actorId?: string) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: { encounter: { select: { id: true, admissionId: true, doctor: { select: { id: true } } } } },
    });
    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.status === 'CANCELLED') return prescription; // 멱등(재취소 무해)
    // 🔴 중단된 처방을 취소로 바꾸면 '이미 일어난 투약'이 무효처럼 된다 — 소급하지 않는다
    if (prescription.status === 'DISCONTINUED') {
      throw new ConflictException({ code: 'PRESCRIPTION_DISCONTINUED', message: 'Discontinued prescription cannot be cancelled' });
    }

    await this.assertCanStop(prescription, actorId, 'CANCEL_NOT_ALLOWED');

    // 🔴 (2026-09-30) 발효된 처방은 취소(무효)하지 않는다 — 종전엔 투약 중인 약을 멈추는 것도 취소라
    //    처방 원장이 "처음부터 무효"로 남았다(일어난 사실은 소급하지 않는다). 중단(discontinue)을 쓰게 말한다.
    const evidence = await this.effectEvidence(id);
    if (evidence.tookEffect) {
      throw new ConflictException({
        code: 'PRESCRIPTION_TOOK_EFFECT',
        message: 'Prescription already took effect — discontinue it instead of cancelling',
        details: { documentedMar: evidence.documentedMar, startedOrders: evidence.startedOrders, use: 'DISCONTINUE' },
      });
    }

    // 처방 취소 시 연결된 미시행 오더(검사/영상/조제)도 함께 취소 — 취소된 처방이 워크스테이션 큐/PACS에서 시행되는 유령 오더 방지.
    // 이미 진행/완료된 오더(RECEIVED/IN_PROGRESS/COMPLETED)는 보존.
    const cancelledAt = new Date();
    const { updated, cancelledOrderIds, cancelledMarCount } = await this.prisma.$transaction(async (tx) => {
      const p = await tx.prescription.update({ where: { id }, data: { status: 'CANCELLED' } });
      // 취소 대상 오더 id 캡처(이벤트 역전용) 후 일괄 취소
      const targets = await tx.order.findMany({ where: { prescriptionId: id, status: 'ORDERED' }, select: { id: true } });
      // 취소 스탬프 동봉 — 시각·행위자가 없으면 서명 로그를 사후에 복원할 수 없다.
      await tx.order.updateMany({
        where: { prescriptionId: id, status: 'ORDERED' },
        data: { status: 'CANCELLED', cancelledAt, cancelledById: actorId ?? null },
      });
      // MAR desync 방지: 취소된 (투약) 처방의 미시행 예정투약(SCHEDULED) 제거 — 취소약이 간호 MAR에 남아
      //  투약되는 안전사고 방지. 이미 시행/보류/거부(ADMINISTERED/HELD/REFUSED/MISSED)는 감사 위해 보존.
      const removed = await tx.medicationAdministration.deleteMany({ where: { prescriptionId: id, status: 'SCHEDULED' } });
      return { updated: p, cancelledOrderIds: targets.map((o) => o.id), cancelledMarCount: removed.count };
    });

    // 오더 취소 이벤트 — accrual 역전 리스너(order.cancelled)가 발생분 정산 취소 처리(멱등). PACS/materials 역전 hook도 동일 이벤트 소비.
    if (cancelledOrderIds.length > 0) {
      this.eventEmitter.emit('order.cancelled', {
        prescriptionId: id,
        orderIds: cancelledOrderIds,
        reason: 'PRESCRIPTION_CANCELLED',
      });
      // sign 서명 로그 — 취소는 다툼이 생기는 지점이라 TSA 시점봉인까지 건다(서비스가 판단).
      for (const orderId of cancelledOrderIds) {
        await this.orderSignLog?.recordTransition({
          orderId, from: 'ORDERED', to: 'CANCELLED', actorId: actorId ?? null, occurredAt: cancelledAt,
        });
      }
    }
    if (actorId) {
      await this.audit.safeLog({
        userId: actorId, action: AuditAction.UPDATE, resourceType: 'PRESCRIPTION', resourceId: id,
        changes: { status: { old: prescription.status, new: 'CANCELLED' }, responsiblePrescriber: { old: prescription.prescriberId ?? prescription.createdBy, new: null }, cancelledScheduledMar: { old: cancelledMarCount, new: 0 } },
      });
    }
    return updated;
  }

  /**
   * 처방 **중단** — 지금 이후를 멈춘다. 이미 조제·투약된 사실은 그대로 유효(청구·기록 보존).
   *
   *  - 상태 DISCONTINUED + 중단 시각·행위자·사유(사유는 비면 안 된다 — DTO·여기서 다시 확인)
   *  - 아직 접수 전(ORDERED) 오더는 취소(시행되지 않게) — 시작된 오더는 그대로(약국·검사실이 중단 표식을 본다)
   *  - 예정 투약(SCHEDULED) 중 **중단 시각 이후**만 지운다. 🔴 이미 시각이 지났는데 기록되지 않은 투약은 남긴다 —
   *    지우면 "줬는지·빠뜨렸는지"를 간호사가 기록할 자리가 사라진다(취소는 종전대로 전부 지운다: 발효 전이라 없다)
   *  - 멱등: 이미 중단이면 그대로 돌려준다(먼저 남은 사유·시각을 덮지 않는다) · 취소된 처방은 중단할 수 없다
   */
  async discontinue(id: string, actorId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException({ code: 'DISCONTINUE_REASON_REQUIRED', message: 'Discontinue reason is required' });
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: { encounter: { select: { id: true, admissionId: true, doctor: { select: { id: true } } } } },
    });
    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.status === 'DISCONTINUED') return { prescription, alreadyDiscontinued: true, cancelledOrders: 0, removedFutureMar: 0 };
    if (prescription.status === 'CANCELLED') {
      throw new ConflictException({ code: 'PRESCRIPTION_CANCELLED', message: 'Cancelled prescription cannot be discontinued' });
    }
    await this.assertCanStop(prescription, actorId, 'DISCONTINUE_NOT_ALLOWED');

    const at = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 조건부 갱신 — 동시 중단·취소와 겹치면 먼저 난 것을 덮지 않는다
      const r = await tx.prescription.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'DISCONTINUED', discontinuedAt: at, discontinuedBy: actorId, discontinueReason: trimmed },
      });
      if (r.count === 0) return null;
      const targets = await tx.order.findMany({ where: { prescriptionId: id, status: 'ORDERED' }, select: { id: true } });
      await tx.order.updateMany({
        where: { prescriptionId: id, status: 'ORDERED' },
        data: { status: 'CANCELLED', cancelledAt: at, cancelledById: actorId },
      });
      const removed = await tx.medicationAdministration.deleteMany({
        where: { prescriptionId: id, status: 'SCHEDULED', scheduledAt: { gte: at } },
      });
      return { cancelledOrderIds: targets.map((o) => o.id), removedFutureMar: removed.count };
    });
    const now = await this.prisma.prescription.findUnique({ where: { id } });
    if (!result) {
      // 사이에 다른 요청이 상태를 바꿨다 — 지금 원장을 그대로 말한다
      if (now?.status === 'DISCONTINUED') return { prescription: now, alreadyDiscontinued: true, cancelledOrders: 0, removedFutureMar: 0 };
      throw new ConflictException({ code: 'PRESCRIPTION_STATE_CHANGED', message: 'Prescription state changed concurrently' });
    }

    if (result.cancelledOrderIds.length > 0) {
      this.eventEmitter.emit('order.cancelled', { prescriptionId: id, orderIds: result.cancelledOrderIds, reason: 'PRESCRIPTION_DISCONTINUED' });
      for (const orderId of result.cancelledOrderIds) {
        await this.orderSignLog?.recordTransition({ orderId, from: 'ORDERED', to: 'CANCELLED', actorId, occurredAt: at });
      }
    }
    await this.audit.safeLog({
      userId: actorId, action: AuditAction.UPDATE, resourceType: 'PRESCRIPTION', resourceId: id,
      changes: {
        status: { old: prescription.status, new: 'DISCONTINUED' },
        discontinueReason: { old: null, new: trimmed },
        cancelledOrders: { old: 0, new: result.cancelledOrderIds.length },
        removedFutureMar: { old: 0, new: result.removedFutureMar },
      },
    });
    return { prescription: now, alreadyDiscontinued: false, cancelledOrders: result.cancelledOrderIds.length, removedFutureMar: result.removedFutureMar };
  }

  /**
   * 수동 DUR 점검 (처방 전 미리보기)
   */
  async checkDur(encounterId: string, medicationCodeId: string) {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException('Encounter not found');

    const warnings = await this.durService.checkInteractions(
      encounterId,
      medicationCodeId,
      encounter.patientId,
    );

    return { durWarnings: warnings, safe: warnings.length === 0 };
  }

  /** 이전 처방 복사 */
  async copyFromEncounter(targetEncounterId: string, sourceEncounterId: string, userId: string, prescriptionIds?: string[], override?: { overrideDur?: boolean; overrideReason?: string }) {
    const target = await this.prisma.encounter.findUnique({ where: { id: targetEncounterId } });
    if (!target) throw new NotFoundException('대상 진료기록을 찾을 수 없습니다.');
    await this.assertEncounterPrescribable(target);

    const where: Prisma.PrescriptionWhereInput = { encounterId: sourceEncounterId, status: 'ACTIVE' };
    if (prescriptionIds?.length) where.id = { in: prescriptionIds };

    const sources = await this.prisma.prescription.findMany({ where });
    if (sources.length === 0) throw new NotFoundException('복사할 처방이 없습니다.');

    // 원내 처방집 게이트 — 복사도 '새 발행'이다(W8-R2 F1). 승인 취소·중지된 코드가 복사로 되살아나는 경로 차단.
    for (const src of sources) {
      await this.assertFormularyForOrder(
        { type: src.type, medicationCodeId: src.medicationCodeId, procedureCodeId: src.procedureCodeId },
        { encounterId: targetEncounterId, path: 'COPY' },
      );
    }

    // 사전승인 게이트 — 복사 대상에 마약류/고가검사 포함 시 발행 전 결재(F1 우회 차단). 복사는 preAuthRef 없음 → 미승인 마약류는 BLOCK 시 차단.
    const postFactoBySrc = new Map<string, string>();
    for (const src of sources) {
      const g = await this.assertPreAuthForOrder({ type: src.type, medicationCodeId: src.medicationCodeId, procedureCodeId: src.procedureCodeId, priority: src.priority }, target.patientId, targetEncounterId, userId);
      if (g.postFactoId) postFactoBySrc.set(src.id, g.postFactoId);
    }

    // DUR 재점검+강제게이트(tx 밖) — 대상 환자 기준 재평가. 종전에는 복사 경로가 DUR 없이 생성돼 게이트 우회 구멍이었음.
    const durBysrc = new Map<string, DurWarning[]>();
    for (const src of sources) {
      if (src.type !== 'MEDICATION' || !src.medicationCodeId) continue;
      const warnings = await this.durService.checkInteractions(targetEncounterId, src.medicationCodeId, target.patientId, { dosage: src.dosage ?? undefined, frequency: src.frequency ?? undefined });
      durBysrc.set(src.id, warnings);
      await this.applyDurGate(warnings, { encounterId: targetEncounterId, path: 'COPY', override: { flag: override?.overrideDur, reason: override?.overrideReason } });
    }

    const createdOrders: { orderId: string; type: string; procedureCodeId?: string | null; priority?: string | null }[] = [];
    const created = await this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const src of sources) {
        const durWarnings = durBysrc.get(src.id) ?? [];
        const rx = await tx.prescription.create({
          data: {
            encounterId: targetEncounterId,
            type: src.type,
            medicationCodeId: src.medicationCodeId,
            procedureCodeId: src.procedureCodeId,
            dosage: src.dosage,
            frequency: src.frequency,
            duration: src.duration,
            quantity: src.quantity,
            route: src.route,
            instructions: src.instructions,
            priority: src.priority ?? 'ROUTINE',
            source: 'COPY',
            durChecked: src.type === 'MEDICATION',
            durWarnings: durWarnings.length > 0 ? (durWarnings as any) : undefined,
            durOverridden: (override?.overrideDur && durWarnings.some((w) => w.severity === 'ERROR')) || false,
            durOverrideReason: override?.overrideDur ? override?.overrideReason ?? null : null,
            durOverrideBy: override?.overrideDur ? userId : null,
            durOverrideAt: override?.overrideDur ? new Date() : null,
            createdBy: userId,
            prescriberId: userId, // 복사: 복사 의사가 책임 처방의(책임 누락 방지)
          },
          include: {
            medicationCode: { select: { code: true, nameKo: true } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        });
        const newOrder = await tx.order.create({
          data: buildOrderData({ prescriptionId: rx.id, type: src.type, priority: src.priority }),
        });
        createdOrders.push({ orderId: newOrder.id, type: src.type, procedureCodeId: src.procedureCodeId, priority: src.priority });
        results.push(rx);
      }
      return results;
    });

    // 커밋 후 표준 발행 — 영상오더 PACS worklist 등 후속 소비(기존 미발행 결함 해소)
    for (const co of createdOrders) {
      emitOrderCreated(this.eventEmitter, { ...co, patientId: target.patientId, encounterId: targetEncounterId });
    }
    // 사후승인 링크 — created는 sources 순서 정렬(반려 시 자동취소 대상 연결)
    sources.forEach((src, i) => { void this.preAuthGate.linkPostFacto?.(postFactoBySrc.get(src.id), created[i]?.id); });
    return { data: created, count: created.length };
  }

  /** 처방 복사 (Encounter 간, 타입 필터 + DUR 재점검) */
  async copyPrescriptions(
    sourceEncounterId: string,
    targetEncounterId: string,
    userId: string,
    types?: string[],
    override?: { overrideDur?: boolean; overrideReason?: string },
  ) {
    const target = await this.prisma.encounter.findUnique({ where: { id: targetEncounterId } });
    if (!target) throw new NotFoundException('대상 진료기록을 찾을 수 없습니다.');
    await this.assertEncounterPrescribable(target);

    const source = await this.prisma.encounter.findUnique({ where: { id: sourceEncounterId } });
    if (!source) throw new NotFoundException('원본 진료기록을 찾을 수 없습니다.');

    const where: Prisma.PrescriptionWhereInput = { encounterId: sourceEncounterId, status: 'ACTIVE' };
    if (types?.length) where.type = { in: types as PrescriptionType[] };

    const sources = await this.prisma.prescription.findMany({ where });
    if (sources.length === 0) throw new NotFoundException('복사할 처방이 없습니다.');

    // 원내 처방집 게이트 — 복사도 '새 발행'이다(W8-R2 F1)
    for (const src of sources) {
      await this.assertFormularyForOrder(
        { type: src.type, medicationCodeId: src.medicationCodeId, procedureCodeId: src.procedureCodeId },
        { encounterId: targetEncounterId, path: 'COPY' },
      );
    }

    // 사전승인 게이트 — 복사 대상 마약류/고가검사 발행 전 결재(F1 우회 차단)
    const postFactoBySrc = new Map<string, string>();
    for (const src of sources) {
      const g = await this.assertPreAuthForOrder({ type: src.type, medicationCodeId: src.medicationCodeId, procedureCodeId: src.procedureCodeId, priority: src.priority }, target.patientId, targetEncounterId, userId);
      if (g.postFactoId) postFactoBySrc.set(src.id, g.postFactoId);
    }

    // DUR 재점검+강제게이트(tx 밖) — 종전에는 ERROR도 경고 저장만 하고 통과하던 게이트 우회 경로였음
    const durBySrc = new Map<string, DurWarning[]>();
    for (const src of sources) {
      if (src.type !== 'MEDICATION' || !src.medicationCodeId) continue;
      const warnings = await this.durService.checkInteractions(targetEncounterId, src.medicationCodeId, target.patientId, { dosage: src.dosage ?? undefined, frequency: src.frequency ?? undefined });
      durBySrc.set(src.id, warnings);
      await this.applyDurGate(warnings, { encounterId: targetEncounterId, path: 'COPY', override: { flag: override?.overrideDur, reason: override?.overrideReason } });
    }

    const createdOrders: { orderId: string; type: string; procedureCodeId?: string | null; priority?: string | null }[] = [];
    const created = await this.prisma.$transaction(async (tx) => {
      const results: Array<{ prescription: any; durWarnings: any[] }> = [];

      for (const src of sources) {
        const durWarnings = durBySrc.get(src.id) ?? [];

        const rx = await tx.prescription.create({
          data: {
            encounterId: targetEncounterId,
            type: src.type,
            medicationCodeId: src.medicationCodeId,
            procedureCodeId: src.procedureCodeId,
            dosage: src.dosage,
            frequency: src.frequency,
            duration: src.duration,
            quantity: src.quantity,
            route: src.route,
            instructions: src.instructions,
            priority: src.priority ?? 'ROUTINE',
            source: 'COPY',
            durChecked: src.type === 'MEDICATION',
            durWarnings: durWarnings.length > 0 ? durWarnings as any : undefined,
            durOverridden: (override?.overrideDur && durWarnings.some((w) => w.severity === 'ERROR')) || false,
            durOverrideReason: override?.overrideDur ? override?.overrideReason ?? null : null,
            durOverrideBy: override?.overrideDur ? userId : null,
            durOverrideAt: override?.overrideDur ? new Date() : null,
            createdBy: userId,
            prescriberId: userId, // 복사: 복사 의사가 책임 처방의
          },
          include: {
            medicationCode: { select: { code: true, nameKo: true } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        });

        const newOrder = await tx.order.create({
          data: buildOrderData({ prescriptionId: rx.id, type: src.type, priority: src.priority }),
        });
        createdOrders.push({ orderId: newOrder.id, type: src.type, procedureCodeId: src.procedureCodeId, priority: src.priority });

        results.push({ prescription: rx, durWarnings });
      }
      return results;
    });

    // 커밋 후 표준 발행 — 영상오더 PACS worklist 등 후속 소비(기존 미발행 결함 해소)
    for (const co of createdOrders) {
      emitOrderCreated(this.eventEmitter, { ...co, patientId: target.patientId, encounterId: targetEncounterId });
    }
    // 사후승인 링크 — created는 sources 순서 정렬(반려 시 자동취소 대상 연결)
    sources.forEach((src, i) => { void this.preAuthGate.linkPostFacto?.(postFactoBySrc.get(src.id), created[i]?.prescription?.id); });
    return { prescriptions: created, count: created.length };
  }

  /** 개별 처방 반복 (동일 Encounter에 새 처방으로 복제) */
  async repeatPrescription(prescriptionId: string, userId: string, override?: { overrideDur?: boolean; overrideReason?: string }) {
    const original = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { encounter: true },
    });
    if (!original) throw new NotFoundException('처방을 찾을 수 없습니다.');
    await this.assertEncounterPrescribable(original.encounter);

    // DUR 재점검+강제게이트 (약 처방인 경우) — 종전에는 ERROR도 경고 저장만 하고 통과하던 게이트 우회 경로였음
    let durWarnings: DurWarning[] = [];
    if (original.type === 'MEDICATION' && original.medicationCodeId) {
      durWarnings = await this.durService.checkInteractions(
        original.encounterId,
        original.medicationCodeId,
        original.encounter.patientId,
        { dosage: original.dosage ?? undefined, frequency: original.frequency ?? undefined },
      );
      await this.applyDurGate(durWarnings, { encounterId: original.encounterId, path: 'REPEAT', override: { flag: override?.overrideDur, reason: override?.overrideReason } });
    }

    // 원내 처방집 게이트 — 재처방도 '새 발행'이다(W8-R2 F1). 중지 이후의 반복 갱신을 그대로 통과시키지 않는다.
    await this.assertFormularyForOrder(
      { type: original.type, medicationCodeId: original.medicationCodeId, procedureCodeId: original.procedureCodeId },
      { encounterId: original.encounterId, path: 'REPEAT' },
    );

    // 사전승인 게이트 — 재처방(갱신) 대상 마약류/고가검사 발행 전 결재(F1 우회 차단·마약류 재처방 남용 벡터)
    const preAuthGateResult = await this.assertPreAuthForOrder(
      { type: original.type, medicationCodeId: original.medicationCodeId, procedureCodeId: original.procedureCodeId, priority: original.priority },
      original.encounter.patientId, original.encounterId, userId,
    );

    const createdOrders: { orderId: string; type: string; procedureCodeId?: string | null; priority?: string | null }[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.create({
        data: {
          encounterId: original.encounterId,
          type: original.type,
          medicationCodeId: original.medicationCodeId,
          procedureCodeId: original.procedureCodeId,
          dosage: original.dosage,
          frequency: original.frequency,
          duration: original.duration,
          quantity: original.quantity,
          route: original.route,
          instructions: original.instructions,
          priority: original.priority ?? 'ROUTINE',
          source: 'COPY',
          durChecked: original.type === 'MEDICATION',
          durWarnings: durWarnings.length > 0 ? durWarnings as any : undefined,
          durOverridden: (override?.overrideDur && durWarnings.some((w) => w.severity === 'ERROR')) || false,
          durOverrideReason: override?.overrideDur ? override?.overrideReason ?? null : null,
          durOverrideBy: override?.overrideDur ? userId : null,
          durOverrideAt: override?.overrideDur ? new Date() : null,
          createdBy: userId,
          prescriberId: original.prescriberId ?? userId, // 반복: 원본 책임 처방의 승계(없으면 본인)
        },
        include: {
          medicationCode: { select: { code: true, nameKo: true } },
          procedureCode: { select: { code: true, nameKo: true } },
        },
      });

      const newOrder = await tx.order.create({
        data: buildOrderData({ prescriptionId: rx.id, type: original.type, priority: original.priority }),
      });
      createdOrders.push({ orderId: newOrder.id, type: original.type, procedureCodeId: original.procedureCodeId, priority: original.priority });

      return rx;
    });

    // 커밋 후 표준 발행 — 영상오더 PACS worklist 등 후속 소비(기존 미발행 결함 해소)
    for (const co of createdOrders) {
      emitOrderCreated(this.eventEmitter, { ...co, patientId: original.encounter.patientId, encounterId: original.encounterId });
    }
    // 사후승인 링크 — 반려 시 자동취소 대상 연결
    void this.preAuthGate.linkPostFacto?.(preAuthGateResult.postFactoId, result.id);
    return { prescription: result, durWarnings };
  }

  // ── 퇴원약 오더화(2026-09-30) ──────────────────────────────────────────────────
  /**
   * 입원의 퇴원약 처방 목록 + 옮겨 올 수 있는 입원 중 활성 약.
   * 🔴 종전 퇴원약은 퇴원요약의 자유 Json 뿐이었다 — DUR·처방집·조제 오더를 지나지 않았고, 퇴원 준비는
   *    "목록이 비어 있지 않다"로만 셌다. 퇴원약은 처방 원장에 `dischargeMed=true` 로 남는다.
   */
  async listDischargePrescriptions(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, status: true, patientId: true } });
    if (!admission) throw new NotFoundException('Admission not found');
    const encounter = await this.prisma.encounter.findFirst({ where: { admissionId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const select = {
      id: true, status: true, dosage: true, frequency: true, duration: true, quantity: true, route: true, instructions: true,
      dispensingType: true, createdAt: true, prescriberId: true, createdBy: true, discontinuedAt: true, discontinueReason: true,
      medicationCode: { select: { id: true, code: true, nameKo: true, nameEn: true } },
      orders: { select: { id: true, status: true, updatedAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
    } as const;
    const [discharge, inpatient] = await Promise.all([
      this.prisma.prescription.findMany({
        where: { type: 'MEDICATION', dischargeMed: true, encounter: { admissionId } },
        orderBy: { createdAt: 'asc' },
        select: select,
      }),
      this.prisma.prescription.findMany({
        where: { type: 'MEDICATION', dischargeMed: false, status: 'ACTIVE', encounter: { admissionId } },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: select,
      }),
    ]);
    return {
      admissionId,
      admissionStatus: admission.status,
      // 퇴원약을 붙일 진료 — 입원의 가장 최근 진료(오더 화면의 정본 findOrderEncounter 와 같은 규칙)
      encounterId: encounter?.id ?? null,
      items: discharge,
      inpatientActive: inpatient,
      inpatientTruncated: inpatient.length >= 200,
    };
  }

  /**
   * 퇴원약 처방 — 발행 정본(create)을 그대로 지난다(DUR·원내 처방집·사전승인·처방의 규칙·약국 오더·마약류 원장).
   *  · 입원 중(ADMITTED)일 때만 · 약 처방만 · 일수·총량은 의사가 정한다(비면 400 — 입원 약 값을 복사하지 않는다)
   *  · DUR 은 이 입원의 **입원 중 약**을 비교에서 뺀다(퇴원과 함께 끝나는 약 — 퇴원약끼리·다른 복용약과만 본다)
   *  · 🔴 입원 약을 자동으로 끊지 않는다(퇴원 시 자동 중단은 사람 결정 `discharge.stopInpatientMedsOnDischarge`)
   */
  async createDischargePrescription(admissionId: string, dto: CreatePrescriptionDto, userId: string, extra?: { prescriberId?: string; prescriberStepUpToken?: string }) {
    if (dto.type !== 'MEDICATION' || !dto.medicationCodeId) {
      throw new BadRequestException({ code: 'DISCHARGE_MEDICATION_ONLY', message: 'Discharge prescriptions must be medications' });
    }
    if (!Number.isInteger(Number(dto.duration)) || Number(dto.duration) < 1) {
      throw new BadRequestException({ code: 'DISCHARGE_DAYS_REQUIRED', message: 'Discharge prescription days must be a positive integer' });
    }
    if (!Number.isInteger(Number(dto.quantity)) || Number(dto.quantity) < 1) {
      throw new BadRequestException({ code: 'DISCHARGE_QUANTITY_REQUIRED', message: 'Discharge prescription quantity must be a positive integer' });
    }
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, status: true } });
    if (!admission) throw new NotFoundException('Admission not found');
    if (admission.status !== 'ADMITTED') {
      throw new ConflictException({ code: 'ADMISSION_NOT_ACTIVE', message: 'Discharge prescriptions can only be written for an active admission' });
    }
    const encounter = await this.prisma.encounter.findFirst({ where: { admissionId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!encounter) {
      throw new ConflictException({ code: 'NO_ADMISSION_ENCOUNTER', message: 'This admission has no encounter to attach the prescription to' });
    }
    const inpatient = await this.prisma.prescription.findMany({
      where: { type: 'MEDICATION', dischargeMed: false, status: 'ACTIVE', encounter: { admissionId } },
      select: { id: true },
    });
    return this.create(encounter.id, { ...dto, source: 'DISCHARGE' }, userId, undefined, {
      prescriberId: extra?.prescriberId,
      prescriberStepUpToken: extra?.prescriberStepUpToken,
      dischargeMed: true,
      durExcludePrescriptionIds: inpatient.map((r) => r.id),
    });
  }

  // ── 지속 처방 갱신·만료(2026-09-30) ─────────────────────────────────────────────
  /**
   * 갱신 대기 목록 — **내**(정본 my-orders-scope) 입원 중 환자의 활성 약 처방 가운데
   *  · 곧 만료(투여 종료 예정이 `order.renewal.soonHours` 안) · 만료됨(기간이 끝났는데 아직 활성) · 기간 없음(PRN·지속 지시)
   * 🔴 만료됐다고 **자동으로 끊지 않는다**(자동 중단은 사람 결정 `order.renewal.autoExpire`) — 의사가 갱신하거나 중단한다.
   * 기간 없는 처방의 재검토 기한이 미설정이면 기한 없이 전부 올리고 그 사실을 응답에 싣는다(기본값을 정책인 척하지 않는다).
   */
  async renewalsDue(userId: string, now: Date = new Date()) {
    const soonRaw = await this.config.get('order.renewal.soonHours');
    const soonHours = typeof soonRaw === 'number' && soonRaw > 0 ? soonRaw : Number(soonRaw) > 0 ? Number(soonRaw) : 24;
    const reviewRaw = await this.config.get('order.renewal.noEndReviewDays');
    const noEndReviewDays = reviewRaw == null || reviewRaw === '' ? null : Number(reviewRaw) > 0 ? Number(reviewRaw) : null;
    const CAP = 500;
    const where: Prisma.PrescriptionWhereInput = {
      type: 'MEDICATION',
      status: 'ACTIVE',
      // 퇴원약은 입원 중 지속 투약이 아니다 — 갱신 대기에 올리지 않는다(2026-09-30)
      dischargeMed: false,
      encounter: { admission: { status: 'ADMITTED' } },
      AND: [myOrdersPrescriptionWhere(userId)],
    };
    const [rows, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: CAP,
        select: {
          id: true, createdAt: true, duration: true, quantity: true, dosage: true, frequency: true, route: true, priority: true, instructions: true,
          discontinuedAt: true, renewedFromId: true,
          medicationCode: { select: { nameKo: true, code: true } },
          encounter: { select: { id: true, patient: { select: { id: true, mrn: true, familyName: true, givenName: true } }, admission: { select: { id: true } } } },
        },
      }),
      this.prisma.prescription.count({ where }),
    ]);
    const soonMs = soonHours * 3_600_000;
    const reviewMs = noEndReviewDays != null ? noEndReviewDays * 86_400_000 : null;
    const items = rows.flatMap((r) => {
      const dosing = dosingWindow({ createdAt: r.createdAt, duration: r.duration, discontinuedAt: r.discontinuedAt }, now);
      let bucket: 'EXPIRED' | 'ENDING_SOON' | 'NO_END' | null = null;
      if (dosing.state === 'ENDED') bucket = 'EXPIRED';
      else if (dosing.state === 'DOSING' && dosing.endsAt && new Date(dosing.endsAt).getTime() - now.getTime() <= soonMs) bucket = 'ENDING_SOON';
      else if (dosing.state === 'UNKNOWN' && (reviewMs == null || now.getTime() - r.createdAt.getTime() >= reviewMs)) bucket = 'NO_END';
      return bucket ? [{ ...r, dosing, bucket }] : [];
    });
    const counts = { EXPIRED: 0, ENDING_SOON: 0, NO_END: 0 } as Record<'EXPIRED' | 'ENDING_SOON' | 'NO_END', number>;
    for (const i of items) counts[i.bucket] += 1;
    return { items, counts, soonHours, noEndReviewDays, scanned: rows.length, totalActive: total, truncated: total > rows.length };
  }

  /**
   * 처방 갱신 — **새 처방으로 잇고 원처방은 같은 순간 중단**한다.
   *  · 새 처방은 발행 정본을 지난다(DUR — 원처방은 비교에서 제외 · 원내 처방집 · 사전승인) · 약국 오더 생성
   *  · 원처방은 사유 "갱신"으로 DISCONTINUED(접수 전 오더 취소 · 이후 예정 투약 삭제) — 겹쳐 두면 같은 약이 두 줄로 투약된다
   *  · 일수·총량은 의사가 정한다(비면 400) — 원처방 값을 그대로 복사하지 않는다(갱신은 새 결정이다)
   *  · 활성 약 처방만 · 권한은 중단과 같은 규칙(책임 처방의·담당 의료군·ADMIN) · 새 처방의 책임 처방의는 갱신한 사람
   */
  async renew(id: string, userId: string, input: { days?: number; quantity?: number; reason?: string; overrideDur?: boolean; overrideReason?: string }) {
    const days = Number(input.days);
    const quantity = Number(input.quantity);
    if (!Number.isInteger(days) || days < 1) throw new BadRequestException({ code: 'RENEW_DAYS_REQUIRED', message: 'Renewal days must be a positive integer' });
    if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException({ code: 'RENEW_QUANTITY_REQUIRED', message: 'Renewal quantity must be a positive integer' });
    const original = await this.prisma.prescription.findUnique({
      where: { id },
      include: { encounter: { select: { id: true, status: true, patientId: true, admissionId: true, doctor: { select: { id: true } } } } },
    });
    if (!original) throw new NotFoundException('Prescription not found');
    if (original.status !== 'ACTIVE') throw new ConflictException({ code: 'PRESCRIPTION_NOT_ACTIVE', message: 'Only active prescriptions can be renewed' });
    if (original.type !== 'MEDICATION') throw new BadRequestException({ code: 'RENEW_MEDICATION_ONLY', message: 'Only medication prescriptions can be renewed' });
    await this.assertCanStop(original, userId, 'DISCONTINUE_NOT_ALLOWED');
    await this.assertEncounterPrescribable(original.encounter);

    let durWarnings: DurWarning[] = [];
    if (original.medicationCodeId) {
      durWarnings = await this.durService.checkInteractions(
        original.encounterId, original.medicationCodeId, original.encounter.patientId,
        { dosage: original.dosage ?? undefined, frequency: original.frequency ?? undefined, excludePrescriptionIds: [original.id] },
      );
      // 게이트 경로 어휘는 CREATE|COPY|REPEAT — 갱신은 기존 처방의 재발행(REPEAT)으로 기록한다(어휘를 늘리지 않는다)
      await this.applyDurGate(durWarnings, { encounterId: original.encounterId, path: 'REPEAT', override: { flag: input.overrideDur, reason: input.overrideReason } });
    }
    await this.assertFormularyForOrder(
      { type: original.type, medicationCodeId: original.medicationCodeId, procedureCodeId: original.procedureCodeId },
      { encounterId: original.encounterId, path: 'REPEAT' },
    );
    const preAuth = await this.assertPreAuthForOrder(
      { type: original.type, medicationCodeId: original.medicationCodeId, procedureCodeId: original.procedureCodeId, priority: original.priority },
      original.encounter.patientId, original.encounterId, userId,
    );

    const at = new Date();
    const reasonText = (input.reason ?? '').trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const stopped = await tx.prescription.updateMany({
        where: { id, status: 'ACTIVE' },
        // 사유는 조립하지 않는다(서버 조립 문장 금지) — 메모가 있으면 그대로, 없으면 고정 문구. '갱신'이라는 사실은 새 처방의 renewedFromId 가 정본이다
        data: { status: 'DISCONTINUED', discontinuedAt: at, discontinuedBy: userId, discontinueReason: reasonText || '갱신 — 새 처방으로 이어짐' },
      });
      if (stopped.count === 0) throw new ConflictException({ code: 'PRESCRIPTION_STATE_CHANGED', message: 'Prescription state changed concurrently' });
      const cancelTargets = await tx.order.findMany({ where: { prescriptionId: id, status: 'ORDERED' }, select: { id: true } });
      await tx.order.updateMany({ where: { prescriptionId: id, status: 'ORDERED' }, data: { status: 'CANCELLED', cancelledAt: at, cancelledById: userId } });
      await tx.medicationAdministration.deleteMany({ where: { prescriptionId: id, status: 'SCHEDULED', scheduledAt: { gte: at } } });
      const rx = await tx.prescription.create({
        data: {
          encounterId: original.encounterId,
          type: original.type,
          medicationCodeId: original.medicationCodeId,
          dosage: original.dosage,
          frequency: original.frequency,
          duration: days,
          quantity,
          route: original.route,
          instructions: original.instructions,
          priority: original.priority, // 원장 값 그대로(컬럼이 NOT NULL·기본값 보유 — 코드에서 기본값을 다시 적지 않는다)
          dispensingType: original.dispensingType,
          source: 'RENEWAL',
          renewedFromId: original.id,
          durChecked: true,
          durWarnings: durWarnings.length > 0 ? (durWarnings as unknown as Prisma.InputJsonValue) : undefined,
          durOverridden: (input.overrideDur && durWarnings.some((w) => w.severity === 'ERROR')) || false,
          durOverrideReason: input.overrideDur ? input.overrideReason ?? null : null,
          durOverrideBy: input.overrideDur ? userId : null,
          durOverrideAt: input.overrideDur ? at : null,
          createdBy: userId,
          prescriberId: userId,
        },
        include: { medicationCode: { select: { code: true, nameKo: true } } },
      });
      const newOrder = await tx.order.create({ data: buildOrderData({ prescriptionId: rx.id, type: original.type, priority: original.priority }) });
      return { rx, newOrderId: newOrder.id, cancelledOrderIds: cancelTargets.map((o) => o.id) };
    });

    emitOrderCreated(this.eventEmitter, { orderId: result.newOrderId, type: original.type, procedureCodeId: null, priority: original.priority, patientId: original.encounter.patientId, encounterId: original.encounterId });
    if (result.cancelledOrderIds.length > 0) {
      this.eventEmitter.emit('order.cancelled', { prescriptionId: id, orderIds: result.cancelledOrderIds, reason: 'PRESCRIPTION_RENEWED' });
      for (const orderId of result.cancelledOrderIds) {
        await this.orderSignLog?.recordTransition({ orderId, from: 'ORDERED', to: 'CANCELLED', actorId: userId, occurredAt: at });
      }
    }
    void this.preAuthGate.linkPostFacto?.(preAuth.postFactoId, result.rx.id);
    await this.audit.safeLog({
      userId, action: AuditAction.CREATE, resourceType: 'PRESCRIPTION', resourceId: result.rx.id,
      changes: { renewedFrom: { old: null, new: id }, originalStatus: { old: 'ACTIVE', new: 'DISCONTINUED' }, days: { old: original.duration, new: days }, quantity: { old: original.quantity, new: quantity } },
    });
    return { prescription: result.rx, renewedFromId: id, durWarnings };
  }
}
