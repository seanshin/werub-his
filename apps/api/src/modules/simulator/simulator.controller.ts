import { Controller, Post, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SimulatorService } from './simulator.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { StartSimulatorDto, SetSpeedDto, InjectEventDto } from './dto/simulator.dto';

@ApiTags('Simulator (병원 시뮬레이션)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/simulator')
export class SimulatorController {
  constructor(private readonly service: SimulatorService) {}

  @Post('start')
  @ApiOperation({ summary: '시뮬레이션 시작' })
  async start(@Body() dto: StartSimulatorDto) {
    return { ok: true, data: await this.service.start(dto) };
  }

  @Post('stop')
  @ApiOperation({ summary: '시뮬레이션 중지' })
  stop() {
    return { ok: true, data: this.service.stop() };
  }

  @Post('pause')
  @ApiOperation({ summary: '시뮬레이션 일시정지' })
  pause() {
    return { ok: true, data: this.service.pause() };
  }

  @Post('resume')
  @ApiOperation({ summary: '시뮬레이션 재개' })
  resume() {
    return { ok: true, data: this.service.resume() };
  }

  @Get('status')
  @ApiOperation({ summary: '시뮬레이션 현재 상태' })
  getStatus() {
    return { ok: true, data: this.service.getStatus() };
  }

  @Patch('speed')
  @ApiOperation({ summary: '시뮬레이션 속도 변경' })
  setSpeed(@Body() dto: SetSpeedDto) {
    return { ok: true, data: this.service.setSpeed(dto.speed) };
  }

  @Post('inject')
  @ApiOperation({ summary: '이벤트 수동 주입 (응급 환자 추가 등)' })
  async inject(@Body() dto: InjectEventDto) {
    return { ok: true, data: await this.service.injectEvent(dto.type, dto) };
  }
}
