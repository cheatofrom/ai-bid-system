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

class ConfigService {
  private config: Config | null = null;

  private loadFromEnv(): Config {
    const apiKey = process.env.OPENAI_API_KEY || '';
    const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    return {
      default_model: 'env-model',
      models: {
        'env-model': {
          name: process.env.MODEL_NAME || 'AI Model',
          api_key: apiKey,
          base_url: baseURL,
          model_name: model,
        },
      },
    };
  }

  getConfig(): Config {
    if (!this.config) {
      this.config = this.loadFromEnv();
    }
    return this.config;
  }

  async updateConfig(config: Config): Promise<void> {
    this.config = config;
  }

  getModelConfig(modelKey?: string): { apiKey: string; baseURL: string; model: string } {
    const config = this.getConfig();
    const key = modelKey || config.default_model;
    const model = config.models[key];
    if (!model) {
      throw new Error(`未知模型: ${key}`);
    }
    if (!model.api_key) {
      throw new Error(`模型 ${model.name} 未配置 API Key，请设置 OPENAI_API_KEY 环境变量`);
    }
    return {
      apiKey: model.api_key,
      baseURL: model.base_url,
      model: model.model_name,
    };
  }
}

export const configService = new ConfigService();
