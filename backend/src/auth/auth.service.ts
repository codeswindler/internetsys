import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Admin, AdminRole } from '../entities/admin.entity';
import { User } from '../entities/user.entity';
import { Otp, OtpType } from '../entities/otp.entity';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Otp) private otpRepo: Repository<Otp>,
    private jwtService: JwtService,
    private smsService: SmsService,
  ) {}

  async adminLogin(identifier: string, pass: string) {
    const admin = await this.adminRepo.findOne({
      where: [
        { email: identifier },
        { username: identifier },
        { phone: identifier },
      ],
      relations: ['permissions'],
    });
    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isMatch = await bcrypt.compare(pass, admin.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 🛡️ 2FA ENFORCEMENT
    if (admin.forceOtpLogin) {
      if (!admin.phone) {
        throw new BadRequestException('2FA is enabled but no phone number is set. Please contact a superadmin.');
      }
      // Trigger the challenge flow
      return this.requestAdminOtp(identifier, pass);
    }

    const payload = { 
      sub: admin.id, 
      email: admin.email, 
      role: admin.role,
      permissions: admin.permissions?.map(p => p.name) || []
    };
    return { 
      access_token: this.jwtService.sign(payload),
      user: { 
        id: admin.id, 
        name: admin.name, 
        role: admin.role,
        forcePasswordChange: admin.forcePasswordChange 
      }
    };
  }

  async userLogin(identifier: string, pass: string) {
    const user = await this.userRepo.findOne({
      where: [
        { phone: identifier },
        { email: identifier },
        { username: identifier },
      ],
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }
    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: user.id, phone: user.phone, role: 'user' };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, phone: user.phone },
    };
  }

  async userRegister(
    name: string,
    phone: string,
    pass: string,
    username: string,
  ) {
    const existingPhone = await this.userRepo.findOne({ where: { phone } });
    if (existingPhone) {
      throw new BadRequestException('Phone number already registered');
    }
    if (!username) throw new BadRequestException('Username is compulsory');

    const existingUser = await this.userRepo.findOne({ where: { username } });
    if (existingUser) throw new BadRequestException('Username already taken');
    const passwordHash = await bcrypt.hash(pass, 10);
    const user = this.userRepo.create({ name, phone, username, passwordHash });
    await this.userRepo.save(user);
    return this.userLogin(phone, pass); // auto login
  }

  async createInitialAdmin(email: string, pass: string) {
    const count = await this.adminRepo.count();
    if (count > 0) throw new BadRequestException('Admins already exist');
    const passwordHash = await bcrypt.hash(pass, 10);
    const admin = this.adminRepo.create({
      name: 'Super Admin',
      email,
      passwordHash,
      role: AdminRole.SUPERADMIN,
    });
    await this.adminRepo.save(admin);
    return admin;
  }

  async getAllUsers() {
    return this.userRepo.find({
      relations: [
        'subscriptions',
        'subscriptions.package',
        'subscriptions.router',
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async adminCreateUser(
    name: string,
    phone: string,
    pass: string,
    username: string,
  ) {
    const existingPhone = await this.userRepo.findOne({ where: { phone } });
    if (existingPhone)
      throw new BadRequestException('Phone number already registered');

    if (!username) throw new BadRequestException('Username is compulsory');

    const existingUser = await this.userRepo.findOne({ where: { username } });
    if (existingUser) throw new BadRequestException('Username already taken');

    const passwordHash = await bcrypt.hash(pass, 10);
    const user = this.userRepo.create({ name, phone, username, passwordHash });
    await this.userRepo.save(user);
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async toggleUserStatus(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = !user.isActive;
    await this.userRepo.save(user);
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async getProfile(userId: string, role: string) {
    if (role === 'user') {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user) {
        const { passwordHash: _, ...result } = user;
        return { ...result, role: 'user' };
      }
    } else {
      const admin = await this.adminRepo.findOne({
        where: { id: userId },
        relations: ['permissions'],
      });
      if (admin) {
        const { passwordHash: _, ...result } = admin;
        return {
          ...result,
          permissions: admin.permissions?.map((p) => p.name) || [],
        };
      }
    }
    throw new NotFoundException('Profile not found');
  }

  async updateProfile(userId: string, role: string, data: any) {
    if (role === 'user') {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      // check duplicates for username/phone if changing
      if (data.username && data.username !== user.username) {
        const exist = await this.userRepo.findOne({
          where: { username: data.username },
        });
        if (exist) throw new BadRequestException('Username already taken');
      }
      if (data.phone && data.phone !== user.phone) {
        const exist = await this.userRepo.findOne({
          where: { phone: data.phone },
        });
        if (exist) throw new BadRequestException('Phone already used');
      }

      Object.assign(user, {
        name: data.name || user.name,
        username: data.username || user.username,
        phone: data.phone || user.phone,
        avatar: data.avatar || user.avatar,
      });

      if (data.password) {
        user.passwordHash = await bcrypt.hash(data.password, 10);
      }

      await this.userRepo.save(user);
      const { passwordHash: _, ...result } = user;
      return { ...result, role: 'user' };
    } else {
      const admin = await this.adminRepo.findOne({ where: { id: userId } });
      if (!admin) throw new NotFoundException('Admin not found');

      if (data.username && data.username !== admin.username) {
        const exist = await this.adminRepo.findOne({
          where: { username: data.username },
        });
        if (exist) throw new BadRequestException('Username already taken');
      }

      Object.assign(admin, {
        name: data.name || admin.name,
        username: data.username || admin.username,
        phone: data.phone || admin.phone,
        avatar: data.avatar || admin.avatar,
      });

      if (data.password) {
        admin.passwordHash = await bcrypt.hash(data.password, 10);
      }

      await this.adminRepo.save(admin);
      const { passwordHash: _, ...result } = admin;
      return result;
    }
  }

  async adminResetUserPassword(userId: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
    return { success: true, message: 'Password reset successfully' };
  }

  async deleteUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.remove(user);
    return { success: true, message: 'User deleted successfully' };
  }

  async heartbeat(userId: string, mac?: string, ip?: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    let changed = false;
    if (mac && user.lastMac !== mac) {
      user.lastMac = mac;
      changed = true;
    }
    if (ip && user.lastIp !== ip) {
      user.lastIp = ip;
      changed = true;
    }

    if (changed) {
      await this.userRepo.save(user);
    }
    return { success: true };
  }

  // --- 📲 OTP FLOWS (ADVANTA INTEGRATION) ---

  async requestUserOtp(phone: string) {
    const user = await this.userRepo.findOne({ where: { phone } });
    if (!user) throw new NotFoundException('User not found');

    // 1. Rate limiting (1 minute between requests)
    if (user.lastOtpRequestedAt) {
      const diff = Date.now() - new Date(user.lastOtpRequestedAt).getTime();
      if (diff < 60000) {
        throw new BadRequestException('Please wait 60 seconds before requesting another code');
      }
    }

    // 2. Generate 4-digit OTP
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60000); // 5 minutes

    // 3. Save to DB
    const otp = this.otpRepo.create({
      phone,
      code,
      type: OtpType.USER_RECOVERY,
      expiresAt
    });
    await this.otpRepo.save(otp);

    user.lastOtpRequestedAt = new Date();
    await this.userRepo.save(user);

    // 4. Send via Advanta
    const success = await this.smsService.sendOtp(phone, code);
    if (!success) {
      throw new BadRequestException('Failed to send SMS. Please contact support.');
    }

    return { success: true, message: 'OTP sent successfully' };
  }

  async loginWithUserOtp(phone: string, code: string) {
    const otp = await this.otpRepo.findOne({
      where: { phone, code, type: OtpType.USER_RECOVERY, isUsed: false }
    });

    if (!otp || new Date() > otp.expiresAt) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const user = await this.userRepo.findOne({ where: { phone } });
    if (!user) throw new NotFoundException('User not found');

    otp.isUsed = true;
    await this.otpRepo.save(otp);

    const payload = { sub: user.id, phone: user.phone, role: 'user' };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, phone: user.phone }
    };
  }

  async requestAdminOtp(identifier: string, pass: string) {
    const admin = await this.adminRepo.findOne({
      where: [{ email: identifier }, { username: identifier }, { phone: identifier }]
    });
    
    if (!admin) throw new UnauthorizedException('Invalid credentials');
    const isMatch = await bcrypt.compare(pass, admin.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    if (!admin.phone) {
      throw new BadRequestException('Phone number not set for this admin account. Login with password only.');
    }

    // Generate & Send
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60000);

    await this.otpRepo.save(this.otpRepo.create({
      phone: admin.phone,
      code,
      type: OtpType.ADMIN_LOGIN,
      expiresAt
    }));

    const success = await this.smsService.sendOtp(admin.phone, code);
    if (!success) throw new BadRequestException('Failed to send admin 2FA code');

    // Mask phone for frontend display (e.g. 2547****5678)
    const masked = admin.phone.slice(0, 4) + '****' + admin.phone.slice(-4);
    return { challengeRequired: true, message: '2FA code sent', adminId: admin.id, phone: masked };
  }

  async verifyAdminOtpAndLogin(adminId: string, code: string) {
    const admin = await this.adminRepo.findOne({ 
      where: { id: adminId },
      relations: ['permissions'] 
    });
    if (!admin) throw new NotFoundException('Admin not found');

    const otp = await this.otpRepo.findOne({
      where: { phone: admin.phone, code, type: OtpType.ADMIN_LOGIN, isUsed: false }
    });

    if (!otp || new Date() > otp.expiresAt) {
      throw new UnauthorizedException('Invalid or expired 2FA code');
    }

    otp.isUsed = true;
    await this.otpRepo.save(otp);

    const payload = { 
      sub: admin.id, 
      email: admin.email, 
      role: admin.role,
      permissions: admin.permissions?.map(p => p.name) || []
    };
    return { 
      access_token: this.jwtService.sign(payload),
      user: { 
        id: admin.id, 
        name: admin.name, 
        role: admin.role,
        forcePasswordChange: admin.forcePasswordChange 
      }
    };
  }
}
