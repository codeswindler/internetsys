import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SupportMessage,
  MessageSender,
} from '../entities/support-message.entity';
import { Admin } from '../entities/admin.entity';
import { User } from '../entities/user.entity';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportMessage)
    private messageRepo: Repository<SupportMessage>,
    @InjectRepository(Admin)
    private adminRepo: Repository<Admin>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private smsService: SmsService,
  ) {}

  async sendMessage(
    userId: string,
    content: string,
    sender: MessageSender,
  ): Promise<SupportMessage> {
    const message = this.messageRepo.create({
      userId,
      content,
      sender,
      isReadByAdmin: sender === MessageSender.ADMIN,
      isReadByUser: sender === MessageSender.USER,
    });
    const saved = await this.messageRepo.save(message);

    if (sender === MessageSender.USER) {
      await this.notifyAdminsOfSupportMessage(saved);
    }

    return saved;
  }

  async getMessagesForUser(userId: string): Promise<SupportMessage[]> {
    const messages = await this.messageRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    // Mark as read by user
    await this.messageRepo.update(
      { userId, sender: MessageSender.ADMIN },
      { isReadByUser: true },
    );

    return messages;
  }

  async getConversations(): Promise<any[]> {
    // This is a simplified version to get latest message per user
    const qb = this.messageRepo.createQueryBuilder('msg');
    const latestMessages = await qb
      .select('msg.userId', 'userId')
      .addSelect('MAX(msg.createdAt)', 'latest')
      .groupBy('msg.userId')
      .getRawMany();

    const conversations: any[] = [];
    for (const item of latestMessages) {
      const lastMsg = await this.messageRepo.findOne({
        where: { userId: item.userId },
        order: { createdAt: 'DESC' },
        relations: ['user'],
      });

      const unreadCount = await this.messageRepo.count({
        where: {
          userId: item.userId,
          sender: MessageSender.USER,
          isReadByAdmin: false,
        },
      });

      const userName = lastMsg?.user
        ? lastMsg.user.username || lastMsg.user.name
        : 'Unknown';

      const conv: any = {
        userId: item.userId,
        userName,
        lastMessage: lastMsg?.content,
        lastTime: new Date(item.latest),
        unreadCount,
      };
      conversations.push(conv);
    }

    return conversations.sort(
      (a, b) => b.lastTime.getTime() - a.lastTime.getTime(),
    );
  }

  async getConversationDetail(userId: string): Promise<SupportMessage[]> {
    return this.messageRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
      relations: ['user'],
    });
  }

  async markAsReadByUser(userId: string): Promise<void> {
    await this.messageRepo.update(
      { userId, sender: MessageSender.ADMIN, isReadByUser: false },
      { isReadByUser: true },
    );
  }

  async markAsReadByAdmin(userId: string): Promise<void> {
    await this.messageRepo.update(
      { userId, sender: MessageSender.USER, isReadByAdmin: false },
      { isReadByAdmin: true },
    );
  }

  async getUnreadTotalForAdmin(): Promise<number> {
    return this.messageRepo.count({
      where: { sender: MessageSender.USER, isReadByAdmin: false },
    });
  }

  async getUnreadCountForUser(userId: string): Promise<number> {
    return this.messageRepo.count({
      where: { userId, sender: MessageSender.ADMIN, isReadByUser: false },
    });
  }

  private async notifyAdminsOfSupportMessage(
    message: SupportMessage,
  ): Promise<void> {
    try {
      const [user, admins] = await Promise.all([
        this.userRepo.findOne({ where: { id: message.userId } }),
        this.adminRepo.find(),
      ]);
      const recipients = admins.filter(
        (admin) => admin.phone && admin.phone.length >= 9,
      );

      if (!recipients.length) {
        this.logger.warn('[SMS] No admin phone numbers available for support alert');
        return;
      }

      const displayName =
        user?.name || user?.username || user?.phone || 'a customer';
      const phoneLabel = user?.phone ? ` (${user.phone})` : '';
      const preview = this.truncate(message.content, 70);
      const alert = `PulseLynk Admin: New support message from ${displayName}${phoneLabel}: "${preview}". Reply in Support.`;
      const results = await Promise.all(
        recipients.map((admin) => this.smsService.sendSms(admin.phone, alert)),
      );
      const sentCount = results.filter(Boolean).length;
      this.logger.log(
        `[SMS] Sent support alert to ${sentCount}/${recipients.length} admins`,
      );
    } catch (e) {
      this.logger.warn(
        `[SMS] Failed to send support alert to admins: ${e.message}`,
      );
    }
  }

  private truncate(value: string, maxLength: number): string {
    const normalized = `${value || ''}`.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
  }
}
