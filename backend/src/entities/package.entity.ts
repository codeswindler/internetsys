import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Subscription } from './subscription.entity';
import { Voucher } from './voucher.entity';

export enum DurationType {
  MINUTES = 'minutes',
  HOURS = 'hours',
  DAYS = 'days',
  WEEKS = 'weeks',
  MONTHS = 'months',
}

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: DurationType,
    default: DurationType.HOURS,
  })
  durationType: DurationType;

  @Column({ type: 'int' })
  durationValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column()
  bandwidthProfile: string;

  @Column({ type: 'int', default: 0, comment: 'Limit in MB. 0 = unlimited' })
  dataLimitMB: number;

  @Column({ nullable: true })
  downloadSpeed: string;

  @Column({ nullable: true })
  uploadSpeed: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1, comment: 'Maximum concurrent devices' })
  maxDevices: number;

  @OneToMany(() => Subscription, (subscription) => subscription.package)
  subscriptions: Subscription[];

  @OneToMany(() => Voucher, (voucher) => voucher.package)
  vouchers: Voucher[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
