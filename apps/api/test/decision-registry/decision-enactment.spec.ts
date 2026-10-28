import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { ENACTABLE_KINDS, AUTO_ENACT_KINDS } from '../../src/common/enactment-kinds';
import { GovernanceEnactmentService } from '../../src/modules/gld/governance-enactment.service';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.resolve(SRC, rel), 'utf8');

/**
 * 🔴 결정 등록부의 자동 반영은 **집행 엔진에 붙인다** — 옆에 더 약한 것을 두지 않는다.
 *
 * 배경(2026-08-27): 등록부는 `config.set()` 을 직접 불렀다. 그 경로에는
 * ①집행 전 스냅샷 ②실패 기록 이 없었고, `config.set` 이 던지면 **결정 기록 자체가 사라졌다**.
 * 반면 집행 엔진은 이미 24건을 집행한 검증된 경로다(스냅샷·FAILED·간사 알림 포함).
 */
describe('바인딩 — 어휘와 빠짐', () => {
  const bound = DECISION_REGISTRY.filter((d) => d.enactKind);

  it('🔴 `enactKind` 가 집행 엔진 어휘 안에 있다 — 등록부가 어휘를 지어내지 못한다', () => {
    expect(bound.length, '바인딩된 결정이 하나도 없으면 이 가드는 아무것도 지키지 않는다').toBeGreaterThan(0);
    for (const d of bound) {
      expect(ENACTABLE_KINDS.has(d.enactKind!), `${d.key}: ${d.enactKind} 는 집행 kind 가 아니다`).toBe(true);
    }
  });

  it('🔴 바인딩된 결정은 **모든 선택지**에 `enact` 를 갖는다 — 빠뜨림 = 조용한 미반영', () => {
    const missing: string[] = [];
    for (const d of bound) {
      for (const o of d.options) {
        if (!('enact' in o)) missing.push(`${d.key}.${o.value}`);
      }
    }
    expect(missing, `선택지에 enact 가 없다(바꾸지 않으려면 \`enact: null\` 을 명시하라):\n${missing.join('\n')}`).toEqual([]);
  });

  it('대조군: `enact: null`(바꾸지 않음)은 정당하다 — 전부 값을 강요하지 않는다', () => {
    const nulls = bound.flatMap((d) => d.options.filter((o) => o.enact === null).map((o) => `${d.key}.${o.value}`));
    expect(nulls.length, 'null 선택지가 하나도 없다면 이 대조군이 무의미하다').toBeGreaterThan(0);
  });

  it('🔴 CONFIG_CHANGE 바인딩 키가 DEFAULTS 카탈로그에 있다 — 없으면 엔진이 KEY_NOT_IN_CATALOG 로 거부한다', () => {
    const defaults = read('modules/config/config-runtime.service.ts');
    for (const d of bound.filter((x) => x.enactKind === 'CONFIG_CHANGE')) {
      for (const o of d.options) {
        const key = (o.enact as { key?: string } | null)?.key;
        if (!key) continue;
        expect(defaults.includes(`'${key}': {`), `${d.key}.${o.value} → '${key}' 가 DEFAULTS 에 없다`).toBe(true);
      }
    }
  });

  it('🔴 `PROTECTED_KEYS` 를 겨눈 바인딩이 없다 — 전용 승인 워크플로를 우회하면 안 된다', () => {
    const engine = read('modules/gld/governance-enactment.service.ts');
    const protectedKeys = [...engine.matchAll(/PROTECTED_KEYS = new Set<string>\(\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(protectedKeys.length, 'PROTECTED_KEYS 를 읽지 못했다').toBeGreaterThan(0);
    for (const d of bound) {
      for (const o of d.options) {
        const key = (o.enact as { key?: string; gateKey?: string } | null);
        const k = key?.key ?? key?.gateKey;
        if (k) expect(protectedKeys, `${d.key}.${o.value} 가 보호 키 '${k}' 를 겨눈다`).not.toContain(k);
      }
    }
  });

  it('🔴 바인딩 target 이 **목표 상태**다 — 비멱등(toggle)은 재시도가 값을 뒤집는다', () => {
    for (const d of bound) {
      for (const o of d.options) {
        const t = o.enact as Record<string, unknown> | null;
        if (t) expect(String(t.op ?? ''), `${d.key}.${o.value}`).not.toBe('toggle');
      }
    }
  });
});

describe('층 규칙 — 자동화가 층을 넘지 못한다', () => {
  it('🔴 `COMMITTEE` 결정은 등록부 기록만으로 집행되지 않는다', () => {
    const svc = read('modules/decision-registry/decision.service.ts');
    // 집행 분기는 AUTHORIZED_ROLE 에만 걸려 있어야 한다
    expect(svc).toMatch(/approvalPath === 'AUTHORIZED_ROLE' && d\.enactKind/);
    expect(svc, '위원회 결정을 등록부가 집행하면 안 된다').not.toMatch(/approvalPath === 'COMMITTEE'[^\n]*enactRegistryDecision/);
  });

  it('🔴 위원회 경로 결정에 바인딩이 붙어 있지 않다(붙이면 등록부가 의결을 대신하게 된다)', () => {
    const wrong = DECISION_REGISTRY.filter((d) => d.enactKind && d.approvalPath !== 'AUTHORIZED_ROLE');
    expect(wrong.map((d) => `${d.key}(${d.approvalPath})`)).toEqual([]);
  });

  it('대조군: `AUTHORIZED_ROLE` + 바인딩은 실재한다(전부 막는 가드가 아니다)', () => {
    const ok = DECISION_REGISTRY.filter((d) => d.enactKind && d.approvalPath === 'AUTHORIZED_ROLE');
    expect(ok.length).toBeGreaterThan(0);
  });
});

describe('원장 출처 불변식', () => {
  const assert_ = (src: { decisionId?: string | null; registryKey?: string | null }) =>
    GovernanceEnactmentService.assertSingleSource(src);

  it('🔴 둘 다 비면 거부 — 어느 결정에서 왔는지 알 수 없는 액션', () => {
    expect(() => assert_({})).toThrow(/정확히 하나/);
  });
  it('🔴 둘 다 차면 거부 — 두 결정이 같은 집행을 주장한다', () => {
    expect(() => assert_({ decisionId: 'd1', registryKey: 'k1' })).toThrow(/정확히 하나/);
  });
  it('대조군: 하나만 차면 통과한다(양쪽 출처 모두)', () => {
    expect(() => assert_({ decisionId: 'd1' })).not.toThrow();
    expect(() => assert_({ registryKey: 'k1' })).not.toThrow();
  });
});

describe('집행 경로 — 위원회와 등록부가 같은 코드를 지난다', () => {
  it('🔴 집행 루프가 하나다 — `runAction` 을 두 진입점이 공유한다', () => {
    const engine = read('modules/gld/governance-enactment.service.ts');
    expect(engine).toMatch(/private async runAction\(/);
    const calls = [...engine.matchAll(/this\.runAction\(/g)].length;
    expect(calls, '두 진입점(enactDecision·enactRegistryDecision)이 같은 함수를 불러야 한다').toBe(2);
    // 🔴 집행 본문이 복제되지 않았는지 — executeAction 직접 호출은 runAction 안 1곳뿐
    expect([...engine.matchAll(/this\.executeAction\(/g)].length).toBe(1);
  });

  it('🔴 등록부 집행이 위원회 결정을 만들지 않는다', () => {
    const engine = read('modules/gld/governance-enactment.service.ts');
    const fn = engine.slice(engine.indexOf('async enactRegistryDecision('), engine.indexOf('kind 별 집행 디스패치'));
    expect(fn, '위원회 결정을 생성하면 원장이 "위원회가 의결했다"고 말하게 된다')
      .not.toMatch(/committeeDecision\.(create|update)/);
  });

  it('🔴 크론은 `PENDING` 만 재시도한다 — `FAILED` 를 자동 재시도하면 같은 실패를 조용히 반복한다', () => {
    const engine = read('modules/gld/governance-enactment.service.ts');
    const cron = engine.slice(engine.indexOf('async cron()'), engine.indexOf('async enactDecision('));
    expect(cron).toMatch(/registryKey: \{ not: null \}, status: 'PENDING'/);
    expect(cron).not.toMatch(/status: 'FAILED'/);
  });
});

describe('정직성 — 기록과 집행을 분리한다', () => {
  const svc = read('modules/decision-registry/decision.service.ts');

  it('🔴 등록부가 `config.set` 으로 직접 집행하지 않는다(스냅샷·실패 기록이 없는 경로)', () => {
    const decide = svc.slice(svc.indexOf('async decide('), svc.indexOf('private enactTargetFor'));
    expect(decide, 'config.set 직접 호출이 남아 있다 — 집행 엔진에 위임하라')
      .not.toMatch(/this\.config\.set\(d\.configKey/);
  });

  it('🔴 집행이 거부돼도 결정 기록은 남는다 — 사람의 결정은 이미 일어난 사실이다', () => {
    const decide = svc.slice(svc.indexOf('async decide('), svc.indexOf('private enactTargetFor'));
    // 집행 호출이 try/catch 안에 있고, catch 가 결정 기록을 막지 않는다
    expect(decide).toMatch(/try \{[\s\S]*enactRegistryDecision[\s\S]*\} catch/);
    expect(decide).toMatch(/반영 보류/);
  });

  it('🔴 게이트 OFF 를 "적용됨"이라 말하지 않는다', () => {
    const decide = svc.slice(svc.indexOf('async decide('), svc.indexOf('private enactTargetFor'));
    // catch 경로에서 applied 는 false 여야 한다
    const cat = decide.slice(decide.indexOf('} catch'));
    expect(cat).toMatch(/applied = false/);
  });

  it('🔴 선택지에 바인딩이 빠진 것을 조용히 넘기지 않는다(3상태를 구분한다)', () => {
    expect(svc).toMatch(/target === undefined/);
    expect(svc).toMatch(/target === null/);
  });

  it('AUTO_ENACT_KINDS 가 MANUAL 을 뺀 나머지다 — 수동 이행을 자동 집행하지 않는다', () => {
    expect(AUTO_ENACT_KINDS).not.toContain('MANUAL');
    expect(AUTO_ENACT_KINDS.length).toBe(ENACTABLE_KINDS.size - 1);
  });
});

/**
 * 🔴 **"정했다"와 "그렇게 됐다"를 가른다.**
 * 종전 화면은 `decided` 하나였다 — 그러면 "20건 결정 완료"가 아무것도 안 바뀐 상태를 가린다.
 */
describe('이행 상태 5종', () => {
  const D = { key: 'k', approvalPath: 'AUTHORIZED_ROLE', options: [] } as never;
  const st = (decided: boolean, actions: never[] | Array<Record<string, unknown>>) =>
    DecisionService.enactmentStatusOf(D, decided, actions as never);
  const A = (over: Record<string, unknown> = {}) =>
    ({ kind: 'CONFIG_CHANGE', status: 'ENACTED', error: null, enactedAt: new Date(), target: {}, ...over });

  it('기록이 없으면 미결이다 — 기본값을 결정으로 읽지 않는다', () => {
    expect(st(false, []).state).toBe('UNDECIDED');
  });

  it('🔴 실패가 하나라도 있으면 FAILED 다 — 성공분에 묻히지 않는다', () => {
    const r = st(true, [A(), A({ status: 'FAILED', error: 'KEY_NOT_IN_CATALOG' })]);
    expect(r.state).toBe('FAILED');
    expect(r.detail).toContain('KEY_NOT_IN_CATALOG');
  });

  it('🔴 미집행이 남아 있으면 PENDING 이다 — "반영됨"이라 말하지 않는다', () => {
    expect(st(true, [A(), A({ status: 'PENDING' })]).state).toBe('PENDING');
  });

  it('전부 집행되면 ENACTED', () => {
    expect(st(true, [A(), A()]).state).toBe('ENACTED');
  });

  it('MANUAL 만 있으면 수동확인(자가신고) — 실검증과 섞지 않는다', () => {
    expect(st(true, [A({ kind: 'MANUAL' })]).state).toBe('MANUAL_CONFIRMED');
  });

  it('🔴 액션이 없는 결정을 "반영됨"이라 말하지 않고 **왜 남았는지** 말한다', () => {
    const committee = DecisionService.enactmentStatusOf(
      { key: 'k', approvalPath: 'COMMITTEE', options: [] } as never, true, []);
    expect(committee.state).toBe('PENDING');
    expect(committee.detail).toContain('위원회');
    const code = DecisionService.enactmentStatusOf(
      { key: 'k', approvalPath: 'CODE_CHANGE', options: [] } as never, true, []);
    expect(code.detail).toContain('배포');
  });

  it('🔴 상태 라벨이 PENDING 과 ENACTED 를 다르게 말한다(같은 문구로 접히지 않는다)', () => {
    expect(st(true, [A({ status: 'PENDING' })]).label).not.toBe(st(true, [A()]).label);
  });
});

/**
 * 🔴 **누가 들고 있는가 · 언제까지인가** — 개시 관제(`go-live.registry.ts`)는 이미 `owner` 를
 *    갖는데 결정에는 **0건**이었다. 담당이 없으면 34건은 아무의 일도 아니다.
 */
describe('담당·기한 — 결정이 아무의 일도 아니게 두지 않는다', () => {
  it('모든 결정에 owner 가 있다', () => {
    const missing = DECISION_REGISTRY.filter((d) => !d.owner?.trim()).map((d) => d.key);
    expect(missing).toEqual([]);
  });

  /**
   * 🔴 처음엔 "한글 2~4자면 인명"이라는 **부정 탐지**로 짰다가 `전산`(부서다)을 잡았다.
   *    탐지기가 아니라 **양성 규칙**으로 바꿨다 — 조직 단위 접미사를 요구한다.
   *    (부정을 단정하려 들면 내 추측이 규칙이 된다)
   */
  it('🔴 owner 가 **사람 이름이 아니라 역할·부서**다 — 사람이 바뀌면 담당이 사라진다', () => {
    // 🔴 접미사는 **문자열 끝**에만 요구한다. `원무·보험팀` 처럼 축약해 이어 쓰는 것이 한국어 관례라
    //    조각마다 강제하면 정당한 표기가 걸린다(두 번째 오조준 — 좁히되 대상이 0이 되지 않게).
    const ORG = /(팀|부|과|실|센터|위원회|담당|직원|CPO\))$/;
    const bad = DECISION_REGISTRY
      .filter((d) => !ORG.test(d.owner.trim()))
      .map((d) => `${d.key} → ${d.owner}`);
    expect(bad, '조직 단위(팀·부·과·실·센터…)로 끝나게 적어라 — 개인 이름 금지').toEqual([]);
  });

  it('🔴 `dueBy` 가 개시 관계와 어긋나지 않는다 — 개시 전 필수인데 기한이 없으면 안 된다', () => {
    const bad = DECISION_REGISTRY
      .filter((d) => d.goLive === 'REQUIRED_BEFORE' && d.dueBy !== 'BEFORE_GO_LIVE')
      .map((d) => `${d.key}(${d.dueBy})`);
    expect(bad).toEqual([]);
  });

  it('대조군: 개시와 무관한 결정은 기한이 없어도 된다(전부 강제하지 않는다)', () => {
    const none = DECISION_REGISTRY.filter((d) => d.goLive === 'NOT_RELATED' && d.dueBy === 'NONE');
    expect(none.length).toBeGreaterThan(0);
  });

  it('🔴 `dueBy` 가 절대 날짜가 아니다 — 개시일이 없는데 날짜를 박으면 곧 거짓이 된다', () => {
    for (const d of DECISION_REGISTRY) {
      expect(['BEFORE_GO_LIVE', 'WITHIN_30D', 'NONE'], `${d.key}`).toContain(d.dueBy);
    }
  });
});

describe('개시 관제 ↔ 결정 등록부 — 문자열이 아니라 정본 필드로 잇는다', () => {
  it('🔴 `decisionKey` 가 가리키는 결정이 실재한다(문자열 링크는 키를 바꿔도 아무도 모른다)', () => {
    const keys = new Set(DECISION_REGISTRY.map((d) => d.key));
    const dangling = GO_LIVE_REGISTRY
      .filter((i) => i.decisionKey && !keys.has(i.decisionKey))
      .map((i) => `${i.key} → ${i.decisionKey}`);
    expect(dangling).toEqual([]);
  });

  it('대조군: 실제로 연결된 항목이 있다(빈 가드가 아니다)', () => {
    expect(GO_LIVE_REGISTRY.filter((i) => i.decisionKey).length).toBeGreaterThan(0);
  });

  it('🔴 note 안의 문자열 링크에 기대지 않는다 — 결정을 언급하면 `decisionKey` 로도 적는다', () => {
    const onlyInNote = GO_LIVE_REGISTRY
      .filter((i) => !i.decisionKey && /\/admin\/decisions\//.test(i.note ?? ''))
      .map((i) => i.key);
    expect(onlyInNote, 'note 에만 결정 링크가 있다 — decisionKey 필드로 올려라').toEqual([]);
  });
});

/**
 * 🔴 **바인딩하지 않는 것이 정답인 결정이 있다.**
 *
 * 허가권자 경로 7건 중 4건은 전부 **법적 확인**이다 —
 * "적법 근거를 확인했는가 · 위탁계약을 체결했는가 · 의료기기 해당 여부를 확인했는가 · 채널을 도입했는가".
 * 확인 자체는 **아무 스위치도 켜지 않고**, 후속 결정을 여는 것(`dependsOn`)이 역할이다.
 * 여기에 억지로 `enactKind` 를 붙이면 "확인했더니 뭔가 켜졌다"는 거짓이 된다.
 */
describe('D9 — 없는 바인딩을 만들지 않는다', () => {
  const LEGAL_CONFIRMATIONS = [
    'legal.patientPush.consentScope',
    'legal.sms.entrustment',
    'legal.ai.deviceClassification',
    'legal.appointmentNotify.adapter',
  ];

  it('🔴 법적 확인 4건은 바인딩이 **없어야** 한다 — 확인은 스위치가 아니다', () => {
    const wrong = LEGAL_CONFIRMATIONS
      .map((k) => DECISION_REGISTRY.find((d) => d.key === k))
      .filter((d): d is NonNullable<typeof d> => !!d && !!d.enactKind)
      .map((d) => d.key);
    expect(wrong, '법적 확인에 집행 바인딩을 붙이면 "확인했더니 뭔가 켜졌다"는 거짓이 된다').toEqual([]);
  });

  it('그 4건이 등록부에 실재한다(가드가 사라진 키를 지키고 있지 않다)', () => {
    for (const k of LEGAL_CONFIRMATIONS) {
      expect(DECISION_REGISTRY.some((d) => d.key === k), `${k} 가 등록부에 없다`).toBe(true);
    }
  });

  /**
   * 🔴 처음엔 `toBeLessThanOrEqual(1)` 로 썼다 — **여유를 둔 가드는 신규 위반을 흡수한다**
   *    (이 저장소에서 이미 겪은 유형). 게다가 `1` 은 내가 지어낸 숫자다.
   *    → **기준선 동결**로 바꾼다. 지금 후속이 없는 확인 2건은 사실이고,
   *      그것을 배선하는 것은 사람 판단이라 여기서 지어내지 않는다.
   *      새로 생기면 실패한다. 해소되면 기준선을 **낮춰야** 통과한다(올리지 않는다).
   */
  it('🔴 후속 결정이 없는 확인은 **동결된 2건뿐**이다 — 새로 생기면 잡는다', () => {
    // 2→1 (2026-09-15 배치 C) — `policy.crm.automatedOutreach` 가 `legal.sms.entrustment` 를 선행 조건으로 배선했다
    const KNOWN_ORPHANS = ['legal.appointmentNotify.adapter'];
    const orphan = LEGAL_CONFIRMATIONS.filter(
      (k) => !DECISION_REGISTRY.some((d) => d.dependsOn?.includes(k)));
    expect(
      orphan.sort(),
      '후속 결정이 없는 확인이 바뀌었다 — 배선했으면 기준선을 낮추고, 새로 생겼으면 dependsOn 을 배선하라',
    ).toEqual(KNOWN_ORPHANS.sort());
  });

  it('대조군: 후속이 실제로 배선된 확인이 있다(전부 고아가 아니다)', () => {
    const wired = LEGAL_CONFIRMATIONS.filter(
      (k) => DECISION_REGISTRY.some((d) => d.dependsOn?.includes(k)));
    expect(wired.length).toBeGreaterThan(0);
  });

  it('🔴 바인딩 없는 허가권자 결정에 "배포로만 반영된다"고 말하지 않는다 — 사실이 아니다', () => {
    const svc = read('modules/decision-registry/decision.service.ts');
    const decide = svc.slice(svc.indexOf('async decide('), svc.indexOf('private enactTargetFor'));
    // CODE_CHANGE 문구는 CODE_CHANGE 분기 안에만 있어야 한다
    const codeBranch = decide.indexOf("d.approvalPath === 'CODE_CHANGE'");
    const phrase = decide.indexOf('배포로만 반영된다');
    expect(codeBranch, 'CODE_CHANGE 분기가 없다').toBeGreaterThan(-1);
    expect(phrase).toBeGreaterThan(codeBranch);
    // 마지막 else 는 "바꿀 설정 없음"을 말한다
    expect(decide).toMatch(/확인이 기록됐다\(바꿀 설정 없음\)/);
  });

  it('🔴 그 문구가 **무엇이 열리는지** 함께 말한다 — 사람이 다음에 어디로 갈지 알아야 한다', () => {
    const svc = read('modules/decision-registry/decision.service.ts');
    expect(svc).toMatch(/dependsOn\?\.includes\(d\.key\)/);
    expect(svc).toMatch(/이제 다음이 열린다/);
  });
});
