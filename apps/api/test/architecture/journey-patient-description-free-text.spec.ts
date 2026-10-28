/**
 * 🔴 (2026-09-14) 환자 노출 여정 유형의 설명(description)에 직원 자유 입력이 들어갔다 — 처방·오더 여정에 오더 메모(`payload.notes`),
 *    응급 도착·트리아지·처분에 주호소·메모·수정 사유, 영상 판독에 판독 소견, 퇴원에 요약, 입원 취소·PACU 강제 퇴실·예약에 사유.
 *    포털 타임라인(`getJourneyTimeline`)·오늘 여정(`journey/status`)이 이를 환자에게 그대로 돌려줬다.
 * 지키는 것:
 *  ① 환자 노출 유형 발행 지점의 description 식에 자유 입력 필드 참조 0
 *  ② 포털 타임라인은 원 description 을 그대로 싣지 않는다 — 설명 안전 유형만 통과(과거 행은 소급 수정하지 않으므로 응답에서 거른다)
 *  ③ 포털 오늘 여정 응답도 같은 정본을 쓴다(노출 유형 필터 + 안전 설명)
 *  ④ 대조군 — 안전 유형(검사 결과 요약)은 설명이 보이고, 직원 화면 여정 조회(journey.service)는 원문을 유지한다
 *  ⑤ 스캐너 대조군 — 자유 입력 참조를 실제로 잡는다(0 이면 ① 은 빈 검사)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isPatientVisibleJourneyEvent, patientJourneyDescription } from '@hospital-run/shared';
import { PortalService } from '../../src/modules/portal/portal.service';

const API_SRC = path.resolve(__dirname, '../../src');
const FREE_TEXT = /\b(?:notes?|reason|revisionReason|overrideReason|memo|comment|remarks?|summary|impression|chiefComplaint|finding|opinion)\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function callBody(src: string, from: string | number): string {
  let depth = 1;
  let j = Number(from);
  while (depth > 0 && j < src.length) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') depth--;
    j++;
  }
  return src.slice(Number(from), j);
}

/** 발행 지점별 (유형 리터럴, description 식) — 주석을 걷은 소스에서 */
export function scanDescriptionSites(raw: string, rel: string): Array<{ where: string; types: string[]; desc: string }> {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  const out: Array<{ where: string; types: string[]; desc: string }> = [];
  const re = /(journey\w*\??\.emit\(|patientJourneyEvent\.create\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = callBody(src, m.index + m[0].length);
    const et = /eventType\s*:\s*([^,\n}]+)/.exec(body);
    const types = et ? [...et[1].matchAll(/(?<![=!]==\s*)'([A-Za-z][A-Za-z0-9_.]+)'/g)].map((x) => x[1]) : [];
    const d = /description\s*:\s*([^\n]+)/.exec(body);
    if (!d || !types.length) continue;
    out.push({ where: `${rel}:${src.slice(0, m.index).split('\n').length}`, types, desc: d[1] });
  }
  return out;
}

describe('환자 노출 여정 설명 — 직원 자유 입력을 싣지 않는다', () => {
  it('⑤ 대조군 — 스캐너가 자유 입력 참조를 잡는다', () => {
    const fixture = [
      "this.journey.emit({ patientId, eventType: 'ORDER_CREATED', title: 't', description: payload.notes?.slice(0, 200) });",
      "this.journey.emit({ patientId, eventType: 'LAB_RESULT', title: 't', description: `${n}개 항목` });",
      '// this.journey.emit({ patientId, eventType: \'DISCHARGE\', description: summary });',
    ].join('\n');
    const sites = scanDescriptionSites(fixture, 'x.ts');
    expect(sites).toHaveLength(2);
    expect(sites.filter((s) => FREE_TEXT.test(s.desc)).map((s) => s.types[0])).toEqual(['ORDER_CREATED']);
  });

  it('① 환자 노출 유형 발행 지점의 description 에 자유 입력 필드 참조가 없다', () => {
    const all = walk(API_SRC).flatMap((f) => scanDescriptionSites(fs.readFileSync(f, 'utf8'), path.relative(API_SRC, f)));
    expect(all.length, '스캔 하한 — 0 이면 스캐너가 죽은 것').toBeGreaterThan(20);
    const bad = all
      .filter((s) => !/^modules\/simulator\//.test(s.where) && !/^modules\/patient-auth\//.test(s.where))
      .filter((s) => s.types.some((t) => isPatientVisibleJourneyEvent(t)) && FREE_TEXT.test(s.desc))
      .map((s) => `${s.where} ${s.types.join('|')} ← ${s.desc.trim().slice(0, 80)}`);
    expect(bad, `환자 노출 유형 설명에 자유 입력:\n${bad.join('\n')}`).toEqual([]);
  });

  it('② 포털 타임라인 — 과거 행의 직원 메모 설명은 null, 안전 유형 설명은 유지(④ 대조군)', async () => {
    const rows = [
      { id: '1', eventType: 'PRESCRIPTION_ADDED', eventAt: new Date(), description: '신장기능 저하 — 용량 감량 검토(직원 메모)', severity: null, refType: 'Order' },
      { id: '2', eventType: 'IMAGING_RESULT', eventAt: new Date(), description: '우하엽 3cm 결절, 악성 배제 필요', severity: null, refType: 'ImagingResult' },
      { id: '3', eventType: 'LAB_RESULT', eventAt: new Date(), description: '5개 항목 · 정상', severity: null, refType: 'LabResult' },
    ];
    const svc = Object.create(PortalService.prototype) as PortalService;
    (svc as any).prisma = { patientJourneyEvent: { findMany: vi.fn().mockResolvedValue(rows) } };
    const out = (await svc.getJourneyTimeline('p1')) as Array<{ eventType: string; description: string | null }>;
    expect(out.find((e) => e.eventType === 'PRESCRIPTION_ADDED')!.description).toBeNull();
    expect(out.find((e) => e.eventType === 'IMAGING_RESULT')!.description).toBeNull();
    expect(out.find((e) => e.eventType === 'LAB_RESULT')!.description).toBe('5개 항목 · 정상');
  });

  it('patientJourneyDescription — 안전 유형 밖·어휘 밖은 null(fail-closed)', () => {
    expect(patientJourneyDescription('ORDER_CREATED', '메모')).toBeNull();
    expect(patientJourneyDescription('SOMETHING_NEW', '메모')).toBeNull();
    expect(patientJourneyDescription('CONSENT_SIGNED', '환자 동의서 서명 완료')).toBe('환자 동의서 서명 완료');
    expect(patientJourneyDescription('LAB_RESULT', '')).toBeNull();
  });

  it('③ 포털 오늘 여정 응답도 원 설명을 그대로 싣지 않는다(두 조립부 모두 정본 경유)', () => {
    const src = fs.readFileSync(path.join(API_SRC, 'modules/portal/portal.service.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/description:\s*e\.description\b/);
    expect((src.match(/patientJourneyDescription\(e\.eventType, e\.description\)/g) ?? []).length).toBe(3);
    expect((src.match(/journeyEvents\.filter\(\(e\) => isPatientVisibleJourneyEvent\(e\.eventType\)\)/g) ?? []).length).toBe(2);
  });

  it('④ 대조군 — 직원 화면 여정 조회(journey.service)는 원문을 유지한다', () => {
    const src = fs.readFileSync(path.join(API_SRC, 'modules/journey/journey.service.ts'), 'utf8');
    expect(src).not.toContain('patientJourneyDescription');
  });
});
