/**
 * 🔴 `prisma.systemConfig` 를 **직접 읽는** 설정 키도 관리 화면에 뜬다 — 2026-08-27.
 *
 * 기존 `defaults-coverage.spec.ts` 는 `ConfigRuntimeService.get('...')` 호출만 훑는다.
 * 그런데 설정 키를 읽는 두 번째 경로가 있다: `this.prisma.systemConfig.findUnique({ where: { key: '…' } })`.
 * 이 경로로 읽던 키 5종이 **DEFAULTS 에 없어 `/admin/settings` 에 아예 뜨지 않았고, 쓰기 경로도 없어
 * 직접 SQL 말고는 켤 방법이 없었다**:
 *   · `checkup.explainerFourEyes`      (검진 해설 감수 2인 승인 — **안전 게이트**)
 *   · `clinical.verificationFourEyes`  (임상차트 검수 2인 승인 — **안전 게이트**)
 *   · `medical_record.fee_rules`       (제증명 수수료 오버라이드)
 *   · `ward.icuNames`                  (중환자 병동 판정 패턴)
 *   · `smtp.config`                    (CRM 이메일 SMTP)
 *
 * 재주입 검증(실제로 되돌려 확인함): DEFAULTS 에서 다섯 키 중 하나라도 지우면 첫 케이스가 실패한다.
 * 대조군: 수집기가 실제로 키를 찾는지(0건이면 이 가드는 아무것도 지키지 않는다)를 함께 단언한다.
 *
 * 🔴 그리고 **등재가 동작을 바꾸면 안 된다** — 아래 두 번째 describe 가 각 소비처의
 *    "설정 행 없음" 폴백과 등재한 기본값이 같은 뜻인지 실제 코드로 대조한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { DEFAULT_ICU_WARD_PATTERNS, isIcuWard } from '../../src/modules/order/care-context';
import { DEFAULT_FEE_RULES, computeFeeWith } from '../../src/modules/medical-record-issuance/fee-rules';
import { ClinicalChartVerificationService } from '../../src/modules/clinical-chart-verification/clinical-chart-verification.service';
import { CheckupExplainerService } from '../../src/modules/checkup-explainer/checkup-explainer.service';
import { OutboundChannelService } from '../../src/modules/outbound-channel/outbound-channel.service';

const API_SRC = join(process.cwd(), 'src');

/**
 * 등재하지 않는 것이 정답인 키 — **새 키를 여기 추가하지 말 것**(등재가 정답이다).
 * `access.*` 는 `ConfigRuntimeService.getAll` 이 카테고리째 제외하고(`notIn: ['access', …]`)
 * 전용 화면 `/admin/access-control` 이 관리한다 — 범용 설정 목록에 뜨면 그 화면과 정본이 둘이 된다.
 */
const MANAGED_ELSEWHERE = new Set<string>(['access.menu.custom', 'access.menu.overrides']);

/** 키 모양 — 소문자 시작 + 점 구분(정렬어 'asc' 같은 잡음 배제) */
const KEY_SHAPE = /^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('.spec.')) out.push(p);
  }
  return out;
}

/** `systemConfig.findUnique|findFirst({ where: { key: '…' } })` 로 직접 읽는 키 → 위치 */
function directlyReadKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(API_SRC)) {
    // 설정 서비스 자신(범용 get/set)은 키가 변수라 대상이 아니다
    if (file.endsWith('config-runtime.service.ts')) continue;
    const txt = readFileSync(file, 'utf-8');
    const rel = file.slice(API_SRC.length + 1);
    for (const m of txt.matchAll(/systemConfig\.(?:findUnique|findFirst)/g)) {
      // 호출식 안(다음 400자)에서 첫 `key: '…'` 를 찾는다 — 여러 줄로 쓰인 호출도 잡힌다
      const win = txt.slice(m.index!, m.index! + 400);
      const k = /key:\s*['"]([A-Za-z_][\w.]*)['"]/.exec(win);
      if (!k || !KEY_SHAPE.test(k[1])) continue;
      const line = txt.slice(0, m.index!).split('\n').length;
      if (!found.has(k[1])) found.set(k[1], `${rel}:${line}`);
    }
  }
  return found;
}

