import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity('device_sessions')
export class DeviceSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subscription, (subscription) => subscription.deviceSessions, { onDelete: 'CASCADE' })
  subscription: Subscription;

  @Column()
  macAddress: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  deviceModel: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
