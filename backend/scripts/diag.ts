import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Permission } from '../src/entities/permission.entity';
import { Admin } from '../src/entities/admin.entity';
import { Repository } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    console.log('--- DATABASE DIAGNOSTIC ---');
    
    const permissionRepo = app.get<Repository<Permission>>(getRepositoryToken(Permission));
    const adminRepo = app.get<Repository<Admin>>(getRepositoryToken(Admin));

    // Check Permissions
    const permissions = await permissionRepo.find();
    console.log(`Permissions count: ${permissions.length}`);
    if (permissions.length > 0) {
      console.log('Available Permissions:', permissions.map(p => p.name).join(', '));
    } else {
      console.log('WARNING: Permissions table is EMPTY.');
    }

    // Check Admin Schema (forcePasswordChange)
    try {
      const admins = await adminRepo.find({ take: 1 });
      console.log('Admin check successful.');
      if (admins.length > 0) {
        console.log(`Column forcePasswordChange exists?: ${'forcePasswordChange' in admins[0]}`);
      }
    } catch (e) {
      console.error('ERROR checking Admin table (potential missing column):', e.message);
    }

  } catch (e) {
    console.error('DIAGNOSTIC FAILED:', e.message);
  } finally {
    await app.close();
  }
}

bootstrap();
