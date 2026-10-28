import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SurgeryOpnoteService } from './surgery-opnote.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateOpNoteDto, UpdateOpNoteDto } from './dto/surgery-opnote.dto';

@ApiTags('Surgery Op Note (수술 기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/surgery-opnote')
export class SurgeryOpnoteController {
  constructor(private readonly service: SurgeryOpnoteService) {}

  @Get(':surgeryId')
  @ApiOperation({ summary: '수술 기록 조회' })
  async getOpNote(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getOpNote(surgeryId) };
  }

  @Post()
  @ApiOperation({ summary: '수술 기록 생성' })
  async createOpNote(
    @Body() body: CreateOpNoteDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createOpNote({ ...body, createdBy: userId }) };
  }

  @Patch(':id')
  @ApiOperation({ summary: '수술 기록 수정' })
  async updateOpNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOpNoteDto,
  ) {
    return { data: await this.service.updateOpNote(id, body) };
  }

  @Get('who-checklist/:surgeryId')
  @ApiOperation({ summary: 'WHO 수술 안전 체크리스트 조회' })
  async getWhoChecklist(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getWhoChecklist(surgeryId) };
  }
}
