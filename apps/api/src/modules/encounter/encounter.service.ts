import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { ageOf } from '@hospital-run/shared';
import { createHmac, timingSafeEqual } from 'crypto';
import { EncounterStatus, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import { signingSecret } from '../../common/util/signing-secret';
import { levenshteinCapped } from '../../common/util/edit-distance';
import { scribeDraftSoap, scribeSignedText } from '../../common/util/scribe-edit-measure';
import { assertEnumParam } from '../../common/enum-param';
import { recordGateViolation } from '../../common/gate-violation-record';
import { preserveSignedVersion } from '../him/signed-record-version';

/** 상병 제한 위반(주상병 불가·성별·연령) — rule은 config diagnosis.restrictionEnforce 키와 일치 */
interface DxViolation { code: string; rule: 'notPrimary' | 'sex' | 'age'; message: string }

/**
 * 스크라이브 초안 해석·확정본 텍스트는 정본 `common/util/scribe-edit-measure.ts` 로 옮겼다
 * (AI 감독 집계가 같은 해석을 쓴다 — 서비스 안에 두면 두 번째 소비처가 자기 구현을 따로 쓰게 된다).
 */

/** 진료기록 정정이 건드릴 수 있는 항목 — 서명본 보존의 changedFields 어휘 */
export const ENCOUNTER_AMENDABLE_FIELDS = [
  'subjective', 'objective', 'assessment', 'plan', 'pregnancyStatus', 'diagnoses',
  // 구조화 문진(2026-10-03 — 종전 DTO 에 없어 저장된 적이 없었다)
  'chiefComplaint', 'historyPresentIllness', 'pastMedicalHistory', 'familyHistory', 'socialHistory', 'reviewOfSystems', 'physicalExamination',
] as const;
/** 구조화 문진 칸 — 쓰기·보존·비교에 같은 목록을 쓴다 */
export const ENCOUNTER_STRUCTURED_FIELDS = ['chiefComplaint', 'historyPresentIllness', 'pastMedicalHistory', 'familyHistory', 'socialHistory', 'reviewOfSystems', 'physicalExamination'] as const;

/**
 * 비교용 정규화 — 빈 문자열·빈 객체·값이 전부 빈 객체는 "값 없음"(null) · 객체는 키 정렬 직렬화.
 * 🔴 화면은 빈 칸을 '' 로, 빈 문진을 {smoking:'',…} 로 보낸다 — 그대로 비교하면 빈 칸 재저장이 "정정"으로 세진다.
 */
export function normEncounterField(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'object') {
    const empty = (x: unknown): boolean => x == null || (typeof x === 'string' && x.trim() === '') || (typeof x === 'object' && Object.values(x as object).every(empty));
    if (empty(v)) return null;
    const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x;
    return JSON.stringify(sort(v));
  }
  return String(v);
}

/** 서명본 대비 실제로 바뀐 항목 — 보내지 않은 항목(undefined)은 바뀌지 않은 것 · 상병은 (코드·구분·확실도·메모) 집합 비교 */
export function encounterChangedFields(
  existing: Record<string, unknown> & { diagnoses: Array<{ diagnosisCodeId: string; type: string; certainty: string | null; notes: string | null }> },
  dto: Record<string, unknown> | object,
  normDiagnoses: Array<{ diagnosisCodeId: string; type: string; certainty: string | null; notes: string | null }> | undefined,
): string[] {
  const d = dto as Record<string, unknown>;
  const out: string[] = [];
  for (const f of ENCOUNTER_AMENDABLE_FIELDS) {
    if (f === 'diagnoses' || d[f] === undefined) continue;
    if (normEncounterField(d[f]) !== normEncounterField(existing[f])) out.push(f);
  }
  if (d.diagnoses !== undefined) {
    const key = (x: { diagnosisCodeId: string; type: string; certainty: string | null; notes: string | null }) => [x.diagnosisCodeId, x.type, x.certainty ?? '', x.notes ?? ''].join('|');
    const before = existing.diagnoses.map(key).sort().join('\n');
    const after = (normDiagnoses ?? []).map(key).sort().join('\n');
    if (before !== after) out.push('diagnoses');
  }
  return out;
}

