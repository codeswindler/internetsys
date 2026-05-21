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

  @ManyToOne(
    () => Subscription,
    (subscription) => subscription.deviceSessions,
    { onDelete: 'CASCADE' },
  )
  subscription: Subscription;

  @Column()
  macAddress: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  deviceModel: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastTrafficAt: Date | null;

  @Column({ type: 'bigint', default: 0 })
  lastBytesIn: string;

  @Column({ type: 'bigint', default: 0 })
  lastBytesOut: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
