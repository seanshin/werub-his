import { Body, Controller, Get, Put, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HIS_MODES, HIS_MODE_CONFIG_KEY, HIS_MODE_META, parseHisMode } from '@hospital-run/shared';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ConfigRuntimeService } from '../../modules/config/config-runtime.service';
import { HisModeService } from './his-mode.service';

/**
 * 운영 모드 조회·전환.
 *
 * 🔴 조회는 **전 직군**이 할 수 있어야 한다 — 모드 배너가 `(main)` 레이아웃에서 전 화면에 렌더되므로,
 *    여기에 `@Roles` 를 걸면 최소 권한 직군이 모든 화면에서 403 배너를 보게 된다
 *    (2026-08-21 위급검사값 배너가 정확히 그 결함이었다: 14역할 중 9역할 상시 403).
 *    전환(PUT)만 ADMIN 이다.
 */
@ApiTags('Mode (운영 모드)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/mode')
export class HisModeController {
  constructor(
    private readonly mode: HisModeService,
    private readonly config: ConfigRuntimeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '현재 운영 모드(빌드 상한·런타임 토글·실효)' })
  async get() {
    const state = await this.mode.state();
    return { data: { ...state, meta: HIS_MODE_META[state.effective], modes: HIS_MODES } };
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '운영 모드 전환 (Admin) — 빌드 상한보다 넓힐 수는 없다' })
  async set(@Body() body: { mode?: string }, @CurrentUser('id') userId: string) {
    const next = parseHisMode(body?.mode);
    if (!next) {
      throw new BadRequestException(`모드는 ${HIS_MODES.join(' · ')} 중 하나여야 합니다`);
    }
    await this.config.set(HIS_MODE_CONFIG_KEY, next, userId);
    const state = await this.mode.state();
    return {
      data: {
        ...state,
        meta: HIS_MODE_META[state.effective],
        // 🔴 넓히려 한 경우 "저장했다"로 끝내지 않는다 — 저장은 됐지만 **적용되지 않았다**는 사실을 말한다.
        notice: state.runtimeEffective
          ? null
          : `저장했지만 적용되지 않습니다 — 이 서버는 ${state.build} 빌드라 ${next} 로 넓힐 수 없습니다. ` +
            `시드 로그인 같은 기능은 빌드에 포함되지 않아 런타임으로 되살릴 수 없습니다(재배포 필요).`,
      },
    };
  }
}
