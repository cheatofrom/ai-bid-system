import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 自动复制 .env.example 为 .env（如果不存在）
const envFile = path.join(__dirname, '../../.env');
const envExample = path.join(__dirname, '../../.env.example');
if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envFile);
  console.log('[启动] 已从 .env.example 创建 .env，请填入 API Key');
}

// 加载 .env 文件
dotenv.config({ path: envFile });

import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/session.js';
import { configRouter } from './routes/config.js';
import { pdfLibraryRouter } from './routes/pdf-library.js';

const app = express();
const PORT = process.env.PORT || 8000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/session', sessionRouter);
app.use('/api/config', configRouter);
app.use('/api/pdf-library', pdfLibraryRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 生产环境下提供前端静态文件
const publicDir = path.join(__dirname, '../../public');
app.use(express.static(publicDir));

// SPA fallback - 所有非API路由返回index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(publicDir, 'index.html'));
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`[server] 服务器已启动: http://localhost:${PORT}`);
});
