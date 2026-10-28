import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { localDateKey } from '../../common/day-range';
import { InsuranceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readHospitalConfig, HOSPITAL_UNSET_EN } from '../config/hospital-facts';

// 🔴 DTO 는 class-validator 클래스로 승격돼 dto/ 로 옮겼다(interface 는 metatype Object 라 검증 스킵).
//    서비스·컨트롤러가 이 모듈에서 import 하므로 재export 로 경로를 유지한다.
export { ForeignPatientDto, EmergencyUnknownDto } from './dto/foreign-patient.dto';
import type { ForeignPatientDto, EmergencyUnknownDto } from './dto/foreign-patient.dto';

export { IdentifyPatientDto, IdentifyPatientDto as IdentifyDto } from './dto/identify.dto';
import { IdentifyPatientDto } from './dto/identify.dto';
import { encryptLegacyPid, decryptLegacyPid, hashForeignId } from '../../common/crypto/legacy-pid-crypto';
import { arrivalNoteHasContent, injuryTypeFromLegacy, type ArrivalNoteInput } from '@hospital-run/shared';
import type { ArrivalNoteDto } from './dto/arrival-note.dto';

/** 도착 기록 입력 → 저장 행 — 빈 글자는 null(적지 않음) · 시각은 받은 그대로(모르면 null · '지금'으로 채우지 않는다) */
function arrivalRow(n: ArrivalNoteInput) {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const belongings = (n.belongings ?? []).filter((b) => b.item && b.item.trim()).map((b) => ({ item: b.item.trim(), custody: b.custody }));
  return {
    arrivalAt: t(n.arrivalAt) ? new Date(n.arrivalAt as string) : null,
    arrivalMode: n.arrivalMode ?? null,
    emsUnit: t(n.emsUnit),
    foundLocation: t(n.foundLocation),
    foundAt: t(n.foundAt) ? new Date(n.foundAt as string) : null,
    circumstance: t(n.circumstance),
    consciousness: n.consciousness ?? null,
    injuryTypes: n.injuryTypes?.length ? ([...new Set(n.injuryTypes)] as Prisma.InputJsonValue) : Prisma.JsonNull,
    companionType: n.companionType ?? null,
    companionName: t(n.companionName),
    companionContact: t(n.companionContact),
    companionRelation: t(n.companionRelation),
    belongings: belongings.length ? (belongings as Prisma.InputJsonValue) : Prisma.JsonNull,
    identifyingFeatures: t(n.identifyingFeatures),
    policeInvolved: n.policeInvolved ?? null,
    policeAgency: t(n.policeAgency),
    policeOfficer: t(n.policeOfficer),
    policeCaseNo: t(n.policeCaseNo),
    infoSource: n.infoSource ?? null,
    note: t(n.note),
  };
}

@Injectable()
export class ForeignPatientService {
  constructor(private readonly prisma: PrismaService) {}

