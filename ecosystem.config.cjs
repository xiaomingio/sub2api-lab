/*
 * 文件说明: 定义 sub2api-lab 在 PM2 中的进程名称、入口脚本和运行环境。
 */

module.exports = {
  apps: [
    {
      name: "sub2api-lab",
      script: "dist/server.js",
      interpreter: "node",
      node_args: "--env-file=.env.production",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
