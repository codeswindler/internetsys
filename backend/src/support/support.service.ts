import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportMessage, MessageSender } from '../entities/support-message.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportMessage)
    private messageRepo: Repository<SupportMessage>,
  ) {}

  async sendMessage(userId: string, content: string, sender: MessageSender): Promise<SupportMessage> {
    const message = this.messageRepo.create({
      userId,
      content,
      sender,
      isReadByAdmin: sender === MessageSender.ADMIN,
      isReadByUser: sender === MessageSender.USER,
    });
    return this.messageRepo.save(message);
  }

  async getMessagesForUser(userId: string): Promise<SupportMessage[]> {
    const messages = await this.messageRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    
    // Mark as read by user
    await this.messageRepo.update({ userId, sender: MessageSender.ADMIN }, { isReadByUser: true });
    
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
        where: { userId: item.userId, sender: MessageSender.USER, isReadByAdmin: false },
      });

      const userName = lastMsg?.user ? (lastMsg.user.username || lastMsg.user.name) : 'Unknown';
      
      const conv: any = {
        userId: item.userId,
        userName,
        lastMessage: lastMsg?.content,
        lastTime: new Date(item.latest),
        unreadCount,
      };
      conversations.push(conv);
    }
    
    return conversations.sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime());
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
}
