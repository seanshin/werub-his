/**
 * DUR 룰 영향 미리보기(2026-10-21 임상 규칙·템플릿 P4 B2) — 룰을 바꾸기 전에 지난 기간 처방에 대해 몇 건이 걸렸을지.
 *
 * 🔴 판정 매칭은 실제 판정(`DurService.checkInteractions`)과 같은 함수·같은 조건을 쓴다(성분 매칭 `hayMatchesTerm` · Beers 는 키워드 포함 ·
 *    병용은 같은 진료의 다른 처방 · 용량은 같은 용법 파싱). 다른 규칙으로 세면 미리보기가 거짓말이 된다.
 *  · 소아 체중 기반은 처방 시점 체중을 원장에서 다시 잡지 않는다 — 미리보기 불가(이유를 말한다 · 0 아님)
 *  · 미리보기일 뿐 저장하지 않는다 · 상한을 넘으면 잘랐다고 말한다
 */
import { hayMatchesTerm } from './ingredient-terms';

export interface PreviewRule {
  ruleType: string; drugA?: string | null; drugB?: string | null; keywords?: string[] | null;
  minAge?: number | null; maxAge?: number | null; maxDailyDose?: number | null; unit?: string | null;
}
export interface PreviewRx { id: string; encounterId: string; patientId: string; age: number | null; hay: string; dosage: string | null; frequency: string | null }
export interface PreviewResult {
  supported: boolean;
  reason?: 'WEIGHT_NOT_IN_HISTORY' | 'INCOMPLETE_RULE';
  /** 경고가 붙었을 처방 수(병용은 같은 진료의 처방 쌍 중 새 처방 쪽) */
  matchedRx: number;
  matchedPatients: number;
  /** 성분 상한 — 초과(차단) / 용법을 못 읽어 "용량 확인"(경고) */
  doseExceeded?: number;
  doseUnreadable?: number;
}

export function previewDurRule(rule: PreviewRule, rxs: PreviewRx[]): PreviewResult {
  const out = (ids: PreviewRx[], extra: Partial<PreviewResult> = {}): PreviewResult =>
    ({ supported: true, matchedRx: ids.length, matchedPatients: new Set(ids.map((r) => r.patientId)).size, ...extra });
  switch (rule.ruleType) {
    case 'INTERACTION': {
      if (!rule.drugA || !rule.drugB) return { supported: false, reason: 'INCOMPLETE_RULE', matchedRx: 0, matchedPatients: 0 };
      const byEnc = new Map<string, PreviewRx[]>();
      for (const r of rxs) byEnc.set(r.encounterId, [...(byEnc.get(r.encounterId) ?? []), r]);
      const hit: PreviewRx[] = [];
      for (const r of rxs) {
        const others = (byEnc.get(r.encounterId) ?? []).filter((o) => o.id !== r.id).map((o) => o.hay);
        const a = hayMatchesTerm(r.hay, rule.drugA) && others.some((h) => hayMatchesTerm(h, rule.drugB!));
        const b = hayMatchesTerm(r.hay, rule.drugB) && others.some((h) => hayMatchesTerm(h, rule.drugA!));
        if (a || b) hit.push(r);
      }
      return out(hit);
    }
    case 'AGE': {
      if (!rule.drugA || (rule.minAge == null && rule.maxAge == null)) return { supported: false, reason: 'INCOMPLETE_RULE', matchedRx: 0, matchedPatients: 0 };
      return out(rxs.filter((r) => r.age !== null && hayMatchesTerm(r.hay, rule.drugA!)
        && ((rule.maxAge != null && r.age <= rule.maxAge) || (rule.minAge != null && r.age >= rule.minAge))));
    }
    case 'BEERS': {
      const kw = (rule.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
      if (!kw.length) return { supported: false, reason: 'INCOMPLETE_RULE', matchedRx: 0, matchedPatients: 0 };
      return out(rxs.filter((r) => r.age !== null && r.age >= 65 && kw.some((k) => r.hay.includes(k))));
    }
    case 'MAX_DOSE': {
      if (!rule.drugA || !(rule.maxDailyDose && rule.maxDailyDose > 0)) return { supported: false, reason: 'INCOMPLETE_RULE', matchedRx: 0, matchedPatients: 0 };
      const unitIsMg = (rule.unit ?? 'mg').toLowerCase() === 'mg';
      let exceeded = 0; let unreadable = 0;
      const hit: PreviewRx[] = [];
      for (const r of rxs) {
        if (!hayMatchesTerm(r.hay, rule.drugA)) continue;
        const dm = unitIsMg ? r.dosage?.match(/(\d+(?:\.\d+)?)\s*mg/i) : null;
        const fm = (r.frequency ?? '').match(/(\d+)\s*회/);
        const total = dm && fm && parseInt(fm[1], 10) > 0 ? parseFloat(dm[1]) * parseInt(fm[1], 10) : null;
        if (total == null) { unreadable += 1; hit.push(r); } else if (total > rule.maxDailyDose) { exceeded += 1; hit.push(r); }
      }
      return out(hit, { doseExceeded: exceeded, doseUnreadable: unreadable });
    }
    case 'PEDIATRIC_DOSE':
      return { supported: false, reason: 'WEIGHT_NOT_IN_HISTORY', matchedRx: 0, matchedPatients: 0 };
    default:
      return { supported: false, reason: 'INCOMPLETE_RULE', matchedRx: 0, matchedPatients: 0 };
  }
}
