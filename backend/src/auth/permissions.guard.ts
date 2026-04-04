import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { AdminRole } from '../entities/admin.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    
    // If no specific permissions are required, let it pass (RolesGuard handles roles)
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Superadmins always pass permission checks
    if (user.role === AdminRole.SUPERADMIN) {
      return true;
    }

    // Check if user has ALL required permissions for the action
    // Note: The 'permissions' array comes from the JWT payload
    const userPermissions = user.permissions || [];
    return requiredPermissions.every((p) => userPermissions.includes(p));
  }
}
