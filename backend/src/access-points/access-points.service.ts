import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RouterOSAPI } from 'routeros';
import { Repository } from 'typeorm';
import {
  AccessPoint,
  AccessPointProvider,
} from '../entities/access-point.entity';

export interface ApDisconnectResult {
  accessPointId: string;
  accessPointName: string;
  provider: AccessPointProvider;
  supported: boolean;
  success: boolean;
  matched: number;
  message: string;
}

@Injectable()
export class AccessPointsService {
  private readonly logger = new Logger(AccessPointsService.name);

  private readonly mikrotikRegistrationTables = [
    {
      label: 'wifi',
      print: '/interface/wifi/registration-table/print',
      remove: '/interface/wifi/registration-table/remove',
    },
    {
      label: 'wireless',
      print: '/interface/wireless/registration-table/print',
      remove: '/interface/wireless/registration-table/remove',
    },
    {
      label: 'caps-man',
      print: '/caps-man/registration-table/print',
      remove: '/caps-man/registration-table/remove',
    },
  ];

  constructor(
    @InjectRepository(AccessPoint)
    private accessPointRepo: Repository<AccessPoint>,
  ) {}

  async create(createDto: Partial<AccessPoint>): Promise<AccessPoint> {
    const accessPoint = this.accessPointRepo.create({
      ...createDto,
      provider:
        createDto.provider || AccessPointProvider.MIKROTIK_ROUTEROS,
      isActive: createDto.isActive ?? true,
      isOnline: false,
      lastCheckedAt: new Date(),
    });
    const saved = await this.accessPointRepo.save(accessPoint);
    this.testConnection(saved.id).catch(() => {});
    return saved;
  }

  async findAll(): Promise<AccessPoint[]> {
    return this.accessPointRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<AccessPoint> {
    const accessPoint = await this.accessPointRepo.findOne({ where: { id } });
    if (!accessPoint) {
      throw new NotFoundException(`Access point ${id} not found`);
    }
    return accessPoint;
  }

  async update(
    id: string,
    updateDto: Partial<AccessPoint>,
  ): Promise<AccessPoint> {
    const accessPoint = await this.findOne(id);
    if (updateDto.apiPasswordEncrypted === '') {
      delete updateDto.apiPasswordEncrypted;
    }
    Object.assign(accessPoint, updateDto);
    const saved = await this.accessPointRepo.save(accessPoint);
    this.testConnection(saved.id).catch(() => {});
    return saved;
  }

  async remove(id: string): Promise<void> {
    const accessPoint = await this.findOne(id);
    await this.accessPointRepo.remove(accessPoint);
  }

  async testConnection(
    id: string,
  ): Promise<{ success: boolean; message?: string; capabilities?: unknown }> {
    const accessPoint = await this.findOne(id);

    try {
      if (accessPoint.provider !== AccessPointProvider.MIKROTIK_ROUTEROS) {
        const message = `${accessPoint.provider} AP kick driver is registered but not active yet`;
        accessPoint.isOnline = false;
        accessPoint.lastError = message;
        accessPoint.lastCheckedAt = new Date();
        accessPoint.capabilities = { supported: false };
        await this.accessPointRepo.save(accessPoint);
        return { success: false, message, capabilities: accessPoint.capabilities };
      }

      const api = await this.connectMikrotik(accessPoint);
      try {
        const capabilities = await this.detectMikrotikCapabilities(api);
        accessPoint.isOnline = true;
        accessPoint.lastError = null;
        accessPoint.lastCheckedAt = new Date();
        accessPoint.capabilities = capabilities;
        await this.accessPointRepo.save(accessPoint);
        return { success: true, capabilities };
      } finally {
        api.close();
      }
    } catch (e: any) {
      accessPoint.isOnline = false;
      accessPoint.lastError = e.message || 'Access point connection failed';
      accessPoint.lastCheckedAt = new Date();
      await this.accessPointRepo.save(accessPoint);
      return { success: false, message: accessPoint.lastError || undefined };
    }
  }

  async disconnectMac(
    mac: string,
    reason = 'manual',
  ): Promise<ApDisconnectResult[]> {
    const normalizedMac = this.normalizeMac(mac);
    if (!normalizedMac) return [];

    const accessPoints = await this.accessPointRepo.find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });

    if (accessPoints.length === 0) {
      this.logger.debug(
        `[AP-KICK] No AP controllers configured for ${normalizedMac}.`,
      );
      return [];
    }

    const results: ApDisconnectResult[] = [];
    for (const accessPoint of accessPoints) {
      try {
        results.push(
          await this.disconnectMacOnAccessPoint(
            accessPoint,
            normalizedMac,
            reason,
          ),
        );
      } catch (e: any) {
        const result = {
          accessPointId: accessPoint.id,
          accessPointName: accessPoint.name,
          provider: accessPoint.provider,
          supported:
            accessPoint.provider === AccessPointProvider.MIKROTIK_ROUTEROS,
          success: false,
          matched: 0,
          message: e.message || 'AP disconnect failed',
        };
        results.push(result);
        this.logger.warn(
          `[AP-KICK] ${accessPoint.name} failed for ${normalizedMac}: ${result.message}`,
        );
      }
    }