describe('systemConfig 를 직접 읽는 키도 DEFAULTS 에 등재돼 있다', () => {
  it('🔴 직접 읽는 키는 전부 DEFAULTS 에 있다(전용 화면이 관리하는 access.* 제외)', () => {
    const used = directlyReadKeys();
    const missing = [...used.entries()]
      .filter(([k]) => !(k in DEFAULTS) && !MANAGED_ELSEWHERE.has(k))
      .map(([k, where]) => `${k}  (${where})`);
    expect(missing, '이 키는 관리 화면에 뜨지 않고 쓰기 경로도 없다 — DEFAULTS 에 등재할 것').toEqual([]);
  });

  it('대조군 — 수집기가 실제로 키를 찾는다(0건이면 이 가드는 아무것도 지키지 않는다)', () => {
    const used = directlyReadKeys();
    expect(used.size).toBeGreaterThan(3);
    // 이 경로로만 도달하는 키를 지목해 둔다(수집기가 죽으면 여기서 걸린다)
    for (const k of ['checkup.explainerFourEyes', 'clinical.verificationFourEyes', 'medical_record.fee_rules', 'ward.icuNames', 'smtp.config']) {
      expect([...used.keys()], `${k} 를 수집하지 못했다 = 스캐너가 죽었다`).toContain(k);
    }
  });

  it('제외 목록이 줄어들면 목록에서도 지운다(등재된 키가 남아 있으면 실패)', () => {
    expect([...MANAGED_ELSEWHERE].filter((k) => k in DEFAULTS)).toEqual([]);
  });

  it('등재한 5키는 설명이 비어 있지 않다 — 무엇을 정하는 값인지 화면에서 읽을 수 있어야 한다', () => {
    for (const k of ['checkup.explainerFourEyes', 'clinical.verificationFourEyes', 'medical_record.fee_rules', 'ward.icuNames', 'smtp.config']) {
      expect(DEFAULTS[k], `${k} 미등재`).toBeTruthy();
      expect(DEFAULTS[k].description.length, `${k} 설명 부실`).toBeGreaterThan(30);
    }
  });
});

/**
 * 🔴 등재는 하되 **동작을 바꾸지 않는다**.
 * 다섯 소비처는 전부 `prisma.systemConfig` 를 직접 읽으므로 DEFAULTS 등재만으로는 값이 달라지지 않는다.
 * 그래도 등재값이 코드 폴백과 **다른 뜻**이면, 관리자가 화면에서 본 값과 실제 동작이 갈라진다.
 * 그래서 각 소비처의 "설정 행 없음" 경로를 실제로 태워 등재값과 대조한다.
 */
