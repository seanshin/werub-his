import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TextMacroService } from './text-macro.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTextMacroDto } from './dto/text-macro.dto';

@ApiTags('Text Macros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/text-macros')
export class TextMacroController {
  constructor(private readonly service: TextMacroService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '텍스트 매크로 생성' })
  async create(@Body() dto: CreateTextMacroDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create(dto, userId) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '매크로 목록' })
  async findAll(@CurrentUser('id') userId: string, @Query('category') category?: string) {
    return { data: await this.service.findAll(userId, category) };
  }

  @Get('expand/:shortcut')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '매크로 확장' })
  async expand(@Param('shortcut') shortcut: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.expand(shortcut, userId) };
  }

  @Delete(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '매크로 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    await this.service.remove(id, userId);
    return { data: { deleted: true } };
  }
}
