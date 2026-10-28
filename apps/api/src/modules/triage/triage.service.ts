import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import {
  matchPhraseIn,
  normalizeSymptomText,
  isPatientActionableEmergencyMsg,
  PATIENT_EMERGENCY_ACTION,
  PATIENT_EMERGENCY_UNDETERMINED,
  TRIAGE_EXAMPLE_PHRASES,
} from './symptom-match';

/**
 * 🔴 원 결함 T3 — 예전에는 `emergency: boolean` 이라 **못 알아들은 FALLBACK 도 `false`(응급 아님)** 로 단정했다.
 *    모름을 아님으로 뒤바꿔 말하는 것(P1). 이제 3상으로 구분한다.
 *  - EMERGENCY      : DB 가 응급으로 표시한 증상을 실제로 찾았다
 *  - NON_EMERGENCY  : 증상을 찾았고 그 중 응급 표시가 없다 (판단한 결과의 '아님')
 *  - UNDETERMINED   : 증상을 못 찾았다 — 응급 여부를 **모른다**
 */
export type EmergencyAssessment = 'EMERGENCY' | 'NON_EMERGENCY' | 'UNDETERMINED';

export interface TriageResult {
  symptoms: string[];
  recommendations: { department: string; priority: number; confidence: number; reason: string }[];
  emergencyAssessment: EmergencyAssessment;
  /** DB 원문(감별진단 임상 메모일 수 있음) — 🔴 환자에게 그대로 내보내지 말 것(T6) */
  emergencyMsg: string | null;
  /** 환자에게 내보내는 행동 지시 — 코드 정본(T6). NON_EMERGENCY 면 null */
  patientEmergencyAction: string | null;
  source: 'DB' | 'AI' | 'HYBRID' | 'FALLBACK';
}

