/**
 * 🔴 AI 산출물은 승인 게이트 없이 정본에 쓰이지 않는다 — 초안≠확정(P0-B · 2026-09-09 신설).
 *
 * 정본: `docs/AI-AND-HIS.md` §2.2 R2 · `docs/01-plan/features/ai-judgment-governance.plan.md` §2.5 R2.
 *
 * 실측 배경(둘 다 "버튼 한 번 = 정본 기록"이었다):
 *  ① `mdt.service.ts` `autoSummary()` — LLM 응답을 그대로 `prisma.mdtCase.update({ clinicalSummary })`
 *     로 **즉시 저장**했다. `MdtCase` 엔 AI 프로비넌스 컬럼이 없어, 저장된 뒤엔 사람이 쓴 요약과
 *     구분할 방법도 없었다. 해석 못 한 응답은 `JSON.stringify(aiResult)` 로 임상요약에 들어갔다.
 *  ② `referral-letter.service.ts` `generateDraft()` — 초안 생성 단계에서
 *     `consultation.create({ reason: <LLM 초안>, status: 'REQUESTED' })` 로 **협진 정본**을 만들었다.
 *     의사가 초안을 읽어보기도 전에 타과 협진 목록에 의뢰가 접수돼 있었다.
 *
 * 이 가드가 지키는 것은 "AI 를 부르지 마라"가 아니라 **"AI 를 부른 함수가 정본을 쓰지 마라"** 다.
 * 그래서 대조군을 함께 잡는다 — 사람 경로(`updateCase`·`ensureConsultation`)에는 그 쓰기가 **있어야 한다**.
 * 조준을 좁히다 대상이 0 이 되면 이 가드는 아무것도 보증하지 않는다(그때는 대조군이 먼저 깨진다).
 *
 * 재주입(2026-09-09 실행): 아래 넷 중 무엇을 되살려도 이 스펙이 실패한다 —
 *   · autoSummary 안에 `mdtCase.update({ ..., clinicalSummary })` 복원
 *   · generateDraft 안에 `this.prisma.consultation.create(...)` 복원
 *   · ensureConsultation 의 협진 생성 삭제(대조군)
 *   · sign / signAndSend 의 `ensureConsultation(` 호출 삭제(승인 게이트 소실)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MDT = path.join(__dirname, '..', '..', 'src', 'modules', 'mdt', 'mdt.service.ts');
const REFERRAL = path.join(__dirname, '..', '..', 'src', 'modules', 'referral-letter', 'referral-letter.service.ts');

/**
 * 주석을 걷어낸다 — 🔴 이 저장소에서 **주석이 문자열 검사에 걸려** 가드가 다른 이유로
 * 통과/실패한 사례가 있었다(v4.11.0 에서 9건). 이 스펙의 판정 대상은 코드뿐이다.
 * (전체 줄 주석·블록 주석만 제거한다 — 줄 끝 주석은 남기되, 아래 검사식은 전부 `this.`/`prisma.`
 *  로 시작하는 호출 형태라 산문 주석과 겹치지 않는다.)
 */
function stripComments(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const t = raw.trim();
    if (inBlock) {
      out.push('');
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      out.push('');
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) { out.push(''); continue; }
    out.push(raw);
  }
  return out;
}

/** 클래스 메서드를 이름 → 본문으로 가른다(들여쓰기 2칸의 메서드 선언을 경계로) */
const METHOD_START = /^ {2}(?:(?:private|public|protected|readonly|static)\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;

function methodsOf(file: string): Map<string, string> {
  const lines = stripComments(fs.readFileSync(file, 'utf8'));
  const starts: Array<{ name: string; at: number }> = [];
  lines.forEach((l, i) => {
    const m = METHOD_START.exec(l);
    if (m) starts.push({ name: m[1], at: i });
  });
  const map = new Map<string, string>();
  starts.forEach((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].at : lines.length;
    map.set(s.name, lines.slice(s.at, end).join('\n'));
  });
  return map;
}

