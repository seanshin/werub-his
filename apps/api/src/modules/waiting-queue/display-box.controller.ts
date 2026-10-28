import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * TV 박스(설치 단말) 구성 조회 — **의도된 공개 EP**(D9).
 * 단말엔 `/display/box/<key>` 한 줄만 설정하고, 무엇을 틀지는 서버가 정한다.
 * - 반환은 **보드 구성만**(PHI 0) — 화면 데이터는 각 보드의 기존 공개 표면에서 따로 가져온다.
 * - 비활성 키는 401(폐기된 단말 차단) · 호출 시 lastUsedAt 갱신 = **공개 보드에도 생존 신호가 생긴다**.
 */
@ApiTags('Display Box (Public)')
@Controller('api/v1/displays/box')
export class DisplayBoxController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':key')
  @ApiOperation({ summary: '박스 구성 조회(공개) — boardType·config. 비활성 키는 401' })
  async getBox(@Param('key') key: string) {
    const box = await this.prisma.displayApiKey.findUnique({ where: { key } });
    if (!box || !box.isActive) {
      throw new UnauthorizedException({ code: 'INVALID_DISPLAY_KEY', message: '등록되지 않았거나 비활성화된 단말입니다.' });
    }
    // 생존 신호(fire-and-forget) — 관리 화면의 '마지막 접속'
    this.prisma.displayApiKey.update({ where: { id: box.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { data: { name: box.name, boardType: box.boardType, config: box.config ?? {} } };
  }
}
