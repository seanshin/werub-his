import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dateOnlyValue, todayDateOnly, localDateKey, requireDateParam, assertDateParam } from '../../common/day-range';
import { checkupItemPriority } from '@hospital-run/shared';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { aiUnavailable } from '../medical-ai/ai-grounding';
import { JourneyService } from '../journey/journey.service';
import { DocumentService } from '../document/document.service';
import { CheckupProtocolService } from './checkup-protocol.service';
import { PrismaClinicAdapter } from './adapters/prisma-clinic.adapter';
import {
  CreateCheckupVisitDto,
  CreateWalkInVisitDto,
  UpdateCheckupVisitStatusDto,
  CreateCheckupSummaryDto,
} from './dto/checkup-visit.dto';
import { CheckupOption, ageOf } from '@hospital-run/shared';
import { maskPublicName } from '../emergency/er-flow-display.service';

interface ProgramItem {
  seq?: number;
  category: string;
  name: string;
  codes?: string[];
  interpretDept?: string;
}

const STATUS_FLOW: Record<string, string[]> = {
  RESERVED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS'],
  IN_PROGRESS: ['EXAM_COMPLETE', 'PARTIAL_COMPLETE'],
  EXAM_COMPLETE: ['REVIEW'],
  PARTIAL_COMPLETE: ['REVIEW'],
  REVIEW: ['COMPLETED'],
  COMPLETED: ['DELIVERED'],
};

// ── 검사 순서 우선순위 — 정본은 shared `checkup-routing.ts`(경로표·다음 검사 추천이 같은 규칙을 쓴다 · P0-6) ──
const getItemPriority = (item: { category: string; name: string }) => checkupItemPriority(item);

/**
 * 오늘 하루(`scheduledDate` = `@db.Date`) 비교 구간.
 *
 * 🔴 정본은 `common/day-range.ts` 의 `todayDateOnly`/`dateOnlyValue` 다 —
 *    `@db.Date` 는 Prisma 가 넘긴 Date 의 **UTC 날짜 부분만** 쓰므로
 *    로컬(KST) 자정(`setHours(0,0,0,0)`)을 넣으면 **하루 앞 날짜**가 된다(급양 축 2026-08-21).
 *    종전엔 이 파일이 같은 계산을 손으로 다시 적고 있었고(정본이 둘), 정작
 *    `createWalkInVisit` 는 그것조차 쓰지 않고 로컬 자정을 저장했다.
 */
function todayRange() {
  const today = todayDateOnly();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { today, tomorrow, dateStr: localDateKey(new Date()) };
}

/**
 * 사용자가 넣은 날짜(`YYYY-MM-DD`)를 `@db.Date` 비교값으로.
 * 🔴 파싱 실패는 500 이 아니라 **400** — 자기 입력 문제인 줄 알게 한다(급양 축 규약).
 */
function checkupDateOnly(value: string, field: string): Date {
  const d = dateOnlyValue(value);
  if (!d) throw new BadRequestException(`${field} 형식이 올바르지 않습니다(YYYY-MM-DD)`);
  return d;
}

@Injectable()
export class CheckupService {
  private readonly logger = new Logger(CheckupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: PrismaClinicAdapter,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly medicalAi?: MedicalAiService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly documents?: DocumentService,
    @Optional() private readonly protocols?: CheckupProtocolService,
  ) {}

  /**
   * 검진 결과 항목을 사실 문장으로 — **기록된 값만**. 값이 없거나 PENDING 인 항목은 근거가 아니다.
   */
  private static checkupFindingLines(
    items: Array<{ testName: string; value: string | null; unit: string | null; referenceRange: string | null; finding: string; grade: string | null; category: string }>,
  ): string[] {
    return items
      .filter((i) => i.finding !== 'PENDING' && i.value != null && String(i.value).trim() !== '')
      .map((i) => {
        const ref = i.referenceRange ? ` (기준 ${i.referenceRange})` : '';
        const grade = i.grade ? ` 등급 ${i.grade}` : '';
        return `- [${i.category}] ${i.testName}: ${i.value}${i.unit ? ' ' + i.unit : ''}${ref} → ${i.finding}${grade}`;
      });
  }

