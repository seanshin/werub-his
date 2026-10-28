import { EventEmitter2 } from '@nestjs/event-emitter';
import { Injectable, NotFoundException, BadRequestException,
  ConflictException, Optional, Logger } from '@nestjs/common';
import { stayDays, canReadChartClinical, localeTimeText } from '@hospital-run/shared';
import { ConfigService } from '@nestjs/config';
import { normalizePhone } from '../../common/phone';
import { todayRange } from '../../common/day-range';
import { listRowExtras, type StaleDraftScope } from './patient-list-enrich';
import { countSourceRecords, patientLinkedModels, mergePolicyOf, delegateOf, splitUniqueRows } from './patient-merge';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
// 퇴원 게이트 면제 기록 — 사망 자동 퇴원이 게이트를 우회한 사실을 원장에 남긴다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { ONSITE_STATES, kstDayStart, onsitePatientWhere, parseOnsiteStates } from './onsite-filter';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CheckDuplicateDto } from './dto/check-duplicate.dto';
import { MarkDeceasedDto } from './dto/mark-deceased.dto';
import { MergePatientsDto } from './dto/merge-patients.dto';
import { CreateRelationDto } from './dto/create-relation.dto';
import { ImportPatientsDto } from './dto/import-patients.dto';
import { recordGateViolation } from '../../common/gate-enforce';
import {
  PatientNotFoundError,
  DuplicateMrnError,
} from '../../domain/errors/domain-error';
import { maskRrn, decryptNationalIdTolerant, decryptLegacyPid } from '../../common/crypto/legacy-pid-crypto';

/** 대량 반출 상한 — PHI 파일 반출이라 한 번에 나갈 수 있는 양을 명시적으로 묶는다 */
const EXPORT_MAX = 5000;

