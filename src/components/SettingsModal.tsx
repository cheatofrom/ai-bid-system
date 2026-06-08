/** 设置弹窗 — 配置大模型 API Key */

import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, message, Space, Typography, Spin, Card, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface ModelConfig {
  name: string;
  api_key: string;
  base_url: string;
  model_name: string;
}

interface ConfigData {
  default_model: string;
  models: Record<string, ModelConfig>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 加载配置
  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch('/api/config')
        .then(r => r.json())
        .then(data => {
          setConfig(data);
          setLoading(false);
        })
        .catch(() => {
          message.error('加载配置失败');
          setLoading(false);
        });
    }
  }, [open]);

  // 保存配置
  const handleSave = () => {
    if (!config) return;
    setSaving(true);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(r => r.json())
      .then(() => {
        message.success('配置已保存');
        onClose();
      })
      .catch(() => {
        message.error('保存失败');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const currentKey = config?.default_model || 'kimi';
  const currentModel = config?.models?.[currentKey];

  const updateModel = (key: string, field: keyof ModelConfig, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      models: {
        ...config.models,
        [key]: {
          ...config.models[key],
          [field]: value,
        },
      },
    });
  };

  // 添加自定义模型
  const addCustomModel = () => {
    if (!config) return;
    const key = `custom_${Date.now()}`;
    setConfig({
      ...config,
      models: {
        ...config.models,
        [key]: {
          name: '自定义模型',
          api_key: '',
          base_url: '',
          model_name: '',
        },
      },
    });
  };

  // 删除模型
  const deleteModel = (key: string) => {
    if (!config) return;
    const newModels = { ...config.models };
    delete newModels[key];
    setConfig({
      ...config,
      models: newModels,
      default_model: currentKey === key ? Object.keys(newModels)[0] || '' : config.default_model,
    });
  };

  return (
    <Modal
      title="设置"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            保存
          </Button>
        </Space>
      }
      width={700}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="加载配置中..." />
        </div>
      ) : config ? (
        <div>
          <Form layout="vertical" style={{ marginBottom: 16 }}>
            <Form.Item label="默认模型">
              <Select
                value={currentKey}
                onChange={(v) => setConfig({ ...config, default_model: v })}
                options={Object.entries(config.models).map(([key, m]) => ({
                  value: key,
                  label: m.name || key,
                }))}
              />
            </Form.Item>
          </Form>

          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {Object.entries(config.models).map(([key, model]) => (
              <Card
                key={key}
                size="small"
                title={
                  <Space>
                    <span>{model.name || key}</span>
                    {key === currentKey && <Text type="success" style={{ fontSize: 12 }}>(默认)</Text>}
                  </Space>
                }
                extra={
                  !['deepseek-chat', 'kimi', 'qwen-max', 'glm-4'].includes(key) && (
                    <Popconfirm title="确定删除？" onConfirm={() => deleteModel(key)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )
                }
                style={{ marginBottom: 12 }}
              >
                <Form layout="vertical" size="small">
                  <Form.Item label="显示名称">
                    <Input
                      value={model.name}
                      onChange={(e) => updateModel(key, 'name', e.target.value)}
                      placeholder="模型名称"
                    />
                  </Form.Item>
                  <Form.Item label="API Key">
                    <Input.Password
                      value={model.api_key}
                      onChange={(e) => updateModel(key, 'api_key', e.target.value)}
                      placeholder="输入 API Key"
                    />
                  </Form.Item>
                  <Form.Item label="API Base URL">
                    <Input
                      value={model.base_url}
                      onChange={(e) => updateModel(key, 'base_url', e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </Form.Item>
                  <Form.Item label="模型名称">
                    <Input
                      value={model.model_name}
                      onChange={(e) => updateModel(key, 'model_name', e.target.value)}
                      placeholder="model-name"
                    />
                  </Form.Item>
                </Form>
              </Card>
            ))}
          </div>

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addCustomModel}
            block
            style={{ marginTop: 12 }}
          >
            添加自定义模型
          </Button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          加载配置失败
        </div>
      )}
    </Modal>
  );
}