  /**
   * AI 검진 결과 종합 해석.
   *
   * 🔴 종전엔 `visit.summary` 가 없으면 문자열 `'결과 미입력'` 을 보내고도 **종합 해석을 요구**했다.
   *    아무 결과도 없이 나온 "종합 해석"은 소견이 아니라 창작이다(P15).
   * → 결과 항목·종합소견이 모두 없으면 **호출하지 않는다**. 있으면 실제 항목까지 함께 보낸다.
   */
  async interpretCheckupAI(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: {
        patient: { select: { dateOfBirth: true, gender: true } },
        summary: true,
        items: { select: { category: true, testName: true, value: true, unit: true, referenceRange: true, finding: true, grade: true } },
      },
    });
    if (!visit) throw new NotFoundException('검진 방문을 찾을 수 없습니다');
    if (!this.medicalAi) return { visitId, patientId: visit.patientId, interpretation: null, ...aiUnavailable('SOURCE_UNREACHABLE', 'AI 보조가 비활성화되어 있습니다.') };

    const lines = CheckupService.checkupFindingLines(visit.items);
    if (!lines.length && !visit.summary) {
      return {
        visitId, patientId: visit.patientId,
        interpretation: null,
        ...aiUnavailable('NO_SOURCE_DATA', `검진 결과가 아직 입력되지 않았습니다(현재 상태: ${visit.status}). 결과 없이는 종합 해석을 산출할 수 없습니다.`),
      };
    }

    try {
      const parts: string[] = [];
      if (visit.summary) {
        parts.push(`종합소견 등급: ${visit.summary.overallGrade}`);
        parts.push(`영역별 소견: ${JSON.stringify(visit.summary.sections)}`);
        if (visit.summary.doctorOpinion) parts.push(`검진의 소견: ${visit.summary.doctorOpinion}`);
      }
      if (lines.length) parts.push(`검진 항목 결과(${lines.length}건):\n${lines.join('\n')}`);

      const result = await this.medicalAi.clinicalQa({
        question: `아래는 실제 검진 결과입니다. 이 결과만 근거로 종합 해석과 건강 권고사항을 한국어로 알려주세요. 결과에 없는 항목은 언급하지 마세요.\n\n${parts.join('\n\n')}`,
        specialty: 'preventive-medicine',
      });
      return { visitId, patientId: visit.patientId, interpretation: result, itemCount: lines.length, hasSummary: !!visit.summary, source: 'AI', disclaimer: await this.medicalAi.getDisclaimer() };
    } catch (e) {
      this.logger.warn(`AI 검진 해석 실패: ${e}`);
      return { visitId, patientId: visit.patientId, interpretation: null, source: 'FALLBACK', error: '해석 서비스 일시 불가' };
    }
  }

  /**
   * AI 추적 검진 권고.
   *
   * 🔴 원 결함(2026-08-18 적발 · P15): **검진 결과를 한 건도 조회하지 않고**
   *    `건강검진 결과에서 비정상 소견이 발견되었습니다` 라는 **허위 전제**만으로 권고를 받았다.
   *    visitId 는 응답에 되돌려주기만 했을 뿐 DB 를 읽은 적이 없다 — 어떤 환자든 같은 답이 나온다.
   * → 실제 결과를 읽고, 결과가 없으면 호출하지 않는다. 이상이 없으면 "이상이 있다"고 말하지 않는다.
   */
  async suggestFollowupCheckup(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: {
        summary: true,
        items: { select: { category: true, testName: true, value: true, unit: true, referenceRange: true, finding: true, grade: true } },
      },
    });
    if (!visit) throw new NotFoundException('검진 방문을 찾을 수 없습니다');
    if (!this.medicalAi) return { visitId, patientId: visit.patientId, recommendation: null, ...aiUnavailable('SOURCE_UNREACHABLE', 'AI 보조가 비활성화되어 있습니다.') };

    const graded = visit.items.filter((i) => i.finding !== 'PENDING' && i.value != null && String(i.value).trim() !== '');
    if (!graded.length && !visit.summary) {
      return {
        visitId, patientId: visit.patientId,
        recommendation: null,
        ...aiUnavailable('NO_SOURCE_DATA', `검진 결과가 아직 입력되지 않았습니다(현재 상태: ${visit.status}). 추적 검진 권고의 근거가 없습니다.`),
      };
    }

    const abnormal = graded.filter((i) => i.finding === 'ABNORMAL' || i.finding === 'CRITICAL');
    const lines = CheckupService.checkupFindingLines(abnormal.length ? abnormal : graded);
    // 전제는 관측된 사실만 — 이상 항목이 없으면 없다고 말한다.
    const premise = abnormal.length
      ? `건강검진에서 아래 ${abnormal.length}개 항목이 비정상(ABNORMAL/CRITICAL)으로 판정되었습니다.`
      : '건강검진 결과에 비정상으로 판정된 항목은 없습니다. 아래는 판정 완료된 항목 전체입니다.';
    const gradeLine = visit.summary ? `종합소견 등급: ${visit.summary.overallGrade}\n` : '';

    try {
      const result = await this.medicalAi.clinicalQa({
        question: `${premise}\n${gradeLine}\n${lines.join('\n')}\n\n위 결과만 근거로 추적 검진 시기와 필요한 항목을 한국어로 최대 3개 추천하고, 각각 어느 항목 때문인지 밝혀주세요. 추적이 필요 없으면 "정기검진 주기 유지"라고 답하세요.`,
        specialty: 'preventive-medicine',
      });
      return { visitId, patientId: visit.patientId, recommendation: result, abnormalCount: abnormal.length, evaluatedCount: graded.length, source: 'AI', disclaimer: await this.medicalAi.getDisclaimer() };
    } catch (e) {
      this.logger.warn(`AI 추적 검진 권고 실패: ${e}`);
      return { visitId, patientId: visit.patientId, recommendation: null, source: 'FALLBACK', error: '권고 서비스 일시 불가' };
    }
  }

  // ── 일일 용량 조회 ──
  async getCapacity(query: { from: string; to: string }) {
    // 🔴 무검증 `new Date` → `Invalid Date` 가 Prisma `groupBy` 로 들어가 **500**(운영 실측)
    const fromDate = requireDateParam(query.from, '조회 시작일');
    const toDate = requireDateParam(query.to, '조회 종료일');
    toDate.setDate(toDate.getDate() + 1);

    // 기본 용량 (전체 프로그램 중 최대 dailyCapacity 합산, 없으면 40)
    const programs = await this.prisma.checkupProgram.findMany({
      where: { isActive: true },
      select: { dailyCapacity: true },
    });
    const totalCapacity = programs.reduce((sum, p) => sum + (p.dailyCapacity ?? 0), 0) || 40;

    // 날짜별 예약 건수
    const visits = await this.prisma.checkupVisit.groupBy({
      by: ['scheduledDate'],
      where: {
        scheduledDate: { gte: fromDate, lt: toDate },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      _count: true,
    });

    const visitMap = new Map(visits.map((v) => [
      new Date(v.scheduledDate).toISOString().slice(0, 10),
      v._count,
    ]));

    const result = [];
    const cursor = new Date(fromDate);
    while (cursor < toDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const reserved = visitMap.get(dateStr) ?? 0;
      result.push({
        date: dateStr,
        capacity: totalCapacity,
        reserved,
        available: Math.max(0, totalCapacity - reserved),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  /**
   * 선택 옵션 금액 합산 — 🔴 (2026-09-03) 못 찾은 옵션 id 를 조용히 건너뛰면 **선택 옵션이 0원으로
   * 예약**된다(프로그램에서 옵션이 삭제된 뒤 이전 화면으로 제출한 경우 등). 모르는 것으로 돈을
   * 계산하지 않는다 — 사용자 입력 문제임을 그 자리에서 400 으로 말한다. 두 호출부(예약·현장접수) 공용.
   */
  private sumSelectedOptions(programOptions: unknown, selected: string[] | undefined): number {
    if (!selected?.length) return 0;
    const opts = (Array.isArray(programOptions) ? programOptions : []) as CheckupOption[];
    let sum = 0;
    for (const optId of selected) {
      const opt = opts.find((o) => o.id === optId);
      if (!opt) throw new BadRequestException(`선택한 옵션(${optId})이 현재 프로그램에 없습니다 — 화면을 새로고침해 옵션을 다시 선택해 주세요.`);
      sum += opt.price;
    }
    return sum;
  }

  // ── 예약 생성 ──
  async createVisit(dto: CreateCheckupVisitDto) {
    const program = await this.prisma.checkupProgram.findUnique({
      where: { id: dto.programId },
    });
    if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');
    if (!program.isActive)
      throw new BadRequestException('비활성 프로그램입니다');

    const scheduledDate = checkupDateOnly(dto.scheduledDate, '예약일');

    // 일일 용량 체크
    if (program.dailyCapacity) {
      const nextDay = new Date(scheduledDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const count = await this.prisma.checkupVisit.count({
        where: {
          programId: dto.programId,
          scheduledDate: { gte: scheduledDate, lt: nextDay },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      });
      if (count >= program.dailyCapacity)
        throw new BadRequestException(`해당 날짜의 예약이 마감되었습니다 (최대 ${program.dailyCapacity}명)`);
    }

    // 금액 계산
    let totalPrice = program.price;
    if (program.discountRate > 0) {
      totalPrice = Math.round(totalPrice * (1 - program.discountRate / 100));
    }

    // 단체 계약 할인 적용
    if (dto.contractId) {
      const contract = await this.prisma.checkupContract.findUnique({
        where: { id: dto.contractId },
      });
      if (contract && contract.discountRate > 0) {
        totalPrice = Math.round(totalPrice * (1 - contract.discountRate / 100));
      }
    }

    totalPrice += this.sumSelectedOptions(program.options, dto.selectedOptions);

    const visit = await this.prisma.checkupVisit.create({
      data: {
        patientId: dto.patientId,
        programId: dto.programId,
        scheduledDate,
        selectedOptions: dto.selectedOptions as unknown as Prisma.InputJsonValue,
        totalPrice,
        isNhiScreening: dto.isNhiScreening ?? false,
        nhiScreeningCode: dto.nhiScreeningCode,
        contractId: dto.contractId,
      },
      include: { program: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });

    this.journey?.emit({
      patientId: dto.patientId,
      eventType: 'CHECKUP_RESERVED',
      plannedAt: scheduledDate, // 여정 P1: 예정 시각은 발생과 섞지 않는다
      title: `${program.name} 예약 (${scheduledDate.toISOString().slice(0, 10)})`,
      department: '건강검진센터',
      refType: 'CheckupVisit',
      refId: visit.id,
      navUrl: `/his-checkup/visit/${visit.id}`,
    });

    return visit;
  }

  // ── 당일 접수 (Walk-in) ──
  async createWalkInVisit(dto: CreateWalkInVisitDto) {
    const program = await this.prisma.checkupProgram.findUnique({
      where: { id: dto.programId },
    });
    if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');
    if (!program.isActive)
      throw new BadRequestException('비활성 프로그램입니다');

    // 🔴 `scheduledDate` 는 `@db.Date` 다 — 로컬(KST) 자정을 넣으면 **UTC 기준 어제**로 저장된다.
    //    종전 `new Date(); setHours(0,0,0,0)` 이 정확히 그랬고, 오늘을 UTC 날짜로 읽는
    //    동선 현황판·스테이션 큐·대기 전광판이 **당일 접수 수검자를 한 명도 보지 못했다**.
    const { today, tomorrow } = todayRange();

    // 일일 용량 체크
    if (program.dailyCapacity) {
      const count = await this.prisma.checkupVisit.count({
        where: {
          programId: dto.programId,
          scheduledDate: { gte: today, lt: tomorrow },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      });
      if (count >= program.dailyCapacity)
        throw new BadRequestException(`오늘 검진 마감 (최대 ${program.dailyCapacity}명)`);
    }

    // 금액 계산
    let totalPrice = program.price;
    if (program.discountRate > 0) {
      totalPrice = Math.round(totalPrice * (1 - program.discountRate / 100));
    }
    if (dto.contractId) {
      const contract = await this.prisma.checkupContract.findUnique({
        where: { id: dto.contractId },
      });
      if (contract && contract.discountRate > 0) {
        totalPrice = Math.round(totalPrice * (1 - contract.discountRate / 100));
      }
    }
    totalPrice += this.sumSelectedOptions(program.options, dto.selectedOptions);

    // Visit 생성 (RESERVED → 즉시 checkIn)
    const visit = await this.prisma.checkupVisit.create({
      data: {
        patientId: dto.patientId,
        programId: dto.programId,
        scheduledDate: today,
        selectedOptions: dto.selectedOptions as unknown as Prisma.InputJsonValue,
        totalPrice,
        isNhiScreening: dto.isNhiScreening ?? false,
        nhiScreeningCode: dto.nhiScreeningCode,
        contractId: dto.contractId,
      },
      include: { program: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });

    this.journey?.emit({
      patientId: dto.patientId,
      eventType: 'CHECKUP_RESERVED',
      title: `${program.name} 당일 접수`,
      department: '건강검진센터',
      refType: 'CheckupVisit',
      refId: visit.id,
      navUrl: `/his-checkup/visit/${visit.id}`,
    });

    // 즉시 체크인
    const result = await this.checkIn(visit.id);
    return result;
  }

  // ── 예약 목록 ──
  async findVisits(query: {
    date?: string;
    status?: string;
    patientId?: string;
    contractId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.CheckupVisitWhereInput = {};
    if (query.date) where.scheduledDate = new Date(query.date);
    if (query.status) where.status = query.status;
    if (query.patientId) where.patientId = query.patientId;
    if (query.contractId) where.contractId = query.contractId;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.checkupVisit.findMany({
        where,
        include: {
          // 🔴 접수 모달이 price·discountRate·options 로 수납액을 계산하는데 select 에 없어
          //    `Intl.NumberFormat.format(undefined)` → **"NaN원"** 이 떴고 옵션 블록은 렌더조차 안 됐다(W5)
          program: { select: { code: true, name: true, category: true, duration: true, items: true, price: true, discountRate: true, options: true } },
          patient: {
            select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
          },
          _count: { select: { items: true } },
        },
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.checkupVisit.count({ where }),
    ]);

    return {
      data,
      pagination: { total, page, limit, hasMore: page * limit < total },
    };
  }

  // ── 예약 상세 ──
  async findVisit(id: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id },
      include: {
        program: true,
        patient: {
          select: {
            id: true, mrn: true, familyName: true, givenName: true,
            gender: true, dateOfBirth: true, phone: true, bloodType: true,
            insuranceType: true,
          },
        },
        items: { orderBy: { createdAt: 'asc' } },
        summary: { include: { doctor: { select: { id: true, familyName: true, givenName: true } } } },
        interpretations: { orderBy: { requestedAt: 'asc' } },
        referrals: true,
        followUps: true,
      },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    // 🔴 항목별 **분석물 목록**을 서버가 정한다 — 화면이 항목 이름으로 짐작하지 않게(P11·§resolveAnalytes).
    //    분해 입력이 가능한 항목만 `analytes` 가 2개 이상이고, 그것이 판정룰에 닿는 유일한 경로다.
    const programItems = (visit.program?.items as unknown as ProgramItem[]) ?? [];
    const selected = (visit.selectedOptions ?? []) as string[];
    const options = (visit.program?.options ?? []) as unknown as CheckupOption[];
    const codeByName = new Map<string, string[]>();
    for (const it of programItems) if (it?.name) codeByName.set(it.name, (it.codes ?? []).map(String));
    for (const o of options) {
      if (Array.isArray(selected) && selected.includes(o.id) && o.name) codeByName.set(o.name, (o.codes ?? []).map(String));
    }
    const allCodes = [...new Set([...codeByName.values()].flat())];
    const analyteDefs = await this.resolveAnalytes(allCodes);
    const defByCode = new Map(analyteDefs.map((a) => [a.code, a]));
    const items = visit.items.map((it) => {
      const codes = codeByName.get(it.testName) ?? [];
      const expanded = codes.flatMap((c) => {
        const panel = CheckupService.PANEL_ANALYTES[c];
        return panel ? panel.analytes.map((a) => a.code) : [c];
      });
      return {
        ...it,
        programCodes: codes,
        analytes: [...new Set(expanded)].map((c) => defByCode.get(c) ?? { code: c, name: c }),
      };
    });

    return { ...visit, items };
  }

  // ══════════════════════════════════════════════
  // 접수 (Check-in) — Phase 3+4 통합
  // ══════════════════════════════════════════════
  /**
   * 당일 접수.
   *
   * 🔴 `selectedOptions` 는 접수 창구에서 고른 추가 항목이다. 종전엔 화면이 옵션을 골라
   *    "총 수납 금액"까지 보여주면서 **서버로는 아무것도 보내지 않았다** — 실제 청구는
   *    예약 시점 금액으로 생성돼 화면과 달랐다(2026-08-13 W5).
   *    🔴 금액은 **서버가 프로그램 정가·할인·옵션가로 재계산**한다(클라이언트 금액 미신뢰).
   */
  async checkIn(id: string, selectedOptionIds?: string[]) {
    const visit = await this.findVisit(id);
    if (visit.status !== 'RESERVED')
      throw new BadRequestException('예약 상태에서만 접수 가능합니다');

    const programItems = visit.program.items as unknown as ProgramItem[];
    const programOptionsAll = (visit.program.options ?? []) as unknown as CheckupOption[];
    // 접수 시 전달된 선택이 있으면 그것이 정본(없으면 예약 시 저장분 유지)
    const selectedOpts = (selectedOptionIds ?? (visit.selectedOptions ?? [])) as string[];
    const validOptIds = selectedOpts.filter((oid) => programOptionsAll.some((o) => o.id === oid));
    const optionTotal = programOptionsAll
      .filter((o) => validOptIds.includes(o.id))
      .reduce((sum, o) => sum + (Number(o.price) || 0), 0);
    const base = Math.round(Number(visit.program.price ?? 0) * (1 - Number(visit.program.discountRate ?? 0) / 100));
    const chargeAmount = base + optionTotal;
    const programOptions = programOptionsAll;

    // 선택 옵션도 검사 항목에 포함
    const allItems: ProgramItem[] = [
      ...programItems,
      ...programOptions
        .filter((o) => validOptIds.includes(o.id))
        .map((o, idx) => ({
          seq: programItems.length + idx + 1,
          category: o.category,
          name: o.name,
          codes: o.codes,
        })),
    ];

    // ── 1. Encounter 생성 (검진용) ──
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    // 접수는 진료 생성·결과항목·청구·방문상태가 함께 성립해야 한다 — 부분 성공 시
    // 청구만 생성되고 방문이 열리지 않거나, 방문은 열렸는데 검사항목이 없는 상태가 남는다.
    // (2026-07 트랜잭션 경계 전수)
    const { encounter, updated, resultItems, interpretations } = await this.prisma.$transaction(async (tx) => {
      const encounter = await tx.encounter.create({
        data: {
          patientId: visit.patientId,
          doctorId: admin!.id,
          status: 'DRAFT',
          visitType: 'CHECKUP',
        },
      });

      // ── 2. 검사별 ResultItem 생성 (PENDING) + 판독 요청 ──
      const resultItems = [];
      const interpretations = [];

      // 배치 생성: ResultItems
      const filteredItems = allItems.filter(item => item.category !== 'CONSULT' && item.category !== 'AI');
      if (filteredItems.length > 0) {
        await tx.checkupResultItem.createMany({
          data: filteredItems.map(item => ({
            visitId: id,
            category: item.category,
            // 🔴 프로그램 항목의 검사코드를 결과항목에 **이어 붙인다**. 종전엔 버려서
            //    `testCode` 가 운영 전건 NULL 이었고, 판정룰(`ck_judgment_rules`)은
            //    testCode 로만 매칭하므로 어느 항목도 판정 대상이 되지 못했다.
            //    🔴 코드가 여럿인 묶음 항목(예: '혈액검사 (종합)' 14코드)은 **지어내지 않는다** —
            //       그 항목의 판정은 패널 분해 입력(addPanelResults)이 분석물 단위로 만든다.
            testCode: item.codes?.length === 1 ? item.codes[0] : null,
            testName: item.name,
            finding: 'PENDING',
          })),
        });
        // 생성된 ResultItems 조회 (ID 필요)
        const createdItems = await tx.checkupResultItem.findMany({
          where: { visitId: id },
          orderBy: { createdAt: 'asc' },
        });
        resultItems.push(...createdItems);

        // 배치 생성: Interpretations (판독 담당과가 있는 항목)
        // 🔴 **위치(index)로 짝짓지 않는다** — `createMany` 는 한 문장이라 전 행의 `createdAt` 이
        //    같고, 그러면 `orderBy: createdAt` 의 순서가 보장되지 않는다. 어긋나면 판독 요청이
        //    **엉뚱한 검사 항목**에 붙는다. 검사명으로 명시 매핑한다.
        const idByName = new Map(createdItems.map((r) => [r.testName, r.id]));
        const interpData = filteredItems
          .map((item) => item.interpretDept ? { visitId: id, resultItemId: idByName.get(item.name), department: item.interpretDept, status: 'REQUESTED' } : null)
          .filter((d): d is { visitId: string; resultItemId: string; department: string; status: string } => d !== null && !!d.resultItemId);
        if (interpData.length > 0) {
          await tx.checkupInterpretation.createMany({ data: interpData, skipDuplicates: true });
          const createdInterps = await tx.checkupInterpretation.findMany({ where: { visitId: id } });
          interpretations.push(...createdInterps);
        }
      }

      // ── 3. 수납 생성 (검진은 선불 — Billing CHECKUP) ──
      await tx.billing.create({
        data: {
          encounterId: encounter.id,
          patientId: visit.patientId,
          totalAmount: chargeAmount,
          insuranceCovered: 0,
          patientCopay: chargeAmount,
          status: 'PENDING',
          items: {
            create: [
              {
                codeType: 'CHECKUP',
                codeId: visit.programId,
                codeName: `${visit.program.name} (${visit.program.code})`,
                quantity: 1,
                unitPrice: chargeAmount,
                amount: chargeAmount,
                copayRate: 1.0,
                insuranceCategory: 'NON_COVERED',
              },
            ],
          },
        },
      });

      // ── 4. Visit 상태 업데이트 + 바코드 발급 ──
      const now = new Date();
      const barcode = `CK${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      const updated = await tx.checkupVisit.update({
        where: { id },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: now,
          barcodeNumber: barcode,
          encounterId: encounter.id,
          // 접수 창구에서 확정된 선택 옵션·금액을 방문에 기록 — 청구와 같은 사실을 보게 한다
          selectedOptions: validOptIds,
          totalPrice: chargeAmount,
        },
        include: {
          program: true,
          patient: { omit: PATIENT_SENSITIVE_OMIT },
          items: true,
        },
      });
      return { encounter, updated, resultItems, interpretations };
    });

    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'CHECKUP_CHECKIN',
      title: `건강검진 접수 (${visit.program.name}, ${resultItems.length}항목)`,
      department: '건강검진센터',
      refType: 'CheckupVisit',
      refId: id,
      navUrl: `/his-checkup/visit/${id}`,
    });

    return {
      ...updated,
      encounterId: encounter.id,
      resultItemCount: resultItems.length,
      interpretationCount: interpretations.length,
    };
  }

  // ── 상태 변경 ──
  async updateStatus(id: string, dto: UpdateCheckupVisitStatusDto) {
    const visit = await this.prisma.checkupVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    const allowed = STATUS_FLOW[visit.status] ?? [];
    if (!allowed.includes(dto.status))
      throw new BadRequestException(
        `${visit.status}에서 ${dto.status}로 변경할 수 없습니다`,
      );

    const data: Prisma.CheckupVisitUpdateInput = { status: dto.status };
    if (dto.status === 'CHECKED_IN') data.checkedInAt = new Date();
    if (dto.status === 'COMPLETED') data.completedAt = new Date();

    return this.prisma.checkupVisit.update({
      where: { id },
      data,
      include: { program: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
  }

  // ══════════════════════════════════════════════
  // 검사 순서표 — Phase 4 순서 최적화
  // ══════════════════════════════════════════════
  async getRouteSheet(id: string) {
    const visit = await this.findVisit(id);
    const programItems = visit.program.items as unknown as ProgramItem[];
    const selectedOpts = (visit.selectedOptions ?? []) as string[];
    const programOptions = (visit.program.options ?? []) as unknown as CheckupOption[];

    // 선택 옵션도 포함
    const allItems: ProgramItem[] = [
      ...programItems,
      ...programOptions
        .filter((o) => selectedOpts.includes(o.id))
        .map((o, idx) => ({
          seq: programItems.length + idx + 1,
          category: o.category,
          name: o.name,
          codes: o.codes,
          interpretDept: undefined as string | undefined,
        })),
    ];

    // 순서 최적화: 금식→신체계측→비침습→초음파→검체→침습→AI→상담
    const sorted = [...allItems].sort((a, b) => {
      const pa = getItemPriority(a);
      const pb = getItemPriority(b);
      if (pa !== pb) return pa - pb;
      return (a.seq ?? 0) - (b.seq ?? 0);
    });

    const resultMap = new Map(
      visit.items.map((item) => [item.testName, item]),
    );

    // 🔴 분해 입력 가능한 분석물은 **서버가 검사코드로** 정한다(화면이 항목 이름으로 짐작하지 않게).
    const analyteDefs = await this.resolveAnalytes([...new Set(allItems.flatMap((i) => i.codes ?? []))]);
    const defByCode = new Map(analyteDefs.map((a) => [a.code, a]));
    const analytesOf = (codes?: string[]) => {
      const expanded = (codes ?? []).flatMap((c) => {
        const panel = CheckupService.PANEL_ANALYTES[c];
        return panel ? panel.analytes.map((a) => a.code) : [c];
      });
      return [...new Set(expanded)].map((c) => defByCode.get(c) ?? { code: c, name: c });
    };

    return sorted.map((item, idx) => {
      const result = resultMap.get(item.name);
      return {
        seq: idx + 1,
        category: item.category,
        name: item.name,
        codes: item.codes,
        analytes: analytesOf(item.codes),
        interpretDept: item.interpretDept ?? null,
        status: result
          ? result.finding === 'PENDING'
            ? 'IN_PROGRESS'
            : 'COMPLETED'
          : 'WAITING',
        finding: result?.finding ?? null,
        value: result?.value ?? null,
        unit: result?.unit ?? null,
        completedAt: result?.completedAt ?? null,
      };
    });
  }

  // ── 패널 → 분석물 분해 맵 (결과 입력 시 분석물별 testCode 부여·프로토콜 판정) ──
  static readonly PANEL_ANALYTES: Record<string, { label: string; nameHint: string; analytes: { code: string; name: string; unit?: string }[] }> = {
    BP: { label: '혈압', nameHint: '혈압', analytes: [{ code: 'SBP', name: '수축기혈압', unit: 'mmHg' }, { code: 'DBP', name: '이완기혈압', unit: 'mmHg' }] },
    LIPID: { label: '지질검사', nameHint: '지질', analytes: [{ code: 'TC', name: '총콜레스테롤', unit: 'mg/dL' }, { code: 'LDL', name: 'LDL콜레스테롤', unit: 'mg/dL' }, { code: 'HDL', name: 'HDL콜레스테롤', unit: 'mg/dL' }, { code: 'TG', name: '중성지방', unit: 'mg/dL' }] },
    LFT: { label: '간기능검사', nameHint: '간기능', analytes: [{ code: 'AST', name: 'AST', unit: 'U/L' }, { code: 'ALT', name: 'ALT', unit: 'U/L' }, { code: 'GGT', name: 'γ-GTP', unit: 'U/L' }] },
    BUN_CR: { label: '신장기능', nameHint: '신장기능', analytes: [{ code: 'BUN', name: 'BUN', unit: 'mg/dL' }, { code: 'CR', name: '크레아티닌', unit: 'mg/dL' }] },
  };

  getPanelAnalytes() { return CheckupService.PANEL_ANALYTES; }

  /**
   * 검진 항목이 담고 있는 **분석물 목록**(판정룰이 매칭하는 단위).
   *
   * 🔴 종전에는 화면이 `항목명.startsWith(패널 힌트)`(`'혈압'|'지질'|'간기능'|'신장기능'`)로 짐작해
   *    분해 입력창을 열었다. 그런데 접수가 만드는 항목 이름은 **프로그램의 묶음 이름**이다 —
   *    운영 실측(2026-08-24) 프로그램 항목 이름 **38종 중 그 접두로 시작하는 것은 0개**.
   *    즉 분해 입력창이 실경로에서 **한 번도 열린 적이 없고**, 그것이 `testCode` 를 보내는
   *    유일한 화면이었다. 그래서 `checkup_result_items.test_code`·`grade` 는 **426/426 NULL**,
   *    ACTIVE 프로토콜의 판정룰 38개는 **개통 이래 매칭 0** 이었다(v4.4.0 DUR 43룰과 같은 유형).
   *
   * 정본은 이름이 아니라 **프로그램 항목의 `codes[]`** 다. 패널 키는 분석물로 펼치고,
   * 나머지는 검사항목 마스터에서 이름·단위·참고치를 가져온다.
   * 🔴 마스터에 없는 코드는 **이름을 지어내지 않고** 코드 그대로 둔다.
   */
  async resolveAnalytes(codes: string[]): Promise<{ code: string; name: string; unit?: string; referenceRange?: string; panelCode?: string }[]> {
    const out: { code: string; name: string; unit?: string; referenceRange?: string; panelCode?: string }[] = [];
    const plain: string[] = [];
    for (const raw of codes ?? []) {
      const code = String(raw ?? '').trim();
      if (!code) continue;
      const panel = CheckupService.PANEL_ANALYTES[code];
      if (panel) {
        for (const a of panel.analytes) out.push({ ...a, panelCode: code });
      } else {
        plain.push(code);
      }
    }
    if (plain.length) {
      const masters = await this.prisma.checkupTestMaster.findMany({
        where: { code: { in: plain } },
        select: { code: true, name: true, unit: true, referenceRange: true },
      });
      const byCode = new Map(masters.map((m) => [m.code, m]));
      for (const code of plain) {
        const m = byCode.get(code);
        out.push({ code, name: m?.name ?? code, unit: m?.unit ?? undefined, referenceRange: m?.referenceRange ?? undefined });
      }
    }
    // 같은 코드가 두 번 나오면 하나로
    const seen = new Set<string>();
    return out.filter((a) => (seen.has(a.code) ? false : (seen.add(a.code), true)));
  }

  /** 그 방문의 프로그램(+선택 옵션) 항목 이름 → 검사코드 목록 */
  private async itemCodeMap(visitId: string): Promise<Map<string, string[]>> {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      select: { selectedOptions: true, program: { select: { items: true, options: true } } },
    });
    const map = new Map<string, string[]>();
    if (!visit?.program) return map;
    const programItems = (visit.program.items as unknown as ProgramItem[]) ?? [];
    for (const it of programItems) if (it?.name) map.set(it.name, (it.codes ?? []).map(String));
    const selected = (visit.selectedOptions ?? []) as string[];
    const options = (visit.program.options ?? []) as unknown as CheckupOption[];
    for (const o of options) {
      if (Array.isArray(selected) && selected.includes(o.id) && o.name) map.set(o.name, (o.codes ?? []).map(String));
    }
    return map;
  }

  /**
   * 분석물 분해 입력 — 항목(또는 패널)을 분석물별 CheckupResultItem(`testCode`=분석물)으로 만들고
   * 각각 프로토콜 판정룰을 적용(addResult 재사용). 부모 항목은 **그 항목의 전 분석물**로 롤업.
   *
   * 🔴 롤업을 "이번에 입력한 것"만으로 계산하면, 한 항목에 패널이 둘 이상일 때
   *    나중 호출이 앞 호출의 이상소견을 덮는다(예: '혈액검사 (종합)' = 지질+간기능+신장기능).
   *    그래서 **저장된 전 분석물**을 다시 읽어 최악값을 낸다.
   */
  async addPanelResults(visitId: string, body: { panelCode?: string; category?: string; parentTestName?: string; values: Record<string, string | number> }) {
    const codeMap = await this.itemCodeMap(visitId);
    // 분석물 정의 해소: panelCode 지정(구 경로) > 부모 항목의 codes(정본)
    let analytes: { code: string; name: string; unit?: string }[];
    if (body.panelCode) {
      const panel = CheckupService.PANEL_ANALYTES[body.panelCode];
      if (!panel) throw new BadRequestException('알 수 없는 패널 코드입니다');
      analytes = panel.analytes;
    } else if (body.parentTestName) {
      analytes = await this.resolveAnalytes(codeMap.get(body.parentTestName) ?? []);
      if (!analytes.length) throw new BadRequestException(`'${body.parentTestName}' 항목에 분해 입력할 검사코드가 없습니다`);
    } else {
      throw new BadRequestException('panelCode 또는 parentTestName 이 필요합니다');
    }

    const known = new Set(analytes.map((a) => a.code));
    const unknown = Object.keys(body.values ?? {}).filter((k) => !known.has(k));
    if (unknown.length) throw new BadRequestException(`이 항목에 없는 검사코드입니다: ${unknown.join(', ')}`);

    const created: { finding: string; grade: string | null }[] = [];
    for (const a of analytes) {
      const v = body.values?.[a.code];
      if (v == null || String(v).trim() === '') continue;
      const r = await this.addResult(visitId, { category: body.category ?? 'LAB', testCode: a.code, testName: a.name, value: String(v), unit: a.unit });
      created.push({ finding: r.finding, grade: r.grade });
    }

    // 부모 항목 롤업(최악 finding·grade) — 저장된 전 분석물 기준
    if (body.parentTestName && created.length) {
      const allCodes = body.panelCode
        ? analytes.map((a) => a.code)
        : (await this.resolveAnalytes(codeMap.get(body.parentTestName) ?? [])).map((a) => a.code);
      const stored = await this.prisma.checkupResultItem.findMany({
        where: { visitId, testCode: { in: allCodes.length ? allCodes : ['__none__'] }, finding: { not: 'PENDING' } },
        select: { finding: true, grade: true },
      });
      const pool = stored.length ? stored : created;
      const fOrder = ['NORMAL', 'ABNORMAL', 'CRITICAL'];
      const worstFinding = pool.reduce((w, c) => (fOrder.indexOf(c.finding) > fOrder.indexOf(w) ? c.finding : w), 'NORMAL');
      const worstGrade = pool.map((c) => c.grade).filter(Boolean).sort().pop() ?? null;
      await this.prisma.checkupResultItem.updateMany({
        where: { visitId, testName: body.parentTestName },
        data: { finding: worstFinding, grade: worstGrade, value: `분해입력 ${pool.length}항목`, completedAt: new Date() },
      });
    }
    return { created: created.length, analytes: created };
  }

  // ── 결과 수동 입력 ──
  async addResult(
    visitId: string,
    body: {
      category: string;
      testCode?: string;
      testName: string;
      value?: string;
      unit?: string;
      referenceRange?: string;
      finding?: string;
      note?: string;
    },
  ) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    // ── P2 파이프라인 결선: testCode·value 있고 ACTIVE 프로토콜 룰 매칭 시 자동 판정(finding·grade) ──
    let autoFinding: string | undefined;
    let autoGrade: string | null | undefined;
    if (body.testCode && body.value != null && this.protocols) {
      const protocol = await this.resolveProtocolForVisit({ programId: visit.programId, patientId: visit.patientId });
      if (protocol) {
        const patient = await this.prisma.patient.findUnique({ where: { id: visit.patientId }, select: { gender: true, dateOfBirth: true } });
        let age: number | undefined;
        if (patient?.dateOfBirth) age = ageOf(patient.dateOfBirth) ?? undefined;
        const j = await this.protocols.judgeByProtocol(protocol.id, body.testCode, body.value, { sex: patient?.gender, age });
        if (j.matched) { autoFinding = j.finding; autoGrade = j.grade; }
      }
    }
    // 자동 판정 우선, 없으면 입력값(finding)
    const finding = autoFinding ?? body.finding ?? 'PENDING';
    const grade = autoGrade ?? undefined;

    const existing = await this.prisma.checkupResultItem.findFirst({
      where: { visitId, testName: body.testName },
    });

    if (existing) {
      return this.prisma.checkupResultItem.update({
        where: { id: existing.id },
        data: {
          testCode: body.testCode ?? existing.testCode,
          value: body.value,
          unit: body.unit,
          referenceRange: body.referenceRange,
          finding,
          ...(grade !== undefined ? { grade } : {}),
          note: body.note,
          completedAt: finding !== 'PENDING' ? new Date() : null,
        },
      });
    }

    return this.prisma.checkupResultItem.create({
      data: {
        visitId,
        category: body.category,
        testCode: body.testCode ?? null,
        testName: body.testName,
        value: body.value,
        unit: body.unit,
        referenceRange: body.referenceRange,
        finding,
        grade: grade ?? null,
        note: body.note,
        completedAt: finding !== 'PENDING' ? new Date() : null,
      },
    });
  }

  // ══════════════════════════════════════════════
  // Phase 6: 결과 자동수집 + 자동판정 + 영역별 집계
  // ══════════════════════════════════════════════

  async autoCollectResults(visitId: string) {
    const visit = await this.findVisit(visitId);
    const pendingItems = visit.items.filter((i) => i.finding === 'PENDING');
    let collected = 0;

    // 배치 조회: Lab 결과 (항목 flag 포함 — finding 판정에 필요)
    const labSourceIds = pendingItems.filter(i => i.sourceType === 'LAB_RESULT' && i.sourceId).map(i => i.sourceId!);
    const labResults = labSourceIds.length > 0
      ? await this.prisma.labResult.findMany({ where: { id: { in: labSourceIds }, status: 'COMPLETED' }, include: { items: { select: { flag: true } } } })
      : [];
    const labResultMap = new Map(labResults.map(r => [r.id, r]));
    // Lab 결과 항목 flag → 검진 finding(NORMAL/ABNORMAL/CRITICAL). 위급(H*/L*) > 이상(H/L) > 정상.
    //  (이전: flag 무관하게 항상 NORMAL로 일괄 처리 → 검진 중 이상·위급 검사값이 정상으로 은폐되던 결함)
    const labFinding = (r: { items: { flag: string | null }[] }): 'NORMAL' | 'ABNORMAL' | 'CRITICAL' => {
      const flags = r.items.map(it => (it.flag ?? '').trim().toUpperCase()).filter(Boolean);
      if (flags.some(f => f.includes('*') || f === 'HH' || f === 'LL')) return 'CRITICAL';
      if (flags.some(f => f.startsWith('H') || f.startsWith('L') || f === 'A')) return 'ABNORMAL';
      return 'NORMAL';
    };

    // 배치 조회: Imaging 결과
    const imgSourceIds = pendingItems.filter(i => i.sourceType === 'IMAGING_RESULT' && i.sourceId).map(i => i.sourceId!);
    const imgResults = imgSourceIds.length > 0
      ? await this.prisma.imagingResult.findMany({ where: { id: { in: imgSourceIds }, status: 'REPORTED' } })
      : [];
    const imgResultMap = new Map(imgResults.map(r => [r.id, r]));

    // 배치 업데이트 — 각 항목을 매칭 Lab 결과의 flag 기반 finding으로 판정(판정별 그룹 배치)
    const byFinding: Record<string, string[]> = { NORMAL: [], ABNORMAL: [], CRITICAL: [] };
    for (const i of pendingItems) {
      if (i.sourceType !== 'LAB_RESULT' || !i.sourceId) continue;
      const r = labResultMap.get(i.sourceId);
      if (!r) continue;
      byFinding[labFinding(r)].push(i.id);
    }
    for (const [finding, ids] of Object.entries(byFinding)) {
      if (ids.length === 0) continue;
      await this.prisma.checkupResultItem.updateMany({
        where: { id: { in: ids } },
        data: { finding, completedAt: new Date() },
      });
      collected += ids.length;
    }

    // 영상 항목 반영 배치 — 항목별 개별 update 순차 호출 제거 (2026-07 전체검토 D-5)
    const imgUpdates = pendingItems
      .filter((item) => item.sourceType === 'IMAGING_RESULT' && item.sourceId && imgResultMap.get(item.sourceId))
      .map((item) => {
        const imgResult = imgResultMap.get(item.sourceId!)!;
        return this.prisma.checkupResultItem.update({
          where: { id: item.id },
          data: { finding: imgResult.finding ? 'ABNORMAL' : 'NORMAL', value: imgResult.finding ?? undefined, completedAt: new Date() },
        });
      });
    if (imgUpdates.length) {
      await this.prisma.$transaction(imgUpdates);
      collected += imgUpdates.length;
    }

    // 판독 완료된 항목 반영 (트랜잭션 배치)
    const interps = await this.prisma.checkupInterpretation.findMany({
      where: { visitId, status: 'COMPLETED' },
    });
    const interpUpdates = interps
      .filter(interp => !!interp.grade)
      .map(interp => {
        const finding = interp.grade === 'A' ? 'NORMAL'
          : interp.grade === 'D1' || interp.grade === 'D2' || interp.grade === 'C2' ? 'CRITICAL'
          : 'ABNORMAL';
        return this.prisma.checkupResultItem.update({
          where: { id: interp.resultItemId },
          data: { finding, value: interp.finding ?? undefined, completedAt: new Date() },
        });
      });
    if (interpUpdates.length > 0) {
      await this.prisma.$transaction(interpUpdates);
      collected += interpUpdates.length;
    }

    // 모든 결과 완료 시 자동으로 EXAM_COMPLETE 전환
    const refreshedItems = await this.prisma.checkupResultItem.findMany({
      where: { visitId },
    });
    const stillPending = refreshedItems.filter((i) => i.finding === 'PENDING');
    const naItems = refreshedItems.filter((i) => i.finding === 'NOT_APPLICABLE');
    const allDone = refreshedItems.length > 0 && stillPending.length === 0;
    if (allDone && (visit.status === 'IN_PROGRESS' || visit.status === 'CHECKED_IN')) {
      const nextStatus = naItems.length > 0 ? 'PARTIAL_COMPLETE' : 'EXAM_COMPLETE';
      await this.prisma.checkupVisit.update({
        where: { id: visitId },
        data: { status: nextStatus },
      });
    }

    /**
     * 🔴 **자동수집의 대상이 될 수 있는 항목이 몇 개인지 함께 낸다.**
     *    검사·영상 자동수집은 전적으로 `sourceType`/`sourceId`(원자료 연결)에 걸려 있는데,
     *    **그 두 필드에 값을 쓰는 코드가 이 저장소에 하나도 없다**(시드 포함 — 운영 실측
     *    2026-08-24 `checkup_result_items` 426/426 NULL). 즉 이 버튼은 개통 이래 항상
     *    `collected: 0` 이었고, 화면은 그것을 "0건 수집 완료"라고 말했다(P17 — 눌렀으니 됐다고 읽힌다).
     *    막지 않는다(수동 입력 경로가 정본이다). **셀 수 있게 드러낸다.**
     */
    const linkedPending = pendingItems.filter((i) => i.sourceType && i.sourceId).length;
    return {
      collected,
      total: pendingItems.length,
      /** 원자료(검사·영상 결과)에 연결돼 있어 자동수집 대상이 되는 대기 항목 수 */
      linkedPending,
      /** 연결이 없어 자동수집으로는 결코 채워지지 않는 대기 항목 수 — 수동 입력이 필요하다 */
      unlinkedPending: pendingItems.length - linkedPending,
      allDone,
    };
  }

  // ── 자동판정: 개별 항목 판정 (참조범위 기반) ──
  private autoJudgeFinding(value: string | null, referenceRange: string | null): string {
    if (!value || !referenceRange) return 'PENDING';

    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      // 비수치 결과 (정상/이상 텍스트)
      const lower = value.toLowerCase();
      if (lower.includes('정상') || lower.includes('normal') || lower.includes('negative'))
        return 'NORMAL';
      if (lower.includes('이상') || lower.includes('abnormal') || lower.includes('positive'))
        return 'ABNORMAL';
      return 'PENDING';
    }

    // 범위 파싱: "4000-10000", "~40", "0-1.0", "<5.7"
    const rangeMatch = referenceRange.match(/([<>~]?)(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/);
    if (rangeMatch) {
      const low = parseFloat(rangeMatch[2]);
      const high = parseFloat(rangeMatch[3]);
      if (numValue < low || numValue > high) {
        const deviation = numValue < low
          ? (low - numValue) / low
          : (numValue - high) / high;
        return deviation > 0.3 ? 'CRITICAL' : 'ABNORMAL';
      }
      return 'NORMAL';
    }

    // 단일 상한: "~40" or "<40"
    const upperMatch = referenceRange.match(/[<~]\s*(\d+\.?\d*)/);
    if (upperMatch) {
      const upper = parseFloat(upperMatch[1]);
      if (numValue > upper) {
        return (numValue - upper) / upper > 0.3 ? 'CRITICAL' : 'ABNORMAL';
      }
      return 'NORMAL';
    }

    return 'PENDING';
  }

  // ── 영역별 판정 집계 (Grade 산출) ──
  async generateGradeSummary(visitId: string) {
    const items = await this.prisma.checkupResultItem.findMany({
      where: { visitId },
    });

    // 영역별 그룹핑
    const areaMap: Record<string, { items: typeof items; grade: string }> = {};
    const AREA_MAPPING: Record<string, string> = {
      '혈액검사': '혈액검사',
      '간기능': '간기능',
      '당뇨': '당뇨검사',
      '지질': '지질대사',
      '신기능': '신기능',
      '소변검사': '소변검사',
      '대변검사': '대변검사',
      '흉부': '흉부영상',
      '심전도': '심전도',
      '초음파': '복부초음파',
      '위장': '위장검사',
      '갑상선': '갑상선',
    };

    for (const item of items) {
      let area = item.category;
      // 검사명에서 영역 매칭
      for (const [keyword, areaName] of Object.entries(AREA_MAPPING)) {
        if (item.testName.includes(keyword)) {
          area = areaName;
          break;
        }
      }
      if (!areaMap[area]) areaMap[area] = { items: [], grade: 'A' };
      areaMap[area].items.push(item);
    }

    // 영역별 최악 등급 산출
    const GRADE_ORDER = ['A', 'B', 'C1', 'C2', 'D1', 'D2'];
    // 🔴 미측정(PENDING)은 'A(정상)'이 아니다. 종전엔 등급을 A 로 시작해 ABNORMAL/CRITICAL 만 올렸기에
    //    **검사를 하나도 안 한 방문이 "종합판정 A · 전 영역 정상"** 으로 나왔다(2026-08-13 W5 실측:
    //    13항목 전부 PENDING 인데 overallGrade 'A', 결과항목 0개인 방문도 'A').
    //    그 상태로 결과서가 발급번호·QR 과 함께 발급된다. 모르는 것을 최선값으로 말하지 않는다.
    const sections = Object.entries(areaMap).map(([area, data]) => {
      let worstGrade: string | null = null;   // null = 아직 판정 근거 없음
      let pendingCount = 0;
      const findings: string[] = [];

      for (const item of data.items) {
        if (item.finding === 'PENDING') { pendingCount++; continue; }
        if (item.finding === 'NOT_APPLICABLE') continue;  // 스킵은 정상도 이상도 아니다
        const grade = item.finding === 'CRITICAL' ? 'C1' : item.finding === 'ABNORMAL' ? 'B' : 'A';
        if (worstGrade == null || GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(worstGrade)) {
          worstGrade = grade;
        }
        if (item.finding !== 'NORMAL' && item.value) {
          findings.push(`${item.testName} ${item.value}${item.unit ?? ''}`);
        }
      }

      return {
        area,
        grade: worstGrade,   // null = 미판정(화면·결과지는 '판정 불가'로 말해야 한다)
        pendingCount,
        findings: worstGrade == null ? '미검사' : findings.length > 0 ? findings.join(', ') : '정상',
      };
    });

    // 전체 등급 = 판정된 것 중 가장 심한 것. 판정된 영역이 하나도 없으면 **null(판정 불가)**.
    const graded = sections.filter((s) => s.grade != null);
    const overallGrade = graded.length === 0
      ? null
      : graded.reduce<string>((worst, sec) => (
        GRADE_ORDER.indexOf(sec.grade as string) > GRADE_ORDER.indexOf(worst) ? (sec.grade as string) : worst
      ), 'A');

    return { overallGrade, sections };
  }

  // ══════════════════════════════════════════════
  // Phase 7: 과별 판독
  // ══════════════════════════════════════════════

  async findInterpretations(where: Record<string, unknown>) {
    return this.prisma.checkupInterpretation.findMany({
      where,
      include: {
        visit: {
          include: {
            patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
            program: { select: { code: true, name: true } },
          },
        },
        resultItem: { select: { id: true, testName: true, category: true } },
        doctor: { select: { id: true, familyName: true, givenName: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async completeInterpretation(
    id: string,
    body: { finding: string; grade: string; recommendation?: string },
    userId: string,
  ) {
    const interp = await this.prisma.checkupInterpretation.findUnique({
      where: { id },
    });
    if (!interp) throw new NotFoundException('판독 요청을 찾을 수 없습니다');
    // 🔴 (2026-09-16 E1) 종전엔 현재 상태를 보지 않아 **이미 완료된 판독을 다시 완료**할 수 있었다 —
    //    소견·등급과 함께 `interpretedBy`·`interpretedAt` 이 덮어써져 **누가 언제 판독했는지**가 사라지고,
    //    연계된 ResultItem 의 판정(NORMAL/ABNORMAL/CRITICAL)도 조용히 바뀌었다. 검진 결과서에 실리는 임상 판정이다.
    if (interp.status === 'COMPLETED') {
      throw new BadRequestException({
        code: 'CHECKUP_INTERPRETATION_ALREADY_COMPLETED',
        message: '이미 판독이 완료되었습니다 — 판독자와 판독 시각은 덮어쓰지 않습니다',
        details: { interpretedBy: interp.interpretedBy, interpretedAt: interp.interpretedAt },
      });
    }

    // ResultItem에도 반영
    const resultFinding = body.grade === 'A' ? 'NORMAL'
      : ['C2', 'D1'].includes(body.grade) ? 'CRITICAL'
      : 'ABNORMAL';

    // 🔴 (2026-09-16 J1) 종전엔 판독 완료가 단독 커밋되고 ResultItem 반영이 별도 쓰기였다.
    //    사이에 실패하면 판독은 COMPLETED 인데 **결과 항목에 임상 판정(NORMAL/ABNORMAL/CRITICAL)이 없다** —
    //    그런데 바로 위 E1 가드(이미 완료면 거부)가 **재시도를 막아** 판정이 영원히 안 붙는다.
    //    검진 결과서에 실리는 판정이라 비면 위험한 등급(C2·D1)이 조용히 사라진다. 두 쓰기를 한 트랜잭션에.
    const updated = await this.prisma.$transaction(async (tx) => {
      const interpretation = await tx.checkupInterpretation.update({
        where: { id },
        data: {
          finding: body.finding,
          grade: body.grade,
          recommendation: body.recommendation,
          interpretedBy: userId,
          interpretedAt: new Date(),
          status: 'COMPLETED',
        },
      });
      await tx.checkupResultItem.update({
        where: { id: interp.resultItemId },
        data: {
          finding: resultFinding,
          value: body.finding,
          completedAt: new Date(),
        },
      });
      return interpretation;
    });

    return updated;
  }

  // ── 환자별 검진 이력 (차트 연동용) ──
  async getPatientCheckupHistory(patientId: string) {
    const visits = await this.prisma.checkupVisit.findMany({
      where: { patientId, status: { in: ['COMPLETED', 'DELIVERED'] } },
      include: {
        program: { select: { code: true, name: true, category: true } },
        summary: { select: { overallGrade: true, sections: true, doctorOpinion: true, signedAt: true, reviewedBy: true } },
        _count: { select: { items: true, referrals: true, followUps: true } },
      },
      orderBy: { scheduledDate: 'desc' },
      take: 10,
    });

    return visits;
  }

  // ── 결과 비교 (최근 N회 검진 수치 비교) ──
  async getCheckupComparison(patientId: string, limit = 5) {
    const visits = await this.prisma.checkupVisit.findMany({
      where: { patientId, status: { in: ['COMPLETED', 'DELIVERED'] } },
      include: {
        program: { select: { code: true, name: true } },
        items: {
          where: { finding: { not: 'PENDING' } },
          select: { testName: true, value: true, unit: true, referenceRange: true, finding: true },
        },
        summary: { select: { overallGrade: true, sections: true } },
      },
      orderBy: { scheduledDate: 'asc' },
      take: limit,
    });

    // 검사항목별로 시계열 데이터 구성
    const testMap: Record<string, { testName: string; unit?: string; referenceRange?: string; dataPoints: { date: string; value: string; finding: string; program: string }[] }> = {};

    for (const visit of visits) {
      const date = visit.scheduledDate instanceof Date
        ? visit.scheduledDate.toISOString().slice(0, 10)
        : String(visit.scheduledDate).slice(0, 10);

      for (const item of visit.items) {
        if (!item.value) continue;
        if (!testMap[item.testName]) {
          testMap[item.testName] = {
            testName: item.testName,
            unit: item.unit ?? undefined,
            referenceRange: item.referenceRange ?? undefined,
            dataPoints: [],
          };
        }
        testMap[item.testName].dataPoints.push({
          date,
          value: item.value,
          finding: item.finding,
          program: visit.program.name,
        });
      }
    }

    // 2회 이상 데이터가 있는 항목만 반환 (비교 의미 있는 것)
    const trends = Object.values(testMap).filter((t) => t.dataPoints.length >= 2);

    // 등급 변화 타임라인
    const gradeTimeline = visits.map((v) => ({
      date: v.scheduledDate instanceof Date
        ? v.scheduledDate.toISOString().slice(0, 10)
        : String(v.scheduledDate).slice(0, 10),
      program: v.program.name,
      overallGrade: v.summary?.overallGrade ?? null,
      sections: v.summary?.sections ?? null,
    }));

    return { trends, gradeTimeline, visitCount: visits.length };
  }

  // ── 종합소견 작성 ──
  async createSummary(visitId: string, dto: CreateCheckupSummaryDto, userId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    const existing = await this.prisma.checkupSummary.findUnique({
      where: { visitId },
    });

    // 서명된 결과서는 무단 수정 불가 — 서명(signedAt) 후 덮어쓰기는 서명 의료문서의 변조.
    //  정정이 필요하면 별도 정정(amend)·재서명 절차를 거쳐야 함.
    if (existing?.signedAt) {
      throw new BadRequestException({ code: 'SUMMARY_ALREADY_SIGNED', message: '서명된 결과서는 수정할 수 없습니다. 정정이 필요하면 재서명 절차를 이용하세요.' });
    }

    if (existing) {
      return this.prisma.checkupSummary.update({
        where: { visitId },
        data: {
          overallGrade: dto.overallGrade,
          sections: dto.sections as unknown as Prisma.InputJsonValue,
          doctorOpinion: dto.doctorOpinion,
          recommendations: dto.recommendations as unknown as Prisma.InputJsonValue,
          reviewedBy: userId,
          // 최초 작성자 보존(4-eyes 판정용). 미설정 시에만 기록.
          authoredBy: existing.authoredBy ?? userId,
        },
      });
    }

    return this.prisma.checkupSummary.create({
      data: {
        visitId,
        overallGrade: dto.overallGrade,
        sections: dto.sections as unknown as Prisma.InputJsonValue,
        doctorOpinion: dto.doctorOpinion,
        recommendations: dto.recommendations as unknown as Prisma.InputJsonValue,
        reviewedBy: userId,
        authoredBy: userId,
      },
    });
  }

  /**
   * 결과서 서명 전 검토 완료 점검(게이트). 미완료 판독·소견 누락·미수집 결과를 차단 사유로 반환.
   * ready=true 여야 서명 가능(서명 EP에서 force 미지정 시 강제).
   */
  /** visit에 적용되는 ACTIVE 검진 프로토콜 해소(프로그램·환자 성별/연령). 프로토콜 모듈 없으면 null. */
  private async resolveProtocolForVisit(visit: { programId?: string | null; patientId: string }) {
    if (!this.protocols) return null;
    const patient = await this.prisma.patient.findUnique({
      where: { id: visit.patientId },
      select: { gender: true, dateOfBirth: true },
    });
    let age: number | undefined;
    if (patient?.dateOfBirth) age = ageOf(patient.dateOfBirth) ?? undefined;
    return this.protocols.resolve({ programId: visit.programId ?? undefined, sex: patient?.gender, age });
  }

  async getResultReadiness(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    const [summary, pendingInterp, totalInterp, totalItems, pendingItems, protocol] = await Promise.all([
      this.prisma.checkupSummary.findUnique({ where: { visitId } }),
      this.prisma.checkupInterpretation.count({ where: { visitId, status: { not: 'COMPLETED' } } }),
      this.prisma.checkupInterpretation.count({ where: { visitId } }),
      this.prisma.checkupResultItem.count({ where: { visitId } }),
      // 🔴 접수 시 전 항목이 PENDING 으로 **미리 생성**된다 — 행 수는 '결과가 있다'는 뜻이 아니다.
      //    종전 게이트가 행 수만 봐서, 검사를 하나도 안 한 방문도 결과서 서명이 통과했다(W5).
      this.prisma.checkupResultItem.count({ where: { visitId, finding: 'PENDING' } }),
      this.resolveProtocolForVisit(visit),
    ]);
    const completedItems = totalItems - pendingItems;

    // 프로토콜이 requireAllInterpretations=false 면 미완료 판독을 게이트하지 않음(기본·프로토콜 없으면 게이트)
    const enforcePending = protocol ? protocol.requireAllInterpretations : true;

    const blockers: { code: string; message: string }[] = [];
    if (totalItems === 0) blockers.push({ code: 'NO_RESULTS', message: '수집된 검사 결과가 없습니다.' });
    else if (completedItems === 0) blockers.push({ code: 'ALL_PENDING', message: `검사 결과가 하나도 입력되지 않았습니다(전 ${totalItems}항목 대기).` });
    else if (pendingItems > 0) blockers.push({ code: 'PENDING_RESULTS', message: `미완료 검사 ${pendingItems}건이 있습니다.` });
    if (enforcePending && pendingInterp > 0) blockers.push({ code: 'PENDING_INTERPRETATION', message: `미완료 판독 ${pendingInterp}건이 있습니다.` });
    if (!summary) blockers.push({ code: 'NO_SUMMARY', message: '종합소견이 작성되지 않았습니다.' });
    else {
      if (!summary.overallGrade) blockers.push({ code: 'NO_GRADE', message: '종합 판정등급이 없습니다.' });
      const sections = Array.isArray(summary.sections) ? summary.sections : [];
      if (!sections.length) blockers.push({ code: 'NO_SECTIONS', message: '영역별 판정이 없습니다.' });
    }
    if (summary?.signedAt) blockers.push({ code: 'ALREADY_SIGNED', message: '이미 서명된 결과서입니다.' });

    return {
      ready: blockers.length === 0,
      blockers,
      pendingInterpretations: pendingInterp,
      totalInterpretations: totalInterp,
      resultItemCount: totalItems,
      completedItemCount: completedItems,
      pendingItemCount: pendingItems,
      hasSummary: !!summary,
      signed: !!summary?.signedAt,
      protocol: protocol ? { id: protocol.id, code: protocol.code, name: protocol.name, signerRoles: protocol.signerRoles, requireFourEyes: protocol.requireFourEyes, requireAllInterpretations: protocol.requireAllInterpretations } : null,
    };
  }

  // ── 의사 서명 ──
  async signSummary(visitId: string, userId: string, force = false) {
    const summary = await this.prisma.checkupSummary.findUnique({
      where: { visitId },
    });
    if (!summary) throw new NotFoundException('종합소견을 찾을 수 없습니다');
    // 🔴 (2026-09-16 E1) 종전엔 서명 여부를 보지 않아 **서명된 결과서에 다시 서명**할 수 있었다 —
    //    `signedBy`·`signedAt`·`reviewedBy` 가 뒤 사람으로 덮어써져 **실제 서명한 의사**가 기록에서 사라졌다
    //    (D1 이 병리 보고서에서 고친 것과 같은 자리). 서명은 일어난 사실이고 결과서는 법정 기록이다.
    if (summary.signedAt) {
      throw new BadRequestException({
        code: 'CHECKUP_SUMMARY_ALREADY_SIGNED',
        message: '이미 서명된 결과서입니다 — 서명자와 서명 시각은 덮어쓰지 않습니다',
        details: { signedBy: summary.signedBy, signedAt: summary.signedAt },
      });
    }

    // force(강제 서명)는 검토 게이트·서명자격·4-eyes를 모두 우회하므로 ADMIN 전용.
    //  (이전: ENCOUNTER_CREATE 권한자면 누구나 force=true로 미검토 결과·비자격자 서명 가능하던 결함)
    //  사람 결정 대기: `policy.clinical.gateOverrideAuthority` — 강제 서명 권한·표시/사유 기록(현재 결과서에 강제 여부가 남지 않음)
    if (force) {
      const actor = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
      if (actor?.role !== 'ADMIN') {
        throw new ForbiddenException({ code: 'FORCE_REQUIRES_ADMIN', message: '강제 서명(force)은 관리자만 가능합니다.' });
      }
    }

    // ── 프로토콜 기반 의사 인증: 서명 자격(signerRoles) + 4-eyes(작성≠서명) ──
    const visitMeta = await this.prisma.checkupVisit.findUnique({ where: { id: visitId }, select: { programId: true, patientId: true } });
    const protocol = visitMeta ? await this.resolveProtocolForVisit(visitMeta) : null;
    if (protocol && !force && userId) {
      const signer = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      const allowed = protocol.signerRoles?.length ? protocol.signerRoles : ['DOCTOR'];
      if (!signer || !allowed.includes(signer.role)) {
        throw new BadRequestException({ code: 'SIGNER_NOT_AUTHORIZED', message: `결과서 서명 자격이 없습니다(허용 역할: ${allowed.join(', ')}).` });
      }
      if (protocol.requireFourEyes && summary.authoredBy && summary.authoredBy === userId) {
        throw new BadRequestException({ code: 'FOUR_EYES_REQUIRED', message: '4-eyes 정책: 작성자와 다른 의사가 검토·서명해야 합니다.' });
      }
    }

    // 검토 완료 게이트 — force(ADMIN 강제) 아니면 차단 사유 검증
    if (!force) {
      const readiness = await this.getResultReadiness(visitId);
      if (!readiness.ready) {
        throw new BadRequestException({
          code: 'RESULT_NOT_READY',
          message: `결과서 검토가 완료되지 않았습니다: ${readiness.blockers.map((b) => b.message).join(' ')}`,
          blockers: readiness.blockers,
        });
      }
    }

    /**
     * 🔴 (2026-09-16 H4) 결과서 서명과 방문 완료는 **한 트랜잭션**이다. 종전엔 서명을 먼저 커밋하고
     *    방문 전이를 따로 했다 — 뒤가 실패하면 결과서는 서명됐는데 방문은 미완료로 남고, 바로 위
     *    재서명 차단(E1)이 재시도를 막아 **그 방문이 영구히 COMPLETED 로 가지 못한다**(여정 이벤트·
     *    결과 알림·결과서 발급도 함께 영영 일어나지 않는다).
     */
    const signedAt = new Date();
    const visit = await this.prisma.$transaction(async (tx) => {
      await tx.checkupSummary.update({
        where: { visitId },
        data: { signedAt, signedBy: userId, reviewedBy: userId },
      });
      return tx.checkupVisit.update({
        where: { id: visitId },
        data: { status: 'COMPLETED', completedAt: signedAt },
        include: { summary: true, items: true, program: true },
      });
    });

    // ── HIS 역방향 동기: Encounter 완료 + 이상소견 Condition 생성 ──
    await this.syncCheckupToHIS(visit, summary, userId);

    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'CHECKUP_COMPLETE',
      title: `종합판정 ${visit.summary?.overallGrade ?? '-'}등급 — 의사 서명 완료`,
      department: '건강검진센터',
      doctorId: userId,
      refType: 'CheckupSummary',
      refId: summary.id,
      navUrl: `/his-checkup/visit/${visitId}`,
      episode: { type: 'CheckupVisit', id: visitId }, occurredAt: signedAt, // 여정 P1: 판정 서명 시각(방문 완료 시각과 같은 값)
    });

    // SSE 알림 발송
    this.eventEmitter.emit('checkup.result_ready', {
      patientId: visit.patientId,
      visitId,
      overallGrade: visit.summary?.overallGrade,
    });

    // ── 결과서 정식 발급(IssuedDocument: 발급번호·진위 QR·동결 snapshot). 멱등·best-effort ──
    const issueNo = await this.issueResultDocument(visit, userId);

    return { signed: true, issueNo };
  }

  /**
   * 검진 결과서 발급 — 서명 완료 시 IssuedDocument(documentType=CHECKUP_RESULT) 생성.
   * 동일 visit 재발급 방지(멱등: sourceId 기존 발급 재사용). 발급 실패는 서명에 영향 없음(best-effort).
   */
  private async issueResultDocument(visit: any, userId: string): Promise<string | null> {
    if (!this.documents) return null;
    try {
      const existing = await this.prisma.issuedDocument.findFirst({
        where: { documentType: 'CHECKUP_RESULT', sourceId: visit.id },
        select: { issueNo: true },
      });
      if (existing) return existing.issueNo;
      const issued = await this.documents.issue(
        {
          documentType: 'CHECKUP_RESULT',
          sourceId: visit.id,
          patientId: visit.patientId,
          snapshot: {
            visitId: visit.id,
            programName: visit.program?.name ?? null,
            scheduledDate: visit.scheduledDate ?? null,
            overallGrade: visit.summary?.overallGrade ?? null,
            sections: visit.summary?.sections ?? null,
            recommendations: visit.summary?.recommendations ?? null,
            doctorOpinion: visit.summary?.doctorOpinion ?? null,
            resultItemCount: Array.isArray(visit.items) ? visit.items.length : 0,
            signedAt: new Date().toISOString(),
          },
        },
        userId,
      );
      this.logger.log(`검진 결과서 발급: visit=${visit.id} issueNo=${issued.issueNo}`);
      return issued.issueNo;
    } catch (e) {
      this.logger.warn(`검진 결과서 발급 실패 visit=${visit.id}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** HIS 역방향 동기: 검진 결과를 HIS 진료기록(Encounter/Diagnosis)에 반영 */
  private async syncCheckupToHIS(
    visit: any,
    summary: any,
    doctorId: string,
  ) {
    if (!visit.encounterId) return;

    // 1. Encounter 상태를 COMPLETED로 전환 + 검진 소견 기록
    const sections = (summary.sections ?? []) as Array<{ area: string; grade: string; items: any[] }>;
    const abnormalFindings = sections
      .filter((s: any) => s.grade && s.grade !== 'A')
      .map((s: any) => `[${s.grade}] ${s.area}`)
      .join(', ');

    /**
     * 🔴 (2026-09-16 K1) 진료 서명·소견·진단코드가 따로 커밋됐다 — Encounter 를 SIGNED 로 올린 뒤
     *    진단(Z00.0) 생성이 실패하면 **청구 근거(주상병) 없는 서명 진료**가 남는다. 서명 이벤트는 이미
     *    나갔고(청구 자동 생성), 검진 결과서 재서명은 E1 가드가 막아 이 경로로 다시 채울 수 없다.
     *    셋을 한 트랜잭션으로 묶는다.
     */
    await this.prisma.$transaction(async (tx) => {
    await tx.encounter.update({
      where: { id: visit.encounterId },
      data: {
        status: 'SIGNED',
        // 담당의를 실 서명 검진의로 보정(기존 ADMIN 폴백 버그 수정)
        doctorId,
        assessment: `건강검진 종합판정: ${summary.overallGrade ?? '-'}등급${abnormalFindings ? ` (이상: ${abnormalFindings})` : ''}`,
        plan: summary.recommendations ?? summary.doctorOpinion ?? null,
        signedAt: new Date(),
        signedBy: doctorId,
      },
    });

    // 2. 이상소견 → Encounter objective에 검사결과 요약 기록
    const abnormalItems = (visit.items ?? []).filter(
      (item: any) => item.finding && !['PENDING', 'NORMAL', '정상', 'A'].includes(item.finding),
    );
    if (abnormalItems.length > 0) {
      const objectiveSummary = abnormalItems
        .map((item: any) => `• ${item.testName}: ${item.finding}${item.value ? ` (${item.value}${item.unit ? ' ' + item.unit : ''})` : ''}`)
        .join('\n');
      await tx.encounter.update({
        where: { id: visit.encounterId },
        data: { objective: objectiveSummary },
      });
    }

    // 3. Z00.0 진단코드가 있으면 EncounterDiagnosis 생성 (검진 이력 연동)
    const grade = summary.overallGrade;
    if (grade && ['C1', 'C2', 'D1', 'D2', 'R'].includes(grade)) {
      const z00Code = await tx.diagnosisCode.findFirst({
        where: { code: 'Z00.0', isActive: true },
      });
      if (z00Code) {
        // 기존 주상병이 있으면 부상병으로 생성 — PRIMARY 2개(rank 중복)면 청구 주상병이 비결정적
        const [existingPrimary, agg] = await Promise.all([
          tx.encounterDiagnosis.findFirst({ where: { encounterId: visit.encounterId, type: 'PRIMARY' } }),
          tx.encounterDiagnosis.aggregate({ where: { encounterId: visit.encounterId }, _max: { rank: true } }),
        ]);
        await tx.encounterDiagnosis.create({
          data: {
            encounterId: visit.encounterId,
            diagnosisCodeId: z00Code.id,
            type: existingPrimary ? 'SECONDARY' : 'PRIMARY',
            rank: existingPrimary ? (agg._max.rank ?? 1) + 1 : 1,
            // 🔴 (2026-09-15 D3) 소견이 없을 때 '추적관찰/치료 필요'를 적었다 — 아무도 내리지 않은 **임상 권고**가
            //    진단 기록(청구 근거)에 남았다. 없는 소견은 없다고 적는다(P15).
            notes: `건강검진 ${grade}등급 — ${summary.doctorOpinion ?? '소견 미기재'}`,
          },
        });
      }
    }
    });
  }

  // ══════════════════════════════════════════════
  // 예약 취소
  // ══════════════════════════════════════════════
  async cancelVisit(id: string, reason?: string) {
    const visit = await this.prisma.checkupVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');
    if (visit.status !== 'RESERVED')
      throw new BadRequestException('예약 상태에서만 취소 가능합니다');

    // 당일 취소 제한 (접수 2시간 전까지만 허용)
    const now = new Date();
    const scheduled = new Date(visit.scheduledDate);
    scheduled.setHours(0, 0, 0, 0);
    const diffMs = scheduled.getTime() - now.getTime();
    if (diffMs < 2 * 60 * 60 * 1000 && diffMs >= 0)
      throw new BadRequestException('검진 당일 2시간 전부터는 취소할 수 없습니다. 전화 문의 바랍니다.');

    const updated = await this.prisma.checkupVisit.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        ...(reason ? { selectedOptions: { cancelReason: reason } as unknown as Prisma.InputJsonValue } : {}),
      },
      include: { program: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });

    this.journey?.emit({
      patientId: visit.patientId,
      eventType: 'CHECKUP_CANCELLED',
      title: `건강검진 예약 취소${reason ? ` (${reason})` : ''}`,
      department: '건강검진센터',
      refType: 'CheckupVisit',
      refId: id,
    });

    return updated;
  }

  // ══════════════════════════════════════════════
  // 예약 변경 (날짜/프로그램)
  // ══════════════════════════════════════════════
  async rescheduleVisit(id: string, body: { scheduledDate?: string; programId?: string }) {
    const visit = await this.prisma.checkupVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');
    if (visit.status !== 'RESERVED')
      throw new BadRequestException('예약 상태에서만 변경 가능합니다');

    const data: Prisma.CheckupVisitUpdateInput = {};
    if (body.scheduledDate) data.scheduledDate = checkupDateOnly(body.scheduledDate, '예약일');
    if (body.programId) {
      const program = await this.prisma.checkupProgram.findUnique({ where: { id: body.programId } });
      if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');
      if (!program.isActive) throw new BadRequestException('비활성 프로그램입니다');
      data.program = { connect: { id: body.programId } };
      let totalPrice = program.price;
      if (program.discountRate > 0) totalPrice = Math.round(totalPrice * (1 - program.discountRate / 100));
      data.totalPrice = totalPrice;
    }

    return this.prisma.checkupVisit.update({
      where: { id },
      data,
      include: { program: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
    });
  }

  // ══════════════════════════════════════════════
  // 검사 항목 스킵 (수검자 거부/금기)
  // ══════════════════════════════════════════════
  async skipResultItem(visitId: string, testName: string, reason: string) {
    const item = await this.prisma.checkupResultItem.findFirst({
      where: { visitId, testName },
    });
    if (!item) throw new NotFoundException(`검사 항목 '${testName}'을 찾을 수 없습니다`);
    if (item.finding !== 'PENDING')
      throw new BadRequestException('대기 상태의 항목만 스킵 가능합니다');

    const updated = await this.prisma.checkupResultItem.update({
      where: { id: item.id },
      data: {
        finding: 'NOT_APPLICABLE',
        note: reason,
        completedAt: new Date(),
      },
    });

    await this.checkAutoStatusTransition(visitId);
    return updated;
  }

  // ══════════════════════════════════════════════
  // 미방문(No-show) 일괄 처리
  // ══════════════════════════════════════════════
  async processNoShows() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    const result = await this.prisma.checkupVisit.updateMany({
      where: {
        status: 'RESERVED',
        scheduledDate: { lte: yesterday },
      },
      data: { status: 'NO_SHOW' },
    });

    this.logger.log(`No-show 처리: ${result.count}건`);
    return { processed: result.count };
  }

  // ══════════════════════════════════════════════
  // 대기 안내 디스플레이 (Phase 7)
  // ══════════════════════════════════════════════
  async getDisplayData() {
    const { today, tomorrow } = todayRange();

    const visits = await this.prisma.checkupVisit.findMany({
      where: {
        scheduledDate: { gte: today, lt: tomorrow },
        status: { in: ['CHECKED_IN', 'IN_PROGRESS', 'EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW'] },
      },
      include: {
        patient: { select: { familyName: true, givenName: true, gender: true } },
        program: { select: { name: true, duration: true } },
      },
      orderBy: { checkedInAt: 'asc' },
    });

    const statusGroups: Record<string, typeof visits> = {};
    for (const v of visits) {
      const group = v.status === 'CHECKED_IN' ? '대기'
        : v.status === 'IN_PROGRESS' ? '검사중'
        : v.status === 'EXAM_COMPLETE' || v.status === 'PARTIAL_COMPLETE' ? '검사완료'
        : '소견대기';
      if (!statusGroups[group]) statusGroups[group] = [];
      statusGroups[group].push(v);
    }

    // 🔴 공개 전광판 마스킹 정본 = `홍○동`(ER 흐름·외래 호출과 동일 규약).
    //    종전 `김*진` 은 `*` 반복이라 **이름 길이가 노출**됐고 정본이 셋이 됐다(P12·2026-08-13 W5).
    // 🔴 필드 화이트리스트 — 화면이 쓰지 않는 것(gender·status 원문)은 공개 응답에 싣지 않는다.
    const GROUP_ORDER = ['대기', '검사중', '검사완료', '소견대기'];
    return {
      groups: GROUP_ORDER.map((label) => {
        const items = statusGroups[label] ?? [];
        return {
          label,
          count: items.length,
          items: items.map((v) => ({
            id: v.id,
            name: maskPublicName(v.patient.familyName, v.patient.givenName),
            program: v.program.name,
            // 미접수(checkedInAt null)를 0분으로 말하지 않는다 — 모름은 null
            waitMinutes: v.checkedInAt ? Math.round((Date.now() - new Date(v.checkedInAt).getTime()) / 60000) : null,
          })),
        };
      }),
      total: visits.length,
      timestamp: new Date().toISOString(),
    };
  }

  // ══════════════════════════════════════════════
  // 매출 통계 (Phase 8)
  // ══════════════════════════════════════════════
  async getRevenueStats(query: { from?: string; to?: string }) {
    assertDateParam(query.from, '조회 시작일');
    assertDateParam(query.to, '조회 종료일');
    const where: Prisma.CheckupVisitWhereInput = {
      status: { in: ['COMPLETED', 'DELIVERED'] },
    };
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) dateFilter.lte = new Date(query.to);
      where.scheduledDate = dateFilter;
    }

    const visits = await this.prisma.checkupVisit.findMany({
      where,
      include: {
        program: { select: { code: true, name: true, category: true } },
        contract: { select: { companyName: true } },
      },
    });

    const totalRevenue = visits.reduce((sum, v) => sum + v.totalPrice, 0);
    const individualRevenue = visits.filter((v) => !v.contractId).reduce((sum, v) => sum + v.totalPrice, 0);
    const corporateRevenue = visits.filter((v) => v.contractId).reduce((sum, v) => sum + v.totalPrice, 0);

    // 프로그램별
    const byProgram: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const v of visits) {
      const key = v.program.code;
      if (!byProgram[key]) byProgram[key] = { name: v.program.name, count: 0, revenue: 0 };
      byProgram[key].count++;
      byProgram[key].revenue += v.totalPrice;
    }

    // 월별 추이
    const byMonth: Record<string, number> = {};
    for (const v of visits) {
      const month = v.scheduledDate instanceof Date
        ? v.scheduledDate.toISOString().slice(0, 7)
        : String(v.scheduledDate).slice(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + v.totalPrice;
    }

    return {
      totalRevenue,
      individualRevenue,
      corporateRevenue,
      visitCount: visits.length,
      // 표본이 없으면 '산출 불가'(null) — 0원은 "건당 0원"이라는 사실 주장이 된다(P1-ⓐ)
      avgRevenuePerVisit: visits.length > 0 ? Math.round(totalRevenue / visits.length) : null,
      byProgram: Object.values(byProgram).sort((a, b) => b.revenue - a.revenue),
      byMonth: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ month, revenue })),
    };
  }

  // ── 연령·성별 분포 (Phase 8) ──
  async getDemographicStats(query: { from?: string; to?: string }) {
    assertDateParam(query.from, '조회 시작일');
    assertDateParam(query.to, '조회 종료일');
    const where: Prisma.CheckupVisitWhereInput = {
      status: { in: ['COMPLETED', 'DELIVERED'] },
    };
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) dateFilter.lte = new Date(query.to);
      where.scheduledDate = dateFilter;
    }

    const visits = await this.prisma.checkupVisit.findMany({
      where,
      include: {
        patient: { select: { gender: true, dateOfBirth: true } },
      },
    });

    const ageGroups: Record<string, { male: number; female: number }> = {
      '20대': { male: 0, female: 0 },
      '30대': { male: 0, female: 0 },
      '40대': { male: 0, female: 0 },
      '50대': { male: 0, female: 0 },
      '60대': { male: 0, female: 0 },
      '70대+': { male: 0, female: 0 },
    };

    let maleCount = 0;
    let femaleCount = 0;
    let otherCount = 0;      // OTHER·UNKNOWN — 여성으로 세지 않는다
    let unknownDobCount = 0; // 생년월일 미상 — 연령대 버킷에 못 넣지만 총계에는 있다

    for (const v of visits) {
      // 🔴 `gender === 'MALE' ? male : female` 은 OTHER·UNKNOWN 을 여성으로 계수한다
      //    (W1 의 대기열 전원 여성과 같은 이진 단정 — 집계 쪽은 스윕에서 빠져 있었다).
      const g = v.patient.gender;
      if (g === 'MALE') maleCount++;
      else if (g === 'FEMALE') femaleCount++;
      else otherCount++;

      const dob = v.patient.dateOfBirth;
      if (!dob) { unknownDobCount++; continue; }
      const age = ageOf(dob) ?? 0;
      // 🔴 10대 수검자가 '20대'로 계수되던 것 — 30세 미만이 전부 20대는 아니다
      const group = age < 20 ? '10대 이하' : age < 30 ? '20대' : age < 40 ? '30대' : age < 50 ? '40대' : age < 60 ? '50대' : age < 70 ? '60대' : '70대+';
      if (!ageGroups[group]) ageGroups[group] = { male: 0, female: 0 };
      if (g === 'MALE') ageGroups[group].male++;
      else if (g === 'FEMALE') ageGroups[group].female++;
    }

    return {
      total: visits.length,
      maleCount,
      femaleCount,
      otherCount,
      unknownDobCount, // 버킷 합 ≠ 총계인 이유를 화면이 말할 수 있게 한다
      maleRatio: visits.length > 0 ? Math.round((maleCount / visits.length) * 100) : null,
      ageGroups,
    };
  }

  // ── 유소견율 분석 (Phase 8) ──
  async getFindingRateStats(query: { from?: string; to?: string }) {
    assertDateParam(query.from, '조회 시작일');
    assertDateParam(query.to, '조회 종료일');
    const where: Prisma.CheckupResultItemWhereInput = {};
    if (query.from || query.to) {
      // 🔴 completedAt 은 timestamptz 다 — `lte = 2026-05-30`(=그날 00:00Z)로 자르면 **그날 하루가
      //    통째로 빠진다**. 실측: 5/30 까지 조회 시 유소견율 14.3%(14항목), 5/31 까지면 26.0%(227항목)
      //    — 213/227(94%)이 유실됐다(2026-08-13 W5). 종료일은 **다음 날 00:00 미만**으로 잡는다.
      //    (scheduledDate 는 date-only 라 lte 가 옳다 — 두 축의 규칙이 다르다.)
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setDate(end.getDate() + 1);
        (dateFilter as Record<string, Date>).lt = end;
      }
      where.completedAt = dateFilter;
    }

    const total = await this.prisma.checkupResultItem.count({
      where: { ...where, finding: { not: 'PENDING' } },
    });
    const abnormal = await this.prisma.checkupResultItem.count({
      where: { ...where, finding: 'ABNORMAL' },
    });
    const critical = await this.prisma.checkupResultItem.count({
      where: { ...where, finding: 'CRITICAL' },
    });

    // 검사항목별 유소견율
    const byTest = await this.prisma.checkupResultItem.groupBy({
      by: ['testName'],
      where: { ...where, finding: { not: 'PENDING' } },
      _count: true,
    });

    const abnormalByTest = await this.prisma.checkupResultItem.groupBy({
      by: ['testName'],
      where: { ...where, finding: { in: ['ABNORMAL', 'CRITICAL'] } },
      _count: true,
    });

    const totalMap = new Map(byTest.map((t) => [t.testName, t._count]));
    const abnormalMap = new Map(abnormalByTest.map((t) => [t.testName, t._count]));

    const rates = [...totalMap.entries()].map(([testName, totalCount]) => {
      const abnCount = abnormalMap.get(testName) ?? 0;
      return {
        testName,
        totalCount,
        abnormalCount: abnCount,
        rate: totalCount > 0 ? Math.round((abnCount / totalCount) * 1000) / 10 : 0,
      };
    }).sort((a, b) => b.rate - a.rate);

    return {
      totalItems: total,
      abnormalItems: abnormal,
      criticalItems: critical,
      overallRate: total > 0 ? Math.round(((abnormal + critical) / total) * 1000) / 10 : null,
      byTest: rates.slice(0, 20),
    };
  }

  // ── 월간 보고서 (Phase 8) ──
  async getMonthlyReport(yearMonth: string) {
    // 🔴 `yearMonth` 가 없으면 `undefined.slice(...)` 로 **500** 이 났다(운영 실측).
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new BadRequestException('조회할 연월을 YYYY-MM 형식으로 지정해주세요');
    }
    // yearMonth: "2026-05"
    const from = `${yearMonth}-01`;
    const lastDay = new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)), 0).getDate();
    const to = `${yearMonth}-${lastDay}`;

    const [stats, revenue, demographics, findingRate, todayStats] = await Promise.all([
      this.getStats({ from, to }),
      this.getRevenueStats({ from, to }),
      this.getDemographicStats({ from, to }),
      this.getFindingRateStats({ from, to }),
      this.getTodayStats(),
    ]);

    // 전월 비교
    const prevDate = new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevLastDay = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
    const prevRevenue = await this.getRevenueStats({ from: `${prevMonth}-01`, to: `${prevMonth}-${prevLastDay}` });

    const revenueGrowth = prevRevenue.totalRevenue > 0
      ? Math.round(((revenue.totalRevenue - prevRevenue.totalRevenue) / prevRevenue.totalRevenue) * 100)
      : 0;

    return {
      yearMonth,
      period: { from, to },
      summary: {
        totalVisits: revenue.visitCount,
        totalRevenue: revenue.totalRevenue,
        avgRevenuePerVisit: revenue.avgRevenuePerVisit,
        revenueGrowthPct: revenueGrowth,
        overallFindingRate: findingRate.overallRate,
        maleRatio: demographics.maleRatio,
        totalPrograms: stats.length,
      },
      programStats: stats,
      revenueByProgram: revenue.byProgram,
      demographics: demographics.ageGroups,
      topFindings: findingRate.byTest.slice(0, 10),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 추적 관리 생성 ──
  async createFollowUp(
    visitId: string,
    body: {
      followUpType: string;
      description: string;
      dueDate: string;
    },
  ) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    return this.prisma.checkupFollowUp.create({
      data: {
        visitId,
        patientId: visit.patientId,
        followUpType: body.followUpType,
        description: body.description,
        // `dueDate` 는 `@db.Date` — 정본 비교값으로 저장한다(하루 밀림 방지)
        dueDate: checkupDateOnly(body.dueDate, '추적 예정일'),
      },
    });
  }

  // ── 외래 의뢰 생성 ──
  async createReferral(
    visitId: string,
    body: {
      resultItemId?: string;
      toDepartment: string;
      reason: string;
      urgency?: string;
    },
  ) {
    return this.prisma.checkupReferral.create({
      data: {
        visitId,
        resultItemId: body.resultItemId || undefined, // '' 는 미지정(uuid 컬럼에 '' 는 Prisma 500)
        toDepartment: body.toDepartment,
        reason: body.reason,
        urgency: body.urgency ?? 'ROUTINE',
      },
    });
  }

  // ── 오늘 현황 통계 ──
  async getTodayStats() {
    const { today, tomorrow } = todayRange();

    const where = {
      OR: [
        { scheduledDate: { gte: today, lt: tomorrow } },
        { checkedInAt: { gte: today, lt: tomorrow } },
      ],
    };

    const [reserved, checkedIn, inProgress, examComplete, review, completed] =
      await Promise.all([
        this.prisma.checkupVisit.count({ where: { ...where, status: 'RESERVED' } }),
        this.prisma.checkupVisit.count({ where: { ...where, status: 'CHECKED_IN' } }),
        this.prisma.checkupVisit.count({ where: { ...where, status: 'IN_PROGRESS' } }),
        this.prisma.checkupVisit.count({ where: { ...where, status: 'EXAM_COMPLETE' } }),
        this.prisma.checkupVisit.count({ where: { ...where, status: 'REVIEW' } }),
        this.prisma.checkupVisit.count({ where: { ...where, status: { in: ['COMPLETED', 'DELIVERED'] } } }),
      ]);

    return {
      reserved,
      checkedIn,
      inProgress,
      examComplete,
      review,
      completed,
      total: reserved + checkedIn + inProgress + examComplete + review + completed,
    };
  }

  // ── 프로그램별 통계 ──
  async getStats(query: { from?: string; to?: string }) {
    assertDateParam(query.from, '조회 시작일');
    assertDateParam(query.to, '조회 종료일');
    const where: Prisma.CheckupVisitWhereInput = {};
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) dateFilter.lte = new Date(query.to);
      where.scheduledDate = dateFilter;
    }

    const visits = await this.prisma.checkupVisit.groupBy({
      by: ['programId', 'status'],
      where,
      _count: true,
    });

    const programs = await this.prisma.checkupProgram.findMany({
      select: { id: true, code: true, name: true, category: true },
    });

    const programMap = new Map(programs.map((p) => [p.id, p]));
    const stats: Record<string, { program: typeof programs[number]; total: number; byStatus: Record<string, number> }> = {};

    for (const v of visits) {
      const prog = programMap.get(v.programId);
      if (!prog) continue;
      if (!stats[v.programId]) {
        stats[v.programId] = {
          program: prog,
          total: 0,
          byStatus: {},
        };
      }
      stats[v.programId].total += v._count;
      stats[v.programId].byStatus[v.status] = v._count;
    }

    return Object.values(stats);
  }

  // ── 이상소견 통계 ──
  async getAbnormalStats(query: { from?: string; to?: string }) {
    assertDateParam(query.from, '조회 시작일');
    assertDateParam(query.to, '조회 종료일');
    const where: Prisma.CheckupResultItemWhereInput = { finding: { in: ['ABNORMAL', 'CRITICAL'] } };
    if (query.from || query.to) {
      // 🔴 completedAt 은 timestamptz 다 — `lte = 2026-05-30`(=그날 00:00Z)로 자르면 **그날 하루가
      //    통째로 빠진다**. 실측: 5/30 까지 조회 시 유소견율 14.3%(14항목), 5/31 까지면 26.0%(227항목)
      //    — 213/227(94%)이 유실됐다(2026-08-13 W5). 종료일은 **다음 날 00:00 미만**으로 잡는다.
      //    (scheduledDate 는 date-only 라 lte 가 옳다 — 두 축의 규칙이 다르다.)
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setDate(end.getDate() + 1);
        (dateFilter as Record<string, Date>).lt = end;
      }
      where.completedAt = dateFilter;
    }

    const items = await this.prisma.checkupResultItem.groupBy({
      by: ['testName', 'finding'],
      where,
      _count: true,
      orderBy: { _count: { visitId: 'desc' } },
    });

    // 검사명별 집계
    const byTest: Record<string, { abnormal: number; critical: number }> = {};
    for (const item of items) {
      if (!byTest[item.testName]) byTest[item.testName] = { abnormal: 0, critical: 0 };
      if (item.finding === 'ABNORMAL') byTest[item.testName].abnormal = item._count;
      if (item.finding === 'CRITICAL') byTest[item.testName].critical = item._count;
    }

    return Object.entries(byTest)
      .map(([testName, counts]) => ({
        testName,
        ...counts,
        total: counts.abnormal + counts.critical,
      }))
      .sort((a, b) => b.total - a.total);
  }

  // ══════════════════════════════════════════════
  // Phase 11: 추적 관리
  // ══════════════════════════════════════════════

  async findFollowUps(query: { dueFrom?: string; dueTo?: string; completed?: string }) {
    const where: Prisma.CheckupFollowUpWhereInput = {};
    if (query.dueFrom || query.dueTo) {
      const dateFilter: Record<string, Date> = {};
      if (query.dueFrom) dateFilter.gte = new Date(query.dueFrom);
      if (query.dueTo) dateFilter.lte = new Date(query.dueTo);
      where.dueDate = dateFilter;
    }
    if (query.completed === 'true') {
      where.completedAt = { not: null };
    } else if (query.completed === 'false') {
      where.completedAt = null;
    }

    return this.prisma.checkupFollowUp.findMany({
      where,
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, phone: true },
        },
        visit: {
          select: { id: true, scheduledDate: true, programId: true, program: { select: { code: true, name: true } } },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 100,
    });
  }

  async completeFollowUp(id: string) {
    const followUp = await this.prisma.checkupFollowUp.findUnique({ where: { id } });
    if (!followUp) throw new NotFoundException('추적 항목을 찾을 수 없습니다');

    return this.prisma.checkupFollowUp.update({
      where: { id },
      data: { completedAt: new Date() },
    });
  }

  // ══════════════════════════════════════════════
  // 검사실별 워크스테이션
  // ══════════════════════════════════════════════

  // 스테이션 → 카테고리 매핑
  static readonly STATION_MAP: Record<string, { categories: string[]; names?: string[] }> = {
    'blood': { categories: ['LAB'], names: ['혈액검사', '채혈'] },
    'urine': { categories: ['LAB'], names: ['소변검사', '대변검사'] },
    'xray': { categories: ['IMAGING'], names: ['흉부 X-ray'] },
    'ultrasound': { categories: ['IMAGING'], names: ['초음파'] },
    'ecg': { categories: ['DIAGNOSTIC'], names: ['심전도'] },
    'endoscopy': { categories: ['DIAGNOSTIC'], names: ['위장검사', '내시경', '대장내시경'] },
    'physical': { categories: ['PHYSICAL'] },
    'eye': { categories: ['DIAGNOSTIC'], names: ['안과검사', '안압', '안저'] },
    'pulmonary': { categories: ['DIAGNOSTIC'], names: ['호흡기능검사'] },
  };

  async getStationQueue(station: string) {
    const stationDef = CheckupService.STATION_MAP[station];
    if (!stationDef) throw new BadRequestException(`알 수 없는 스테이션: ${station}`);

    const { today, tomorrow } = todayRange();

    // 오늘 접수 이상 상태의 방문 중 해당 스테이션 항목이 있는 건
    const visits = await this.prisma.checkupVisit.findMany({
      where: {
        scheduledDate: { gte: today, lt: tomorrow },
        status: { in: ['CHECKED_IN', 'IN_PROGRESS', 'EXAM_COMPLETE'] },
      },
      include: {
        patient: {
          select: { id: true, mrn: true, familyName: true, givenName: true, gender: true, dateOfBirth: true },
        },
        program: { select: { code: true, name: true, items: true } },
        items: true,
      },
      orderBy: { checkedInAt: 'asc' },
    });

    // 각 방문에서 이 스테이션에 해당하는 항목만 필터
    const queue = [];
    for (const visit of visits) {
      const programItems = (visit.program.items as unknown as ProgramItem[]) ?? [];
      const stationItems = programItems.filter((pi: ProgramItem) => {
        if (stationDef.names?.some((n) => pi.name.includes(n))) return true;
        if (!stationDef.names && stationDef.categories.includes(pi.category)) return true;
        return false;
      });

      if (stationItems.length === 0) continue;

      // ResultItem에서 해당 항목의 완료 상태 확인
      const resultMap = new Map(visit.items.map((r) => [r.testName, r]));
      const itemStatuses = stationItems.map((si: ProgramItem) => {
        const result = resultMap.get(si.name);
        return {
          name: si.name,
          category: si.category,
          codes: si.codes,
          resultId: result?.id ?? null,
          finding: result?.finding ?? 'PENDING',
          value: result?.value ?? null,
          unit: result?.unit ?? null,
          completedAt: result?.completedAt ?? null,
        };
      });

      const allDone = itemStatuses.every((s) => s.finding !== 'PENDING');
      if (allDone) continue; // 이미 완료된 건 스킵

      const age = ageOf(visit.patient.dateOfBirth) ?? null;

      queue.push({
        visitId: visit.id,
        patient: { ...visit.patient, age },
        program: visit.program,
        checkedInAt: visit.checkedInAt,
        items: itemStatuses,
        completedCount: itemStatuses.filter((s) => s.finding !== 'PENDING').length,
        totalCount: itemStatuses.length,
      });
    }

    return queue;
  }

  async stationCompleteItem(
    visitId: string,
    body: {
      testName: string;
      value?: string;
      unit?: string;
      referenceRange?: string;
      finding: string;
      note?: string;
    },
  ) {
    // 기존 addResult와 동일하지만, 완료 상태를 강제
    const existing = await this.prisma.checkupResultItem.findFirst({
      where: { visitId, testName: body.testName },
    });

    const data = {
      value: body.value,
      unit: body.unit,
      referenceRange: body.referenceRange,
      finding: body.finding,
      note: body.note,
      completedAt: new Date(),
    };

    if (existing) {
      const updated = await this.prisma.checkupResultItem.update({
        where: { id: existing.id },
        data,
      });

      // 해당 방문의 모든 항목이 완료되었으면 상태 자동 전환
      await this.checkAutoStatusTransition(visitId);
      return updated;
    }

    // ResultItem이 아직 없으면 카테고리 추론
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: { program: true },
    });
    const programItems = (visit?.program?.items as unknown as ProgramItem[]) ?? [];
    const matchItem = programItems.find((pi) => pi.name === body.testName);

    const created = await this.prisma.checkupResultItem.create({
      data: {
        visitId,
        category: matchItem?.category ?? 'LAB',
        testName: body.testName,
        ...data,
      },
    });

    await this.checkAutoStatusTransition(visitId);
    return created;
  }

  private async checkAutoStatusTransition(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({ where: { id: visitId } });
    if (!visit || !['CHECKED_IN', 'IN_PROGRESS'].includes(visit.status)) return;

    const [totalCount, pendingCount] = await Promise.all([
      this.prisma.checkupResultItem.count({ where: { visitId } }),
      this.prisma.checkupResultItem.count({ where: { visitId, finding: 'PENDING' } }),
    ]);

    if (visit.status === 'CHECKED_IN' && totalCount > 0 && pendingCount < totalCount) {
      // 하나라도 완료 → IN_PROGRESS
      await this.prisma.checkupVisit.update({ where: { id: visitId }, data: { status: 'IN_PROGRESS' } });
    }
    if (pendingCount === 0 && totalCount > 0) {
      // 모두 완료 → EXAM_COMPLETE (NOT_APPLICABLE 있으면 PARTIAL_COMPLETE)
      const naCount = await this.prisma.checkupResultItem.count({ where: { visitId, finding: 'NOT_APPLICABLE' } });
      const nextStatus = naCount > 0 ? 'PARTIAL_COMPLETE' : 'EXAM_COMPLETE';
      await this.prisma.checkupVisit.update({ where: { id: visitId }, data: { status: nextStatus } });
    }
  }
}
