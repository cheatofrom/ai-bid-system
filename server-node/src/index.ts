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

// 启动服务器
app.listen(PORT, () => {
  console.log(`[server] 服务器已启动: http://localhost:${PORT}`);
});
