import path from 'node:path';

import {
  EGRESS_ROUTES,
  EGRESS_TRANSPORT_WRAPPERS,
  egressCrossBorderRiskOf,
  egressSummary,
} from '@hospital-run/shared';

import { countByFile, scanRepo, scanSource } from './egress-scan';

/**
 * 🔴 외부 전송 경로 동결 가드(T10-4 데이터 소재지 — 결정 전 "무엇이 밖으로 나가는지" 목록화·동결).
 *
 * 규칙: 스캐너(`egress-scan.ts` — 정본 함수 하나)가 센 **파일별 호출 지점 수** 가
 *       shared `EGRESS_ROUTES` codeRefs 합 + `EGRESS_TRANSPORT_WRAPPERS` 와 **정확히 같아야** 한다.
 *   - 등재 안 된 파일에 호출이 생김 → 실패(새 목적지)
 *   - 등재 파일에 호출이 늘어남 → 실패(같은 파일의 새 경로를 흡수하지 않는다 — 여유 없음)
 *   - 등재 파일에서 호출이 줄거나 파일이 사라짐 → 실패(죽은 항목)
 * 🔴 이 가드는 전송을 막지 않는다 — 국외 이전 허용/금지는 국가 프로파일 결정 뒤. 여기선 보이기와 동결만.
 */
const ROOT = path.resolve(__dirname, '../../../..');

function expectedByFile(): Map<string, number> {
  const m = new Map<string, number>();
  for (const ref of [...EGRESS_TRANSPORT_WRAPPERS, ...EGRESS_ROUTES.flatMap((r) => r.codeRefs)]) {
    m.set(ref.file, (m.get(ref.file) ?? 0) + ref.calls);
  }
  return m;
}

describe('외부 전송 경로 동결 가드 (egress inventory)', () => {
  const sites = scanRepo(ROOT);
  const actual = countByFile(sites);
  const expected = expectedByFile();

  it('하한 — 스캐너가 실제로 호출 지점을 찾는다(대상 0 으로 통과하지 않는다)', () => {
    expect(sites.length).toBeGreaterThan(50);
    expect(actual.size).toBeGreaterThan(25);
  });

  it('등재 안 된 파일의 외부 호출 0 (새 목적지는 레지스트리에 먼저 올린다)', () => {
    const unregistered = [...actual.entries()]
      .filter(([f]) => !expected.has(f))
      .map(([f, n]) => `${f} ×${n} @ ${sites.filter((s) => s.file === f).map((s) => `${s.line}:${s.kind}`).join(',')}`);
    expect(unregistered).toEqual([]);
  });

  it('등재 파일의 호출 수가 레지스트리와 정확히 같다 (늘면 새 경로 · 줄면 죽은 항목)', () => {
    const mismatch = [...expected.entries()]
      .filter(([f, n]) => (actual.get(f) ?? 0) !== n)
      .map(([f, n]) => `${f}: 레지스트리 ${n} · 코드 ${actual.get(f) ?? 0}`);
    expect(mismatch).toEqual([]);
  });

  it('레지스트리 형식 — id 유일 · 목적지 접두사 · codeRefs 비어 있지 않음', () => {
    const ids = EGRESS_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of EGRESS_ROUTES) {
      expect(r.destination).toMatch(/^(env|config|db|host):\S+$/);
      expect(r.network === 'FIXED_EXTERNAL').toBe(r.destination.startsWith('host:'));
      expect(r.codeRefs.length).toBeGreaterThan(0);
      for (const c of r.codeRefs) expect(c.calls).toBeGreaterThan(0);
    }
  });

  it('불명을 비PHI 로 접지 않는다 — UNKNOWN 은 위험 "unknown"·요약에서 따로 센다', () => {
    expect(egressCrossBorderRiskOf({ network: 'FIXED_EXTERNAL', dataClass: 'UNKNOWN' })).toBe('unknown');
    expect(egressCrossBorderRiskOf({ network: 'CONFIGURED', dataClass: 'UNKNOWN' })).toBe('unknown');
    expect(egressCrossBorderRiskOf({ network: 'CONFIGURED', dataClass: 'PHI' })).toBe('review');
    expect(egressCrossBorderRiskOf({ network: 'CONFIGURED', dataClass: 'PSEUDONYMOUS' })).toBe('review');
    const s = egressSummary();
    expect(s.total).toBe(EGRESS_ROUTES.length);
    expect(s.review + s.unknown + s.none + s.internal).toBe(s.total);
    expect(s.unknown).toBe(EGRESS_ROUTES.filter((r) => r.dataClass === 'UNKNOWN').length);
    expect(s.verdict).toBeNull(); // 국가 프로파일 결정 전 — 판정 없음
  });

  it('실측 고정 — 불명 경로 목록(재분류는 본문을 읽고 이 목록과 함께 고친다)', () => {
    const unknown = EGRESS_ROUTES.filter((r) => r.dataClass === 'UNKNOWN').map((r) => r.id).sort();
    expect(unknown).toEqual([
      'ai.voc',
      'clinic.notify',
      'email.smtpCrm',
      'erp.eapprovalCallback',
      'integration.outbox',
      'push.fcm',
    ]);
  });

  it('실측 고정 — 원외 고정 호스트로 나가는 PHI/불명 경로(검토 대상의 핵심)', () => {
    const fixed = EGRESS_ROUTES.filter((r) => r.network === 'FIXED_EXTERNAL' && r.crossBorderRisk !== 'none')
      .map((r) => `${r.id}:${r.dataClass}`)
      .sort();
    expect(fixed).toEqual(['email.resend:PHI', 'push.fcm:UNKNOWN']);
  });

  describe('대조군 — 스캐너 규칙', () => {
    it('외부 URL·설정 URL 호출은 센다', () => {
      expect(scanSource(`await fetch('https://api.example.com/x');`, 'x.ts')).toHaveLength(1);
      expect(scanSource(`await fetch(url, { method: 'POST' });`, 'x.ts')).toHaveLength(1);
      expect(scanSource(`await this.httpService.post(u, b);`, 'x.ts')).toHaveLength(1);
      expect(scanSource(`await axios.get(u);`, 'x.ts')).toHaveLength(1);
      expect(scanSource(`await globalThis.fetch(u);`, 'x.ts')).toHaveLength(1);
    });
    it('사설망·루프백 리터럴은 세지 않는다', () => {
      expect(scanSource(`await fetch('http://localhost:3505/render');`, 'x.ts')).toHaveLength(0);
      expect(scanSource(`await fetch("http://127.0.0.1:8000/api");`, 'x.ts')).toHaveLength(0);
      expect(scanSource('await fetch(`http://10.0.0.5/x`);', 'x.ts')).toHaveLength(0);
      expect(scanSource(`await fetch('http://192.168.1.2/x');`, 'x.ts')).toHaveLength(0);
      // 사설망처럼 보이는 공인 대역은 센다
      expect(scanSource(`await fetch('http://172.32.0.1/x');`, 'x.ts')).toHaveLength(1);
    });
    it('주석·문자열·정의·메서드 이름은 세지 않는다', () => {
      expect(scanSource(`// await fetch('https://a.b')\n/* fetch(x) */`, 'x.ts')).toHaveLength(0);
      expect(scanSource(`logger.warn('fetch(failed)');`, 'x.ts')).toHaveLength(0);
      expect(scanSource(`export async function safeFetch(url: string) {}`, 'x.ts')).toHaveLength(0);
      expect(scanSource(`await this.repo.fetch(id); await prefetch(x);`, 'x.ts')).toHaveLength(0);
    });
  });
});
