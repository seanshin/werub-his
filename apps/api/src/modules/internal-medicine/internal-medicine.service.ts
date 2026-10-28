import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class InternalMedicineService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) · 세부 분과는 보인 환자만 */
  async getPatients() {
    const page = await specialtyRecordPatients(this.prisma, (a) => this.prisma.internalMedicineExam.groupBy(a as never), 'examinedAt');
    const subs = page.items.length
      ? await this.prisma.internalMedicineExam.groupBy({ by: ['patientId', 'subspecialty'], where: { patientId: { in: page.items.map((p) => p.patientId) } } })
      : [];
    const byPatient = new Map<string, string[]>();
    for (const r of subs) byPatient.set(r.patientId, [...(byPatient.get(r.patientId) ?? []), r.subspecialty]);
    return { ...page, items: page.items.map((p) => ({ ...p, subspecialties: byPatient.get(p.patientId) ?? [] })) };
  }

  /* ───── Exams ───── */

  async getExams(patientId: string, subspecialty?: string) {
    return this.prisma.internalMedicineExam.findMany({
      where: {
        patientId,
        ...(subspecialty ? { subspecialty } : {}),
      },
      include: { examiner: { select: { familyName: true, givenName: true } } },
      orderBy: { examinedAt: 'desc' },
    });
  }

  async createExam(data: {
    patientId: string;
    encounterId?: string;
    subspecialty: string;
    chiefComplaint?: string;
    diagnosis?: string;
    plan?: string;
    nyhaClass?: number;
    ccsGrade?: number;
    lvef?: number;
    heartRhythm?: string;
    ecgFindings?: unknown;
    echoSummary?: unknown;
    pacemakerInfo?: unknown;
    inrTarget?: number;
    inrActual?: number;
    cha2ds2vasc?: number;
    hasbled?: number;
    heartScore?: number;
    graceScore?: number;
    timiScore?: number;
    fev1?: number;
    fvc?: number;
    fev1Fvc?: number;
    dlco?: number;
    goldStage?: number;
    oxygenTherapy?: unknown;
    sputum?: unknown;
    curb65?: number;
    catScore?: number;
    mmrcGrade?: number;
    qsofa?: number;
    endoscopyType?: string;
    endoscopyFindings?: unknown;
    childPughScore?: number;
    childPughClass?: string;
    meldScore?: number;
    ascites?: string;
    varicesGrade?: string;
    blatchfordScore?: number;
    hba1c?: number;
    fastingGlucose?: number;
    insulinRegimen?: unknown;
    thyroidFunction?: unknown;
    bmdTScore?: number;
    bmdSite?: string;
    fraxScore?: number;
    ckdStage?: string;
    egfr?: number;
    dialysisType?: string;
    ktv?: number;
    electrolytes?: unknown;
    fluidBalance?: unknown;
    cancerType?: string;
    tnmStage?: string;
    ecogPs?: number;
    regimenName?: string;
    cycleDay?: string;
    bsa?: number;
    recistResponse?: string;
    ctcaeGrade?: number;
    ctcaeEvent?: string;
    infectionSite?: string;
    organism?: string;
    susceptibility?: unknown;
    antibiotics?: unknown;
    isolationType?: string;
    sofaScore?: number;
    procalcitonin?: number;
    tenderJointCount?: number;
    swollenJointCount?: number;
    das28?: number;
    haqDi?: number;
    autoantibodies?: unknown;
    sledai?: number;
    basdai?: number;
    biologics?: unknown;
    scores?: unknown;
    examinedBy: string;
  }) {
    return this.prisma.internalMedicineExam.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        subspecialty: data.subspecialty,
        chiefComplaint: data.chiefComplaint,
        diagnosis: data.diagnosis,
        plan: data.plan,
        // 순환기
        nyhaClass: data.nyhaClass,
        ccsGrade: data.ccsGrade,
        lvef: data.lvef,
        heartRhythm: data.heartRhythm,
        ecgFindings: data.ecgFindings as never,
        echoSummary: data.echoSummary as never,
        pacemakerInfo: data.pacemakerInfo as never,
        inrTarget: data.inrTarget,
        inrActual: data.inrActual,
        cha2ds2vasc: data.cha2ds2vasc,
        hasbled: data.hasbled,
        heartScore: data.heartScore,
        graceScore: data.graceScore,
        timiScore: data.timiScore,
        // 호흡기
        fev1: data.fev1,
        fvc: data.fvc,
        fev1Fvc: data.fev1Fvc,
        dlco: data.dlco,
        goldStage: data.goldStage,
        oxygenTherapy: data.oxygenTherapy as never,
        sputum: data.sputum as never,
        curb65: data.curb65,
        catScore: data.catScore,
        mmrcGrade: data.mmrcGrade,
        qsofa: data.qsofa,
        // 소화기
        endoscopyType: data.endoscopyType,
        endoscopyFindings: data.endoscopyFindings as never,
        childPughScore: data.childPughScore,
        childPughClass: data.childPughClass,
        meldScore: data.meldScore,
        ascites: data.ascites,
        varicesGrade: data.varicesGrade,
        blatchfordScore: data.blatchfordScore,
        // 내분비
        hba1c: data.hba1c,
        fastingGlucose: data.fastingGlucose,
        insulinRegimen: data.insulinRegimen as never,
        thyroidFunction: data.thyroidFunction as never,
        bmdTScore: data.bmdTScore,
        bmdSite: data.bmdSite,
        fraxScore: data.fraxScore,
        // 신장
        ckdStage: data.ckdStage,
        egfr: data.egfr,
        dialysisType: data.dialysisType,
        ktv: data.ktv,
        electrolytes: data.electrolytes as never,
        fluidBalance: data.fluidBalance as never,
        // 혈액종양
        cancerType: data.cancerType,
        tnmStage: data.tnmStage,
        ecogPs: data.ecogPs,
        regimenName: data.regimenName,
        cycleDay: data.cycleDay,
        bsa: data.bsa,
        recistResponse: data.recistResponse,
        ctcaeGrade: data.ctcaeGrade,
        ctcaeEvent: data.ctcaeEvent,
        // 감염
        infectionSite: data.infectionSite,
        organism: data.organism,
        susceptibility: data.susceptibility as never,
        antibiotics: data.antibiotics as never,
        isolationType: data.isolationType,
        sofaScore: data.sofaScore,
        procalcitonin: data.procalcitonin,
        // 류마티스
        tenderJointCount: data.tenderJointCount,
        swollenJointCount: data.swollenJointCount,
        das28: data.das28,
        haqDi: data.haqDi,
        autoantibodies: data.autoantibodies as never,
        sledai: data.sledai,
        basdai: data.basdai,
        biologics: data.biologics as never,
        // 공통 메타
        scores: data.scores as never,
        examinedBy: data.examinedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'internal-medicine');
  }

  async getStats() {
    const total = await this.prisma.internalMedicineExam.count();
    const bySubspecialty = await this.prisma.internalMedicineExam.groupBy({
      by: ['subspecialty'],
      _count: true,
    });
    return {
      totalExams: total,
      bySubspecialty: bySubspecialty.map(g => ({ subspecialty: g.subspecialty, count: g._count })),
      // 오늘 키가 없어 FE 가 폴백 체인 끝에서 0 으로 떨어졌다 — 다른 전문과와 같은 정본으로 채운다
      ...(await specialtyTodayStats(this.prisma, 'internal-medicine')),
    };
  }

  /* ───── Score Trend ───── */

  async getScoreTrend(patientId: string, subspecialty?: string) {
    const scoreFieldsBySubspecialty: Record<string, Record<string, true>> = {
      CARDIOLOGY: { cha2ds2vasc: true, hasbled: true, heartScore: true, graceScore: true, timiScore: true, nyhaClass: true, lvef: true, examinedAt: true },
      PULMONOLOGY: { curb65: true, catScore: true, mmrcGrade: true, goldStage: true, fev1: true, fvc: true, fev1Fvc: true, qsofa: true, examinedAt: true },
      GASTRO: { childPughScore: true, childPughClass: true, meldScore: true, blatchfordScore: true, examinedAt: true },
      ENDOCRINE: { hba1c: true, fastingGlucose: true, bmdTScore: true, fraxScore: true, examinedAt: true },
      NEPHROLOGY: { egfr: true, ckdStage: true, ktv: true, examinedAt: true },
      HEMATO_ONCOLOGY: { ecogPs: true, recistResponse: true, ctcaeGrade: true, examinedAt: true },
      INFECTIOUS: { qsofa: true, sofaScore: true, procalcitonin: true, examinedAt: true },
      RHEUMATOLOGY: { das28: true, haqDi: true, sledai: true, basdai: true, tenderJointCount: true, swollenJointCount: true, examinedAt: true },
    };

    const select = subspecialty && scoreFieldsBySubspecialty[subspecialty]
      ? { id: true, subspecialty: true, ...scoreFieldsBySubspecialty[subspecialty] }
      : { id: true, subspecialty: true, examinedAt: true, cha2ds2vasc: true, curb65: true, childPughScore: true, meldScore: true, egfr: true, qsofa: true, das28: true, ecogPs: true };

    return this.prisma.internalMedicineExam.findMany({
      where: {
        patientId,
        ...(subspecialty ? { subspecialty } : {}),
      },
      select,
      orderBy: { examinedAt: 'asc' },
    });
  }

  /* ───── Score Calculators ───── */

  calculateCha2ds2vasc(data: {
    age: number; female: boolean; chf: boolean; hypertension: boolean;
    stroke: boolean; vascular: boolean; diabetes: boolean;
  }): number {
    let score = 0;
    if (data.chf) score += 1;
    if (data.hypertension) score += 1;
    if (data.age >= 75) score += 2;
    else if (data.age >= 65) score += 1;
    if (data.diabetes) score += 1;
    if (data.stroke) score += 2;
    if (data.vascular) score += 1;
    if (data.female) score += 1;
    return score;
  }

  calculateCurb65(data: {
    confusion: boolean; urea: number; respiratoryRate: number;
    systolicBp: number; diastolicBp: number; age: number;
  }): number {
    let score = 0;
    if (data.confusion) score += 1;
    if (data.urea > 7) score += 1; // mmol/L
    if (data.respiratoryRate >= 30) score += 1;
    if (data.systolicBp < 90 || data.diastolicBp <= 60) score += 1;
    if (data.age >= 65) score += 1;
    return score;
  }

  calculateChildPugh(data: {
    bilirubin: number; albumin: number; inr: number;
    ascites: string; encephalopathy: string;
  }): { score: number; class: string } {
    let score = 0;
    // Bilirubin (mg/dL)
    if (data.bilirubin < 2) score += 1;
    else if (data.bilirubin <= 3) score += 2;
    else score += 3;
    // Albumin (g/dL)
    if (data.albumin > 3.5) score += 1;
    else if (data.albumin >= 2.8) score += 2;
    else score += 3;
    // INR
    if (data.inr < 1.7) score += 1;
    else if (data.inr <= 2.3) score += 2;
    else score += 3;
    // Ascites
    if (data.ascites === 'NONE') score += 1;
    else if (data.ascites === 'MILD') score += 2;
    else score += 3;
    // Encephalopathy
    if (data.encephalopathy === 'NONE') score += 1;
    else if (data.encephalopathy === 'GRADE_1_2') score += 2;
    else score += 3;

    const cls = score <= 6 ? 'A' : score <= 9 ? 'B' : 'C';
    return { score, class: cls };
  }

  calculateMeld(data: {
    bilirubin: number; creatinine: number; inr: number; sodium?: number;
  }): number {
    const bili = Math.max(1, data.bilirubin);
    const cr = Math.min(4, Math.max(1, data.creatinine));
    const inr = Math.max(1, data.inr);

    let meld = 3.78 * Math.log(bili) + 11.2 * Math.log(inr) + 9.57 * Math.log(cr) + 6.43;
    meld = Math.round(meld);

    if (data.sodium !== undefined) {
      const na = Math.min(137, Math.max(125, data.sodium));
      meld = meld - na - (0.025 * meld * (140 - na)) + 140;
      meld = Math.round(meld);
    }

    return Math.max(6, Math.min(40, meld));
  }

  calculateEgfr(data: { creatinine: number; age: number; female: boolean }): number {
    // CKD-EPI 2021 (race-free)
    const scr = data.creatinine;
    const kappa = data.female ? 0.7 : 0.9;
    const alpha = data.female ? -0.241 : -0.302;
    const ratio = scr / kappa;
    const minRatio = Math.min(ratio, 1);
    const maxRatio = Math.max(ratio, 1);

    const egfr = 142 * Math.pow(minRatio, alpha) * Math.pow(maxRatio, -1.2) * Math.pow(0.9938, data.age) * (data.female ? 1.012 : 1);
    return Math.round(egfr * 10) / 10;
  }

  calculateQsofa(data: {
    mentalStatus: boolean; respiratoryRate: number; systolicBp: number;
  }): number {
    let score = 0;
    if (data.mentalStatus) score += 1; // altered mental status
    if (data.respiratoryRate >= 22) score += 1;
    if (data.systolicBp <= 100) score += 1;
    return score;
  }

  calculateDas28(data: {
    tenderJoints: number; swollenJoints: number; esr: number; patientGlobalVas: number;
  }): number {
    const das = 0.56 * Math.sqrt(data.tenderJoints) +
                0.28 * Math.sqrt(data.swollenJoints) +
                0.70 * Math.log(data.esr) +
                0.014 * data.patientGlobalVas;
    return Math.round(das * 100) / 100;
  }

  getEcogDescription(score: number): string {
    const descriptions: Record<number, string> = {
      0: '완전히 활동적, 발병 전과 동일한 일상생활 수행 가능',
      1: '격렬한 신체활동 제한, 가벼운 가사 및 사무 가능',
      2: '자가 관리 가능하나, 일과 시간의 50% 이상 기동 가능',
      3: '제한된 자가 관리만 가능, 일과 시간의 50% 이상 침대/의자에서 생활',
      4: '전혀 활동 불가, 자가 관리 불가, 완전히 침대/의자에서 생활',
    };
    return descriptions[score] ?? '유효하지 않은 ECOG PS 점수';
  }

  /* ───── Calculator Router ───── */

  async calculate(scoreName: string, body: Record<string, unknown>) {
    switch (scoreName) {
      case 'cha2ds2vasc': {
        const score = this.calculateCha2ds2vasc(body as Parameters<typeof this.calculateCha2ds2vasc>[0]);
        const interpretation = score === 0 ? '저위험' : score === 1 ? '중간위험' : '고위험 — 항응고 권고';
        return { score, interpretation };
      }
      case 'curb65': {
        const score = this.calculateCurb65(body as Parameters<typeof this.calculateCurb65>[0]);
        const interpretation = score <= 1 ? '외래 치료 고려' : score === 2 ? '단기 입원 고려' : '중환자실 입원 고려';
        return { score, interpretation };
      }
      case 'child-pugh': {
        const result = this.calculateChildPugh(body as Parameters<typeof this.calculateChildPugh>[0]);
        const interpretation = result.class === 'A' ? '양호한 간기능 (5-6점)' : result.class === 'B' ? '중등도 간기능 저하 (7-9점)' : '중증 간기능 저하 (10-15점)';
        return { score: result.score, class: result.class, interpretation };
      }
      case 'meld': {
        const score = this.calculateMeld(body as Parameters<typeof this.calculateMeld>[0]);
        const interpretation = score < 10 ? '낮은 사망 위험' : score < 20 ? '중간 사망 위험' : score < 30 ? '높은 사망 위험' : '매우 높은 사망 위험';
        return { score, interpretation };
      }
      case 'egfr': {
        const score = this.calculateEgfr(body as Parameters<typeof this.calculateEgfr>[0]);
        let interpretation: string;
        if (score >= 90) interpretation = 'G1: 정상 또는 높음';
        else if (score >= 60) interpretation = 'G2: 경미한 감소';
        else if (score >= 45) interpretation = 'G3a: 경도-중등도 감소';
        else if (score >= 30) interpretation = 'G3b: 중등도-중증 감소';
        else if (score >= 15) interpretation = 'G4: 중증 감소';
        else interpretation = 'G5: 신부전';
        return { score, interpretation };
      }
      case 'qsofa': {
        const score = this.calculateQsofa(body as Parameters<typeof this.calculateQsofa>[0]);
        const interpretation = score < 2 ? '패혈증 저위험' : '패혈증 고위험 — 추가 평가 필요';
        return { score, interpretation };
      }
      case 'das28': {
        const score = this.calculateDas28(body as Parameters<typeof this.calculateDas28>[0]);
        let interpretation: string;
        if (score < 2.6) interpretation = '관해';
        else if (score < 3.2) interpretation = '낮은 질병 활성도';
        else if (score <= 5.1) interpretation = '중간 질병 활성도';
        else interpretation = '높은 질병 활성도';
        return { score, interpretation };
      }
      case 'ecog': {
        const score = Number(body.score);
        const description = this.getEcogDescription(score);
        return { score, interpretation: description };
      }
      default:
        throw new BadRequestException(`Unknown score calculator: ${scoreName}`);
    }
  }
}