export interface ExtractedSymptoms {
  symptoms: string[];
  symptomIds: string[];
  /** 실제로 맞은 별칭/증상명 원문 — 호출측 이름 오추출 방지용 */
  matchedTerms: string[];
  /** 정규화된 입력 안에서 매칭이 차지한 구간 — 이름 오추출 방지용 */
  matchedSpans: { start: number; end: number }[];
  /** 매칭에 쓴 정규화 입력(호출측이 같은 좌표계를 쓰도록 함께 넘긴다) */
  normalizedText: string;
}

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
  ) {}

  /**
   * 트리아지 평가 — DB → AI → fallback 순서
   * @param pre 이미 뽑아둔 증상(중복 추출·중복 히트 카운트 방지). agent-session 이 넘긴다.
   */
  async evaluate(
    text: string,
    patientInfo?: { age?: number; sex?: string; duration?: string; severity?: string },
    pre?: ExtractedSymptoms,
  ): Promise<TriageResult> {
    // 1. 별칭으로 증상 추출 (정규화 매칭 — 정본 symptom-match.ts)
    const extracted = pre ?? await this.extractSymptoms(text);

    // 2. 응급 판정 — 증상을 못 찾았으면 '아님'이 아니라 '모름'
    let assessment: EmergencyAssessment = extracted.symptoms.length > 0 ? 'NON_EMERGENCY' : 'UNDETERMINED';
    let emergencyMsg: string | null = null;
    if (extracted.symptoms.length > 0) {
      const emergencySymptom = await this.prisma.triageSymptom.findFirst({
        where: { name: { in: extracted.symptoms }, isEmergency: true, isActive: true },
      });
      if (emergencySymptom) {
        assessment = 'EMERGENCY';
        emergencyMsg = emergencySymptom.emergencyMsg ?? null;
      }
    }

    // 3. DB 규칙 조회
    let recommendations: TriageResult['recommendations'] = [];
    if (extracted.symptoms.length > 0) {
      recommendations = await this.getDbRecommendations(extracted.symptomIds);
    }

    // 4. DB 결과 있으면 반환
    if (recommendations.length > 0) {
      return this.finalize(extracted.symptoms, recommendations, assessment, emergencyMsg, 'DB');
    }

    // 5. AI API 호출 (확장 파라미터 전달)
    const aiResult = await this.medicalAi.triage(text, patientInfo);
    if (aiResult?.recommendations?.length > 0) {
      this.logger.log(`Triage AI fallback: ${aiResult.recommendations.length} results`);
      recommendations = aiResult.recommendations.map((r: { department: string; confidence?: number; reason?: string }, i: number) => ({
        department: r.department,
        priority: i + 1,
        confidence: r.confidence ?? 70,
        reason: r.reason ?? '',
      }));
      // 🔴 AI 가 emergency=true 라고 하면 올린다. false 라고 해도 내리지 않는다
      //    (AI 의 '아님'은 우리가 확인한 '아님'이 아니다 — UNDETERMINED 는 그대로 둔다).
      if (aiResult.emergency) {
        assessment = 'EMERGENCY';
        emergencyMsg = aiResult.emergency_message ?? emergencyMsg;
      }
      return this.finalize(extracted.symptoms, recommendations, assessment, emergencyMsg, 'AI');
    }

    // 6. 최종 fallback — 🔴 원 결함: 여기서 "내과 · 기본 추천 50%" 를 만들어 냈다.
    //    실운영 공개 예약 16건 중 6건이 이 가짜 추천이었다(T2).
    //    표본 부재의 정답은 폴백이 아니라 **빈 목록**이다. 증상도 원문을 증상인 척 담지 않는다.
    return this.finalize(extracted.symptoms, [], 'UNDETERMINED', null, 'FALLBACK');
  }

  private finalize(
    symptoms: string[],
    recommendations: TriageResult['recommendations'],
    assessment: EmergencyAssessment,
    emergencyMsg: string | null,
    source: TriageResult['source'],
  ): TriageResult {
    return {
      symptoms,
      recommendations,
      emergencyAssessment: assessment,
      emergencyMsg,
      patientEmergencyAction:
        assessment === 'EMERGENCY' ? PATIENT_EMERGENCY_ACTION
          : assessment === 'UNDETERMINED' ? PATIENT_EMERGENCY_UNDETERMINED
            : null,
      source,
    };
  }

  /**
   * 텍스트에서 별칭/증상명으로 증상 추출.
   * 🔴 원 결함 T1 — `text.includes(alias)` 였다. 조사 한 글자에 매칭이 통째로 빗나갔다.
   *    이제 `symptom-match.ts` 의 정규화 매칭 하나만 쓴다(agent-session 도 같은 함수).
   */
  async extractSymptoms(text: string): Promise<ExtractedSymptoms> {
    const hay = normalizeSymptomText(text);

    const [aliases, symptoms] = await Promise.all([
      this.prisma.triageAlias.findMany({
        where: { isActive: true },
        include: { symptom: { select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.triageSymptom.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);

    const matched = new Map<string, string>(); // symptomName → symptomId
    const matchedTerms: string[] = [];
    const matchedSpans: { start: number; end: number }[] = [];

    for (const a of aliases) {
      if (!a.symptom.isActive) continue;
      const span = matchPhraseIn(hay, a.alias);
      if (!span) continue;
      matched.set(a.symptom.name, a.symptom.id);
      matchedTerms.push(a.alias);
      matchedSpans.push(span);
      // hit count 비동기 증분 — 별칭 히트는 '실제로 맞은 횟수'라 그대로 둔다
      this.prisma.triageAlias.update({ where: { id: a.id }, data: { hitCount: { increment: 1 } } }).catch(() => {});
    }

    // 증상 이름 직접 매칭
    for (const s of symptoms) {
      const span = matchPhraseIn(hay, s.name);
      if (!span) continue;
      matchedTerms.push(s.name);
      matchedSpans.push(span);
      if (!matched.has(s.name)) matched.set(s.name, s.id);
    }

    return {
      symptoms: Array.from(matched.keys()),
      symptomIds: Array.from(matched.values()),
      matchedTerms,
      matchedSpans,
      normalizedText: hay,
    };
  }

  /** DB 규칙 기반 추천 — 점수 병합 */
  private async getDbRecommendations(symptomIds: string[]) {
    const rules = await this.prisma.triageRule.findMany({
      where: { symptomId: { in: symptomIds }, isActive: true },
      include: { symptom: { select: { name: true } } },
      orderBy: { priority: 'asc' },
    });

    // 진료과별 점수 합산
    // 🔴 priority 는 '표시 순위'가 아니라 **가중치**다(1순위 x3·2순위 x2·3순위 x1).
    //    최종 노출 순서는 confidence × 가중치 합산 결과라 DB priority 와 다를 수 있다(T9).
    const deptScore = new Map<string, { score: number; reasons: string[]; maxConf: number; ruleIds: string[] }>();
    for (const r of rules) {
      const existing = deptScore.get(r.departmentName) ?? { score: 0, reasons: [], maxConf: 0, ruleIds: [] };
      existing.score += r.confidence * (4 - Math.min(r.priority, 3));
      if (r.reason) existing.reasons.push(r.reason);
      existing.maxConf = Math.max(existing.maxConf, r.confidence);
      existing.ruleIds.push(r.id);
      deptScore.set(r.departmentName, existing);
    }

    const top = Array.from(deptScore.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 3);

    // 🔴 원 결함 T10 — 히트 수가 '추천된 횟수'가 아니라 '조회된 횟수'였다(top-3 밖 규칙도 증가).
    //    통계 화면이 "매핑 히트 수"라고 부르는 값이므로 **실제로 추천에 쓰인 규칙만** 센다.
    for (const [, data] of top) {
      for (const id of data.ruleIds) {
        this.prisma.triageRule.update({ where: { id }, data: { hitCount: { increment: 1 } } }).catch(() => {});
      }
    }

    return top.map(([dept, data], i) => ({
      department: dept,
      priority: i + 1,
      confidence: data.maxConf,
      reason: data.reasons.join(', ') || '',
    }));
  }

  /**
   * 자가 점검 — 시스템이 **자신이 환자에게 제시하는 예시 문장**을 현행 DB 규칙에 돌려본다.
   * 🔴 T1/T2 가 오래 살아남은 이유는 실패가 어디에도 보이지 않았기 때문이다.
   *    관리 화면(통계 탭)이 이 결과를 그대로 보여준다.
   */
  async selfCheck() {
    const [aliases, symptoms, rules] = await Promise.all([
      this.prisma.triageAlias.findMany({
        where: { isActive: true },
        include: { symptom: { select: { id: true, name: true, isActive: true, isEmergency: true } } },
      }),
      this.prisma.triageSymptom.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isEmergency: true },
      }),
      this.prisma.triageRule.findMany({ where: { isActive: true }, select: { symptomId: true } }),
    ]);
    const withRules = new Set(rules.map(r => r.symptomId));

    const results = TRIAGE_EXAMPLE_PHRASES.map(p => {
      const hay = normalizeSymptomText(p.value);
      const hit = new Map<string, { name: string; isEmergency: boolean; hasRule: boolean }>();
      for (const a of aliases) {
        if (!a.symptom.isActive) continue;
        if (matchPhraseIn(hay, a.alias)) {
          hit.set(a.symptom.id, { name: a.symptom.name, isEmergency: a.symptom.isEmergency, hasRule: withRules.has(a.symptom.id) });
        }
      }
      for (const s of symptoms) {
        if (matchPhraseIn(hay, s.name)) {
          hit.set(s.id, { name: s.name, isEmergency: s.isEmergency, hasRule: withRules.has(s.id) });
        }
      }
      const matchedSymptoms = Array.from(hit.values());
      const recommendable = matchedSymptoms.some(m => m.hasRule);
      return {
        label: p.label,
        phrase: p.value,
        expectSymptom: p.expectSymptom,
        matchedSymptoms: matchedSymptoms.map(m => m.name),
        emergency: matchedSymptoms.some(m => m.isEmergency),
        /** 규칙이 있어 실제 진료과 추천까지 이어지는가 */
        recommendable,
        /** 증상이 있어야 할 문장인데 추천으로 이어지지 않음 = 데이터 갭 */
        gap: p.expectSymptom && !recommendable,
      };
    });

    return {
      checkedAt: new Date().toISOString(),
      total: results.length,
      expected: results.filter(r => r.expectSymptom).length,
      recommendable: results.filter(r => r.expectSymptom && r.recommendable).length,
      gaps: results.filter(r => r.gap).length,
      results,
    };
  }

  /**
   * 응급 표시 증상 중 **환자용 행동 지시가 없는** 것들.
   * 🔴 T6 — DB 문구는 감별진단 임상 메모라 환자에게 그대로 나가면 안 된다.
   *    DB 값을 임의로 고치지 않는 대신, 화면이 "이 문구는 환자에게 안 나간다"고 말하게 한다.
   */
  async emergencyMsgAudit() {
    const emergencySymptoms = await this.prisma.triageSymptom.findMany({
      where: { isEmergency: true, isActive: true },
      select: { id: true, name: true, emergencyMsg: true },
      orderBy: { name: 'asc' },
    });
    return emergencySymptoms.map(s => ({
      id: s.id,
      name: s.name,
      emergencyMsg: s.emergencyMsg,
      patientActionable: isPatientActionableEmergencyMsg(s.emergencyMsg),
    }));
  }

  // ── CRUD: 증상 ──

  // 🔴 원 결함 T7 — 서비스가 `{ data: … }` 로 감싸고 컨트롤러가 다시 `{ data: … }` 로 감쌌다(이중 래핑).
  //    FE 통계 탭은 한 겹만 벗겨 **모든 수치가 0** 으로 보였고, 그래서 T1/T2 실패가 화면에서 사라졌다.
  //    아래 CRUD 는 전부 **가공하지 않은 값**을 반환한다. `{ data }` 포장은 컨트롤러가 한 번만 한다.
  async getSymptoms(category?: string) {
    const where: Prisma.TriageSymptomWhereInput = {};
    if (category) where.category = category;
    return this.prisma.triageSymptom.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { rules: { where: { isActive: true }, orderBy: { priority: 'asc' } }, aliases: { where: { isActive: true } } } });
  }

  async createSymptom(dto: { name: string; category?: string; description?: string; isEmergency?: boolean; emergencyMsg?: string }) {
    try {
      return await this.prisma.triageSymptom.create({ data: dto });
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException(`증상 '${dto.name}'이 이미 존재합니다.`);
      throw e;
    }
  }

  async updateSymptom(id: string, dto: Prisma.TriageSymptomUpdateInput) {
    return this.prisma.triageSymptom.update({ where: { id }, data: dto });
  }

  async deleteSymptom(id: string) {
    return this.prisma.triageSymptom.update({ where: { id }, data: { isActive: false } });
  }

  // ── CRUD: 규칙 ──

  async getRules(symptomId?: string, department?: string) {
    const where: Prisma.TriageRuleWhereInput = { isActive: true };
    if (symptomId) where.symptomId = symptomId;
    if (department) where.departmentName = department;
    return this.prisma.triageRule.findMany({ where, include: { symptom: { select: { name: true, category: true } } }, orderBy: [{ hitCount: 'desc' }] });
  }

  async createRule(dto: { symptomId: string; departmentName: string; priority?: number; confidence?: number; reason?: string; condition?: string; createdBy: string }) {
    try {
      return await this.prisma.triageRule.create({ data: dto });
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException('이미 동일한 증상-진료과 매핑이 존재합니다.');
      throw e;
    }
  }

  async updateRule(id: string, dto: Prisma.TriageRuleUpdateInput) {
    return this.prisma.triageRule.update({ where: { id }, data: dto });
  }

  async deleteRule(id: string) {
    return this.prisma.triageRule.update({ where: { id }, data: { isActive: false } });
  }

  async getRuleStats() {
    const top = await this.prisma.triageRule.findMany({
      where: { isActive: true },
      include: { symptom: { select: { name: true } } },
      orderBy: { hitCount: 'desc' },
      take: 20,
    });
    const total = await this.prisma.triageRule.count({ where: { isActive: true } });
    const symptomCount = await this.prisma.triageSymptom.count({ where: { isActive: true } });
    const aliasCount = await this.prisma.triageAlias.count({ where: { isActive: true } });
    return { topRules: top, totalRules: total, totalSymptoms: symptomCount, totalAliases: aliasCount };
  }

  // ── CRUD: 별칭 ──

  async getAliases(symptomId?: string) {
    const where: Prisma.TriageAliasWhereInput = { isActive: true };
    if (symptomId) where.symptomId = symptomId;
    return this.prisma.triageAlias.findMany({ where, include: { symptom: { select: { name: true } } }, orderBy: { hitCount: 'desc' } });
  }

  async createAlias(dto: { symptomId: string; alias: string }) {
    try {
      return await this.prisma.triageAlias.create({ data: dto });
    } catch (e: unknown) {
      if (e instanceof Object && 'code' in e && e.code === 'P2002') throw new ConflictException(`별칭 '${dto.alias}'이 이미 존재합니다.`);
      throw e;
    }
  }

  async createAliasesBulk(items: { symptomId: string; alias: string }[]) {
    let created = 0;
    for (const item of items) {
      try {
        await this.prisma.triageAlias.create({ data: { symptomId: item.symptomId, alias: item.alias } }); // (B5) 원소 전체 대신 두 필드만
        created++;
      } catch { /* skip duplicates */ }
    }
    return { created, total: items.length };
  }

  async deleteAlias(id: string) {
    await this.prisma.triageAlias.delete({ where: { id } }).catch(() => { throw new NotFoundException('별칭을 찾을 수 없습니다.'); });
    return { deleted: true };
  }

  // ── 하드코딩 → DB 마이그레이션 (제거됨) ──
  // 🔴 원 결함 T5/T8 — 같은 흉통에 답이 셋이었다:
  //    ① agent-session 하드코딩 맵(내과 1순위·응급 표시 없음)
  //    ② DB 규칙(순환기내과 270 > 응급의학과 255)
  //    ③ 여기 있던 migrate 맵(응급의학과 1순위+119)
  //    이 EP 의 버튼은 ③ 을 현행 ② 위에 덧씌워 임상적으로 다듬어진 규칙을 오염시켰다.
  //    (실 DB 는 29증상·72규칙·169별칭의 정식 시드다 — migrate 맵은 그보다 거친 옛 사본이었다.)
  //    정본은 DB 하나이므로 맵과 EP 를 함께 제거한다. 증상/규칙 추가는 관리 화면(증상 관리 탭)에서 한다.
}
