import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ExtensionService } from './extension.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RegisterExtensionDto } from './dto/extension.dto';

@ApiTags('Extensions (플러그인)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/extensions')
export class ExtensionController {
  constructor(private readonly extensionService: ExtensionService) {}

  // 🔴 meta.registry 는 "이 목록이 실제로 동작하는가"를 말한다(2026-08-14 W8).
  //    인메모리·렌더러 미배선이라는 사실을 응답에서 빼면 화면이 '활성'이라 거짓말한다.
  @Get()
  @ApiOperation({ summary: '전체 확장 목록 — meta.registry 에 영속/설치 여부 동봉' })
  async getAll() {
    return { data: this.extensionService.getAllExtensions(), meta: { registry: this.extensionService.registryStatus() } };
  }

  @Get('slots')
  @ApiOperation({ summary: '슬롯별 확장 목록 — meta.registry 에 영속/설치 여부 동봉' })
  async getSlots() {
    return { data: this.extensionService.getSlots(), meta: { registry: this.extensionService.registryStatus() } };
  }

  @Get('slots/:slot')
  @ApiOperation({ summary: '특정 슬롯의 확장' })
  async getForSlot(@Param('slot') slot: string) { return { data: this.extensionService.getExtensionsForSlot(slot) }; }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '확장 등록' })
  async register(@Body() dto: RegisterExtensionDto) { return { data: this.extensionService.registerExtension(dto) }; }

  @Patch(':id/toggle')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '확장 활성화/비활성화' })
  async toggle(@Param('id') id: string) { return { data: this.extensionService.toggleExtension(id) }; }
}
