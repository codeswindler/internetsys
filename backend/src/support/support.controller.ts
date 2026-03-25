import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { SupportService } from './support.service';
import { MessageSender } from '../entities/support-message.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminRole } from '../entities/admin.entity';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  async sendMessage(@Request() req, @Body('content') content: string) {
    return this.supportService.sendMessage(req.user.id, content, MessageSender.USER);
  }

  @Get()
  async getMessages(@Request() req) {
    return this.supportService.getConversationDetail(req.user.id);
  }

  @Post('read')
  async markAsRead(@Request() req) {
    return this.supportService.markAsReadByUser(req.user.id);
  }

  @Get('unread')
  async getUnreadCount(@Request() req) {
    return this.supportService.getUnreadCountForUser(req.user.id);
  }

  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  @Get('admin/unread-total')
  @UseGuards(RolesGuard)
  async getUnreadTotal() {
    return this.supportService.getUnreadTotalForAdmin();
  }

  @Post('admin/read/:userId')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  async markAsReadAdmin(@Param('userId') userId: string) {
    return this.supportService.markAsReadByAdmin(userId);
  }

  @Get('admin/conversations')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  async getConversations() {
    return this.supportService.getConversations();
  }

  @Get('admin/conversations/:userId')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  async getConversationDetail(@Param('userId') userId: string) {
    return this.supportService.getConversationDetail(userId);
  }

  @Post('admin/reply')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPERADMIN, AdminRole.ADMIN)
  async adminReply(@Body() body: { userId: string; content: string }) {
    return this.supportService.sendMessage(body.userId, body.content, MessageSender.ADMIN);
  }
}
