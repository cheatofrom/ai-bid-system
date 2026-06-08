import { Router, Request, Response } from 'express';
import { configService } from '../services/config.js';

export const configRouter = Router();

// 获取配置
configRouter.get('/', (req: Request, res: Response) => {
  const config = configService.getConfig();

  // 隐藏 API Key
  const masked = JSON.parse(JSON.stringify(config));
  for (const model of Object.values(masked.models)) {
    if ((model as any).api_key) {
      (model as any).api_key = (model as any).api_key.substring(0, 8) + '****';
    }
  }

  res.json(masked);
});

// 更新配置
configRouter.post('/', async (req: Request, res: Response) => {
  try {
    await configService.updateConfig(req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
