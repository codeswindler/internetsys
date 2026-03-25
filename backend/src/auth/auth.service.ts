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

  async adminLogin(email: string, pass: string) {
    const admin = await this.adminRepo.findOne({ where: { email } });
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

  async userLogin(phone: string, pass: string) {
    const user = await this.userRepo.findOne({ where: { phone } });
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
}
