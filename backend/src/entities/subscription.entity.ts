import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { User } from './user.entity';
import { Package } from './package.entity';
import { Router } from './router.entity';
import { DeviceSession } from './device-session.entity';

export enum SubscriptionStatus {
  PENDING = 'PENDING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  VERIFYING = 'VERIFYING',
  PAID = 'PAID',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  MANUAL = 'manual',
  MPESA = 'mpesa',
  VOUCHER = 'voucher',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.subscriptions)
  user: User;

  @ManyToOne(() => Package, (pkg) => pkg.subscriptions)
  package: Package;

  @ManyToOne(() => Router, (router) => router.subscriptions)
  router: Router;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.PENDING,
  })
  status: SubscriptionStatus;

  @Column({ nullable: true })
  mikrotikUsername: string;

  @Column({ nullable: true })
  mikrotikPassword: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ default: false })
  expiryNotified: boolean;

  @Column({ default: false })
  finalExpiryNotified: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountPaid: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.MANUAL,
  })
  paymentMethod: PaymentMethod;

  @Column({ nullable: true })
  paymentRef: string;

  @Column({ nullable: true })
  mpesaCheckoutId: string;

  @OneToMany(() => DeviceSession, (session) => session.subscription)
  deviceSessions: DeviceSession[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
