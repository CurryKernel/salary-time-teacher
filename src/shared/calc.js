(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./defaults.js'));
  } else {
    root.SalaryCalc = factory(root.SalaryDefaults);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Defaults) {
  'use strict';

  const BASE = Defaults.DEFAULT_SETTINGS;
  const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.min(max, Math.max(min, toNumber(value, fallback)));
  }

  function normalizeSettings(settings) {
    const s = Object.assign({}, BASE, settings || {});
    s.baseSalary = clamp(s.baseSalary, 0, 1e9, BASE.baseSalary);
    s.housingAllowance = clamp(s.housingAllowance, 0, 1e9, BASE.housingAllowance);
    s.classRate = clamp(s.classRate, 0, 10000, BASE.classRate);
    s.morningClasses = Math.floor(clamp(s.morningClasses, 0, 20, BASE.morningClasses));
    s.afternoonClasses = Math.floor(clamp(s.afternoonClasses, 0, 20, BASE.afternoonClasses));
    s.morningCoefficient = clamp(s.morningCoefficient, 0, 5, BASE.morningCoefficient);
    s.afternoonCoefficient = clamp(s.afternoonCoefficient, 0, 5, BASE.afternoonCoefficient);
    s.alwaysOnTop = s.alwaysOnTop !== false;
    s.openAtLogin = !!s.openAtLogin;
    return s;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /** 当月周一至周五的天数 */
  function countWeekdays(year, month) {
    let count = 0;
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day++) {
      const weekday = new Date(year, month, day).getDay();
      if (weekday >= 1 && weekday <= 5) count++;
    }
    return count;
  }

  /** 当月计薪天数：按周一至周五自动统计（双休） */
  function effectiveWorkdays(settings, year, month) {
    return countWeekdays(year, month);
  }

  function parseTimeToSeconds(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 3600 + minute * 60;
  }

  /** 一天的工作时段（扣除午休），单位秒 */
  function workPeriod(settings) {
    const s = normalizeSettings(settings);
    const start = parseTimeToSeconds(s.workStart);
    let end = parseTimeToSeconds(s.workEnd);
    let lunchStart = parseTimeToSeconds(s.lunchStart);
    let lunchEnd = parseTimeToSeconds(s.lunchEnd);

    const safeStart = start == null ? 8 * 3600 + 20 * 60 : start;
    let safeEnd = end == null ? 16 * 3600 + 30 * 60 : end;
    if (safeEnd <= safeStart) safeEnd = Math.min(24 * 3600, safeStart + 8 * 3600);
    let safeLunchStart = lunchStart == null ? 11 * 3600 + 40 * 60 : lunchStart;
    let safeLunchEnd = lunchEnd == null ? 14 * 3600 + 20 * 60 : lunchEnd;

    safeLunchStart = Math.min(Math.max(safeLunchStart, safeStart), safeEnd);
    safeLunchEnd = Math.min(Math.max(safeLunchEnd, safeStart), safeEnd);
    if (safeLunchEnd < safeLunchStart) {
      const tmp = safeLunchStart;
      safeLunchStart = safeLunchEnd;
      safeLunchEnd = tmp;
    }

    const lunch = safeLunchEnd - safeLunchStart;
    const total = Math.max(0, safeEnd - safeStart - lunch);

    return {
      start: safeStart,
      end: safeEnd,
      lunchStart: safeLunchStart,
      lunchEnd: safeLunchEnd,
      lunchSeconds: lunch,
      totalSeconds: total
    };
  }

  /** workday | rest（双休，没有加班/月末周六） */
  function dayType(date) {
    const weekday = date.getDay();
    return weekday >= 1 && weekday <= 5 ? 'workday' : 'rest';
  }

  /** 每天课时费 = (上午节数 × 上午系数 + 下午节数 × 下午系数) × 课时单价 */
  function classPayPerDay(settings) {
    const s = normalizeSettings(settings);
    const weightedClasses =
      s.morningClasses * s.morningCoefficient +
      s.afternoonClasses * s.afternoonCoefficient;
    return weightedClasses * s.classRate;
  }

  /** 每天固定工资 = (基本工资 + 房补) ÷ 当月计薪天数 */
  function fixedPayPerDay(settings, year, month) {
    const s = normalizeSettings(settings);
    const workdays = effectiveWorkdays(s, year, month);
    if (!workdays || workdays <= 0) return 0;
    return (s.baseSalary + s.housingAllowance) / workdays;
  }

  function classBreakdown(settings) {
    const s = normalizeSettings(settings);
    const morningPay = s.morningClasses * s.morningCoefficient * s.classRate;
    const afternoonPay = s.afternoonClasses * s.afternoonCoefficient * s.classRate;
    return {
      morningClasses: s.morningClasses,
      afternoonClasses: s.afternoonClasses,
      totalClasses: s.morningClasses + s.afternoonClasses,
      morningCoefficient: s.morningCoefficient,
      afternoonCoefficient: s.afternoonCoefficient,
      morningPay,
      afternoonPay,
      totalPay: morningPay + afternoonPay
    };
  }

  function dayAmountForDate(date, settings) {
    const s = normalizeSettings(settings);
    if (dayType(date) === 'rest') return 0;
    return fixedPayPerDay(s, date.getFullYear(), date.getMonth()) + classPayPerDay(s);
  }

  function secondsOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() +
      date.getMilliseconds() / 1000;
  }

  function fractionAt(date, settings) {
    if (dayType(date) === 'rest') return 0;
    const period = workPeriod(settings);
    if (period.totalSeconds <= 0) {
      return secondsOfDay(date) >= period.end ? 1 : 0;
    }
    const now = secondsOfDay(date);
    if (now <= period.start) return 0;
    if (now >= period.end) return 1;

    const elapsed = now - period.start;
    const lunchOverlap = Math.max(0, Math.min(now, period.lunchEnd) - period.lunchStart);
    const worked = elapsed - lunchOverlap;
    return Math.min(1, Math.max(0, worked / period.totalSeconds));
  }

  /** before | morning | lunch | afternoon | after | rest */
  function phaseAt(date, settings) {
    if (dayType(date) === 'rest') return 'rest';
    const period = workPeriod(settings);
    const now = secondsOfDay(date);
    if (now < period.start) return 'before';
    if (now >= period.end) return 'after';

    if (period.lunchSeconds <= 0) {
      return now < (period.start + period.end) / 2 ? 'morning' : 'afternoon';
    }
    if (now < period.lunchStart) return 'morning';
    if (now < period.lunchEnd) return 'lunch';
    return 'afternoon';
  }

  function remainingSecondsAt(date, settings) {
    const period = workPeriod(settings);
    const now = secondsOfDay(date);
    switch (phaseAt(date, settings)) {
      case 'before': return Math.max(0, period.start - now);
      case 'morning': return Math.max(0, (period.lunchSeconds > 0 ? period.lunchStart : period.end) - now);
      case 'lunch': return Math.max(0, period.lunchEnd - now);
      case 'afternoon': return Math.max(0, period.end - now);
      default: return 0;
    }
  }

  function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  function earnedOnDate(date, now, settings) {
    const dayAmount = dayAmountForDate(date, settings);
    const key = dateKey(date);
    const todayKey = dateKey(now);
    if (key < todayKey) return dayAmount;
    if (key > todayKey) return 0;
    return dayAmount * fractionAt(now, settings);
  }

  function sumDays(startDate, endDate, now, settings, fullDay) {
    let total = 0;
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const last = dateKey(endDate);
    while (dateKey(cursor) <= last) {
      total += fullDay ? dayAmountForDate(cursor, settings) : earnedOnDate(cursor, now, settings);
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function startOfWeekMonday(date) {
    const day = date.getDay();
    const offset = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  }

  function formatMonthDay(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function compute(now, settings) {
    const s = normalizeSettings(settings);
    const date = now instanceof Date ? now : new Date(now);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const totalDays = daysInMonth(year, month);
    const type = dayType(date);
    const period = workPeriod(s);
    const fraction = fractionAt(date, s);
    const workdays = effectiveWorkdays(s, year, month);
    const autoWorkdays = countWeekdays(year, month);
    const fixedDaily = fixedPayPerDay(s, year, month);
    const classDaily = classPayPerDay(s);
    const dayAmount = fixedDaily + classDaily;
    const todayEarned = dayAmount * fraction;
    const classes = classBreakdown(s);
    const phase = phaseAt(date, s);

    let monthly = 0;
    for (let d = 1; d <= day; d++) {
      monthly += earnedOnDate(new Date(year, month, d), date, s);
    }

    const monday = startOfWeekMonday(date);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const weekly = sumDays(monday, date, date, s, false);
    const monthProjected = sumDays(new Date(year, month, 1), new Date(year, month, totalDays), date, s, true);
    const weekProjected = sumDays(monday, sunday, date, s, true);

    return {
      now: date,
      year,
      month,
      day,
      dateLabel: (month + 1) + '月' + day + '日 ' + WEEKDAY_NAMES[date.getDay()],
      monthLabel: (month + 1) + '月',
      weekRangeLabel: formatMonthDay(monday) + ' - ' + formatMonthDay(sunday),
      dayType: type,
      phase,
      fraction,
      dayAmount,
      fixedDaily,
      classDaily,
      todayEarned,
      todayFixedEarned: fixedDaily * fraction,
      todayClassEarned: classDaily * fraction,
      todayRemaining: Math.max(0, dayAmount - todayEarned),
      monthly,
      weekly,
      monthProjected,
      weekProjected,
      monthPercent: monthProjected > 0 ? Math.min(1, monthly / monthProjected) : 0,
      weekPercent: weekProjected > 0 ? Math.min(1, weekly / weekProjected) : 0,
      countdownSeconds: remainingSecondsAt(date, s),
      remainingWorkSeconds: Math.max(0, period.totalSeconds * (1 - fraction)),
      totalWorkSeconds: period.totalSeconds,
      effectiveWorkdays: workdays,
      autoWorkdays,
      totalClasses: classes.totalClasses,
      morningClasses: classes.morningClasses,
      afternoonClasses: classes.afternoonClasses,
      morningCoefficient: classes.morningCoefficient,
      afternoonCoefficient: classes.afternoonCoefficient,
      morningPay: classes.morningPay,
      afternoonPay: classes.afternoonPay,
      classRate: s.classRate,
      hourlyRate: period.totalSeconds > 0 ? dayAmount / (period.totalSeconds / 3600) : 0
    };
  }

  return {
    WEEKDAY_NAMES,
    normalizeSettings,
    daysInMonth,
    countWeekdays,
    effectiveWorkdays,
    parseTimeToSeconds,
    workPeriod,
    dayType,
    classPayPerDay,
    fixedPayPerDay,
    classBreakdown,
    dayAmountForDate,
    fractionAt,
    phaseAt,
    remainingSecondsAt,
    earnedOnDate,
    startOfWeekMonday,
    compute
  };
});
