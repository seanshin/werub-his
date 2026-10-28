import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeFileAge, probeCronInactive, probeCronRegistered, probeUnconsumedEvents, probePublicSite,
} from '../../src/sentinel/pipe-sweep';
import { PIPE_CHECKS, EVENT_CONSUMED_ELSEWHERE, EVENT_BROADCAST_ONLY } from '../../src/sentinel/pipe-registry';
import { SentinelService } from '../../src/sentinel/sentinel.service';

const REPO_ROOT = join(process.cwd(), '..', '..');

/** 등록부가 선언한 패턴 그대로 — 여기 다시 적으면 정본이 둘이 된다 */
const BACKUP_PATTERN = new RegExp(PIPE_CHECKS.find((c) => c.key === 'pipe.backup')!.filePattern!);

/**
 * 축 D — 파이프 생존.
 *
 * 🔴 이 축의 항목은 전부 **실제로 겪은 사고**다. 실행 비트 하나가 정기 백업을 89일 막았고,
 *    공개 사이트는 76일 낡은 빌드를 서비스했다. 그동안 어느 화면도 그 사실을 말하지 않았다.
 * 🔴 그래서 이 축의 유일한 계약은 **관측 불가를 '정상'으로 접지 않는 것**이다.
 */
describe('백업 신선도 — 89일 사고를 재현하면 뜬다', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sentinel-')); });

  const put = (name: string, ageHours: number) => {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    const t = (Date.now() - ageHours * 3_600_000) / 1000;
    utimesSync(p, t, t);
  };

  it('하루 안에 백업이 있으면 위반 아님', () => {
    put('hospitalrun_20260902_030001.sql.gz.gpg', 6);
    const r = probeFileAge(dir, 26);
    expect(r.observable).toBe(true);
    expect(r.value).toBe(0);
  });

  it('🔴 89일 백업 공백을 재현하면 위반으로 뜬다', () => {
    put('hospitalrun_20260605_030001.sql.gz.gpg', 89 * 24);
    const r = probeFileAge(dir, 26);
    expect(r.observable).toBe(true);
    expect(r.value).toBe(1);
    expect(r.detail).toMatch(/시간 전입니다/);
  });

  it('🔴 경로가 없으면 "백업 정상"이 아니라 관측 불가다', () => {
    const r = probeFileAge(join(dir, '없는경로'), 26);
    expect(r.observable, '경로가 틀렸는데 정상이라 말하면 안 된다').toBe(false);
    expect(r.detail).toMatch(/경로가 없습니다/);
  });

  it('🔴 디렉터리는 있는데 파일이 없으면도 관측 불가다', () => {
    const r = probeFileAge(dir, 26);
    expect(r.observable).toBe(false);
    expect(r.detail).toMatch(/대상 파일이 없습니다/);
  });

  it('가장 최근 파일로 판정한다(오래된 파일이 섞여 있어도)', () => {
    put('hospitalrun_20260101_030001.sql.gz.gpg', 200);
    put('hospitalrun_20260902_030001.sql.gz.gpg', 3);
    expect(probeFileAge(dir, 26, { pattern: BACKUP_PATTERN }).value).toBe(0);
  });

  /**
   * 🔴 **검출기 자신이 거짓 안심을 만들던 자리**(2026-09-02 운영에서 드러남).
   *    확장자만 보다가 배포 백업(`pre-deploy_*.sql.gz`)을 집어 "정기 백업 0시간 전"이라 말했다 —
   *    그러면 **정기 크론이 죽어도 배포만 하면 통과한다.** 89일 사고를 놓치는 바로 그 구멍이다.
   */
  it('🔴 배포 백업을 정기 백업으로 세지 않는다', () => {
    put('pre-deploy_20260902_082222.sql.gz', 0);            // 방금 배포
    put('hospitalrun_20260605_030001.sql.gz.gpg', 89 * 24); // 정기는 89일 전
    const r = probeFileAge(dir, 26, { pattern: BACKUP_PATTERN });
    expect(r.observable).toBe(true);
    expect(r.value, '배포 백업이 정기 백업을 대신 통과시키면 안 된다').toBe(1);
    expect(r.detail).toMatch(/hospitalrun_/);
  });

  it('🔴 정기 백업이 하나도 없으면 관측 불가다(배포 백업만 있어도)', () => {
    put('pre-deploy_20260902_082222.sql.gz', 0);
    const r = probeFileAge(dir, 26, { pattern: BACKUP_PATTERN });
    expect(r.observable).toBe(false);
  });

  it('등록부의 백업 패턴이 실제 운영 파일명과 맞는다', () => {
    expect(BACKUP_PATTERN.test('hospitalrun_20260902_030001.sql.gz.gpg')).toBe(true);
    expect(BACKUP_PATTERN.test('hospitalrun_20260902_030001.sql.gz')).toBe(true);
    expect(BACKUP_PATTERN.test('pre-deploy_20260902_082222.sql.gz')).toBe(false);
    // 2026-09-11 — 배포 백업도 암호화된다. 확장자가 같아져도 정기 백업으로 세지 않는다
    expect(BACKUP_PATTERN.test('pre-deploy_20260911_082624.sql.gz.gpg')).toBe(false);
  });
});

