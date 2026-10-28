/**
 * 시계열 요약 — 순수 로직(규칙). AI 없이도 항상 산출되는 정본 요약이며, AI 요약은 이 위에 덧붙는다.
 *
 * 설계 원칙:
 *  - **추론하지 않는다**: 기록에 있는 값만 집계·인용한다(진단·처방 권고 금지).
 *  - 임상적으로 의미 있는 변화만 뽑는다(첫/마지막 평가·진단 추가·용량 변경·이상 검사 최근값).
 *  - 요약은 참고용이며 원본 확인을 대체하지 않는다(호출측이 면책 문구를 함께 노출).
 */

export type SummaryMode = 'all' | 'chart' | 'rx';

export interface SummaryItem {
  type: string;
  at: string | Date;
  title?: string | null;
  status?: string | null;
  author?: string | null;
  soap?: { S?: string | null; O?: string | null; A?: string | null; P?: string | null };
  diagnoses?: { code?: string | null; name?: string | null; type?: string | null }[];
  results?: { name: string; value: string; unit?: string; flag?: string | null }[];
  abnormalCount?: number;
  rxType?: string | null;
  code?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;
  impression?: string | null;
  /** 대화(스크라이브) 초안에서 출발한 진료인가 — `Encounter.aiScribed` */
  aiScribed?: boolean;
  /** 서명 시점에 잰 초안 대비 수정량(문자) — `Encounter.aiEditDistance` · null = 재지 못함(0 이 아니다) */
  aiEditDistance?: number | null;
}

export interface RuleSummary {
  /** 사람이 읽는 요약 줄(순서 유지) */
  lines: string[];
  /** AI 프롬프트에 넣을 압축 컨텍스트(원문 인용 최소화) */
  context: string;
  counts: Record<string, number>;
  period: { from: string | null; to: string | null };
}

const d10 = (v: string | Date) => {
  const t = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};
const ms = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v).getTime();

