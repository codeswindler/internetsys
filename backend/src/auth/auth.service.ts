import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Admin, AdminRole } from '../entities/admin.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async adminLogin(identifier: string, pass: string) {
    const admin = await this.adminRepo.findOne({
      where: [
        { email: identifier },
        { username: identifier },
        { phone: identifier }
      ]
    });
    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isMatch = await bcrypt.compare(pass, admin.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: admin.id, email: admin.email, role: admin.role };
    return { access_token: this.jwtService.sign(payload) };
  }

  async userLogin(identifier: string, pass: string) {
    const user = await this.userRepo.findOne({
      where: [
        { phone: identifier },
        { email: identifier },
        { username: identifier }
      ]
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
    return { access_token: this.jwtService.sign(payload), user: { id: user.id, name: user.name, phone: user.phone } };
  }

  async userRegister(name: string, phone: string, pass: string, username: string) {
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
    const admin = this.adminRepo.create({ name: 'Super Admin', email, passwordHash, role: AdminRole.SUPERADMIN });
    await this.adminRepo.save(admin);
    return admin;
  }

  async getAllUsers() {
    return this.userRepo.find({
      relations: ['subscriptions', 'subscriptions.package', 'subscriptions.router'],
      order: { createdAt: 'DESC' },
    });
  }

  async adminCreateUser(name: string, phone: string, pass: string, username: string) {
    const existingPhone = await this.userRepo.findOne({ where: { phone } });
    if (existingPhone) throw new BadRequestException('Phone number already registered');
    
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
      const admin = await this.adminRepo.findOne({ where: { id: userId } });
      if (admin) {
        const { passwordHash: _, ...result } = admin;
        return result; // admin already contains role
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
        const exist = await this.userRepo.findOne({ where: { username: data.username } });
        if (exist) throw new BadRequestException('Username already taken');
      }
      if (data.phone && data.phone !== user.phone) {
        const exist = await this.userRepo.findOne({ where: { phone: data.phone } });
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
        const exist = await this.adminRepo.findOne({ where: { username: data.username } });
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
}
