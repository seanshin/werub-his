import { Injectable, Logger, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

export interface MappingCandidate {
  targetCode: string;
  targetDisplay: string;
  confidence: number;
  method: string;
  reason: string;
}

/**
 * 🔴 자동 매핑 결과 상태 — **다섯 가지 사실을 하나로 뭉치지 않는다**(2026-08-26).
 *
 * 종전에는 `FAILED` 하나였고 화면은 전부 "해당 없음"으로 그렸다. 그래서
 * **AI 서버가 죽은 것**과 **원래 해당 사항이 아닌 것**이 같은 얼굴을 하고 있었다.
 */
export type AutoMapStatus =
  /** 마스터 대조로 확정 */
  | 'CONFIRMED'
  /** 후보는 있으나 사람 승인이 필요(AI 제안 포함) */
  | 'PENDING'
  /** 🔴 이 소스 종류에 이 표준은 애초에 해당하지 않는다(진단→LOINC 등) — 갭이 아니다 */
  | 'NOT_APPLICABLE'
  /** 물어봤고 답도 왔는데 후보가 없다 — 진짜 '없음' */
  | 'NO_CANDIDATE'
  /** 후보는 있으나 신뢰도가 임계 미만 */
  | 'LOW_CONFIDENCE'
  /** 🔴 수행하지 못했다(AI 미가용·형식 불일치) — '없음'이 아니다 */
  | 'ERROR';

export interface AutoMapResult {
  sourceCode: string;
  sourceName: string;
  targetSystem: string;
  candidates: MappingCandidate[];
  status: AutoMapStatus;
  confirmedCode?: string;
  /** 화면이 그대로 말할 수 있는 사실 문장 — 상태만으로는 사람이 판단할 수 없다(`reasonMsg` 의 한국어 파생) */
  reason?: string;
  /** 정본 `{ k, params }` — 화면 `<ServerText>` 가 조립한다(2026-09-15 I2) */
  reasonMsg?: ServerMessage;
}

/** 결과 사유 — `reasonMsg` 가 정본, `reason` 은 같은 정본의 한국어 파생(템플릿 조립이 아니다) */
const withReason = (m: ServerMessage | undefined): Pick<AutoMapResult, 'reason' | 'reasonMsg'> =>
  m ? { reason: renderServerMessageKo(m), reasonMsg: m } : {};

// ICD-10 → SNOMED CT 주요 매핑표 (인메모리 L1 캐시)
const ICD10_SNOMED_MAP: Record<string, { code: string; display: string }> = {
  'J06.9': { code: '54150009', display: 'Upper respiratory infection' },
  'J00': { code: '82272006', display: 'Common cold' },
  'J18.9': { code: '233604007', display: 'Pneumonia' },
  'J45': { code: '195967001', display: 'Asthma' },
  'I10': { code: '59621000', display: 'Essential hypertension' },
  'I21': { code: '22298006', display: 'Myocardial infarction' },
  'I50': { code: '84114007', display: 'Heart failure' },
  'I63': { code: '432504007', display: 'Cerebral infarction' },
  'E11': { code: '44054006', display: 'Diabetes mellitus type 2' },
  'E10': { code: '46635009', display: 'Diabetes mellitus type 1' },
  'K21': { code: '235595009', display: 'Gastroesophageal reflux disease' },
  'K29.5': { code: '4556007', display: 'Gastritis' },
  'K35': { code: '74400008', display: 'Appendicitis' },
  'M54.5': { code: '279039007', display: 'Low back pain' },
  'M17': { code: '239873007', display: 'Osteoarthritis of knee' },
  'F32': { code: '35489007', display: 'Depressive disorder' },
  'C50': { code: '254837009', display: 'Breast cancer' },
  'C34': { code: '254637007', display: 'Lung cancer' },
  'N18.5': { code: '46177005', display: 'End-stage renal disease' },
  'D50': { code: '87522002', display: 'Iron deficiency anaemia' },
  'R50': { code: '386661006', display: 'Fever' },
  'A09': { code: '25374005', display: 'Gastroenteritis' },
};

/** 소스 코드 정보 — 매핑 엔진 내부에서 사용하는 공통 구조 */
export interface SourceCodeInfo {
  id: string;
  code: string;
  nameKo: string;
  nameEn?: string | null;
  category?: string | null;
  icd10Code?: string | null;
  loincCode?: string | null;
  specimen?: string | null;
  unit?: string | null;
}

export interface AutoMapperConfig {
  autoConfirmThreshold: number;
  pendingThreshold: number;
  rejectThreshold: number;
  maxCandidates: number;
  aiTimeoutMs: number;
  enableAutoMap: boolean;
  enableAutoSuggest: boolean;
  requireCrossValidation: boolean;
  bulkRateLimit: number;
}

const DEFAULT_CONFIG: AutoMapperConfig = {
  autoConfirmThreshold: 0.90,
  pendingThreshold: 0.70,
  rejectThreshold: 0.50,
  maxCandidates: 3,
  aiTimeoutMs: 10000,
  enableAutoMap: true,
  enableAutoSuggest: true,
  requireCrossValidation: true,
  bulkRateLimit: 5,
};

const CONFIG_KEY = 'automapper.config';

@Injectable()
export class AutoMapperService {
  private readonly logger = new Logger(AutoMapperService.name);

  // 런타임 캐시 (DB에서 로드)
  private config: AutoMapperConfig = { ...DEFAULT_CONFIG };
  private configLoaded = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
  ) {}

  private async loadConfig(): Promise<AutoMapperConfig> {
    if (this.configLoaded) return this.config;
    try {
      const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
      if (row?.value && typeof row.value === 'object') {
        this.config = { ...DEFAULT_CONFIG, ...(row.value as Partial<AutoMapperConfig>) };
      }
    } catch {
      this.logger.warn('Failed to load automapper config from DB, using defaults');
    }
    this.configLoaded = true;
    return this.config;
  }

  async getConfig(): Promise<AutoMapperConfig> {
    return this.loadConfig();
  }

  async setConfig(partial: Partial<AutoMapperConfig>, updatedBy?: string): Promise<AutoMapperConfig> {
    const current = await this.loadConfig();
    const merged = { ...current, ...partial };
    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      update: { value: merged as Prisma.InputJsonValue, updatedBy },
      create: { key: CONFIG_KEY, value: merged as Prisma.InputJsonValue, category: 'automapper', label: '자동 매핑 설정', updatedBy },
    });
    this.config = merged;
    this.configLoaded = true;
    return merged;
  }

  /** 단건 자동 매핑 */
  async mapSingle(params: {
    sourceTable: string;
    sourceId: string;
    targetSystems?: string[];
    autoConfirm?: boolean;
  }): Promise<AutoMapResult[]> {
    await this.loadConfig();
    const targetSystems = params.targetSystems ?? ['SNOMED_CT'];
    const results: AutoMapResult[] = [];

    // 소스 코드 정보 조회
    const source = await this.getSourceInfo(params.sourceTable, params.sourceId);
    if (!source) return results;

    for (const targetSystem of targetSystems) {
      // 🔴 범주가 맞지 않으면 묻지 않는다 — "해당 없음"이 아니라 "해당 사항 아님"이다
      if (!this.isApplicable(params.sourceTable, targetSystem)) {
        results.push({
          sourceCode: source.code, sourceName: source.nameKo, targetSystem,
          candidates: [], status: 'NOT_APPLICABLE',
          ...withReason(serverMsg('{원천} 에는 {표준} 이 해당하지 않습니다', { 원천: params.sourceTable, 표준: targetSystem })),
        });
        continue;
      }

      // 이미 매핑 존재 확인
      const existing = await this.prisma.terminologyMapping.findFirst({
        where: { sourceTable: params.sourceTable, sourceId: params.sourceId, targetSystem, isActive: true },
      });
      if (existing) continue;

      let candidates: MappingCandidate[] = [];

      // Stage 1: 규칙 기반 매핑
      const ruleResult = await this.ruleBasedMap(params.sourceTable, source, targetSystem);
      if (ruleResult) candidates.push(ruleResult);

      // Stage 2: AI 기반 매핑 (규칙 결과가 없거나 confidence < 0.90)
      let aiError: string | null = null;
      if (!ruleResult || ruleResult.confidence < this.config.autoConfirmThreshold) {
        try {
          const aiCandidates = await this.aiBasedMap(params.sourceTable, source, targetSystem);
          candidates.push(...aiCandidates);
        } catch (e: unknown) {
          // 🔴 실패를 기록해 결과에 싣는다 — 화면이 "해당 없음"이라 말하지 않게(2026-08-26)
          aiError = e instanceof Error ? e.message : String(e);
          this.logger.warn(`AI mapping failed for ${source.code}/${targetSystem}: ${aiError}`);
        }
      }

      // 중복 제거 + 정렬
      candidates = this.deduplicateAndSort(candidates);

      // Stage 3: 확정 또는 보류
      const best = candidates[0];
      let status: AutoMapStatus = aiError ? 'ERROR' : 'NO_CANDIDATE';
      let confirmedCode: string | undefined;
      let reasonMsg: ServerMessage | undefined = aiError
        ? serverMsg('자동 매핑을 수행하지 못했습니다: {오류}', { 오류: aiError })
        : serverMsg('후보를 찾지 못했습니다');

      if (best) {
        reasonMsg = undefined;
        /**
         * 🔴 **검증할 마스터가 없으면 자동 확정하지 않는다**(2026-08-26).
         *    이 저장소에는 SNOMED CT·LOINC·MedDRA **코드 사전이 없다**(모델 자체가 없음).
         *    즉 AI 가 낸 코드가 실재하는지 확인할 방법이 없다 — v4.4.0 에서 약물추천이
         *    존재하지 않는 약을 `source:'AI'` 로 내보내던 것과 같은 유형이고,
         *    표준 용어는 청구·기관 교환에 쓰이므로 더 위험하다.
         *    규칙 기반(마스터 대조) 결과만 자동 확정하고, AI 결과는 **사람 승인 대기**로 둔다.
         */
        const verifiable = best.method !== 'AI_LLM';
        if (!verifiable && (params.autoConfirm ?? true) && best.confidence >= this.config.autoConfirmThreshold) {
          await this.savePending(params.sourceTable, params.sourceId, source.code, source.nameKo, targetSystem, candidates);
          status = 'PENDING';
          reasonMsg = serverMsg('AI 제안은 대조할 표준 코드 사전이 없어 자동 확정하지 않습니다 — 사람 승인이 필요합니다');
        } else if (verifiable && (params.autoConfirm ?? true) && best.confidence >= this.config.autoConfirmThreshold) {
          // 자동 확정
          await this.confirmMapping(params.sourceTable, params.sourceId, source.code, targetSystem, best);
          status = 'CONFIRMED';
          confirmedCode = best.targetCode;
          await this.logAudit(params.sourceId, 'CREATED', null, best as unknown as Prisma.InputJsonValue, `자동확정 (${best.method}, ${best.confidence})`);
        } else if (best.confidence >= this.config.pendingThreshold) {
          // 승인 대기
          await this.savePending(params.sourceTable, params.sourceId, source.code, source.nameKo, targetSystem, candidates);
          status = 'PENDING';
        } else {
          status = 'LOW_CONFIDENCE';
          reasonMsg = serverMsg('후보는 있으나 신뢰도가 낮습니다({신뢰도}%)', { 신뢰도: Math.round(best.confidence * 100) });
        }
      }

      results.push({
        sourceCode: source.code,
        sourceName: source.nameKo,
        targetSystem,
        candidates,
        status,
        confirmedCode,
        ...withReason(reasonMsg),
      });
    }

    return results;
  }

  /** 벌크 매핑 */
  async mapBulk(params: {
    sourceTable: string;
    targetSystem: string;
    filter: string;
    autoConfirm: boolean;
    userId: string;
    limit?: number;
  }): Promise<string> {
    // 미매핑 코드 조회
    const unmappedIds = await this.getUnmappedIds(params.sourceTable, params.targetSystem, params.limit ?? 100);

    // 배치 작업 생성
    const batch = await this.prisma.mappingBatchJob.create({
      data: {
        sourceTable: params.sourceTable,
        targetSystem: params.targetSystem,
        filter: params.filter,
        totalCodes: unmappedIds.length,
        status: 'RUNNING',
        startedAt: new Date(),
        createdBy: params.userId,
      },
    });

    // 비동기 처리 (실제로는 Bull Queue 사용 권장)
    this.processBulk(batch.id, unmappedIds, params).catch((e: unknown) => {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Bulk mapping failed: ${errMsg}`);
      this.prisma.mappingBatchJob.update({
        where: { id: batch.id },
        data: { status: 'FAILED', errorLog: errMsg, completedAt: new Date() },
      });
    });

    return batch.id;
  }

  private async processBulk(
    batchId: string,
    ids: { id: string }[],
    params: { sourceTable: string; targetSystem: string; filter: string; autoConfirm: boolean; userId: string; limit?: number },
  ) {
    // 🔴 상태를 뭉치지 않는다 — 무엇을 다시 돌려야 하는지(ERROR)와
    //    애초에 돌릴 필요가 없는 것(NOT_APPLICABLE)이 구분돼야 한다
    let confirmed = 0, pending = 0, failed = 0, notApplicable = 0, noCandidate = 0, errored = 0;

    for (let i = 0; i < ids.length; i++) {
      const results = await this.mapSingle({
        sourceTable: params.sourceTable,
        sourceId: ids[i].id,
        targetSystems: [params.targetSystem],
        autoConfirm: params.autoConfirm,
      });

      for (const r of results) {
        if (r.status === 'CONFIRMED') confirmed++;
        else if (r.status === 'PENDING') pending++;
        else if (r.status === 'NOT_APPLICABLE') notApplicable++;
        else if (r.status === 'NO_CANDIDATE') noCandidate++;
        else if (r.status === 'ERROR') errored++;
        else failed++; // LOW_CONFIDENCE
      }

      // 진행 상태 업데이트
      await this.prisma.mappingBatchJob.update({
        where: { id: batchId },
        data: {
          processedCodes: i + 1, confirmedCount: confirmed, pendingCount: pending, failedCount: failed,
          notApplicableCount: notApplicable, noCandidateCount: noCandidate, errorCount: errored,
        },
      });

      // Rate limiting (config-driven)
      const delayMs = Math.max(100, Math.floor(1000 / this.config.bulkRateLimit));
      await new Promise(r => setTimeout(r, delayMs));
    }

    await this.prisma.mappingBatchJob.update({
      where: { id: batchId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /** AI 매핑 후보 제안 (저장 안 함) */
  async suggest(sourceTable: string, sourceId: string, targetSystem: string): Promise<MappingCandidate[]> {
    const source = await this.getSourceInfo(sourceTable, sourceId);
    if (!source) return [];

    const candidates: MappingCandidate[] = [];
    const rule = await this.ruleBasedMap(sourceTable, source, targetSystem);
    if (rule) candidates.push(rule);

    try {
      const ai = await this.aiBasedMap(sourceTable, source, targetSystem);
      candidates.push(...ai);
    } catch { /* ignore */ }

    return this.deduplicateAndSort(candidates);
  }

  // ── Stage 1: 규칙 기반 ──

  private async ruleBasedMap(sourceTable: string, source: SourceCodeInfo, targetSystem: string): Promise<MappingCandidate | null> {
    if (targetSystem === 'SNOMED_CT' && sourceTable === 'diagnosis_codes') {
      const code = source.icd10Code ?? source.code;
      const mapped = ICD10_SNOMED_MAP[code];
      if (mapped) {
        return { targetCode: mapped.code, targetDisplay: mapped.display, confidence: 0.95, method: 'RULE_OFFICIAL', reason: 'ICD-10→SNOMED CT 공식 매핑표' };
      }
      // 접두어 유사 매핑
      const prefix = code.split('.')[0];
      const similar = ICD10_SNOMED_MAP[prefix];
      if (similar) {
        return { targetCode: similar.code, targetDisplay: similar.display, confidence: 0.75, method: 'RULE_SIMILAR', reason: `ICD-10 접두어 ${prefix} 유사 매핑` };
      }
    }

    if (targetSystem === 'LOINC' && sourceTable === 'lab_test_codes' && source.loincCode) {
      return { targetCode: source.loincCode, targetDisplay: source.nameEn ?? source.nameKo, confidence: 0.98, method: 'RULE_FIELD', reason: 'LOINC 코드 필드 직접 매핑' };
    }

    return null;
  }

  // ── Stage 2: AI 기반 ──

  /**
   * 🔴 이 소스 종류에 그 표준을 물어보는 것이 **말이 되는가**.
   *
   * 2026-08-26 실측: 진단코드(5A11 제2형 당뇨병)에 대해 LOINC(검사 관찰)·ICD10PCS(시술)를 묻고
   * "해당 없음"을 미매핑으로 세고 있었다 — **범주 오류를 갭으로 계산**한 것이다(분모 오염).
   * 해당 없는 조합은 애초에 묻지 않고, 그 사실을 `NOT_APPLICABLE` 로 말한다.
   */
  private isApplicable(sourceTable: string, targetSystem: string): boolean {
    const t = sourceTable.toLowerCase();
    if (t.includes('diagnosis')) return ['SNOMED_CT', 'MedDRA', 'ICF'].includes(targetSystem);
    if (t.includes('lab') || t.includes('test')) return ['LOINC', 'SNOMED_CT'].includes(targetSystem);
    if (t.includes('procedure') || t.includes('surgery')) return ['ICD10PCS', 'SNOMED_CT'].includes(targetSystem);
    if (t.includes('medication') || t.includes('drug')) return ['SNOMED_CT', 'MedDRA'].includes(targetSystem);
    if (t.includes('nursing')) return ['SNOMED_CT', 'ICF'].includes(targetSystem);
    // 🔴 모르는 소스면 막지 않는다(막으면 새 코드종이 조용히 매핑에서 빠진다)
    return true;
  }

  private async aiBasedMap(sourceTable: string, source: SourceCodeInfo, targetSystem: string): Promise<MappingCandidate[]> {
    let prompt = '';

    if (targetSystem === 'SNOMED_CT') {
      prompt = `다음 의료 코드에 해당하는 SNOMED CT 코드를 찾아주세요.\n코드: ${source.code}\n한글명: ${source.nameKo}\n영문명: ${source.nameEn ?? ''}\n분류: ${source.category ?? ''}\n\nJSON 형식으로 최대 3개 후보를 반환:\n[{"code":"숫자","display":"영문명","confidence":0.0~1.0}]`;
    } else if (targetSystem === 'LOINC') {
      prompt = `다음 검사항목의 LOINC 코드를 찾아주세요.\n검사명: ${source.nameKo}\n영문명: ${source.nameEn ?? ''}\n검체: ${source.specimen ?? ''}\n단위: ${source.unit ?? ''}\n\nJSON: [{"code":"LOINC코드","display":"Component","confidence":0.0~1.0}]`;
    } else if (targetSystem === 'MedDRA') {
      prompt = `다음 증상/부작용의 MedDRA PT 코드를 찾아주세요.\n증상: ${source.nameKo}\n영문: ${source.nameEn ?? ''}\n\nJSON: [{"code":"8자리숫자","display":"PT영문명","confidence":0.0~1.0}]`;
    } else {
      return [];
    }

    try {
      const result = await this.medicalAi.reference(prompt);
      const answer = typeof result?.answer === 'string' ? result.answer : '';

      // JSON 파싱 시도
      const jsonMatch = answer.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
        return parsed.slice(0, 3).map((c) => ({
          targetCode: String(c.code ?? ''),
          targetDisplay: String(c.display ?? ''),
          confidence: Math.min(1, Math.max(0, Number(c.confidence ?? 0.7))),
          method: 'AI_LLM',
          reason: 'AI 매핑 (WeRU.B)',
        })).filter((c: MappingCandidate) => c.targetCode);
      }
      // 🔴 응답은 왔는데 JSON 이 없다 = 모델이 형식을 안 지킨 것이다. "후보 없음"과 다르다.
      throw new Error(`AI 응답에서 후보 목록을 찾지 못했습니다(형식 불일치)`);
    } catch (e: unknown) {
      // 🔴 **삼키지 않는다.** 종전에는 여기서 `[]` 를 돌려줘 실패가 "해당 없음"으로 보였다.
      //    부르는 쪽이 실패와 없음을 구분할 수 있도록 그대로 올린다.
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // ── 헬퍼 ──

  private async getSourceInfo(table: string, id: string): Promise<SourceCodeInfo | null> {
    switch (table) {
      case 'diagnosis_codes': return this.prisma.diagnosisCode.findUnique({ where: { id } });
      case 'procedure_codes': return this.prisma.procedureCode.findUnique({ where: { id } });
      case 'medication_codes': return this.prisma.medicationCode.findUnique({ where: { id } });
      case 'lab_test_codes': return this.prisma.labTestCode.findUnique({ where: { id } });
      default: return null;
    }
  }

  private async getUnmappedIds(sourceTable: string, targetSystem: string, limit: number) {
    const mapped = await this.prisma.terminologyMapping.findMany({
      where: { sourceTable, targetSystem, isActive: true },
      select: { sourceId: true },
    });
    const mappedIds = new Set(mapped.map(m => m.sourceId));

    let allIds: { id: string }[] = [];
    switch (sourceTable) {
      case 'diagnosis_codes':
        allIds = await this.prisma.diagnosisCode.findMany({ where: { isActive: true }, select: { id: true }, take: limit * 2 });
        break;
      case 'procedure_codes':
        allIds = await this.prisma.procedureCode.findMany({ where: { isActive: true }, select: { id: true }, take: limit * 2 });
        break;
      case 'medication_codes':
        allIds = await this.prisma.medicationCode.findMany({ where: { isActive: true }, select: { id: true }, take: limit * 2 });
        break;
      case 'lab_test_codes':
        allIds = await this.prisma.labTestCode.findMany({ where: { isActive: true }, select: { id: true }, take: limit * 2 });
        break;
    }

    return allIds.filter(a => !mappedIds.has(a.id)).slice(0, limit);
  }

  private deduplicateAndSort(candidates: MappingCandidate[]): MappingCandidate[] {
    const seen = new Set<string>();
    return candidates
      .filter(c => { if (seen.has(c.targetCode)) return false; seen.add(c.targetCode); return true; })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxCandidates);
  }

  private async confirmMapping(sourceTable: string, sourceId: string, sourceCode: string, targetSystem: string, candidate: MappingCandidate) {
    await this.prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable, sourceId, targetSystem, targetCode: candidate.targetCode } },
      update: { targetDisplay: candidate.targetDisplay, isActive: true },
      create: {
        sourceTable, sourceId, sourceCode, targetSystem,
        targetCode: candidate.targetCode, targetDisplay: candidate.targetDisplay,
        equivalence: 'equivalent', mapSource: candidate.method.startsWith('AI') ? 'AI_AUTO' : 'OFFICIAL',
        confidence: candidate.confidence,
      },
    });
  }

  private async savePending(sourceTable: string, sourceId: string, sourceCode: string, sourceName: string, targetSystem: string, candidates: MappingCandidate[]) {
    await this.prisma.pendingMapping.create({
      data: {
        sourceTable, sourceId, sourceCode, sourceName, targetSystem,
        candidates: candidates as unknown as Prisma.InputJsonValue,
        bestCandidate: candidates[0]?.targetCode,
        bestConfidence: candidates[0]?.confidence,
      },
    });
  }

  private async logAudit(
    mappingId: string,
    action: string,
    prev: Prisma.InputJsonValue | null,
    next: Prisma.InputJsonValue | null,
    reason?: string,
  ) {
    await this.prisma.mappingAuditLog.create({
      data: { mappingId, action, previousData: prev ?? Prisma.JsonNull, newData: next ?? Prisma.JsonNull, reason },
    }).catch(() => {});
  }

  // ── 승인/거부 ──

  /**
   * Stage 4 — 관리자 최종 확정.
   *
   * 🔴 W7(2026-08): 이 메서드가 `clinicalStatus` 를 **읽지도 않아** Stage 3(임상 검토)를 건너뛴 채
   *    확정할 수 있었고, 그렇게 만들어진 TerminologyMapping 이 `mapSource='AI_REVIEWED'`(= 검토됨)로
   *    봉인됐다. 검토하지 않은 것을 검토했다고 적는 것(P16)이며, 화면(/mapping-review)이 도식한
   *    "Stage 1~2 자동 → Stage 3 임상 검토 → Stage 4 관리자 확정" 순서와도 어긋났다.
   *    → 임상 승인(APPROVED)이 없으면 fail-closed 로 거부한다.
   *    (스키마 주석의 'SKIPPED'는 이를 설정하는 경로가 아직 없어 통과시키지 않는다 — 없는 상태에 문을 열지 않는다)
   */
  async confirmPending(pendingId: string, selectedCode: string, userId: string, notes?: string) {
    const pending = await this.prisma.pendingMapping.findUnique({ where: { id: pendingId } });
    // 🔴 (2026-09-15 D1) 종전엔 `return null` 이었다 — 화면은 200 을 받고 **확정된 것처럼** 그렸다.
    //    없는 것과 이미 처리된 것은 다른 사실이다(거부와 마찬가지로 코드로 말한다).
    if (!pending) throw new NotFoundException({ code: 'PENDING_MAPPING_NOT_FOUND', message: '매핑 검토 항목을 찾을 수 없습니다' });
    if (pending.status !== 'PENDING') {
      throw new ConflictException({
        code: 'PENDING_MAPPING_NOT_PENDING',
        message: '이미 처리된 매핑입니다',
        details: { status: pending.status },
      });
    }

    if (pending.clinicalStatus !== 'APPROVED') {
      throw new ConflictException({
        code: 'CLINICAL_REVIEW_REQUIRED',
        message:
          pending.clinicalStatus === 'REJECTED'
            ? '임상 검토에서 반려된 매핑입니다 — 확정할 수 없습니다(Stage 3 반려)'
            : `임상 검토(Stage 3)가 끝나지 않았습니다 — 현재 임상 상태 ${pending.clinicalStatus}. 임상 승인 후 확정할 수 있습니다`,
        details: { clinicalStatus: pending.clinicalStatus },
      });
    }

    const candidates = pending.candidates as unknown as MappingCandidate[];
    // 🔴 (2026-09-15 B10) 종전 `?? candidates[0]` — 선택 코드가 없거나 후보에 없으면 **첫 후보로 조용히 확정**했다
    //    (사람이 고르지 않은 표준코드가 AI_REVIEWED 로 봉인됨). 후보 밖 선택은 확정하지 않는다.
    if (!candidates?.length) {
      throw new BadRequestException({ code: 'PENDING_MAPPING_NO_CANDIDATES', message: '이 매핑에는 후보 코드가 없습니다 — 확정할 수 없습니다' });
    }
    const selected = candidates.find((c) => c.targetCode === selectedCode);
    if (!selected) {
      throw new BadRequestException({ code: 'SELECTED_CODE_NOT_IN_CANDIDATES', message: '선택한 코드가 이 매핑의 후보에 없습니다' });
    }

    // 🔴 (D1) 종전엔 매핑을 **먼저 만들고** 상태를 갱신했다 — 두 관리자가 동시에 확정하면 TerminologyMapping 이
    //    두 개 생겼고(같은 소스에 표준코드 둘), 하나는 어느 검토 항목에도 매여 있지 않았다.
    //    상태 선점(PENDING 조건부)이 이긴 쪽만 매핑을 만든다.
    const mapping = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.pendingMapping.updateMany({
        where: { id: pendingId, status: 'PENDING' },
        data: { status: 'CONFIRMED', reviewedBy: userId, reviewedAt: new Date(), reviewNotes: notes, selectedCode },
      });
      if (claimed.count === 0) return null;
      const created = await tx.terminologyMapping.create({
        data: {
          sourceTable: pending.sourceTable, sourceId: pending.sourceId, sourceCode: pending.sourceCode,
          targetSystem: pending.targetSystem, targetCode: selected.targetCode, targetDisplay: selected.targetDisplay,
          equivalence: 'equivalent', mapSource: 'AI_REVIEWED', confidence: selected.confidence,
        },
      });
      await tx.pendingMapping.update({ where: { id: pendingId }, data: { mappingId: created.id } });
      return created;
    });
    if (!mapping) {
      throw new ConflictException({ code: 'PENDING_MAPPING_STATE_CHANGED', message: '다른 처리로 상태가 이미 바뀌었습니다 — 새로 고친 뒤 다시 확인하세요' });
    }

    await this.logAudit(mapping.id, 'CONFIRMED', null, selected as unknown as Prisma.InputJsonValue, `관리자 승인: ${notes ?? ''}`);
    return mapping;
  }

  async rejectPending(pendingId: string, userId: string, notes?: string) {
    // 🔴 (2026-09-15 B10) 종전엔 상태를 보지 않아 **이미 확정(CONFIRMED)된 매핑도 REJECTED 로 뒤집혔다** —
    //    확정 때 만든 TerminologyMapping 은 그대로 살아 있어 "거부된 매핑이 쓰이는" 모순이 됐다. 대기(PENDING)만 거부한다.
    const res = await this.prisma.pendingMapping.updateMany({
      where: { id: pendingId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date(), reviewNotes: notes },
    });
    if (res.count === 0) {
      const cur = await this.prisma.pendingMapping.findUnique({ where: { id: pendingId }, select: { status: true } });
      if (!cur) throw new NotFoundException({ code: 'PENDING_MAPPING_NOT_FOUND', message: '매핑 검토 항목을 찾을 수 없습니다' });
      throw new ConflictException({ code: 'PENDING_MAPPING_NOT_PENDING', message: '이미 처리된 매핑입니다', details: { status: cur.status } });
    }
    return this.prisma.pendingMapping.findUnique({ where: { id: pendingId } });
  }

  async getPendingList(status?: string) {
    return this.prisma.pendingMapping.findMany({
      where: { status: status ?? 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── 임상 검토 (의료진/간호파트) ──

  async getClinicalReviewList(filters: {
    clinicalStatus?: string;
    department?: string;
    sourceTable?: string;
    targetSystem?: string;
  }) {
    const where: Record<string, unknown> = { status: 'PENDING' };
    if (filters.clinicalStatus) where.clinicalStatus = filters.clinicalStatus;
    else where.clinicalStatus = 'AWAITING';
    if (filters.department) where.assignedDept = filters.department;
    if (filters.sourceTable) where.sourceTable = filters.sourceTable;
    if (filters.targetSystem) where.targetSystem = filters.targetSystem;

    return this.prisma.pendingMapping.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  /**
   * 임상 검토(Stage 3) 판정 — 🔴 (2026-09-15 D1) 종전엔 없는 항목도 이미 판정된 항목도 `null` 을 돌려줬다.
   * 화면은 200 을 받아 **승인된 것처럼** 그렸고(조용한 무동작), 다른 검토자의 판정을 덮어쓸 뻔한 자리도 보이지 않았다.
   * 대기(AWAITING)만 판정한다 · 조건부 갱신으로 동시 판정은 한 명만 이긴다.
   */
  private async clinicalDecide(pendingId: string, next: 'APPROVED' | 'REJECTED', userId: string, role: string, notes?: string) {
    const pending = await this.prisma.pendingMapping.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException({ code: 'PENDING_MAPPING_NOT_FOUND', message: '매핑 검토 항목을 찾을 수 없습니다' });
    if (pending.clinicalStatus !== 'AWAITING') {
      throw new ConflictException({
        code: 'CLINICAL_REVIEW_NOT_AWAITING',
        message: '이미 임상 검토가 끝난 매핑입니다',
        details: { clinicalStatus: pending.clinicalStatus },
      });
    }
    const upd = await this.prisma.pendingMapping.updateMany({
      where: { id: pendingId, clinicalStatus: 'AWAITING' },
      data: {
        clinicalStatus: next,
        clinicalReviewedBy: userId,
        clinicalReviewedAt: new Date(),
        clinicalReviewerRole: role,
        clinicalNotes: notes,
      },
    });
    if (upd.count === 0) {
      throw new ConflictException({ code: 'CLINICAL_REVIEW_STATE_CHANGED', message: '다른 처리로 상태가 이미 바뀌었습니다 — 새로 고친 뒤 다시 확인하세요' });
    }
    return this.prisma.pendingMapping.findUnique({ where: { id: pendingId } });
  }

  async clinicalApprove(pendingId: string, userId: string, role: string, notes?: string) {
    return this.clinicalDecide(pendingId, 'APPROVED', userId, role, notes);
  }

  async clinicalReject(pendingId: string, userId: string, role: string, notes?: string) {
    return this.clinicalDecide(pendingId, 'REJECTED', userId, role, notes);
  }

  async assignDepartment(pendingId: string, department: string, priority?: string) {
    return this.prisma.pendingMapping.update({
      where: { id: pendingId },
      data: { assignedDept: department, ...(priority ? { priority } : {}) },
    });
  }

  async getClinicalReviewStats() {
    const [awaiting, approved, rejected] = await Promise.all([
      this.prisma.pendingMapping.count({ where: { status: 'PENDING', clinicalStatus: 'AWAITING' } }),
      this.prisma.pendingMapping.count({ where: { status: 'PENDING', clinicalStatus: 'APPROVED' } }),
      this.prisma.pendingMapping.count({ where: { status: 'PENDING', clinicalStatus: 'REJECTED' } }),
    ]);

    // 부서별 대기 건수
    const byDept = await this.prisma.pendingMapping.groupBy({
      by: ['assignedDept'],
      where: { status: 'PENDING', clinicalStatus: 'AWAITING', assignedDept: { not: null } },
      _count: true,
    });

    // 표준체계별 대기 건수
    const bySystem = await this.prisma.pendingMapping.groupBy({
      by: ['targetSystem'],
      where: { status: 'PENDING', clinicalStatus: 'AWAITING' },
      _count: true,
    });

    return {
      awaiting, approved, rejected,
      byDepartment: byDept.map(d => ({ department: d.assignedDept, count: d._count })),
      byTargetSystem: bySystem.map(s => ({ system: s.targetSystem, count: s._count })),
    };
  }

  async getBatchStatus(batchId: string) {
    return this.prisma.mappingBatchJob.findUnique({ where: { id: batchId } });
  }

  /** 코드명 기반 AI 매핑 제안 (코드 저장 전 미리보기) */
  async suggestByName(params: {
    sourceTable: string;
    code: string;
    nameKo: string;
    nameEn?: string;
    category?: string;
    targetSystems?: string[];
  }): Promise<Record<string, MappingCandidate[]>> {
    const targetSystems = params.targetSystems ?? ['SNOMED_CT', 'LOINC', 'MedDRA'];
    const source: SourceCodeInfo = { id: '', code: params.code, nameKo: params.nameKo, nameEn: params.nameEn ?? '', category: params.category ?? '', icd10Code: params.code };
    const result: Record<string, MappingCandidate[]> = {};

    for (const ts of targetSystems) {
      const candidates: MappingCandidate[] = [];

      // Stage 1: 규칙
      const rule = await this.ruleBasedMap(params.sourceTable, source, ts);
      if (rule) candidates.push(rule);

      // Stage 2: AI
      if (!rule || rule.confidence < this.config.autoConfirmThreshold) {
        try {
          const ai = await this.aiBasedMap(params.sourceTable, source, ts);
          candidates.push(...ai);
        } catch { /* ignore */ }
      }

      result[ts] = this.deduplicateAndSort(candidates);
    }

    return result;
  }

  /** 최근 매핑 활동 (자동확정 + 승인 + 거부) */
  async getRecentActivity() {
    const [recentMappings, recentPending] = await Promise.all([
      this.prisma.terminologyMapping.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, sourceCode: true, targetSystem: true, targetCode: true, targetDisplay: true, mapSource: true, confidence: true, createdAt: true },
      }),
      this.prisma.pendingMapping.findMany({
        where: { status: { in: ['CONFIRMED', 'REJECTED'] } },
        orderBy: { reviewedAt: 'desc' },
        take: 10,
        select: { id: true, sourceCode: true, sourceName: true, targetSystem: true, status: true, bestCandidate: true, bestConfidence: true, selectedCode: true, reviewedAt: true, createdAt: true },
      }),
    ]);

    // Merge and sort by date
    const activities = [
      ...recentMappings.map(m => ({
        type: 'mapping' as const,
        sourceCode: m.sourceCode,
        targetSystem: m.targetSystem,
        targetCode: m.targetCode,
        targetDisplay: m.targetDisplay,
        mapSource: m.mapSource,
        confidence: m.confidence,
        date: m.createdAt,
      })),
      ...recentPending.map(p => ({
        type: 'review' as const,
        sourceCode: p.sourceCode,
        targetSystem: p.targetSystem,
        targetCode: p.selectedCode ?? p.bestCandidate ?? '',
        targetDisplay: p.sourceName,
        mapSource: p.status === 'CONFIRMED' ? 'REVIEWED' : 'REJECTED',
        confidence: p.bestConfidence,
        date: p.reviewedAt ?? p.createdAt,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);

    return activities;
  }

  async getMappingStats() {
    const [totalDiag, totalProc, totalMed, totalLab] = await Promise.all([
      this.prisma.diagnosisCode.count({ where: { isActive: true } }),
      this.prisma.procedureCode.count({ where: { isActive: true } }),
      this.prisma.medicationCode.count({ where: { isActive: true } }),
      this.prisma.labTestCode.count({ where: { isActive: true } }),
    ]);

    const mappings = await this.prisma.terminologyMapping.groupBy({
      by: ['targetSystem'],
      where: { isActive: true },
      _count: true,
    });

    /**
     * 🔴 (2026-09-03) 표준별·유형별 수치를 서버 실측으로 낸다.
     *    종전엔 화면이 분모를 코드 상수(`ICF: 20`)로 들고, 유형별 미매핑은
     *    전체 매핑 수를 코드 수 비율로 **안분한 추정치**를 확정 수치처럼 그렸다.
     *    분모 = 엔진 자신의 적용 정책(`isApplicable`) × 코드 마스터 실카운트,
     *    분자 = source 중복을 제거한 실매핑 수(한 코드에 매핑 여러 줄이 흔하다).
     */
    const cross = await this.prisma.$queryRaw<{ source_table: string; target_system: string; n: number }[]>`
      SELECT source_table, target_system, COUNT(DISTINCT source_id)::int AS n
      FROM terminology_mappings WHERE is_active = true
      GROUP BY source_table, target_system
    `;
    const anyByTable = await this.prisma.$queryRaw<{ source_table: string; n: number }[]>`
      SELECT source_table, COUNT(DISTINCT source_id)::int AS n
      FROM terminology_mappings WHERE is_active = true
      GROUP BY source_table
    `;

    const TABLE_TOTALS: Record<string, number> = {
      diagnosis_codes: totalDiag, procedure_codes: totalProc,
      medication_codes: totalMed, lab_test_codes: totalLab,
    };
    const knownTables = Object.keys(TABLE_TOTALS);
    const systemCoverage = mappings.map(m => {
      const system = m.targetSystem;
      const applicableTables = knownTables.filter(t => this.isApplicable(t, system));
      const applicableTotal = applicableTables.reduce((s, t) => s + TABLE_TOTALS[t], 0);
      const rows = cross.filter(c => c.target_system === system);
      /**
       * 🔴 분자는 분모와 같은 모집단만 — 운영 실측에서 LOINC 가 42/35(분자>분모)로 나왔다.
       *    정책상 비적용 테이블(진단→LOINC 등)의 매핑을 분자에 섞으면 비율이 100% 를 넘는다.
       *    정책 밖 매핑은 접지 않고 따로 센다(그 존재 자체가 어휘/정책 드리프트 신호다).
       */
      const mapped = rows.filter(c => applicableTables.includes(c.source_table)).reduce((s, c) => s + c.n, 0);
      const outOfPolicyMapped = rows
        .filter(c => knownTables.includes(c.source_table) && !applicableTables.includes(c.source_table))
        .reduce((s, c) => s + c.n, 0);
      // 🔴 세지 못하는 소스(간호 등 4대 마스터 밖)는 접지 않고 따로 밝힌다
      const unknownSourceMapped = rows.filter(c => !knownTables.includes(c.source_table)).reduce((s, c) => s + c.n, 0);
      return { system, mapped, applicableTotal, applicableTables, outOfPolicyMapped, unknownSourceMapped };
    });

    const tableKey: Record<string, 'diagnosis' | 'procedure' | 'medication' | 'labTest'> = {
      diagnosis_codes: 'diagnosis', procedure_codes: 'procedure',
      medication_codes: 'medication', lab_test_codes: 'labTest',
    };
    const mappedByType = { diagnosis: 0, procedure: 0, medication: 0, labTest: 0 };
    for (const row of anyByTable) {
      const k = tableKey[row.source_table];
      if (k) mappedByType[k] = row.n;
    }
    const mappedDistinctTotal = anyByTable
      .filter(r => tableKey[r.source_table])
      .reduce((s, r) => s + r.n, 0);

    const pending = await this.prisma.pendingMapping.count({ where: { status: 'PENDING' } });
    const totalCodes = totalDiag + totalProc + totalMed + totalLab;
    const totalMappings = mappings.reduce((s, m) => s + m._count, 0);

    return {
      totalCodes,
      totalMappings,
      // 🔴 매핑률 분자도 매핑 줄 수가 아니라 매핑된 코드 수 — 한 코드의 다중 매핑이 률을 부풀리지 않게
      mappingRate: totalCodes > 0 ? Math.round((mappedDistinctTotal / totalCodes) * 100) : 0,
      mappedDistinctTotal,
      pendingCount: pending,
      bySystem: mappings.map(m => ({ system: m.targetSystem, count: m._count })),
      systemCoverage,
      byCodeType: { diagnosis: totalDiag, procedure: totalProc, medication: totalMed, labTest: totalLab },
      mappedByType,
    };
  }

  // ── 스케줄 배치 잡 ──

  /** 매일 새벽 3시 — 미매핑 코드 자동 매핑 (최대 50건/회) */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledAutoMapping() {
    const config = await this.loadConfig();
    if (!config.enableAutoMap) {
      this.logger.log('[Cron] 자동 매핑 비활성화 상태, 스킵');
      return;
    }

    this.logger.log('[Cron] 스케줄 자동 매핑 시작');
    const tables = ['DiagnosisCode', 'ProcedureCode', 'MedicationCode'] as const;
    const targetSystems = ['SNOMED_CT', 'LOINC', 'MedDRA'];
    let totalProcessed = 0;
    let totalConfirmed = 0;
    let totalPending = 0;

    for (const table of tables) {
      for (const ts of targetSystems) {
        const unmapped = await this.getUnmappedIds(table, ts, 50);
        if (unmapped.length === 0) continue;

        // 배치 작업 생성
        const batch = await this.prisma.mappingBatchJob.create({
          data: {
            sourceTable: table,
            targetSystem: ts,
            filter: 'CRON_SCHEDULED',
            totalCodes: unmapped.length,
            status: 'RUNNING',
            startedAt: new Date(),
            // 🔴 (2026-09-15) 종전 'SYSTEM_CRON' — UUID 컬럼에 문자열이라 enableAutoMap 을 켜는 순간 이 create 가 실패했다.
            //    사람 행위자가 없으니 null(지어내지 않는다) · 크론 출처는 filter 'CRON_SCHEDULED' 가 말한다.
            createdBy: null,
          },
        });

        let confirmed = 0, pending = 0, failed = 0;
        for (let i = 0; i < unmapped.length; i++) {
          try {
            const results = await this.mapSingle({
              sourceTable: table,
              sourceId: unmapped[i].id,
              targetSystems: [ts],
              autoConfirm: true,
            });
            for (const r of results) {
              if (r.status === 'CONFIRMED') confirmed++;
              else if (r.status === 'PENDING') pending++;
              else failed++;
            }
          } catch (e: unknown) {
            failed++;
            this.logger.warn(`[Cron] 매핑 실패 ${table}/${unmapped[i].id}: ${e instanceof Error ? e.message : String(e)}`);
          }

          await this.prisma.mappingBatchJob.update({
            where: { id: batch.id },
            data: { processedCodes: i + 1, confirmedCount: confirmed, pendingCount: pending, failedCount: failed },
          });

          const delayMs = Math.max(100, Math.floor(1000 / config.bulkRateLimit));
          await new Promise(r => setTimeout(r, delayMs));
        }

        await this.prisma.mappingBatchJob.update({
          where: { id: batch.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        totalProcessed += unmapped.length;
        totalConfirmed += confirmed;
        totalPending += pending;
      }
    }

    this.logger.log(`[Cron] 스케줄 자동 매핑 완료: ${totalProcessed}건 처리, ${totalConfirmed} 확정, ${totalPending} 대기`);
  }

  /** 만료된 PendingMapping 정리 (매일 새벽 4시) */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpiredPending() {
    const result = await this.prisma.pendingMapping.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'REJECTED' },
    });
    if (result.count > 0) {
      this.logger.log(`[Cron] 만료 PendingMapping ${result.count}건 거부 처리`);
    }
  }
}
