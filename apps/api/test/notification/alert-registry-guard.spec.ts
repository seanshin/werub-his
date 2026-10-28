/**
 * 🔴 경보 등록부 가드 — 기획서 `alert-registry.plan.md` §6.
 *
 * ① 등재 3조건(tier·targetKind·actionHref)이 없는 항목은 등록부에 있을 수 없다.
 * ② 코드에서 리터럴로 발화되는 직원 경보 코드는 **전부 등재**돼 있어야 한다(등록부 ⊇ 실제 발화 어휘) —
 *    재주입: `notify(userId, { type: 'NEW_ALERT', … })` 를 어딘가에 넣으면 이 파일이 실패한다.
 * ③ 미등재 발화는 **막히지 않는다**(막으면 실패) — 세어질 뿐이다.
 * ④ 등재 코드는 호출자가 severity 를 안 주면 tier 로 채운다 · 준 값이 있으면 그것이 우선한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { alertSnapshot } from '../../src/modules/notification/alert-approval';
import * as fs from 'fs';
import * as path from 'path';
import { ALERT_REGISTRY, lookupAlert, tierToSeverity } from '../../src/modules/notification/alert-registry';
import { NotificationService } from '../../src/modules/notification/notification.service';

const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(full);
  }
  return out;
};

describe('등록부 자체 — 등재 3조건·유일성', () => {
  it('코드가 유일하고, 항목마다 tier·targetKind·actionHref·emitters 가 있다', () => {
    const codes = ALERT_REGISTRY.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of ALERT_REGISTRY) {
      expect([1, 2, 3, 4], `${d.code}: tier`).toContain(d.tier);
      expect(['ATTENDING', 'ROLE', 'ASSIGNEE', 'BROADCAST', 'PATIENT'], `${d.code}: targetKind`).toContain(d.targetKind);
      expect(d.actionHref, `${d.code}: actionHref(무엇을 하면 꺼지는가 — 없으면 등재 불가)`).toMatch(/^\//);
      expect(d.emitters.length, `${d.code}: 발화 지점`).toBeGreaterThan(0);
      if (d.targetKind === 'ROLE') expect(d.targetRoles.length, `${d.code}: ROLE 인데 대상 역할이 없다(대상 없음은 그 자체가 경보다)`).toBeGreaterThan(0);
      expect(d.reviewDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('P0 는 인구조사다 — 승인된 항목이 하나라도 있으면 사람 게이트를 거쳤는지 이 주석을 갱신하라', () => {
    // 승인이 들어오면 이 단언을 지우고 approvedBy 값 검증으로 바꾼다(2026-08-19 기준 전부 UNAPPROVED)
    expect(ALERT_REGISTRY.every((d) => d.approvedBy === 'UNAPPROVED')).toBe(true);
    expect(ALERT_REGISTRY.length).toBeGreaterThanOrEqual(60);
  });
});

describe('등록부 ⊇ 실제 발화 어휘 — 코드에서 리터럴로 발화되는 직원 경보는 전부 등재돼 있다', () => {
  it('미등재 리터럴 코드 0건', () => {
    const registered = new Set(ALERT_REGISTRY.map((d) => d.code));
    const found = new Map<string, string>(); // code → 위치
    const callRe = /(?:notif\w*|notification\w*|notificationService|this\.notify|prisma\.notification)\??\.(?:notify|notifyMany|notifyRole|notifyRoles|notifyUsers|create|createMany|broadcast)\(/g;
    for (const f of walk(MODULES)) {
      const rel = path.relative(MODULES, f);
      if (rel.startsWith('notification/notification.service.ts')) continue;
      const src = fs.readFileSync(f, 'utf8');
      // 환자 알림(PatientNotification·portal 리마인더)은 이 등록부 밖(비목표 — 별도 어휘)
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(src))) {
        const seg = src.slice(m.index, m.index + 700);
        const t = /type:\s*'([A-Z][A-Z_]{2,})'/.exec(seg);
        if (t && !registered.has(t[1])) found.set(t[1], `${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
      // 래퍼 경유: notifyUser(userId, 'CODE', …) / notifyDoctor(id, { type: 'CODE' }) — 운영 DB 미등재 관찰로 스캔 누락이 드러난 자리
      for (const mm of src.matchAll(/\bnotify\w*\(\s*[^,()]+,\s*'([A-Z][A-Z_]{2,})'/g)) {
        if (!registered.has(mm[1])) found.set(mm[1], `${rel}:${src.slice(0, mm.index).split('\n').length}`);
      }
      // 리스너 @OnEvent 본문의 type 리터럴
      if (rel === 'notification/notification.listener.ts') {
        for (const mm of src.matchAll(/type:\s*'([A-Z][A-Z_]{2,})'/g)) {
          if (!registered.has(mm[1])) found.set(mm[1], `${rel}:${src.slice(0, mm.index).split('\n').length}`);
        }
      }
    }
    // 정적 상수로 넘기는 코드(SurgerySafetyCron.NOTIFICATION_TYPE 등)는 등록부에 직접 적혀 있어야 한다
    expect(lookupAlert('SURGERY_SAFETY_DIGEST')).not.toBeNull();
    expect([...found.entries()].map(([c, at]) => `${c} @ ${at}`), '등록부에 없는 경보 코드가 발화된다 — alert-registry.ts 에 등재하라').toEqual([]);
  });
});

describe('NotificationService × 등록부', () => {
  const mk = () => {
    const prisma: any = { notification: { create: vi.fn(async ({ data }: any) => ({ id: 'n1', ...data })) } };
    return { s: new NotificationService(prisma), prisma };
  };

  it('🔴 미등재 코드는 막히지 않는다 — 생성되고 unregistered 로 세어진다', async () => {
    const { s, prisma } = mk();
    await s.create('u1', { type: 'TOTALLY_NEW_ALERT', title: 't', message: 'm' });
    await s.create('u1', { type: 'TOTALLY_NEW_ALERT', title: 't2', message: 'm' });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    const seen = (s as any).unregistered.get('TOTALLY_NEW_ALERT');
    expect(seen.count).toBe(2);
  });

  it('등재 코드: severity 미지정이면 tier 로 채운다 · 호출자 값이 있으면 그것이 우선', async () => {
    const { s, prisma } = mk();
    await s.create('u1', { type: 'CRITICAL_VALUE', title: 't', message: 'm' });
    expect(prisma.notification.create.mock.calls[0][0].data.severity).toBe(tierToSeverity(lookupAlert('CRITICAL_VALUE')!.tier));
    await s.create('u1', { type: 'CRITICAL_VALUE', title: 't', message: 'm', severity: 'INFO' });
    expect(prisma.notification.create.mock.calls[1][0].data.severity).toBe('INFO');
    expect((s as any).unregistered.size).toBe(0);
  });

  it('registryReport: 분모(fired)와 함께 내고, DB 의 미등재 코드를 따로 낸다', async () => {
    const prisma: any = {
      notification: { create: vi.fn() },
      // 2026-10-09 승인 원장 — 하나는 지금 값으로 승인, 하나는 승인 후 코드가 바뀐 것
      alertApproval: { findMany: vi.fn().mockResolvedValue([
        { code: 'CRITICAL_VALUE', snapshot: alertSnapshot(ALERT_REGISTRY.find((d) => d.code === 'CRITICAL_VALUE')!), basis: 'QPS-2026-01 의결', approvedBy: 'u9', approvedAt: new Date('2026-10-01'), revokedAt: null },
        { code: 'GOLIVE_READY', snapshot: { tier: 1 }, basis: 'QPS-2026-01 의결', approvedBy: 'u9', approvedAt: new Date('2026-10-01'), revokedAt: null },
      ]) },
      $queryRaw: vi.fn().mockResolvedValue([
        { type: 'CRITICAL_VALUE', fired: 10n, read: 2n, median_min: 42.4, unread_over_24h: 5n },
        { type: 'LEGACY_TYPE', fired: 3n, read: 0n, median_min: null, unread_over_24h: 3n },
      ]),
    };
    const s = new NotificationService(prisma);
    const r = await s.registryReport(30);
    expect(r.unregistered.inDb.find((u) => u.code === 'LEGACY_TYPE')?.seedOnly).toBe(false);
    const cv = r.items.find((i) => i.code === 'CRITICAL_VALUE')!;
    expect(cv.fired).toBe(10); expect(cv.read).toBe(2); expect(cv.medianReadMin).toBe(42); expect(cv.unreadOver24h).toBe(5);
    const zero = r.items.find((i) => i.code === 'GOLIVE_READY')!;
    expect(zero.fired).toBe(0); // 발화 0 — 화면은 읽음률을 산출 불가로 그려야 한다(0% 가 아니다)
    expect(r.unregistered.inDb).toEqual([{ code: 'LEGACY_TYPE', fired: 3, read: 0, seedOnly: false }]);
    expect(r.summary.registered).toBe(ALERT_REGISTRY.length);
    // 🔴 승인은 원장에서 — 지금 값과 같으면 승인됨, 승인 후 바뀌었으면 재승인 필요(미승인으로 센다)
    expect(cv.approval.status).toBe('APPROVED');
    expect(zero.approval.status).toBe('CHANGED');
    expect(r.summary.unapproved).toBe(ALERT_REGISTRY.length - 1);
    expect(r.summary.changedSinceApproval).toBe(1);
    expect(r.retentionDays.unread).toBe(180);
  });
});
