import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  SENTINEL_JUDGMENT_VERDICTS,
  SENTINEL_JUDGMENT_LABEL,
  SENTINEL_JUDGMENT_EFFECT,
  type SentinelJudgmentVerdict,
} from '@hospital-run/shared';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../modules/medical-ai/medical-ai.service';

/**
 * 감시자 판정 **AI 보조** — 관계 모드는 초안/보조다(clinical-ux-agent-era §에이전트).
 *
 * 🔴 AI 는 판정하지 않는다 — **판정 초안과 확인 방법**을 낼 뿐이고, 확정(판정 기록)은
 *    사람이 폼에서 직접 한다. AI 제안이 폼을 채우지 않는다(초기값 미선택 유지).
 * 🔴 출처는 두 상태뿐: AI | UNAVAILABLE. **FALLBACK 이 없다** — AI 가 닿지 않거나 결과를
 *    이해하지 못하면 그 사실을 말하고 끝낸다(지어낸 판정 초안이 제일 위험하다).
 * 🔴 보내는 것은 발견 메타(검사 키·라벨·건수·추이·관측 시각)뿐 — 환자 데이터가 없다.
 */

export type AdvisorResult =
  | {
      source: 'AI';
      verdictSuggestion: SentinelJudgmentVerdict;
      verdictLabel: string;
      rationale: string;
      /** 🔴 믿으라고 하지 않는다 — 제안마다 사람이 직접 확인할 경로를 함께 낸다 */
      verifySteps: string[];
      generatedAt: string;
    }
  | { source: 'UNAVAILABLE'; reason: string };

const unavailable = (reason: string): AdvisorResult => ({ source: 'UNAVAILABLE', reason });

/** 모델 응답에서 JSON 본문만 — 코드펜스·앞뒤 잡담을 걷어낸다(내용은 손대지 않는다) */
export function extractJsonBlock(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return fenced.slice(start, end + 1);
}

@Injectable()
export class SentinelAdvisorService {
  private readonly logger = new Logger(SentinelAdvisorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ai?: MedicalAiService,
  ) {}

  async analyze(axis: string, checkKey: string): Promise<AdvisorResult> {
    const finding = await this.prisma.sentinelFinding.findUnique({
      where: { axis_checkKey: { axis, checkKey } },
    });
    if (!finding) throw new NotFoundException('해당 발견 항목이 없습니다');
    if (!this.ai) return unavailable('AI 보조 서비스가 배선되지 않았습니다(운영자 확인 필요).');

    const verdictGuide = SENTINEL_JUDGMENT_VERDICTS
      .map((v) => `- ${v}: ${SENTINEL_JUDGMENT_LABEL[v]} — ${SENTINEL_JUDGMENT_EFFECT[v]}`)
      .join('\n');

    const system = [
      '당신은 병원 정보 시스템(HIS)의 데이터 감시 결과를 검토하는 운영 보조자다. 한국어로만 답한다.',
      '반드시 아래 사실만 근거로 삼고, 모르는 것은 모른다고 말한다. 원인을 지어내지 않는다.',
      '이 시스템의 운영 DB 는 실환자가 아니라 가상 병원 시드 데이터이며, 개발용 날짜 롤포워드(dev.demoDateRoll)가 기록 시각을 주기적으로 다시 쓴다 — 시각 관련 이상은 이 아티팩트일 수 있다.',
      '너의 산출은 초안이다. 확정 판정은 사람이 한다.',
      '',
      '가능한 판정 어휘(이 넷 중 하나만, 확신이 없으면 UNDETERMINED):',
      verdictGuide,
      '',
      'JSON 하나만 출력한다(다른 텍스트 금지):',
      '{"verdictSuggestion":"<위 어휘 중 하나>","rationale":"<두세 문장 — 왜 그렇게 보는가, 무엇이 불확실한가>","verifySteps":["<사람이 직접 확인할 방법 1>","<방법 2>"]}',
    ].join('\n');

    const user = [
      '다음 감시 발견 항목에 대한 판정 초안과, 사람이 직접 확인할 방법을 제시하라.',
      `- 축: ${finding.axis}`,
      `- 검사 키: ${finding.checkKey}`,
      `- 내용: ${finding.label}`,
      `- 심각도: ${finding.severity}`,
      // 🔴 관측 불가면 값을 사실처럼 보내지 않는다
      finding.unobservable
        ? '- 건수: 관측 불가(프로브 실패 — 값을 믿을 수 없음)'
        : `- 현재 건수: ${finding.value} (직전 스윕: ${finding.prevValue ?? '기록 없음(처음 본 항목)'})`,
      `- 최초 관측: ${finding.firstSeenAt.toISOString()}`,
      `- 마지막 관측: ${finding.lastSeenAt.toISOString()}`,
      finding.detail ? `- 상세: ${finding.detail}` : '- 상세: 기록 없음',
      finding.drillDown ? `- 연결된 관리 화면: ${finding.drillDown}` : '- 연결된 관리 화면: 없음',
    ].join('\n');

    let raw: string;
    try {
      raw = await this.ai.sentinelAdvise(system, user);
    } catch (e) {
      this.logger.warn(`감시자 AI 보조 실패 ${axis}:${checkKey}: ${e instanceof Error ? e.message : e}`);
      return unavailable('AI 서버에 닿지 못했습니다 — 잠시 후 다시 시도하세요.');
    }
    // chatLlm 은 실패를 '' 로 접는다 — 그 번역을 여기서 되돌린다(빈 답을 초안으로 만들지 않는다)
    if (!raw || !raw.trim()) return unavailable('AI 서버가 응답하지 않았습니다 — 잠시 후 다시 시도하세요.');

    const jsonText = extractJsonBlock(raw);
    if (!jsonText) return unavailable('AI 응답을 이해하지 못했습니다 — 직접 판정하세요.');
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonText) as Record<string, unknown>; } catch {
      return unavailable('AI 응답을 이해하지 못했습니다 — 직접 판정하세요.');
    }

    // 🔴 지어낸 판정 어휘를 접어주지 않는다 — 정본 밖이면 초안 자체를 내지 않는다
    const verdict = parsed.verdictSuggestion;
    if (typeof verdict !== 'string' || !(SENTINEL_JUDGMENT_VERDICTS as readonly string[]).includes(verdict)) {
      return unavailable('AI 가 정본에 없는 판정 어휘를 냈습니다 — 직접 판정하세요.');
    }
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim().slice(0, 1000) : '';
    if (!rationale) return unavailable('AI 가 근거를 내지 못했습니다 — 직접 판정하세요.');
    const verifySteps = Array.isArray(parsed.verifySteps)
      ? parsed.verifySteps.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, 300)).slice(0, 5)
      : [];

    return {
      source: 'AI',
      verdictSuggestion: verdict as SentinelJudgmentVerdict,
      verdictLabel: SENTINEL_JUDGMENT_LABEL[verdict as SentinelJudgmentVerdict],
      rationale,
      verifySteps,
      generatedAt: new Date().toISOString(),
    };
  }
}
