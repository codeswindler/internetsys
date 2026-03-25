import { Test, TestingModule } from '@nestjs/testing';
import { MikrotikService } from './mikrotik.service';

describe('MikrotikService', () => {
  let service: MikrotikService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MikrotikService],
    }).compile();

    service = module.get<MikrotikService>(MikrotikService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
