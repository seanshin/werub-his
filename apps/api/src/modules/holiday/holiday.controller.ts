import { Controller, Get, Post, Body, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { requireDateParam } from '../../common/day-range';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HolidayService } from './holiday.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SyncHolidayDto, AddHospitalHolidayDto } from './dto/holiday.dto';

@ApiTags('Holiday Calendar')
@Controller('api/v1/holidays')
export class HolidayController {
  constructor(private readonly service: HolidayService) {}

  @Get()
  @ApiOperation({ summary: '공휴일 목록 조회 (공개)' })
  async getHolidays(@Query('year') year?: string) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { data: await this.service.getHolidays(y) };
  }

  @Get('check')
  @ApiOperation({ summary: '특정 날짜 공휴일 여부 (공개)' })
  async checkHoliday(@Query('date') date: string) {
    // 🔴 무검증이라 `Invalid Date.toISOString()` 이 **RangeError → 500** 을 냈다(운영 실측).
    //    이 EP 는 공개다 — 잘못된 입력으로 서버 오류를 내보이지 않는다.
    const d = requireDateParam(date, '확인할 날짜');
    const isHoliday = await this.service.isHoliday(d);
    const name = isHoliday ? await this.service.getHolidayName(d) : null;
    return { data: { date, isHoliday, name } };
  }

  @Get('business-days')
  @ApiOperation({ summary: '영업일 목록 (공개)' })
  async getBusinessDays(@Query('count') count?: string) {
    const days = await this.service.getBusinessDays(new Date(), parseInt(count ?? '5'));
    return { data: days.map(d => d.toISOString().slice(0, 10)) };
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'data.go.kr API 동기화 (관리자)' })
  async syncFromApi(@Body() body: SyncHolidayDto) {
    const year = body.year ?? new Date().getFullYear();
    return { data: await this.service.syncFromApi(year) };
  }

  @Post('hospital')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '병원 자체 휴무 추가 (관리자)' })
  async addHospitalHoliday(@Body() body: AddHospitalHolidayDto) {
    return { data: await this.service.addHospitalHoliday(new Date(body.date), body.name) };
  }
}