@Injectable()
export class EncounterService {
  private readonly logger = new Logger(EncounterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService, // 미주입=게이트 OFF(무중단)
  ) {}

  /**
   * 주상병(PRIMARY) 정확히 1개 보장 + rank 정규화 — EDI 청구 정합(G2-3).
   * - type 미지정/무효 → PRIMARY 후보. 복수 PRIMARY → 최초 1개만 유지·나머지 SECONDARY 강등.
   * - PRIMARY 0개 → 첫 비(非)감별 항목 승격. rank: 주상병=1, 이후 입력 순서.
   * 진료 저장 실패(데이터 손실) 방지를 위해 throw 없이 결정적으로 정규화한다.
   */
  private normalizeDiagnoses(
    diagnoses?: Array<{ diagnosisCodeId: string; type?: string; certainty?: string; notes?: string }>,
  ) {
    if (!diagnoses?.length) return undefined;
    const VALID = new Set(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL']);
    let primarySeen = false;
    const norm = diagnoses.map((d) => {
      let type = d.type && VALID.has(d.type) ? d.type : 'PRIMARY';
      if (type === 'PRIMARY') {
        if (primarySeen) type = 'SECONDARY';
        else primarySeen = true;
      }
      return { diagnosisCodeId: d.diagnosisCodeId, type, certainty: d.certainty ?? null, notes: d.notes ?? null };
    });
    if (!primarySeen) {
      const idx = norm.findIndex((d) => d.type !== 'DIFFERENTIAL');
      // 전부 감별(DIFFERENTIAL)이면 주상병 없이 저장 — 감별을 확정 주상병으로 승격하면
      // 청구 필터(type!==DIFFERENTIAL)를 통과해 R/O 상병이 확진 청구로 유입됨
      if (idx >= 0) norm[idx].type = 'PRIMARY';
    }
    const primaryIdx = norm.findIndex((d) => d.type === 'PRIMARY');
    let r = 2;
    return norm.map((d, i) => ({ ...d, rank: i === primaryIdx ? 1 : r++ }));
  }

  /**
   * 상병 제한(주상병 불가·성별·연령) 위반 수집 — 검증 자체의 실패는 [](fail-open, 저장 차단 금지).
   */
  private async checkDiagnosisRestrictions(
    patientId: string,
    diagnoses?: Array<{ diagnosisCodeId: string; type: string }>,
  ): Promise<DxViolation[]> {
    if (!diagnoses?.length) return [];
    try {
      const [patient, codes] = await Promise.all([
        this.prisma.patient.findUnique({ where: { id: patientId }, select: { gender: true, dateOfBirth: true } }),
        this.prisma.diagnosisCode.findMany({
          where: { id: { in: diagnoses.map((d) => d.diagnosisCodeId) } },
          select: { id: true, code: true, notPrimary: true, sexRestriction: true, ageMin: true, ageMax: true },
        }),
      ]);
      if (!patient) return [];
      const age = ageOf(patient.dateOfBirth) ?? 0;
      const sex = patient.gender === 'MALE' ? 'M' : patient.gender === 'FEMALE' ? 'F' : null;
      const byId = new Map(codes.map((c) => [c.id, c]));
      const violations: DxViolation[] = [];
      for (const d of diagnoses) {
        const c = byId.get(d.diagnosisCodeId);
        if (!c) continue;
        if (c.notPrimary && d.type === 'PRIMARY') violations.push({ code: c.code, rule: 'notPrimary', message: '주상병 사용 불가 코드를 주상병으로 지정' });
        if (c.sexRestriction && sex && c.sexRestriction !== sex) violations.push({ code: c.code, rule: 'sex', message: `성별 제한(${c.sexRestriction}) 불일치` });
        if ((c.ageMin != null && age < c.ageMin) || (c.ageMax != null && age > c.ageMax)) violations.push({ code: c.code, rule: 'age', message: `연령 제한(${c.ageMin ?? ''}~${c.ageMax ?? ''}세) 벗어남` });
      }
      return violations;
    } catch {
      return []; // 검증 실패가 진료 저장을 막지 않도록(경고 목적)
    }
  }

  /**
   * 상병 제한 시행 게이트 — config `diagnosis.restrictionEnforce` {notPrimary,sex,age}: OFF|WARN|BLOCK (기본 OFF·무중단).
   * 위반은 모드와 무관하게 전부 서버 로그(우회 흔적). BLOCK 규칙 위반 시 저장 거부(400),
   * WARN 규칙 위반은 반환되어 응답에 `diagnosisWarnings`로 동봉(추가 필드 — FE 비파괴).
   * (포뮬러리 formulary.enforce 선례 — 실전 전환은 config 플립만)
   */
  private async gateDiagnosisRestrictions(
    patientId: string,
    ctx: string,
    diagnoses?: Array<{ diagnosisCodeId: string; type: string }>,
  ): Promise<DxViolation[]> {
    const violations = await this.checkDiagnosisRestrictions(patientId, diagnoses);
    if (!violations.length) return [];
    for (const v of violations) this.logger.warn(`상병 제한 위반 — ${ctx} code=${v.code}: ${v.message}`);
    let modes: Record<string, string> = {};
    try {
      modes = ((await this.configRuntime?.get('diagnosis.restrictionEnforce')) as Record<string, string> | null) ?? {};
    } catch { /* config 조회 실패 = OFF (무중단) */ }
    // per-rule 모드 — 미설정 규칙은 OFF(미적용), 설정된 값이 오타/공백이면 fail-closed로 BLOCK.
    const ruleMode = (r: string) => gateMode(modes[r], 'OFF');
    const blocked = violations.filter((v) => ruleMode(v.rule) === 'BLOCK');
    if (blocked.length) {
      throw new BadRequestException(
        `상병 제한 위반으로 저장할 수 없습니다: ${blocked.map((v) => `${v.code}(${v.message})`).join(' / ')}`,
      );
    }
    return violations.filter((v) => ruleMode(v.rule) === 'WARN');
  }

  async create(dto: CreateEncounterDto, doctorId: string) {
    const normDiagnoses = this.normalizeDiagnoses(dto.diagnoses);
    // 상병 제한 게이트 — BLOCK 모드 위반 시 저장 전 400(config 기본 OFF)
    const dxWarnings = await this.gateDiagnosisRestrictions(dto.patientId, '신규 진료', normDiagnoses);
    // 🔴 화면들(진료 작성·오더)이 patientId 만 보내 입원 환자의 진료가 입원과 끊겼다(2026-09-30) —
    //    입원 상세의 활성 오더·퇴원 '미결 오더'·오더 진료 조회는 encounter.admissionId 로 세는데 늘 0,
    //    visitType null 이라 청구는 외래 본인부담으로 갔다. 호출이 밝히지 않았고 **지금 입원 중**(ADMITTED)이면 그 입원에 잇는다.
    //    호출이 visitType 을 밝혔으면(예: OUTPATIENT) 그대로 둔다 — 추정은 비어 있을 때만.
    let admissionId = dto.admissionId;
    let visitType = dto.visitType;
    if (!admissionId && !visitType) {
      const active = await this.prisma.admission.findFirst({
        where: { patientId: dto.patientId, status: 'ADMITTED' },
        orderBy: { admitDate: 'desc' },
        select: { id: true },
      });
      if (active) { admissionId = active.id; visitType = 'INPATIENT'; }
    } else if (admissionId && !visitType) {
      visitType = 'INPATIENT'; // 입원에 잇는 진료를 외래로 청구하지 않는다
    }
    const encounter = await this.prisma.encounter.create({
      data: {
        patientId: dto.patientId,
        doctorId,
        appointmentId: dto.appointmentId,
        visitType, // 생략 + 입원 아님 → null=외래 취급(billing 외래 진찰료 분기)
        admissionId,
        subjective: dto.subjective,
        objective: dto.objective,
        assessment: dto.assessment,
        plan: dto.plan,
        diagnoses: normDiagnoses ? { create: normDiagnoses } : undefined,
      },
      include: this.fullInclude(),
    });
    this.journey?.emit({
      patientId: dto.patientId, eventType: 'ENCOUNTER_START', refType: 'ENCOUNTER', refId: encounter.id, // 여정 P0-5: 방문 단위 귀속
      title: '진료 시작',
      doctorName: `${encounter.doctor?.familyName ?? ''}${encounter.doctor?.givenName ?? ''}`,
    });
    if (dxWarnings.length) (encounter as unknown as Record<string, unknown>).diagnosisWarnings = dxWarnings;
    return encounter;
  }

  /**
   * 진료기록 목록.
   *
   * 🔴 `status` 는 종전에 **처리되지 않았다.** 대시보드 '미완료 차트' 위젯이
   *    `?status=DRAFT&mine=true` 를 부르는데 여기서 조용히 무시돼 **남의 진료·서명된 진료까지** 셌다
   *    (2026-08-26 실측). 부르는 쪽이 거는 필터는 여기서 받거나, 받지 못하면 알려야 한다.
   */
  async findAll(filters: { patientId?: string; doctorId?: string; status?: string; page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where: Prisma.EncounterWhereInput = {};
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.doctorId) where.doctorId = filters.doctorId;
    // 🔴 모르는 상태 값은 **무시하지 않고 빈 결과**로 만든다 — 무시하면 "전체"가 되어
    //    미완료만 보려던 화면이 전체를 미완료로 표시한다(종전 결함이 정확히 그것이었다).
    if (filters.status) { assertEnumParam(filters.status, EncounterStatus, '상태'); where.status = filters.status as Prisma.EnumEncounterStatusFilter['equals']; }

    const [data, total] = await Promise.all([
      this.prisma.encounter.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          doctor: { select: { id: true, familyName: true, givenName: true } },
          // 🔴 nameEn 포함 — 진료 이력·과거 진료 기록 화면이 <Term> 으로 그린다. 빠지면 영문 모드에서
          //    name_en 이 100% 채워진 KCD 도 전부 'EN×'(미등록)로 그려진다(2026-09-11 실측 · 상세 fullInclude 는 있었다).
          diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
          // 환자 차트(진료이력 확장 처방목록·수납 처방요약)가 enc.prescriptions 를 소비하나 include 누락으로 항상 비어있던 것을 보강.
          prescriptions: { include: { medicationCode: { select: { nameKo: true, nameEn: true } } } },
        },
      }),
      this.prisma.encounter.count({ where }),
    ]);

    return { data, pagination: { total, page, limit, hasMore: page * limit < total } };
  }

  async findById(id: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id },
      include: this.fullInclude(),
    });
    if (!encounter) throw new NotFoundException('Encounter not found');
    return encounter;
  }

  /**
   * 상세 조회 + 담당의 면허번호 — 처방전(의료법 서식)이 면허번호를 찍는데 User 에는 면허 필드가 없고 Staff 에 있다.
   * 종전엔 늘 '-' 로 인쇄됐다(2026-09-30). 직원 행이 없으면 null(지어내지 않는다).
   */
  async findDetail(id: string) {
    const encounter = await this.findById(id);
    const staff = encounter.doctorId
      ? await this.prisma.staff.findUnique({ where: { userId: encounter.doctorId }, select: { licenseNumber: true } })
      : null;
    return encounter.doctor
      ? { ...encounter, doctor: { ...encounter.doctor, licenseNumber: staff?.licenseNumber ?? null } }
      : encounter;
  }

  async findByPatient(patientId: string) {
    return this.prisma.encounter.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        doctor: { select: { id: true, familyName: true, givenName: true } },
        // nameEn — 목록(findAll)과 같은 모양. 한쪽만 영문명을 내면 같은 진단이 화면마다 다르게 그려진다.
        diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
      },
    });
  }

  async update(id: string, dto: UpdateEncounterDto, userId?: string | null) {
    const existing = await this.prisma.encounter.findUnique({
      where: { id },
      include: { diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
    });
    if (!existing) throw new NotFoundException('Encounter not found');
    // SIGNED 상태에서 수정하면 AMENDED로 전환 — 🔴 직전 서명본을 같은 트랜잭션에 보존한다(종전엔 덮어써 정정 전 내용·원 서명 시각·서명자 소실)
    const amending = existing.status === 'SIGNED';
    const normDiagnoses = this.normalizeDiagnoses(dto.diagnoses);
    // 실제로 바뀐 항목만 — 같은 값을 다시 보내면 정정이 아니다(퇴원요약 B10 과 같은 규칙: 하지 않은 수정을 기록하지 않는다)
    const changed = amending ? encounterChangedFields(existing, dto, normDiagnoses) : [];
    if (amending && changed.length === 0) {
      return this.prisma.encounter.findUnique({ where: { id }, include: this.fullInclude() });
    }

    // 진단 업데이트: 기존 삭제 후 재생성 (트랜잭션으로 atomic 보장) — 주상병 1개 정규화(위에서 계산)
    // 상병 제한 게이트 — BLOCK 모드 위반 시 저장 전 400(config 기본 OFF)
    const dxWarnings = await this.gateDiagnosisRestrictions(existing.patientId, `진료 수정(${id})`, normDiagnoses);
    const result = await this.prisma.$transaction(async (tx) => {
      if (amending) {
        await preserveSignedVersion(tx, {
          patientId: existing.patientId, recordType: 'ENCOUNTER', recordId: id,
          signedAt: existing.signedAt, signedBy: existing.signedBy,
          content: {
            subjective: existing.subjective, objective: existing.objective, assessment: existing.assessment, plan: existing.plan,
            pregnancyStatus: existing.pregnancyStatus,
            ...Object.fromEntries(ENCOUNTER_STRUCTURED_FIELDS.map((f) => [f, (existing as Record<string, unknown>)[f] ?? null])),
            diagnoses: existing.diagnoses.map((d) => ({ code: d.diagnosisCode?.code ?? null, name: d.diagnosisCode?.nameKo ?? null, type: d.type, rank: d.rank, certainty: d.certainty })),
          },
          supersededBy: userId ?? null,
          changedFields: changed,
          reason: dto.amendmentReason ?? null,
        });
      }
      if (dto.diagnoses !== undefined) {
        await tx.encounterDiagnosis.deleteMany({ where: { encounterId: id } });
      }

      return tx.encounter.update({
        where: { id },
        data: {
          ...(dto.subjective !== undefined && { subjective: dto.subjective }),
          ...(dto.objective !== undefined && { objective: dto.objective }),
          ...(dto.assessment !== undefined && { assessment: dto.assessment }),
          ...(dto.plan !== undefined && { plan: dto.plan }),
          ...(dto.pregnancyStatus !== undefined && { pregnancyStatus: dto.pregnancyStatus }),
          // 구조화 문진 — 빈 문자열은 null 로(빈 칸을 값처럼 남기지 않는다)
          ...Object.fromEntries(ENCOUNTER_STRUCTURED_FIELDS.filter((f) => (dto as Record<string, unknown>)[f] !== undefined)
            .map((f) => { const v = (dto as Record<string, unknown>)[f]; return [f, typeof v === 'string' && v.trim() === '' ? null : v]; })),
          ...(amending && { status: 'AMENDED' as EncounterStatus }),
          ...(dto.diagnoses !== undefined && {
            diagnoses: normDiagnoses ? { create: normDiagnoses } : undefined,
          }),
        },
        include: this.fullInclude(),
      });
    });
    // 정정(SIGNED→AMENDED): 서명 완료본 변경 추적 — 이벤트/저니 발행(재서명 필요). 종전 무발행(감사 공백) 보완.
    if (existing.status === 'SIGNED') {
      this.eventEmitter.emit('encounter.amended', { encounterId: id, patientId: existing.patientId });
      this.journey?.emit({
        patientId: existing.patientId, eventType: 'ENCOUNTER_AMENDED', refType: 'ENCOUNTER', refId: id, // 여정 P0-5: 방문 단위 귀속
        title: '진료기록 정정', description: '서명 완료본 정정 — 재서명 필요',
      });
    }
    if (dxWarnings.length) (result as unknown as Record<string, unknown>).diagnosisWarnings = dxWarnings;
    return result;
  }

  async sign(id: string, userId?: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }) {
    const existing = await this.prisma.encounter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Encounter not found');
    // 라: DRAFT 최초서명 + AMENDED 재서명 허용(정정 후 재확정). 이미 SIGNED면 거부(변경 없이 재서명 무의미).
    if (existing.status !== 'DRAFT' && existing.status !== 'AMENDED') {
      throw new BadRequestException('DRAFT 또는 정정(AMENDED) 상태만 서명할 수 있습니다');
    }
    // SOAP 최소 1개 항목 필수
    if (!existing.subjective && !existing.objective && !existing.assessment && !existing.plan) {
      throw new BadRequestException('SOAP 노트를 최소 1개 항목 이상 작성해야 서명할 수 있습니다.');
    }

    // 상병(진단) 필수 게이트 — 서명=청구 트리거인데 상병 없으면 청구 심사 삭감/반려 위험.
    // config `encounter.requireDiagnosisOnSign`: OFF | WARN | BLOCK (기본 WARN·무중단, restrictionEnforce 선례).
    const signWarnings: string[] = [];
    let dxMode: string = 'WARN';
    try { dxMode = gateMode(await this.configRuntime?.get('encounter.requireDiagnosisOnSign'), 'WARN'); } catch { dxMode = 'WARN'; }
    if (dxMode !== 'OFF') {
      const dxCount = await this.prisma.encounterDiagnosis.count({ where: { encounterId: id } });
      if (dxCount === 0) {
        // 🔴 종전엔 WARN 위반이 **어디에도 남지 않아** 승격(WARN→BLOCK) 판단 근거가 없었다.
        //    다른 게이트와 같이 GateViolationLog 에 남긴다(tx 밖 기록 — BLOCK 로 막혀도 보존).
        const msg = `진료 서명 시 상병(진단) 없음 — 청구 심사 삭감·반려 위험 (encounter=${id})`;
        void recordGateViolation(this.prisma, this.logger, {
          gateKey: 'encounter.requireDiagnosisOnSign', severity: dxMode, message: msg, refType: 'ENCOUNTER', refId: id,
        });
        if (dxMode === 'BLOCK') throw new BadRequestException('상병(진단)을 최소 1개 입력해야 서명할 수 있습니다.');
        signWarnings.push('상병(진단)이 입력되지 않았습니다. 청구 심사 삭감·반려 위험이 있어 상병 입력을 권장합니다.');
      }
    }

    /**
     * AI 스크라이브 초안에서 출발한 진료기록: **서명 시점에 1회** 초안 대비 수정량을 잰다
     * (과신 모니터·JCI MOI.11.1.1 · 간호기록 `signNote` 선례와 같은 모양).
     * 🔴 초안 스냅샷이 없으면 **null 로 둔다** — 재지 못한 것을 0(무수정)으로 말하지 않는다.
     * 🔴 조회 실패를 `.catch(() => undefined)` 로 접지 않는다. 실패를 "초안 없음"으로 번역하면
     *    무수정 승인율이 조용히 부풀어 오른다.
     */
    let aiEditDistance: number | undefined;
    if (existing.aiScribed && existing.scribeSessionId && existing.aiEditDistance == null) {
      const session = await this.prisma.scribeSession.findUnique({
        where: { id: existing.scribeSessionId },
        select: { draftSnapshot: true },
      });
      const draft = scribeDraftSoap(session?.draftSnapshot);
      if (draft) {
        const signedText = scribeSignedText(draft.fields, existing as unknown as Record<string, unknown>);
        aiEditDistance = levenshteinCapped(draft.text, signedText);
      }
    }

    const signed = await this.prisma.encounter.update({
      where: { id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        ...(userId && { signedBy: userId }),
        ...(aiEditDistance != null ? { aiEditDistance } : {}),
      },
      include: this.fullInclude(),
    });
    this.journey?.emit({
      patientId: existing.patientId, eventType: 'ENCOUNTER_SIGNED', refType: 'ENCOUNTER', refId: id, // 여정 P0-5: 방문 단위 귀속
      title: '진료 완료 (서명)', description: '차트 서명 완료',
    });
    this.eventEmitter.emit('encounter.signed', {
      encounterId: id,
      patientId: existing.patientId,
    });

    // Blockchain signature (non-blocking)
    if (blockchainSignature && userId) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'ENCOUNTER',
          documentId: id,
          patientId: existing.patientId,
          amended: existing.status === 'AMENDED', // 정정 후 재서명
          signerUserId: userId,
        });
      } catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    return signWarnings.length ? { ...signed, signWarnings } : signed;
  }

  private fullInclude() {
    return {
      patient: { select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true, insuranceType: true } },
      doctor: { select: { id: true, familyName: true, givenName: true, department: true, specialty: true } },
      diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
      prescriptions: {
        include: {
          medicationCode: { select: { code: true, nameKo: true } },
          procedureCode: { select: { code: true, nameKo: true } },
          orders: {
            include: {
              labResult: { include: { items: true } },
              imagingResult: true,
            },
          },
        },
      },
    };
  }

  // ── 진료 첨부(타블렛 펜 스케치·도해) ──
  // ⚠️ PHI: 정적 /uploads(무인증·공개 캐시 30d) 밖의 storage/에 저장하고,
  //   조회는 HMAC 단기 토큰이 붙은 스트리밍 EP로만(<img>는 Authorization 헤더가 없음).
  private static readonly ATT_FNAME_RE = /^att-\d+-\d+\.(png|jpg)$/;

  private attDir(encounterId: string, join: (...p: string[]) => string) {
    return join(process.cwd(), 'storage', 'encounter-attachments', encounterId);
  }

  private attToken(encounterId: string, fname: string, exp: number): string {
    return createHmac('sha256', signingSecret('encounter-attachment'))
      .update(`att:${encounterId}/${fname}:${exp}`)
      .digest('hex')
      .slice(0, 32);
  }

  private attSignedUrl(encounterId: string, fname: string): string {
    const exp = Date.now() + 60 * 60 * 1000; // 1시간 — 목록 재조회 시 재발급
    return `/api/v1/encounters/${encounterId}/attachments/file/${fname}?exp=${exp}&token=${this.attToken(encounterId, fname, exp)}`;
  }

  async addAttachment(encounterId: string, dto: { dataUrl: string; kind?: string; note?: string }, userId: string) {
    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
    if (!enc) throw new NotFoundException('진료기록을 찾을 수 없습니다');
    const m = /^data:(image\/(png|jpeg));base64,(.+)$/.exec(dto.dataUrl ?? '');
    if (!m) throw new BadRequestException('지원하지 않는 형식입니다 (png/jpeg dataURL)');
    const mimeType = m[1];
    const ext = m[2] === 'jpeg' ? 'jpg' : 'png';
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new BadRequestException('파일이 너무 큽니다 (8MB 제한)');
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    const dir = this.attDir(encounterId, join);
    await fs.mkdir(dir, { recursive: true });
    const fname = `att-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    await fs.writeFile(join(dir, fname), buf);
    // DB에는 토큰 없는 정본 경로 저장 — 토큰은 조회 시점에 부착(만료 갱신)
    const url = `/api/v1/encounters/${encounterId}/attachments/file/${fname}`;
    const created = await this.prisma.encounterAttachment.create({
      data: { encounterId, kind: dto.kind ?? 'SKETCH', url, mimeType, note: dto.note ?? null, uploadedBy: userId },
    });
    return { ...created, url: this.attSignedUrl(encounterId, fname) };
  }

  async listAttachments(encounterId: string) {
    const rows = await this.prisma.encounterAttachment.findMany({ where: { encounterId }, orderBy: { createdAt: 'desc' } });
    return rows.map((att) => {
      const fname = att.url.split('/').pop() ?? '';
      return EncounterService.ATT_FNAME_RE.test(fname) ? { ...att, url: this.attSignedUrl(encounterId, fname) } : att;
    });
  }

  /** 첨부 파일 스트리밍 — HMAC 토큰 검증(무가드 EP에서 호출). 파일명 화이트리스트로 traversal 차단 */
  async readAttachmentFile(encounterId: string, fname: string, exp: string, token: string) {
    if (!EncounterService.ATT_FNAME_RE.test(fname)) throw new NotFoundException('첨부를 찾을 수 없습니다');
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Date.now()) throw new NotFoundException('링크가 만료되었습니다. 목록을 새로고침하세요.');
    const expected = this.attToken(encounterId, fname, expNum);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(token ?? ''));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException('첨부를 찾을 수 없습니다');
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    let buf: Buffer;
    try {
      buf = await fs.readFile(join(this.attDir(encounterId, join), fname));
    } catch {
      // 마이그레이션 전 레거시 경로 폴백(uploads/encounters) — 이관 완료 후 제거 가능
      buf = await fs.readFile(join(process.cwd(), 'uploads', 'encounters', encounterId, fname)).catch(() => {
        throw new NotFoundException('첨부 파일이 없습니다');
      });
    }
    return { buf, mimeType: fname.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }

  async removeAttachment(encounterId: string, attId: string) {
    const att = await this.prisma.encounterAttachment.findUnique({ where: { id: attId } });
    if (!att || att.encounterId !== encounterId) throw new NotFoundException('첨부를 찾을 수 없습니다');
    await this.prisma.encounterAttachment.delete({ where: { id: attId } });
    const fname = att.url.split('/').pop()?.split('?')[0] ?? '';
    if (EncounterService.ATT_FNAME_RE.test(fname)) {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      // 신규(storage)·레거시(uploads) 두 경로 모두 정리 시도
      await fs.unlink(join(this.attDir(encounterId, join), fname)).catch(() => undefined);
      await fs.unlink(join(process.cwd(), 'uploads', 'encounters', encounterId, fname)).catch(() => undefined);
    }
    return { success: true };
  }

  /**
   * 데이터 위생 — 버려진 빈 임시저장(DRAFT) 진료기록 정리.
   * 안전조건(전부 충족해야 후보): status=DRAFT · 서술/SOAP/구조화 필드 전부 공백 ·
   * 자식 레코드 10종(진단·처방·청구·문진·문제목록·동의서·원격·협진·검진·첨부) 전무 ·
   * 24시간 이상 미수정(작성 중 진료 보호). 자식이 하나라도 있으면 제외(임상데이터/캐스케이드 보호).
   * 기본 dryRun(=분석만). 실제 삭제는 confirm=true 명시 필요.
   */
  async purgeEmptyDrafts(opts: { dryRun: boolean; cutoffHours?: number }) {
    const cutoffHours = opts.cutoffHours ?? 24;
    const cutoff = new Date(Date.now() - cutoffHours * 3600 * 1000);
    const candidates = await this.prisma.encounter.findMany({
      where: {
        status: 'DRAFT',
        updatedAt: { lt: cutoff },
        // 서술/SOAP/구조화 입력이 전혀 없는 것만
        subjective: null, objective: null, assessment: null, plan: null,
        chiefComplaint: null, historyPresentIllness: null,
        pastMedicalHistory: null, familyHistory: null,
        socialHistory: { equals: Prisma.AnyNull },
        reviewOfSystems: { equals: Prisma.AnyNull },
        physicalExamination: { equals: Prisma.AnyNull },
        // 자식 레코드 10종 전무(하나라도 있으면 임상데이터 → 제외)
        diagnoses: { none: {} },
        prescriptions: { none: {} },
        billing: { is: null },
        formSubmissions: { none: {} },
        problemLists: { none: {} },
        consentForms: { none: {} },
        telehealthSessions: { none: {} },
        consultations: { none: {} },
        checkupVisits: { none: {} },
        attachments: { none: {} },
      },
      select: { id: true, patientId: true, doctorId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    });

    const byPatient: Record<string, number> = {};
    for (const c of candidates) byPatient[c.patientId] = (byPatient[c.patientId] ?? 0) + 1;
    const summary = {
      count: candidates.length,
      patients: Object.keys(byPatient).length,
      cutoffHours,
      topPatients: Object.entries(byPatient).sort((a, b) => b[1] - a[1]).slice(0, 10),
      sampleIds: candidates.slice(0, 20).map((c) => c.id),
    };

    if (opts.dryRun) return { dryRun: true, ...summary };

    const ids = candidates.map((c) => c.id);
    let deleted = 0;
    if (ids.length) {
      const res = await this.prisma.encounter.deleteMany({ where: { id: { in: ids } } });
      deleted = res.count;
      this.eventEmitter.emit('encounter.drafts_purged', { count: deleted, ids, at: new Date().toISOString() });
    }
    return { dryRun: false, deleted, ...summary };
  }
}