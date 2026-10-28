import { Controller, Get, Put, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardConfigService } from './dashboard-config.service';

@ApiTags('Dashboard Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/dashboard/config')
export class DashboardConfigController {
  constructor(private readonly configService: DashboardConfigService) {}

  @Get()
  @ApiOperation({ summary: '내 대시보드 레이아웃 조회' })
  async getConfig(@CurrentUser() user: any) {
    const config = await this.configService.getConfig(user.id);
    return { data: config };
  }

  @Put()
  @ApiOperation({ summary: '대시보드 레이아웃 저장' })
  async saveConfig(@CurrentUser() user: any, @Body() body: any) {
    const config = await this.configService.saveConfig(user.id, body);
    return { data: config };
  }

  @Delete()
  @ApiOperation({ summary: '대시보드 레이아웃 초기화 (기본값으로)' })
  async resetConfig(@CurrentUser() user: any) {
    await this.configService.resetConfig(user.id);
    return { data: null, meta: { message: '기본 레이아웃으로 초기화되었습니다' } };
  }
}
