import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Router } from '../entities/router.entity';
import { MikrotikService } from './mikrotik.service';
import { VpnService } from './vpn.service';

@Injectable()
export class RoutersService {
  constructor(
    @InjectRepository(Router)
    private routerRepo: Repository<Router>,
    private mikrotikService: MikrotikService,
    private vpnService: VpnService,
    private configService: ConfigService,
  ) {}

  async create(createDto: Partial<Router>): Promise<Router> {
    const router = this.routerRepo.create(createDto);
    router.isOnline = false;
    router.lastCheckedAt = new Date();
    
    // Save immediately so the user isn't blocked by a hanging timeout
    const savedRouter = await this.routerRepo.save(router);

    // Sync VPN user if NATed
    if (savedRouter.isNated) {
      this.vpnService.syncUser(savedRouter).catch(() => {});
    }

    // Run connection test in the background
    this.testConnection(savedRouter.id).catch(() => {});

    return savedRouter;
  }

  async findAll(): Promise<Router[]> {
    return this.routerRepo.find();
  }

  async findOne(id: string): Promise<Router> {
    const router = await this.routerRepo.findOne({ where: { id } });
    if (!router) throw new NotFoundException(`Router ${id} not found`);
    return router;
  }

  async update(id: string, updateDto: Partial<Router>): Promise<Router> {
    const router = await this.findOne(id);
    if (updateDto.apiPasswordEncrypted === '') {
      delete updateDto.apiPasswordEncrypted;
    }
    if (updateDto.vpnPasswordEncrypted === '') {
      delete updateDto.vpnPasswordEncrypted;
    }
    Object.assign(router, updateDto);
    const result = await this.mikrotikService.testConnection(router);
    router.isOnline = result.success;
    router.lastCheckedAt = new Date();
    
    const updatedRouter = await this.routerRepo.save(router);
    
    // Sync VPN user if NATed
    if (updatedRouter.isNated) {
      this.vpnService.syncUser(updatedRouter).catch(() => {});
    }
    
    return updatedRouter;
  }

  async remove(id: string): Promise<void> {
    const router = await this.findOne(id);
    if (router.isNated) {
      this.vpnService.deleteUser(router).catch(() => {});
    }
    await this.routerRepo.remove(router);
  }

  async testConnection(id: string): Promise<{ success: boolean; message?: string }> {
    const router = await this.findOne(id);
    const connectionResult = await this.mikrotikService.testConnection(router);
    router.isOnline = connectionResult.success;
    router.lastError = connectionResult.success ? null : (connectionResult.message || 'Unknown error');
    router.lastCheckedAt = new Date();
    
    if (connectionResult.success) {
      try {
        const hProfiles = await this.mikrotikService.listProfiles(router);
        const pProfiles = await this.mikrotikService.listPppProfiles(router);
        const all = [...new Set([...hProfiles.map(p => p.name), ...pProfiles.map(p => p.name)])].filter(Boolean);
        router.profiles = all;
      } catch (e) {
        // Log but don't fail the connection test
        console.error(`Failed to sync profiles for ${router.name}:`, e.message);
      }
    }

    await this.routerRepo.save(router);
    return connectionResult;
  }

  async getProfiles(id: string): Promise<any[]> {
    const router = await this.findOne(id);
    return this.mikrotikService.listProfiles(router);
  }

  async getAllUniqueProfiles(): Promise<string[]> {
    const routers = await this.routerRepo.find({ where: { isOnline: true } });
    const profileSet = new Set<string>();

    for (const router of routers) {
      try {
        const hProfiles = await this.mikrotikService.listProfiles(router);
        hProfiles.forEach(p => {
          if (p.name) profileSet.add(p.name);
        });

        const pProfiles = await this.mikrotikService.listPppProfiles(router);
        pProfiles.forEach(p => {
          if (p.name) profileSet.add(p.name);
        });
      } catch (e) {
        // Skip explicitly if one router is offline or connection fails but marked online
      }
    }
    return Array.from(profileSet).sort();
  }

  async createProfileOnAll(name: string, rateLimit: string, routerIds?: string[]): Promise<{ success: number; total: number; errors: string[] }> {
    const allOnlineRouters = await this.routerRepo.find({ where: { isOnline: true } });
    const targetRouterIds = routerIds || allOnlineRouters.map(r => r.id);
    
    let success = 0;
    const errors: string[] = [];

    for (const router of allOnlineRouters) {
      try {
        if (!router.profiles) router.profiles = [];

        if (targetRouterIds.includes(router.id)) {
          // Add/Update profile on this router
          await this.mikrotikService.addHotspotProfile(router, name, rateLimit);
          await this.mikrotikService.addPppProfile(router, name, rateLimit);
          
          if (!router.profiles.includes(name)) {
            router.profiles.push(name);
            await this.routerRepo.save(router);
          }
          success++;
        } else {
          // Remove profile from this router
          await this.mikrotikService.removeHotspotProfile(router, name);
          await this.mikrotikService.removePppProfile(router, name);
          
          if (router.profiles.includes(name)) {
            router.profiles = router.profiles.filter(p => p !== name);
            await this.routerRepo.save(router);
          }
        }
      } catch (e) {
        errors.push(`${router.name}: ${e.message}`);
      }
    }

    return { success, total: targetRouterIds.length, errors };
  }

  async suggestVpnIp(): Promise<{ ip: string }> {
    const routers = await this.routerRepo.find();
    const usedIps = routers.map(r => r.vpnIp).filter(Boolean);
    
    // Default range starts at 10.8.0.2
    for (let i = 2; i <= 254; i++) {
      const candidate = `10.8.0.${i}`;
      if (!usedIps.includes(candidate)) {
        return { ip: candidate };
      }
    }
    
    return { ip: '' };
  }

  getVpnSettings(): { host: string } {
    return {
      host: this.configService.get<string>('VPN_PUBLIC_HOST') || this.configService.get<string>('VPN_HOST', 'localhost'),
    };
  }
}