describe('크론 — 등록·활성으로 판정한다(lastRun 으로 죽음을 단정하지 않는다)', () => {
  const snap = (jobs: { name: string; active: boolean }[]) => ({
    processStartedAt: new Date().toISOString(),
    jobs: jobs.map((j) => ({ ...j, schedule: '0 3 * * *', lastRunAt: null, nextRunAt: null })),
    error: null,
  });

  it('중지된 잡을 센다', () => {
    const r = probeCronInactive(snap([{ name: 'a', active: true }, { name: 'b', active: false }]));
    expect(r.value).toBe(1);
    expect(r.detail).toMatch(/중지된 잡: b/);
  });

  it('🔴 기동 직후라 lastRun 이 전부 비어도 위반이 아니다 — 거짓 경보를 만들지 않는다', () => {
    const r = probeCronInactive(snap([{ name: 'a', active: true }, { name: 'b', active: true }]));
    expect(r.value).toBe(0);
  });

  it('🔴 API 프로브가 없으면 "크론 0개 중지"가 아니라 관측 불가다', () => {
    expect(probeCronInactive(null).observable).toBe(false);
    expect(probeCronRegistered(null, 50).observable).toBe(false);
  });

  it('🔴 프로브가 에러를 담고 있으면 그 사유를 그대로 관측 불가로 낸다', () => {
    const bad = { processStartedAt: '', jobs: [], error: 'scheduler down' };
    const r = probeCronRegistered(bad, 50);
    expect(r.observable).toBe(false);
    expect(r.detail).toMatch(/scheduler down/);
  });

  it('등록 수가 기대보다 적으면 사라진 만큼 센다', () => {
    const r = probeCronRegistered(snap([{ name: 'a', active: true }]), 50);
    expect(r.value).toBe(49);
    expect(r.detail).toMatch(/모듈 등록 누락 의심/);
  });
});

