import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CrmChannelService } from '../../src/modules/crm/crm-channel.service';
import { ConsultService } from '../../src/modules/consult/consult.service';
import { StandardGovernanceService, RULE_SCOPE_ALL } from '../../src/modules/gld/standard-governance.service';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **실패를 삼킨 바로 뒤에서 성공을 말하는 코드**(P16 — 실행하지 않고 성공 상태만 기록).
 *
 * 2026-09-13 medical-record-search 가 인덱스 생성 실패를 `.catch(() => {})` 로 삼키고 "ensured" 를 남겼다.
 * 같은 모양 전수(2026-09-14): 후보 22 → 확정 결함 3(실패를 성공·통과로 번역) + 부수 기록 소실 7 을 교정, 12 가 남았다.
 *  - 확정: CRM 이메일 설정 **조회 실패**→"미설정 시뮬레이션 성공" · 상담 종료 기록 실패→`ok:true`(세션은 열린 채)
 *          · 합동 의결 매핑 **조회 실패**→"합동 아님"→`PASS 발효`
 *  - 남은 12 는 한 건씩 읽어 정당으로 분류했다(성공 문구가 삼킨 동작을 주장하지 않음 — 목록은 BASELINE 주석).
 *
 * 🔴 **이 가드는 목록을 동결한다(수가 아니라).** 수로 동결하면 하나 고치고 하나 새로 만들어도 통과한다.
 *    새 자리가 생기면 실패한다 — 삼키지 말고 실패를 로그/전파하거나, 정당하면 이유와 함께 BASELINE 에 올린다.
 *    줄면 BASELINE 에서 지운다(여유 0).
 * 🔴 **상한이지 전수가 아니다** — 성공 신호를 어휘(ensured·완료·ok: true …)로 찾으므로 다른 말로 성공을 말하면 못 잡는다.
 */
const API_SRC = path.join(__dirname, '..', '..', 'src');
const WINDOW_LINES = 10;
// 다른 갈래가 최근 직접 다룬 축(sentinel·backup·locale-time)은 각자의 가드가 본다
const EXCLUDE = /(^|\/)(sentinel|backup|locale-time)/;