/** 건보 증번호가 있어야 하는 자격 — 자비·산재·자보는 이 번호가 원래 없다(품질 지표 분모·드릴다운 공용) */
const INSURANCE_NUMBER_TYPES = ['NHI', 'MEDICAID'] as const;
const QUALITY_NO_INSURANCE_NUMBER: Prisma.PatientWhereInput = { insuranceNumber: null, insuranceType: { in: [...INSURANCE_NUMBER_TYPES] } };
/** 1년 이상 미내원 = 등록 1년이 지났고 최근 1년 진료 기록이 없다(등록 1년 미만은 셀 수 없다 · 정의 결정은 사람 몫) */
function qualityDormantWhere(yearAgo: Date): Prisma.PatientWhereInput {
  return { createdAt: { lte: yearAgo }, encounters: { none: { createdAt: { gte: yearAgo } } } };
}

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // 사망 자동 퇴원이 퇴원 게이트를 면제로 통과한 사실을 남긴다(미주입=무기록·무중단)
    @Optional() private readonly gates?: SafetyGateService,
    /** 두 원장 활력 읽기 정본(2026-10-10) — 미주입(단위 테스트)이면 같은 prisma 로 구성 */
    @Optional() private readonly admissionVitalsInjected?: AdmissionVitalsReader,
    /** 사망 처리 사실을 구독자에게(2026-10-10 — 단말 연결 자동 해제) · 미주입이면 내지 않는다 */
    @Optional() private readonly events?: EventEmitter2,
  ) {
    const keyHex = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.encryptionKey = Buffer.from(keyHex, 'hex');
  }

  private _admissionVitalsFallback?: AdmissionVitalsReader;
  private get admissionVitals(): AdmissionVitalsReader {
    return this.admissionVitalsInjected ?? (this._admissionVitalsFallback ??= new AdmissionVitalsReader(this.prisma));
  }

  // ── Create ──

  async create(dto: CreatePatientDto, userId: string) {
    const mrn = await this.generateMrn();
    const encryptedInsurance = dto.insuranceNumber
      ? this.encrypt(dto.insuranceNumber)
      : null;
    const encryptedNationalId = dto.nationalId
      ? this.encrypt(dto.nationalId)
      : null;

    const contactsData = dto.contacts?.map((c) => ({
      name: c.name,
      relationship: c.relationship,
      relationshipDetail: c.relationshipDetail,
      phone: c.phone,
      phone2: c.phone2,
      isEmergencyContact: c.isEmergencyContact ?? false,
      isLegalGuardian: c.isLegalGuardian ?? false,
      isPrimaryContact: c.isPrimaryContact ?? false,
      priority: c.priority ?? 1,
      notes: c.notes,
    }));

    // 🔴 (2026-09-16 J1) 종전엔 환자 생성이 단독 커밋되고 동의 기록이 뒤따랐다. 사이에 실패하면
    //    **개인정보 수집·민감정보 동의 기록이 없는 환자**가 남는다(개인정보보호법 동의 이력).
    //    게다가 이 경로엔 멱등키가 없어 재시도는 **MRN 이 다른 중복 환자**를 만든다 — 둘 다 나쁜 쪽이다.
    //    환자와 동의 기록을 한 트랜잭션에.
    const patient = await this.prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: {
        mrn,
        familyName: dto.familyName,
        givenName: dto.givenName,
        dateOfBirth: new Date(dto.dateOfBirth),
        gender: dto.gender,
        insuranceType: dto.insuranceType ?? 'NHI',
        insuranceNumber: encryptedInsurance,
        phone: dto.phone,
        phoneNormalized: normalizePhone(dto.phone),
        email: dto.email,
        address: dto.address ? (dto.address as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        bloodType: dto.bloodType,
        allergies: dto.allergies ?? [],
        // Extended fields
        nationalId: encryptedNationalId,
        nationalIdHash: dto.nationalId ? this.hashNationalId(dto.nationalId) : null,
        nationalIdType: dto.nationalIdType ?? (dto.nationalId ? 'RESIDENT' : undefined),
        nationality: dto.nationality,
        preferredLanguage: dto.preferredLanguage,
        maritalStatus: dto.maritalStatus,
        occupation: dto.occupation,
        smokingStatus: dto.smokingStatus,
        religion: dto.religion,
        memo: dto.memo,
        tags: dto.tags ?? [],
        // Contacts
        ...(contactsData?.length ? { contacts: { create: contactsData } } : {}),
        createdBy: userId,
        updatedBy: userId,
      },
      include: contactsData?.length ? { contacts: true } : undefined,
    });

    /**
     * 🔴 (2026-10-02) 접수 화면의 동의 체크박스 — 종전엔 이것으로 동의서(ConsentForm)를 **"환자 이름으로 서명됨·지금·유효"**로
     *    만들었다. 환자는 서명한 적이 없다(직원이 체크했을 뿐). 또 10종 중 3종만 남았다.
     *    → 등록 동의 원장(10종)에 **직원 입력(signMethod HIS — 환자 서명 증빙 없음)**으로만 남긴다 · 서명자 없음 · 증빙 연결 없음.
     *    환자 서명은 초진 동의 수집(태블릿·휴대폰·종이 스캔 — registration-consents/collect)이 받는다.
     */
    if (dto.consents) {
      const map: Array<[string, boolean | undefined]> = [
        ['PRIVACY', dto.consents.privacy], ['SENSITIVE', dto.consents.sensitive], ['UNIQUE_ID', dto.consents.uniqueId],
        ['THIRD_PARTY', dto.consents.thirdParty], ['TREATMENT', dto.consents.treatment], ['HIE', dto.consents.hie],
        ['MARKETING', dto.consents.marketing], ['RESEARCH', dto.consents.research], ['EMR_VIEW', dto.consents.emrView],
        ['TELEHEALTH', dto.consents.telehealth],
      ];
      const rows = map.filter(([, v]) => typeof v === 'boolean').map(([type, agreed]) => ({
        patientId: created.id, type, version: '1.0', agreed: agreed as boolean,
        signedAt: null, signedBy: null, signMethod: 'HIS', collectedBy: userId ?? null,
      }));
      if (rows.length) await tx.registrationConsent.createMany({ data: rows, skipDuplicates: true });
    }

    return created;
    });

    return patient;
  }

  // ── Read ──

  /**
   * @param opts.phoneSearch 검색어로 전화번호를 찾을지 — 🔴 연락처를 원문으로 받지 못하는 열람자는 false
   *   (가려진 번호로도 "이 번호의 환자가 있다"가 드러난다 · 컨트롤러가 목록 능력표로 정한다 · 기본 true = 반출 등 내부 호출)
   */
  async findAll(query: PatientQueryDto & { cursor?: string }, opts: { phoneSearch?: boolean; allergy?: boolean; userId?: string; staleDrafts?: 'MINE' | 'ALL' | null } = {}) {
    const where = await this.buildWhere(query, opts.phoneSearch ?? true, opts.userId);
    const limit = query.limit ?? 20;

    const orderBy = this.listOrderBy(query);
    // 오래된 작성 중 기록 — 의사 본인 것만(열람자를 모르면 칸을 내지 않는다) · 관리자는 전부
    const stale: StaleDraftScope = opts.staleDrafts === 'ALL' ? { mode: 'ALL' } : opts.staleDrafts === 'MINE' && opts.userId ? { mode: 'MINE', userId: opts.userId } : null;

    // 커서 기반 페이지네이션 (대용량 최적화)
    if (query.cursor) {
      const data = await this.prisma.patient.findMany({
        where,
        take: limit + 1,
        cursor: { id: query.cursor },
        skip: 1, // 커서 자체는 건너뜀
        orderBy,
        select: this.listSelect(),
      });

      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return {
        data: await this.withListExtras(await this.withEncounterCounts(items.map((d) => this.mapListItem(d as Record<string, unknown>))), opts.allergy === true, stale),
        pagination: { limit, hasMore, nextCursor, mode: 'cursor' as const },
      };
    }

    // 기존 offset 기반 페이지네이션
    const page = query.page ?? 1;
    const [data, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        select: this.listSelect(),
      }),
      this.prisma.patient.count({ where }),
    ]);

    return {
      data: await this.withListExtras(await this.withEncounterCounts(data.map((d) => this.mapListItem(d as Record<string, unknown>))), opts.allergy === true, stale),
      pagination: { total, page, limit, hasMore: page * limit < total },
    };
  }

  /**
   * CSV 등 **대량 반출** 전용 조회 — 관리자만 호출한다(컨트롤러 @Roles).
   * 목록 EP 는 limit 상한이 100 이라 반출에 쓸 수 없다(=쓰면 400). 반출은 경로를 분리해
   * 상한·감사를 따로 건다: PHI 가 파일로 병원 밖에 나가는 유일한 지점이기 때문이다.
   */
  async exportList(query: PatientQueryDto, max = EXPORT_MAX) {
    const where = await this.buildWhere(query);
    const take = Math.min(max, EXPORT_MAX);
    const rows = await this.prisma.patient.findMany({
      where,
      take: take + 1, // 상한 초과 여부 판별용 1건 더
      orderBy: this.listOrderBy(query),
      select: this.listSelect(),
    });
    const truncated = rows.length > take;
    return {
      data: rows.slice(0, take).map((d) => this.mapListItem(d as Record<string, unknown>)),
      count: Math.min(rows.length, take),
      truncated, // 상한에서 잘렸으면 화면이 그 사실을 알린다(조용히 일부만 내보내지 않게)
      max: take,
    };
  }

  /**
   * 원내 상태별 환자 수 — 필터 칩에 실제 건수를 붙이기 위한 집계.
   * 상태마다 **환자 distinct** 로 센다(같은 환자의 대기 2건이 2로 세지지 않게).
   */
  async onsiteSummary() {
    const from = kstDayStart();
    const counts: Record<string, number> = {};

    for (const st of ONSITE_STATES) {
      if (st.source === 'admission') {
        counts[st.key] = (await this.prisma.admission.findMany({
          where: { status: 'ADMITTED' }, distinct: ['patientId'], select: { patientId: true },
        })).length;
      } else if (st.source === 'queue') {
        // '오늘 접수' 판정은 checkedInAt(onsite-filter 와 동일 정본)
        // 🔴 상한(now)을 함께 둔다 — 아직 오지 않은 예약을 '지금 대기'로 세지 않는다
        counts[st.key] = (await this.prisma.waitingQueue.findMany({
          where: { status: st.queueStatus, checkedInAt: { gte: from, lte: new Date() } },
          distinct: ['patientId'], select: { patientId: true },
        })).length;
      } else if (st.source === 'encounter') {
        counts[st.key] = (await this.prisma.encounter.findMany({
          where: { status: 'DRAFT', createdAt: { gte: from } }, distinct: ['patientId'], select: { patientId: true },
        })).length;
      } else {
        // 예약 — 오늘(KST) 하루치·아직 도착 전(SCHEDULED|CONFIRMED)
        counts[st.key] = (await this.prisma.appointment.findMany({
          where: { status: { in: ['SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) } },
          distinct: ['patientId'], select: { patientId: true },
        })).length;
      }
    }

    // 전체 원내(합집합) — 상태 합계와 다르다(한 환자가 여러 상태일 수 있음)
    const total = await this.prisma.patient.count({ where: onsitePatientWhere() as Prisma.PatientWhereInput });
    return {
      total,
      counts,
      states: ONSITE_STATES.map((s) => ({ key: s.key, label: s.label, hint: s.hint, inAll: s.inAll, count: counts[s.key] ?? 0 })),
      asOf: new Date().toISOString(),
    };
  }

  async findById(id: string) {
    // 방어: UUID가 아니면(예: MRN P2026-… 전달) 500 대신 MRN으로 조회 → 정상/404
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const patient = await this.prisma.patient.findUnique({
      where: isUuid ? { id } : { mrn: id },
      include: { contacts: true },
    });

    if (!patient) throw new PatientNotFoundError(id);

    // Decrypt insurance number for response
    if (patient.insuranceNumber) {
      (patient as typeof patient & { insuranceNumber: string }).insuranceNumber = this.decrypt(patient.insuranceNumber);
    }

    // Decrypt and mask national ID
    if (patient.nationalId) {
      // 🔴 혼재 컬럼(원시/파생) 관용 복호 — 파생 키로 쓴 값(NICE·포털)을 this.decrypt(원시)로 풀면 500.
      //    통일 후 신규는 전부 원시 키지만 마이그레이션 전 기존값도 읽어야 한다.
      (patient as typeof patient & { nationalId: string }).nationalId = maskRrn(
        decryptNationalIdTolerant(patient.nationalId),
      );
    }

    // 여권·외국인등록번호 복호(평문 레거시 통과) — 암호화 컬럼이라 원값을 그대로 실으면 ciphertext
    if (patient.passportNumber) {
      (patient as typeof patient & { passportNumber: string }).passportNumber = decryptLegacyPid(patient.passportNumber);
    }
    if (patient.alienRegistrationNo) {
      (patient as typeof patient & { alienRegistrationNo: string }).alienRegistrationNo = decryptLegacyPid(patient.alienRegistrationNo);
    }

    return patient;
  }

  // ── Summary ──

  /**
   * 환자 통합 요약.
   *
   * 🔴 2026-08-27 사람 결정 — **환자 차트는 의무기록·의료차트다. 관련 권한을 가진 역할만 본다.**
   *    종전에는 `@RequirePermission(PATIENT_VIEW)` 하나로 지켜졌는데, 그 권한을 가진 원무·검진·검사 직군이
   *    **세부 EP 로는 403 을 받으면서 이 집계 EP 로는 알레르기·문제목록·투약·활력을 그대로 받았다**
   *    (세부 EP 가 막는 것을 집계 EP 가 주고 있었다).
   *
   * 🔴 임상 필드를 **빈 배열로 깎지 않는다** — 빈 목록은 "없음"으로 읽힌다.
   *    키를 **빼고** `restricted` 에 무엇을 뺐는지 적는다(화면이 "권한 없음"이라 말할 수 있게).
   */
  async getSummary(patientId: string, role?: string | null) {
    const [
      patient, vitals, activeRx, orderCount, problems, recentEncounters,
      upcomingAppts, surgeries, admissions, allergies, activeMedications,
    ] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: {
          id: true, mrn: true, familyName: true, givenName: true,
          gender: true, dateOfBirth: true, insuranceType: true, bloodType: true,
        },
      }),
      // 두 원장(외래 + 입원) 최신 1건(2026-10-10)
      this.admissionVitals.recentForPatient(patientId, 1).then((r) => r[0] ?? null),
      this.prisma.prescription.count({ where: { status: 'ACTIVE', encounter: { patientId } } }),
      this.prisma.order.count({ where: { prescription: { encounter: { patientId } } } }),
      this.prisma.problemList.findMany({ where: { patientId, status: 'ACTIVE' }, take: 10 }),
      this.prisma.encounter.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { doctor: { select: { familyName: true, givenName: true, department: true } } },
      }),
      this.prisma.appointment.findMany({
        where: { patientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      }),
      this.prisma.surgery.count({ where: { patientId } }),
      this.prisma.admission.count({ where: { patientId } }),
      this.prisma.allergy.findMany({ where: { patientId }, take: 10 }),
      // 🔴 활성 투약 목록 — 원격진료 약사/간호 패널·환자정보 패널이 summary.activeMedications 를
      //    읽는데 목록이 없어(카운트만) "처방 없음"·"투약 내역 없음"으로 영구 공집합이었다(2026-08-13 W3).
      this.prisma.prescription.findMany({
        where: { status: 'ACTIVE', type: 'MEDICATION', encounter: { patientId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, dosage: true, frequency: true, route: true, duration: true, createdAt: true,
          medicationCode: { select: { code: true, nameKo: true } },
        },
      }),
    ]);

    if (!patient) throw new PatientNotFoundError(patientId);

    const clinicalAllowed = canReadChartClinical(role);
    const clinical = {
      latestVitals: vitals,
      activeMedications: activeMedications.map((rx) => ({
        id: rx.id,
        nameKo: rx.medicationCode?.nameKo ?? null,
        code: rx.medicationCode?.code ?? null,
        dosage: rx.dosage, frequency: rx.frequency, route: rx.route, duration: rx.duration,
        prescribedAt: rx.createdAt,
      })),
      problems,
      allergies,
    };
    const RESTRICTED_KEYS = ['latestVitals', 'activeMedications', 'problems', 'allergies'] as const;
    return {
      patient,
      activeRxCount: activeRx,
      ...(clinicalAllowed ? clinical : {}),
      // 🔴 뺐다는 사실을 말한다 — 없는 것과 못 보는 것은 다른 사실이다.
      ...(clinicalAllowed ? {} : { restricted: [...RESTRICTED_KEYS] }),
      orderCount,
      recentEncounters,
      upcomingAppointments: upcomingAppts,
      flags: {
        hasSurgeries: surgeries > 0,
        hasAdmissions: admissions > 0,
        hasVitals: !!vitals,
        hasAllergies: allergies.length > 0,
        hasProblems: problems.length > 0,
      },
    };
  }

  // ── Update (bi-temporal) ──

  async update(id: string, dto: UpdatePatientDto, userId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. 현재 유효한 레코드 조회
      const current = await tx.patient.findFirst({
        where: { id, validTo: null },
      });
      if (!current) throw new PatientNotFoundError(id);

      // 2. 현재 상태를 history에 스냅샷 저장
      await tx.patientHistory.create({
        data: {
          patientId: id,
          data: {
            ...(current as unknown as Record<string, unknown>),
            ...(reason ? { _changeReason: reason } : {}),
          } as unknown as Prisma.InputJsonValue,
          validFrom: current.validFrom,
          validTo: new Date(),
          changedBy: userId,
        },
      });

      // 3. 현재 레코드 업데이트 + validFrom 리셋
      const encryptedInsurance =
        dto.insuranceNumber !== undefined
          ? dto.insuranceNumber
            ? this.encrypt(dto.insuranceNumber)
            : null
          : undefined;

      const encryptedNationalId =
        dto.nationalId !== undefined
          ? dto.nationalId
            ? this.encrypt(dto.nationalId)
            : null
          : undefined;

      const updateData: Prisma.PatientUpdateInput = {
        ...(dto.familyName !== undefined && { familyName: dto.familyName }),
        ...(dto.givenName !== undefined && { givenName: dto.givenName }),
        ...(dto.dateOfBirth !== undefined && { dateOfBirth: new Date(dto.dateOfBirth) }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.insuranceType !== undefined && { insuranceType: dto.insuranceType }),
        ...(encryptedInsurance !== undefined && { insuranceNumber: encryptedInsurance }),
        ...(dto.phone !== undefined && { phone: dto.phone, phoneNormalized: normalizePhone(dto.phone) }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address as unknown as Prisma.InputJsonValue }),
        ...(dto.bloodType !== undefined && { bloodType: dto.bloodType }),
        ...(dto.allergies !== undefined && { allergies: dto.allergies }),
        // Extended fields
        ...(encryptedNationalId !== undefined && { nationalId: encryptedNationalId }),
        ...(dto.nationalId !== undefined && { nationalIdHash: dto.nationalId ? this.hashNationalId(dto.nationalId) : null }),
        ...(dto.nationalIdType !== undefined && { nationalIdType: dto.nationalIdType }),
        ...(dto.nationality !== undefined && { nationality: dto.nationality }),
        ...(dto.preferredLanguage !== undefined && { preferredLanguage: dto.preferredLanguage }),
        ...(dto.maritalStatus !== undefined && { maritalStatus: dto.maritalStatus }),
        ...(dto.occupation !== undefined && { occupation: dto.occupation }),
        ...(dto.smokingStatus !== undefined && { smokingStatus: dto.smokingStatus }),
        ...(dto.religion !== undefined && { religion: dto.religion }),
        ...(dto.memo !== undefined && { memo: dto.memo }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        validFrom: new Date(),
        updater: { connect: { id: userId } },
      };

      return tx.patient.update({
        where: { id },
        data: updateData,
      });
    });
  }

  // ── Soft Delete ──

  async softDelete(id: string, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient) throw new PatientNotFoundError(id);

    return this.prisma.patient.update({
      where: { id },
      data: { validTo: new Date(), updatedBy: userId },
    });
  }

  // ── History ──

  async getHistory(id: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient) throw new PatientNotFoundError(id);

    // 이력은 갱신마다 성장 — 최근 500건 상한 (2026-07 전체검토 D-2)
    return this.prisma.patientHistory.findMany({
      where: { patientId: id },
      orderBy: { txTime: 'desc' },
      take: 500,
    });
  }

  // ── Contacts CRUD ──

  async getContacts(patientId: string) {
    await this.ensurePatientExists(patientId);

    return this.prisma.patientContact.findMany({
      where: { patientId },
      orderBy: { priority: 'asc' },
    });
  }

  async createContact(patientId: string, dto: CreateContactDto) {
    await this.ensurePatientExists(patientId);

    return this.prisma.patientContact.create({
      data: {
        patientId,
        name: dto.name,
        relationship: dto.relationship,
        relationshipDetail: dto.relationshipDetail,
        phone: dto.phone,
        phone2: dto.phone2,
        isEmergencyContact: dto.isEmergencyContact ?? false,
        isLegalGuardian: dto.isLegalGuardian ?? false,
        isPrimaryContact: dto.isPrimaryContact ?? false,
        priority: dto.priority ?? 1,
        notes: dto.notes,
      },
    });
  }

  async updateContact(patientId: string, contactId: string, dto: UpdateContactDto) {
    await this.ensurePatientExists(patientId);

    const contact = await this.prisma.patientContact.findFirst({
      where: { id: contactId, patientId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} not found for patient ${patientId}`);
    }

    return this.prisma.patientContact.update({
      where: { id: contactId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.relationship !== undefined && { relationship: dto.relationship }),
        ...(dto.relationshipDetail !== undefined && { relationshipDetail: dto.relationshipDetail }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.phone2 !== undefined && { phone2: dto.phone2 }),
        ...(dto.isEmergencyContact !== undefined && { isEmergencyContact: dto.isEmergencyContact }),
        ...(dto.isLegalGuardian !== undefined && { isLegalGuardian: dto.isLegalGuardian }),
        ...(dto.isPrimaryContact !== undefined && { isPrimaryContact: dto.isPrimaryContact }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async deleteContact(patientId: string, contactId: string) {
    await this.ensurePatientExists(patientId);

    const contact = await this.prisma.patientContact.findFirst({
      where: { id: contactId, patientId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} not found for patient ${patientId}`);
    }

    await this.prisma.patientContact.delete({ where: { id: contactId } });
  }

  // ── Duplicate Check ──

  async checkDuplicate(dto: CheckDuplicateDto) {
    const conditions: Prisma.PatientWhereInput[] = [{ validTo: null }];
    let maxScore = 0;

    // Build OR conditions for matching
    const orConditions: Prisma.PatientWhereInput[] = [];

    if (dto.familyName && dto.givenName) {
      orConditions.push({
        AND: [
          { familyName: dto.familyName },
          { givenName: dto.givenName },
        ],
      });
      maxScore += 30;
    }

    if (dto.dateOfBirth) {
      orConditions.push({ dateOfBirth: new Date(dto.dateOfBirth) });
      maxScore += 20;
    }

    // 🔴 A1: 정규화 전화로 정확 매칭(표기차 흡수) — 정규화 불가 시 원문 대체
    const dupPhoneNorm = normalizePhone(dto.phone);
    if (dto.phone) {
      orConditions.push(dupPhoneNorm ? { phoneNormalized: dupPhoneNorm } : { phone: dto.phone });
      maxScore += 25;
    }

    if (dto.nationalId) {
      // Encrypt to compare with stored values
      // We need to search all patients and decrypt for comparison
      maxScore += 50;
    }

    if (orConditions.length === 0 && !dto.nationalId) {
      return { score: 0, matches: [] };
    }

    // Get potential matches from DB
    const candidates = orConditions.length > 0
      ? await this.prisma.patient.findMany({
          where: {
            AND: [
              { validTo: null },
              { OR: orConditions },
            ],
          },
          take: 20,
          select: {
            id: true,
            mrn: true,
            familyName: true,
            givenName: true,
            dateOfBirth: true,
            gender: true,
            phone: true,
            phoneNormalized: true,
            nationalId: true,
            nationalIdHash: true,
            createdAt: true,
          },
        })
      : [];

    // Score each candidate
    const scoredMatches = candidates.map((candidate) => {
      let score = 0;

      if (dto.familyName && dto.givenName) {
        if (candidate.familyName === dto.familyName && candidate.givenName === dto.givenName) {
          score += 30;
        }
      }

      if (dto.dateOfBirth) {
        const dob = new Date(dto.dateOfBirth);
        if (candidate.dateOfBirth.getTime() === dob.getTime()) {
          score += 20;
        }
      }

      // 🔴 A1: 정규화 전화 우선 비교(표기차) — 정규화 불가 시 원문
      const phoneHit = dupPhoneNorm
        ? candidate.phoneNormalized === dupPhoneNorm
        : !!dto.phone && candidate.phone === dto.phone;
      if (phoneHit) {
        score += 25;
      }

      if (dto.nationalId && candidate.nationalIdHash) {
        // 블라인드 인덱스(HMAC) 비교 — 복호화 불필요
        if (candidate.nationalIdHash === this.hashNationalId(dto.nationalId)) {
          score += 50;
        }
      }

      // Remove nationalId from response
      const { nationalId, nationalIdHash, ...rest } = candidate;
      return { ...rest, score };
    });

    // Filter and sort by score descending
    const matches = scoredMatches
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);

    const topScore = matches.length > 0 ? matches[0].score : 0;

    return {
      score: maxScore > 0 ? Math.round((topScore / maxScore) * 100) : 0,
      matches,
    };
  }

  // ── Mark Deceased ──

  async markDeceased(patientId: string, dto: MarkDeceasedDto, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new PatientNotFoundError(patientId);

    // Save history snapshot
    // 사망 처리는 부분 성공이 성립하지 않는다 — 사망으로 표시됐는데 처방·예약·입원·대기가
    // 살아 있으면 사망 환자에게 진료가 계속 배정된다. 한 트랜잭션으로 묶는다.
    // (2026-07 트랜잭션 경계 전수)
    const { updated, deceasedInfo, actions } = await this.prisma.$transaction(async (tx) => {
      await tx.patientHistory.create({
        data: {
          patientId,
          data: {
            ...(patient as unknown as Record<string, unknown>),
            _changeReason: '사망 처리',
          } as unknown as Prisma.InputJsonValue,
          validFrom: patient.validFrom,
          validTo: new Date(),
          changedBy: userId,
        },
      });

      const deceasedInfo = {
        location: dto.deathLocation ?? 'HOSPITAL',
        deathType: dto.deathType ?? 'NATURAL',
        causeChain: dto.causeChain ?? { a: dto.deathCause ?? '' },
        confirmedBy: userId,
        confirmedAt: new Date().toISOString(),
      };

      const updated = await tx.patient.update({
        where: { id: patientId },
        data: {
          isDeceased: true,
          deathDate: new Date(dto.deathDate),
          deathCause: dto.causeChain?.a ?? dto.deathCause,
          // 🔴 종전에는 아래 값들이 `deceasedInfo` 로 조립돼 **응답에만 실리고 저장되지 않았다**
          //    (2026-08-26 실측). 화면은 사망장소·사망종류·사인 (나)(다)(라)를 입력받는데
          //    다음 조회에서 전부 사라졌다 — 사망진단서는 법정 서식이다.
          deathLocation: deceasedInfo.location,
          deathType: deceasedInfo.deathType,
          deathCauseChain: deceasedInfo.causeChain as unknown as Prisma.InputJsonValue,
          deathConfirmedBy: userId,
          deathConfirmedAt: new Date(deceasedInfo.confirmedAt),
          validFrom: new Date(),
          updatedBy: userId,
        },
      });

      // ── 후속 처리 (비동기, 실패해도 사망 처리는 완료) ──
      const actions: string[] = [];

      // 1. 진행 중 처방 전체 중단
      if (dto.stopPrescriptions !== false) {
        /**
         * 🔴 **취소 스탬프를 함께 찍는다**(2026-09-03 가드가 잡음).
         *    `order-sign-entry.ts` 는 시각 없는 취소의 로그를 만들지 않는다(추정 금지) —
         *    스탬프를 빠뜨리면 **사망으로 중단된 처방이 CPOE 서명 로그에서 통째로 사라진다.**
         *    사망 처리는 법적 성격이 가장 강한 자리라 더더욱 남아야 한다.
         *    행위자(`cancelledById`)는 사망을 등록한 사람이다 — 시스템이 지어내지 않는다.
         */
        const stopped = await tx.order.updateMany({
          where: {
            prescription: { encounter: { patientId } },
            status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] },
          },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId ?? null, notes: '환자 사망으로 자동 중단' },
        });
        actions.push(`처방 ${stopped.count}건 중단`);
      }

      // 2. 예약 일괄 취소
      if (dto.cancelAppointments !== false) {
        const cancelled = await tx.appointment.updateMany({
          where: { patientId, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          data: { status: 'CANCELLED' },
        });
        actions.push(`예약 ${cancelled.count}건 취소`);
      }

      // 3. 입원 중이면 퇴원 처리
      /**
       * 🔴 이 경로는 `InpatientService.discharge()` 를 거치지 않는다(2026-08-26 A4 실측).
       *    그래서 `inpatient.dischargeGate`(퇴원요약 서명·미납 잔액)가 **평가되지 않는다.**
       *
       *    🔴 그것을 막지 않는다. 사망 퇴원을 수납·서명으로 막으면 현장이 멈추고,
       *    유족을 세워둔 채 정산을 요구하게 된다. 사망은 **정당한 면제**다.
       *    다만 종전엔 그 면제가 **어디에도 적혀 있지 않았고**(`TRANSFER` 면제와 달리)
       *    아무 흔적도 남지 않아, 관제의 "퇴원 게이트 위반 0건"이 '준수'인지
       *    '이 경로로 빠져나간 건'인지 구분할 방법이 없었다.
       *    → 면제 사유를 정본(`InpatientService.discharge` 의 `GATE_EXEMPT_DISPOSITIONS`)에 등재하고,
       *      여기서는 **면제로 통과한 사실을 원장에 남긴다**(severity=`EXEMPT` — 위반으로 세지 않는다).
       */
      if (dto.dischargeIfAdmitted !== false) {
        const admitted = await tx.admission.findMany({ where: { patientId, status: 'ADMITTED' }, select: { id: true } });
        const discharged = await tx.admission.updateMany({
          where: { patientId, status: 'ADMITTED' },
          data: { status: 'DISCHARGED', dischargeDate: new Date() },
        });
        if (discharged.count > 0) {
          actions.push(`입원 ${discharged.count}건 퇴원`);
          for (const a of admitted) {
            // 원장 기록은 트랜잭션 밖 클라이언트(this.prisma)로 — best-effort. 실패해도 사망 처리는 진행된다.
            await recordGateViolation({ gateKey: 'inpatient.dischargeGate', recorder: this.gates, logger: this.logger, refType: 'Admission', refId: a.id }, 'EXEMPT', '퇴원 게이트 면제(DECEASED) — 사망 처리에 의한 자동 퇴원(요약 서명·미납 잔액 미평가). 사후 정산·기록 완결 필요');
          }
          actions.push('퇴원 게이트는 사망 면제로 평가되지 않았습니다 — 퇴원요약 서명·정산 잔액을 사후 확인하세요');
        }
      }

      // 4. 대기열 취소
      await tx.waitingQueue.updateMany({
        where: { patientId, status: { in: ['WAITING', 'CALLED'] } },
        data: { status: 'CANCELLED' },
      });
      return { updated, deceasedInfo, actions };
    });
    // 트랜잭션이 끝난 뒤에만 낸다(롤백된 사망을 구독자가 보지 않게)
    this.events?.emit('patient.deceased', { patientId, userId });

    return { ...updated, deceasedInfo, actions };
  }

  // ── Photo Upload ──

  async uploadPhoto(patientId: string, file: { originalname: string; path: string }) {
    await this.ensurePatientExists(patientId);

    const ext = path.extname(file.originalname).toLowerCase();
    const targetDir = path.join(process.cwd(), 'uploads', 'patients', patientId);
    const targetPath = path.join(targetDir, `photo${ext}`);

    // Ensure directory exists
    fs.mkdirSync(targetDir, { recursive: true });

    // Move file from temp to target
    fs.copyFileSync(file.path, targetPath);
    fs.unlinkSync(file.path);

    const photoUrl = `/uploads/patients/${patientId}/photo${ext}`;

    await this.prisma.patient.update({
      where: { id: patientId },
      data: { photoUrl },
    });

    return { photoUrl };
  }

  // ── Merge Patients ──

  /**
   * 병합 미리보기(2026-10-20 P2) — 두 환자 나란히 · 원 환자 기록 중 옮겨지는 것/남는 것(모델별 건수) · 되돌리기 경로 없음.
   * 🔴 병합은 190 모델 중 6개만 옮긴다(`patient-merge.ts`) — 남는 것을 세어 말한다.
   */
  async mergePreview(sourceId: string, targetId: string) {
    const [source, target] = await this.assertMergeable(this.prisma, sourceId, targetId);
    const records = await countSourceRecords(this.prisma, sourceId, targetId);
    return { source, target, records, reversible: false as const };
  }

  /** 병합할 수 있는 두 환자인지 — 같은 환자·없는 환자·이미 병합되었거나 비활성인 기록은 거부 */
  private async assertMergeable(db: Pick<PrismaService, 'patient'> | Prisma.TransactionClient, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException('Source and target patients cannot be the same');
    const select = { id: true, mrn: true, familyName: true, givenName: true, koreanName: true, dateOfBirth: true, gender: true, insuranceType: true, createdAt: true, validTo: true, mergedIntoId: true, isActive: true, isDeceased: true } as const;
    const [source, target] = await Promise.all([
      db.patient.findUnique({ where: { id: sourceId }, select }),
      db.patient.findUnique({ where: { id: targetId }, select }),
    ]);
    if (!source) throw new PatientNotFoundError(sourceId);
    if (!target) throw new PatientNotFoundError(targetId);
    // 🔴 종전엔 이미 병합된(비활성) 기록도 받아 — 대상이면 옮긴 기록이 보이지 않는 기록 밑으로 갔다
    for (const [role, p] of [['source', source], ['target', target]] as const) {
      if (p.validTo || p.mergedIntoId) {
        throw new ConflictException({ code: 'MERGE_PATIENT_INACTIVE', message: role === 'source' ? '원 환자가 이미 병합되었거나 비활성인 기록입니다' : '대상 환자가 이미 병합되었거나 비활성인 기록입니다', details: { role, patientId: p.id, mergedIntoId: p.mergedIntoId } });
      }
    }
    return [source, target] as const;
  }

  async mergePatients(dto: MergePatientsDto, userId: string) {
    const { sourceId, targetId, reason } = dto;
    await this.assertMergeable(this.prisma, sourceId, targetId);

    // 🔴 활성 법적 보존명령이 있으면 병합하지 않는다 — 옮긴 기록이 보존 범위 밖으로 빠진다
    const records = await countSourceRecords(this.prisma, sourceId, targetId);
    if (records.blocking.length > 0) {
      throw new ConflictException({
        code: 'MERGE_BLOCKED_LEGAL_HOLD',
        message: '원 환자에 활성 법적 보존명령이 있어 병합할 수 없습니다 — 보존명령 해제 후 다시 요청하세요',
        details: { blocking: records.blocking },
      });
    }
    // 🔴 남는 기록이 있으면 사람이 확인해야 병합한다 — 확인한 내용(모델별 건수)을 병합 이력에 남긴다
    if ((records.unmovedTotal > 0 || records.uncounted.length > 0) && dto.acknowledgeUnmoved !== true) {
      throw new ConflictException({
        code: 'MERGE_UNMOVED_RECORDS',
        message: '원 환자에 옮겨지지 않는 기록이 있습니다 — 확인 후 다시 요청하세요',
        details: { unmoved: records.unmoved, uncounted: records.uncounted, unmovedTotal: records.unmovedTotal },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const [source] = await this.assertMergeable(tx, sourceId, targetId);
      const sourceRow = await tx.patient.findUnique({ where: { id: sourceId }, select: { validFrom: true } });

      // 이관 전 source encounter id 캡처 — 병합 후 그 오더의 updated_at bump에 사용(LIS 재전파)
      const movedEncounters = await tx.encounter.findMany({ where: { patientId: sourceId }, select: { id: true } });

      // 🔴 정책 등록부대로 옮긴다(`patient-merge.ts`) — 종전엔 6개 모델만 옮겼다(190 중)
      //    MOVE = 전부 · UNIQUE = 대상에 같은 키가 없는 행만 · STAY·MANUAL·BLOCK = 손대지 않는다
      type Mover = { updateMany: (a: { where: Record<string, unknown>; data: { patientId: string } }) => Promise<unknown> };
      for (const model of patientLinkedModels()) {
        const policy = mergePolicyOf(model);
        const d = (tx as unknown as Record<string, Mover>)[delegateOf(model)];
        if (policy === 'MOVE') {
          await d.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } });
        } else if (policy === 'UNIQUE') {
          const { movable } = await splitUniqueRows(tx, model, sourceId, targetId);
          if (movable.length) await d.updateMany({ where: { id: { in: movable } }, data: { patientId: targetId } });
        }
      }

      // 병합 재전파: 이관된 encounter 의 오더 updated_at 을 bump.
      // LIS 증분 폴링 커서가 Order.updatedAt 이라, bump 없으면 새 MRN(target)으로 재전파되지 않아 분절이 남음.
      // (LIS 측도 폴링 경로 재귀속 구현 필요 — HIS·LIS 동시 수정으로 완결. his-lis-reply-2026-07-29.md 부록)
      if (movedEncounters.length > 0) {
        const encIds = movedEncounters.map((e) => e.id);
        await tx.$executeRaw`
          UPDATE "orders" SET "updated_at" = now()
          WHERE "prescription_id" IN (
            SELECT "id" FROM "prescriptions" WHERE "encounter_id"::text IN (${Prisma.join(encIds)})
          )`;
      }

      // Mark source as merged
      await tx.patient.update({
        where: { id: sourceId },
        data: {
          mergedIntoId: targetId,
          validTo: new Date(),
          updatedBy: userId,
        },
      });

      // Record merge in history
      await tx.patientHistory.create({
        data: {
          patientId: sourceId,
          data: {
            action: 'MERGE',
            sourceId,
            targetId,
            reason,
            sourceMrn: source.mrn,
            // 원 기록에 남은 것 — 병합 뒤 대상 차트에서 보이지 않는다(확인하고 병합했다는 사실과 함께)
            movedCounts: records.moved.map((r) => ({ model: r.model, policy: r.policy, count: r.count })),
            unmovedCounts: records.unmoved.map((r) => ({ model: r.model, policy: r.policy, count: r.count })),
            uncounted: records.uncounted,
            acknowledgedUnmoved: dto.acknowledgeUnmoved === true,
          } as unknown as Prisma.InputJsonValue,
          validFrom: sourceRow?.validFrom ?? new Date(),
          validTo: new Date(),
          changedBy: userId,
        },
      });

      return { sourceId, targetId, reason, mergedAt: new Date(), movedTotal: records.movedTotal, unmovedTotal: records.unmovedTotal };
    });
  }

  // ── Relations (Family) ──

  /**
   * 바이탈 통합 타임라인 — 외래(PreVisitVitals)·입원(FlowSheetEntry)·EWS(NEWS2)를
   * 소스 태그와 함께 시계열 병합(읽기 어댑터, 신규 모델 없음). 만성추이는 별도 탭.
   */
  async getVitalsTimeline(patientId: string) {
    await this.ensurePatientExists(patientId);
    const num = (x: unknown) => (x == null ? null : Number(x));
    const [opd, admissions, ews] = await Promise.all([
      this.prisma.preVisitVitals.findMany({ where: { patientId }, orderBy: { measuredAt: 'desc' }, take: 100 }),
      this.prisma.admission.findMany({ where: { patientId }, select: { id: true } }),
      this.prisma.earlyWarningScore.findMany({ where: { patientId }, orderBy: { recordedAt: 'desc' }, take: 100 }),
    ]);
    const admissionIds = admissions.map((a) => a.id);
    const ipd = admissionIds.length
      ? await this.prisma.flowSheetEntry.findMany({ where: { admissionId: { in: admissionIds } }, orderBy: { recordedAt: 'desc' }, take: 100 })
      : [];

    const entries = [
      ...opd.map((v) => ({ source: 'OPD' as const, at: v.measuredAt, systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, heartRate: v.heartRate, temperature: num(v.temperature), spo2: v.spo2, respiratoryRate: v.respiratoryRate, painScore: v.painScore, weight: num(v.weight), bmi: num(v.bmi), ewsScore: null as number | null })),
      ...ipd.map((v) => ({ source: 'IPD' as const, at: v.recordedAt, systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, heartRate: v.heartRate, temperature: num(v.temperature), spo2: v.spo2, respiratoryRate: v.respiratoryRate, painScore: v.painScore, weight: null, bmi: null, ewsScore: null as number | null })),
      ...ews.map((v) => ({ source: 'EWS' as const, at: v.recordedAt, systolicBp: v.systolicBp, diastolicBp: null, heartRate: v.heartRate, temperature: num(v.temperature), spo2: v.spO2, respiratoryRate: v.respiratoryRate, painScore: null, weight: null, bmi: null, ewsScore: v.totalScore })),
    ];
    entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return entries.slice(0, 200);
  }

  /** 가족력 시계열 — 과거 진료(Encounter.familyHistory) 누적 표시(읽기). */
  async getFamilyHistory(patientId: string) {
    await this.ensurePatientExists(patientId);
    const encs = await this.prisma.encounter.findMany({
      where: { patientId, familyHistory: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, createdAt: true, familyHistory: true, doctor: { select: { familyName: true, givenName: true, department: true } } },
    });
    return encs
      .filter((e) => (e.familyHistory ?? '').trim())
      .map((e) => ({
        encounterId: e.id,
        date: e.createdAt,
        doctorName: `${e.doctor?.familyName ?? ''}${e.doctor?.givenName ?? ''}`.trim() || '-',
        department: e.doctor?.department ?? null,
        familyHistory: e.familyHistory,
      }));
  }

  /** 구조화 가족력 목록(G4-2) — KCD 연결·발병연령·생존. */
  async getStructuredFamilyHistory(patientId: string) {
    await this.ensurePatientExists(patientId);
    return this.prisma.familyHistory.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { diagnosisCode: { select: { code: true, nameKo: true } } },
    });
  }

  async createFamilyHistory(patientId: string, dto: { relation: string; conditionName: string; diagnosisCodeId?: string; onsetAge?: number; isDeceased?: boolean; note?: string }, userId?: string) {
    await this.ensurePatientExists(patientId);
    return this.prisma.familyHistory.create({
      data: {
        patientId,
        relation: dto.relation,
        conditionName: dto.conditionName,
        diagnosisCodeId: dto.diagnosisCodeId ?? null,
        onsetAge: dto.onsetAge ?? null,
        isDeceased: dto.isDeceased ?? false,
        note: dto.note ?? null,
        recordedBy: userId ?? null,
      },
    });
  }

  async deleteFamilyHistory(patientId: string, id: string) {
    const fh = await this.prisma.familyHistory.findUnique({ where: { id } });
    if (!fh || fh.patientId !== patientId) throw new NotFoundException('가족력 기록을 찾을 수 없습니다');
    await this.prisma.familyHistory.delete({ where: { id } });
    return { success: true };
  }

  async getRelations(patientId: string) {
    await this.ensurePatientExists(patientId);

    const relations = await this.prisma.patientRelation.findMany({
      where: { patientId, isActive: true },
      include: {
        related: {
          select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true, photoUrl: true },
        },
      },
    });

    const relatedBy = await this.prisma.patientRelation.findMany({
      where: { relatedId: patientId, isActive: true },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true, photoUrl: true },
        },
      },
    });

    return [
      ...relations.map((r) => ({
        id: r.id,
        relatedPatient: r.related,
        relationship: r.relationship,
        direction: 'outgoing' as const,
        notes: r.notes,
      })),
      ...relatedBy.map((r) => ({
        id: r.id,
        relatedPatient: r.patient,
        relationship: this.reverseRelationship(r.relationship),
        direction: 'incoming' as const,
        notes: r.notes,
      })),
    ];
  }

  async createRelation(patientId: string, dto: CreateRelationDto) {
    await this.ensurePatientExists(patientId);
    await this.ensurePatientExists(dto.relatedId);

    if (patientId === dto.relatedId) {
      throw new BadRequestException('Cannot create relation with self');
    }

    return this.prisma.patientRelation.create({
      data: {
        patientId,
        relatedId: dto.relatedId,
        relationship: dto.relationship,
        notes: dto.notes,
      },
      include: {
        related: {
          select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true },
        },
      },
    });
  }

  async deleteRelation(patientId: string, relationId: string) {
    const relation = await this.prisma.patientRelation.findFirst({
      where: {
        id: relationId,
        OR: [{ patientId }, { relatedId: patientId }],
      },
    });

    if (!relation) {
      throw new NotFoundException(`Relation ${relationId} not found for patient ${patientId}`);
    }

    await this.prisma.patientRelation.update({
      where: { id: relationId },
      data: { isActive: false },
    });
  }

  private reverseRelationship(rel: string): string {
    const map: Record<string, string> = {
      PARENT: 'CHILD',
      CHILD: 'PARENT',
      SPOUSE: 'SPOUSE',
      SIBLING: 'SIBLING',
      GRANDPARENT: 'GRANDCHILD',
      GRANDCHILD: 'GRANDPARENT',
      GUARDIAN: 'DEPENDENT',
      DEPENDENT: 'GUARDIAN',
    };
    return map[rel] ?? rel;
  }

  // ── Import Patients (Bulk) ──

  async importPatients(dto: ImportPatientsDto, userId: string) {
    const results = { created: 0, skipped: 0, errors: [] as Array<{ index: number; reason: string }> };

    // 배치 중복 검사: 모든 후보를 한 번에 조회
    const candidates = dto.patients.map(p => ({
      familyName: p.familyName,
      givenName: p.givenName,
      dateOfBirth: new Date(p.dateOfBirth),
    }));
    const existingPatients = await this.prisma.patient.findMany({
      where: {
        OR: candidates.map(c => ({
          familyName: c.familyName,
          givenName: c.givenName,
          dateOfBirth: c.dateOfBirth,
          validTo: null,
        })),
      },
      select: { familyName: true, givenName: true, dateOfBirth: true },
    });
    const existingSet = new Set(
      existingPatients.map(p => `${p.familyName}|${p.givenName}|${p.dateOfBirth?.toISOString().slice(0, 10)}`),
    );

    for (let i = 0; i < dto.patients.length; i++) {
      const p = dto.patients[i];
      try {
        const key = `${p.familyName}|${p.givenName}|${p.dateOfBirth}`;
        if (existingSet.has(key)) {
          results.skipped++;
          results.errors.push({ index: i, reason: `중복: ${p.familyName}${p.givenName} (${p.dateOfBirth})` });
          continue;
        }

        await this.create(p, userId);
        results.created++;
        existingSet.add(key); // 같은 배치 내 중복 방지
      } catch (err: unknown) {
        results.errors.push({ index: i, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return results;
  }

  // ── Quality Dashboard ──

  /**
   * 데이터 품질 지표 — 🔴 2026-10-20 환자 목록 P1(R8) 정직화.
   * 종전 결함: ① 중복 의심이 **그룹 수(86)** 인데 화면이 환자 총수 분모의 % 로 그렸다(단위 섞임)
   *   ② 보험번호 없음 = 전원(자비 13 포함 — 자비·산재·자보는 건보 증번호가 원래 없다)
   *   ③ "1년 이상 미내원" 730 = 전부 **등록 1년 미만**(1년을 다닐 수도 없던 사람) ④ 사진은 등록 정책이 없는데 미등록 100% 경고.
   * 이제 지표마다 분자·분모·단위를 함께 낸다(분모 0 이면 화면이 산출 불가) · 드릴다운 필터(`buildWhere` quality)와 같은 조건.
   * 휴면 정의 자체·사진 요구 여부는 사람 결정(`patient.dormantDefinition`·`patient.photoPolicy` 예정) — 여기서는 지금 세는 것을 밝힌다.
   */
  async getQualityDashboard() {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const base = { validTo: null };
    const [noPhone, noInsurance, insuranceDenom, noAddress, dormant, dormantDenom, noPhoto, total] = await Promise.all([
      this.prisma.patient.count({ where: { ...base, phone: null } }),
      this.prisma.patient.count({ where: { ...base, ...QUALITY_NO_INSURANCE_NUMBER } }),
      this.prisma.patient.count({ where: { ...base, insuranceType: { in: [...INSURANCE_NUMBER_TYPES] } } }),
      this.prisma.patient.count({ where: { ...base, address: { equals: Prisma.AnyNull } } }),
      this.prisma.patient.count({ where: { ...base, ...qualityDormantWhere(yearAgo) } }),
      this.prisma.patient.count({ where: { ...base, createdAt: { lte: yearAgo } } }),
      this.prisma.patient.count({ where: { ...base, photoUrl: null } }),
      this.prisma.patient.count({ where: base }),
    ]);

    // 중복 의심: 같은 성·이름·생년월일 — 그룹 수와 그 그룹에 든 환자 수를 따로
    const dup = await this.prisma.$queryRaw<[{ groups: bigint; patients: bigint }]>`
      SELECT COUNT(*) AS groups, COALESCE(SUM(n), 0) AS patients FROM (
        SELECT COUNT(*) AS n
        FROM patients
        WHERE valid_to IS NULL
        GROUP BY family_name, given_name, date_of_birth
        HAVING COUNT(*) > 1
      ) dups
    `;

    return {
      total,
      noPhone: { count: noPhone, denominator: total },
      noInsurance: { count: noInsurance, denominator: insuranceDenom },
      noAddress: { count: noAddress, denominator: total },
      dormant: { count: dormant, denominator: dormantDenom },
      duplicateSuspect: { groups: Number(dup[0]?.groups ?? 0), patients: Number(dup[0]?.patients ?? 0), denominator: total },
      noPhoto: { count: noPhoto, denominator: total, policy: 'UNDECIDED' as const },
    };
  }

  // ── CSV Export ──

  async exportCsv(query: PatientQueryDto): Promise<string> {
    const where = await this.buildWhere(query);

    const patients = await this.prisma.patient.findMany({
      where,
      select: {
        mrn: true,
        familyName: true,
        givenName: true,
        dateOfBirth: true,
        gender: true,
        insuranceType: true,
        phone: true,
        createdAt: true,
      },
      orderBy: { familyName: 'asc' },
    });

    const header = 'MRN,성명,생년월일,성별,보험유형,전화번호,등록일';
    const rows = patients.map((p) => {
      const name = `${p.familyName}${p.givenName}`;
      const dob = p.dateOfBirth.toISOString().split('T')[0];
      const genderKo = p.gender === 'MALE' ? '남' : p.gender === 'FEMALE' ? '여' : p.gender ?? '';
      const insurance = p.insuranceType ?? '';
      // 전화번호 마스킹: 010-1234-5678 → 010-****-5678
      const phone = this.maskPhone(p.phone);
      const createdAt = p.createdAt.toISOString().split('T')[0];

      return [
        this.escapeCsvField(p.mrn),
        this.escapeCsvField(name),
        dob,
        genderKo,
        insurance,
        phone,
        createdAt,
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  private maskPhone(phone: string | null): string {
    if (!phone) return '';
    // 010-1234-5678 → 010-****-5678
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length >= 8) {
      const last4 = cleaned.slice(-4);
      const first = cleaned.slice(0, cleaned.length - 8);
      return `${first}****${last4}`;
    }
    return '****';
  }

  private escapeCsvField(value: string | null): string {
    if (!value) return '';
    // CSV 필드에 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸기
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  // ── MRN Generation (concurrent-safe) ──

  private async generateMrn(): Promise<string> {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');
    const prefix = `HR-${dateStr}-`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [result] = await this.prisma.$queryRaw<
          [{ nextval: bigint }]
        >`SELECT nextval('mrn_daily_seq')`;
        return `${prefix}${String(Number(result.nextval)).padStart(4, '0')}`;
      } catch (err) {
        // sequence가 없으면 count 기반 fallback
        // 🔴 (2026-09-14 실측) 운영 DB 에 `mrn_daily_seq` 가 없다 — 이 폴백이 운영의 유일한 발번 경로였고 흔적이 없었다.
        //    폴백은 유지하되(등록을 막지 않는다) 실패를 로그로 남긴다. 시퀀스 생성·일일 리셋 여부는 사람 결정(sql-inventory §6).
        if (attempt === 0) {
          this.logger.warn(`MRN sequence mrn_daily_seq unavailable - falling back to count-based MRN (not concurrent-safe; unique constraint rejects collisions): ${err instanceof Error ? err.message : String(err)}`);
        }
        const count = await this.prisma.patient.count({
          where: { mrn: { startsWith: prefix } },
        });
        const mrn = `${prefix}${String(count + 1 + attempt).padStart(4, '0')}`;
        // UNIQUE 제약으로 중복 방지
        const existing = await this.prisma.patient.findUnique({ where: { mrn } });
        if (!existing) return mrn;
      }
    }
    throw new DuplicateMrnError('MRN generation failed after 3 attempts');
  }

  // ── Encryption (AES-256-GCM) ──

  /** 주민번호 블라인드 인덱스 — HMAC-SHA256(결정적, 복호화 없이 동등검색/중복확인) */
  private hashNationalId(rrn: string): string {
    const normalized = rrn.replace(/\D/g, ''); // 숫자만
    return crypto.createHmac('sha256', this.encryptionKey).update('rrn:' + normalized).digest('hex');
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ── National ID Masking ──

  private maskNationalId(nationalId: string): string {
    // e.g. "860513-1234567" → "860513-1******"
    if (nationalId.length >= 8 && nationalId.includes('-')) {
      const parts = nationalId.split('-');
      if (parts.length === 2 && parts[1].length > 1) {
        return `${parts[0]}-${parts[1][0]}${'*'.repeat(parts[1].length - 1)}`;
      }
    }
    // Fallback: mask last half
    const visibleLen = Math.ceil(nationalId.length / 2);
    return nationalId.slice(0, visibleLen) + '*'.repeat(nationalId.length - visibleLen);
  }

  // ── Helpers ──

  private async ensurePatientExists(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new PatientNotFoundError(patientId);
    return patient;
  }

  // ── Query Helpers ──

  /** 외국인 필터 칩 구성용 — 비KR 국적·언어 분포(실데이터 기반) */
  async getForeignerFilterOptions() {
    const [nations, langs, counts, tagRows] = await Promise.all([
      this.prisma.patient.groupBy({
        by: ['nationality'], _count: { _all: true },
        where: { validTo: null, nationality: { notIn: ['KR', 'KOR'], not: null } },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.patient.groupBy({
        by: ['preferredLanguage'], _count: { _all: true },
        where: { validTo: null, OR: [{ nationality: { notIn: ['KR', 'KOR'], not: null } }] },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.patient.count({ where: { validTo: null, nationality: { notIn: ['KR', 'KOR'], not: null } } }),
      // 🔴 태그 필터 칩은 실제 데이터의 태그에서(2026-10-20 P2 R16) — 종전 화면 고정 9종(감염주의 등)은 운영에 해당 환자 0명
      this.prisma.$queryRaw<Array<{ tag: string; count: number }>>`
        SELECT t AS tag, COUNT(*)::int AS count
        FROM patients, unnest(tags) AS t
        WHERE valid_to IS NULL AND t <> ''
        GROUP BY t ORDER BY COUNT(*) DESC, t ASC`,
    ]);
    return {
      // 상위 30개만 칩으로 · 전체 종류 수를 함께(잘렸으면 잘렸다고)
      tags: tagRows.slice(0, 30),
      tagKinds: tagRows.length,
      foreignerTotal: counts,
      nationalities: nations.map((n) => ({ code: n.nationality, count: n._count._all })),
      languages: langs.map((l) => ({ code: l.preferredLanguage, count: l._count._all })),
    };
  }

  /** 품질 드릴다운(quality=) — 특수 판정 2종은 raw로 id 선해석(그룹/정규식은 Prisma where 불가) */
  private async resolveQualityIds(quality: string): Promise<string[] | null> {
    if (quality === 'dupSuspect') {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id::text as id FROM patients p
        JOIN (
          SELECT family_name, given_name, date_of_birth FROM patients
          WHERE valid_to IS NULL
          GROUP BY family_name, given_name, date_of_birth HAVING COUNT(*) > 1
        ) d ON p.family_name = d.family_name AND p.given_name = d.given_name
           AND p.date_of_birth IS NOT DISTINCT FROM d.date_of_birth
        WHERE p.valid_to IS NULL`;
      return rows.map((r) => r.id);
    }
    if (quality === 'nationalitySuspect') {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text as id FROM patients
        WHERE valid_to IS NULL
          AND (nationality IS NULL OR nationality IN ('KR', 'KOR'))
          AND (family_name || given_name) !~ '[가-힣]'`;
      return rows.map((r) => r.id);
    }
    return null;
  }

  private async buildWhere(query: PatientQueryDto, phoneSearch = true, userId?: string): Promise<Prisma.PatientWhereInput> {
    const conditions: Prisma.PatientWhereInput[] = [
      { validTo: null }, // 유효한 레코드만
    ];

    if (query.mrn) {
      conditions.push({ mrn: query.mrn });
    }
    // 고른 환자만(선택 행 일괄 반출 · P4 B9) — 다른 조건과 AND(비활성·병합된 옛 기록은 여전히 빠진다)
    if (query.ids) conditions.push({ id: { in: query.ids.split(',') } });
    // 내 환자(2026-10-20 P3 B1) — 기본 범위가 아니라 사람이 누르는 필터. 열람자 없이는 걸 수 없다(빈 결과 — 지어내지 않음)
    if (query.scope === 'mine') {
      if (!userId) conditions.push({ id: { in: [] } });
      else {
        const { gte, lt } = todayRange();
        conditions.push({
          OR: [
            { encounters: { some: { doctorId: userId, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } } },
            { admissions: { some: { admittingDoctorId: userId, status: 'ADMITTED' } } },
            { appointments: { some: { doctorId: userId, scheduledAt: { gte, lt } } } },
          ],
        });
      }
    }
    if (query.gender) {
      conditions.push({ gender: query.gender });
    }
    // 스카우트: FE 기존 필터(보험/상태/태그)가 DTO 부재로 whitelist strip → 서버 무동작이던 결함 수리
    if (query.insuranceType) {
      conditions.push({ insuranceType: query.insuranceType as never });
    }
    if (query.status === 'deceased') conditions.push({ isDeceased: true });
    else if (query.status === 'active') conditions.push({ isDeceased: false, isActive: true });
    else if (query.status === 'inactive') conditions.push({ isActive: false });
    if (query.tags) {
      const tags = query.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) conditions.push({ tags: { hasEvery: tags } });
    }
    // 외국인 구분 — 국적 미기재(null)는 내국인(KR)으로 간주(기본값 KR 정합)
    const KR = ['KR', 'KOR'];
    // 원내 환자 — 목록 기본 시야(입원·오늘 대기·오늘 미서명 진료). 판정 규칙은 onsite-filter(골든)
    if (query.presence) conditions.push(onsitePatientWhere(query.presence) as Prisma.PatientWhereInput);

    if (query.foreigner === 'Y') conditions.push({ AND: [{ nationality: { notIn: KR } }, { nationality: { not: null } }] });
    else if (query.foreigner === 'N') conditions.push({ OR: [{ nationality: { in: KR } }, { nationality: null }] });
    if (query.nationality) conditions.push({ nationality: query.nationality });
    if (query.language) conditions.push({ preferredLanguage: query.language });
    // 품질 드릴다운(L1) — 대시보드 카드 → 해당 워크리스트
    switch (query.quality) {
      case 'noPhone': conditions.push({ phone: null }); break;
      case 'noInsurance': conditions.push(QUALITY_NO_INSURANCE_NUMBER); break;
      case 'noAddress': conditions.push({ address: { equals: Prisma.AnyNull } }); break;
      case 'noPhoto': conditions.push({ photoUrl: null }); break;
      case 'dormant':
        conditions.push(qualityDormantWhere(new Date(Date.now() - 365 * 86400_000)));
        break;
      case 'passportExpiring':
        conditions.push({ passportExpiry: { lt: new Date(Date.now() + 90 * 86400_000) }, nationality: { notIn: ['KR', 'KOR'], not: null } });
        break;
      case 'dupSuspect':
      case 'nationalitySuspect': {
        const ids = await this.resolveQualityIds(query.quality);
        conditions.push({ id: { in: ids ?? [] } });
        break;
      }
    }
    if (query.dobFrom) {
      conditions.push({ dateOfBirth: { gte: new Date(query.dobFrom) } });
    }
    if (query.dobTo) {
      conditions.push({ dateOfBirth: { lte: new Date(query.dobTo) } });
    }
    if (query.q) {
      const q = query.q.trim();
      // 한국어 이름: familyName(1자) + givenName(2자) 조합 검색
      // "김영수" → familyName="김" AND givenName starts with "영수"
      // "김영" → familyName="김" AND givenName starts with "영"
      // "김" → familyName="김"
      const nameConditions: Prisma.PatientWhereInput[] = [
        { familyName: { contains: q, mode: 'insensitive' } },
        { givenName: { contains: q, mode: 'insensitive' } },
        { mrn: { contains: q, mode: 'insensitive' } },
        ...this.phoneConditions(q, phoneSearch),
      ];

      // 2글자 이상이면 성+이름 분리 검색 추가
      if (q.length >= 2) {
        // 성 1자 + 이름 나머지
        nameConditions.push({
          AND: [
            { familyName: { equals: q.slice(0, 1) } },
            { givenName: { startsWith: q.slice(1), mode: 'insensitive' } },
          ],
        });
        // 성 2자 + 이름 나머지 (복성: 남궁, 선우 등)
        if (q.length >= 3) {
          nameConditions.push({
            AND: [
              { familyName: { equals: q.slice(0, 2) } },
              { givenName: { startsWith: q.slice(2), mode: 'insensitive' } },
            ],
          });
        }
      }

      conditions.push({ OR: nameConditions });
    }

    return { AND: conditions };
  }

  private mapSortField(sort: string): string {
    const map: Record<string, string> = {
      familyName: 'familyName',
      givenName: 'givenName',
      mrn: 'mrn',
      dateOfBirth: 'dateOfBirth',
      createdAt: 'createdAt',
    };
    return map[sort] ?? 'familyName';
  }

  /** 목록 파생 — 포털/인증서 관계를 boolean으로 축약(관계 배열은 페이로드에서 제거) */
  /**
   * 🔴 결정적 정렬(2026-10-20 환자 목록 P1 R14) — 종전엔 `familyName` 한 키라 같은 성(김 105·배 104)이 쪽 경계에서
   * 순서가 정해지지 않았다(같은 환자가 두 쪽에 나오거나 빠질 수 있다). 이름 → 등록번호 → id 로 끝까지 정한다.
   */
  private listOrderBy(query: { sort?: string; order?: 'asc' | 'desc' }): Prisma.PatientOrderByWithRelationInput[] {
    const field = this.mapSortField(query.sort ?? 'familyName');
    const dir = query.order ?? 'asc';
    const out: Prisma.PatientOrderByWithRelationInput[] = [{ [field]: dir }];
    if (field === 'familyName') out.push({ givenName: dir });
    if (field !== 'mrn') out.push({ mrn: 'asc' });
    out.push({ id: 'asc' });
    return out;
  }

  /**
   * 진료 횟수 정의(2026-10-20 환자 목록 P1 R11) — 종전 `_count.encounters` 는 작성 중(DRAFT)까지 셌다(서명 555 · 전체 782).
   * 서명된 진료(SIGNED·AMENDED)와 작성 중을 따로 낸다 · `_count` 는 다른 소비처 호환으로 남긴다.
   */
  private async withEncounterCounts<T extends Record<string, unknown>>(items: T[]): Promise<Array<T & { encounterCounts: { signed: number; drafts: number } }>> {
    const ids = items.map((i) => i.id as string).filter(Boolean);
    const rows = ids.length
      ? await this.prisma.encounter.groupBy({ by: ['patientId', 'status'], where: { patientId: { in: ids } }, _count: { _all: true } })
      : [];
    const map = new Map<string, { signed: number; drafts: number }>();
    for (const r of rows as Array<{ patientId: string; status: string; _count: { _all: number } }>) {
      const c = map.get(r.patientId) ?? { signed: 0, drafts: 0 };
      if (r.status === 'DRAFT') c.drafts += r._count._all;
      else c.signed += r._count._all;
      map.set(r.patientId, c);
    }
    return items.map((i) => ({ ...i, encounterCounts: map.get(i.id as string) ?? { signed: 0, drafts: 0 } }));
  }

  /** 최근 방문·다음 예약·머무는 곳·알레르기 상태(권한일 때만) — 한 쪽 묶음 조회(`patient-list-enrich.ts` · 2026-10-20 P3) */
  private async withListExtras<T extends Record<string, unknown>>(items: T[], allergy: boolean, staleDrafts: StaleDraftScope = null) {
    const extras = await listRowExtras(this.prisma as never, items.map((i) => i.id as string).filter(Boolean), { allergy, staleDrafts });
    return items.map((i) => ({ ...i, ...(extras.get(i.id as string) ?? {}) }));
  }

  private mapListItem(p: Record<string, unknown>) {
    const account = p.account as { status?: string } | null;
    const certs = p.blockchainCerts as unknown[] | undefined;
    const { account: _a, blockchainCerts: _b, ...rest } = p;
    return {
      ...rest,
      hasPortalAccount: !!account,
      portalActive: account?.status === 'ACTIVE',
      hasCertificate: Array.isArray(certs) && certs.length > 0,
    };
  }

  private listSelect() {
    return {
      id: true,
      mrn: true,
      familyName: true,
      givenName: true,
      dateOfBirth: true,
      gender: true,
      insuranceType: true,
      phone: true,
      photoUrl: true,
      tags: true,
      isDeceased: true,
      nationality: true,
      preferredLanguage: true,
      visaType: true,
      // 외국인 한국식 호칭 — 목록이 원어 옆에 함께 보인다(shared patientNameView)
      koreanName: true,
      createdAt: true,
      account: { select: { id: true, status: true } }, // 포털 계정(개설 여부·상태)
      blockchainCerts: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 }, // 개별 전자인증서(발급 여부)
      _count: { select: { encounters: true } }, // 진료횟수
    };
  }

  /**
   * 전화번호 검색 조건 — 권한이 없으면 아예 넣지 않는다.
   * 권한이 있으면 원문 부분 일치 + 정규화 칸 부분 일치(저장 형식이 하이픈·숫자만으로 섞여 원문만으로는 못 찾던 것)
   */
  private phoneConditions(q: string, phoneSearch: boolean): Prisma.PatientWhereInput[] {
    if (!phoneSearch) return [];
    const out: Prisma.PatientWhereInput[] = [{ phone: { contains: q } }];
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4 && /^[\d\-\s+]+$/.test(q)) {
      out.push({ phoneNormalized: { contains: digits.startsWith('0') ? digits.slice(1) : digits } });
    }
    return out;
  }

  // ── Smart List ──

  async getSmartList(userId: string, role: string, department?: string, q?: string, context?: string, opts: { phoneSearch?: boolean } = {}) {
    // koreanName — 화면이 외국인 이름 정본(PatientName)으로 그린다
    const patientSelect = { id: true, mrn: true, familyName: true, givenName: true, koreanName: true, dateOfBirth: true, gender: true, phone: true, insuranceType: true };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // 병렬로 조회
    const [myAppointments, myEncounters, myAdmissions, emergencyVisits, searchResults] = await Promise.all([
      // 1. 오늘 예약 환자 (의사/관리자)
      (role === 'DOCTOR' || role === 'ADMIN') ? this.prisma.appointment.findMany({
        where: { doctorId: userId, scheduledAt: { gte: today, lt: tomorrow }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
        include: { patient: { select: patientSelect } },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }) : Promise.resolve([]),

      // 2. 최근 진료 환자 (3일)
      (role === 'DOCTOR' || role === 'ADMIN') ? this.prisma.encounter.findMany({
        where: { doctorId: userId, createdAt: { gte: threeDaysAgo } },
        include: { patient: { select: patientSelect } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }) : Promise.resolve([]),

      // 3. 담당 입원 환자
      this.prisma.admission.findMany({
        where: { admittingDoctorId: userId, status: 'ADMITTED' },
        include: { patient: { select: patientSelect }, bed: { include: { ward: { select: { name: true } } } } },
        take: 20,
      }),

      // 4. 응급실 현재 환자
      this.prisma.emergencyVisit.findMany({
        where: { disposition: null },
        include: { patient: { select: patientSelect } },
        orderBy: { triageLevel: 'asc' },
        take: 10,
      }),

      // 5. 검색 결과 (q가 있을 때만)
      q ? this.prisma.patient.findMany({
        where: {
          validTo: null, // 병합·대체된 옛 기록은 찾지 않는다(목록 검색과 같은 기준)
          OR: [
            { familyName: { contains: q, mode: 'insensitive' } },
            { givenName: { contains: q, mode: 'insensitive' } },
            { mrn: { contains: q, mode: 'insensitive' } },
            ...this.phoneConditions(q, opts.phoneSearch ?? true),
          ],
        },
        select: patientSelect,
        take: 20,
      }) : Promise.resolve([]),
    ]);

    // 중복 제거 (ID 기반)
    const seenIds = new Set<string>();
    const dedup = <T extends { patient?: { id: string } | null; id?: string }>(items: T[]): T[] =>
      items.filter(item => {
        const id = item.patient?.id ?? item.id;
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });

    // 오늘 예약 환자
    const myPatients = dedup(myAppointments).map((a) => ({
      ...a.patient,
      context: `${localeTimeText(new Date(a.scheduledAt), 'ko-KR', { hour: '2-digit', minute: '2-digit' })} 예약`,
      contextType: 'appointment',
    }));

    // 최근 진료 환자
    const recentPatients = dedup(myEncounters).map((e) => {
      const mins = Math.floor((Date.now() - new Date(e.createdAt).getTime()) / 60000);
      const timeStr = mins < 60 ? `${mins}분 전` : mins < 1440 ? `${Math.floor(mins / 60)}시간 전` : `${Math.floor(mins / 1440)}일 전`;
      return { ...e.patient, context: `${timeStr} 진료`, contextType: 'encounter' };
    });

    // 담당 입원 환자
    const admittedPatients = dedup(myAdmissions).map((a) => {
      const days = stayDays(a.admitDate) ?? 0;
      return { ...a.patient, context: `${(a.bed as { ward?: { name?: string } } | null)?.ward?.name ?? ''} 입원 ${days}일째`, contextType: 'admission' };
    });

    // 응급실 환자
    const emergencyPatients = dedup(emergencyVisits).map((ev) => ({
      ...ev.patient,
      context: `${String(ev.triageLevel).replace('LEVEL_', 'KTAS ')}급 · ${(ev.chiefComplaint ?? '').substring(0, 20)}`,
      contextType: 'emergency',
    }));

    return {
      myPatients,
      recentPatients,
      admittedPatients,
      emergencyPatients,
      searchResults: q ? dedup(searchResults).map((p) => ({ ...p, context: null, contextType: 'search' })) : [],
    };
  }

  /**
   * 🔴 통합 동의 현황 (A4 · 2026-08-31) — 5개 동의 정본을 **병합하지 않고 읽기 집계**한다.
   * 각자 다른 법적 성격이라 정본은 유지(정본을 억지로 합치면 각자의 정직성이 무너진다).
   * 🔴 상태는 5상태로 갈라 말한다 — 미수집을 유효로 그리지 않는다.
   *   GRANTED(유효)·REVOKED(철회)·EXPIRED(만료)·PENDING(서명대기)·MISSING(미수집)
   */
  async getUnifiedConsents(patientId: string) {
    const now = new Date();
    const account = await this.prisma.patientAccount.findUnique({ where: { patientId }, select: { id: true } });

    const [forms, privacy, ai, crm, reg] = await Promise.all([
      this.prisma.consentForm.findMany({
        where: { patientId },
        select: { type: true, templateName: true, signedAt: true, expiresAt: true, isValid: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      account
        ? this.prisma.patientConsent.findMany({
            where: { accountId: account.id },
            select: { type: true, agreed: true, agreedAt: true, revokedAt: true },
          })
        : Promise.resolve([]),
      this.prisma.patientAiConsent.findMany({
        where: { patientId },
        select: { consented: true, consentedAt: true, revokedAt: true },
      }),
      this.prisma.patientConsentCrm.findMany({
        where: { patientId },
        select: { channel: true, type: true, consented: true, consentedAt: true, withdrawnAt: true },
      }),
      this.prisma.registrationConsent.findMany({
        where: { patientId },
        select: { type: true, agreed: true, signedAt: true, revokedAt: true, expiresAt: true },
      }),
    ]);

    type Status = 'GRANTED' | 'REVOKED' | 'EXPIRED' | 'PENDING' | 'MISSING';
    type Entry = { source: string; type: string; label: string; status: Status; at: Date | null };
    const out: Entry[] = [];

    for (const f of forms) {
      let status: Status;
      if (!f.isValid) status = 'REVOKED';
      else if (f.signedAt && f.expiresAt && f.expiresAt < now) status = 'EXPIRED';
      else if (f.signedAt) status = 'GRANTED';
      else status = 'PENDING';
      out.push({ source: 'CLINICAL', type: f.type, label: f.templateName, status, at: f.signedAt ?? f.createdAt });
    }
    for (const c of privacy) {
      const status: Status = c.revokedAt ? 'REVOKED' : c.agreed ? 'GRANTED' : 'MISSING';
      out.push({ source: 'PRIVACY', type: c.type, label: c.type, status, at: c.revokedAt ?? c.agreedAt });
    }
    for (const a of ai) {
      const status: Status = a.revokedAt ? 'REVOKED' : a.consented ? 'GRANTED' : 'MISSING';
      out.push({ source: 'AI_TWIN', type: 'AI_TWIN', label: 'AI·디지털 트윈', status, at: a.revokedAt ?? a.consentedAt });
    }
    for (const m of crm) {
      const status: Status = m.withdrawnAt ? 'REVOKED' : m.consented ? 'GRANTED' : 'MISSING';
      out.push({ source: 'CRM', type: `${m.type}/${m.channel}`, label: `${m.type} (${m.channel})`, status, at: m.withdrawnAt ?? m.consentedAt });
    }
    for (const r of reg) {
      let status: Status;
      if (r.revokedAt) status = 'REVOKED';
      else if (r.expiresAt && r.expiresAt < now) status = 'EXPIRED';
      else if (r.agreed && r.signedAt) status = 'GRANTED';
      else if (r.agreed) status = 'PENDING';
      else status = 'MISSING';
      out.push({ source: 'REGISTRATION', type: r.type, label: r.type, status, at: r.signedAt ?? r.revokedAt });
    }

    const counts = out.reduce((acc, e) => { acc[e.status] = (acc[e.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    return { items: out, counts, hasPortalAccount: !!account };
  }

  /**
   * 🔴 중복 의심 그룹 (A5 · 2026-08-31) — 성명+생년월일이 같은 활성 환자를 **그룹으로** 낸다.
   * 종전엔 카운트만 있고(대시보드) 나란히 비교·병합할 화면이 없었다. 🔴 자동 병합은 없다 — 병합은 사람.
   */
  async getDuplicateGroups(limit = 50) {
    const keys = await this.prisma.$queryRaw<Array<{ family_name: string; given_name: string; date_of_birth: Date }>>`
      SELECT family_name, given_name, date_of_birth
      FROM patients
      WHERE valid_to IS NULL
      GROUP BY family_name, given_name, date_of_birth
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `;
    const groups = [] as Array<{ familyName: string; givenName: string; dateOfBirth: string; members: unknown[] }>;
    for (const k of keys) {
      const members = await this.prisma.patient.findMany({
        where: { validTo: null, familyName: k.family_name, givenName: k.given_name, dateOfBirth: k.date_of_birth },
        select: {
          id: true, mrn: true, phone: true, gender: true, insuranceType: true, createdAt: true,
          _count: { select: { encounters: true, admissions: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      groups.push({
        familyName: k.family_name, givenName: k.given_name,
        dateOfBirth: k.date_of_birth.toISOString().slice(0, 10),
        members,
      });
    }
    return { groups, groupCount: groups.length };
  }
}
