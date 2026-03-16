// ============================================================
// Labour Cost Estimator — Mid-week estimated labour %
// services/labourEstimator.js
// ============================================================
//
// Cost resolution priority per timesheet:
//   1. Deputy Cost (if PayRuleApproved=true AND Cost > 0) → actual
//   2. Xero rate lookup → estimated
//      - Casual:  unit_rate × hours × (1.2 if Sat/Sun)
//      - Salaried: (annual / 52 / std_weekly_hours) × hours, no WE loading
//   3. No match → logged to unmatched[], hours still counted
//
// isEstimated flag:
//   true  → at least one timesheet used Xero rate (show ~28.3%)
//   false → all timesheets used actual Deputy cost (show 28.3%)
// ============================================================

const path = require('path');
const XERO_RATES = require('./xeroRates.json');

const WEEKEND_MULTIPLIER = 1.2;

// Is the date string (YYYY-MM-DD or ISO) a Saturday or Sunday?
function isWeekend(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

function r2(n) { return Math.round(n * 100) / 100; }

/**
 * estimateLabourCost(timesheets, employeeMap)
 *
 * @param {Array}  timesheets  - raw Deputy timesheet objects from getTimesheets()
 * @param {Object} employeeMap - { [employeeId]: employeeObject } built in getLabourData()
 * @param {Object} areaCompanyMap - { [areaId]: companyId } for null-company fallback
 *
 * @returns {Object} {
 *   isEstimated: bool,
 *   byLocation: {
 *     [companyId]: {
 *       cost, hours, shifts,
 *       estimatedShifts, unmatchedShifts, actualShifts
 *     }
 *   },
 *   unmatched: [{ name, companyId, hours, timesheetId }]
 * }
 */
function estimateLabourCost(timesheets, employeeMap, areaCompanyMap) {
  const byLocation = {};
  const unmatched = [];
  let anyEstimated = false;

  // Exec staff to exclude (same list as deputy.js)
  const EXEC_EXCLUSIONS = ['Anna Lisa', 'Easthope', 'Andrew Easthope', 'Ben Rodger', 'Tom Rodger'];

  for (const ts of timesheets) {
    if (ts.IsLeave) continue;

    const emp = employeeMap[ts.Employee] || {};
    const empName = emp.DisplayName || '';

    if (EXEC_EXCLUSIONS.some(ex => empName.includes(ex))) continue;

    // Resolve company ID (same logic as deputy.js)
    const companyId = ts.Company
      || ts._DPMetaData?.OperationalUnitInfo?.Company
      || ts._DPMetaData?.CompanyObject?.Id
      || (ts.OperationalUnit ? areaCompanyMap[ts.OperationalUnit] : null)
      || emp.Company
      || null;

    if (!companyId) continue;

    // TotalTime is already in hours in this codebase
    const hours = ts.TotalTime || 0;
    if (hours <= 0) continue;

    if (!byLocation[companyId]) {
      byLocation[companyId] = {
        cost: 0, hours: 0, shifts: 0,
        estimatedShifts: 0, unmatchedShifts: 0, actualShifts: 0,
      };
    }
    const loc = byLocation[companyId];
    loc.shifts++;
    loc.hours = r2(loc.hours + hours);

    // ── 1. Use actual Deputy cost if approved ────────────────
    const deputyCost = ts.Cost || 0;
    const isApproved = ts.PayRuleApproved === true || ts.TimeApproved === true;

    if (isApproved && deputyCost > 0) {
      loc.cost = r2(loc.cost + deputyCost);
      loc.actualShifts++;
      continue;
    }

    // ── 2. Estimate from Xero rates ──────────────────────────
    anyEstimated = true;
    loc.estimatedShifts++;

    const rateInfo = lookupRate(empName, companyId);

    if (!rateInfo) {
      loc.unmatchedShifts++;
      unmatched.push({
        name: empName || `(employee ${ts.Employee})`,
        companyId,
        hours,
        timesheetId: ts.Id,
      });
      continue;
    }

    const cost = computeCost(rateInfo, hours, ts.Date);
    loc.cost = r2(loc.cost + cost);
  }

  return { isEstimated: anyEstimated, byLocation, unmatched };
}

/**
 * Look up rate for (name, companyId). Falls back to same name in any company.
 */
function lookupRate(name, companyId) {
  if (!name) return null;

  // Exact match first
  const exact = XERO_RATES[`${name}|${companyId}`];
  if (exact) return exact;

  // Cross-venue fallback: staff sometimes clock into a different venue
  for (const cid of [1, 2, 3, 4]) {
    const fb = XERO_RATES[`${name}|${cid}`];
    if (fb) return fb;
  }

  return null;
}

/**
 * Compute labour cost for one shift.
 */
function computeCost(rateInfo, hours, dateStr) {
  if (rateInfo.is_salaried) {
    // Salaried: no weekend loading, use annual/52/std_hrs
    const rate = rateInfo.salary_hourly
      || (rateInfo.annual_salary / 52 / rateInfo.std_weekly_hours);
    return r2(rate * hours);
  } else {
    const multiplier = isWeekend(dateStr) ? WEEKEND_MULTIPLIER : 1.0;
    return r2(rateInfo.unit_rate * hours * multiplier);
  }
}

module.exports = { estimateLabourCost };
