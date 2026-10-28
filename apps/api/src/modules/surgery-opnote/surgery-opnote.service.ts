import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SurgeryAdvancedService } from '../surgery/surgery-advanced.service';

/**
 * 🔴 모르는 시각을 원장에 박지 않는다 — 파싱 불가한 문자열은 `Invalid Date` 로 조용히 저장되지 않고
 *    400 으로 거절한다(수술기록은 법정기록이다). 빈 문자열은 '미기재'(undefined)다.
 */
function parseClinicalTime(value: string | undefined, field: string): Date | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      code: 'OPNOTE_INVALID_TIME',
      message: `${field} 시각을 해석할 수 없습니다(${value}) — 저장하지 않습니다.`,
    });
  }
  return d;
}

@Injectable()
export class SurgeryOpnoteService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Get Op Note ───── */

  async getOpNote(surgeryId: string) {
    const note = await this.prisma.surgeryOpNote.findUnique({
      where: { surgeryId },
      include: {
        surgery: { select: { id: true, status: true, scheduledAt: true } },
        creator: { select: { familyName: true, givenName: true } },
      },
    });
    if (!note) throw new NotFoundException(`Op note not found for surgery ${surgeryId}`);
    return note;
  }

  /* ───── Create Op Note ───── */

  async createOpNote(data: {
    surgeryId: string;
    preOpDiagnosis?: string;
    postOpDiagnosis?: string;
    procedureCode?: string;
    assistants?: unknown;
    anesthesiaType?: string;
    incisionTime?: string;
    closureTime?: string;
    findings?: string;
    specimens?: unknown;
    estimatedBloodLoss?: number;
    fluidBalance?: unknown;
    implants?: unknown;
    drains?: unknown;
    narrative?: string;
    postOpOrders?: string;
    asaClass?: number;
    mallampatiClass?: number;
    npoStatus?: unknown;
    prophylacticAbx?: string;
    vteProphylaxis?: boolean;
    whoChecklist?: unknown;
    complicationGrade?: string;
    complications?: string;
    createdBy: string;
  }) {
    return this.prisma.surgeryOpNote.create({
      data: {
        surgeryId: data.surgeryId,
        preOpDiagnosis: data.preOpDiagnosis,
        postOpDiagnosis: data.postOpDiagnosis,
        procedureCode: data.procedureCode,
        assistants: data.assistants as never,
        anesthesiaType: data.anesthesiaType,
        incisionTime: parseClinicalTime(data.incisionTime, '절개'),
        closureTime: parseClinicalTime(data.closureTime, '봉합'),
        findings: data.findings,
        specimens: data.specimens as never,
        estimatedBloodLoss: data.estimatedBloodLoss,
        fluidBalance: data.fluidBalance as never,
        implants: data.implants as never,
        drains: data.drains as never,
        narrative: data.narrative,
        postOpOrders: data.postOpOrders,
        asaClass: data.asaClass,
        mallampatiClass: data.mallampatiClass,
        npoStatus: data.npoStatus as never,
        prophylacticAbx: data.prophylacticAbx,
        vteProphylaxis: data.vteProphylaxis,
        whoChecklist: data.whoChecklist as never,
        complicationGrade: data.complicationGrade,
        complications: data.complications,
        createdBy: data.createdBy,
      },
      include: {
        surgery: { select: { id: true, status: true } },
        creator: { select: { familyName: true, givenName: true } },
      },
    });
  }

  /* ───── Update Op Note ───── */

  async updateOpNote(id: string, data: {
    preOpDiagnosis?: string;
    postOpDiagnosis?: string;
    procedureCode?: string;
    assistants?: unknown;
    anesthesiaType?: string;
    incisionTime?: string;
    closureTime?: string;
    findings?: string;
    specimens?: unknown;
    estimatedBloodLoss?: number;
    fluidBalance?: unknown;
    implants?: unknown;
    drains?: unknown;
    narrative?: string;
    postOpOrders?: string;
    asaClass?: number;
    mallampatiClass?: number;
    npoStatus?: unknown;
    prophylacticAbx?: string;
    vteProphylaxis?: boolean;
    whoChecklist?: unknown;
    complicationGrade?: string;
    complications?: string;
  }) {
    const existing = await this.prisma.surgeryOpNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Op note ${id} not found`);

    return this.prisma.surgeryOpNote.update({
      where: { id },
      data: {
        preOpDiagnosis: data.preOpDiagnosis,
        postOpDiagnosis: data.postOpDiagnosis,
        procedureCode: data.procedureCode,
        assistants: data.assistants as never,
        anesthesiaType: data.anesthesiaType,
        incisionTime: parseClinicalTime(data.incisionTime, '절개'),
        closureTime: parseClinicalTime(data.closureTime, '봉합'),
        findings: data.findings,
        specimens: data.specimens as never,
        estimatedBloodLoss: data.estimatedBloodLoss,
        fluidBalance: data.fluidBalance as never,
        implants: data.implants as never,
        drains: data.drains as never,
        narrative: data.narrative,
        postOpOrders: data.postOpOrders,
        asaClass: data.asaClass,
        mallampatiClass: data.mallampatiClass,
        npoStatus: data.npoStatus as never,
        prophylacticAbx: data.prophylacticAbx,
        vteProphylaxis: data.vteProphylaxis,
        whoChecklist: data.whoChecklist as never,
        complicationGrade: data.complicationGrade,
        complications: data.complications,
      },
      include: {
        surgery: { select: { id: true, status: true } },
        creator: { select: { familyName: true, givenName: true } },
      },
    });
  }

  /* ───── WHO Checklist ───── */

  /**
   * WHO 수술 안전 체크리스트 조회.
   *
   * 🔴 정본은 `SurgicalChecklist`(항목 단위 · `/api/v1/surgery/:id/checklist`) **하나**다.
   *    종전에는 이 EP 가 `SurgeryOpNote.whoChecklist`(JSON 3-boolean)를 읽었는데
   *    그 컬럼을 쓰는 화면이 **하나도 없었다** — 즉 같은 사실의 두 번째 정본이 늘 `false` 를
   *    돌려주는 고아 EP 였다(P12). 이제 정본에서 파생한다.
   *    · 수술기록(Op Note)이 없어도 체크리스트는 존재할 수 있으므로 Op Note 부재로 404 하지 않는다.
   *    · 단계 완료 판정은 `${phase}CompletedAt` 스탬프가 아니라 **필수항목 전량 충족**으로 센다
   *      (스탬프는 완료 순간에만 찍히지만, 판정의 근거는 항목 자체다).
   *    · 남아 있는 레거시 JSON 이 정본과 어긋나면 숨기지 않고 `legacyOpNoteBlob` 로 드러낸다.
   */
  async getWhoChecklist(surgeryId: string) {
    const [note, cl] = await Promise.all([
      this.prisma.surgeryOpNote.findUnique({ where: { surgeryId }, select: { whoChecklist: true } }),
      this.prisma.surgicalChecklist.findUnique({ where: { surgeryId } }),
    ]);
    if (!cl) {
      throw new NotFoundException({
        code: 'SURGERY_CHECKLIST_NOT_FOUND',
        message: `수술 안전 체크리스트가 아직 작성되지 않았습니다 (surgery ${surgeryId})`,
      });
    }
    const p = SurgeryAdvancedService.computeProgress(cl as unknown as Record<string, boolean>);
    const legacy = (note?.whoChecklist as Record<string, unknown> | null) ?? null;
    return {
      surgeryId,
      source: 'SurgicalChecklist',
      signIn: p.signIn.requiredComplete,
      timeOut: p.timeOut.requiredComplete,
      signOut: p.signOut.requiredComplete,
      complete: p.signIn.requiredComplete && p.timeOut.requiredComplete && p.signOut.requiredComplete,
      progress: p,
      completedAt: { signIn: cl.signInCompletedAt, timeOut: cl.timeOutCompletedAt, signOut: cl.signOutCompletedAt },
      countStatus: cl.countStatus,
      // 레거시 컬럼은 읽히지 않는 사본이다 — 값이 남아 있으면 감춰서 "정본이 둘"인 상태를 숨기지 않는다.
      legacyOpNoteBlob: legacy,
    };
  }
}
