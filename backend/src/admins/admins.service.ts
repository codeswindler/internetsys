import { Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, AdminRole } from '../entities/admin.entity';
import { Permission } from '../entities/permission.entity';
import * as bcrypt from 'bcrypt';
import { In } from 'typeorm';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class AdminsService implements OnModuleInit {
  private readonly logger = new Logger(AdminsService.name);

  constructor(
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(Permission) private permissionRepo: Repository<Permission>,
    private smsService: SmsService,
  ) {}

  async onModuleInit() {
    // Seed default permissions
    const defaults = [
      'manage_routers',
      'manage_users',
      'manage_vouchers',
      'manage_admins',
      'view_revenue',
      'manage_packages',
      'support_chat'
    ];

    try {
      this.logger.log('[Admins] Seeding permissions...');
      for (const name of defaults) {
        const exist = await this.permissionRepo.findOne({ where: { name } });
        if (!exist) {
          await this.permissionRepo.save(this.permissionRepo.create({ name }));
        }
      }
    } catch (e) {
      this.logger.error(`[Admins] Permission Seeding Failed: ${e.message}`);
    }
  }

  async findAll(): Promise<Admin[]> {
    return this.adminRepo.find({ relations: ['permissions'] });
  }

  async findOne(id: string): Promise<Admin> {
    const admin = await this.adminRepo.findOne({ where: { id }, relations: ['permissions'] });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  async create(data: any): Promise<any> {
    const existing = await this.adminRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Email already in use');

    if (data.username) {
      const existUser = await this.adminRepo.findOne({ where: { username: data.username } });
      if (existUser) throw new BadRequestException('Username already taken');
    }

    // Generate random 8-char password if not provided
    const rawPassword = Math.random().toString(36).slice(-8).toUpperCase();
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    
    const permissions = await this.permissionRepo.find({
      where: { id: In(data.permissionIds || []) }
    });

    const admin = this.adminRepo.create({
      name: data.name,
      email: data.email,
      username: data.username,
      phone: data.phone,
      role: data.role || AdminRole.ADMIN,
      passwordHash,
      permissions,
      forcePasswordChange: true // Always force change for system-gen passwords
    });

    const saved = await this.adminRepo.save(admin);

    // Send SMS with credentials
    if (saved.phone) {
      const msg = `Hello ${saved.name}, your PulseLynk staff credentials: Username: ${saved.username || saved.email}, Pass: ${rawPassword}. Login at pulselynk.co.ke/admin. Please change password on first login.`;
      await this.smsService.sendSms(saved.phone, msg);
    }

    return { ...saved, rawPassword };
  }

  async update(id: string, data: any): Promise<Admin> {
    const admin = await this.findOne(id);
    
    if (data.password) {
      admin.passwordHash = await bcrypt.hash(data.password, 10);
      admin.forcePasswordChange = false; // Reset if updated manually
    }

    if (data.permissionIds) {
      admin.permissions = await this.permissionRepo.find({
        where: { id: In(data.permissionIds) }
      });
    }

    Object.assign(admin, {
      name: data.name || admin.name,
      email: data.email || admin.email,
      username: data.username || admin.username,
      phone: data.phone || admin.phone,
      role: data.role || admin.role,
      forceOtpLogin: data.forceOtpLogin !== undefined ? data.forceOtpLogin : admin.forceOtpLogin,
      forcePasswordChange: data.forcePasswordChange !== undefined ? data.forcePasswordChange : admin.forcePasswordChange
    });

    return this.adminRepo.save(admin);
  }

  async delete(id: string): Promise<void> {
    const admin = await this.findOne(id);
    if (admin.role === AdminRole.SUPERADMIN) {
      throw new BadRequestException('Cannot delete Super Admin');
    }
    await this.adminRepo.remove(admin);
  }

  async findAllPermissions(): Promise<Permission[]> {
    return this.permissionRepo.find();
  }
}
