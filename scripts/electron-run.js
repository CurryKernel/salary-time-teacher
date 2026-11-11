'use strict';

/**
 * 跨平台启动 Electron 的小包装。
 *
 * 某些 IDE / 终端环境会注入 ELECTRON_RUN_AS_NODE=1，
 * 导致 Electron 以纯 Node 模式运行（此时 require('electron') 拿不到 app）。
 * 这里在启动子进程前主动移除该变量。
 */

const { spawn } = require('node:child_process');
const electron = require('electron');

const args = process.argv.slice(2);
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, args.length ? args : ['.'], {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 0 : code);
});

child.on('error', (error) => {
  console.error('启动 Electron 失败:', error);
  process.exit(1);
});
