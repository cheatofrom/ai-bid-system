#!/bin/bash

# 启动脚本：同时启动 Node.js 后端和前端

echo "=========================================="
echo "  标书 Agent 填写系统 - 启动"
echo "=========================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装"
    exit 1
fi

# 安装后端依赖（如果需要）
if [ ! -d "server-node/node_modules" ]; then
    echo -e "${YELLOW}安装后端依赖...${NC}"
    cd server-node
    npm install
    cd ..
fi

# 安装前端依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}安装前端依赖...${NC}"
    npm install
fi

# 创建数据目录
mkdir -p server-node/.data/sessions server-node/.data/superdoc-home server-node/.data/pdf-library

# 启动 Node.js 后端（后台）
echo -e "${GREEN}启动 Node.js 后端 (端口 8000)...${NC}"
cd server-node
npm run dev &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 3

# 启动前端开发服务器（后台）
echo -e "${GREEN}启动前端开发服务器 (端口 3004)...${NC}"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "=========================================="
echo -e "  ${GREEN}服务已启动${NC}"
echo "=========================================="
echo ""
echo "  后端: http://localhost:8000"
echo "  前端: http://localhost:3004"
echo ""
echo "  按 Ctrl+C 停止所有服务"
echo ""

# 捕获退出信号
trap "echo '正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

# 等待进程结束
wait
