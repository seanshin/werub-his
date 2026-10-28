import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FEATURE_REGISTRY, FEATURE_MAP, FeatureDef } from './feature-registry';

const VALID_ROLES = new Set<string>(Object.values(UserRole));

export interface FeatureAccessConfig {
  /** 역할별 허용 매트릭스. 미설정/빈객체면 defaultRoles 기준선 사용 */
  roles?: Record<string, boolean>;
  /** 역할과 무관하게 명시 허용한 사용자 (deny보다 약함) */
  grants?: string[];
  /** 명시 차단한 사용자 (최우선) */
  denies?: string[];
}

const CATEGORY = 'feature-access';
const keyOf = (featureKey: string) => `feature-access.config.${featureKey}`;

@Injectable()
export class FeatureAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** 기능 카탈로그 (코드 SoT) */
  getFeatures(): FeatureDef[] {
    return FEATURE_REGISTRY;
  }

  /**
   * 진입 판정 — 모든 가드가 호출하는 단일 경로.
   *  규칙1 ADMIN 항상 허용(자기잠금 방지)
   *  규칙2 deny 최우선 차단
   *  규칙3 grant 허용
   *  규칙4 roles 매트릭스 명시
   *  규칙5 미설정 시 defaultRoles 기준선
   */
  async can(userId: string, userRole: string, featureKey: string): Promise<boolean> {
    if (userRole === 'ADMIN') return true;
    const def = FEATURE_MAP.get(featureKey);
    if (!def) return false;
    const cfg = await this.getConfig(featureKey);
    if (userId && cfg.denies?.includes(userId)) return false;
    if (userId && cfg.grants?.includes(userId)) return true;
    if (cfg.roles && Object.keys(cfg.roles).length > 0) return cfg.roles[userRole] === true;
    return def.defaultRoles.includes(userRole);
  }

  /**
   * 명시 차단 여부. 자체가드(ConsultAgentGuard·CredentialGuard)가 기존 허용 로직 "이전"에 호출 →
   * 차단 목록의 사용자는 등록/권한과 무관하게 즉시 거부(즉시 회수).
   */
  async isDenied(featureKey: string, userId: string): Promise<boolean> {
    if (!userId) return false;
    const cfg = await this.getConfig(featureKey);
    return cfg.denies?.includes(userId) ?? false;
  }

  /**
   * 명시적 추가 허용 여부 — grant 목록 또는 명시 역할 오버라이드(관리자가 직접 설정한 경우만).
   * defaultRoles 기준선은 포함하지 않는다 → 자체가드의 기존 기본동작을 바꾸지 않고,
   * 관리자가 매트릭스에서 명시 설정했을 때만 추가 허용 경로로 작동.
   */
  async isExplicitlyAllowed(featureKey: string, userId: string, userRole: string): Promise<boolean> {
    const cfg = await this.getConfig(featureKey);
    if (userId && cfg.grants?.includes(userId)) return true;
    if (cfg.roles && Object.keys(cfg.roles).length > 0) return cfg.roles[userRole] === true;
    return false;
  }

  /** 단일 기능 오버라이드 조회 (없으면 빈객체 = 기준선 동작) */
  async getConfig(featureKey: string): Promise<FeatureAccessConfig> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: keyOf(featureKey) } });
    return ((row?.value as FeatureAccessConfig) ?? {}) as FeatureAccessConfig;
  }

  /** 매트릭스 전체 (FE 탭). 쿼리 1회 */
  async listMatrix(): Promise<{ features: FeatureDef[]; configs: Record<string, FeatureAccessConfig> }> {
    const rows = await this.prisma.systemConfig.findMany({ where: { category: CATEGORY } });
    const byKey = new Map(rows.map((r) => [r.key, r.value as FeatureAccessConfig]));
    const configs: Record<string, FeatureAccessConfig> = {};
    for (const f of FEATURE_REGISTRY) configs[f.key] = byKey.get(keyOf(f.key)) ?? {};
    return { features: FEATURE_REGISTRY, configs };
  }

  /** 오버라이드 저장 (변경자 기록 = 기존 access-control 컨벤션) */
  async setConfig(featureKey: string, cfg: FeatureAccessConfig, updatedBy: string) {
    const def = FEATURE_MAP.get(featureKey);
    if (!def) throw new BadRequestException(`unknown feature: ${featureKey}`);
    // 정규화: 유효 역할만·boolean 값만(잘못된 타입으로 인한 lockout 방지), userId 중복 제거.
    const roles: Record<string, boolean> = {};
    for (const [role, v] of Object.entries(cfg.roles ?? {})) {
      if (VALID_ROLES.has(role)) roles[role] = v === true;
    }
    const denies = Array.from(new Set((cfg.denies ?? []).filter(Boolean)));
    const denySet = new Set(denies);
    // grant∩deny 충돌 시 deny 우선(런타임 정책과 일치) — grant에서 제거.
    const grants = Array.from(new Set((cfg.grants ?? []).filter((id) => id && !denySet.has(id))));
    const sanitized: FeatureAccessConfig = { roles, grants, denies };
    const key = keyOf(featureKey);
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value: sanitized as Prisma.InputJsonValue, updatedBy },
      create: { key, value: sanitized as Prisma.InputJsonValue, category: CATEGORY, label: `${def.label} 기능 접근 권한`, updatedBy },
    });
    return sanitized;
  }

  /** 기본값 복원 (행 삭제 → defaultRoles 기준선으로 복귀) */
  async resetConfig(featureKey: string) {
    await this.prisma.systemConfig.deleteMany({ where: { key: keyOf(featureKey) } });
  }
}