const SWALLOW = /\.catch\(\s*(?:\([^)]*\)|\w+)?\s*=>\s*(?:\{\s*\}|undefined|null|void\s+0|false|\[\]|0)\s*\)|\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const SUCCESS = /(?:logger|console|log)\.(?:log|info)\s*\([^;]*?(ensured|완료|성공|success|synced|created|applied|done|registered|initialized|ready|sent|발송|loaded|started|seeded|migrated|updated|saved|refreshed|restored|✓|✅|OK\b)|status:\s*'(?:OK|SENT|DONE|SUCCESS|COMPLETED|SYNCED|APPLIED)'|(?:ok|success|sent|applied|synced):\s*true/i;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 순수 스캐너 — 코드 문자열 하나에서 "삼킨 catch 뒤 WINDOW 줄 안의 성공 신호" 를 찾는다. 키 = 삼킨 줄의 정규화 텍스트 */
export function scanSwallowThenSuccess(source: string): string[] {
  const code = stripComments(source) as string;
  const lines = code.split('\n');
  const keys: string[] = [];
  for (const m of code.matchAll(SWALLOW)) {
    const startLine = code.slice(0, m.index).split('\n').length - 1;
    const endIdx = (m.index ?? 0) + m[0].length;
    const endLine = code.slice(0, endIdx).split('\n').length - 1;
    const tail = [code.slice(endIdx).split('\n')[0], ...lines.slice(endLine + 1, endLine + 1 + WINDOW_LINES)].join('\n');
    if (SUCCESS.test(tail)) keys.push(lines[startLine].trim().replace(/\s+/g, ' ').slice(0, 160));
  }
  return keys;
}

function scanTree(): string[] {
  const hits: string[] = [];
  for (const f of tsFiles(API_SRC)) {
    const rel = path.relative(API_SRC, f).split(path.sep).join('/');
    if (EXCLUDE.test(rel)) continue;
    for (const k of scanSwallowThenSuccess(fs.readFileSync(f, 'utf8'))) hits.push(`${rel} :: ${k}`);
  }
  return hits.sort();
}

/**
 * 2026-09-14 실측 — 전부 읽고 정당으로 분류한 자리(성공 문구가 삼킨 동작을 주장하지 않는다).
 *  holiday           upsert 실패는 synced 에 안 세고 `synced/total` 로 틈이 드러난다(원인은 소실 — 개선 여지)
 *  hospital-info     spawn 실패 경로 안의 상태파일 기록 — 기동 실패 자체는 error 로그
 *  sign-integration  봉인 2xx 뒤 영수증 본문 파싱 — 못 읽으면 warn(2026-09-14)
 *  data-quality      보존기간 정리 deleteMany(베스트에포트) — 저장 실패는 별도 warn·집계
 *  encounter ×2      첨부 파일 정리 unlink — 신규·레거시 두 경로 중 하나는 늘 ENOENT
 *  satisfaction      환자 연결 만족도 사본 — ok 는 설문 제출(원장) 기준
 *  registration-consent FCM 푸시 부가 — delivered 는 PORTAL 채널 기준
 *  duty-schedule     통합 플래그 조회 실패→구 경로 허용(fail-open 이지만 성공 주장과 무관 — 별도 판단 대상)
 *  (emergency 는 2026-09-14 교정 — 조회 실패를 0=OFF 로 번역하지 않고 건너뜀+warn · voucher-cron 은 기록 실패를 세어 말한다)
 *  consult           patientMessage 의 updatedAt 갱신(정렬용) — 메시지는 이미 저장
 *  media             자가치유 스캔 create 중복 — added 는 성공분만 센다
 */
const BASELINE = [
  "modules/consult/consult.service.ts :: await this.prisma.consultSession.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => {});",
  "modules/data-quality/data-quality.service.ts :: await this.prisma.qualityMetricSnapshot.deleteMany({ where: { capturedOn: { lt: new Date(Date.now() - retention * 86400_000) } } }).catch(() => undefined);",
  "modules/duty-schedule/duty-schedule.controller.ts :: const unified = String((await this.configRuntime?.get('ess.leave.unified').catch(() => null)) ?? 'false') === 'true';",
  "modules/encounter/encounter.service.ts :: await fs.unlink(join(process.cwd(), 'uploads', 'encounters', encounterId, fname)).catch(() => undefined);",
  "modules/encounter/encounter.service.ts :: await fs.unlink(join(this.attDir(encounterId, join), fname)).catch(() => undefined);",
  "modules/holiday/holiday.service.ts :: } catch {}",
  "modules/hospital-info/hospital-info.service.ts :: } catch { }",
  "modules/media/media.service.ts :: } catch {",
  "modules/registration-consent/registration-consent.service.ts :: void this.fcmPush?.pushPatientNotification(pn.id).catch(() => undefined);",
  "modules/satisfaction/satisfaction.service.ts :: }).catch(() => {});",
  "modules/sign-integration/sign-integration.service.ts :: const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;",
].sort();

describe('🔴 삼킨 실패 뒤 성공 주장(P16) — 목록 동결', () => {
  it('대조군 — 탐지기가 대표 모양을 실제로 잡는다(0 이면 스캐너가 죽은 것)', () => {
    const bad = [
      'await ensureIndex().catch(() => {});',
      "this.logger.log('trgm index ensured');",
      'try { await close(); } catch {}',
      'return { ok: true };',
    ].join('\n');
    expect(scanSwallowThenSuccess(bad)).toHaveLength(2);
  });

  it('대조군 — 실패를 로그하는 catch 는 잡지 않는다', () => {
    const good = [
      "await ensureIndex().catch((e) => this.logger.warn(`failed: ${e}`));",
      "this.logger.log('trgm index ensured');",
    ].join('\n');
    expect(scanSwallowThenSuccess(good)).toEqual([]);
  });

  it('주석 속 모양은 세지 않는다', () => {
    expect(scanSwallowThenSuccess("// x.catch(() => {});\n// this.logger.log('done');")).toEqual([]);
  });

  it('API 소스의 자리가 BASELINE 목록과 정확히 같다(늘면 실패 · 줄면 목록에서 지운다)', () => {
    const hits = scanTree();
    expect(hits.length).toBeGreaterThan(0); // 하한 — 대상이 0 이면 조준이 빗나간 것이다
    expect(hits).toEqual(BASELINE);
  });

  it('동작 — CRM 이메일: 설정 조회 실패는 "미설정 시뮬레이션 성공"이 아니라 실패다', async () => {
    const prisma = { systemConfig: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } };
    const svc = new CrmChannelService(prisma as never, { effective: async () => 'REAL' } as never);
    const r = await svc.send('EMAIL', 'a@b.c', 's', 'c');
    expect(r.success).toBe(false);
    expect(r.simulated).not.toBe(true);
    expect(r.error).toBe('SMTP_CONFIG_LOOKUP_FAILED');
  });

  it('동작 — CRM 이메일 대조군: 설정이 없으면 종전대로 시뮬레이션(성공+simulated)', async () => {
    const prisma = { systemConfig: { findUnique: vi.fn().mockResolvedValue(null) } };
    const svc = new CrmChannelService(prisma as never, { effective: async () => 'REAL' } as never);
    const r = await svc.send('EMAIL', 'a@b.c', 's', 'c');
    expect(r).toMatchObject({ success: true, simulated: true });
  });

  it('동작 — 상담 종료: 기록이 실패하면 ok 라고 말하지 않는다(없는 세션은 404)', async () => {
    const mk = (err: unknown) => new ConsultService(
      { consultSession: { update: vi.fn().mockRejectedValue(err) } } as never,
      {} as never, { get: vi.fn() } as never, {} as never,
    );
    await expect(mk(Object.assign(new Error('no row'), { code: 'P2025' })).closeSession('x')).rejects.toThrow(NotFoundException);
    await expect(mk(new Error('db down')).closeSession('x')).rejects.toThrow('db down');
  });

  it('동작 — 상담 종료 대조군: 정상이면 ok:true', async () => {
    const svc = new ConsultService(
      { consultSession: { update: vi.fn().mockResolvedValue({}) } } as never,
      {} as never, { get: vi.fn() } as never, {} as never,
    );
    await expect(svc.closeSession('x')).resolves.toMatchObject({ ok: true });
  });

  it('동작 — 합동 의결 매핑 조회 실패는 PASS 로 떨어지지 않는다(사람 확인 사유)', async () => {
    const rule = [{ standardKind: 'PATHWAY', standardCode: RULE_SCOPE_ALL, requireAll: true, actions: { ENACT: 'COMMITTEE' }, requireBasis: [], reviewCycleM: null, gateMode: 'WARN', delegationRef: null }];
    const prisma = {
      standardGovernanceRule: { findMany: vi.fn().mockResolvedValue(rule) },
      committeeDecision: { findUnique: vi.fn().mockResolvedValue({ decisionNo: 'G', status: 'ENACTED', actions: [] }) },
      committeeSurfaceMap: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
    };
    const v = await new StandardGovernanceService(prisma as never)
      .evaluate({ kind: 'PATHWAY', code: 'CP-A', action: 'ENACT', decisionNo: 'G' });
    expect(v.reasons.join()).toContain('조회하지 못했습니다');
    expect(v.level).not.toBe('PASS');
  });

  it('동작 — 응급 자동 종결: 임계 설정 조회 실패는 "0=OFF" 가 아니라 건너뜀이다(warn)', async () => {
    const warn = vi.fn();
    const svc = new EmergencyService(
      { emergencyVisit: { findMany: vi.fn().mockResolvedValue([{ id: 'v1', disposition: null }]), update: vi.fn() } } as never,
      ...([] as never[]),
    );
    (svc as unknown as { config: unknown }).config = { get: vi.fn().mockRejectedValue(new Error('db down')) };
    (svc as unknown as { logger: unknown }).logger = { warn, log: vi.fn(), error: vi.fn() };
    const r = await svc.autoCloseStaleVisits();
    expect(r).toMatchObject({ closed: 0, hours: null, skipped: 'CONFIG_LOOKUP_FAILED' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('동작 — 응급 자동 종결 대조군: 설정이 없으면(0) 종전대로 hours 0·건너뜀(warn 없음)', async () => {
    const warn = vi.fn();
    const svc = new EmergencyService({ emergencyVisit: { findMany: vi.fn(), update: vi.fn() } } as never, ...([] as never[]));
    (svc as unknown as { config: unknown }).config = { get: vi.fn().mockResolvedValue(null) };
    (svc as unknown as { logger: unknown }).logger = { warn, log: vi.fn(), error: vi.fn() };
    await expect(svc.autoCloseStaleVisits()).resolves.toEqual({ closed: 0, hours: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('교정한 확정 결함 3곳(+emergency·voucher-cron)이 되살아나지 않는다', () => {
    const read = (p: string) => stripComments(fs.readFileSync(path.join(API_SRC, p), 'utf8')) as string;
    expect(read('modules/crm/crm-channel.service.ts')).not.toMatch(/key:\s*'smtp\.config'[\s\S]{0,40}\}\)\.catch\(\(\)\s*=>\s*null\)/);
    expect(read('modules/consult/consult.service.ts')).not.toMatch(/status:\s*'CLOSED'\s*\}\s*\}\)\.catch\(/);
    expect(read('modules/gld/standard-governance.service.ts')).not.toMatch(/committeeSurfaceMap\.findMany\([\s\S]{0,200}?\}\)\.catch\(\(\)\s*=>\s*\[\]\)/);
    expect(read('modules/emergency/emergency.service.ts')).not.toMatch(/staleVisitAutoCloseHours'\)\.catch\(/);
    expect(read('modules/voucher/voucher-cron.service.ts')).not.toMatch(/chainValid:\s*r\.valid\s*\},?\s*\}\)\.catch\(/);
  });
});
