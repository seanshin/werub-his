import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SurgeryAdvancedService } from '../surgery/surgery-advanced.service';
import { NotificationService } from '../notification/notification.service';
import { JourneyService } from '../journey/journey.service';
import { evalCondition, validateCondition, CONDITION_FIELDS, ConditionCtx } from './condition-dsl';
import { ConfigRuntimeService } from '../config/config-runtime.service';

type StepDef = {
  key: string; title: string; sortOrder: number; phase: string;
  ownerRoles: string[]; actionType: string; gate: boolean; gateRule?: string;
  chartView?: string; slaMinutes?: number; transitions: { toKey: string; condition?: string }[];
};

// P0 수술 프로토콜(상태기계). 역할은 실제 UserRole(DOCTOR/NURSE) 사용(마취과·집도의=DOCTOR 직군).
const SURGERY_STEPS: StepDef[] = [
  { key: 'PREP', title: '수술 전 준비', sortOrder: 1, phase: 'ACT', ownerRoles: ['NURSE'], actionType: 'CHECK', gate: true, gateRule: 'preop_ok', chartView: 'preop', slaMinutes: 60, transitions: [{ toKey: 'SIGN_IN' }] },
  { key: 'SIGN_IN', title: '입실·신원확인 (Sign-In)', sortOrder: 2, phase: 'PROCEDURE', ownerRoles: ['NURSE', 'DOCTOR'], actionType: 'VERIFY', gate: true, gateRule: 'signin_ok', chartView: 'preop', slaMinutes: 15, transitions: [{ toKey: 'TIME_OUT' }] },
  { key: 'TIME_OUT', title: '타임아웃 (Time-Out)', sortOrder: 3, phase: 'PROCEDURE', ownerRoles: ['DOCTOR', 'NURSE'], actionType: 'VERIFY', gate: true, gateRule: 'timeout_ok', chartView: 'preop', slaMinutes: 10, transitions: [{ toKey: 'SURGERY' }] },
  { key: 'SURGERY', title: '수술 진행', sortOrder: 4, phase: 'PROCEDURE', ownerRoles: ['DOCTOR'], actionType: 'SIGN', gate: false, chartView: 'orders', transitions: [{ toKey: 'SIGN_OUT' }] },
  { key: 'SIGN_OUT', title: '종료 확인 (Sign-Out)', sortOrder: 5, phase: 'PROCEDURE', ownerRoles: ['DOCTOR', 'NURSE'], actionType: 'VERIFY', gate: true, gateRule: 'signout_ok', chartView: 'orders', slaMinutes: 10, transitions: [{ toKey: 'RECOVERY' }] },
  { key: 'RECOVERY', title: '회복 (PACU)', sortOrder: 6, phase: 'MONITOR', ownerRoles: ['NURSE'], actionType: 'CHECK', gate: false, chartView: 'vitals', slaMinutes: 120, transitions: [] },
];
const SURGERY_TPL = { code: 'SURGERY_V1', name: '수술 프로토콜', domain: 'SURGERY', version: 1 };

// 입원(IPD) 프로토콜 — 사정→계획→회진→퇴원계획→퇴원(대부분 비게이트, 입원사정만 게이트).
const IPD_STEPS: StepDef[] = [
  { key: 'ADMIT_ASSESS', title: '입원 간호 사정', sortOrder: 1, phase: 'ASSESS', ownerRoles: ['NURSE'], actionType: 'CHECK', gate: true, gateRule: 'assessment_done', chartView: 'records', slaMinutes: 120, transitions: [{ toKey: 'CARE_PLAN' }] },
  { key: 'CARE_PLAN', title: '간호 계획(NANDA-NIC-NOC)', sortOrder: 2, phase: 'PLAN', ownerRoles: ['NURSE'], actionType: 'EDUCATE', gate: false, chartView: 'records', slaMinutes: 240, transitions: [{ toKey: 'ROUNDS' }] },
  { key: 'ROUNDS', title: '회진·투약·관찰', sortOrder: 3, phase: 'ACT', ownerRoles: ['DOCTOR', 'NURSE'], actionType: 'CHECK', gate: false, chartView: 'summary', transitions: [{ toKey: 'DISCHARGE_PLAN' }] },
  { key: 'DISCHARGE_PLAN', title: '퇴원 계획', sortOrder: 4, phase: 'DISCHARGE', ownerRoles: ['DOCTOR'], actionType: 'ORDER', gate: false, chartView: 'summary', transitions: [{ toKey: 'DISCHARGED' }] },
  { key: 'DISCHARGED', title: '퇴원', sortOrder: 5, phase: 'DISCHARGE', ownerRoles: ['DOCTOR', 'NURSE'], actionType: 'SIGN', gate: false, chartView: 'summary', transitions: [] },
];
const IPD_TPL = { code: 'IPD_V1', name: '입원 프로토콜', domain: 'IPD', version: 1 };

// 외래(OPD) — 진료 작성·서명(게이트)→수납→귀가. 원무=ADMIN(별도 역할 없음).
const OPD_STEPS: StepDef[] = [
  { key: 'CONSULT', title: '진료 작성·서명', sortOrder: 1, phase: 'ACT', ownerRoles: ['DOCTOR'], actionType: 'SIGN', gate: true, gateRule: 'encounter_signed', chartView: 'summary', slaMinutes: 20, transitions: [{ toKey: 'CASHIER' }] },
  { key: 'CASHIER', title: '수납', sortOrder: 2, phase: 'DISCHARGE', ownerRoles: ['ADMIN'], actionType: 'ORDER', gate: false, chartView: 'summary', slaMinutes: 15, transitions: [{ toKey: 'DONE' }] },
  { key: 'DONE', title: '귀가·예약', sortOrder: 3, phase: 'FOLLOWUP', ownerRoles: ['ADMIN', 'DOCTOR'], actionType: 'EDUCATE', gate: false, chartView: 'summary', transitions: [] },
];
const OPD_TPL = { code: 'OPD_V1', name: '외래 프로토콜', domain: 'OPD', version: 1 };

