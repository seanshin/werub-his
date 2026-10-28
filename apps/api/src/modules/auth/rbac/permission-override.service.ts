import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Permission } from './permission.types';

/**
 * 역할×권한 오버라이드 — 관리 화면에서 조정한 값을 코드 기본값 **위에** 얹는다.
 *
 * 왜 필요한가: 기본 매트릭스는 코드 상수라 배포 없이는 못 바꾼다. 병원마다 원무·간호의 업무 경계가
 * 다르고("우리는 간호가 수납도 본다"), 사고 대응으로 특정 역할 권한을 즉시 회수해야 할 때도 있다.
 *
 * 🔴 판정은 **동기**여야 한다(RolesGuard 가 동기) → DB 값을 메모리에 캐시하고 변경 시 갱신한다.
 * 🔴 ADMIN 은 오버라이드 대상에서 제외한다 — 관리자 권한을 스스로 꺼서 잠기는 사고를 막는다.
 */
export type OverrideMap = Partial<Record<UserRole, Partial<Record<string, boolean>>>>;

const CONFIG_KEY = 'rbac.roleOverrides';
const CONFIG_CATEGORY = 'access';

@Injectable()
export class PermissionOverrideService implements OnModuleInit {
  private readonly logger = new Logger(PermissionOverrideService.name);
  private cache: OverrideMap = {};

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload().catch((e) => this.logger.warn(`권한 오버라이드 로드 실패(기본값으로 동작): ${e.message}`));
  }

  /** 동기 판정용 — undefined 면 오버라이드 없음(코드 기본값 사용) */
  get(role: UserRole, permission: Permission | string): boolean | undefined {
    if (role === UserRole.ADMIN) return undefined; // 관리자 잠금 방지
    return this.cache[role]?.[permission as string];
  }

  all(): OverrideMap {
    return this.cache;
  }

  async reload(): Promise<OverrideMap> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    this.cache = (row?.value as OverrideMap) ?? {};
    return this.cache;
  }

  /** allow=null 이면 오버라이드 해제(기본값으로 복귀) */
  async set(role: UserRole, permission: string, allow: boolean | null, updatedBy?: string): Promise<OverrideMap> {
    if (role === UserRole.ADMIN) throw new Error('관리자 역할은 오버라이드할 수 없습니다(잠금 방지)');
    const next: OverrideMap = JSON.parse(JSON.stringify(this.cache));
    const forRole = { ...(next[role] ?? {}) };
    if (allow === null) delete forRole[permission];
    else forRole[permission] = allow;
    if (Object.keys(forRole).length) next[role] = forRole;
    else delete next[role];
    await this.persist(next, updatedBy);
    return this.cache;
  }

  /** 역할 전체(또는 전부) 초기화 */
  async reset(role?: UserRole): Promise<OverrideMap> {
    const next: OverrideMap = role ? JSON.parse(JSON.stringify(this.cache)) : {};
    if (role) delete next[role];
    await this.persist(next);
    return this.cache;
  }

  private async persist(next: OverrideMap, updatedBy?: string) {
    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: next as object, category: CONFIG_CATEGORY, label: '역할별 권한 오버라이드(관리 화면)' },
      update: { value: next as object, ...(updatedBy ? { updatedBy } : {}) },
    });
    this.cache = next;
  }
}
