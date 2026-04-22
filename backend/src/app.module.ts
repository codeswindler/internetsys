import { config as loadEnv } from 'dotenv';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PackagesModule } from './packages/packages.module';
import { RoutersModule } from './routers/routers.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TransactionsModule } from './transactions/transactions.module';
import { SupportModule } from './support/support.module';
import { SmsModule } from './sms/sms.module';
import { AdminsModule } from './admins/admins.module';
import { AccessPointsModule } from './access-points/access-points.module';
import { Admin } from './entities/admin.entity';
import { User } from './entities/user.entity';
import { Router } from './entities/router.entity';
import { AccessPoint } from './entities/access-point.entity';
import { Package } from './entities/package.entity';
import { Subscription } from './entities/subscription.entity';
import { Voucher } from './entities/voucher.entity';
import { Transaction } from './entities/transaction.entity';
import { SupportMessage } from './entities/support-message.entity';
import { DeviceSession } from './entities/device-session.entity';
import { Permission } from './entities/permission.entity';
import { Otp } from './entities/otp.entity';

// Prefer the backend-local .env file on every process start so a simple PM2
// restart picks up updated credentials instead of reusing stale cached values.
loadEnv({
  path: resolve(process.cwd(), '.env'),
  override: true,
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '.env'),
    }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pulselynk',
      entities: [
        Admin,
        User,
        Router,
        AccessPoint,
        Package,
        Subscription,
        Voucher,
        Transaction,
        SupportMessage,
        DeviceSession,
        Permission,
        Otp,
      ],

      synchronize: true, // Auto-create tables in development
    }),
    AuthModule,
    RoutersModule,
    PackagesModule,
    SubscriptionsModule,
    VouchersModule,
    SchedulerModule,
    TransactionsModule,
    SupportModule,
    SmsModule,
    AdminsModule,
    AccessPointsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
