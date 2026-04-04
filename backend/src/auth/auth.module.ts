import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Admin } from '../entities/admin.entity';
import { User } from '../entities/user.entity';
import { Otp } from '../entities/otp.entity';
import { JwtStrategy } from './jwt.strategy';
import { SeederService } from './seeder.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Admin, User, Otp]),
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret:
          process.env.JWT_SECRET || 'super-secret-key-change-in-production',
        signOptions: { expiresIn: '1d' },
      }),
    }),
    SmsModule,
  ],
  providers: [AuthService, JwtStrategy, SeederService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
