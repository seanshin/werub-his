import { EventEmitter2 } from '@nestjs/event-emitter';
import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { recordGateViolation } from '../../common/gate-violation-record';
import { TRANSPLANT_WAITLIST_STATUSES, isTransplantWaitlistStatus } from './transplant-waitlist-status';
import { KONOS_CHANNEL, KONOS_NOT_IMPLEMENTED, type KonosRegisterResult } from './transplant-konos-channel';

// 고형장기 ABO 적합성 — 적혈구와 동일 규칙(공혈 항원을 수혈자 항체가 공격하지 않아야 함).
const ORGAN_ABO_OK: Record<string, string[]> = { O: ['O'], A: ['A', 'O'], B: ['B', 'O'], AB: ['A', 'B', 'O', 'AB'] };
function normAbo(v: unknown): 'A' | 'B' | 'O' | 'AB' | null {
  const t = String(v ?? '').trim().toUpperCase();
  return t === 'A' || t === 'B' || t === 'O' || t === 'AB' ? (t as 'A' | 'B' | 'O' | 'AB') : null;
}

@Injectable()
export class TransplantService {
  private readonly logger = new Logger(TransplantService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    /** TDM 목표범위 이탈 경보 발행(2026-10-10) — 미주입이면 발행하지 않는다(응답 경고는 그대로) */
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // ── 대기자 ──

  async addToWaitlist(data: { patientId: string; organType: string; bloodType: string; urgency?: string; hlaTyping?: unknown; pra?: number; konosId?: string; notes?: string }) {
    return this.prisma.transplantWaitlist.create({
      data: { ...data, hlaTyping: data.hlaTyping as never, registeredAt: new Date() },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getWaitlist(organType?: string, status?: string) {
    const where: Record<string, unknown> = {};
    if (organType) where.organType = organType;
    if (status) where.status = status;
    return this.prisma.transplantWaitlist.findMany({
      where,
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true, dateOfBirth: true } } },
      orderBy: { registeredAt: 'asc' },
    });
  }

  async updateWaitlistStatus(id: string, status: string, removeReason?: string) {
    if (!isTransplantWaitlistStatus(status)) {
      throw new BadRequestException({
        code: 'TRANSPLANT_WAITLIST_STATUS_UNKNOWN',
        message: 'Unknown transplant waitlist status',
        details: { received: status, allowed: TRANSPLANT_WAITLIST_STATUSES },
      });
    }
    const data: Record<string, unknown> = { status };
    if (status === 'MATCHED') data.matchedAt = new Date();
    if (status === 'REMOVED') { data.removedAt = new Date(); data.removeReason = removeReason; }
    return this.prisma.transplantWaitlist.update({ where: { id }, data: data as never });
  }

  // ── 기증자 ──

  async registerDonor(data: { donorType: string; donorPatientId?: string; donorName?: string; relationship?: string; bloodType: string; hlaTyping?: unknown; organType: string; evaluationNotes?: string }) {
    return this.prisma.transplantDonor.create({
      data: { ...data, hlaTyping: data.hlaTyping as never },
    });
  }

  async getDonors(organType?: string) {
    return this.prisma.transplantDonor.findMany({
      where: organType ? { organType } : {},
      include: { donorPatient: { select: { familyName: true, givenName: true, mrn: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 교차시험 유효기간(일) — 경과 시 재검 필요.
  private static readonly CROSSMATCH_VALID_DAYS = 30;
  private crossmatchValidUntil(from = new Date()): Date {
    const d = new Date(from); d.setDate(d.getDate() + TransplantService.CROSSMATCH_VALID_DAYS); return d;
  }

  /** 교차시험 결과 기록 — recipientId 지정 시 수혈자 결속 기록도 생성(게이트가 참조). */
  async updateCrossmatch(id: string, result: string, recipientId?: string) {
    const donor = await this.prisma.transplantDonor.findUnique({ where: { id } });
    if (!donor) throw new NotFoundException('기증자를 찾을 수 없습니다');
    const now = new Date();
    // 🔴 (2026-09-16 G3) 교차시험 기록과 기증자 요약 갱신은 한 트랜잭션 — 한쪽만 커밋되면
    //    기증자 화면이 **다른(옛) 판정**을 말한다. (게이트는 요약이 아니라 수혈자 결속 교차시험 행을 본다.)
    return this.prisma.$transaction(async (tx) => {
      if (recipientId) {
        await tx.transplantCrossmatch.create({
          data: { donorId: id, recipientId, result, testedAt: now, validUntil: this.crossmatchValidUntil(now) },
        });
      }
      return tx.transplantDonor.update({
        where: { id },
        data: { crossmatchResult: result, crossmatchDate: now },
      });
    });
  }

  // ── 이식 기록 ──

  async createTransplant(data: { recipientId: string; donorId: string; waitlistId?: string; surgeryId?: string; organType: string; transplantDate: string; surgeonId: string; coldIschemiaTime?: number; warmIschemiaTime?: number; inductionRegimen?: string; maintenanceRegimen?: string; notes?: string }) {
    const donor = await this.prisma.transplantDonor.findUnique({ where: { id: data.donorId } });
    if (!donor) throw new NotFoundException('기증자를 찾을 수 없습니다');

    // 수혈자 ABO — 환자 본인 혈액형(PatientBloodTyping)을 우선(신뢰 원천), 대기자 값과 교차검증.
    const typing = await this.prisma.patientBloodTyping.findUnique({ where: { patientId: data.recipientId } });
    let recipientAbo: string | null = typing?.abo ?? null;

    // 이식 적합성 게이트(config transplant.compatEnforce OFF|WARN|BLOCK·기본 BLOCK·fail-closed)
    const mode = gateMode(await this.config?.get('transplant.compatEnforce'));
    const blocked: string[] = [];

    // 대기자 결속·혈액형 교차검증 — waitlistId가 실제 수혈자(recipientId)의 것인지, 혈액형이 일치하는지.
    // (미결속 시 다른 환자의 waitlist 혈액형을 신뢰해 ABO 부적합 통과 위험 — wrong-patient)
    if (data.waitlistId) {
      const wl = await this.prisma.transplantWaitlist.findUnique({ where: { id: data.waitlistId } });
      if (!wl) blocked.push('대기자 등록을 찾을 수 없습니다');
      else {
        if (wl.patientId !== data.recipientId) blocked.push('대기자 등록과 수혈자(recipientId)가 일치하지 않습니다');
        if (wl.organType && wl.organType !== data.organType) blocked.push(`대기자 장기유형 불일치(대기 ${wl.organType} vs 이식 ${data.organType})`);
        const wlAbo = normAbo(wl.bloodType);
        if (!recipientAbo) recipientAbo = wl.bloodType ?? null; // 환자 혈액형 미확정 시 대기자 값 폴백
        else if (wlAbo && normAbo(recipientAbo) && wlAbo !== normAbo(recipientAbo)) {
          blocked.push(`대기자 혈액형(${wl.bloodType})과 환자 혈액형(${recipientAbo}) 불일치 — 재확인 필요`);
        }
      }
    }
    // 장기 유형 일치
    if (donor.organType && data.organType && donor.organType !== data.organType) blocked.push(`장기 유형 불일치(기증 ${donor.organType} vs 이식 ${data.organType})`);
    // 기증자 승인
    if (donor.status !== 'APPROVED') blocked.push(`기증자가 승인(APPROVED) 상태가 아닙니다(현재 ${donor.status})`);
    // ABO 적합성
    const rAbo = normAbo(recipientAbo), dAbo = normAbo(donor.bloodType);
    if (!rAbo) blocked.push('수혈자 혈액형 미확정');
    else if (!dAbo) blocked.push('기증자 혈액형 불명');
    else if (!ORGAN_ABO_OK[rAbo].includes(dAbo)) blocked.push(`ABO 부적합: 수혈자 ${rAbo} ← 기증 ${dAbo}`);
    // 교차시험 음성 — 반드시 '해당 수혈자(recipientId)'와 결속된 최신 교차시험으로 판정(유효기간 내).
    // (donor 전역 필드는 다른 수혈자용 결과일 수 있어 신뢰 불가)
    const xm = await this.prisma.transplantCrossmatch.findFirst({
      where: { donorId: data.donorId, recipientId: data.recipientId },
      orderBy: { testedAt: 'desc' },
    });
    if (!xm) blocked.push('해당 수혈자-기증자 교차시험 기록이 없습니다(교차시험 선행 필요)');
    else if (xm.result !== 'NEGATIVE') blocked.push(`교차시험이 음성(NEGATIVE)이 아닙니다(현재 ${xm.result}) — 초급성 거부 위험`);
    else if (!xm.validUntil || xm.validUntil.getTime() < Date.now()) blocked.push('교차시험 유효기간 경과 — 재검 필요');

    // 공개판: 차단 · 경고 통과 모두 게이트 위반 원장에 남긴다(트랜잭션 밖 — 차단 롤백에도 보존).
    //    응답에만 실으면 관제(`/admin/safety-gates`)가 이 게이트의 위반을 세지 못한다.
    if (blocked.length > 0 && mode !== 'OFF') {
      await recordGateViolation(this.prisma, this.logger, {
        gateKey: 'transplant.compatEnforce',
        severity: mode,
        message: blocked.join(' / '),
        refType: 'TransplantDonor',
        refId: data.donorId,
      });
    }
    if (blocked.length > 0 && mode === 'BLOCK') {
      throw new BadRequestException({ code: 'TRANSPLANT_INCOMPATIBLE', message: `이식 불가: ${blocked.join(' / ')}`, blocked });
    }

    // 원자성 — 기록 생성·대기자/기증자 상태 전이를 한 트랜잭션으로(부분 실패 방지·기증자 이중이식 방지)
    return this.prisma.$transaction(async (tx) => {
      // 기증자 이중 이식 방지 — APPROVED에서 DONATED로 원자 전이. 이중사용은 모드 무관 항상 차단.
      const claim = await tx.transplantDonor.updateMany({ where: { id: data.donorId, status: 'APPROVED' }, data: { status: 'DONATED' } });
      if (claim.count === 0) throw new BadRequestException('기증자가 이미 이식되었거나 승인 상태가 아닙니다');
      const record = await tx.transplantRecord.create({
        data: { ...data, transplantDate: new Date(data.transplantDate) },
        include: { recipient: { select: { familyName: true, givenName: true } } },
      });
      if (data.waitlistId) {
        await tx.transplantWaitlist.update({ where: { id: data.waitlistId }, data: { status: 'TRANSPLANTED', matchedAt: new Date() } });
      }
      return blocked.length > 0 && mode === 'WARN' ? { ...record, warnings: blocked } : record;
    });
  }

  async getTransplants(recipientId?: string) {
    return this.prisma.transplantRecord.findMany({
      where: recipientId ? { recipientId } : {},
      include: {
        recipient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        donor: { select: { donorType: true, donorName: true, organType: true } },
        surgeon: { select: { familyName: true, givenName: true } },
        _count: { select: { rejectionEvents: true } },
      },
      orderBy: { transplantDate: 'desc' },
    });
  }

  async getTransplantDetail(id: string) {
    const record = await this.prisma.transplantRecord.findUnique({
      where: { id },
      include: {
        recipient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        donor: true,
        surgeon: { select: { familyName: true, givenName: true } },
        rejectionEvents: { orderBy: { detectedAt: 'desc' } },
      },
    });
    if (!record) throw new NotFoundException('이식 기록을 찾을 수 없습니다');
    return record;
  }

  // ── 거부반응 ──

  async reportRejection(data: { transplantId: string; rejectionType: string; severity: string; biopsyResult?: string; treatment?: string }) {
    return this.prisma.transplantRejection.create({
      data: { ...data, detectedAt: new Date() },
    });
  }

  async updateRejectionOutcome(id: string, outcome: string) {
    return this.prisma.transplantRejection.update({ where: { id }, data: { outcome } });
  }

  // ── 통계 ──

  async getStats() {
    const [waitingByOrgan, totalTransplants, activeRejections] = await Promise.all([
      this.prisma.transplantWaitlist.groupBy({ by: ['organType'], where: { status: 'WAITING' }, _count: { id: true } }),
      this.prisma.transplantRecord.count(),
      this.prisma.transplantRejection.count({ where: { OR: [{ outcome: null }, { outcome: 'ONGOING' }] } }),
    ]);
    const totalWaiting = await this.prisma.transplantWaitlist.count({ where: { status: 'WAITING' } });
    return { totalWaiting, totalTransplants, activeRejections, waitingByOrgan };
  }

  // ── KONOS 대기자 등록 ──
  // 🔴 (2026-09-15 T1) 종전 전송 없이 `KONOS-<시각>` 번호·REGISTERED·접수 시각을 지어냈다(P16).
  //    연동 미구축 — 나가지 않았다는 사실만 돌려준다(`transplant-konos-channel.ts`).

  async registerKonos(id: string, data: Record<string, unknown>): Promise<KonosRegisterResult> {
    const waitlist = await this.prisma.transplantWaitlist.findUnique({ where: { id } });
    if (!waitlist) throw new NotFoundException('대기자를 찾을 수 없습니다');

    return {
      waitlistId: id,
      channel: KONOS_CHANNEL.key,
      attempted: KONOS_CHANNEL.implemented,
      sent: false,
      reason: KONOS_NOT_IMPLEMENTED,
      konosRegistrationId: null,
      registeredAt: null,
      recordedKonosId: waitlist.konosId ?? null,
      manualFallback: KONOS_CHANNEL.manualFallback,
      organType: waitlist.organType,
      bloodType: waitlist.bloodType,
      urgency: typeof data.urgency === 'string' && data.urgency ? data.urgency : waitlist.urgency,
    };
  }

  // ── MELD/PELD 자동 계산 ──

  async calculateMeld(id: string) {
    const waitlist = await this.prisma.transplantWaitlist.findUnique({
      where: { id },
      include: { patient: { select: { dateOfBirth: true } } },
    });
    if (!waitlist) throw new NotFoundException('대기자를 찾을 수 없습니다');

    // 실제 최신 검사결과로 산출 — 난수 mock 제거(간이식 대기 우선순위 왜곡·안전 직결).
    //  LOINC 코드 기반 조회(이름 매칭 금지). 필수 검사 부재 시 계산 거부.
    const LOINC = { bilirubin: '1975-2', creatinine: '2160-0', inr: '34714-6', sodium: '2951-2' };
    const latest = async (loinc: string) => {
      const item = await this.prisma.labResultItem.findFirst({
        where: { loincCode: loinc, labResult: { patientId: waitlist.patientId } },
        orderBy: { labResult: { createdAt: 'desc' } },
        select: { value: true, unit: true, labResult: { select: { createdAt: true } } },
      });
      if (!item) return null;
      const n = parseFloat(item.value);
      return Number.isFinite(n) ? { value: n, unit: item.unit, at: item.labResult.createdAt } : null;
    };
    const [bili, crea, inr, na] = await Promise.all([
      latest(LOINC.bilirubin), latest(LOINC.creatinine), latest(LOINC.inr), latest(LOINC.sodium),
    ]);
    const missing: string[] = [];
    if (!bili) missing.push('총빌리루빈');
    if (!crea) missing.push('크레아티닌');
    if (!inr) missing.push('INR(PT)');
    if (missing.length) {
      throw new BadRequestException({
        code: 'MELD_LABS_MISSING',
        message: `MELD 산출 불가 — 필수 검사결과 없음: ${missing.join(', ')}. 최신 LFT/응고검사 결과를 확인하세요.`,
      });
    }

    // MELD 원공식 — 크레아티닌 1.0~4.0 clamp(투석 시 4.0 처리 표준), 각 항 하한 1.0.
    const b = Math.max(bili!.value, 1);
    const c = Math.min(Math.max(crea!.value, 1), 4);
    const i = Math.max(inr!.value, 1);
    let meld = Math.round(3.78 * Math.log(b) + 11.2 * Math.log(i) + 9.57 * Math.log(c) + 6.43);
    let scoreType = 'MELD';
    // MELD-Na 보정(Na 125~137 clamp) — Na 없으면 MELD로 폴백
    if (na) {
      scoreType = 'MELD-Na';
      const sodium = Math.min(Math.max(na.value, 125), 137);
      meld = Math.round(meld + 1.32 * (137 - sodium) - 0.033 * meld * (137 - sodium));
    }
    const score = Math.min(Math.max(meld, 6), 40);

    // 최신 검사 신선도 — 가장 오래된 필수검사가 7일 초과면 갱신 권고
    const oldest = [bili!.at, crea!.at, inr!.at].reduce((a, x) => (x < a ? x : a));
    const stale = Date.now() - oldest.getTime() > 7 * 24 * 60 * 60 * 1000;

    return {
      waitlistId: id,
      scoreType,
      score,
      labs: {
        bilirubin: bili!.value, creatinine: crea!.value, inr: inr!.value, sodium: na?.value ?? null,
      },
      labMeasuredAt: { bilirubin: bili!.at, creatinine: crea!.at, inr: inr!.at, sodium: na?.at ?? null },
      stale,
      staleWarning: stale ? '필수 검사결과가 7일 이상 경과 — 재검 후 재산정 권고' : undefined,
      calculatedAt: new Date(),
    };
  }

  // ── HLA 타이핑 기록 ──

  async recordHla(id: string, data: Record<string, unknown>, userId?: string) {
    const waitlist = await this.prisma.transplantWaitlist.findUnique({ where: { id } });
    if (!waitlist) throw new NotFoundException('대기자를 찾을 수 없습니다');

    // 영속화(P2-E) — 종전 계산객체만 반환(휘발) → transplant_hla 검사 이력으로 저장.
    return this.prisma.transplantHla.create({
      data: {
        waitlistId: id,
        // 🔴 (2026-09-15 T1) 미검사는 null — 종전 PRA 0%(=감작 없음)·검사법 'PCR-SSO'·검사실명·빈 좌위 [] 를 채웠다.
        classI: { hlaA: data.hlaA ?? null, hlaB: data.hlaB ?? null, hlaC: data.hlaC ?? null } as Prisma.InputJsonValue,
        classII: { hlaDR: data.hlaDR ?? null, hlaDQ: data.hlaDQ ?? null, hlaDP: data.hlaDP ?? null } as Prisma.InputJsonValue,
        method: data.method ? String(data.method) : null,
        pra: data.pra != null ? Number(data.pra) : null,
        antibodies: data.antibodies != null ? (data.antibodies as Prisma.InputJsonValue) : Prisma.JsonNull,
        lab: data.lab ? String(data.lab) : null,
        testedAt: data.testedAt ? new Date(String(data.testedAt)) : new Date(),
        recordedBy: userId ?? (data.recordedBy ? String(data.recordedBy) : undefined),
      },
    });
  }

  async listHla(waitlistId: string) {
    return this.prisma.transplantHla.findMany({ where: { waitlistId }, orderBy: { testedAt: 'desc' } });
  }

  // ── 교차시험 (CDC/FCXM) 결과 기록 ──

  /** 상세 교차시험(CDC/Flow/Virtual) 기록 — 수혈자 결속 저장·finalResult로 판정. */
  async recordCrossmatch(id: string, data: Record<string, unknown>, createdBy?: string) {
    const donor = await this.prisma.transplantDonor.findUnique({ where: { id } });
    if (!donor) throw new NotFoundException('기증자를 찾을 수 없습니다');
    const recipientId = data.recipientId as string | undefined;
    if (!recipientId) throw new BadRequestException('교차시험에는 수혈자(recipientId)가 필요합니다');

    // 🔴 (2026-09-15 B6) 종전 `?? 'COMPATIBLE'` — 판정 없는 기록이 결과 NEGATIVE 로 저장돼 이식 적합성 게이트를 열었다.
    const finalResult = typeof data.finalResult === 'string' ? data.finalResult : '';
    if (!finalResult) throw new BadRequestException('교차시험 판정(finalResult)이 필요합니다 — 판정 없이 음성으로 저장하지 않는다');
    // finalResult(COMPATIBLE/INCOMPATIBLE)를 교차시험 결과(NEGATIVE/POSITIVE)로 매핑.
    const result = /INCOMPAT|POSITIVE/i.test(finalResult) ? 'POSITIVE' : 'NEGATIVE';
    // 🔴 (2026-09-15 T1) 미시행 세부는 null — 종전 값이 없으면 CDC/FCXM 음성·MFI 0·가상 COMPATIBLE 로 채워
    //    "하지 않은 검사"를 "음성 검사"로 저장·반환했다. 게이트는 세부가 아니라 `result` 만 본다.
    const details = {
      cdcCrossmatch: { tCell: data.cdcTCell ?? null, bCell: data.cdcBCell ?? null },
      flowCrossmatch: { tCell: data.fcxmTCell ?? null, bCell: data.fcxmBCell ?? null, mfi: data.mfi ?? null },
      virtualCrossmatch: data.virtualCrossmatch ?? null,
      finalResult,
    };
    const now = new Date();
    // 🔴 (2026-09-16 G3) 상세 교차시험 기록과 기증자 요약 갱신도 한 트랜잭션(위 updateCrossmatch 와 같은 이유)
    const xm = await this.prisma.$transaction(async (tx) => {
      const xm = await tx.transplantCrossmatch.create({
        data: { donorId: id, recipientId, result, details: details as never, testedAt: now, validUntil: this.crossmatchValidUntil(now), createdBy: createdBy ?? null },
      });
      await tx.transplantDonor.update({ where: { id }, data: { crossmatchResult: result, crossmatchDate: now } });
      return xm;
    });
    return { id: xm.id, donorId: id, recipientId, result, ...details, testedAt: now, validUntil: xm.validUntil };
  }

  // ── 면역억제제 TDM ──

  async recordTdm(id: string, data: Record<string, unknown>, userId?: string) {
    const record = await this.prisma.transplantRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('이식 기록을 찾을 수 없습니다');

    // 목표범위 — targetLow/High 우선, 없으면 targetRange{min,max}.
    // 🔴 (2026-09-15 T1) 종전 없으면 5~15(타크로리무스)로 채워 약물·시기와 무관한 범위로 이탈 판정했다.
    //    목표범위는 처방의 몫 — 모르면 null 이고 범위 판정(inRange)도 null(산출 불가)이다.
    const drug = typeof data.drug === 'string' ? data.drug.trim() : '';
    if (!drug) throw new BadRequestException('TDM 약물(drug)이 필요합니다 — 약물을 추정해 기록하지 않는다');
    const tr = (data.targetRange as { min?: number; max?: number } | undefined) ?? {};
    const targetLow = data.targetLow != null ? Number(data.targetLow) : (tr.min ?? null);
    const targetHigh = data.targetHigh != null ? Number(data.targetHigh) : (tr.max ?? null);
    const trough = data.troughLevel != null ? Number(data.troughLevel) : null;
    // 🔴 (2026-10-10) 하한 > 상한이면 어떤 값도 범위 안이 아니다 — 판정을 지어내지 않고 거절한다
    if (targetLow != null && targetHigh != null && targetLow > targetHigh) {
      throw new BadRequestException({ code: 'TDM_TARGET_INVERTED', message: '목표 하한이 상한보다 큽니다.', details: { targetLow, targetHigh } });
    }
    // 채혈 시각 — 모르면 받지 않는다(지금 시각으로 채우지 않는다) · 미래(5분 넘게)는 입력 오류
    const sampledAt = data.sampledAt ? new Date(String(data.sampledAt)) : null;
    if (!sampledAt || Number.isNaN(sampledAt.getTime())) throw new BadRequestException({ code: 'TDM_SAMPLED_AT_REQUIRED', message: '채혈 시각(sampledAt)이 필요합니다 — 모르는 시각을 기록하지 않는다' });
    if (sampledAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException({ code: 'TDM_SAMPLED_AT_FUTURE', message: '채혈 시각이 미래입니다.' });
    const inRange = trough != null && targetLow != null && targetHigh != null ? trough >= targetLow && trough <= targetHigh : null;

    // 영속화(P2-E) — 종전 계산객체만 반환(휘발) → transplant_tdm 이력 저장.
    const tdm = await this.prisma.transplantTdm.create({
      data: {
        transplantId: id,
        drug,
        troughLevel: trough,
        peakLevel: data.peakLevel != null ? Number(data.peakLevel) : null,
        targetLow, targetHigh, inRange,
        doseAdjustment: data.doseAdjustment ? String(data.doseAdjustment) : null,
        sideEffects: data.sideEffects != null ? (data.sideEffects as Prisma.InputJsonValue) : Prisma.JsonNull,
        sampledAt,
        recordedBy: userId ?? (data.recordedBy ? String(data.recordedBy) : undefined),
      },
    });
    // 🔴 (2026-10-10) 이탈은 기록한 사람의 토스트로만 알려졌다 — 이식 수술의·담당의는 몰랐다. 경보 사건을 낸다(수신·중복 억제는 알림 리스너)
    if (inRange === false) {
      this.events?.emit('transplant.tdm.out_of_range', {
        transplantId: id, tdmId: tdm.id, patientId: record.recipientId, surgeonId: record.surgeonId, recordedBy: userId ?? null,
        drug, trough, targetLow, targetHigh,
      });
    }
    // TDM trough 목표범위 이탈 — 거부/독성 감시상 용량조정 검토 경고
    return { ...tdm, outOfRangeWarning: inRange === false ? '면역억제제 TDM trough가 목표범위를 벗어났습니다 — 용량조정 검토 필요' : undefined };
  }

  async listTdm(transplantId: string) {
    return this.prisma.transplantTdm.findMany({ where: { transplantId }, orderBy: { sampledAt: 'desc' } });
  }

  // ── 이식 후 추적관찰 ──

  async recordFollowUp(id: string, data: Record<string, unknown>, userId?: string) {
    const record = await this.prisma.transplantRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('이식 기록을 찾을 수 없습니다');

    // 영속화(P2-E) — 종전 계산객체만 반환(휘발) → transplant_follow_ups 저장.
    // 🔴 (2026-09-15 T1) 기록하지 않은 소견은 null — 종전 이식편 기능 'GOOD'·거부 징후 false·합병증/감염 [] 로 채워
    //    아무것도 적지 않은 방문이 "이식편 양호·거부 없음"으로 남았다.
    const json = (v: unknown) => (v != null ? (v as Prisma.InputJsonValue) : Prisma.JsonNull);
    return this.prisma.transplantFollowUp.create({
      data: {
        transplantId: id,
        visitDate: data.visitDate ? new Date(String(data.visitDate)) : new Date(),
        postOpDay: data.postOpDay != null ? Number(data.postOpDay) : null,
        graftFunction: data.graftFunction ? String(data.graftFunction) : null,
        labResults: json(data.labResults),
        immunosuppressionRegimen: json(data.immunosuppressionRegimen),
        complications: json(data.complications),
        biopsyResult: data.biopsyResult ? String(data.biopsyResult) : undefined,
        infections: json(data.infections),
        rejectionSigns: data.rejectionSigns != null ? Boolean(data.rejectionSigns) : null,
        nextFollowUp: data.nextFollowUp ? new Date(String(data.nextFollowUp)) : undefined,
        notes: data.notes ? String(data.notes) : undefined,
        recordedBy: userId ?? (data.recordedBy ? String(data.recordedBy) : undefined),
      },
    });
  }

  async listFollowUp(transplantId: string) {
    return this.prisma.transplantFollowUp.findMany({ where: { transplantId }, orderBy: { visitDate: 'desc' } });
  }

  // ── 이식편 생존율 ──
  // 🔴 (2026-09-15 T1) 종전 Kaplan-Meier 곡선·장기별 1/3/5년 생존율·위험군 수를 전부 상수로 돌려줬다(P15-b 지표 날조 —
  //    이식 기록이 0건인 운영 DB 에서도 "신장 78건·1년 95.2%"). 추적관찰·이식편 소실로 산출하는 로직이 없으므로 산출하지 않는다.
  //    분모(이식 건수)는 사실이라 함께 준다.
  async getGraftSurvival() {
    const totalTransplants = await this.prisma.transplantRecord.count();
    return {
      available: false as const,
      reason: 'NOT_COMPUTED' as const,
      note: '이식편 생존율 산출 로직 미구현 — 상수로 채우지 않는다',
      kaplanMeier: null,
      byOrgan: null,
      totalTransplants,
      generatedAt: new Date(),
    };
  }
}