  /** 외국인 환자 등록 */
  async registerForeign(dto: ForeignPatientDto, userId: string) {
    // 중복 체크: 여권번호
    if (dto.passportNumber) {
      const existing = await this.prisma.patient.findFirst({
        where: { passportNumberHash: hashForeignId(dto.passportNumber) },
      });
      if (existing) {
        throw new BadRequestException(`여권번호 ${dto.passportNumber}로 이미 등록된 환자가 있습니다 (MRN: ${existing.mrn})`);
      }
    }

    // 중복 체크: 외국인등록번호
    if (dto.alienRegistrationNo) {
      const existing = await this.prisma.patient.findFirst({
        where: { alienRegistrationNoHash: hashForeignId(dto.alienRegistrationNo) },
      });
      if (existing) {
        throw new BadRequestException(`외국인등록번호로 이미 등록된 환자가 있습니다 (MRN: ${existing.mrn})`);
      }
    }

    const mrn = await this.generateForeignMrn(dto.patientType);

    const patient = await this.prisma.patient.create({
      data: {
        updatedBy: userId,
        mrn,
        familyName: dto.familyName,
        givenName: dto.givenName,
        nameEn: dto.nameEn,
        koreanName: dto.koreanName,
        dateOfBirth: new Date(dto.dateOfBirth),
        gender: dto.gender as Prisma.PatientCreateInput['gender'],
        nationality: dto.nationality,
        passportNumber: dto.passportNumber ? encryptLegacyPid(dto.passportNumber) : dto.passportNumber,
        passportNumberHash: dto.passportNumber ? hashForeignId(dto.passportNumber) : null,
        alienRegistrationNo: dto.alienRegistrationNo ? encryptLegacyPid(dto.alienRegistrationNo) : dto.alienRegistrationNo,
        alienRegistrationNoHash: dto.alienRegistrationNo ? hashForeignId(dto.alienRegistrationNo) : null,
        phone: dto.phone,
        email: dto.email,
        preferredLanguage: dto.preferredLanguage ?? 'en',
        passportExpiry: dto.passportExpiry ? new Date(dto.passportExpiry) : undefined,
        visaType: dto.visaType,
        address: dto.localAddress ? ({ detail: dto.localAddress, type: 'LOCAL_STAY' } as Prisma.InputJsonValue) : undefined,
        patientSource: dto.patientType,
        // 청구 보험유형은 enum(공단 청구 체계)만 담는다 — 여행자보험/대사관/선수금은 '자비'로 청구된다.
        // 🔴 다만 선택 자체를 조용히 버리면 지불보증 정보가 소실된다(P4-서버) → guaranteeType 으로 보존.
        insuranceType: (['NHI', 'SELF_PAY', 'MEDICAID', 'INDUSTRIAL', 'AUTO'].includes(dto.insuranceType ?? '') ? dto.insuranceType as InsuranceType : InsuranceType.SELF_PAY),
        travelInsurance: (!['NHI', 'SELF_PAY', 'MEDICAID', 'INDUSTRIAL', 'AUTO'].includes(dto.insuranceType ?? '') && dto.insuranceType
          ? ({ ...(dto.travelInsurance as unknown as Record<string, unknown> ?? {}), guaranteeType: dto.insuranceType } as Prisma.InputJsonValue)
          : (dto.travelInsurance as unknown as Prisma.InputJsonValue ?? Prisma.DbNull)),
        embassyContact: dto.embassyContact,
        interpreterNeeded: dto.interpreterNeeded ?? false,
        depositRequired: dto.insuranceType === 'DEPOSIT' || dto.insuranceType === 'SELF_PAY',
        createdBy: userId,
      },
    });

    // 비상연락처 — 본국/현지 보호자(외국인 환자 필수 안전정보)
    if (dto.emergencyContact?.name && dto.emergencyContact?.phone) {
      await this.prisma.patientContact.create({
        data: {
          patientId: patient.id,
          name: dto.emergencyContact.name,
          phone: dto.emergencyContact.phone,
          relationship: 'OTHER',
          relationshipDetail: dto.emergencyContact.relationship ?? '비상연락처',
          isEmergencyContact: true,
        },
      }).catch(() => undefined); // 연락처 실패가 등록을 막지 않음
    }

    return patient;
  }

  /* ── 등록 목록 관리(조회/수정/보관/복원/삭제) ── */

  private static readonly FOREIGN_SOURCES = ['FOREIGN_TOURIST', 'FOREIGN_RESIDENT', 'OVERSEAS_KOREAN', 'REMOTE_INTERNATIONAL'];

