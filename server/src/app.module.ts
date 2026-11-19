import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuthModule } from './auth/auth.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { FeedbackModule } from './feedback/feedback.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { envValidationSchema } from './config/env.validation';
import { DefensesModule } from './defenses/defenses.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { MinutesModule } from './minutes/minutes.module';
import { SettingsModule } from './settings/settings.module';
import { ThesesModule } from './theses/theses.module';
import { UsersModule } from './users/users.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    EventEmitterModule.forRoot(),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    // Secrets are passed per sign/verify call; global so JwtAuthGuard can inject JwtService.
    JwtModule.register({ global: true }),
    UsersModule,
    AuthModule,
    CatalogsModule,
    FilesModule,
    WorkflowModule,
    SettingsModule,
    ThesesModule,
    AssignmentsModule,
    NotificationsModule,
    SchedulerModule,
    DefensesModule,
    MinutesModule,
    FeedbackModule,
    EvaluationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
