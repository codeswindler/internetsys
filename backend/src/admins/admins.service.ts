import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, AdminRole } from '../entities/admin.entity';
import { Permission } from '../entities/permission.entity';
import * as bcrypt from 'bcrypt';
import { In } from 'typeorm';

@Injectable()
export class AdminsService implements OnModuleInit {
  constructor(
    @InjectRepository(Admin) private adminRepo: Repository<Admin>,
    @InjectRepository(Permission) private permissionRepo: Repository<Permission>,
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

    for (const name of defaults) {
      const exist = await this.permissionRepo.findOne({ where: { name } });
      if (!exist) {
        await this.permissionRepo.save(this.permissionRepo.create({ name }));
      }
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

  async create(data: any): Promise<Admin> {
    const existing = await this.adminRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Email already in use');

    if (data.username) {
      const existUser = await this.adminRepo.findOne({ where: { username: data.username } });
      if (existUser) throw new BadRequestException('Username already taken');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const permissions = await this.permissionRepo.find({
      where: { id: In(data.permissionIds || []) }
    });

    const admin = this.adminRepo.create({
      name: data.name,
      email: data.email,
      username: data.username,
      phone: data.phone,
      role: data.role,
      passwordHash,
      permissions
    });

    return this.adminRepo.save(admin);
  }

  async update(id: string, data: any): Promise<Admin> {
    const admin = await this.findOne(id);
    
    if (data.password) {
      admin.passwordHash = await bcrypt.hash(data.password, 10);
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
      forceOtpLogin: data.forceOtpLogin !== undefined ? data.forceOtpLogin : admin.forceOtpLogin
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
