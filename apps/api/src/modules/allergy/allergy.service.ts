import { deriveAllergyStatus } from './allergy-status-derive';
import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AllergyNotFoundError } from '../../domain/errors/domain-error';
import { CreateAllergyDto } from './dto/create-allergy.dto';
import { UpdateAllergyDto } from './dto/update-allergy.dto';
import { VerifyAllergyDto } from './dto/verify-allergy.dto';
import { AssessAllergyDto } from './dto/assess-allergy.dto';
import { DurWarning } from '../prescription/dur/dur.service';
import { type AllergyStatusKey } from '@hospital-run/shared';

/**
 * 알레르기 문진 상태(3-상태 + 문진불가) — 레코드 부재("미문진")와 "무알레르기 확인"을 구별.
 *
 * 🔴 **어휘를 여기 다시 적지 않는다.** 종전엔 shared 정본(`ALLERGY_STATUSES`)과 똑같은
 *    네 값을 이 파일이 **자기 union 으로 또 들고 있었다.** 지금은 일치하지만 **강제하는 것이
 *    없어서**, 한쪽만 늘리면 조용히 갈라진다(이 저장소 규약: *"어휘 정본은 shared 하나"*).
 *    정본에서 가져오면 갈라질 자리가 사라진다 — 가드보다 낫다.
 */
export type AllergyStatus = AllergyStatusKey;

