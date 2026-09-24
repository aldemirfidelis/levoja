import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Client, ClientInfo, CurrentUser, Public } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaDisableDto,
  MfaLoginDto,
  RefreshDto,
  RegisterCompanyDto,
  RegisterCustomerDto,
  RegisterDriverDto,
  ResetPasswordDto,
  VerificationChannelDto,
  VerifyCodeDto,
} from './auth.dto';

/** Limite mais rígido para rotas sensíveis a força bruta (configurável por ambiente). */
const AUTH_LIMIT = { default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10), ttl: 60_000 } };

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register/customer')
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Cadastro de cliente' })
  registerCustomer(@TenantId() tenantId: string, @Body() dto: RegisterCustomerDto, @Client() client: ClientInfo) {
    return this.auth.registerCustomer(tenantId, dto, client);
  }

  @Public()
  @Post('register/driver')
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Cadastro de entregador (inicia o processo de aprovação)' })
  registerDriver(@TenantId() tenantId: string, @Body() dto: RegisterDriverDto, @Client() client: ClientInfo) {
    return this.auth.registerDriver(tenantId, dto, client);
  }

  @Public()
  @Post('register/company')
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Cadastro de empresa + usuário responsável' })
  registerCompany(@TenantId() tenantId: string, @Body() dto: RegisterCompanyDto, @Client() client: ClientInfo) {
    return this.auth.registerCompany(tenantId, dto, client);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Login com e-mail ou telefone e senha' })
  login(@TenantId() tenantId: string, @Body() dto: LoginDto, @Client() client: ClientInfo) {
    return this.auth.login(tenantId, dto, client);
  }

  @Public()
  @Post('mfa/login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Segunda etapa do login (código do autenticador)' })
  mfaLogin(@Body() dto: MfaLoginDto, @Client() client: ClientInfo) {
    return this.auth.loginWithMfa(dto.mfaToken, dto.code, client, dto.app);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renovar tokens (rotação de refresh token)' })
  refresh(@Body() dto: RefreshDto, @Client() client: ClientInfo) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerrar a sessão do refresh token informado' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerrar todas as sessões' })
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Solicitar link de redefinição de senha' })
  async forgot(@TenantId() tenantId: string, @Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(tenantId, dto.email, dto.portal);
    return { message: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Definir nova senha (redefinição ou convite)' })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
  }

  @ApiBearerAuth()
  @Post('password/change')
  @HttpCode(204)
  async change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Usuário autenticado, papéis, permissões e perfis' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user, id);
  }

  @ApiBearerAuth()
  @Post('verification/send')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Enviar código de verificação de e-mail ou telefone' })
  async sendVerification(@CurrentUser() user: AuthUser, @Body() dto: VerificationChannelDto) {
    await this.auth.sendVerification(user, dto.channel);
  }

  @ApiBearerAuth()
  @Post('verification/confirm')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async confirmVerification(@CurrentUser() user: AuthUser, @Body() dto: VerifyCodeDto) {
    await this.auth.confirmVerification(user, dto.channel, dto.code);
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  @ApiOperation({ summary: 'Iniciar configuração da verificação em duas etapas (TOTP)' })
  setupMfa(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user);
  }

  @ApiBearerAuth()
  @Post('mfa/enable')
  @HttpCode(204)
  async enableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    await this.auth.enableMfa(user, dto.code);
  }

  @ApiBearerAuth()
  @Post('mfa/disable')
  @HttpCode(204)
  async disableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaDisableDto) {
    await this.auth.disableMfa(user, dto.password, dto.code);
  }
}