describe('이벤트 — 발행만 되고 받는 곳이 없는 것', () => {
  it('실제 저장소를 훑어 결과를 낸다(추출이 깨지면 관측 불가)', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.observable, `추출 실패: ${r.detail}`).toBe(true);
    expect(r.detail).toMatch(/발행 \d+/);
  });

  it('🔴 소스 경로가 틀리면 "미소비 0건"으로 통과하지 않는다', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, '없는경로'));
    expect(r.observable).toBe(false);
  });

  /**
   * 🔴 **이 픽스처가 없어 하한 검사가 헛돌았다**(재주입에서 드러남).
   *    경로는 **있는데** 훑기가 깨진 경우 — `existsSync` 분기가 대신 통과시켜
   *    하한(`files.length < 100`)을 지워도 테스트가 초록이었다.
   *    가드는 결함을 재주입해 **실패해야** 가드다.
   */
  it('🔴 경로는 있는데 소스를 거의 못 훑으면 관측 불가다(하한이 살아 있다)', () => {
    const d = mkdtempSync(join(tmpdir(), 'sentinel-src-'));
    writeFileSync(join(d, 'a.ts'), "eventEmitter.emit('x.y');");
    const r = probeUnconsumedEvents(d);
    expect(r.observable, '파일 1개로 "미소비 0건"이라 말하면 안 된다').toBe(false);
    expect(r.detail).toMatch(/훑기가 깨졌습니다/);
  });

  /**
   * 🔴 **선언으로 진짜 미배선을 숨길 수 있다** — 그래서 선언에 조건을 건다.
   *    2026-09-03 전수 확인 결과 8종은 emit 바로 옆에서 DB 에 쓴다(사실을 잃지 않는다).
   *    그 "어디에 남는가"를 비워 두면 이 축이 무의미해지므로 가드가 그 문자열을 요구한다.
   */
  it('🔴 원장에만 남는 방송은 "어디에 남는가"를 반드시 적는다', () => {
    expect(Object.keys(EVENT_BROADCAST_ONLY).length).toBeGreaterThan(0);
    for (const [k, where] of Object.entries(EVENT_BROADCAST_ONLY)) {
      expect(where.length, `${k}: 어디에 남는지가 비어 있다 — 이러면 미배선을 숨길 수 있다`).toBeGreaterThan(15);
      // 표·모델·로그 중 하나는 이름으로 지목돼야 한다(막연한 변명 금지)
      // 🔴 화이트리스트다 — "어딘가 남는다"가 아니라 **실재하는 모델 이름**을 요구한다.
      //    (2026-09-16 F2 에서 7종을 추가하며 늘렸다. 전부 prisma/schema.prisma 에 있는 model 이름으로만 넓힌다)
      expect(where, `${k}: 남는 자리를 이름으로 지목하지 않았다`)
        .toMatch(/PatientJourneyEvent|AuditLog|Dispensing|DocumentRequest|ChemoCycle|CompoundingOrder|ClinicalHandoff|PsychSeclusionOrder|RegistrationConsent|PatientNotification|ConsentForm|Notification|로그/);
    }
  });

  /**
   * 🔴 (2026-09-16 F2) **스캐너가 발행을 놓쳤다.** 종전 정규식이 앞의 점을 요구해
   *    `this.x.emit` 만 봤고, P3 가 치료 완료를 순수 함수로 뽑으며 발행이 인자
   *    (`eventEmitter?.emit(...)`)가 되자 그 발행이 통째로 보이지 않았다.
   *    그런 자리에서만 발행되는 이벤트는 소비자가 없어도 "미소비 0"으로 통과한다.
   *    `therapy.session.completed` 는 저장소에서 **그 형태로만** 발행된다 — 산 증인이라 여기서 못박는다.
   */
  /**
   * 🔴 화이트리스트 자신이 썩는다 — 존재하지 않는 모델 이름을 적어 두면 "이름으로 지목했다"는
   *    검사가 통과하면서 실제로는 아무 데도 남지 않는 이벤트를 숨길 수 있다.
   *    선언 문자열이 **실재하는 prisma model** 을 가리키는지 스키마로 대조한다.
   */
  it('🔴 "어디에 남는가"가 가리키는 모델이 스키마에 실재한다', () => {
    const schema = readFileSync(join(REPO_ROOT, 'apps/api/prisma/schema.prisma'), 'utf-8');
    const models = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
    expect(models.size, '스키마에서 모델을 못 뽑았다 — 검사가 헛돕니다').toBeGreaterThan(100);
    for (const [k, where] of Object.entries(EVENT_BROADCAST_ONLY)) {
      // 🔴 '로그' 로 남는다고 선언한 것은 모델을 요구하지 않는다(원 계약이 인정하는 갈래).
      //    다만 그 경우 **로그라고 명시**해야 한다 — 모델도 로그도 아니면 어디에 남는지 말하지 않은 것이다.
      if (where.includes('로그')) continue;
      /**
       * 🔴 첫 판은 "실재하는 모델이 **하나라도** 있으면 통과"였다 — 재주입에서 `ClinicalHandoff` 를
       *    가짜 `HandoffLedger` 로 바꿨는데도 같은 문장의 다른 진짜 이름(`Notification`)이 대신 통과시켰다.
       *    그래서 **모델 모양 토큰은 전부** 실재해야 한다로 바꾼다(가짜 이름 하나면 실패).
       *    검사 대상은 두 낱말 이상 CamelCase(`ClinicalHandoff`) — `ERROR`·`CLINICAL_HANDOFF` 같은
       *    상수·열거값은 모델 이름이 아니므로 대상이 아니다.
       *    (한 낱말 이름 `Dispensing` 도 세지 않는다 — 흔한 명사와 구분할 수 없다.
       *     "이름으로 지목했는가"는 바로 위 화이트리스트 검사가 이미 요구한다)
       */
      const named = [...where.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)].map((m) => m[1]);
      const fake = named.filter((n) => !models.has(n));
      expect(fake, `${k}: 스키마에 없는 모델을 지목했다 — 죽은 선언이 미배선을 숨긴다: ${fake.join(', ')}`).toEqual([]);
    }
  });

  it('🔴 주입 속성이 아니라 인자로 받은 이미터의 발행도 센다(스캐너 사각)', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.observable).toBe(true);
    expect(r.emitted, 'eventEmitter?.emit(…) 형태(인자·지역 변수)를 놓치고 있다')
      .toContain('therapy.session.completed');
  });

  /**
   * 🔴 반대 방향 — **구독하는데 아무도 발행하지 않는** 리스너. 이름 오타·네임스페이스 변경으로 생기며
   *    (이 저장소에서 알림 refId 계약 위반으로 알림이 통째 유실된 전례가 있다) 조용히 죽는다.
   *    지금 0 이라 0 으로 못박는다 — 늘어나면 어느 이벤트인지 실패 메시지가 말한다.
   */
  it('🔴 구독하는데 발행이 없는 리스너는 없다(죽은 리스너 0)', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.observable).toBe(true);
    expect(r.consumed.length, '구독 목록을 못 뽑았다 — 검사가 헛돕니다').toBeGreaterThan(20);
    const dead = r.consumed.filter((c) => !r.emitted.includes(c));
    expect(dead, `구독하는데 발행하는 곳이 없다(오타·네임스페이스 불일치 의심): ${dead.join(', ')}`).toEqual([]);
  });

  it('🔴 선언한 이벤트가 실제로 발행되고 있다(죽은 선언 금지)', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.observable).toBe(true);
    expect(r.emitted.length, '발행 목록을 못 뽑았다 — 검사가 헛돕니다').toBeGreaterThan(20);
    for (const k of [...Object.keys(EVENT_BROADCAST_ONLY), ...Object.keys(EVENT_CONSUMED_ELSEWHERE)]) {
      expect(r.emitted, `${k}: 저장소에서 더 이상 발행되지 않습니다 — 죽은 선언(진짜 미배선을 숨긴다)`).toContain(k);
    }
  });

  it('🔴 다른 곳에서 소비되는 이벤트는 사유와 함께 선언돼 있다(선언 없이 빼지 않는다)', () => {
    expect(Object.keys(EVENT_CONSUMED_ELSEWHERE).length).toBeGreaterThan(0);
    for (const [k, why] of Object.entries(EVENT_CONSUMED_ELSEWHERE)) {
      expect(why.length, `${k} 의 사유가 비어 있다`).toBeGreaterThan(10);
    }
  });

  /**
   * 🔴 **`.emit(` 을 전부 세면 EventEmitter 가 아닌 것까지 센다**(2026-09-03 운영에서 드러남).
   *    검진권이 `this.billing.emit('redeem', ...)` 로 ERP 자금흐름 아웃박스를 부르는데
   *    그것을 이벤트 발행으로 세어 고아가 **24개**로 보고됐다(실제 8개).
   *    감시자가 틀린 수를 말한 것이다 — 수신자 이름을 소스에서 유도해 좁힌다.
   */
  it('🔴 EventEmitter 가 아닌 .emit() 을 세지 않는다(검진권 ERP 아웃박스)', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.observable).toBe(true);
    for (const bogus of ['redeem', 'refund', 'topup', 'purchase', 'settlement', 'commission', 'resale']) {
      expect(r.events, `'${bogus}' 는 ERP 아웃박스 호출이지 이벤트가 아니다`).not.toContain(bogus);
    }
  });

  it('🔴 수신자 이름 추출이 자기 주석을 데이터로 읽지 않는다', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/api/src/sentinel/pipe-sweep.ts'), 'utf-8');
    // 주석 제거가 이름 추출보다 먼저 와야 한다(그러지 않아 `X` 가 이름으로 잡혔다)
    const block = /const emitterNames[\s\S]{0,600}?\n  \}/.exec(src)?.[0] ?? '';
    expect(block, 'emitterNames 블록을 찾지 못했습니다').not.toBe('');
    const stripIdx = block.indexOf('replace(');
    const matchIdx = block.indexOf('EventEmitter2\\b');
    expect(stripIdx, '주석 제거가 없다').toBeGreaterThan(-1);
    expect(stripIdx, '주석을 지우기 전에 이름을 뽑고 있다').toBeLessThan(matchIdx);
  });

  it('SSE 가 fromEvent 로 받는 것도 소비로 센다 — 그래서 queue.changed 는 고아가 아니다', () => {
    const r = probeUnconsumedEvents(join(REPO_ROOT, 'apps/api/src'));
    expect(r.events).not.toContain('queue.changed');
  });
});

