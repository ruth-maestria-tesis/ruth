import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthUser } from '../common/types/auth-user';
import { UsersService } from '../users/users.service';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from './auth.constants';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto.email, dto.password);
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.refresh(this.refreshCookie(req));
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie(req));
    res.clearCookie(ACCESS_COOKIE, this.cookieOptions('/'));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(REFRESH_COOKIE_PATH));
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.users.findById(user.id) };
  }

  @Patch('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  private refreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
  }

  private cookieOptions(path: string): CookieOptions {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>(
      'COOKIE_SAME_SITE',
      'lax',
    );
    return {
      httpOnly: true,
      // Browsers reject SameSite=None cookies that are not Secure.
      secure:
        this.config.get<string>('NODE_ENV') === 'production' ||
        sameSite === 'none',
      sameSite,
      path,
    };
  }

  private setCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    res.cookie(ACCESS_COOKIE, accessToken, {
      ...this.cookieOptions('/'),
      maxAge: this.auth.accessTtlSeconds * 1000,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(REFRESH_COOKIE_PATH),
      maxAge: this.auth.refreshTtlDays * 86_400_000,
    });
  }
}
