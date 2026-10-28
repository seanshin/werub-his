import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { hashClientSecret } from '../smart-auth/smart-secret.util';

/**
 * 🔴 응답에서 `clientSecret` 을 제외하는 공용 select.
 * 저장값은 해시지만 **자격증명 해시를 API 로 내보내지 않는다**(오프라인 대입 표면·과거 HS256 서명키였던 값).
 * 평문은 발급(create) 응답에서 1회만 반환한다.
 */
const PUBLIC_SELECT = {
  id: true, clientId: true, name: true, orgId: true, scopes: true,
  redirectUris: true, launchUrl: true, isActive: true, lastUsedAt: true, createdAt: true,
} as const;

@Injectable()
export class SmartClientService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.smartClient.findMany({ orderBy: { createdAt: 'desc' }, select: PUBLIC_SELECT });
  }

  async create(dto: { name: string; scopes?: string[]; orgId?: string; redirectUris?: string[]; launchUrl?: string | null }) {
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex');
    // 시크릿은 해시로만 저장 — 평문 미보관(DB 유출 시 자격증명 복원 차단). 원문은 발급 응답에서 1회만 반환.
    const client = await this.prisma.smartClient.create({
      select: PUBLIC_SELECT,
      data: {
        clientId,
        clientSecret: hashClientSecret(clientSecret),
        name: dto.name,
        scopes: dto.scopes ?? [],
        orgId: dto.orgId,
        redirectUris: dto.redirectUris ?? [],
        launchUrl: dto.launchUrl || null,
      },
    });
    return { ...client, clientSecret };
  }

  /** 부분 수정 — 보낸 필드만 갱신. launchUrl 을 빈 값으로 보내면 런처에서 내린다(null). */
  async update(id: string, dto: { name?: string; scopes?: string[]; redirectUris?: string[]; launchUrl?: string | null }) {
    const client = await this.prisma.smartClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('클라이언트를 찾을 수 없습니다');
    return this.prisma.smartClient.update({
      where: { id },
      select: PUBLIC_SELECT,
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
        ...(dto.redirectUris !== undefined ? { redirectUris: dto.redirectUris } : {}),
        ...(dto.launchUrl !== undefined ? { launchUrl: dto.launchUrl || null } : {}),
      },
    });
  }

  async toggle(id: string) {
    const client = await this.prisma.smartClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('클라이언트를 찾을 수 없습니다');
    return this.prisma.smartClient.update({
      where: { id },
      select: PUBLIC_SELECT,
      data: { isActive: !client.isActive },
    });
  }

  async remove(id: string) {
    const client = await this.prisma.smartClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('클라이언트를 찾을 수 없습니다');
    return this.prisma.smartClient.delete({ where: { id }, select: PUBLIC_SELECT });
  }
}
