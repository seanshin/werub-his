import { Injectable } from '@nestjs/common';
import { localDateKey } from '../../common/day-range';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * 🔴 판정 불가 어휘 — 정본은 여기 하나다(FE 는 이 문자열을 계약으로 읽는다).
 *    `PASS`/`1-2s`/`1-3s` 옆에 두는 **네 번째 상태**이지 세 상태의 하나가 아니다:
 *    합격도 경고도 실패도 아닌 "**잴 수 없었다**".
 */
export const QC_NOT_EVALUABLE = 'NOT_EVALUABLE';

@Injectable()
export class QcService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecords(params?: { instrumentId?: string; date?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.instrumentId) where.instrumentId = params.instrumentId;
    if (params?.date) {
      const start = new Date(params.date);
      const end = new Date(params.date);
      end.setDate(end.getDate() + 1);
      where.performedAt = { gte: start, lt: end };
    }
    return this.prisma.labQcRecord.findMany({
      where,
      include: {
        instrument: { select: { name: true, serialNumber: true } },
        performer: { select: { familyName: true, givenName: true } },
      },
      orderBy: { performedAt: 'desc' },
    });
  }

  async addRecord(data: {
    instrumentId: string;
    qcMaterialId?: string;
    qcLevel: string;
    testCode: string;
    measuredValue: number;
    targetMean: number;
    targetSD: number;
    notes?: string;
    performedBy: string;
  }) {
    // Auto z-score calculation
    // 🔴 (2026-09-21 H) 종전: `targetSD !== 0 ? … : 0` — **목표 SD 가 0/미설정이면 z=0 이 되어
    //    Westgard 가 `PASS`·`isAccepted=true` 를 찍었다.** QC 화면은 그 건을 초록 PASS 로 세고,
    //    장비 배지도 "PASS" 가 됐다(P17 — 안전 화면의 초록이 실은 **산출 불가**였다).
    //    같은 화면의 입력 미리보기는 이미 `parseFloat(targetSD) !== 0` 일 때만 z 를 만들고 있었으므로
    //    **서버만 값을 지어내고 있었다**(같은 사실에 정본이 둘 · P12).
    //    산출 불가는 0 이 아니다 — z 는 `null`, 판정은 `NOT_EVALUABLE`.
    //    🔴 거짓 경보도 만들지 않는다: 아래 대시보드가 이 건을 `failed` 가 아니라 **별도 칸**으로 센다.
    const evaluable = Number.isFinite(data.targetSD) && data.targetSD > 0;
    const zScore = evaluable ? (data.measuredValue - data.targetMean) / data.targetSD : null;
    const absZ = zScore != null ? Math.abs(zScore) : null;

    // Auto Westgard rule check
    let westgardRule: string;
    let isAccepted: boolean;
    if (absZ == null) {
      westgardRule = QC_NOT_EVALUABLE; // 목표 SD 미설정/0 — 판정 자체가 불가능하다
      isAccepted = false; // "합격"이라고 말할 근거가 없다(다만 실패로도 세지 않는다 — getDashboard 참조)
    } else if (absZ > 3) {
      westgardRule = '1-3s';
      isAccepted = false; // reject
    } else if (absZ > 2) {
      westgardRule = '1-2s';
      isAccepted = true; // warning but accepted
    } else {
      westgardRule = 'PASS';
      isAccepted = true;
    }

    return this.prisma.labQcRecord.create({
      data: {
        instrumentId: data.instrumentId,
        qcMaterialId: data.qcMaterialId,
        qcLevel: data.qcLevel,
        testCode: data.testCode,
        measuredValue: data.measuredValue,
        targetMean: data.targetMean,
        targetSD: data.targetSD,
        zScore: zScore != null ? parseFloat(zScore.toFixed(2)) : null,
        westgardRule,
        isAccepted,
        performedAt: new Date(),
        performedBy: data.performedBy,
        notes: data.notes,
      },
      include: {
        instrument: { select: { name: true, serialNumber: true } },
        performer: { select: { familyName: true, givenName: true } },
      },
    });
  }

  async getDashboard(instrumentId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: Record<string, unknown> = {
      performedAt: { gte: today, lt: tomorrow },
    };
    if (instrumentId) where.instrumentId = instrumentId;

    const records = await this.prisma.labQcRecord.findMany({
      where,
      include: {
        instrument: { select: { id: true, name: true, serialNumber: true } },
      },
      orderBy: { performedAt: 'desc' },
    });

    // Group by instrument
    const instrumentMap = new Map<string, {
      instrumentId: string;
      instrumentName: string;
      serialNumber: string;
      total: number;
      passed: number;
      warning: number;
      failed: number;
      notEvaluable: number;
      records: typeof records;
    }>();

    for (const rec of records) {
      const key = rec.instrumentId;
      if (!instrumentMap.has(key)) {
        instrumentMap.set(key, {
          instrumentId: key,
          instrumentName: rec.instrument.name,
          serialNumber: rec.instrument.serialNumber ?? '',
          total: 0,
          passed: 0,
          warning: 0,
          failed: 0,
          notEvaluable: 0,
          records: [],
        });
      }
      const entry = instrumentMap.get(key)!;
      entry.total++;
      // 🔴 판정 불가를 **먼저** 가른다. `!isAccepted` 를 먼저 보면 산출 불가가 `failed` 로 새고
      //    (거짓 경보 — 진짜 QC 실패를 묻는다), `else` 로 흘려보내면 `passed` 로 샌다(거짓 안심).
      //    합격도 실패도 아닌 칸이 하나 더 필요하다.
      if (rec.westgardRule === QC_NOT_EVALUABLE) {
        entry.notEvaluable++;
      } else if (!rec.isAccepted) {
        entry.failed++;
      } else if (rec.westgardRule === '1-2s') {
        entry.warning++;
      } else {
        entry.passed++;
      }
      entry.records.push(rec);
    }

    const instruments = Array.from(instrumentMap.values()).map((inst) => ({
      ...inst,
      records: inst.records.map((r) => ({
        id: r.id,
        qcLevel: r.qcLevel,
        testCode: r.testCode,
        measuredValue: r.measuredValue,
        targetMean: r.targetMean,
        targetSD: r.targetSD,
        zScore: r.zScore,
        westgardRule: r.westgardRule,
        isAccepted: r.isAccepted,
        performedAt: r.performedAt,
      })),
    }));

    const totalPassed = instruments.reduce((s, i) => s + i.passed, 0);
    const totalWarning = instruments.reduce((s, i) => s + i.warning, 0);
    const totalFailed = instruments.reduce((s, i) => s + i.failed, 0);
    const totalNotEvaluable = instruments.reduce((s, i) => s + i.notEvaluable, 0);

    return {
      date: localDateKey(today), // 🔴 표시 날짜는 KST(toISOString().slice 는 로컬자정 today 를 전날로 만든다)
      summary: {
        // 🔴 `total` 은 **판정된 건수가 아니라 기록된 건수**다 — 판정 불가를 빼고 세면
        //    "오늘 3건 전부 PASS" 처럼 분모가 조용히 줄어든다(비율에는 분모를 함께).
        total: totalPassed + totalWarning + totalFailed + totalNotEvaluable,
        passed: totalPassed,
        warning: totalWarning,
        failed: totalFailed,
        notEvaluable: totalNotEvaluable,
      },
      instruments,
    };
  }
}
