import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderServerMessageKo, tOf, type ServerMessage } from '@hospital-run/shared';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
// 계측 규칙 정본은 스캐너 하나 — 카탈로그 키 추출기를 여기서 다시 만들지 않는다
import { catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';
import {
  ROOT, PH, LOCALES, SERVER_MESSAGE_SOURCES, sourceKeysOf, allServerMessageKeys, unregisteredKeys, assertWellFormed, composedLines,
} from './server-message-sources';

/**
 * 🔴 서버 표시 문장 `{ k, params }` 계약 — 배치 1 go-live (2026-09-15 I1).
 *
 * 서버가 `\`입력 ${n} / 필수 ${m}\`` 로 조립해 내려주던 사유는 영어 화면에서도 한국어였다(카탈로그로 못 고친다).
 * 이제 서버는 `detailMsg`/`basisMsg`(키+값)를 주고 화면 `<ServerText>` 가 `<Tf>` 로 조립한다.
 *
 * 못박는 것:
 *   (a) 서버 소스의 `serverMsg('…')` 키·`{ k }` 조각 **전부**가 카탈로그에 있다(en·ja·ar) — 한글 없는 키만 예외.
 *   (b) 실제 derive 결과 — `detailMsg` 가 있고, 종전 `detail` 은 **같은 정본에서 파생**(`renderServerMessageKo`)이다.
 *   (c) 자리표시자 ↔ params 이름이 정확히 일치(빈 자리·남는 값 0) · 문장 안에 값이 녹아 있지 않다.
 *   (d) servermsg 카탈로그에 고아 키 0(서버가 쓰지 않는 키 — **전 배치 소스 합집합** 기준) · 앞 카탈로그와 중복 0(죽은 키).
 *   (e) 대조군 — 추출기가 실제로 키를 읽는다 / 미등재 키는 missing 으로 보인다.
 */

const SVC = SERVER_MESSAGE_SOURCES.goLive[0];
const MSG = path.join(ROOT, 'packages/shared/src/i18n/messages');
const sourceKeys = () => sourceKeysOf(SERVER_MESSAGE_SOURCES.goLive);

describe('(a) 서버 소스의 키가 전부 카탈로그에 있다', () => {
  const keys = sourceKeys();

  it('대조군 — 추출기가 실제로 go-live 키를 읽는다(0이면 아래 검사가 헛돈다)', () => {
    expect(keys.size).toBeGreaterThanOrEqual(50);
    expect(keys.has('실 키 설정됨(64 hex·플레이스홀더 아님)')).toBe(true);
    expect(keys.has('의원')).toBe(true);
  });

  it('🔴 한글이 든 키는 en·ja·ar 모두 등재', () => {
    const missing = unregisteredKeys(keys);
    expect(missing, `미등재 ${missing.length}건`).toEqual([]);
  });

  it('대조군 — 미등재 키는 missing 으로 보인다(tOf 가 무엇이든 통과시키지 않는다)', () => {
    expect(tOf('이 문장은 어느 카탈로그에도 없다 {값}', 'en').missing).toBe(true);
  });

  it('🔴 go-live 서비스에 한글+보간 템플릿이 0 — 연결(+)로 피해 간 문장도 0', () => {
    const { composed, concat } = composedLines(SVC);
    expect(composed).toEqual([]);
    expect(concat).toEqual([]);
  });
});

describe('(b)(c) 실제 derive 결과 — detailMsg 가 정본, detail 은 파생', () => {
  const svcWith = (cfg: Record<string, unknown>, prismaExtra: Record<string, unknown> = {}) =>
    new GoLiveService(
      { goLiveItem: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) }, ...prismaExtra } as never,
      { get: vi.fn((k: string) => Promise.resolve(cfg[k])) } as never,
    );
  type D = { status: string; detail: string; detailMsg: ServerMessage };
  const check = (d: D) => {
    expect(d.detailMsg, '구 응답 모양(detail 만)으로 되돌아갔다').toBeDefined();
    expect(d.detail).toBe(renderServerMessageKo(d.detailMsg));
    assertWellFormed(d.detailMsg);
  };

  let savedKey: string | undefined;
  beforeEach(() => { savedKey = process.env.ENCRYPTION_KEY; });
  afterEach(() => { if (savedKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = savedKey; });

  it('암호화 키 — 값(길이)은 params 로, 문장 키에는 녹아 있지 않다', () => {
    process.env.ENCRYPTION_KEY = 'abc123';
    const d = (svcWith({}) as any).deriveEncryptionKey() as D;
    check(d);
    expect(d.detailMsg.k).toBe('🔴 ENCRYPTION_KEY 길이 {길이}자(AES-256 = 64 hex 자) — 설정 오류');
    expect(d.detailMsg.params).toEqual({ 길이: 6 });
    expect(d.detail).toContain('길이 6자');
  });

  it('서비스 플래그 — 미설정은 번역 조각 { k: 미설정 }, 실제 값은 그대로', async () => {
    const unset = (await (svcWith({}) as any).deriveServiceFlag('flag:dev.demoDateRoll=false', 'NOT_READY')) as D;
    check(unset);
    expect(unset.detailMsg.params?.현재).toEqual({ k: '미설정' });
    const set = (await (svcWith({ 'dev.demoDateRoll': true }) as any).deriveServiceFlag('flag:dev.demoDateRoll=false', 'NOT_READY')) as D;
    check(set);
    expect(set.detailMsg.params?.현재).toBe('true');
  });

  it('게이트 맵 — 영역 수·최저 모드는 params', () => {
    const d = (svcWith({}) as any).deriveConfigGate({ route: 'OFF', dose: 'BLOCK' }, 'BLOCK') as D;
    check(d);
    expect(d.detailMsg.k).toContain('{전체}영역 중 {충족}영역만');
  });

  it('요양기관 종별 — 종별 이름은 조각, 코드는 값', async () => {
    const d = (await (svcWith({}, { systemConfig: { findUnique: vi.fn().mockResolvedValue({ value: 'GENERAL' }) } }) as any).deriveInstitutionGrade()) as D;
    check(d);
    expect(d.detailMsg.params).toEqual({ 종별: { k: '종합병원' }, 코드: 'GENERAL' });
    expect(tOf('종합병원', 'en').missing).toBe(false);
  });

  it('config:key=val — 한글 없는 키는 등재 대상이 아니고, 미설정 조각은 번역된다', async () => {
    const d = (await (svcWith({}) as any).deriveIntegration('config:hira.mode=REAL')) as D;
    check(d);
    expect(d.detailMsg.params?.값).toEqual({ k: '미설정' });
  });

  it('롤업 — 항목 detailMsg 와 준비율 basisMsg 가 응답에 실린다', async () => {
    const r = await svcWith({}).rollup();
    expect(r.readiness.basisMsg).toBeDefined();
    expect(r.readiness.basis).toBe(renderServerMessageKo(r.readiness.basisMsg));
    assertWellFormed(r.readiness.basisMsg);
  });
});