/** 이 문자열을 본문에 담은 메서드 이름들 */
function methodsContaining(map: Map<string, string>, needle: string | RegExp): string[] {
  const hit: string[] = [];
  for (const [name, body] of map) {
    if (typeof needle === 'string' ? body.includes(needle) : needle.test(body)) hit.push(name);
  }
  return hit;
}

describe('AI 산출물 → 정본 쓰기는 사람 승인 게이트를 지난다', () => {
  describe('MDT 임상요약 — LLM 호출과 clinicalSummary 쓰기가 같은 함수에 있지 않다', () => {
    const mdt = methodsOf(MDT);

    it('대조군: LLM 호출(medicalAi.reference)이 여전히 존재한다 (대상이 0 이 아니다)', () => {
      const callers = methodsContaining(mdt, 'this.medicalAi.reference(');
      expect(callers.length).toBeGreaterThan(0);
      // 옮겨 놓고 잊지 않도록 이름까지 고정한다 — 새 호출자가 생기면 여기서 먼저 걸린다
      expect(callers).toEqual(['autoSummary']);
    });

    it('대조군: 사람 경로(updateCase)에는 clinicalSummary 쓰기가 있다', () => {
      const updateCase = mdt.get('updateCase');
      expect(updateCase, 'updateCase 메서드를 찾지 못했다 — 파서가 헛돌고 있다').toBeTruthy();
      expect(updateCase!).toMatch(/updateData\.clinicalSummary\s*=/);
      expect(updateCase!).toContain('this.prisma.mdtCase.update(');
    });

    it('🔴 LLM 을 부른 함수 안에 mdtCase.update 가 없다 (AI 응답이 정본으로 직행하지 않는다)', () => {
      for (const name of methodsContaining(mdt, 'this.medicalAi.reference(')) {
        const body = mdt.get(name)!;
        expect(body, `${name}: LLM 호출과 같은 함수에서 mdtCase 를 갱신한다`).not.toContain('mdtCase.update(');
        expect(body, `${name}: LLM 호출과 같은 함수에서 clinicalSummary 를 쓴다`).not.toMatch(/clinicalSummary\s*:/);
      }
    });

    it('🔴 autoSummary 는 3상태로 말한다 (실패를 "없음"으로 번역하지 않는다)', () => {
      const body = mdt.get('autoSummary')!;
      expect(body).toContain("source: 'UNAVAILABLE'");
      expect(body).toContain("source: 'AI'");
      // 폴백 요약을 지어내지 않는다 — 여기엔 FALLBACK 이 없다
      expect(body).not.toContain("'FALLBACK'");
      // 해석 못 한 응답을 JSON 덩어리로 요약에 밀어넣던 자리
      expect(body).not.toContain('JSON.stringify(aiResult)');
    });
  });

  describe('의뢰서 — 협진 정본은 초안이 아니라 서명 단계에서 생긴다', () => {
    const ref = methodsOf(REFERRAL);

    it('🔴 초안 생성(generateDraft) 안에 consultation.create 가 없다', () => {
      const body = ref.get('generateDraft');
      expect(body, 'generateDraft 메서드를 찾지 못했다 — 파서가 헛돌고 있다').toBeTruthy();
      expect(body!).not.toMatch(/consultation\.create\(/);
    });

    it('대조군: 협진 생성은 서명 경로(ensureConsultation)에 살아 있다', () => {
      const creators = methodsContaining(ref, /consultation\.create\(/);
      expect(creators).toEqual(['ensureConsultation']);
      // 정본 서비스를 재사용한다 — prisma 직접 생성으로 되돌아가면(수신자 알림 없음) 여기서 걸린다
      expect(ref.get('ensureConsultation')!).toContain('this.consultation.create(');
      expect(ref.get('ensureConsultation')!).not.toContain('this.prisma.consultation.create(');
    });

    it('🔴 승인 게이트: sign·signAndSend 가 협진 생성 경로를 부른다', () => {
      for (const name of ['sign', 'signAndSend']) {
        const body = ref.get(name);
        expect(body, `${name} 메서드를 찾지 못했다`).toBeTruthy();
        expect(body!, `${name}: 서명해도 협진이 생기지 않는다`).toContain('this.ensureConsultation(');
      }
    });
  });
});
