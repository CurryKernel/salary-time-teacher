'use strict';

/**
 * 教师版渲染层冒烟测试（在 Electron 中运行）：
 *   npm run test:ui
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const { DEFAULT_SETTINGS } = require('../src/shared/defaults.js');
const calc = require('../src/shared/calc.js');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'salary-time-teacher-test-')));

let savedSettings = Object.assign({}, DEFAULT_SETTINGS);
const calls = { saves: [], views: [], hidden: 0, quit: 0 };

ipcMain.handle('app:get-state', () => ({
  settings: savedSettings,
  version: 'test',
  platform: process.platform,
  packaged: false
}));

ipcMain.handle('settings:save', (event, patch) => {
  calls.saves.push(patch);
  savedSettings = Object.assign({}, savedSettings, patch);
  return savedSettings;
});

ipcMain.handle('settings:reset', () => {
  savedSettings = Object.assign({}, DEFAULT_SETTINGS);
  return savedSettings;
});

ipcMain.on('window:set-view', (event, view) => calls.views.push(view));
ipcMain.on('window:hide', () => { calls.hidden += 1; });
ipcMain.on('window:quit', () => { calls.quit += 1; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function money(value) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

const results = [];
function ok(name, condition, detail) {
  if (!condition) throw new Error('断言失败：' + name + (detail ? ' — ' + detail : ''));
  results.push(name);
  console.log('  ✔ ' + name);
}

async function main() {
  const window = new BrowserWindow({
    width: 400,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(300);

  const run = (script) => window.webContents.executeJavaScript(script);
  const now = new Date();
  const workdays = calc.countWeekdays(now.getFullYear(), now.getMonth());
  const defaultFixed = (10000 + 1000) / workdays;
  const defaultClass = 210;
  const defaultDay = defaultFixed + defaultClass;
  const defaultMonth = 11000 + workdays * 210;

  // 初始状态
  let state = await run(`({
    mode: document.getElementById('modeChip').textContent,
    amount: document.getElementById('todayAmount').textContent,
    monthly: document.getElementById('monthAmount').textContent,
    monthTag: document.getElementById('monthTag').textContent,
    settingsHidden: document.getElementById('settingsView').hidden
  })`);
  ok('默认每天 6 节课', state.mode.includes('6 节/天'), state.mode);
  ok('主界面默认可见', state.settingsHidden === true);
  ok('今日金额已渲染', /^[\d,]+\.\d{2}$/.test(state.amount), state.amount);
  ok('本月累计已渲染', /^¥[\d,]+\.\d{2}$/.test(state.monthly), state.monthly);
  ok('本月卡片显示计薪天数', state.monthTag.includes(workdays + '天'), state.monthTag);

  // 打开设置
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(200);
  state = await run(`({
    settingsHidden: document.getElementById('settingsView').hidden,
    mainHidden: document.getElementById('mainView').hidden
  })`);
  ok('点击齿轮打开设置页', state.settingsHidden === false && state.mainHidden === true);
  ok('通知主进程调整窗口高度', calls.views[calls.views.length - 1] === 'settings');

  // 默认预览
  state = await run(`({
    fixed: document.getElementById('previewFixed').textContent,
    classPay: document.getElementById('previewClass').textContent,
    day: document.getElementById('previewDay').textContent,
    month: document.getElementById('previewMonth').textContent,
    hint: document.getElementById('classHint').textContent,
    autoRowHidden: document.getElementById('openAtLoginRow').hidden
  })`);
  ok('固定日薪按当月工作日摊算', state.fixed === '¥' + money(defaultFixed), state.fixed);
  ok('默认课时费 6 节 × 35', state.classPay === '¥' + money(defaultClass), state.classPay);
  ok('日合计 = 固定日薪 + 课时费', state.day === '¥' + money(defaultDay), state.day);
  ok('本月预计包含全部课时费', state.month === '¥' + money(defaultMonth), state.month);
  ok('课时提示显示 6 节', state.hint.includes('每天 6 节课'), state.hint);
  ok('开发/启动器模式隐藏开机自启', state.autoRowHidden === true);

  // 上午系数改为 0.9
  await run(`(() => {
    const input = document.getElementById('morningCoefficient');
    input.value = '0.9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700);
  const classWithCoeff = (3 * 0.9 + 3 * 1) * 35;
  state = await run(`({
    classPay: document.getElementById('previewClass').textContent,
    hint: document.getElementById('classHint').textContent
  })`);
  ok('上午系数 0.9 参与课时费计算', state.classPay === '¥' + money(classWithCoeff), state.classPay);
  ok('课时提示显示系数', state.hint.includes('0.9'), state.hint);
  ok('设置已持久化（上午系数）', calls.saves.some((p) => p.morningCoefficient === 0.9));

  // 上午 4 节、下午 3 节
  await run(`(() => {
    for (const [id, value] of [['morningClasses', '4'], ['afternoonClasses', '3']]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(700);
  const customClass = (4 * 0.9 + 3 * 1) * 35;
  state = await run(`({
    classPay: document.getElementById('previewClass').textContent,
    hint: document.getElementById('classHint').textContent,
    mode: document.getElementById('modeChip').textContent
  })`);
  ok('自定义节数参与课时费计算', state.classPay === '¥' + money(customClass), state.classPay);
  ok('课时提示显示每天 7 节', state.hint.includes('每天 7 节课'), state.hint);
  ok('主界面同步每天节数', state.mode.includes('7 节/天'), state.mode);

  // 课时单价改为 40
  await run(`(() => {
    const input = document.getElementById('classRate');
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700);
  const rateClass = (4 * 0.9 + 3 * 1) * 40;
  state = await run(`document.getElementById('previewClass').textContent`);
  ok('课时单价可调整', state === '¥' + money(rateClass), state);
  ok('设置已持久化（课时单价）', calls.saves.some((p) => p.classRate === 40));

  // 时间输入回归：小时中间值不能立即回退
  await run(`(() => {
    const input = document.getElementById('workEnd');
    input.value = '01:00';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(150);
  state = await run(`document.getElementById('workEnd').value`);
  ok('下班时间的小时中间值不会被立即回退', state === '01:00', state);
  ok('非法中间值不会写入设置', !calls.saves.some((p) => p.workEnd === '01:00'));

  await run(`document.getElementById('workEnd').dispatchEvent(new Event('blur', { bubbles: true }))`);
  await sleep(150);
  state = await run(`document.getElementById('workEnd').value`);
  ok('失焦后非法时间恢复原值', state === '16:30', state);

  await run(`(() => {
    const input = document.getElementById('workEnd');
    input.value = '17:30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`document.getElementById('workEnd').value`);
  ok('合法的下班时间可以正常保存', state === '17:30' && calls.saves.some((p) => p.workEnd === '17:30'), state);

  // 完成返回
  await run(`document.getElementById('doneBtn').click()`);
  await sleep(200);
  state = await run(`({
    settingsHidden: document.getElementById('settingsView').hidden,
    mainHidden: document.getElementById('mainView').hidden
  })`);
  ok('点击完成返回主界面', state.settingsHidden === true && state.mainHidden === false);
  ok('通知主进程恢复窗口高度', calls.views[calls.views.length - 1] === 'widget');

  // Esc 关闭
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(150);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(150);
  state = await run(`document.getElementById('settingsView').hidden`);
  ok('Esc 关闭设置页', state === true);

  // 隐藏与退出
  await run(`document.getElementById('hideBtn').click()`);
  await sleep(120);
  ok('点击减号隐藏到托盘', calls.hidden === 1);

  await run(`document.getElementById('quitBtn').click()`);
  await sleep(120);
  ok('点击 × 退出应用', calls.quit === 1);

  // 恢复默认
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(150);
  await run(`document.getElementById('resetBtn').click()`);
  await sleep(300);
  state = await run(`({
    base: document.getElementById('baseSalary').value,
    housing: document.getElementById('housingAllowance').value,
    rate: document.getElementById('classRate').value,
    morning: document.getElementById('morningClasses').value,
    coefficient: document.getElementById('morningCoefficient').value,
    mode: document.getElementById('modeChip').textContent,
    fixed: document.getElementById('previewFixed').textContent,
    classPay: document.getElementById('previewClass').textContent
  })`);
  ok('恢复默认基本工资 10000', state.base === '10000', state.base);
  ok('恢复默认房补 1000', state.housing === '1000', state.housing);
  ok('恢复默认课时单价 35', state.rate === '35', state.rate);
  ok('恢复默认上午 3 节', state.morning === '3', state.morning);
  ok('恢复默认系数 1', state.coefficient === '1', state.coefficient);
  ok('恢复默认后每天 6 节', state.mode.includes('6 节/天'), state.mode);
  ok('恢复默认后固定日薪正确', state.fixed === '¥' + money(defaultFixed), state.fixed);
  ok('恢复默认后课时费正确', state.classPay === '¥' + money(defaultClass), state.classPay);

  window.destroy();
  console.log('\n教师版 UI 冒烟测试通过：' + results.length + ' 项断言');
  app.exit(0);
}

const timeout = setTimeout(() => {
  console.error('UI 冒烟测试超时');
  app.exit(1);
}, 20000);
timeout.unref();

app.whenReady().then(() => {
  main().catch((error) => {
    console.error('\nUI 冒烟测试失败：');
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
});
