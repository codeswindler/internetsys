import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as https from 'https';
import { Router } from '../entities/router.entity';

@Injectable()
export class VpnService {
  private readonly logger = new Logger(VpnService.name);
  private readonly apiUrl: string;
  private readonly adminPassword: string;
  private readonly virtualHub: string = 'DEFAULT';

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('VPN_HOST', 'localhost');
    const port = this.configService.get<string>('VPN_PORT', '5555');
    this.apiUrl = `https://${host}:${port}/api`;
    this.adminPassword = this.configService.get<string>('VPN_ADMIN_PASSWORD', '');
  }

  private async callApi(method: string, params: any = {}) {
    if (!this.adminPassword) {
      this.logger.warn('VPN_ADMIN_PASSWORD is not set. VPN automation will be skipped.');
      return null;
    }

    try {
      const response = await axios.post(this.apiUrl, {
        jsonrpc: '2.0',
        id: '1',
        method: method,
        params: {
          HubName_str: this.virtualHub,
          ...params,
        },
      }, {
        headers: {
          'X-VPNADMIN-PASSWORD': this.adminPassword,
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      if (response.data.error) {
        throw new Error(`SoftEther API Error: ${JSON.stringify(response.data.error)}`);
      }

      return response.data.result;
    } catch (error) {
      this.logger.error(`VPN API Call Failed: ${error.message}`);
      throw error;
    }
  }

  async syncUser(router: Router) {
    if (!router.isNated || !router.vpnUsername) return;

    this.logger.log(`Syncing VPN user ${router.vpnUsername} for router ${router.name}`);

    try {
      // Check if user exists
      let userExists = false;
      try {
        await this.callApi('GetUser', { Name_str: router.vpnUsername });
        userExists = true;
      } catch (e) {
        // SoftEther returns an error if user not found
        userExists = false;
      }

      const userParams: any = {
        Name_str: router.vpnUsername,
        AuthType_u32: 1, // Password authentication (v4.38 uses _u32)
        Auth_Password_str: router.vpnPasswordEncrypted,
        Realname_utf: router.name,
        Note_utf: `Managed by PulseLynk (Router ID: ${router.id})`,
        // Enforce static IP via policy
        Policy: {
          IPAddress_ip: router.vpnIp || '0.0.0.0',
          IPAddress_bool: !!router.vpnIp,
        }
      };

      if (userExists) {
        await this.callApi('SetUser', userParams);
      } else {
        await this.callApi('CreateUser', userParams);
      }

      // If a vpnIp is assigned, set it as a static IP if needed (depends on Hub configuration)
      // SoftEther uses Address Masking or DHCP mostly, but we can set L3 Switch or static if using RADIUS/etc.
      // For standard Hubs, fixed IPs are often managed by DHCP Reservation on the Hub.
    } catch (error) {
      this.logger.error(`Failed to sync VPN user: ${error.message}`);
    }
  }

  async deleteUser(router: Router) {
    if (!router.vpnUsername) return;

    this.logger.log(`Deleting VPN user ${router.vpnUsername}`);
    try {
      await this.callApi('DeleteUser', { Name_str: router.vpnUsername });
    } catch (error) {
      this.logger.error(`Failed to delete VPN user: ${error.message}`);
    }
  }
}
