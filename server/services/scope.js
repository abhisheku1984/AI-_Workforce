/**
 * Data-scope enforcement.
 *
 * Tenant isolation is enforced by including org_id in EVERY query.
 * Within a tenant, users with department / business-unit scoped roles only see data
 * inside their scope. This is applied when data is LOADED (before calculation),
 * so an out-of-scope record can never influence any number a user sees.
 */
import { getDb } from '../db/index.js';

export function employeeScopeSql(principal, params = {}, alias = 'e') {
  const clauses = [`${alias}.org_id = @__orgId`];
  params.__orgId = principal.orgId;
  if (principal.scope.restricted) {
    const bu = principal.scope.businessUnitIds || [];
    const dept = principal.scope.departmentIds || [];
    if (!bu.length && !dept.length) {
      clauses.push('1 = 0'); // restricted with no grants => no data
    } else {
      const parts = [];
      if (bu.length) {
        parts.push(`${alias}.business_unit_id IN (${bu.map((_, i) => `@__bu${i}`).join(',')})`);
        bu.forEach((v, i) => { params[`__bu${i}`] = v; });
      }
      if (dept.length) {
        parts.push(`${alias}.department_id IN (${dept.map((_, i) => `@__dept${i}`).join(',')})`);
        dept.forEach((v, i) => { params[`__dept${i}`] = v; });
      }
      clauses.push(`(${parts.join(' OR ')})`);
    }
  }
  return clauses.join(' AND ');
}

export function loadScopeEmployees(principal, { statuses = null } = {}) {
  const params = {};
  const where = [employeeScopeSql(principal, params, 'e')];
  if (statuses?.length) {
    where.push(`e.status IN (${statuses.map((_, i) => `@__st${i}`).join(',')})`);
    statuses.forEach((s, i) => { params[`__st${i}`] = s; });
  }
  return getDb()
    .prepare(
      `SELECT e.* FROM employees e WHERE ${where.join(' AND ')} ORDER BY e.full_name`
    )
    .all(params);
}

export function canSeeEmployee(principal, employee) {
  if (!employee) return false;
  if (employee.org_id !== principal.orgId) return false;
  if (!principal.scope.restricted) return true;
  const buOk = (principal.scope.businessUnitIds || []).includes(employee.business_unit_id);
  const deptOk = (principal.scope.departmentIds || []).includes(employee.department_id);
  return buOk || deptOk;
}

export function canSeeProject(principal, project) {
  if (!project) return false;
  if (project.org_id !== principal.orgId) return false;
  if (!principal.scope.restricted) return true;
  const buOk = (principal.scope.businessUnitIds || []).includes(project.business_unit_id);
  const deptOk = (principal.scope.departmentIds || []).includes(project.department_id);
  return buOk || deptOk;
}

/** Employees in scope for project-level views (projects have no employee). */
export function loadScopeProjects(principal) {
  const params = {};
  const where = ['p.org_id = @__orgId'];
  params.__orgId = principal.orgId;
  if (principal.scope.restricted) {
    const bu = principal.scope.businessUnitIds || [];
    const dept = principal.scope.departmentIds || [];
    if (!bu.length && !dept.length) where.push('1 = 0');
    else {
      const parts = [];
      if (bu.length) { parts.push(`p.business_unit_id IN (${bu.map((_, i) => `@__bup${i}`).join(',')})`); bu.forEach((v, i) => { params[`__bup${i}`] = v; }); }
      if (dept.length) { parts.push(`p.department_id IN (${dept.map((_, i) => `@__dp${i}`).join(',')})`); dept.forEach((v, i) => { params[`__dp${i}`] = v; }); }
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  return getDb().prepare(`SELECT p.* FROM projects p WHERE ${where.join(' AND ')} ORDER BY p.name`).all(params);
}

/** Strip cost fields when the user lacks workforce.cost.view. */
export function maySeeCost(principal) {
  return principal.permissions.has('workforce.cost.view') || principal.isPlatformAdmin;
}

export function maySeeFinance(principal) {
  return principal.permissions.has('finance.view') || principal.isPlatformAdmin;
}