// 응급(ER) — 도착→KTAS 트리아지(게이트)→처치→재평가→disposition.
const ER_STEPS: StepDef[] = [
  { key: 'ARRIVAL', title: '도착·접수', sortOrder: 1, phase: 'INTAKE', ownerRoles: ['NURSE', 'ADMIN'], actionType: 'MOVE', gate: false, chartView: 'summary', transitions: [{ toKey: 'TRIAGE' }] },
  { key: 'TRIAGE', title: 'KTAS 트리아지', sortOrder: 2, phase: 'ASSESS', ownerRoles: ['NURSE'], actionType: 'VERIFY', gate: true, gateRule: 'triage_done', chartView: 'vitals', slaMinutes: 10, transitions: [{ toKey: 'TREATMENT' }] },
  { key: 'TREATMENT', title: '처치', sortOrder: 3, phase: 'ACT', ownerRoles: ['DOCTOR', 'NURSE'], actionType: 'CHECK', gate: false, chartView: 'orders', transitions: [{ toKey: 'REASSESS' }] },
  { key: 'REASSESS', title: '재평가', sortOrder: 4, phase: 'MONITOR', ownerRoles: ['NURSE', 'DOCTOR'], actionType: 'CHECK', gate: false, chartView: 'vitals', transitions: [{ toKey: 'DISPOSITION' }] },
  { key: 'DISPOSITION', title: '귀가/입원 결정', sortOrder: 5, phase: 'DISCHARGE', ownerRoles: ['DOCTOR'], actionType: 'SIGN', gate: false, chartView: 'summary', transitions: [] },
];
const ER_TPL = { code: 'ER_V1', name: '응급 프로토콜', domain: 'ER', version: 1 };

type GateResult = { rule: string | null; passed: boolean; done: number; total: number; detail?: string };

// ── 편집기 카탈로그(드롭다운 선택지) ──
// gate 술어는 evaluateGate가 실제로 평가하는 명명 술어와 1:1 — 임의 문자열 금지(미지원 술어는 발행 차단).
const GATE_PREDICATES: { rule: string; label: string; domains: string[] }[] = [
  { rule: 'preop_ok', label: '수술전 체크리스트 완료(PRE_OP)', domains: ['SURGERY'] },
  { rule: 'signin_ok', label: 'Sign-In 필수항목 완료', domains: ['SURGERY'] },
  { rule: 'timeout_ok', label: 'Time-Out 필수항목 완료', domains: ['SURGERY'] },
  { rule: 'signout_ok', label: 'Sign-Out 필수항목 완료', domains: ['SURGERY'] },
  { rule: 'encounter_signed', label: '진료 서명 완료', domains: ['OPD'] },
  { rule: 'triage_done', label: 'KTAS 트리아지 완료', domains: ['ER'] },
  { rule: 'assessment_done', label: '입원 간호 사정 완료', domains: ['IPD'] },
];
const KNOWN_GATE_RULES = new Set(GATE_PREDICATES.map((p) => p.rule));
const OWNER_ROLES = ['DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST'];
const ACTION_TYPES = ['CHECK', 'ORDER', 'SIGN', 'MOVE', 'EDUCATE', 'VERIFY'];
const CHART_VIEWS = ['summary', 'preop', 'orders', 'vitals', 'records'];

// 편집기 입력 단계(검증·저장용 정규화 타입)
type EditableStep = {
  key: string; title: string; sortOrder: number; phase?: string | null;
  ownerRoles: string[]; actionType: string; gate: boolean; gateRule?: string | null;
  chartView?: string | null; slaMinutes?: number | null; transitions: { toKey: string; condition?: string }[];
};

@Injectable()
export class ProtocolService {
  private readonly logger = new Logger(ProtocolService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly journey: JourneyService,
    private readonly config: ConfigRuntimeService,
  ) {}

  // ── 템플릿 자가 시드(seed-once) ──
  // 편집기(P2b) 도입으로 DB가 SoT. code 행이 하나도 없을 때만 v1 ACTIVE를 시드하고,
  // 이미 존재하면 코드 상수로 덮어쓰지 않는다(관리 콘솔에서 발행한 버전을 보존).
  private async ensureTemplate(def: { code: string; name: string; domain: string; version: number }, steps: StepDef[]) {
    const existing = await this.prisma.protocolTemplate.findFirst({ where: { code: def.code }, select: { id: true } });
    if (!existing) {
      const tpl = await this.prisma.protocolTemplate.create({ data: { code: def.code, name: def.name, domain: def.domain, version: 1, status: 'ACTIVE', publishedAt: new Date() } });
      await this.prisma.protocolStep.createMany({
        data: steps.map((s) => ({ templateId: tpl.id, key: s.key, title: s.title, sortOrder: s.sortOrder, phase: s.phase, ownerRoles: s.ownerRoles, actionType: s.actionType, gate: s.gate, gateRule: s.gateRule ?? null, chartView: s.chartView ?? null, slaMinutes: s.slaMinutes ?? null, transitions: s.transitions })),
        skipDuplicates: true,
      });
    }
    return this.getActiveTemplate(def.code);
  }

  // 최신 ACTIVE 버전 해석(편집기 발행 시 새 버전이 ACTIVE가 되면 자동 반영)
  private async getActiveTemplate(code: string) {
    const tpl = await this.prisma.protocolTemplate.findFirst({ where: { code, status: 'ACTIVE' }, orderBy: { version: 'desc' }, include: { steps: { orderBy: { sortOrder: 'asc' } } } });
    if (!tpl) throw new NotFoundException(`활성 프로토콜 템플릿 없음: ${code}`);
    return tpl;
  }
  ensureSurgeryTemplate() { return this.ensureTemplate(SURGERY_TPL, SURGERY_STEPS); }
  ensureIpdTemplate() { return this.ensureTemplate(IPD_TPL, IPD_STEPS); }
  ensureOpdTemplate() { return this.ensureTemplate(OPD_TPL, OPD_STEPS); }
  ensureErTemplate() { return this.ensureTemplate(ER_TPL, ER_STEPS); }

