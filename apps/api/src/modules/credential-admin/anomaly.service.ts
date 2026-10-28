import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

const BRUTE_THRESHOLD = 5; // 연속 실패 경고 임계
const LOCK_THRESHOLD_FALLBACK = 10; // 🔴 config `security.login.maxAttempts` 를 못 읽을 때만. 상수 미러를 두면 갈라진다
const OFF_HOUR_START = 0;
const OFF_HOUR_END = 6; // 00:00~05:59 비정상 시간대

// FR-52: 이상 로그인 탐지(휴리스틱) — 기존 신호(login:fail·session) 기반
@Injectable()
export class AnomalyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 잠금 임계 — auth.service 와 **같은 config 키**를 읽는다(상수 미러를 두면 갈라진다). */
  private async lockThreshold(): Promise<number> {
    const v = await this.config?.get('security.login.maxAttempts');
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : LOCK_THRESHOLD_FALLBACK;
  }

  async detect() {
    const [bruteForce, offHours] = await Promise.all([this.bruteForce(), this.offHoursLogins()]);
    return { bruteForce, offHours, generatedAt: new Date().toISOString() };
  }

  /** 연속 실패/계정잠금 (Redis login:fail:{email}) */
  private async bruteForce() {
    const lockAt = await this.lockThreshold();
    const keys = await this.redis.keys('login:fail:*');
    const out: Array<{ email: string; fails: number; locked: boolean; severity: string }> = [];
    for (const k of keys) {
      const v = await this.redis.get(k);
      const fails = v ? parseInt(v, 10) : 0;
      if (fails >= BRUTE_THRESHOLD) {
        out.push({
          email: k.replace('login:fail:', ''),
          fails,
          locked: fails >= lockAt,
          severity: fails >= lockAt ? 'high' : 'medium',
        });
      }
    }
    return out.sort((a, b) => b.fails - a.fails);
  }

  /** 비정상 시간대(심야) 최근 24h 로그인 (session 기록 기반) */
  private async offHoursLogins() {
    const keys = await this.redis.keys('session:*');
    const dayAgo = Date.now() - 86400000;
    const hits: Array<{ userId: string; at: string }> = [];
    for (const k of keys) {
      const raw = await this.redis.get(k);
      if (!raw) continue;
      try {
        const s = JSON.parse(raw);
        if (!s.createdAt) continue;
        const t = new Date(s.createdAt);
        if (t.getTime() < dayAgo) continue;
        const h = t.getHours();
        if (h >= OFF_HOUR_START && h < OFF_HOUR_END) hits.push({ userId: s.userId, at: s.createdAt });
      } catch {
        /* skip */
      }
    }
    if (!hits.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(hits.map((h) => h.userId))] } },
      select: { id: true, familyName: true, givenName: true, role: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}(${u.role})`]));
    return hits
      .map((h) => ({ ...h, name: nameOf.get(h.userId) ?? h.userId.slice(0, 8) }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }
}
