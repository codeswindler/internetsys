import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, AdminRole } from '../entities/admin.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeederService implements OnModuleInit {
  private readonly logger = new Logger(SeederService.name);

  constructor(
    @InjectRepository(Admin)
    private adminRepo: Repository<Admin>,
  ) {}

  async onModuleInit() {
    const adminCount = await this.adminRepo.count();
    if (adminCount === 0) {
      const password = await bcrypt.hash('admin123', 10);
      const superadmin = this.adminRepo.create({
        name: 'System Administrator',
        email: 'admin@netsync.com',
        passwordHash: password,
        role: AdminRole.SUPERADMIN,
      });
      await this.adminRepo.save(superadmin);
      this.logger.log(
        'Default superadmin created: admin@netsync.com / admin123',
      );
    }
  }
}
