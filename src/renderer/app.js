'use strict';

(function () {
  const Calc = window.SalaryCalc;
  const Defaults = window.SalaryDefaults;

  const $ = (id) => document.getElementById(id);

  const ui = {
    widget: $('widget'),
    headerTitle: $('headerTitle'),
    mainView: $('mainView'),
    settingsView: $('settingsView'),
    dateLabel: $('dateLabel'),
    dayBadge: $('dayBadge'),
    todayAmount: $('todayAmount'),
    statusText: $('statusText'),
    pulse: $('pulse'),
    dayBar: $('dayBar'),
    dayPercent: $('dayPercent'),
    dayRange: $('dayRange'),
    monthTag: $('monthTag'),
    monthAmount: $('monthAmount'),
    monthSub: $('monthSub'),
    monthBar: $('monthBar'),
    weekTag: $('weekTag'),
    weekAmount: $('weekAmount'),
    weekSub: $('weekSub'),
    weekBar: $('weekBar'),
    rateInfo: $('rateInfo'),
    modeChip: $('modeChip'),
    pinBtn: $('pinBtn'),
    settingsBtn: $('settingsBtn'),
    hideBtn: $('hideBtn'),
    quitBtn: $('quitBtn'),
    doneBtn: $('doneBtn'),
    resetBtn: $('resetBtn'),
    baseSalary: $('baseSalary'),
    housingAllowance: $('housingAllowance'),
    classRate: $('classRate'),
    morningClasses: $('morningClasses'),
    afternoonClasses: $('afternoonClasses'),
    morningCoefficient: $('morningCoefficient'),
    afternoonCoefficient: $('afternoonCoefficient'),
    classHint: $('classHint'),
    workStart: $('workStart'),
    workEnd: $('workEnd'),
    lunchStart: $('lunchStart'),
    lunchEnd: $('lunchEnd'),
    alwaysOnTop: $('alwaysOnTop'),
    openAtLogin: $('openAtLogin'),
    openAtLoginRow: $('openAtLoginRow'),
    previewFixed: $('previewFixed'),
    previewClass: $('previewClass'),
    previewDay: $('previewDay'),
    previewMonth: $('previewMonth'),
    previewNote: $('previewNote')
  };

  const moneyFormatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let settings = Object.assign({}, Defaults.DEFAULT_SETTINGS);
  let computed = null;
  let packaged = false;
  let view = 'widget';

  let pendingPatch = {};
  let pendingRefresh = false;
  let settingsGeneration = 0;
  let saveTimer = null;
  let tickTimer = null;

  init();

  async function init() {
    try {
      const state = await window.salary.getState();
      if (state && state.settings) settings = state.settings;
      packaged = !!(state && state.packaged);
    } catch (error) {
      console.error('读取设置失败', error);
    }

    fillFormValues();
    bindEvents();

    computed = Calc.compute(new Date(), settings);
    render();
    updatePinButton();

    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      computed = Calc.compute(new Date(), settings);
      render();
    }, 100);

    if (window.salary.onDebugView) {
      window.salary.onDebugView((target) => {
        if (target === 'settings') openSettings();
      });
    }
    if (window.salary.onSettingsUpdated) {
      window.salary.onSettingsUpdated((updated) => {
        if (!updated) return;
        settingsGeneration += 1;
        settings = updated;
        fillFormValues();
        updatePinButton();
        computed = Calc.compute(new Date(), settings);
        render();
      });
    }
  }

  /* ----------------------------- 渲染 ----------------------------- */

  function render() {
    const c = computed;
    if (!c) return;

    ui.widget.classList.toggle('is-rest', c.dayType === 'rest');

    const badgeText = c.dayType === 'rest' ? '休息日' : '工作日';
    const badgeClass = c.dayType === 'rest' ? 'badge badge-rest' : 'badge';
    if (ui.dayBadge.className !== badgeClass) ui.dayBadge.className = badgeClass;
    setText(ui.dayBadge, badgeText);

    setText(ui.dateLabel, c.dateLabel);
    setText(ui.todayAmount, formatMoney(c.todayEarned));
    setText(ui.statusText, statusText(c));

    const pulseClass = 'pulse is-' + c.phase;
    if (ui.pulse.className !== pulseClass) ui.pulse.className = pulseClass;

    ui.dayBar.style.width = (c.fraction * 100).toFixed(3) + '%';
    setText(ui.dayPercent, formatPercent(c.fraction));
    setText(ui.dayRange, workRangeText());

    setText(ui.monthTag, c.monthLabel + ' · ' + c.effectiveWorkdays + '天');
    setText(ui.monthAmount, '¥' + formatMoney(c.monthly));
    setText(ui.monthSub, '预计 ¥' + formatMoney(c.monthProjected));
    ui.monthBar.style.width = (c.monthPercent * 100).toFixed(2) + '%';

    setText(ui.weekTag, c.weekRangeLabel);
    setText(ui.weekAmount, '¥' + formatMoney(c.weekly));
    setText(ui.weekSub, '预计 ¥' + formatMoney(c.weekProjected));
    ui.weekBar.style.width = (c.weekPercent * 100).toFixed(2) + '%';

    setText(ui.rateInfo, '日薪 ¥' + formatMoney(c.dayAmount) + ' · 课时费 ¥' + formatMoney(c.classDaily));
    setText(ui.modeChip, c.totalClasses + ' 节/天');

    updateDerivedUI(c);
  }

  function statusText(c) {
    const countdown = formatCountdown(c.countdownSeconds);
    switch (c.phase) {
      case 'before':
        return '距上班 ' + countdown;
      case 'morning':
        return '上午工作中 · 距午休 ' + countdown;
      case 'lunch':
        return '午休中 · 还有 ' + countdown;
      case 'afternoon':
        return '下午工作中 · 距下班 ' + countdown;
      case 'after':
        return '今日已下班 · 明天继续';
      default:
        return '休息日 · 好好休息';
    }
  }

  function workRangeText() {
    const period = Calc.workPeriod(settings);
    let text = settings.workStart + ' – ' + settings.workEnd;
    const lunch = formatDuration(period.lunchSeconds);
    if (lunch) text += ' · 午休 ' + lunch;
    return text;
  }

  function updateDerivedUI(c) {
    if (!c) return;
    if (ui.openAtLoginRow) ui.openAtLoginRow.hidden = !packaged;

    setText(ui.classHint,
      '每天 ' + c.totalClasses + ' 节课 · 课时费 ¥' + formatMoney(c.classDaily) +
      '（上午 ' + c.morningClasses + ' 节 × ' + trimNumber(c.morningCoefficient) +
      ' + 下午 ' + c.afternoonClasses + ' 节 × ' + trimNumber(c.afternoonCoefficient) + '）');

    setText(ui.previewFixed, '¥' + formatMoney(c.fixedDaily));
    setText(ui.previewClass, '¥' + formatMoney(c.classDaily));
    setText(ui.previewDay, '¥' + formatMoney(c.dayAmount));
    setText(ui.previewMonth, '¥' + formatMoney(c.monthProjected));

    const days = c.effectiveWorkdays;
    setText(ui.previewNote,
      '本月 ' + days + ' 个工作日（双休）。固定日薪 = (基本工资 + 房补) ÷ ' + days +
      '；课时费 = (上午节数 × 上午系数 + 下午节数 × 下午系数) × 课时单价。');
  }

  /* ----------------------------- 表单 ----------------------------- */

  function fillFormValues(force) {
    const setValue = (input, value) => {
      if (force || document.activeElement !== input) input.value = value;
    };

    setValue(ui.baseSalary, trimNumber(settings.baseSalary));
    setValue(ui.housingAllowance, trimNumber(settings.housingAllowance));
    setValue(ui.classRate, trimNumber(settings.classRate));
    setValue(ui.morningClasses, String(settings.morningClasses));
    setValue(ui.afternoonClasses, String(settings.afternoonClasses));
    setValue(ui.morningCoefficient, trimNumber(settings.morningCoefficient));
    setValue(ui.afternoonCoefficient, trimNumber(settings.afternoonCoefficient));
    setValue(ui.workStart, settings.workStart);
    setValue(ui.workEnd, settings.workEnd);
    setValue(ui.lunchStart, settings.lunchStart);
    setValue(ui.lunchEnd, settings.lunchEnd);

    ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    ui.openAtLogin.checked = !!settings.openAtLogin;
  }

  function bindEvents() {
    ui.pinBtn.addEventListener('click', () => {
      commit({ alwaysOnTop: !settings.alwaysOnTop }, { refresh: true });
    });

    ui.settingsBtn.addEventListener('click', () => {
      if (view === 'settings') closeSettings();
      else openSettings();
    });

    ui.hideBtn.addEventListener('click', () => window.salary.hide());
    ui.quitBtn.addEventListener('click', quitApp);
    ui.doneBtn.addEventListener('click', closeSettings);
    ui.resetBtn.addEventListener('click', resetSettings);

    bindNumber('baseSalary', 'baseSalary', { min: 0, max: 1e9, integer: false });
    bindNumber('housingAllowance', 'housingAllowance', { min: 0, max: 1e9, integer: false });
    bindNumber('classRate', 'classRate', { min: 0, max: 10000, integer: false });
    bindNumber('morningClasses', 'morningClasses', { min: 0, max: 20, integer: true });
    bindNumber('afternoonClasses', 'afternoonClasses', { min: 0, max: 20, integer: true });
    bindNumber('morningCoefficient', 'morningCoefficient', { min: 0, max: 5, integer: false });
    bindNumber('afternoonCoefficient', 'afternoonCoefficient', { min: 0, max: 5, integer: false });

    bindTime('workStart', 'workStart');
    bindTime('workEnd', 'workEnd');
    bindTime('lunchStart', 'lunchStart');
    bindTime('lunchEnd', 'lunchEnd');

    bindCheckbox('alwaysOnTop', 'alwaysOnTop');
    bindCheckbox('openAtLogin', 'openAtLogin');

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && view === 'settings') closeSettings();
    });
  }

  function bindNumber(id, key, spec) {
    const input = ui[id];

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '') return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      const value = spec.integer ? Math.floor(n) : n;
      if (value < spec.min || value > spec.max) return;
      commit({ [key]: value });
    });

    input.addEventListener('blur', () => {
      const raw = input.value.trim();
      if (raw === '') {
        input.value = trimNumber(settings[key]);
        return;
      }
      const n = Number(raw);
      let value = Number.isFinite(n) ? n : settings[key];
      if (spec.integer) value = Math.floor(value);
      value = Math.min(spec.max, Math.max(spec.min, value));
      input.value = trimNumber(value);
      commit({ [key]: value });
    });
  }

  function bindTime(id, key) {
    const input = ui[id];

    const orderIsValid = (value) => {
      if (key === 'workStart') return toSeconds(value) < toSeconds(settings.workEnd);
      if (key === 'workEnd') return toSeconds(value) > toSeconds(settings.workStart);
      if (key === 'lunchStart') return toSeconds(value) <= toSeconds(settings.lunchEnd);
      if (key === 'lunchEnd') return toSeconds(value) >= toSeconds(settings.lunchStart);
      return true;
    };

    // 输入小时时会出现 01:00 这类中间值，change 期间不能立刻回退，否则第二位数字输不进去。
    input.addEventListener('change', () => {
      const value = input.value;
      if (!/^\d{2}:\d{2}$/.test(value)) return;
      if (!orderIsValid(value)) return;
      if (value === settings[key]) return;
      commit({ [key]: value }, { refresh: true });
    });

    input.addEventListener('blur', () => {
      const value = input.value;
      if (!/^\d{2}:\d{2}$/.test(value) || !orderIsValid(value)) {
        input.value = settings[key];
        return;
      }
      if (value !== settings[key]) {
        commit({ [key]: value }, { refresh: true });
      }
    });
  }

  function bindCheckbox(id, key) {
    const input = ui[id];
    input.addEventListener('change', () => {
      commit({ [key]: input.checked }, { refresh: true });
    });
  }

  async function quitApp() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (Object.keys(pendingPatch).length > 0) {
      try {
        await flushSave();
      } catch (error) {
        console.error('退出前保存设置失败', error);
      }
    }
    window.salary.quit();
  }

  async function resetSettings() {
    settingsGeneration += 1;
    clearTimeout(saveTimer);
    saveTimer = null;
    pendingPatch = {};
    pendingRefresh = false;
    try {
      settings = await window.salary.resetSettings();
      fillFormValues(true);
      updatePinButton();
      computed = Calc.compute(new Date(), settings);
      render();
    } catch (error) {
      console.error('恢复默认失败', error);
    }
  }

  /* ----------------------------- 存储 ----------------------------- */

  function commit(patch, options) {
    settings = Object.assign({}, settings, patch);
    Object.assign(pendingPatch, patch);
    if (options && options.refresh) pendingRefresh = true;

    updatePinButton();
    computed = Calc.compute(new Date(), settings);
    render();
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }

  async function flushSave() {
    const generation = settingsGeneration;
    const patch = pendingPatch;
    const refresh = pendingRefresh;
    pendingPatch = {};
    pendingRefresh = false;

    try {
      const saved = await window.salary.saveSettings(patch);
      if (saved && generation === settingsGeneration) {
        settings = Object.assign({}, saved, pendingPatch);
        if (refresh && Object.keys(pendingPatch).length === 0) fillFormValues();
        updatePinButton();
        computed = Calc.compute(new Date(), settings);
        render();
      }
    } catch (error) {
      console.error('保存设置失败', error);
    }
  }

  function updatePinButton() {
    ui.pinBtn.classList.toggle('active', !!settings.alwaysOnTop);
    ui.pinBtn.title = settings.alwaysOnTop ? '已置顶（点击取消）' : '始终置顶';
    if (ui.alwaysOnTop.checked !== !!settings.alwaysOnTop) {
      ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    }
  }

  /* ----------------------------- 视图 ----------------------------- */

  function openSettings() {
    if (view === 'settings' || !computed) return;
    view = 'settings';
    ui.mainView.hidden = true;
    ui.settingsView.hidden = false;
    ui.settingsBtn.classList.add('active');
    ui.settingsBtn.title = '返回主界面';
    setText(ui.headerTitle, '设置');
    window.salary.setView('settings');
    updateDerivedUI(computed);
  }

  function closeSettings() {
    if (view !== 'settings') return;
    view = 'widget';
    ui.settingsView.hidden = true;
    ui.mainView.hidden = false;
    ui.settingsBtn.classList.remove('active');
    ui.settingsBtn.title = '设置';
    setText(ui.headerTitle, 'salary-time');
    window.salary.setView('widget');
  }

  /* ----------------------------- 工具 ----------------------------- */

  function toSeconds(value) {
    const parts = String(value).split(':');
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
  }

  function formatMoney(value) {
    return moneyFormatter.format(Number.isFinite(value) ? value : 0);
  }

  function formatPercent(fraction) {
    const percent = Math.min(1, Math.max(0, fraction)) * 100;
    return (percent >= 99.95 ? '100' : percent.toFixed(1)) + '%';
  }

  function formatCountdown(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes <= 0) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return h + 'h' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function trimNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return String(Number(value.toFixed(4)));
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }
})();
