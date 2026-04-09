import { Injectable, Logger } from '@nestjs/common';
import { RouterOSAPI } from 'routeros';
import { Router } from '../entities/router.entity';

@Injectable()
export class MikrotikService {
  private readonly logger = new Logger(MikrotikService.name);

  // Helper method to establish a connection
  private async connect(router: Router): Promise<RouterOSAPI> {
    const host = router.isNated && router.vpnIp ? router.vpnIp : router.host;
    const api = new RouterOSAPI({
      host: host,
      user: router.apiUsername,
      password: router.apiPasswordEncrypted,
      port: router.port,
      timeout: 5,
    });

    try {
      await Promise.race([
        api.connect(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Connection timed out: Router is unreachable or offline',
                ),
              ),
            5000,
          ),
        ),
      ]);
      return api;
    } catch (error: any) {
      let friendlyMessage = error.message;
      if (
        error.message?.includes('invalid user or password') ||
        error.message?.includes('not logged in')
      ) {
        friendlyMessage =
          'Authentication failed: Invalid API Username or Password';
      } else if (error.code === 'ECONNREFUSED') {
        friendlyMessage =
          'Connection refused: Check the IP and ensure API service (port 8728) is enabled on the router';
      } else if (
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('timed out')
      ) {
        friendlyMessage =
          'Connection timed out: Router is unreachable or offline';
      }

      this.logger.error(
        `Failed to connect to router ${router.host}: ${friendlyMessage}`,
      );
      try {
        api.close();
      } catch (e) {}
      throw new Error(friendlyMessage);
    }
  }


  async verifyHostPresence(router: Router, mac?: string, ip?: string): Promise<boolean> {
    if (!mac && !ip) return false;
    if (router.connectionMode === 'pppoe') return true; 

    try {
      const api = await this.connect(router);
      try {
        const query = mac ? `?mac-address=${this.normalizeMac(mac)}` : `?address=${ip}`;
        const hosts = await api.write('/ip/hotspot/host/print', [query]);
        return hosts && hosts.length > 0;
      } finally {
        api.close();
      }
    } catch (e) {
      this.logger.warn(`Failed to verify host presence on ${router.name}: ${e.message}`);
      return false;
    }
  }

  async getAllHosts(router: Router): Promise<Array<{ mac: string; ip: string; hostName?: string }>> {
    try {
      const api = await this.connect(router);
      try {
        // 1. Get all active hotspot hosts
        const hosts = await api.write('/ip/hotspot/host/print');

        // 2. Get all DHCP leases to find hostnames
        const leases = await api.write('/ip/dhcp-server/lease/print');
        const leaseMap = new Map();
        if (leases && leases.length > 0) {
          leases.forEach((l: any) => {
            if (l['active-mac-address'] && l['host-name']) {
              leaseMap.set(l['active-mac-address'].toLowerCase(), l['host-name']);
            } else if (l['mac-address'] && l['host-name']) {
              leaseMap.set(l['mac-address'].toLowerCase(), l['host-name']);
            }
          });
        }

        this.logger.log(`[SYNC] Found ${hosts?.length || 0} total hosts on ${router.name}`);

        if (!hosts || hosts.length === 0) return [];

        return hosts
          .filter((h: any) => h['mac-address'])
          .map((h: any) => {
            const mac = h['mac-address'];
            return {
              mac: mac,
              ip: h['address'] || '',
              hostName: leaseMap.get(mac.toLowerCase()),
            };
          });
      } finally {
        api.close();
      }
    } catch (e) {
      this.logger.error(`[SYNC] Failed to query hosts on ${router.name}: ${e.message}`);
      return [];
    }
  }

  async testConnection(
    router: Router,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const api = await this.connect(router);
      api.close();
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: e.message || 'Connection timeout or invalid credentials',
      };
    }
  }

  async createHotspotUser(
    router: Router,
    username: string,
    pass: string,
    profile: string,
  ): Promise<any> {
    const api = await this.connect(router);
    try {
      // First check if user exists
      const existing = await api.write('/ip/hotspot/user/print', [
        `?name=${username}`,
      ]);
      if (existing.length > 0) {
        // Update user
        const result = await api.write('/ip/hotspot/user/set', [
          `=.id=${existing[0]['.id']}`,
          `=password=${pass}`,
          `=profile=${profile}`,
        ]);
        api.close();
        return result;
      }

      // Add new user
      const result = await api.write('/ip/hotspot/user/add', [
        `=name=${username}`,
        `=password=${pass}`,
        `=profile=${profile}`,
      ]);
      api.close();
      return result;
    } catch (e) {
      api.close();
      this.logger.error(
        `Error creating hotspot user ${username} on ${router.host}`,
        e,
      );
      throw e;
    }
  }

  async removeHotspotUser(router: Router, username: string): Promise<void> {
    const api = await this.connect(router);
    try {
      this.logger.log(`[EXPIRY] Fully removing user and bypasses for ${username} on ${router.name}...`);
      
      const users = await api.write('/ip/hotspot/user/print', [
        `?name=${username}`,
      ]);
      if (users.length > 0) {
        await api.write('/ip/hotspot/user/remove', [`=.id=${users[0]['.id']}`]);
      }

      // Also remove from active sessions if any
      const active = await api.write('/ip/hotspot/active/print', [
        `?user=${username}`,
      ]);
      for (const session of active) {
        await api.write('/ip/hotspot/active/remove', [
          `=.id=${session['.id']}`,
        ]);
        
        // Also remove from Hosts table using the MAC from the active session. This forces the immediate Captive Portal popup!
        if (session['mac-address']) {
          const hosts = await api.write('/ip/hotspot/host/print', [
            `?mac-address=${session['mac-address']}`
          ]);
          for (const host of hosts) {
            await api.write('/ip/hotspot/host/remove', [`=.id=${host['.id']}`]);
          }
        }
      }

      // CRITICAL: Remove the IP-Binding (Triple-Thrust Bypass) we created for them
      const bindings = await api.write('/ip/hotspot/ip-binding/print', [
        `?comment=Pulselynk: ${username}`,
      ]);
      for (const binding of bindings) {
        await api.write('/ip/hotspot/ip-binding/remove', [
          `=.id=${binding['.id']}`,
        ]);
        
        // Ensure the host is removed using the mac from the binding!
        if (binding['mac-address']) {
           const hosts = await api.write('/ip/hotspot/host/print', [
             `?mac-address=${binding['mac-address']}`
           ]);
           for (const host of hosts) {
             await api.write('/ip/hotspot/host/remove', [`=.id=${host['.id']}`]);
           }
        }
      }

    } catch (e) {
      this.logger.error(
        `Error removing hotspot user ${username} on ${router.host}`,
        e,
      );
      throw e;
    } finally {
      // FINAL STAGE: Forced ARP/Host Reset to trigger the hardware logout
      // This is the most crucial step for forcing the "Sign In" popup to reappear.
      try {
        if (username) await this.forceLogoutHotspot(router, undefined, undefined, username);
      } catch (e) {}
      api.close();
    }
  }

  private isPrivateIp(ip: string): boolean {
    if (!ip) return false;
    return ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.');
  }

  async listProfiles(router: Router): Promise<any[]> {
    const api = await this.connect(router);
    try {
      const profiles = await api.write('/ip/hotspot/user/profile/print');
      return profiles;
    } finally {
      api.close();
    }
  }

  async listPppProfiles(router: Router): Promise<any[]> {
    const api = await this.connect(router);
    try {
      const profiles = await api.write('/ppp/profile/print');
      return profiles;
    } finally {
      api.close();
    }
  }

  async addHotspotProfile(
    router: Router,
    name: string,
    rateLimit: string,
  ): Promise<any> {
    const api = await this.connect(router);
    try {
      // Check if profile exists
      const existing = await api.write('/ip/hotspot/user/profile/print', [
        `?name=${name}`,
      ]);
      if (existing.length > 0) {
        // Update existing profile's rate limit
        return await api.write('/ip/hotspot/user/profile/set', [
          `=.id=${existing[0]['.id']}`,
          `=rate-limit=${rateLimit}`,
        ]);
      }

      // Add new profile
      return await api.write('/ip/hotspot/user/profile/add', [
        `=name=${name}`,
        `=rate-limit=${rateLimit}`,
        `=shared-users=unlimited`,
      ]);
    } finally {
      api.close();
    }
  }

  async createPppoeSecret(
    router: Router,
    username: string,
    pass: string,
    profile: string,
  ): Promise<any> {
    const api = await this.connect(router);
    try {
      const existing = await api.write('/ppp/secret/print', [
        `?name=${username}`,
      ]);
      if (existing.length > 0) {
        const result = await api.write('/ppp/secret/set', [
          `=.id=${existing[0]['.id']}`,
          `=password=${pass}`,
          `=profile=${profile}`,
          `=service=pppoe`,
        ]);
        api.close();
        return result;
      }

      const result = await api.write('/ppp/secret/add', [
        `=name=${username}`,
        `=password=${pass}`,
        `=profile=${profile}`,
        `=service=pppoe`,
      ]);
      api.close();
      return result;
    } catch (e) {
      api.close();
      this.logger.error(
        `Error creating PPPoE secret ${username} on ${router.host}`,
        e,
      );
      throw e;
    }
  }

  async removePppoeSecret(router: Router, username: string): Promise<void> {
    const api = await this.connect(router);
    try {
      const secrets = await api.write('/ppp/secret/print', [
        `?name=${username}`,
      ]);
      if (secrets.length > 0) {
        await api.write('/ppp/secret/remove', [`=.id=${secrets[0]['.id']}`]);
      }

      // Force disconnect active PPPoE session
      const active = await api.write('/ppp/active/print', [
        `?name=${username}`,
      ]);
      for (const session of active) {
        await api.write('/ppp/active/remove', [`=.id=${session['.id']}`]);
      }
    } catch (e) {
      this.logger.error(
        `Error removing PPPoE secret ${username} on ${router.host}`,
        e,
      );
      throw e;
    } finally {
      api.close();
    }
  }

  async addPppProfile(
    router: Router,
    name: string,
    rateLimit: string,
  ): Promise<any> {
    const api = await this.connect(router);
    try {
      const existing = await api.write('/ppp/profile/print', [`?name=${name}`]);
      if (existing.length > 0) {
        return await api.write('/ppp/profile/set', [
          `=.id=${existing[0]['.id']}`,
          `=rate-limit=${rateLimit}`,
        ]);
      }

      return await api.write('/ppp/profile/add', [
        `=name=${name}`,
        `=rate-limit=${rateLimit}`,
      ]);
    } finally {
      api.close();
    }
  }

  async removeHotspotProfile(router: Router, name: string): Promise<void> {
    const api = await this.connect(router);
    try {
      const existing = await api.write('/ip/hotspot/user/profile/print', [
        `?name=${name}`,
      ]);
      if (existing.length > 0) {
        await api.write('/ip/hotspot/user/profile/remove', [
          `=.id=${existing[0]['.id']}`,
        ]);
      }
    } catch (e) {
      this.logger.error(
        `Error removing hotspot profile ${name} on ${router.host}`,
        e,
      );
    } finally {
      api.close();
    }
  }

  async removePppProfile(router: Router, name: string): Promise<void> {
    const api = await this.connect(router);
    try {
      const existing = await api.write('/ppp/profile/print', [`?name=${name}`]);
      if (existing.length > 0) {
        await api.write('/ppp/profile/remove', [`=.id=${existing[0]['.id']}`]);
      }
    } catch (e) {
      this.logger.error(
        `Error removing PPP profile ${name} on ${router.host}`,
        e,
      );
    } finally {
      api.close();
    }
  }

  async forceLogoutHotspot(
    router: Router,
    ip?: string,
    mac?: string,
    username?: string,
  ): Promise<void> {
    const api = await this.connect(router);
    try {
      if (username) {
        this.logger.log(
          `[CLEANUP] Removing user ${username} from router ${router.name}...`,
        );
        const users = await api.write('/ip/hotspot/user/print', [
          `?name=${username}`,
        ]);
        for (const u of users) {
          await api.write('/ip/hotspot/user/remove', [`=.id=${u['.id']}`]);
        }
      }
      if (mac) {
        this.logger.log(
          `[FORCE LOGOUT] Clearing MAC ${mac} on router ${router.name}...`,
        );
        // Remove from Active sessions
        const actives = await api.write('/ip/hotspot/active/print', [
          `?mac-address=${mac}`,
        ]);
        for (const act of actives) {
          await api.write('/ip/hotspot/active/remove', [`=.id=${act['.id']}`]);
        }
        // Remove from Hosts list (crucial for resetting "waiting" state)
        const hosts = await api.write('/ip/hotspot/host/print', [
          `?mac-address=${mac}`,
        ]);
        for (const host of hosts) {
          await api.write('/ip/hotspot/host/remove', [`=.id=${host['.id']}`]);
        }
        // Remove from IP Bindings
        const bindings = await api.write('/ip/hotspot/ip-binding/print', [
          `?mac-address=${mac}`,
        ]);
        for (const bind of bindings) {
          await api.write('/ip/hotspot/ip-binding/remove', [`=.id=${bind['.id']}`]);
        }
      }
      if (ip) {
        this.logger.log(
          `[FORCE LOGOUT] Clearing IP ${ip} on router ${router.name}...`,
        );
        const actives = await api.write('/ip/hotspot/active/print', [
          `?address=${ip}`,
        ]);
        for (const act of actives) {
          await api.write('/ip/hotspot/active/remove', [`=.id=${act['.id']}`]);
        }
        
        // CRITICAL: Also remove from Hosts list by IP. This forces the device to re-trigger CPD.
        const hosts = await api.write('/ip/hotspot/host/print', [
          `?address=${ip}`,
        ]);
        for (const host of hosts) {
          await api.write('/ip/hotspot/host/remove', [`=.id=${host['.id']}`]);
        }

        // Remove from IP Bindings
        const bindings = await api.write('/ip/hotspot/ip-binding/print', [
          `?address=${ip}`,
        ]);
        for (const bind of bindings) {
          await api.write('/ip/hotspot/ip-binding/remove', [`=.id=${bind['.id']}`]);
        }
      }
    } catch (e) {
      this.logger.warn(
        `Failed to force logout ${mac || ip} on ${router.name}: ${e.message}`,
      );
    } finally {
      api.close();
    }
  }

  private normalizeMac(mac?: string): string | undefined {
    if (!mac) return undefined;
    // Remove all non-hex chars and format as XX:XX:XX:XX:XX:XX
    const clean = mac.replace(/[^a-fA-F0-9]/g, '');
    if (clean.length !== 12) return mac; // Can't normalize if it's not 12 chars
    return clean
      .match(/.{1,2}/g)
      ?.join(':')
      .toUpperCase();
  }

  async loginUser(
    router: Router,
    username: string,
    pass: string,
    ip?: string,
    mac?: string,
    profile?: string,
  ): Promise<any> {
    const finalMac = this.normalizeMac(mac);
    // Stage 1: Clear any "stuck" sessions and OLD users with same name
    await this.forceLogoutHotspot(router, ip, finalMac, username);

    const api = await this.connect(router);
    try {
      this.logger.log(
        `[PROVISIONING] Creating hotspot user ${username} on ${router.name}...`,
      );

      // Stage 1.5: Ensure user exists in /ip/hotspot/user
      const users = await api.write('/ip/hotspot/user/print', [
        `?name=${username}`,
      ]);
      if (users.length === 0) {
        const userArgs = [`=name=${username}`, `=password=${pass}`];
        if (profile) userArgs.push(`=profile=${profile}`);
        await api.write('/ip/hotspot/user/add', userArgs);
        this.logger.log(
          `[PROVISIONING SUCCESS] User ${username} created with profile ${profile || 'default'}`,
        );
      }
      // Stage 1 Deep-Clean: Forcefully remove existing active sessions & bindings
      const cleanupQuery = finalMac ? `?mac-address=${finalMac}` : (ip ? `?address=${ip}` : null);

      if (cleanupQuery) {
        // 1. Cleave Active Hotspot Sessions
        const actives = await api.write('/ip/hotspot/active/print', [cleanupQuery]);
        for (const a of actives) {
          if (a['.id']) await api.write('/ip/hotspot/active/remove', [`=.id=${a['.id']}`]);
        }

        // 2. Cleave Hardware Hosts table
        const hosts = await api.write('/ip/hotspot/host/print', [cleanupQuery]);
        for (const h of hosts) {
          if (h['.id']) await api.write('/ip/hotspot/host/remove', [`=.id=${h['.id']}`]);
        }

        // 3. Cleave IP-Bindings
        const existing = await api.write('/ip/hotspot/ip-binding/print', [cleanupQuery]);
        for (const b of existing) {
          if (b['.id']) await api.write('/ip/hotspot/ip-binding/remove', [`=.id=${b['.id']}`]);
        }
      }

      // Stage 2: The Proofed-Bypass (must succeed or the session is not ready)
      const bindingArgs = [
        '=type=bypassed',
        `=comment=Pulselynk: ${username}`,
      ];
      if (finalMac) bindingArgs.push(`=mac-address=${finalMac}`);
      if (ip) bindingArgs.push(`=address=${ip}`);

      await api.write('/ip/hotspot/ip-binding/add', bindingArgs);
      this.logger.log(
        `[STAGE 2 SUCCESS] IP-Binding BYPASS created for ${finalMac || ip}.`,
      );

      // Stage 3: Instant-Flow Nudge (best effort only)
      try {
        if (ip) await api.write('/ip/arp/remove', [`?address=${ip}`]);
        if (finalMac)
          await api.write('/ip/arp/remove', [`?mac-address=${finalMac}`]);
        this.logger.log(
          `[INSTANT-FLOW] ARP Nudge sent for ${ip || finalMac}. Fluid connectivity engaged.`,
        );
      } catch (e: any) {
        this.logger.warn(`[INSTANT-FLOW] ARP nudge failed: ${e.message}`);
      }

      return { success: true };
    } catch (e: any) {
      this.logger.error(`Hotspot Login ERROR on ${router.name}: ${e.message}`);
      throw e;
    } finally {
      api.close();
    }
  }

  async verifyHotspotConnection(
    router: Router,
    mac?: string,
    ip?: string,
    username?: string,
  ): Promise<boolean> {
    const api = await this.connect(router);
    const finalMac = this.normalizeMac(mac);
    try {
      const activeQuery = finalMac
        ? `?mac-address=${finalMac}`
        : ip
          ? `?address=${ip}`
          : username
            ? `?user=${username}`
            : null;

      if (activeQuery) {
        const active = await api.write('/ip/hotspot/active/print', [activeQuery]);
        if (active && active.length > 0) return true;
      }

      const bindingQuery = finalMac
        ? `?mac-address=${finalMac}`
        : ip
          ? `?address=${ip}`
          : null;

      if (!bindingQuery) return false;

      const bindings = await api.write('/ip/hotspot/ip-binding/print', [bindingQuery]);
      return bindings.some((binding: any) => {
        const type = `${binding['type'] || ''}`.toLowerCase();
        const comment = `${binding['comment'] || ''}`;
        return type === 'bypassed' && (!username || comment === `Pulselynk: ${username}`);
      });
    } catch (e: any) {
      this.logger.warn(
        `Failed to verify hotspot connection for ${router.name}: ${e.message}`,
      );
      return false;
    } finally {
      api.close();
    }
  }

  async findMacByIp(router: Router, ip: string): Promise<string | null> {
    const api = await this.connect(router);
    try {
      // 1. Look in ARP table
      const results = await api.write('/ip/arp/print', [`?address=${ip}`]);
      if (results && results.length > 0 && results[0]['mac-address']) {
        return results[0]['mac-address'];
      }

      // FALLBACK 1: Scan Hotspot Hosts (The most accurate for hotspot devices)
      if (this.isPrivateIp(ip)) {
        this.logger.log(`Scanning Hotspot Hosts for ${ip}...`);
        const hosts = await api.write('/ip/hotspot/host/print', [
          `?address=${ip}`,
        ]);
        if (hosts && hosts[0]?.['mac-address']) {
          this.logger.log(
            `Found MAC ${hosts[0]['mac-address']} in Hotspot Hosts`,
          );
          return hosts[0]['mac-address'];
        }
      }

      // FALLBACK 2: Scan DHCP Leases (Good for devices that just joined)
      this.logger.log(`Scanning DHCP Leases for ${ip}...`);
      const leases = await api.write('/ip/dhcp-server/lease/print', [
        `?active-address=${ip}`,
      ]);
      if (leases && leases[0]?.['active-mac-address']) {
        this.logger.log(
          `Found MAC ${leases[0]['active-mac-address']} in DHCP Leases`,
        );
        return leases[0]['active-mac-address'];
      }

      // FALLBACK 3: Search for ANY recently active lease if IP mismatch persists
      // This handles cases where the phone is NAT'd and the server sees the wrong IP
      this.logger.log(`Performing 'Last-Seen' lease scan...`);
      const recentLeases = await api.write('/ip/dhcp-server/lease/print', [
        '?status=bound',
      ]);
      if (recentLeases && recentLeases.length > 0) {
        // Find the lease that was updated most recently (last-seen)
        // This is a "best guess" but works well for 1-click connect
        const latest = recentLeases.sort((a, b) =>
          (b['last-seen'] || '').localeCompare(a['last-seen'] || ''),
        )[0];
        this.logger.warn(
          `Public IP mismatch! Best guess MAC: ${latest['active-mac-address']}`,
        );
        // return latest['active-mac-address']; // disabled for safety, but showing the logic
      }

      this.logger.warn(`MAC discovery finally failed for IP ${ip}`);
      return null;
    } catch (e: any) {
      this.logger.warn(
        `Failed to lookup MAC for IP ${ip} on router ${router.name}: ${e.message}`,
      );
      return null;
    } finally {
      api.close();
    }
  }

  async getUserTraffic(
    router: Router,
    username: string,
    ip?: string,
    mac?: string,
  ): Promise<{ bytesIn: number; bytesOut: number } | null> {
    const api = await this.connect(router);
    const finalMac = this.normalizeMac(mac);
    try {
      // 1. Try ACTIVE list (Standard Mode)
      // Search by MAC first, then IP, then User
      const activeQuery = finalMac
        ? `?mac-address=${finalMac}`
        : ip
          ? `?address=${ip}`
          : `?user=${username}`;
      const results = await api.write('/ip/hotspot/active/print', [
        activeQuery,
        '.proplist=bytes-in,bytes-out',
      ]);

      if (results && results.length > 0) {
        return {
          bytesIn: parseInt(results[0]['bytes-in'] || '0'),
          bytesOut: parseInt(results[0]['bytes-out'] || '0'),
        };
      }

      // 2. FALLBACK: Try HOST list (Bypass Mode)
      // Bypassed users ONLY appear in the Host list
      const hostQuery = finalMac
        ? `?mac-address=${finalMac}`
        : ip
          ? `?address=${ip}`
          : `?comment=~${username}`;
      const hosts = await api.write('/ip/hotspot/host/print', [
        hostQuery,
        '.proplist=bytes-in,bytes-out',
      ]);

      if (hosts && hosts.length > 0) {
        return {
          bytesIn: parseInt(hosts[0]['bytes-in'] || '0'),
          bytesOut: parseInt(hosts[0]['bytes-out'] || '0'),
        };
      }

      return null;
    } catch (e: any) {
      this.logger.error(
        `Failed to fetch traffic for ${username}/${ip}/${mac} on ${router.name}: ${e.message}`,
      );
      return null;
    } finally {
      api.close();
    }
  }
}
