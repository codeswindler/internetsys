import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum MessageSender {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('support_messages')
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: MessageSender,
    default: MessageSender.USER,
  })
  sender: MessageSender;

  @Column({ default: false })
  isReadByAdmin: boolean;

  @Column({ default: false })
  isReadByUser: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
