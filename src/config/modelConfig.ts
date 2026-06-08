/** 大模型 API 配置 */

export interface ModelProvider {
  name: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
}

export interface AppConfig {
  defaultModel: string;
  models: Record<string, ModelProvider>;
}

// 默认配置（用于显示）
const DEFAULT_MODELS: Record<string, ModelProvider> = {
  'deepseek-chat': {
    name: 'DeepSeek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    modelName: 'deepseek-chat',
  },
  'qwen-max': {
    name: '通义千问',
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelName: 'qwen-max',
  },
  'glm-4': {
    name: '智谱GLM',
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelName: 'glm-4',
  },
  'kimi': {
    name: 'Kimi (月之暗面)',
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelName: 'moonshot-v1-128k',
  },
};

/** 从后端获取配置 */
export async function fetchModelConfig(): Promise<AppConfig> {
  try {
    const resp = await fetch('/api/config');
    const data = await resp.json();

    // 转换后端配置格式
    const models: Record<string, ModelProvider> = {};
    for (const [key, model] of Object.entries(data.models || {})) {
      const m = model as any;
      models[key] = {
        name: m.name,
        apiKey: m.api_key ? '***已配置***' : '',
        baseUrl: m.base_url,
        modelName: m.model_name,
      };
    }

    return {
      defaultModel: data.default_model || 'deepseek-chat',
      models,
    };
  } catch {
    // 返回默认配置
    return {
      defaultModel: 'deepseek-chat',
      models: DEFAULT_MODELS,
    };
  }
}

/** 获取当前默认模型（同步，用于检查） */
export function getDefaultModel(): { apiKey: string } {
  // 检查后端是否配置了 API Key
  // 这里简化处理，返回一个标记
  return { apiKey: 'configured' };
}