  async listForeign(query: { search?: string; patientType?: string; includeArchived?: boolean }) {
    const where: Prisma.PatientWhereInput = {
      patientSource: query.patientType && ForeignPatientService.FOREIGN_SOURCES.includes(query.patientType)
        ? query.patientType
        : { in: ForeignPatientService.FOREIGN_SOURCES },
    };
    if (!query.includeArchived) where.isActive = true;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { familyName: { contains: q, mode: 'insensitive' } },
        { givenName: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { koreanName: { contains: q, mode: 'insensitive' } },
        { mrn: { contains: q, mode: 'insensitive' } },
        // 🔴 passportNumber 는 암호화 컬럼이라 부분검색 불가 — 이름·MRN·nameEn 으로 검색(정확 일치는 등록 중복확인에서 hash 로)
      ];
    }
    const rows = await this.prisma.patient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, mrn: true, familyName: true, givenName: true, nameEn: true, koreanName: true,
        dateOfBirth: true, gender: true, nationality: true, preferredLanguage: true,
        passportNumber: true, passportExpiry: true, visaType: true, alienRegistrationNo: true,
        phone: true, email: true, patientSource: true, insuranceType: true,
        interpreterNeeded: true, embassyContact: true, travelInsurance: true, address: true,
        isActive: true, archivedAt: true, createdAt: true, attachments: true,
        _count: { select: { encounters: true } },
      },
    });
    // 🔴 암호화 컬럼 복호(평문 레거시는 그대로 통과) — 화면 표시용
    return rows.map((r) => ({
      ...r,
      passportNumber: r.passportNumber ? decryptLegacyPid(r.passportNumber) : r.passportNumber,
      alienRegistrationNo: r.alienRegistrationNo ? decryptLegacyPid(r.alienRegistrationNo) : r.alienRegistrationNo,
    }));
  }

  async updateForeign(id: string, dto: Partial<ForeignPatientDto>, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id }, select: { id: true, patientSource: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    // 여권/외국인등록번호 변경 시 본인 제외 중복 체크
    if (dto.passportNumber) {
      const dup = await this.prisma.patient.findFirst({ where: { passportNumberHash: hashForeignId(dto.passportNumber), id: { not: id } }, select: { mrn: true } });
      if (dup) throw new BadRequestException(`여권번호가 다른 환자(MRN: ${dup.mrn})와 중복됩니다`);
    }
    if (dto.alienRegistrationNo) {
      const dup = await this.prisma.patient.findFirst({ where: { alienRegistrationNoHash: hashForeignId(dto.alienRegistrationNo), id: { not: id } }, select: { mrn: true } });
      if (dup) throw new BadRequestException(`외국인등록번호가 다른 환자(MRN: ${dup.mrn})와 중복됩니다`);
    }

    return this.prisma.patient.update({
      where: { id },
      data: {
        ...(dto.familyName !== undefined ? { familyName: dto.familyName } : {}),
        ...(dto.givenName !== undefined ? { givenName: dto.givenName } : {}),
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn || null } : {}),
        ...(dto.koreanName !== undefined ? { koreanName: dto.koreanName || null } : {}),
        ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
        ...(dto.gender ? { gender: dto.gender as Prisma.PatientUpdateInput['gender'] } : {}),
        ...(dto.nationality !== undefined ? { nationality: dto.nationality } : {}),
        ...(dto.preferredLanguage !== undefined ? { preferredLanguage: dto.preferredLanguage } : {}),
        ...(dto.passportNumber !== undefined ? { passportNumber: dto.passportNumber ? encryptLegacyPid(dto.passportNumber) : null, passportNumberHash: dto.passportNumber ? hashForeignId(dto.passportNumber) : null } : {}),
        ...(dto.passportExpiry !== undefined ? { passportExpiry: dto.passportExpiry ? new Date(dto.passportExpiry) : null } : {}),
        ...(dto.visaType !== undefined ? { visaType: dto.visaType || null } : {}),
        ...(dto.alienRegistrationNo !== undefined ? { alienRegistrationNo: dto.alienRegistrationNo ? encryptLegacyPid(dto.alienRegistrationNo) : null, alienRegistrationNoHash: dto.alienRegistrationNo ? hashForeignId(dto.alienRegistrationNo) : null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email || null } : {}),
        ...(dto.localAddress !== undefined ? { address: dto.localAddress ? ({ detail: dto.localAddress, type: 'LOCAL_STAY' } as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
        ...(dto.embassyContact !== undefined ? { embassyContact: dto.embassyContact || null } : {}),
        ...(dto.interpreterNeeded !== undefined ? { interpreterNeeded: dto.interpreterNeeded } : {}),
        ...(dto.patientType ? { patientSource: dto.patientType } : {}),
        ...(dto.insuranceType && ['NHI', 'SELF_PAY', 'MEDICAID', 'INDUSTRIAL', 'AUTO'].includes(dto.insuranceType)
          ? { insuranceType: dto.insuranceType as InsuranceType } : {}),
        ...(dto.travelInsurance !== undefined ? { travelInsurance: (dto.travelInsurance as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull } : {}),
        updatedBy: userId,
      },
    });
  }

  /** 환자 서류 첨부(여권 사본·보험증권 등) — attachments Json append */
  async addAttachment(
    id: string,
    file: { url: string; fileName: string; mimeType: string; size: number },
    userId: string,
  ) {
    const patient = await this.prisma.patient.findUnique({ where: { id }, select: { attachments: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const list = Array.isArray(patient.attachments) ? (patient.attachments as unknown[]) : [];
    if (list.length >= 20) throw new BadRequestException('첨부는 최대 20개까지 가능합니다');
    const entry = { ...file, uploadedBy: userId, uploadedAt: new Date().toISOString() };
    return this.prisma.patient.update({
      where: { id },
      data: { attachments: [...list, entry] as Prisma.InputJsonValue, updatedBy: userId },
      select: { id: true, attachments: true },
    });
  }

  async removeAttachment(id: string, index: number, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id }, select: { attachments: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const list = Array.isArray(patient.attachments) ? (patient.attachments as unknown[]) : [];
    if (index < 0 || index >= list.length) throw new BadRequestException('잘못된 첨부 인덱스입니다');
    return this.prisma.patient.update({
      where: { id },
      data: { attachments: list.filter((_, i) => i !== index) as Prisma.InputJsonValue, updatedBy: userId },
      select: { id: true, attachments: true },
    });
  }

  async archiveForeign(id: string, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    return this.prisma.patient.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date(), updatedBy: userId },
      select: { id: true, isActive: true, archivedAt: true },
    });
  }

  async restoreForeign(id: string, userId: string) {
    return this.prisma.patient.update({
      where: { id },
      data: { isActive: true, archivedAt: null, updatedBy: userId },
      select: { id: true, isActive: true },
    });
  }

  /** 삭제 — 임상 데이터가 전혀 없는 등록 오류 건만 허용(의무기록 보존 원칙). 그 외엔 보관 사용. */
  async deleteForeign(id: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      select: { mrn: true, _count: { select: { encounters: true, appointments: true, billings: true, consentForms: true } } },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const c = patient._count;
    if (c.encounters > 0 || c.appointments > 0 || c.billings > 0 || c.consentForms > 0) {
      throw new BadRequestException(
        `임상 기록이 있어 삭제할 수 없습니다(진료 ${c.encounters}·예약 ${c.appointments}·수납 ${c.billings}·동의서 ${c.consentForms}) — 보관을 사용하세요`,
      );
    }
    await this.prisma.patientContact.deleteMany({ where: { patientId: id } }).catch(() => undefined);
    await this.prisma.patient.delete({ where: { id } });
    return { deleted: true, mrn: patient.mrn };
  }

  /**
   * 응급 미확인 환자 등록 + 도착 상황 첫 기록.
   * 🔴 종전: `arrivalNote`·`injuryType` 을 DTO 가 검증하고 **여기서 버렸다**(저장 0). 이제 같은 트랜잭션에서 첫 기록으로 남긴다.
   *    옛 손상 유형 값이 어휘에 없으면 버리지 않고 메모에 `injuryType=원문` 으로 붙인다.
   */
  async registerEmergencyUnknown(dto: EmergencyUnknownDto, userId: string) {
    const tempId = `EMG-${Date.now().toString(36).toUpperCase()}`;
    const mrn = `EMG-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const arrival: ArrivalNoteInput = { ...(dto.arrival ?? {}) };
    const notes = [arrival.note, dto.arrivalNote].map((x) => x?.trim()).filter(Boolean) as string[];
    const legacyInjury = injuryTypeFromLegacy(dto.injuryType);
    if (legacyInjury) arrival.injuryTypes = [...new Set([...(arrival.injuryTypes ?? []), legacyInjury])];
    // 어휘에 없는 옛 값은 버리지 않고 필드 이름과 함께 원문으로(서버가 한국어 문장을 조립하지 않는다)
    else if (dto.injuryType?.trim()) notes.push(`injuryType=${dto.injuryType.trim()}`);
    arrival.note = notes.length ? notes.join('\n') : null;

    return this.prisma.$transaction(async (tx) => {
    // 사전통보 연결 — 없는 통보 404 · 취소된 통보 400(취소된 통보로 기록을 만들지 않는다)
    const prenote = dto.prenotificationId
      ? await tx.emergencyPrenotification.findUnique({ where: { id: dto.prenotificationId } })
      : null;
    if (dto.prenotificationId && !prenote) throw new NotFoundException({ code: 'PRENOTIFICATION_NOT_FOUND', message: '사전통보를 찾을 수 없습니다' });
    if (prenote?.status === 'CANCELLED') throw new BadRequestException({ code: 'PRENOTIFICATION_CANCELLED', message: '취소된 사전통보입니다' });
    const patient = await tx.patient.create({
      data: {
        mrn,
        familyName: '미확인',
        givenName: tempId,
        dateOfBirth: dto.estimatedAge
          ? new Date(new Date().getFullYear() - dto.estimatedAge, 0, 1)
          : new Date('1900-01-01'),
        gender: (dto.gender ?? 'UNKNOWN') as Prisma.PatientCreateInput['gender'],
        patientSource: 'EMERGENCY_UNKNOWN',
        nationality: 'UNKNOWN',
        depositRequired: false,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    // 적은 것이 없으면 빈 기록을 만들지 않는다(빈 행이 "기록함"으로 읽히지 않게)
    const arrivalNote = arrivalNoteHasContent(arrival) || prenote
      ? await tx.emergencyArrivalNote.create({ data: { patientId: patient.id, kind: 'INITIAL', recordedById: userId, prenotificationId: prenote?.id ?? null, ...arrivalRow(arrival) } })
      : null;
    // 도착 처리는 사람이 고른 경우만 · 이미 도착 처리된 통보는 그대로(멱등) · 방문(visit)은 아직 없으니 연결하지 않는다
    let prenotificationArrived = false;
    if (prenote && dto.markPrenotificationArrived && prenote.status === 'EN_ROUTE') {
      await tx.emergencyPrenotification.update({ where: { id: prenote.id }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
      prenotificationArrived = true;
    }
    return { ...patient, arrivalNoteId: arrivalNote?.id ?? null, prenotificationArrived };
    });
  }

  /** 도착 상황 기록 — 오래된 것부터(첫 기록 → 추가 기록) · 기록자 이름 */
  async listArrivalNotes(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, patientSource: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const rows = await this.prisma.emergencyArrivalNote.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } });
    const ids = [...new Set(rows.map((r) => r.recordedById).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    return {
      patientSource: patient.patientSource,
      notes: rows.map((r) => ({ ...r, recordedByName: r.recordedById ? nameOf.get(r.recordedById) ?? null : null })),
    };
  }

  /**
   * 도착 상황 추가 기록 — 고치지 않고 덧붙인다. 첫 기록이 없으면 이것이 첫 기록(INITIAL).
   * 빈 기록은 받지 않는다(400 ARRIVAL_NOTE_EMPTY).
   */
  async addArrivalNote(patientId: string, dto: ArrivalNoteDto, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    if (!arrivalNoteHasContent(dto)) throw new BadRequestException({ code: 'ARRIVAL_NOTE_EMPTY', message: '적은 내용이 없습니다' });
    const has = await this.prisma.emergencyArrivalNote.count({ where: { patientId } });
    return this.prisma.emergencyArrivalNote.create({
      data: { patientId, kind: has ? 'ADDENDUM' : 'INITIAL', recordedById: userId, ...arrivalRow(dto) },
    });
  }

  /** 미확인 환자 신원 확인 (임시 → 정식) */
  async identifyPatient(id: string, dto: IdentifyPatientDto, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    if (patient.patientSource !== 'EMERGENCY_UNKNOWN') {
      throw new BadRequestException('신원 미확인 환자만 신원 확인 가능합니다');
    }

    const updated = await this.prisma.patient.update({
      where: { id },
      data: {
        familyName: dto.familyName,
        givenName: dto.givenName,
        nameEn: dto.nameEn,
        nationality: dto.nationality ?? 'KOR',
        passportNumber: dto.passportNumber ? encryptLegacyPid(dto.passportNumber) : dto.passportNumber,
        passportNumberHash: dto.passportNumber ? hashForeignId(dto.passportNumber) : null,
        alienRegistrationNo: dto.alienRegistrationNo ? encryptLegacyPid(dto.alienRegistrationNo) : dto.alienRegistrationNo,
        alienRegistrationNoHash: dto.alienRegistrationNo ? hashForeignId(dto.alienRegistrationNo) : null,
        dateOfBirth: new Date(dto.dateOfBirth),
        gender: dto.gender as Prisma.PatientUpdateInput['gender'],
        phone: dto.phone,
        patientSource: dto.patientSource ?? 'DOMESTIC',
      },
    });

    return updated;
  }

  /** 여권 정보 조회 (권한 제한) */
  async getPassportInfo(id: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      select: {
        id: true,
        familyName: true,
        givenName: true,
        nameEn: true,
        nationality: true,
        passportNumber: true,
        alienRegistrationNo: true,
        preferredLanguage: true,
        patientSource: true,
        travelInsurance: true,
        embassyContact: true,
        interpreterNeeded: true,
        depositRequired: true,
        // 보관(archive) 상태 — archiveForeign 이 설정하지만 조회 응답에 없어
        // 화면에서 보관 여부를 구분할 수 없었다(2026-07 UI 미노출 감사)
        isActive: true,
        archivedAt: true,
      },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    // 🔴 암호화 컬럼 복호(평문 레거시 통과)
    return {
      ...patient,
      passportNumber: patient.passportNumber ? decryptLegacyPid(patient.passportNumber) : patient.passportNumber,
      alienRegistrationNo: patient.alienRegistrationNo ? decryptLegacyPid(patient.alienRegistrationNo) : patient.alienRegistrationNo,
    };
  }

  /** 영문 진단서 생성 */
  async generateEnglishCertificate(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        encounters: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: {
            diagnoses: { include: { diagnosisCode: true } },
            prescriptions: { include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true } } } },
            doctor: { select: { familyName: true, givenName: true } },
          },
        },
      },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    const diagnoses = (patient.encounters ?? []).flatMap((enc: any) =>
      (enc.diagnoses ?? []).map((d: any) => ({
        code: d.diagnosisCode?.icd10Code ?? d.diagnosisCode?.code ?? '',
        nameKo: d.diagnosisCode?.nameKo ?? '',
        nameEn: d.diagnosisCode?.nameEn ?? d.diagnosisCode?.nameKo ?? '',
        type: d.type,
        date: enc.createdAt?.toISOString?.()?.slice(0, 10) ?? '',
        doctor: enc.doctor ? `${enc.doctor.familyName}${enc.doctor.givenName}` : '',
      })),
    );

    // 🔴 기관정보는 정본 system_configs `hospital.*` 의 **DB 행만**(영문 우선·영문 미설정 시 국문 — 설정 설명이 정한 규칙).
    //    종전엔 `config.get(...).catch(() => '')` 였다: 조회 실패를 빈 값으로 삼켰고, `get()` 은 DB 행이 없으면
    //    DEFAULTS 개발 플레이스홀더('Hospital RUN 병원'·'서울시 강남구'·'02-1234-5678')로 떨어져 **영문 진단서에 가짜 기관**이 찍혔다.
    //    → 조회 실패는 전파하고, 미설정은 지어내지 않고 표지(HOSPITAL_UNSET_EN)로 찍으며 무엇이 비었는지 `unconfigured` 로 밝힌다.
    const inst = await readHospitalConfig(this.prisma, [
      'hospital.name', 'hospital.nameEn', 'hospital.address', 'hospital.addressEn', 'hospital.phone', 'hospital.license',
    ] as const);
    const instFields = {
      name: inst['hospital.nameEn'] ?? inst['hospital.name'],
      address: inst['hospital.addressEn'] ?? inst['hospital.address'],
      phone: inst['hospital.phone'],
      licenseNo: inst['hospital.license'],
    };
    const unconfigured = (Object.keys(instFields) as (keyof typeof instFields)[]).filter((k) => instFields[k] == null);
    return {
      documentType: 'MEDICAL_CERTIFICATE',
      language: 'en',
      title: 'Medical Certificate / Diagnosis Report',
      issuedDate: localDateKey(new Date()), // 🔴 발급일은 KST 날짜(UTC slice 는 오전에 전날)
      hospital: {
        name: instFields.name ?? HOSPITAL_UNSET_EN['hospital.name'],
        address: instFields.address ?? HOSPITAL_UNSET_EN['hospital.address'],
        phone: instFields.phone ?? HOSPITAL_UNSET_EN['hospital.phone'],
        licenseNo: instFields.licenseNo ?? HOSPITAL_UNSET_EN['hospital.license'],
        /** 표지로 찍힌(=설정이 없는) 항목 — 화면·발급자가 "미설정"을 값으로 오인하지 않게 */
        unconfigured,
      },
      patient: {
        name: patient.nameEn ?? `${patient.familyName} ${patient.givenName}`,
        nameKo: `${patient.familyName}${patient.givenName}`,
        dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10),
        gender: patient.gender === 'MALE' ? 'Male' : patient.gender === 'FEMALE' ? 'Female' : 'Unknown',
        nationality: patient.nationality,
        passportNumber: patient.passportNumber ? decryptLegacyPid(patient.passportNumber) : patient.passportNumber,
        mrn: patient.mrn,
      },
      diagnoses: diagnoses.map(d => ({
        icdCode: d.code,
        diagnosisKo: d.nameKo,
        diagnosisEn: d.nameEn,
        type: d.type === 'PRIMARY' ? 'Primary' : 'Secondary',
        dateOfDiagnosis: d.date,
        attendingPhysician: d.doctor,
      })),
      // 한/영 병용 P3(D6): 투약 섹션 신설 — nameEn 우선, 없으면 성분(영문 90%) 폴백, 그것도 없으면
      // 한글명 그대로(로마자 자동 변환 금지). 소스=동일 encounters 의 약물 처방.
      medications: (patient.encounters ?? []).flatMap((enc: any) =>
        (enc.prescriptions ?? [])
          .filter((rx: any) => rx.medicationCode)
          .map((rx: any) => ({
            name: rx.medicationCode.nameEn
              || (rx.medicationCode.ingredient && !/[가-힣]/.test(rx.medicationCode.ingredient) ? rx.medicationCode.ingredient : null)
              || `${rx.medicationCode.nameKo} (Korean name — no English name on file)`,
            nameKo: rx.medicationCode.nameKo,
            dosage: rx.dosage ?? undefined,
            frequency: rx.frequency ?? undefined,
            durationDays: rx.duration ?? undefined,
            route: rx.route ?? undefined,
            datePrescribed: enc.createdAt?.toISOString?.()?.slice(0, 10) ?? '',
          })),
      ),
      certification: {
        text: 'This is to certify that the above-mentioned patient was diagnosed and treated at this medical facility. This certificate is issued upon the patient\'s request for insurance claim, travel, or other official purposes.',
        signerTitle: 'Attending Physician',
        disclaimer: 'This certificate is issued based on the medical records at the time of examination. It does not constitute a guarantee of diagnosis or prognosis.',
      },
    };
  }

  private async generateForeignMrn(type: string): Promise<string> {
    const prefix = type === 'FOREIGN_TOURIST' ? 'FT' :
                   type === 'FOREIGN_RESIDENT' ? 'FR' :
                   type === 'OVERSEAS_KOREAN' ? 'OK' : 'RI';
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const seq = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${dateStr}-${seq}`;
  }
}