describe('(d) servermsg 카탈로그 — 고아·죽은 키 0 · 세 언어 자리표시자 일치', () => {
  const reg = fs.readFileSync(path.join(MSG, 'registry.ts'), 'utf8');
  const order = [...new Set(['common', ...[...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => m[1])])];
  const at = order.indexOf('servermsg');
  const mine = catalogKeysOf(fs.readFileSync(path.join(MSG, 'servermsg.ts'), 'utf8')) as Set<string>;

  it('등록돼 있다(대조군 — 키 추출이 비지 않았다)', () => {
    expect(at).toBeGreaterThan(0);
    expect(mine.size).toBeGreaterThanOrEqual(40);
  });

  it('🔴 고아 키 0 — 모든 키를 서버가 실제로 쓴다(전 배치 소스 합집합)', () => {
    const used = allServerMessageKeys();
    expect([...mine].filter((k) => !used.has(k))).toEqual([]);
  });

  it('🔴 죽은 키 0 — 앞 카탈로그가 가진 원문을 다시 정의하지 않는다', () => {
    const before = new Set<string>();
    for (const f of order.slice(0, at)) for (const k of catalogKeysOf(fs.readFileSync(path.join(MSG, `${f}.ts`), 'utf8'))) before.add(k);
    expect([...mine].filter((k) => before.has(k))).toEqual([]);
  });

  it('세 언어 번역문의 자리표시자 집합이 키와 같다', () => {
    const bad: string[] = [];
    const names = (s: string) => [...s.matchAll(PH)].map((x) => x[1]).sort().join(',');
    for (const k of mine) for (const loc of LOCALES) if (names(tOf(k, loc).text) !== names(k)) bad.push(`${loc}: ${k}`);
    expect(bad).toEqual([]);
  });
});
