import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionRouter } from './routes/session.js';
import { configRouter } from './routes/config.js';
import { pdfLibraryRouter } from './routes/pdf-library.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
