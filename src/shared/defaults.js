(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SalaryDefaults = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    // 固定月薪
    baseSalary: 10000,
    housingAllowance: 1000,
    // 课时绩效
    classRate: 35,
    morningClasses: 3,
    afternoonClasses: 3,
    morningCoefficient: 1,
    afternoonCoefficient: 1,
    // 工作时间
    workStart: '08:20',
    workEnd: '16:30',
    lunchStart: '11:40',
    lunchEnd: '14:20',
    // 窗口 / 系统
    alwaysOnTop: true,
    openAtLogin: false,
    windowBounds: null
  });

  return { DEFAULT_SETTINGS };
});