describe('등재값 = 코드 폴백 (안전 게이트를 임의로 켜거나 끄지 않았다)', () => {
  it('🔴 clinical.verificationFourEyes — 행이 없으면 코드는 ON. 등재값도 true 이고 source 는 여전히 default', async () => {
    const prisma = {
      clinicalChartVerification: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },   // 설정 행 없음 = 지금 운영 상태
    };
    const r = await new ClinicalChartVerificationService(prisma as never).getSummary();

    expect(r.fourEyes).toBe(DEFAULTS['clinical.verificationFourEyes'].value);
    expect(r.fourEyes).toBe(true);
    // DEFAULTS 등재는 DB 행을 만들지 않는다 — "관리자가 명시 설정함"으로 둔갑하면 안 된다
    expect(r.fourEyesSource, '미설정이 "원내 설정값"으로 읽히면 안 된다').toBe('default');
  });

  it('대조군 — 명시적으로 false 를 넣으면 꺼지고 source 는 config (무조건 true 라 말하지 않는다)', async () => {
    const prisma = {
      clinicalChartVerification: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue({ key: 'clinical.verificationFourEyes', value: false }) },
    };
    const r = await new ClinicalChartVerificationService(prisma as never).getSummary();
    expect(r.fourEyes).toBe(false);
    expect(r.fourEyesSource).toBe('config');
  });

  it('🔴 checkup.explainerFourEyes — 행이 없으면 코드는 OFF. 등재값도 false(안전 게이트를 임의로 켜지 않았다)', async () => {
    const prisma = {
      checkupExplainerContent: { findMany: vi.fn().mockResolvedValue([]) },
      checkupExplainerReview: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const r = await new CheckupExplainerService(prisma as never).findAll();

    expect(r.fourEyes).toBe(DEFAULTS['checkup.explainerFourEyes'].value);
    expect(r.fourEyes).toBe(false);
  });

  it('대조군 — {"enabled":true} 로 넣으면 켜진다(설명에 적은 형태가 실제로 먹는다)', async () => {
    const prisma = {
      checkupExplainerContent: { findMany: vi.fn().mockResolvedValue([]) },
      checkupExplainerReview: { findMany: vi.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue({ key: 'checkup.explainerFourEyes', value: { enabled: true } }) },
    };
    const r = await new CheckupExplainerService(prisma as never).findAll();
    expect(r.fourEyes).toBe(true);
    expect(DEFAULTS['checkup.explainerFourEyes'].description).toContain('enabled');
  });

  it('🔴 medical_record.fee_rules — 등재값(null)은 "행 없음"과 같은 뜻이다(수수료가 바뀌지 않는다)', () => {
    const v = DEFAULTS['medical_record.fee_rules'].value;
    // 소비처 조건: `cfg && cfg.value && typeof cfg.value === 'object'` → CONFIG, 아니면 DEFAULT
    const treatedAsOverride = !!v && typeof v === 'object';
    expect(treatedAsOverride, '기본표를 값으로 박으면 저장 시 ruleSource 가 CONFIG 로 둔갑한다').toBe(false);
    // 기본표가 그대로 적용된다는 사실을 금액으로 못 박는다(코드 폴백이 조용히 바뀌면 여기서 걸린다)
    const b = computeFeeWith(DEFAULT_FEE_RULES, 'DEFAULT', 'DIAGNOSIS_CERT', 1, 1);
    expect(b.total).toBe(20000);
    expect(b.ruleSource).toBe('DEFAULT');
    // 설명이 실제 금액을 말한다 — 화면에서 "무엇이 적용 중인지" 읽을 수 있어야 한다
    expect(DEFAULTS['medical_record.fee_rules'].description).toContain('20000');
  });

  it('🔴 ward.icuNames — 등재값은 코드 폴백 목록 그대로(두 곳에 적으면 갈라진다)', () => {
    expect(DEFAULTS['ward.icuNames'].value).toEqual(DEFAULT_ICU_WARD_PATTERNS);
    const patterns = DEFAULTS['ward.icuNames'].value as string[];
    expect(isIcuWard('MICU 3병동', patterns)).toBe(true);
    expect(isIcuWard('내과 5병동', patterns)).toBe(false);   // 대조군 — 아무 병동이나 중환자로 읽지 않는다
  });

  it('🔴 smtp.config — 등재값(null)이면 발송 코드는 여전히 시뮬레이션이고 대외 발신 관제도 "안 나감"이라 말한다', async () => {
    const v = DEFAULTS['smtp.config'].value as { host?: string } | null;
    // 소비처 조건: `if (!smtpConfig || !smtpConfig.host)` → 로그만 남기는 시뮬레이션
    expect(!v || !v.host, '등재만으로 메일이 나가기 시작하면 안 된다').toBe(true);

    // 관제(/admin/outbound-channels)가 DEFAULTS 를 그대로 읽어도 "켜졌다"고 말하지 않는다
    const config = { get: async (k: string) => DEFAULTS[k]?.value ?? null };
    const { channels } = await new OutboundChannelService(config as never).list('MESSAGE');
    const smtp = channels.find((c) => c.key === 'EMAIL_SMTP')!;
    expect(smtp.effective).toBe(false);
    expect(smtp.missingConfig).toContain('smtp.config.host');

    // 비밀번호가 마스킹되지 않는다는 사실을 화면이 말한다(설정 응답 마스킹은 키 이름으로만 판정한다)
    expect(DEFAULTS['smtp.config'].description).toContain('마스킹');
  });
});