describe('공개 사이트 — 조회 실패는 낡음이 아니다', () => {
  it('최신이면 위반 아님', () => {
    expect(probePublicSite({ checked: true, fresh: true, detail: 'ok' }).value).toBe(0);
  });
  it('🔴 낡았으면 위반', () => {
    const r = probePublicSite({ checked: true, fresh: false, detail: '이전 빌드' });
    expect(r.observable).toBe(true);
    expect(r.value).toBe(1);
  });
  it('🔴 확인하지 못했으면 낡음이라 단정하지 않는다', () => {
    const r = probePublicSite({ checked: false, fresh: null, detail: 'HTTP 503' });
    expect(r.observable).toBe(false);
    expect(r.value).toBe(0);
  });
  it('🔴 프로브 자체가 없으면 관측 불가', () => {
    expect(probePublicSite(null).observable).toBe(false);
  });
});

/** 실제 저장 모양을 흉내낸 최소 목 */
function mockPrisma() {
  const runs: Record<string, unknown>[] = [];
  const findings = new Map<string, Record<string, unknown>>();
  return {
    runs, findings,
    sentinelRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r${runs.length}`, ...data, ok: false, attempted: 0, succeeded: 0, failed: 0, error: null };
        runs.push(row); return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(runs.find((r) => r.id === where.id)!, data); return {};
      }),
      findFirst: vi.fn(async () => null),
    },
    sentinelFinding: {
      findUnique: vi.fn(async ({ where }: { where: { axis_checkKey: { axis: string; checkKey: string } } }) =>
        findings.get(`${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { axis_checkKey: { axis: string; checkKey: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = `${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`;
        const cur = findings.get(k);
        findings.set(k, cur ? { ...cur, ...update } : { ...create });
        return {};
      }),
      findMany: vi.fn(async () => [...findings.values()]),
    },
  };
}