  private async createInstance(tpl: { id: string; version: number; steps: { key: string }[] }, data: { patientId: string; surgeryId?: string | null; admissionId?: string | null; encounterId?: string | null; emergencyVisitId?: string | null }) {
    const inst = await this.prisma.protocolInstance.create({ data: { templateId: tpl.id, templateVersion: tpl.version, patientId: data.patientId, surgeryId: data.surgeryId ?? null, admissionId: data.admissionId ?? null, encounterId: data.encounterId ?? null, emergencyVisitId: data.emergencyVisitId ?? null, currentStepKey: tpl.steps[0]?.key ?? null } });
    await this.prisma.protocolStepState.createMany({ data: tpl.steps.map((s) => ({ instanceId: inst.id, stepKey: s.key, status: s.key === tpl.steps[0].key ? 'IN_PROGRESS' : 'PENDING' })), skipDuplicates: true });
    return inst;
  }

  // ── 수술 인스턴스 보장(스캔/생성) ──
  async ensureInstanceForSurgery(surgeryId: string) {
    const surgery = await this.prisma.surgery.findUnique({ where: { id: surgeryId }, select: { id: true, patientId: true, admissionId: true } });
    if (!surgery) throw new NotFoundException('수술을 찾을 수 없습니다');
    const tpl = await this.ensureSurgeryTemplate();
    let inst = await this.prisma.protocolInstance.findFirst({ where: { surgeryId, status: { not: 'CANCELLED' } } });
    if (!inst) inst = await this.createInstance(tpl, { patientId: surgery.patientId, surgeryId, admissionId: surgery.admissionId });
    return this.getInstanceById(inst.id);
  }

