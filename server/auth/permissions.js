/**
 * Permission catalogue + role templates.
 *
 * Permissions are enforced in the backend on every request (never in the UI only).
 * Tenant isolation is structural: every query helper requires an org_id, and a
 * user's org_id comes from their authenticated session — never from the request body.
 */

export const PERMISSIONS = {
  'org.view': 'View organization profile and settings',
  'org.manage': 'Edit organization profile, structure and settings',
  'user.view': 'View users',
  'user.manage': 'Invite, edit, suspend users and assign roles',
  'role.manage': 'Create and edit roles and permissions',
  'workforce.view': 'View employees and resources (non-financial fields)',
  'workforce.manage': 'Create and edit employees, skills and assignments',
  'workforce.cost.view': 'View employee cost and compensation data',
  'project.view': 'View projects and demand records',
  'project.manage': 'Create and edit projects and demand',
  'allocation.view': 'View allocations',
  'allocation.manage': 'Create and edit allocations',
  'finance.view': 'View billing, revenue, cost and margin data',
  'analytics.utilization': 'View utilization and capacity analytics',
  'analytics.executive': 'View executive dashboards',
  'report.view': 'View and export reports',
  'ai.assistant': 'Use the AI business assistant',
  'ai.insights': 'View and review AI insights and recommendations',
  'forecast.view': 'View forecasts',
  'import.manage': 'Upload, map, validate and commit data',
  'audit.view': 'View audit history',
  'approval.manage': 'Approve or reject requests',
  'automation.manage': 'Configure and run automation rules',
  'admin.platform': 'Platform administration across tenants',
  'crm.view': 'View leads, contacts and pipeline',
  'crm.draft': 'Draft CRM records with the assistant',
  'crm.manage': 'Edit leads and pipeline records directly',
  'crm.approve': 'Approve or reject assistant-drafted CRM records',
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/** System role templates. Orgs may clone and customise these. */
export const ROLE_TEMPLATES = [
  {
    code: 'org_admin',
    name: 'Organization Administrator',
    description: 'Full configuration and administration of this organization.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'admin.platform'),
  },
  {
    code: 'executive',
    name: 'Executive Leadership',
    description: 'Company-wide dashboards, insights and reports.',
    permissions: [
      'org.view', 'user.view', 'workforce.view', 'workforce.cost.view', 'project.view',
      'allocation.view', 'finance.view', 'analytics.utilization', 'analytics.executive',
      'report.view', 'ai.assistant', 'ai.insights', 'forecast.view', 'audit.view', 'approval.manage',
      'crm.view', 'crm.draft', 'crm.manage', 'crm.approve',
    ],
  },
  {
    code: 'finance',
    name: 'Finance User',
    description: 'Financial visibility, billing, cost and margin analysis.',
    permissions: [
      'org.view', 'workforce.view', 'workforce.cost.view', 'project.view', 'allocation.view',
      'finance.view', 'analytics.utilization', 'report.view', 'ai.assistant', 'ai.insights',
      'forecast.view', 'import.manage', 'crm.view', 'crm.draft',
    ],
  },
  {
    code: 'workforce_manager',
    name: 'Workforce / Resource Manager',
    description: 'Manage resources, allocation and capacity planning.',
    permissions: [
      'org.view', 'user.view', 'workforce.view', 'workforce.manage', 'project.view', 'project.manage',
      'allocation.view', 'allocation.manage', 'analytics.utilization', 'report.view',
      'ai.assistant', 'ai.insights', 'forecast.view', 'import.manage',
      'crm.view', 'crm.draft', 'crm.manage', 'crm.approve',
    ],
  },
  {
    code: 'project_manager',
    name: 'Project Manager',
    description: 'Manage own projects, demand and allocations (scoped).',
    permissions: [
      'org.view', 'workforce.view', 'project.view', 'project.manage', 'allocation.view',
      'allocation.manage', 'analytics.utilization', 'report.view', 'ai.assistant', 'ai.insights',
      'crm.view', 'crm.draft',
    ],
  },
  {
    code: 'analyst',
    name: 'Analyst',
    description: 'Detailed analysis across permitted data scopes.',
    permissions: [
      'org.view', 'workforce.view', 'project.view', 'allocation.view', 'analytics.utilization',
      'report.view', 'ai.assistant', 'ai.insights', 'forecast.view', 'import.manage', 'crm.view',
    ],
  },
  {
    code: 'viewer',
    name: 'Read-only User',
    description: 'View dashboards and reports, no changes.',
    permissions: ['org.view', 'workforce.view', 'project.view', 'allocation.view', 'analytics.utilization', 'report.view', 'crm.view'],
  },
];

export function roleTemplate(code) {
  return ROLE_TEMPLATES.find((r) => r.code === code);
}

/** Grouped for the UI. */
export const PERMISSION_GROUPS = [
  { name: 'Organization & users', perms: ['org.view', 'org.manage', 'user.view', 'user.manage', 'role.manage'] },
  { name: 'Workforce', perms: ['workforce.view', 'workforce.manage', 'workforce.cost.view'] },
  { name: 'Projects & allocation', perms: ['project.view', 'project.manage', 'allocation.view', 'allocation.manage'] },
  { name: 'Finance & analytics', perms: ['finance.view', 'analytics.utilization', 'analytics.executive', 'report.view'] },
  { name: 'AI & forecasting', perms: ['ai.assistant', 'ai.insights', 'forecast.view'] },
  { name: 'Data & governance', perms: ['import.manage', 'audit.view', 'approval.manage', 'automation.manage'] },
  { name: 'Platform', perms: ['admin.platform'] },
];
