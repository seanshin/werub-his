import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';
import { IsString, MaxLength, IsOptional, IsBoolean, IsIn, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * TV 디스플레이 운영 키 관리(P0.5·outpatient-clinic-queue-tv-board.plan.md D8).
 * 🔴 종전엔 DisplayApiKey 모델만 있고 발급/목록/폐기 경로가 0 — 키 수명주기 관리 신설.
 * - 키는 발급 응답에서 1회만 전체 노출, 목록에선 앞 8자만(마스킹).
 * - 폐기 대신 비활성(이력 보존)·lastUsedAt=단말 생존 신호(validateApiKey 가 갱신).
 */

class CreateDisplayKeyDto {
  @IsString() @MaxLength(100)
  name!: string; // 설치 위치 라벨 (예: "3층 내과 복도 TV")
}
class UpdateDisplayKeyDto {
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
  /**
   * 박스 바인딩(D9) — 단말이 틀 보드. null 지정=미지정으로 되돌림.
   * 🔴 목록이 `/display/*` 실재 보드와 어긋나면 안 된다 — 검진 대기 보드(`/display/checkup`)는
   *    공개 화면으로 살아 있는데 이 목록에 없어서 **어떤 단말에도 지정할 수 없었다**(W9).
   *    값 하나를 빠뜨리면 서버가 400 을 던져 세팅 화면이 이유 없이 저장에 실패한다.
   */
  @IsOptional() @IsIn(['clinic-queue', 'er-flow', 'waiting', 'checkup', null] as unknown as string[])
  boardType?: string | null;
  /** { departments: string[], tts: boolean } — 보드별 구성 */
  @IsOptional() @IsObject()
  config?: Record<string, unknown>;
}

@ApiTags('Display Keys (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/displays/keys')
export class DisplayKeysAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '디스플레이 운영 키 목록 — 키는 앞 8자 마스킹·마지막 접속(생존 신호) 포함' })
  async list() {
    const keys = await this.prisma.displayApiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return {
      data: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: `${k.key.slice(0, 8)}…`,
        boardType: k.boardType,
        config: k.config,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '박스 상세(세팅 화면) — 박스 URL 조립용 전체 키 포함(ADMIN 전용)' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const k = await this.prisma.displayApiKey.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('키를 찾을 수 없습니다');
    return { data: { id: k.id, name: k.name, key: k.key, boardType: k.boardType, config: k.config, isActive: k.isActive, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt } };
  }

  @Post()
  @ApiOperation({ summary: '키 발급 — 응답에서 1회만 전체 키 노출(이후 마스킹)' })
  async create(@Body() dto: CreateDisplayKeyDto, @CurrentUser('id') userId: string) {
    const key = randomBytes(24).toString('hex');
    const created = await this.prisma.displayApiKey.create({
      data: { key, name: dto.name.trim(), createdBy: userId },
    });
    return { data: { id: created.id, name: created.name, key, createdAt: created.createdAt } };
  }

  @Patch(':id')
  @ApiOperation({ summary: '키 라벨 변경·비활성/재활성 (폐기 대신 비활성 — 이력 보존)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDisplayKeyDto) {
    const existing = await this.prisma.displayApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('키를 찾을 수 없습니다');
    const updated = await this.prisma.displayApiKey.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.boardType !== undefined ? { boardType: dto.boardType || null } : {}),
        ...(dto.config !== undefined ? { config: dto.config as never } : {}),
      },
    });
    return { data: { id: updated.id, name: updated.name, isActive: updated.isActive, boardType: updated.boardType, config: updated.config } };
  }
}