describe('축 D 스윕 — 관측 불가를 해결됨으로 적지 않는다', () => {
  it('🔴 프로브가 없어도 전 항목을 남기되 관측 불가로 표시한다', async () => {
    const prisma = mockPrisma();
    const svc = new SentinelService(prisma as never);
    const r = await svc.sweepPipe(REPO_ROOT, {
      cron: null, publicSite: null, expectedCrons: 50,
      cronReason: 'API 프로브가 30분 낡았습니다', publicSiteReason: 'API 프로브 없음',
    });
    expect(r.attempted).toBe(PIPE_CHECKS.length);
    expect(r.ok).toBe(true);

    const cron = prisma.findings.get('PIPE|pipe.cron.inactive')!;
    expect(cron.unobservable).toBe(true);
    expect(cron.resolvedAt, '관측 불가는 해결이 아니다').toBeNull();
    expect(cron.detail).toMatch(/30분 낡았습니다/);
  });

  it('등록부 전 항목에 프로브가 있다 — 구현 안 된 것은 관측 불가로 드러난다', async () => {
    const prisma = mockPrisma();
    await new SentinelService(prisma as never).sweepPipe(REPO_ROOT, {
      cron: { processStartedAt: '', jobs: [{ name: 'a', schedule: null, active: true, lastRunAt: null, nextRunAt: null }], error: null },
      publicSite: { checked: true, fresh: true, detail: 'ok' },
      expectedCrons: 1,
    });
    for (const c of PIPE_CHECKS) {
      const row = prisma.findings.get(`PIPE|${c.key}`)!;
      expect(row, `${c.key} 가 원장에 없다`).toBeTruthy();
      expect(row.detail, `${c.key} 에 사유가 없다`).toBeTruthy();
    }
  });

  it('🔴 등록부 항목에 딥링크가 있으면 실재하는 화면이어야 한다', () => {
    for (const c of PIPE_CHECKS.filter((x) => x.drillDown)) {
      const page = join(REPO_ROOT, 'apps/web/src/app/(main)', c.drillDown!.replace(/^\//, ''), 'page.tsx');
      expect(() => readFileSync(page, 'utf-8'), `${c.key} → ${c.drillDown} 화면이 없습니다`).not.toThrow();
    }
  });

  it('등록부 항목마다 왜 이 항목인지 근거가 있다', () => {
    for (const c of PIPE_CHECKS) expect(c.why.length, `${c.key}`).toBeGreaterThan(15);
  });
});

