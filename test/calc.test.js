'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_SETTINGS } = require('../src/shared/defaults.js');
const calc = require('../src/shared/calc.js');

const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`);
};

const settings = (patch) => Object.assign({}, DEFAULT_SETTINGS, patch);

const fixedDaily = (base, housing, days) => (base + housing) / days;
const classDaily = (rate, morning, morningCoeff, afternoon, afternoonCoeff) =>
  (morning * morningCoeff + afternoon * afternoonCoeff) * rate;

test('2026 年 11 月有 21 个工作日（周一至周五）', () => {
  assert.equal(calc.countWeekdays(2026, 10), 21);
  assert.equal(calc.effectiveWorkdays(settings(), 2026, 10), 21);
});

test('默认：基本工资 10000 + 房补 1000，课时费 6 节 × 35 = 210/天', () => {
  const s = settings();
  const fixed = fixedDaily(10000, 1000, 21);
  assert.equal(calc.classPayPerDay(s), 210);
  near(calc.fixedPayPerDay(s, 2026, 10), fixed);
  near(calc.classPayPerDay(s), classDaily(35, 3, 1, 3, 1));
});

test('普通工作日日薪 = 固定日薪 + 课时费', () => {
  const s = settings();
  const wednesday = new Date(2026, 10, 11);
  assert.equal(calc.dayType(wednesday), 'workday');
  near(calc.dayAmountForDate(wednesday, s), fixedDaily(10000, 1000, 21) + 210);
});

test('周末双休，不计薪', () => {
  const s = settings();
  for (const day of [7, 8]) {
    const weekend = new Date(2026, 10, day);
    assert.equal(calc.dayType(weekend), 'rest');
    assert.equal(calc.dayAmountForDate(weekend, s), 0);
    assert.equal(calc.compute(new Date(2026, 10, day, 10, 0), s).todayEarned, 0);
  }
});

test('课时系数：上午 0.9、下午 1.0', () => {
  const s = settings({ morningCoefficient: 0.9 });
  const wednesday = new Date(2026, 10, 11);
  near(calc.classPayPerDay(s), classDaily(35, 3, 0.9, 3, 1));
  near(calc.classPayPerDay(s), 199.5);
  near(calc.dayAmountForDate(wednesday, s), fixedDaily(10000, 1000, 21) + 199.5);
});

test('可自定义上午/下午节数与系数', () => {
  const s = settings({
    morningClasses: 4,
    afternoonClasses: 2,
    morningCoefficient: 0.8,
    afternoonCoefficient: 1.0
  });
  near(calc.classPayPerDay(s), (4 * 0.8 + 2 * 1) * 35);
  const classes = calc.classBreakdown(s);
  assert.equal(classes.totalClasses, 6);
  near(classes.morningPay, 4 * 0.8 * 35);
  near(classes.afternoonPay, 2 * 35);
});

test('工时进度：08:20-11:40，午休 11:40-14:20，14:20-16:30', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  near(calc.fractionAt(at(8, 0), s), 0);
  near(calc.fractionAt(at(8, 20), s), 0);
  near(calc.fractionAt(at(9, 20), s), 1 / 5.5);
  near(calc.fractionAt(at(11, 40), s), 3.3333333333333335 / 5.5);
  near(calc.fractionAt(at(12, 30), s), 3.3333333333333335 / 5.5);
  near(calc.fractionAt(at(14, 20), s), 3.3333333333333335 / 5.5);
  near(calc.fractionAt(at(15, 20), s), 4.333333333333333 / 5.5);
  near(calc.fractionAt(at(16, 30), s), 1);
  near(calc.fractionAt(at(18, 0), s), 1);
});

test('状态：上班前 / 上午 / 午休 / 下午 / 下班后 / 休息日', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  assert.equal(calc.phaseAt(at(8, 0), s), 'before');
  assert.equal(calc.phaseAt(at(9, 0), s), 'morning');
  assert.equal(calc.phaseAt(at(12, 0), s), 'lunch');
  assert.equal(calc.phaseAt(at(15, 0), s), 'afternoon');
  assert.equal(calc.phaseAt(at(17, 0), s), 'after');
  assert.equal(calc.phaseAt(new Date(2026, 10, 7, 10, 0), s), 'rest');
});

test('倒计时：上班前 / 距午休 / 午休 / 距下班', () => {
  const s = settings();
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  assert.equal(calc.compute(at(8, 0), s).countdownSeconds, 1200);
  assert.equal(calc.compute(at(11, 0), s).countdownSeconds, 2400);
  assert.equal(calc.compute(at(12, 0), s).countdownSeconds, 8400);
  assert.equal(calc.compute(at(15, 0), s).countdownSeconds, 5400);
  assert.equal(calc.compute(at(17, 0), s).countdownSeconds, 0);
});

test('今日已赚包含课时费，午休冻结', () => {
  const s = settings();
  const day = fixedDaily(10000, 1000, 21) + 210;
  const noon = calc.compute(new Date(2026, 10, 11, 12, 0, 0), s);
  const lunch = calc.compute(new Date(2026, 10, 11, 12, 30, 0), s);
  const evening = calc.compute(new Date(2026, 10, 11, 19, 0, 0), s);
  near(noon.todayEarned, day * (3.3333333333333335 / 5.5));
  near(lunch.todayEarned, noon.todayEarned);
  near(lunch.todayClassEarned, 210 * (3.3333333333333335 / 5.5));
  near(evening.todayEarned, day);
});

test('本月 / 本周累计包含课时费（11 月 11 日 19:00）', () => {
  const s = settings();
  const now = new Date(2026, 10, 11, 19, 0, 0);
  const day = fixedDaily(10000, 1000, 21) + 210;
  const result = calc.compute(now, s);

  // 11/2-11/6 + 11/9-11/11 = 8 个工作日
  near(result.monthly, 8 * day);
  // 本周 11/9-11/15 已过 3 个工作日
  near(result.weekly, 3 * day);
  assert.equal(result.weekRangeLabel, '11/9 - 11/15');
  assert.equal(result.phase, 'after');
});

test('本月预计 = 基本工资 + 房补 + 21 天课时费', () => {
  const s = settings();
  const result = calc.compute(new Date(2026, 10, 11, 10, 0, 0), s);
  near(result.monthProjected, 10000 + 1000 + 21 * 210);
  near(result.monthProjected, 15410);
  near(result.weekProjected, 5 * (fixedDaily(10000, 1000, 21) + 210));
});

test('自定义工作时间与午休', () => {
  const s = settings({ workStart: '09:00', workEnd: '17:00', lunchStart: '12:00', lunchEnd: '13:00' });
  const at = (h, m) => new Date(2026, 10, 11, h, m, 0);
  near(calc.fractionAt(at(10, 0), s), 1 / 7);
  near(calc.fractionAt(at(12, 30), s), 3 / 7);
  near(calc.fractionAt(at(14, 0), s), 4 / 7);
});

test('基本工资、房补、课时单价为 0 时不报错', () => {
  const s = settings({ baseSalary: 0, housingAllowance: 0, classRate: 0 });
  const result = calc.compute(new Date(2026, 10, 11, 12, 0, 0), s);
  assert.equal(result.dayAmount, 0);
  assert.equal(result.todayEarned, 0);
  assert.equal(result.dayType, 'workday');
  near(result.fraction, 3.3333333333333335 / 5.5);
});

test('课时费按 (上午节数 × 上午系数 + 下午节数 × 下午系数) 计算', () => {
  const s = settings({
    morningClasses: 5,
    afternoonClasses: 1,
    morningCoefficient: 0.8,
    afternoonCoefficient: 1.0,
    classRate: 40
  });
  near(calc.classPayPerDay(s), (5 * 0.8 + 1) * 40);
  near(calc.classPayPerDay(s), 200);
});
