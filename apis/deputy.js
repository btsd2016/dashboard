// ============================================================
// Deputy API — Labour, Timesheets, Schedules
// Auth: Long-life token (10yr) via DeputyKey header
// ============================================================

const fetch = require('node-fetch');
const { estimateLabourCost } = require('../services/labourEstimator');

const DEPUTY_BASE = `https://${process.env.DEPUTY_SUBDOMAIN}/api/v1`;
// Deputy supports both "DeputyKey" and "Bearer" auth formats
// Some endpoints (QUERY/POST) require Bearer format
const HEADERS = {
  'Authorization': `Bearer ${process.env.DEPUTY_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// Venue mapping: Deputy Location ID → our venue codes
// These IDs will be populated after first API call to /resource/Company
let LOCATION_MAP = {};

// ── Helpers ──────────────────────────────────────────────────

async function deputyGet(path) {
  const res = await fetch(`${DEPUTY_BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Deputy API error ${res.status}: ${path}`);
  return res.json();
}

async function deputyPost(path, body) {
  const res = await fetch(`${DEPUTY_BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deputy POST error ${res.status}: ${path} — ${text}`);
  }
  return res.json();
}

// ── Location discovery ────────────────────────────────────────

async function getLocations() {
  const locations = await deputyGet('/resource/Company?max=100');
  console.log('[Deputy] Locations found:', locations.map(l => `${l.Id}: ${l.CompanyName}`));
  return locations;
}

// ── Timesheets for a date range ───────────────────────────────
// Returns raw timesheets with employee, hours, cost, area

async function getTimesheets(startDate, endDate) {
  // Use supervise/timesheet — returns ALL timesheets across all locations
  // resource/Timesheet/QUERY only returns the API token owner's own timesheets
  const result = await deputyGet(`/supervise/timesheet?start=${startDate}&end=${endDate}`);
  const arr = Array.isArray(result) ? result : Object.values(result || {});
  console.log(`[Deputy] supervise/timesheet returned ${arr.length} timesheets (${startDate} → ${endDate})`);
  return arr;
}

// ── Scheduled shifts for a date range ─────────────────────────

async function getSchedule(startDate, endDate) {
  const body = {
    search: {
      s1: { field: 'Date', type: 'gte', data: startDate },
      s2: { field: 'Date', type: 'lte', data: endDate },
    },
    max: 500,
  };

  const roster = await deputyPost('/resource/Roster/QUERY', body);
  return roster;
}

// ── Employees (to get pay rates and employment type) ──────────

async function getEmployees() {
  const employees = await deputyGet('/resource/Employee?max=200');
  return employees;
}

// ── Work areas ────────────────────────────────────────────────

async function getAreas() {
  const areas = await deputyGet('/resource/OperationalUnit?max=100');
  return areas;
}

// ── Sales forecast (Manager's Forecast from Deputy) ───────────

async function getSalesForecast(locationId, startDate, endDate) {
  try {
    const body = {
      search: {
        s1: { field: 'Company', type: 'eq', data: locationId },
        s2: { field: 'Date', type: 'gte', data: startDate },
        s3: { field: 'Date', type: 'lte', data: endDate },
      },
      max: 100,
    };
    const forecast = await deputyPost('/resource/SalesData/QUERY', body);
    return forecast;
  } catch (e) {
    console.warn('[Deputy] Sales forecast not available:', e.message);
    return [];
  }
}

// ── Main data aggregation for dashboard ──────────────────────

async function getLabourData(startDate, endDate) {
  console.log(`[Deputy] Fetching labour data ${startDate} → ${endDate}`);

  // Note: Roster/Schedule endpoint requires OAuth (not long-life token)
  // Using timesheets only for now — actual hours worked is what we need
  const [timesheets, employees, areas] = await Promise.all([
    getTimesheets(startDate, endDate),
    getEmployees(),
    getAreas(),
  ]);
  const roster = []; // skip for now

  // Build lookup maps
  const employeeMap = {};
  employees.forEach(e => { employeeMap[e.Id] = e; });

  const areaMap = {};
  const areaCompanyMap = {}; // areaId -> companyId
  areas.forEach(a => {
    areaMap[a.Id] = a;
    if (a.Company) areaCompanyMap[a.Id] = a.Company;
  });

  // ── Labour cost estimation ────────────────────────────────
  // Uses Xero payroll rates for unapproved/zero-cost timesheets.
  // Switches to actual Deputy Cost once PayRuleApproved=true (post-Monday payroll).
  const { isEstimated, byLocation: estimatedByLocation, unmatched } =
    estimateLabourCost(timesheets, employeeMap, areaCompanyMap);

  if (unmatched.length > 0) {
    console.warn(`[Deputy] ${unmatched.length} timesheets with no Xero rate match:`,
      unmatched.slice(0, 5).map(u => `${u.name} (co:${u.companyId})`));
  }

  const EXEC_EXCLUSIONS = ['Anna Lisa', 'Easthope', 'Andrew Easthope', 'Ben Rodger', 'Tom Rodger'];

  const result = {
    timesheets: timesheets.length,
    rosterShifts: roster.length,
    isEstimated,              // true = at least one shift used Xero rate; show ~ prefix
    unmatchedCount: unmatched.length,
    byLocation: {},
    byArea: {},
    totalActualHours: 0,
    totalScheduledHours: 0,
    totalWageCost: 0,
    pendingTimesheets: 0,
    raw: { timesheets, roster, employees, areas },
  };

  // Populate byLocation from estimator results
  for (const [cid, loc] of Object.entries(estimatedByLocation)) {
    result.byLocation[cid] = {
      hours: loc.hours,
      cost: loc.cost,
      shifts: loc.shifts,
      estimatedShifts: loc.estimatedShifts,
      actualShifts: loc.actualShifts,
      unmatchedShifts: loc.unmatchedShifts,
      pendingShifts: loc.estimatedShifts,
    };
    result.totalActualHours += loc.hours;
    result.totalWageCost += loc.cost;
    result.pendingTimesheets += loc.estimatedShifts;
  }

  // Area breakdown — hours only (for deep dive view)
  timesheets.forEach(ts => {
    if (ts.IsLeave) return;
    const emp = employeeMap[ts.Employee] || {};
    const empName = emp.DisplayName || '';
    if (EXEC_EXCLUSIONS.some(ex => empName.includes(ex))) return;
    const areaId = ts.OperationalUnit;
    const hours = ts.TotalTime || 0;
    if (areaId && hours > 0) {
      if (!result.byArea[areaId]) {
        const area = areaMap[areaId] || {};
        result.byArea[areaId] = { name: area.OperationalUnitName || areaId, hours: 0, cost: 0 };
      }
      result.byArea[areaId].hours += hours;
    }
  });

  // Scheduled hours
  roster.forEach(shift => {
    const locationId = shift.Company;
    const hours = (shift.TotalTime || 0) / 3600;

    if (!result.byLocation[locationId]) {
      result.byLocation[locationId] = { hours: 0, cost: 0, shifts: 0 };
    }
    result.byLocation[locationId].scheduledHours = 
      (result.byLocation[locationId].scheduledHours || 0) + hours;

    result.totalScheduledHours += hours;
  });

  console.log(`[Deputy] ✅ ${timesheets.length} timesheets, ${roster.length} roster shifts`);
  console.log(`[Deputy] Total hours: ${result.totalActualHours.toFixed(1)}, Cost: $${result.totalWageCost.toFixed(2)}`);

  return result;
}

module.exports = {
  getLocations,
  getTimesheets,
  getSchedule,
  getEmployees,
  getAreas,
  getSalesForecast,
  getLabourData,
};