    const hits = results.filter((r) => r.success).length;
    if (hits > 0) {
      this.logger.log(
        `[AP-KICK] Requested Wi-Fi reconnect for ${normalizedMac} | reason=${reason} | aps=${hits}/${results.length}`,
      );
    } else {
      this.logger.debug(
        `[AP-KICK] No AP controller disconnected ${normalizedMac} | reason=${reason} | aps=${results.length}`,
      );
    }

    return results;
  }

  async testKick(id: string, mac: string): Promise<ApDisconnectResult> {
    const accessPoint = await this.findOne(id);
    const normalizedMac = this.normalizeMac(mac);
    if (!normalizedMac) {
      return {
        accessPointId: accessPoint.id,
        accessPointName: accessPoint.name,
        provider: accessPoint.provider,
        supported: false,
        success: false,
        matched: 0,
        message: 'Invalid MAC address',
      };
    }
    return this.disconnectMacOnAccessPoint(
      accessPoint,
      normalizedMac,
      'manual-test',
    );
  }

  private async disconnectMacOnAccessPoint(
    accessPoint: AccessPoint,
    normalizedMac: string,
    reason: string,
  ): Promise<ApDisconnectResult> {
    if (accessPoint.provider !== AccessPointProvider.MIKROTIK_ROUTEROS) {
      return {
        accessPointId: accessPoint.id,
        accessPointName: accessPoint.name,
        provider: accessPoint.provider,
        supported: false,
        success: false,
        matched: 0,
        message: `${accessPoint.provider} driver is registered but not active yet`,
      };
    }

    const api = await this.connectMikrotik(accessPoint);
    try {
      let matched = 0;
      let removed = 0;

      for (const table of this.mikrotikRegistrationTables) {
        try {
          const stations = await api.write(table.print, [
            `?mac-address=${normalizedMac}`,
          ]);
          matched += stations?.length || 0;
          for (const station of stations || []) {
            if (station?.['.id']) {
              const didRemove = await this.safeRemove(
                api,
                table.remove,
                station['.id'],
              );
              if (didRemove) removed += 1;
            }
          }
        } catch (e: any) {
          this.logger.debug(
            `[AP-KICK] ${table.label} unavailable on ${accessPoint.name}: ${e.message}`,
          );
        }
      }

      return {
        accessPointId: accessPoint.id,
        accessPointName: accessPoint.name,
        provider: accessPoint.provider,
        supported: true,
        success: removed > 0,
        matched,
        message:
          removed > 0
            ? `Disconnected ${removed} station(s) for ${normalizedMac} (${reason})`
            : `No matching station found for ${normalizedMac}`,
      };
    } finally {
      api.close();
    }
  }

  private async connectMikrotik(accessPoint: AccessPoint): Promise<RouterOSAPI> {
    const host =
      accessPoint.isNated && accessPoint.vpnIp
        ? accessPoint.vpnIp
        : accessPoint.host;

    if (!host || !accessPoint.apiUsername || !accessPoint.apiPasswordEncrypted) {
      throw new Error('Missing AP host or API credentials');
    }

    const api = new RouterOSAPI({
      host,
      user: accessPoint.apiUsername,
      password: accessPoint.apiPasswordEncrypted,
      port: accessPoint.port || 8728,
      timeout: 5,
    });

    try {
      await Promise.race([
        api.connect(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Connection timed out: AP is unreachable')),
            5000,
          ),
        ),
      ]);
      return api;
    } catch (e: any) {
      try {
        api.close();
      } catch {}
      if (
        e.message?.includes('invalid user or password') ||
        e.message?.includes('not logged in')
      ) {
        throw new Error('Authentication failed: invalid AP API credentials');
      }
      throw e;
    }
  }

  private async detectMikrotikCapabilities(
    api: RouterOSAPI,
  ): Promise<Record<string, boolean>> {
    const capabilities: Record<string, boolean> = {};
    for (const table of this.mikrotikRegistrationTables) {
      try {
        await api.write(table.print);
        capabilities[table.label] = true;
      } catch {
        capabilities[table.label] = false;
      }
    }
    return capabilities;
  }

  private async safeRemove(
    api: RouterOSAPI,
    path: string,
    id?: string,
  ): Promise<boolean> {
    if (!id) return false;
    try {
      await api.write(path, [`=.id=${id}`]);
      return true;
    } catch (e: any) {
      if (
        e.message?.includes('no such item') ||
        e.message?.includes('invalid internal item number')
      ) {
        this.logger.debug(`[AP-KICK] ${path} skipped missing station ${id}`);
        return false;
      }
      throw e;
    }
  }

  private normalizeMac(mac?: string | null): string | null {
    if (!mac) return null;
    const hex = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    if (hex.length !== 12) return null;
    return hex.match(/.{1,2}/g)?.join(':') || null;
  }
}
