import { Body, Controller, Get, Headers, Ip, Logger, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('hotspot-trace')
  traceHotspotGet(
    @Query() query: Record<string, string>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent = '',
  ) {
    this.logHotspotTrace(query, ip, userAgent);
    return { ok: true };
  }

  @Post('hotspot-trace')
  traceHotspotPost(
    @Body() body: Record<string, string>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent = '',
  ) {
    this.logHotspotTrace(body, ip, userAgent);
    return { ok: true };
  }

  private logHotspotTrace(
    data: Record<string, string> = {},
    ip: string,
    userAgent: string,
  ) {
    const step = data.step || 'unknown';
    const sub = data.sub || 'none';
    const path = data.path || 'none';
    const token = data.token || 'unknown';
    const detail = data.detail || 'none';

    this.logger.log(
      `[HOTSPOT TRACE] step=${step} sub=${sub} path=${path} token=${token} ip=${ip} detail=${detail} ua=${userAgent}`,
    );
  }
}