/** 규칙 요약 — 모드별 관점(전체 경과 / 진료 경과 / 약물 이력) */
export function buildRuleSummary(items: SummaryItem[], mode: SummaryMode): RuleSummary {
  const sorted = items.slice().filter((i) => !Number.isNaN(ms(i.at))).sort((a, b) => ms(a.at) - ms(b.at));
  const counts: Record<string, number> = {};
  for (const i of sorted) counts[i.type] = (counts[i.type] ?? 0) + 1;
  const period = { from: sorted.length ? d10(sorted[0].at) : null, to: sorted.length ? d10(sorted[sorted.length - 1].at) : null };
  const lines: string[] = [];
  const ctx: string[] = [];

  if (!sorted.length) return { lines: ['해당 기간 기록이 없습니다.'], context: '', counts, period };

  lines.push(`기간 ${period.from} ~ ${period.to} · 기록 ${sorted.length}건`);

  const encs = sorted.filter((i) => i.type === 'ENCOUNTER');
  const rxs = sorted.filter((i) => i.type === 'PRESCRIPTION');

  if (mode !== 'rx' && encs.length) {
    lines.push(`진료 ${encs.length}회(${d10(encs[0].at)} 최초 → ${d10(encs[encs.length - 1].at)} 최근)`);
    // 진단 등장 순서 — 언제 무엇이 추가됐나
    const seenDx = new Map<string, string>();
    for (const e of encs) for (const d of e.diagnoses ?? []) {
      const key = d.code || d.name || '';
      if (key && !seenDx.has(key)) seenDx.set(key, `${d.name ?? ''}${d.code ? `(${d.code})` : ''} ${d10(e.at)}`);
    }
    if (seenDx.size) lines.push(`진단 경과: ${[...seenDx.values()].join(' → ')}`);
    /**
     * 🔴 출처 — 대화에서 출발한 진료가 섞여 있으면 **분모와 함께** 말한다. 요약이 출처를 알되 원문은 들지 않는다.
     * 🔴 수정량은 서명 시점에 `Encounter.aiEditDistance` 로 잰다(2026-09-09~ · 분포는 AI 감독 `scribe-edits`).
     *    여기서는 **몇 회를 쟀는가**(분모와 함께)만 말한다 — 환자 요약에 개별 거리 숫자를 적으면
     *    "몇 자 고쳤다"가 검토 강도로 읽힌다. 재지 못한 회(null)는 계측 수에 넣지 않는다(0 은 잰 것이다).
     *    (종전 문구 "편집거리 미측정(재는 코드 없음)"은 서명 경로 계측이 이미 있던 때의 거짓이었다.)
     */
    const scribedEncs = encs.filter((e) => e.aiScribed);
    const scribed = scribedEncs.length;
    if (scribed) {
      const measured = scribedEncs.filter((e) => typeof e.aiEditDistance === 'number').length;
      lines.push(`대화 유래 초안에서 출발: ${scribed}/${encs.length}회 · 초안↔확정 수정량 서명 시 계측 ${measured}/${scribed}회`);
    }
    // 평가(A) 첫/마지막 — 조절 상태 변화의 핵심
    const withA = encs.filter((e) => (e.soap?.A ?? '').trim());
    if (withA.length) {
      lines.push(`평가 변화: "${withA[0].soap!.A!.trim()}" → "${withA[withA.length - 1].soap!.A!.trim()}"`);
      for (const e of withA) ctx.push(`${d10(e.at)} A: ${e.soap!.A!.trim()}${e.soap?.P ? ` / P: ${e.soap.P.trim()}` : ''}`);
    }
    const lastO = [...encs].reverse().find((e) => (e.soap?.O ?? '').trim());
    if (lastO) lines.push(`최근 객관 소견(${d10(lastO.at)}): ${lastO.soap!.O!.trim()}`);
  }

  if (mode !== 'chart' && rxs.length) {
    // 약품별 묶기 — 코드 우선, 용량 변화·최근 처방일
    const lanes = new Map<string, { name: string; first: string; last: string; doses: string[]; n: number }>();
    for (const r of rxs) {
      const name = (r.title ?? r.rxType ?? '처방').trim();
      const key = (r.code && r.code.trim()) || name;
      const cur = lanes.get(key);
      const dose = (r.dosage ?? '').trim();
      if (cur) {
        cur.last = d10(r.at); cur.n++;
        if (dose && !cur.doses.includes(dose)) cur.doses.push(dose);
      } else {
        lanes.set(key, { name, first: d10(r.at), last: d10(r.at), doses: dose ? [dose] : [], n: 1 });
      }
    }
    lines.push(`처방 ${rxs.length}건 · 약품/지시 ${lanes.size}종`);
    const changed = [...lanes.values()].filter((l) => l.doses.length > 1);
    if (changed.length) {
      lines.push(`용량 변경: ${changed.map((l) => `${l.name} ${l.doses.join('→')}`).join(', ')}`);
    }
    for (const l of lanes.values()) {
      ctx.push(`약 ${l.name}: ${l.first}~${l.last} ${l.n}회${l.doses.length ? ` 용량 ${l.doses.join('→')}` : ''}`);
    }
  }

  if (mode === 'all') {
    const labs = sorted.filter((i) => i.type === 'LAB');
    const abn = labs.filter((l) => (l.abnormalCount ?? 0) > 0);
    if (labs.length) {
      lines.push(`검사 ${labs.length}건(이상 포함 ${abn.length}건)`);
      const last = abn[abn.length - 1] ?? labs[labs.length - 1];
      const flagged = (last.results ?? []).filter((r) => r.flag && r.flag !== 'N');
      if (flagged.length) lines.push(`최근 이상 수치(${d10(last.at)}): ${flagged.map((r) => `${r.name} ${r.value}${r.unit ?? ''}`).join(', ')}`);
      for (const l of labs) {
        const f = (l.results ?? []).filter((r) => r.flag && r.flag !== 'N');
        if (f.length) ctx.push(`${d10(l.at)} 검사이상: ${f.map((r) => `${r.name} ${r.value}${r.unit ?? ''}`).join(', ')}`);
      }
    }
    const imgs = sorted.filter((i) => i.type === 'IMAGING');
    if (imgs.length) {
      const lastImg = imgs[imgs.length - 1];
      lines.push(`영상 ${imgs.length}건 · 최근 판독(${d10(lastImg.at)}): ${lastImg.impression ?? lastImg.title ?? '-'}`);
      for (const i of imgs) if (i.impression) ctx.push(`${d10(i.at)} 영상: ${i.impression}`);
    }
    const adm = sorted.filter((i) => i.type === 'ADMISSION');
    if (adm.length) lines.push(`입퇴원 기록 ${adm.length}건`);
    const surg = sorted.filter((i) => i.type === 'SURGERY');
    if (surg.length) lines.push(`수술 ${surg.length}건: ${surg.map((s) => `${s.title ?? ''}(${d10(s.at)})`).join(', ')}`);
  }

  return { lines, context: ctx.join('\n'), counts, period };
}

/** AI 프롬프트 — 모드별 관점을 명시하고 **추가 진단·처방 권고를 금지**한다 */
export function buildSummaryPrompt(mode: SummaryMode, rule: RuleSummary): string {
  const intent = mode === 'chart'
    ? '외래 진료 경과(조절 상태 변화·주요 사건·현재 상태·다음 방문 시 확인할 점)'
    : mode === 'rx'
      ? '약물 치료 이력(시작·증량/감량·전환 사유가 기록에 있으면 인용·현재 유지 중인 약)'
      : '환자 임상 경과 전반(진료·검사·영상·처방·입퇴원의 흐름)';
  return [
    `다음은 한 환자의 기록 요약 데이터입니다. ${intent}을 의료진이 3~6문장으로 빠르게 파악할 수 있게 한국어로 정리하세요.`,
    '규칙: ①기록에 없는 내용을 추정하지 마세요 ②새로운 진단이나 처방을 권고하지 마세요 ③날짜와 수치는 주어진 값을 그대로 인용하세요 ④불확실하면 "기록상 확인되지 않음"이라고 쓰세요.',
    '',
    '[집계]',
    ...rule.lines,
    '',
    '[상세 컨텍스트]',
    rule.context || '(없음)',
  ].join('\n');
}
