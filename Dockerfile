# ============================================
# 阶段1: 构建前端
# ============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# 复制前端依赖文件
COPY package.json package-lock.json ./

# 安装依赖
RUN npm ci --legacy-peer-deps

# 复制前端源码
COPY src/ ./src/
COPY index.html tsconfig.json vite.config.ts ./
COPY public/ ./public/

# 构建前端
RUN npm run build

# ============================================
# 阶段2: 生产镜像
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# 安装后端依赖
COPY server-node/package.json server-node/package-lock.json ./server-node/
RUN cd server-node && npm ci --only=production

# 复制后端源码
COPY server-node/src/ ./server-node/src/
COPY server-node/tsconfig.json ./server-node/
COPY server-node/config.json.example ./server-node/

# 复制构建好的前端文件
COPY --from=frontend-builder /app/dist ./public

# 复制启动脚本
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# 复制模板文件
COPY src/templates/ ./templates/

# 创建数据目录
RUN mkdir -p /app/data/sessions /app/data/superdoc-home /app/data/pdf-library

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8000
ENV DATA_DIR=/app/data

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/api/health || exit 1

# 启动服务
CMD ["./docker-entrypoint.sh"]