  // ── 입원(IPD) 인스턴스 보장 ──
  async ensureInstanceForAdmission(admissionId: string) {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true } });
    if (!adm) throw new NotFoundException('입원을 찾을 수 없습니다');
    const tpl = await this.ensureIpdTemplate();
    let inst = await this.prisma.protocolInstance.findFirst({ where: { admissionId, surgeryId: null, status: { not: 'CANCELLED' } } });
    if (!inst) inst = await this.createInstance(tpl, { patientId: adm.patientId, admissionId });
    return this.getInstanceById(inst.id);
  }

  // ── 외래(OPD) 인스턴스 보장 ──
  async ensureInstanceForEncounter(encounterId: string) {
    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { id: true, patientId: true, admissionId: true } });
    if (!enc) throw new NotFoundException('진료를 찾을 수 없습니다');
    const tpl = await this.ensureOpdTemplate();
    let inst = await this.prisma.protocolInstance.findFirst({ where: { encounterId, status: { not: 'CANCELLED' } } });
    if (!inst) inst = await this.createInstance(tpl, { patientId: enc.patientId, encounterId, admissionId: enc.admissionId });
    return this.getInstanceById(inst.id);
  }

  // ── 응급(ER) 인스턴스 보장 ──
  async ensureInstanceForEmergency(emergencyVisitId: string) {
    const ev = await this.prisma.emergencyVisit.findUnique({ where: { id: emergencyVisitId }, select: { id: true, patientId: true } });
    if (!ev) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    const tpl = await this.ensureErTemplate();
    let inst = await this.prisma.protocolInstance.findFirst({ where: { emergencyVisitId, status: { not: 'CANCELLED' } } });
    if (!inst) inst = await this.createInstance(tpl, { patientId: ev.patientId, emergencyVisitId });
    return this.getInstanceById(inst.id);
  }

  async getInstanceById(id: string) {
    const inst = await this.prisma.protocolInstance.findUnique({ where: { id }, include: { states: true, template: { include: { steps: { orderBy: { sortOrder: 'asc' } } } } } });
    if (!inst) throw new NotFoundException('프로토콜 인스턴스를 찾을 수 없습니다');
    return inst;
  }

  // ── 보드(인스턴스 단위, 도메인 무관) ──
  async getBoardByInstanceId(id: string) {
    const full = await this.getInstanceById(id);
    const steps = full.template.steps;
    const stateMap = new Map(full.states.map((st) => [st.stepKey, st]));
    const gates: Record<string, GateResult> = {};
    for (const s of steps) gates[s.key] = await this.evaluateGate(s.gateRule ?? null, full);
    return {
      id: full.id, domain: full.template.domain, status: full.status, currentStepKey: full.currentStepKey, patientId: full.patientId, surgeryId: full.surgeryId, admissionId: full.admissionId,
      steps: steps.map((s) => ({ key: s.key, title: s.title, phase: s.phase, ownerRoles: s.ownerRoles, gate: s.gate, gateRule: s.gateRule, chartView: s.chartView, slaMinutes: s.slaMinutes, state: stateMap.get(s.key)?.status ?? 'PENDING', gateStatus: gates[s.key] })),
    };
  }

  async getBySurgery(surgeryId: string) {
    const inst = await this.prisma.protocolInstance.findFirst({ where: { surgeryId, status: { not: 'CANCELLED' } } });
    return inst ? this.getBoardByInstanceId(inst.id) : null;
  }

  // ── P2 관리: 템플릿 뷰어(ACTIVE + 편집 중 DRAFT, RETIRED 제외) ──
  async getTemplates() {
    // 코드 정의 4종 자가 시드 보장(seed-once) 후 조회
    await Promise.all([this.ensureSurgeryTemplate(), this.ensureIpdTemplate(), this.ensureOpdTemplate(), this.ensureErTemplate()]);
    const tpls = await this.prisma.protocolTemplate.findMany({ where: { status: { in: ['ACTIVE', 'DRAFT'] } }, include: { steps: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ domain: 'asc' }, { code: 'asc' }, { version: 'desc' }] });
    return tpls.map((t) => this.serializeTemplate(t));
  }

  private serializeTemplate(t: { id: string; code: string; name: string; domain: string; version: number; status: string; description: string | null; steps: { key: string; title: string; sortOrder: number; phase: string | null; ownerRoles: string[]; actionType: string; gate: boolean; gateRule: string | null; chartView: string | null; slaMinutes: number | null; transitions: unknown }[] }) {
    return {
      id: t.id, code: t.code, name: t.name, domain: t.domain, version: t.version, status: t.status, description: t.description,
      editable: t.status === 'DRAFT',
      validation: this.validateSteps(t.steps),
      steps: t.steps.map((s) => ({ key: s.key, title: s.title, sortOrder: s.sortOrder, phase: s.phase, ownerRoles: s.ownerRoles, actionType: s.actionType, gate: s.gate, gateRule: s.gateRule, chartView: s.chartView, slaMinutes: s.slaMinutes, transitions: (s.transitions as { toKey: string; condition?: string }[] | null) ?? [] })),
    };
  }

  // ── P2 관리: 발행 검증(예측 가능성 — 막다른/비결정/누락/도달불가) ──
  private validateSteps(steps: { key: string; ownerRoles: string[]; gate: boolean; gateRule?: string | null; sortOrder: number; transitions: unknown }[]) {
    const issues: { severity: 'ERROR' | 'WARN'; step: string; message: string }[] = [];
    const keys = new Set(steps.map((s) => s.key));
    const tx = (s: { transitions: unknown }) => ((s.transitions as { toKey: string; condition?: string }[] | null) ?? []);
    let terminals = 0;
    for (const s of steps) {
      const ts = tx(s);
      if (ts.length === 0) terminals++;
      for (const t of ts) if (!keys.has(t.toKey)) issues.push({ severity: 'ERROR', step: s.key, message: `전이 대상 단계 없음: ${t.toKey}` });
      // 조건식 DSL 문법/필드 검증
      for (const t of ts) { const err = validateCondition(t.condition); if (err) issues.push({ severity: 'ERROR', step: s.key, message: err }); }
      // 비결정: 무조건 전이가 2개 이상이거나, 동일 condition 중복
      const unconditional = ts.filter((t) => !t.condition);
      if (unconditional.length > 1) issues.push({ severity: 'ERROR', step: s.key, message: '비결정 분기(무조건 전이 2개 이상)' });
      if (!s.ownerRoles?.length) issues.push({ severity: 'WARN', step: s.key, message: '담당 역할(ownerRoles) 미지정' });
      if (s.gate && !s.gateRule) issues.push({ severity: 'ERROR', step: s.key, message: '게이트 단계에 게이트 규칙(gateRule) 누락' });
      // 게이트 술어는 서버가 실제 평가하는 명명 술어여야 함(미지원 문자열은 게이트가 의도대로 동작 안 함)
      if (s.gate && s.gateRule && !KNOWN_GATE_RULES.has(s.gateRule)) issues.push({ severity: 'ERROR', step: s.key, message: `미지원 게이트 술어: ${s.gateRule}` });
    }
    if (terminals === 0) issues.push({ severity: 'ERROR', step: '*', message: '종료 단계(전이 없음)가 없음 — 무한 경로' });
    // 도달성: sortOrder 최소 단계에서 BFS
    const start = [...steps].sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (start) {
      const seen = new Set([start.key]); const q = [start.key];
      const byKey = new Map(steps.map((s) => [s.key, s]));
      while (q.length) { const k = q.shift()!; for (const t of tx(byKey.get(k)!)) if (!seen.has(t.toKey) && keys.has(t.toKey)) { seen.add(t.toKey); q.push(t.toKey); } }
      for (const s of steps) if (!seen.has(s.key)) issues.push({ severity: 'WARN', step: s.key, message: '시작 단계에서 도달 불가' });
    }
    return { ok: !issues.some((i) => i.severity === 'ERROR'), issues };
  }

  // ── P2b 편집기: 카탈로그(드롭다운 선택지) ──
  getPredicateCatalog() {
    return { gatePredicates: GATE_PREDICATES, ownerRoles: OWNER_ROLES, actionTypes: ACTION_TYPES, chartViews: CHART_VIEWS, conditionFields: CONDITION_FIELDS };
  }

  // ── P2b 편집기: ACTIVE/임의 버전을 새 DRAFT 버전으로 클론(편집 시작) ──
  async cloneToDraft(templateId: string) {
    const src = await this.prisma.protocolTemplate.findUnique({ where: { id: templateId }, include: { steps: { orderBy: { sortOrder: 'asc' } } } });
    if (!src) throw new NotFoundException('프로토콜 템플릿을 찾을 수 없습니다');
    // 이미 편집 중 DRAFT가 있으면 그것을 반환(중복 DRAFT 방지)
    const openDraft = await this.prisma.protocolTemplate.findFirst({ where: { code: src.code, status: 'DRAFT' }, include: { steps: { orderBy: { sortOrder: 'asc' } } } });
    if (openDraft) return this.serializeTemplate(openDraft);
    const max = await this.prisma.protocolTemplate.aggregate({ where: { code: src.code }, _max: { version: true } });
    const nextVersion = (max._max.version ?? src.version) + 1;
    const draft = await this.prisma.protocolTemplate.create({ data: { code: src.code, name: src.name, domain: src.domain, version: nextVersion, status: 'DRAFT', description: src.description } });
    await this.prisma.protocolStep.createMany({
      data: src.steps.map((s) => ({ templateId: draft.id, key: s.key, title: s.title, sortOrder: s.sortOrder, phase: s.phase, ownerRoles: s.ownerRoles, actionType: s.actionType, gate: s.gate, gateRule: s.gateRule, chartView: s.chartView, slaMinutes: s.slaMinutes, transitions: s.transitions ?? [] })),
    });
    return this.serializeTemplate(await this.prisma.protocolTemplate.findUniqueOrThrow({ where: { id: draft.id }, include: { steps: { orderBy: { sortOrder: 'asc' } } } }));
  }

  // ── P2b 편집기: DRAFT 본문/단계 갱신(steps 전체 교체) ──
  async updateDraft(draftId: string, dto: { name?: string; description?: string | null; steps: EditableStep[] }) {
    const draft = await this.prisma.protocolTemplate.findUnique({ where: { id: draftId }, select: { id: true, status: true } });
    if (!draft) throw new NotFoundException('DRAFT를 찾을 수 없습니다');
    if (draft.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태만 편집할 수 있습니다(발행본은 클론 후 편집)');
    const steps = this.normalizeSteps(dto.steps);
    await this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined || dto.description !== undefined) {
        await tx.protocolTemplate.update({ where: { id: draftId }, data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}) } });
      }
      await tx.protocolStep.deleteMany({ where: { templateId: draftId } });
      if (steps.length) await tx.protocolStep.createMany({ data: steps.map((s) => ({ templateId: draftId, key: s.key, title: s.title, sortOrder: s.sortOrder, phase: s.phase ?? null, ownerRoles: s.ownerRoles, actionType: s.actionType, gate: s.gate, gateRule: s.gate ? s.gateRule ?? null : null, chartView: s.chartView ?? null, slaMinutes: s.slaMinutes ?? null, transitions: s.transitions })) });
    });
    return this.serializeTemplate(await this.prisma.protocolTemplate.findUniqueOrThrow({ where: { id: draftId }, include: { steps: { orderBy: { sortOrder: 'asc' } } } }));
  }

  // 편집 입력 정규화(키 중복 제거·sortOrder 재배치·전이 정제)
  private normalizeSteps(input: EditableStep[]): EditableStep[] {
    if (!Array.isArray(input) || input.length === 0) throw new BadRequestException('단계가 비어 있습니다');
    const seen = new Set<string>();
    const sorted = [...input].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return sorted.map((s, idx) => {
      const key = (s.key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!key) throw new BadRequestException(`단계 키가 비어 있습니다(${s.title ?? idx})`);
      if (seen.has(key)) throw new BadRequestException(`단계 키 중복: ${key}`);
      seen.add(key);
      const roles = (s.ownerRoles ?? []).filter((r) => OWNER_ROLES.includes(r));
      const actionType = ACTION_TYPES.includes(s.actionType) ? s.actionType : 'CHECK';
      const transitions = (s.transitions ?? []).filter((t) => t && t.toKey).map((t) => ({ toKey: String(t.toKey).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), ...(t.condition ? { condition: String(t.condition) } : {}) }));
      return { key, title: (s.title || key).trim(), sortOrder: idx + 1, phase: s.phase ?? null, ownerRoles: roles, actionType, gate: !!s.gate, gateRule: s.gate ? s.gateRule ?? null : null, chartView: s.chartView ?? null, slaMinutes: s.slaMinutes != null ? Number(s.slaMinutes) : null, transitions };
    });
  }

  // ── P2b 편집기: DRAFT 발행(검증 통과 필수 → 기존 ACTIVE 은퇴, DRAFT→ACTIVE) ──
  async publishDraft(draftId: string, userId?: string) {
    const draft = await this.prisma.protocolTemplate.findUnique({ where: { id: draftId }, include: { steps: { orderBy: { sortOrder: 'asc' } } } });
    if (!draft) throw new NotFoundException('DRAFT를 찾을 수 없습니다');
    if (draft.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태만 발행할 수 있습니다');
    const validation = this.validateSteps(draft.steps);
    if (!validation.ok) throw new BadRequestException({ code: 'PROTOCOL_VALIDATION_FAILED', message: '발행 검증 실패(오류를 해결한 뒤 발행하세요)', validation });
    await this.prisma.$transaction([
      this.prisma.protocolTemplate.updateMany({ where: { code: draft.code, status: 'ACTIVE' }, data: { status: 'RETIRED' } }),
      this.prisma.protocolTemplate.update({ where: { id: draftId }, data: { status: 'ACTIVE', publishedAt: new Date(), publishedBy: userId ?? null } }),
    ]);
    return this.serializeTemplate(await this.prisma.protocolTemplate.findUniqueOrThrow({ where: { id: draftId }, include: { steps: { orderBy: { sortOrder: 'asc' } } } }));
  }

  // ── P2b 편집기: 버전 히스토리(RETIRED 포함, 롤백은 기존 clone 재사용) ──
  async getHistory(code: string) {
    const versions = await this.prisma.protocolTemplate.findMany({ where: { code }, orderBy: { version: 'desc' }, include: { steps: { orderBy: { sortOrder: 'asc' } }, _count: { select: { instances: true } } } });
    if (!versions.length) throw new NotFoundException(`프로토콜 없음: ${code}`);
    const pubIds = [...new Set(versions.map((v) => v.publishedBy).filter((x): x is string => !!x))];
    const users = pubIds.length ? await this.prisma.user.findMany({ where: { id: { in: pubIds } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const uMap = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    return versions.map((v) => ({
      id: v.id, code: v.code, name: v.name, domain: v.domain, version: v.version, status: v.status,
      publishedAt: v.publishedAt, publishedBy: v.publishedBy ? (uMap.get(v.publishedBy) ?? v.publishedBy) : null,
      instanceCount: v._count.instances, stepCount: v.steps.length, validation: this.validateSteps(v.steps),
    }));
  }

  // ── P2b 편집기: DRAFT 폐기 ──
  async discardDraft(draftId: string) {
    const draft = await this.prisma.protocolTemplate.findUnique({ where: { id: draftId }, select: { id: true, status: true } });
    if (!draft) throw new NotFoundException('DRAFT를 찾을 수 없습니다');
    if (draft.status !== 'DRAFT') throw new BadRequestException('DRAFT 상태만 폐기할 수 있습니다');
    await this.prisma.protocolTemplate.delete({ where: { id: draftId } });
    return { ok: true };
  }

  // ── P2b 편집기: what-if 시뮬레이션(순수 — DB 미변경) ──
  // sampleFlags[gateRule]=true 면 그 게이트를 통과했다고 가정하고 경로를 흘려본다.
  simulate(steps: EditableStep[], sampleFlags: Record<string, boolean> = {}) {
    const norm = this.normalizeSteps(steps);
    const byKey = new Map<string, EditableStep>(norm.map((s) => [s.key, s]));
    const start = norm[0];
    const path: { key: string; title: string; gate: boolean; gateRule: string | null; gatePassed: boolean | null; blocked: boolean; next: string | null }[] = [];
    const seen = new Set<string>();
    let cur: string | null = start?.key ?? null;
    let blockedAt: string | null = null;
    while (cur && byKey.has(cur) && !seen.has(cur) && path.length < 100) {
      seen.add(cur);
      const s: EditableStep = byKey.get(cur)!;
      const gatePassed = s.gate && s.gateRule ? !!sampleFlags[s.gateRule] : null;
      const blocked = s.gate ? gatePassed === false : false;
      // 전이 선택: 조건부 전이는 sampleFlags[condition]가 true인 것 우선, 없으면 첫 무조건
      let next: string | null = null;
      if (!blocked) {
        const conditional = s.transitions.find((t: { toKey: string; condition?: string }) => t.condition && sampleFlags[t.condition]);
        next = (conditional ?? s.transitions.find((t: { toKey: string; condition?: string }) => !t.condition) ?? s.transitions[0])?.toKey ?? null;
      }
      path.push({ key: s.key, title: s.title, gate: s.gate, gateRule: s.gateRule ?? null, gatePassed, blocked, next });
      if (blocked) { blockedAt = s.key; break; }
      cur = next;
    }
    const reached = new Set(path.map((p) => p.key));
    const unreached = norm.filter((s) => !reached.has(s.key)).map((s) => s.key);
    return { path, blockedAt, completed: !blockedAt && path.length > 0 && !path[path.length - 1].next, unreached, validation: this.validateSteps(norm) };
  }

  /**
   * P2b 실데이터 what-if — 편집 중 DRAFT 단계를 실제 인스턴스의 진짜 게이트 평가로 시뮬.
   * 각 게이트 술어를 evaluateGate(실데이터)로 평가 → sampleFlags 구성 → 경로 흘림.
   * 발행 전 "이 정의를 실제 환자에 적용하면 어디서 막히나" 검증.
   */
  async simulateWithInstance(steps: EditableStep[], instanceId: string) {
    const inst = await this.getInstanceById(instanceId);
    const gateRules = [...new Set(steps.filter((s) => s.gate && s.gateRule).map((s) => s.gateRule!))];
    const gateResults: Record<string, GateResult> = {};
    const sampleFlags: Record<string, boolean> = {};
    for (const rule of gateRules) {
      const g = await this.evaluateGate(rule, inst);
      gateResults[rule] = g;
      sampleFlags[rule] = g.passed;
    }
    // 조건식 DSL — 실데이터 컨텍스트로 각 전이 조건 평가 → simulate 가 분기에 반영
    const ctx = await this.buildConditionContext(inst);
    for (const s of steps) for (const t of s.transitions ?? []) if (t.condition) sampleFlags[t.condition] = evalCondition(t.condition, ctx);
    const sim = this.simulate(steps, sampleFlags);
    return { ...sim, instanceId, domain: inst.template.domain, currentStepKey: inst.currentStepKey, gateResults, context: ctx };
  }

  // ── P2 관리: 인스턴스 모니터(진행/게이트차단/경과) ──
  async getMonitor() {
    const insts = await this.prisma.protocolInstance.findMany({ where: { status: 'ACTIVE' }, orderBy: { startedAt: 'asc' }, take: 300, include: { template: { select: { domain: true } } } });
    if (!insts.length) return [];
    const pids = [...new Set(insts.map((i) => i.patientId))];
    const patients = await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } });
    const pMap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();
    const out = [];
    for (const i of insts) {
      let blocked = false; let gateInfo: GateResult | null = null;
      if (i.currentStepKey) {
        const step = await this.prisma.protocolStep.findFirst({ where: { templateId: i.templateId, key: i.currentStepKey }, select: { gate: true, gateRule: true, title: true } });
        if (step?.gate) { gateInfo = await this.evaluateGate(step.gateRule ?? null, i); blocked = !gateInfo.passed; }
      }
      const p = pMap.get(i.patientId);
      out.push({ instanceId: i.id, domain: i.template.domain, patientName: p ? `${p.familyName}${p.givenName}` : '', mrn: p?.mrn ?? '', currentStepKey: i.currentStepKey, blocked, gate: gateInfo, activeMinutes: Math.round((now - i.startedAt.getTime()) / 60000) });
    }
    // 차단 우선 정렬
    return out.sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.activeMinutes - a.activeMinutes);
  }

  // ── 활성 프로토콜 목록(전 도메인, 보드 진입) ──
  async getActive() {
    const insts = await this.prisma.protocolInstance.findMany({ where: { status: 'ACTIVE' }, orderBy: { startedAt: 'desc' }, take: 200, include: { template: { select: { domain: true } } } });
    if (!insts.length) return [];
    const pids = [...new Set(insts.map((i) => i.patientId))];
    const sids = insts.map((i) => i.surgeryId).filter((x): x is string => !!x);
    const [patients, surgeries] = await Promise.all([
      this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } }),
      sids.length ? this.prisma.surgery.findMany({ where: { id: { in: sids } }, select: { id: true, procedureName: true, scheduledAt: true } }) : Promise.resolve([] as { id: string; procedureName: string; scheduledAt: Date }[]),
    ]);
    const pMap = new Map(patients.map((p) => [p.id, p]));
    const sMap = new Map(surgeries.map((s) => [s.id, s]));
    return insts.map((i) => {
      const p = pMap.get(i.patientId); const s = i.surgeryId ? sMap.get(i.surgeryId) : null;
      return { instanceId: i.id, domain: i.template.domain, surgeryId: i.surgeryId, currentStepKey: i.currentStepKey, label: s?.procedureName ?? (i.template.domain === 'IPD' ? '입원' : i.template.domain), scheduledAt: s?.scheduledAt ?? null, patientName: p ? `${p.familyName}${p.givenName}` : '', mrn: p?.mrn ?? '' };
    });
  }

  // ── 환자 → 활성 프로토콜 인스턴스 해석(QR 스캔: 수술>입원>응급>외래) ──
  async resolveByPatient(patientId: string) {
    const surgery = await this.prisma.surgery.findFirst({ where: { patientId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } }, orderBy: { scheduledAt: 'desc' }, select: { id: true } });
    if (surgery) { const b = await this.ensureInstanceForSurgery(surgery.id); return { instanceId: b.id, domain: 'SURGERY', surgeryId: surgery.id }; }
    const adm = await this.prisma.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' }, select: { id: true } });
    if (adm) { const b = await this.ensureInstanceForAdmission(adm.id); return { instanceId: b.id, domain: 'IPD', surgeryId: null }; }
    const er = await this.prisma.emergencyVisit.findFirst({ where: { patientId, status: { not: 'COMPLETED' } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (er) { const b = await this.ensureInstanceForEmergency(er.id); return { instanceId: b.id, domain: 'ER', surgeryId: null }; }
    const enc = await this.prisma.encounter.findFirst({ where: { patientId, visitType: 'OUTPATIENT' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (enc) { const b = await this.ensureInstanceForEncounter(enc.id); return { instanceId: b.id, domain: 'OPD', surgeryId: null }; }
    return { instanceId: null, domain: null, surgeryId: null };
  }

  // ── 게이트 평가(명명 술어 → 기존 실데이터) ──
  private async evaluateGate(rule: string | null, inst: { surgeryId: string | null; admissionId: string | null; encounterId?: string | null; emergencyVisitId?: string | null }): Promise<GateResult> {
    if (!rule) return { rule: null, passed: true, done: 0, total: 0 };
    if (rule === 'encounter_signed') {
      if (!inst.encounterId) return { rule, passed: false, done: 0, total: 1, detail: '진료 없음' };
      const e = await this.prisma.encounter.findUnique({ where: { id: inst.encounterId }, select: { status: true } });
      // 정책(옵트인): clinical.requireResignAfterAmend=true 면 정정(AMENDED)은 재서명 전까지 게이트 차단.
      const requireResign = await this.config.get('clinical.requireResignAfterAmend');
      const amendOk = e?.status === 'AMENDED' && requireResign !== true && requireResign !== 'true';
      const ok = e?.status === 'SIGNED' || amendOk;
      return { rule, passed: ok, done: ok ? 1 : 0, total: 1, detail: ok ? undefined : (e?.status === 'AMENDED' ? '정정 후 재서명 필요' : '진료 서명 미완료') };
    }
    if (rule === 'triage_done') {
      if (!inst.emergencyVisitId) return { rule, passed: false, done: 0, total: 1, detail: '응급 방문 없음' };
      const ev = await this.prisma.emergencyVisit.findUnique({ where: { id: inst.emergencyVisitId }, select: { status: true } });
      const ok = !!ev && ev.status !== 'PENDING_TRIAGE';
      return { rule, passed: ok, done: ok ? 1 : 0, total: 1, detail: ok ? undefined : 'KTAS 트리아지 미완료' };
    }
    if (rule === 'preop_ok') {
      if (!inst.admissionId) return { rule, passed: false, done: 0, total: 7, detail: '입원/수술전 체크리스트 없음' };
      const cl = await this.prisma.nursingChecklist.findFirst({ where: { admissionId: inst.admissionId, templateType: 'PRE_OP' }, orderBy: { createdAt: 'desc' } });
      if (!cl) return { rule, passed: false, done: 0, total: 7, detail: '수술전 체크리스트 미작성' };
      const done = cl.checkedItems ?? 0, total = cl.totalItems ?? 0;
      return { rule, passed: total > 0 && done >= total, done, total };
    }
    if (rule === 'assessment_done') {
      if (!inst.admissionId) return { rule, passed: false, done: 0, total: 1, detail: '입원 정보 없음' };
      const n = await this.prisma.nursingAssessment.count({ where: { admissionId: inst.admissionId } });
      return { rule, passed: n > 0, done: n > 0 ? 1 : 0, total: 1, detail: n > 0 ? undefined : '입원 간호 사정 미작성' };
    }
    // signin_ok | timeout_ok | signout_ok → SurgicalChecklist
    if (!inst.surgeryId) return { rule, passed: false, done: 0, total: 0, detail: '수술 없음' };
    const cl = await this.prisma.surgicalChecklist.findUnique({ where: { surgeryId: inst.surgeryId } });
    if (!cl) return { rule, passed: false, done: 0, total: 0, detail: '수술 안전 체크리스트 미작성' };
    const p = SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>);
    const phase = rule === 'signin_ok' ? p.signIn : rule === 'timeout_ok' ? p.timeOut : p.signOut;
    return { rule, passed: phase.requiredComplete, done: phase.requiredDone, total: phase.requiredTotal };
  }

  // ── 조건식 DSL: 분기 컨텍스트(환자/도메인 데이터) ──
  private async buildConditionContext(inst: { patientId: string; emergencyVisitId?: string | null }): Promise<ConditionCtx> {
    const ctx: ConditionCtx = {};
    // 🔴 (2026-09-15) 종전 `.catch(() => null)` — 환자 조회 **실패**가 나이·성별 없는 컨텍스트가 되어 조건 분기를
    //    건너뛰고 무조건 전이를 골랐다(실패가 '조건 불충족'으로 번역). 실패는 전파한다 — 전이가 일어나지 않는다.
    const patient = await this.prisma.patient.findUnique({ where: { id: inst.patientId }, select: { dateOfBirth: true, gender: true } });
    if (patient?.dateOfBirth) ctx.age = Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / 31_557_600_000);
    ctx.gender = patient?.gender ?? null;
    if (inst.emergencyVisitId) {
      const ev = await this.prisma.emergencyVisit.findUnique({ where: { id: inst.emergencyVisitId }, select: { triageLevel: true, disposition: true } });
      if (ev) {
        ctx.ktas = ev.triageLevel ? Number(String(ev.triageLevel).replace('LEVEL_', '')) : null;
        ctx.disposition = ev.disposition ?? null;
      }
    }
    return ctx;
  }

  /** 전이 선택 — 조건부 전이 중 첫 충족, 없으면 첫 무조건, 최후 transitions[0]. */
  private selectNextKey(transitions: unknown, ctx: ConditionCtx): string | null {
    const ts = (transitions as { toKey: string; condition?: string }[] | null) ?? [];
    for (const t of ts) if (t.condition && evalCondition(t.condition, ctx)) return t.toKey;
    return (ts.find((t) => !t.condition) ?? ts[0])?.toKey ?? null;
  }

  // ── 역할별 다음단계(인스턴스 단위) ──
  async nextSteps(surgeryId: string, role: string) {
    const inst = await this.prisma.protocolInstance.findFirst({ where: { surgeryId, status: { not: 'CANCELLED' } }, select: { id: true } });
    if (!inst) return { instanceId: null, dueNow: [], upcoming: [], blocked: [] };
    return this.nextStepsByInstance(inst.id, role);
  }

  async nextStepsByInstance(instanceId: string, role: string) {
    const board = await this.getBoardByInstanceId(instanceId);
    if (!board) return { instanceId: null, dueNow: [], upcoming: [], blocked: [] };
    const steps = board.steps;
    const cur = steps.find((s) => s.key === board.currentStepKey);
    const dueNow: typeof steps = [], upcoming: typeof steps = [], blocked: typeof steps = [];
    if (cur) {
      const mine = cur.ownerRoles.includes(role) || role === 'ADMIN';
      if (cur.gate && !cur.gateStatus.passed) blocked.push(cur);
      else if (mine) dueNow.push(cur);
      else upcoming.push(cur); // 내 차례 아님 → 대기
      // 다음 단계 예측 — 조건식 DSL 분기(실데이터 컨텍스트)
      const full = await this.getInstanceById(board.id);
      const curDef = full.template.steps.find((s) => s.key === cur.key);
      const ctx = await this.buildConditionContext(full);
      const nextKey = this.selectNextKey(curDef?.transitions ?? null, ctx);
      const next = nextKey ? steps.find((s) => s.key === nextKey) : undefined;
      if (next) upcoming.push(next);
    }
    return { instanceId: board.id, currentStepKey: board.currentStepKey, dueNow, upcoming, blocked };
  }

  // ── 단계 완료(게이트 검증 후 전이) ──
  async completeStep(instanceId: string, stepKey: string, userId: string) {
    const inst = await this.getInstanceById(instanceId);
    const step = inst.template.steps.find((s) => s.key === stepKey);
    if (!step) throw new NotFoundException('단계를 찾을 수 없습니다');
    if (step.gate) {
      const g = await this.evaluateGate(step.gateRule ?? null, inst);
      if (!g.passed) throw new BadRequestException({ code: 'PROTOCOL_GATE_BLOCKED', message: `질관리 게이트 미충족 (${step.title}: ${g.done}/${g.total})`, gate: g });
    }
    // 조건식 DSL 분기 — 실데이터 컨텍스트로 전이 선택(조건 미충족 시 무조건 경로)
    //   🔴 컨텍스트 조회는 트랜잭션 **밖**에서 먼저 끝낸다(외부·장시간 조회를 트랜잭션에 넣지 않는다).
    const ctx = await this.buildConditionContext(inst);
    const nextKey = this.selectNextKey(step.transitions, ctx);
    const nextStep = nextKey ? inst.template.steps.find((s) => s.key === nextKey) : null;

    // 🔴 (2026-09-16 I2) 단계 완료·다음 단계 개시·인스턴스 현재단계를 한 트랜잭션에서 쓴다.
    //    종전엔 셋이 따로 나가, 중간 실패 시 "단계는 DONE 인데 인스턴스의 현재 단계는 그 DONE 단계"
    //    (보드가 끝난 단계를 가리킨다) 또는 마지막 단계에서 "단계는 DONE 인데 프로토콜은 영원히 진행 중"
    //    이 남는다. 수술 안전 프로토콜 보드가 읽는 값이라 그대로 사람 판단에 들어간다.
    await this.prisma.$transaction(async (tx) => {
      await tx.protocolStepState.upsert({
        where: { instanceId_stepKey: { instanceId, stepKey } },
        update: { status: 'DONE', completedBy: userId, completedAt: new Date() },
        create: { instanceId, stepKey, status: 'DONE', completedBy: userId, completedAt: new Date() },
      });
      if (nextKey) {
        await tx.protocolStepState.updateMany({ where: { instanceId, stepKey: nextKey }, data: { status: 'IN_PROGRESS' } });
        await tx.protocolInstance.update({ where: { id: instanceId }, data: { currentStepKey: nextKey } });
      } else {
        await tx.protocolInstance.update({ where: { id: instanceId }, data: { status: 'DONE', currentStepKey: null, completedAt: new Date() } });
      }
    });

    // P1: 여정 이벤트 발행 + 다음 단계 담당자 알림(부작용 — 실패해도 진행)
    void this.afterTransition(inst.surgeryId, inst.patientId, step.title, nextStep?.title ?? null, nextStep?.ownerRoles ?? [], instanceId).catch(() => {});

    return this.getBoardByInstanceId(instanceId);
  }

  /** 전이 후 부작용: 여정 이벤트 + 다음 단계 담당자(배정 개인) 알림. */
  private async afterTransition(surgeryId: string | null, patientId: string, doneTitle: string, nextTitle: string | null, nextRoles: string[], instanceId: string) {
    const navUrl = surgeryId ? `/tablet/protocol/${surgeryId}` : undefined;
    // 여정 타임라인
    this.journey.emit({ patientId, eventType: 'PROTOCOL_STEP', title: `프로토콜: ${doneTitle} 완료`, description: nextTitle ? `다음 단계: ${nextTitle}` : '프로토콜 완료', refType: 'protocol', refId: instanceId, navUrl, severity: 'info' });
    if (!nextTitle || !surgeryId) return;

    // 다음 단계 담당자 해석(배정 개인 — 과알림 방지)
    const surgery = await this.prisma.surgery.findUnique({ where: { id: surgeryId }, select: { surgeonId: true, anesthetistId: true, assistantId: true, scrubNurseId: true, admissionId: true, procedureName: true } });
    if (!surgery) return;
    let attendingDoctorId: string | null = null;
    if (surgery.admissionId) {
      // 주치의 조회 실패가 다른 수신자 통보를 막지 않게 — 다만 누락은 흔적을 남긴다(2026-09-15 · 종전 조용한 null)
      const adm = await this.prisma.admission.findUnique({ where: { id: surgery.admissionId }, select: { attendingDoctorId: true } })
        .catch((e) => { this.logger.warn(`프로토콜 다음 단계 주치의 조회 실패 — 주치의 통보 누락 surgery=${surgeryId}: ${e instanceof Error ? e.message : String(e)}`); return null; });
      attendingDoctorId = adm?.attendingDoctorId ?? null;
    }
    const recipients = new Set<string>();
    if (nextRoles.includes('DOCTOR')) [surgery.surgeonId, surgery.anesthetistId, surgery.assistantId, attendingDoctorId].forEach((id) => id && recipients.add(id));
    if (nextRoles.includes('NURSE')) [surgery.scrubNurseId].forEach((id) => id && recipients.add(id));
    for (const userId of recipients) {
      await this.notifications.create(userId, { type: 'PROTOCOL_NEXT', title: `다음 단계: ${nextTitle}`, message: `${surgery.procedureName} — '${doneTitle}' 완료. '${nextTitle}' 진행이 필요합니다.`, severity: 'info', refType: 'protocol', refId: instanceId }).catch(() => {});
    }
  }
}
