import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles(Role.ADMIN)
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}