@Injectable()
export class AllergyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * 알레르기 근거가 바뀌었다 — 환자 브리핑(AI 보조 패널) 캐시가 옛 상태를 최대 하루 들고 있던 것을 끊는다(2026-09-30).
   * 발행 실패는 쓰기를 되돌리지 않는다(캐시는 TTL 로도 결국 풀린다).
   */
  private changed<T>(patientId: string, result: T): T {
    try { this.events?.emit('allergy.changed', { patientId }); } catch { /* 캐시 무효화 신호일 뿐 */ }
    return result;
  }

  async create(patientId: string, dto: CreateAllergyDto, userId: string) {
    return this.changed(patientId, await this.prisma.allergy.create({
      data: {
        patientId,
        type: dto.type,
        allergen: dto.allergen,
        allergenCode: dto.allergenCode,
        reaction: dto.reaction,
        severity: dto.severity,
        onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : undefined,
        reportedBy: dto.reportedBy,
        recordedBy: userId,
        notes: dto.notes,
      },
      include: this.defaultInclude(),
    }));
  }

  async findByPatient(patientId: string, isActive?: boolean) {
    const where: Prisma.AllergyWhereInput = { patientId };
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.allergy.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      include: this.defaultInclude(),
    });
  }

  /**
   * 🔴 (2026-09-16) 경로는 `patients/:patientId/allergies/:id` 인데 환자 id 를 버리고 알레르기 id 만으로
   *    조회·수정했다 — 다른 환자의 알레르기를 이 경로로 읽고 고칠 수 있었다(알레르기는 DUR 이 읽는 안전 데이터다).
   *    열람 감사는 `resourceId=patientId` 라, 환자 A 경로로 환자 B 의 기록을 내주면 감사 원장까지 틀리게 남는다.
   *    소속이 다르면 **존재를 알려주지 않는다**(404).
   */
  private async ensureBelongsToPatient(patientId: string, id: string) {
    const owned = await this.prisma.allergy.findFirst({ where: { id, patientId }, select: { id: true } });
    if (!owned) throw new AllergyNotFoundError(id);
  }

  async findById(patientId: string, id: string) {
    const allergy = await this.prisma.allergy.findFirst({
      where: { id, patientId },
      include: this.defaultInclude(),
    });
    if (!allergy) throw new AllergyNotFoundError(id);
    return allergy;
  }

  async update(patientId: string, id: string, dto: UpdateAllergyDto) {
    await this.ensureBelongsToPatient(patientId, id);

    return this.changed(patientId, await this.prisma.allergy.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.allergen !== undefined && { allergen: dto.allergen }),
        ...(dto.allergenCode !== undefined && { allergenCode: dto.allergenCode }),
        ...(dto.reaction !== undefined && { reaction: dto.reaction }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.onsetDate !== undefined && { onsetDate: new Date(dto.onsetDate) }),
        ...(dto.reportedBy !== undefined && { reportedBy: dto.reportedBy }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: this.defaultInclude(),
    }));
  }

  async verify(patientId: string, id: string, dto: VerifyAllergyDto) {
    await this.ensureBelongsToPatient(patientId, id);

    return this.changed(patientId, await this.prisma.allergy.update({
      where: { id },
      data: {
        verificationStatus: dto.verificationStatus,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.verificationStatus === 'REFUTED' && { isActive: false }),
        ...(dto.verificationStatus === 'ENTERED_IN_ERROR' && { isActive: false }),
      },
      include: this.defaultInclude(),
    }));
  }

  /**
   * 알레르기 문진 기록(NKA 안전) — "무알레르기 확인"/"문진 불가"를 명시적으로 남김.
   * NKA 주장 시 활성 알레르기가 있으면 모순이므로 차단.
   */
  async assess(patientId: string, dto: AssessAllergyDto, userId: string) {
    // NKA 모순 검사와 기록을 한 트랜잭션으로 — 동시 알레르기 등록과의 경합으로 모순 NKA가 남는 것 방지.
    return this.changed(patientId, await this.prisma.$transaction(async (tx) => {
      if (dto.result === 'NO_KNOWN_ALLERGIES') {
        const activeCount = await tx.allergy.count({ where: { patientId, isActive: true } });
        if (activeCount > 0) {
          throw new BadRequestException(
            '활성 알레르기가 등록되어 있어 무알레르기(NKA)로 기록할 수 없습니다. 먼저 해당 알레르기를 정정/비활성화하세요.',
          );
        }
      }
      return tx.allergyAssessment.create({
        data: {
          patientId,
          result: dto.result,
          encounterId: dto.encounterId,
          note: dto.note,
          assessedBy: userId,
        },
        include: { assessor: { select: { id: true, familyName: true, givenName: true } } },
      });
    }));
  }

  /**
   * 현재 알레르기 문진 상태 도출.
   * 활성 알레르기>0 → HAS_ALLERGIES(실제 목록이 근거) / 없으면 최신 문진 결과 / 문진 없으면 NOT_ASSESSED.
   * 안전 규칙: 활성 알레르기가 없으면 명시적 NKA/UNABLE 문진이 있을 때만 그 상태를 표시(그 외는 NOT_ASSESSED).
   */
  async getStatus(patientId: string) {
    const [activeAllergies, latest, lastAllergyChange] = await Promise.all([
      this.prisma.allergy.findMany({
        where: { patientId, isActive: true },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: this.defaultInclude(),
      }),
      this.prisma.allergyAssessment.findFirst({
        where: { patientId },
        orderBy: { assessedAt: 'desc' },
        include: { assessor: { select: { id: true, familyName: true, givenName: true } } },
      }),
      // 활성/비활성 무관 가장 최근 알레르기 변경(등록/정정/비활성화) 시점
      this.prisma.allergy.findFirst({ where: { patientId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);

    // 🔴 규칙은 순수 함수 하나(목록 묶음 조회와 같은 규칙 — 2026-10-20) · 낡은 문진은 옛 NKA 를 다시 내지 않는다
    const status = deriveAllergyStatus({
      activeCount: activeAllergies.length,
      latest: latest ? { result: String(latest.result), assessedAt: latest.assessedAt } : null,
      lastAllergyChangeAt: lastAllergyChange?.updatedAt ?? null,
    }) as AllergyStatus;

    return {
      status,
      assessedAt: latest?.assessedAt ?? null,
      assessedBy: latest?.assessor ?? null,
      lastAssessment: latest,
      allergies: activeAllergies,
    };
  }

  /**
   * DUR 연동: 약물 알레르기 체크
   * 처방 시 환자의 활성 DRUG 알레르기와 약품 성분 비교
   */
  async checkDrugAllergy(patientId: string, medicationCodeId: string): Promise<DurWarning[]> {
    const warnings: DurWarning[] = [];

    const medication = await this.prisma.medicationCode.findUnique({
      where: { id: medicationCodeId },
    });
    if (!medication) return warnings;

    const drugAllergies = await this.prisma.allergy.findMany({
      where: { patientId, type: 'DRUG', isActive: true },
    });

    for (const allergy of drugAllergies) {
      const allergen = allergy.allergen.toLowerCase();
      const ingredient = (medication.ingredient ?? '').toLowerCase();
      const medName = (medication.nameKo ?? '').toLowerCase();

      // 성분코드 정확매칭은 성분명(자유텍스트)이 아니라 성분코드(ingredientCode)와 비교해야 함.
      const codeMatch = !!allergy.allergenCode && !!medication.ingredientCode
        && allergy.allergenCode === medication.ingredientCode;
      // 부분매칭은 빈 문자열 방어(ingredient='' → includes('') 항상 참으로 전 약물 오발동 방지).
      if (
        codeMatch ||
        (ingredient && ingredient.includes(allergen)) ||
        (medName && medName.includes(allergen)) ||
        (allergen && ingredient && allergen.includes(ingredient))
      ) {
        warnings.push({
          severity: 'ERROR',
          type: 'ALLERGY',
          message: `약물 알레르기 경고: ${allergy.allergen} 알레르기 환자에게 ${medication.nameKo} 처방 불가`,
          drugA: allergy.allergen,
          drugB: medication.nameKo,
        });
      }
    }

    return warnings;
  }

  private defaultInclude() {
    return {
      recorder: { select: { id: true, familyName: true, givenName: true } },
    };
  }
}
