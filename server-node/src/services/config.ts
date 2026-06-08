import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '..', '..', 'config.json');

export interface ModelConfig {
  name: string;
  api_key: string;
  base_url: string;
  model_name: string;
}

export interface Config {
  default_model: string;
  models: Record<string, ModelConfig>;
}

const DEFAULT_CONFIG: Config = {
  default_model: 'deepseek-chat',
  models: {
    'deepseek-chat': {
      name: 'DeepSeek',
      api_key: '',
      base_url: 'https://api.deepseek.com/v1',
      model_name: 'deepseek-chat',
    },
    'kimi': {
      name: 'Kimi (月之暗面)',
      api_key: '',
      base_url: 'https://api.moonshot.cn/v1',
      model_name: 'moonshot-v1-128k',
    },
    'qwen-max': {
      name: '通义千问',
      api_key: '',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model_name: 'qwen-max',
    },
    'glm-4': {
      name: '智谱GLM',
      api_key: '',
      base_url: 'https://open.bigmodel.cn/api/paas/v4',
      model_name: 'glm-4',
    },
  },
};

class ConfigService {
  private config: Config = DEFAULT_CONFIG;

  constructor() {
    this.load();
  }

  private async load() {
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(data);
    } catch {
      // config.json 不存在，尝试从 example 复制
      const exampleFile = CONFIG_FILE + '.example';
      try {
        await fs.copyFile(exampleFile, CONFIG_FILE);
        console.log('[Config] 已从 config.json.example 创建 config.json，请填入 API Key');
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        this.config = JSON.parse(data);
      } catch {
        // example 也没有，用内存默认值写一份
        await this.save();
      }
    }
  }

  private async save() {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  getConfig(): Config {
    return this.config;
  }

  async updateConfig(config: Config): Promise<void> {
    // 保留原有的 API Key（如果新值包含 ****）
    for (const [key, model] of Object.entries(config.models)) {
      if (model.api_key && model.api_key.includes('****')) {
        const oldModel = this.config.models[key];
        if (oldModel) {
          model.api_key = oldModel.api_key;
        }
      }
    }
    this.config = config;
    await this.save();
  }

  getModelConfig(modelKey?: string): { apiKey: string; baseURL: string; model: string } {
    const key = modelKey || this.config.default_model;
    const model = this.config.models[key];
    if (!model) {
      throw new Error(`未知模型: ${key}`);
    }
    if (!model.api_key) {
      throw new Error(`模型 ${model.name} 未配置 API Key`);
    }
    return {
      apiKey: model.api_key,
      baseURL: model.base_url,
      model: model.model_name,
    };
  }
}

export const configService = new ConfigService();
