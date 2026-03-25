import { Test, TestingModule } from '@nestjs/testing';
import { RoutersController } from './routers.controller';

describe('RoutersController', () => {
  let controller: RoutersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoutersController],
    }).compile();

    controller = module.get<RoutersController>(RoutersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
