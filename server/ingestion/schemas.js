/**
 * Declarative import schemas.
 *
 * Every importable entity declares its target fields, accepted source column aliases,
 * required-ness and validation. The UI shows exactly these fields for column mapping,
 * so mapping is deterministic and auditable rather than guessed.
 */

export const FIELD_TYPES = ['text', 'email', 'number', 'integer', 'date', 'enum', 'currency', 'percent'];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_\-/.]+/g, '');

export const ENTITY_SCHEMAS = {
  employees: {
    label: 'Employees / Resources',
    description: 'Workforce master data: people, their department, location, capacity and cost.',
    naturalKey: ['employee_code'],
    fields: [
      { key: 'employee_code', label: 'Employee ID', type: 'text', required: true, aliases: ['employee id', 'emp id', 'emp code', 'staff id', 'resource id', 'id', 'employee number'], example: 'EMP-1001' },
      { key: 'full_name', label: 'Full Name', type: 'text', required: true, aliases: ['name', 'employee name', 'resource name', 'full name'], example: 'Asha Rao' },
      { key: 'email', label: 'Email', type: 'email', aliases: ['email id', 'work email', 'e-mail'], example: 'asha.rao@example.com' },
      { key: 'department', label: 'Department', type: 'text', aliases: ['dept', 'department name', 'function'], example: 'Application Development' },
      { key: 'business_unit', label: 'Business Unit', type: 'text', aliases: ['bu', 'business unit name', 'unit', 'vertical'], example: 'IT Services' },
      { key: 'location', label: 'Location', type: 'text', aliases: ['office', 'city', 'site', 'base location'], example: 'Hyderabad' },
      { key: 'designation', label: 'Designation', type: 'text', aliases: ['role', 'job title', 'title', 'grade title'], example: 'Senior Engineer' },
      { key: 'grade', label: 'Grade', type: 'text', aliases: ['band', 'level', 'job grade'], example: 'G4' },
      { key: 'employment_type', label: 'Employment Type', type: 'enum', aliases: ['type', 'employment', 'employee type'],
        enumValues: ['full_time', 'part_time', 'contractor', 'intern', 'furlough'],
        enumAliases: { 'full time': 'full_time', ft: 'full_time', permanent: 'full_time', 'part time': 'part_time', pt: 'part_time', contract: 'contractor', consultant: 'contractor', 'third party': 'contractor', trainee: 'intern', intern: 'intern' },
        defaultValue: 'full_time', example: 'full_time' },
      { key: 'status', label: 'Status', type: 'enum', aliases: ['employee status', 'active status'],
        enumValues: ['active', 'on_leave', 'notice', 'exited'],
        enumAliases: { active: 'active', 'on leave': 'on_leave', leave: 'on_leave', notice: 'notice', 'notice period': 'notice', resigned: 'notice', inactive: 'exited', exited: 'exited', 'left': 'exited' },
        defaultValue: 'active', example: 'active' },
      { key: 'join_date', label: 'Join Date', type: 'date', aliases: ['date of joining', 'doj', 'start date', 'joining date'], example: '2023-04-01' },
      { key: 'exit_date', label: 'Exit Date', type: 'date', aliases: ['date of exit', 'doe', 'last working day', 'lwd', 'end date'], example: '' },
      { key: 'fte', label: 'FTE', type: 'number', aliases: ['fte', 'full time equivalent', 'allocation fte'], defaultValue: 1, example: '1' },
      { key: 'weekly_hours', label: 'Weekly Hours', type: 'number', aliases: ['hours per week', 'weekly capacity', 'capacity hours'], example: '40' },
      { key: 'annual_cost', label: 'Annual Cost', type: 'currency', aliases: ['annual ctc', 'ctc', 'cost to company', 'annual salary', 'salary'], sensitive: true, example: '1800000' },
      { key: 'cost_currency', label: 'Cost Currency', type: 'text', aliases: ['currency', 'cost currency'], defaultValue: 'INR', example: 'INR' },
      { key: 'bill_rate_hour', label: 'Bill Rate (per hour)', type: 'currency', aliases: ['billing rate', 'rate per hour', 'hourly rate', 'bill rate', 'bill rate per hour'], example: '2200' },
      { key: 'annual_bill_rate', label: 'Annual Bill Rate', type: 'currency', aliases: ['annual billing', 'annual rate'], example: '4200000' },
      { key: 'skills', label: 'Skills', type: 'text', aliases: ['skill set', 'primary skills', 'skills'], multi: ';', example: 'Java; SQL; AWS' },
      { key: 'manager_code', label: 'Manager Employee ID', type: 'text', aliases: ['manager id', 'reports to', 'supervisor id'], example: 'EMP-1000' },
    ],
  },

  skills: {
    label: 'Skills & Competencies',
    description: 'Employee skill inventory used for demand matching.',
    naturalKey: ['employee_code', 'skill'],
    fields: [
      { key: 'employee_code', label: 'Employee ID', type: 'text', required: true, aliases: ['employee id', 'emp id', 'resource id'], example: 'EMP-1001' },
      { key: 'skill', label: 'Skill', type: 'text', required: true, aliases: ['skill name', 'competency', 'skill'], example: 'Java' },
      { key: 'category', label: 'Skill Category', type: 'text', aliases: ['category', 'skill group'], example: 'Engineering' },
      { key: 'proficiency', label: 'Proficiency (1-5)', type: 'integer', aliases: ['level', 'rating', 'proficiency level'], defaultValue: 3, example: '4' },
      { key: 'years', label: 'Years of Experience', type: 'number', aliases: ['experience', 'years', 'yoe'], example: '5' },
    ],
  },

  projects: {
    label: 'Projects',
    description: 'Project master data including client, dates, budget and billing rates.',
    naturalKey: ['code'],
    fields: [
      { key: 'code', label: 'Project Code', type: 'text', required: true, aliases: ['project id', 'project code', 'id', 'project number'], example: 'PRJ-204' },
      { key: 'name', label: 'Project Name', type: 'text', required: true, aliases: ['project', 'project name', 'name'], example: 'Payments Platform Modernisation' },
      { key: 'client_name', label: 'Client', type: 'text', aliases: ['customer', 'client', 'account'], example: 'Meridian Bank' },
      { key: 'business_unit', label: 'Business Unit', type: 'text', aliases: ['bu', 'unit'], example: 'IT Services' },
      { key: 'department', label: 'Department', type: 'text', aliases: ['dept'], example: 'Application Development' },
      { key: 'start_date', label: 'Start Date', type: 'date', aliases: ['start', 'from date', 'kickoff'], example: '2025-04-01' },
      { key: 'end_date', label: 'End Date', type: 'date', aliases: ['end', 'to date', 'completion'], example: '2026-03-31' },
      { key: 'status', label: 'Status', type: 'enum', aliases: ['project status'],
        enumValues: ['planned', 'active', 'on_hold', 'completed', 'cancelled'],
        enumAliases: { active: 'active', wip: 'active', 'in progress': 'active', planned: 'planned', pipeline: 'planned', 'on hold': 'on_hold', hold: 'on_hold', completed: 'completed', closed: 'completed', done: 'completed', cancelled: 'cancelled', canceled: 'cancelled' },
        defaultValue: 'active', example: 'active' },
      { key: 'contract_type', label: 'Contract Type', type: 'enum', aliases: ['contract', 'engagement type'],
        enumValues: ['time_material', 'fixed_price', 'retainer', 'internal'],
        enumAliases: { 'time and material': 'time_material', 'time & material': 'time_material', tm: 'time_material', 't and m': 'time_material', 'fixed price': 'fixed_price', 'fixed bid': 'fixed_price', fp: 'fixed_price', retainer: 'retainer', internal: 'internal' },
        defaultValue: 'time_material', example: 'time_material' },
      { key: 'budget_amount', label: 'Budget', type: 'currency', aliases: ['budget', 'contract value', 'po value'], example: '12000000' },
      { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'], defaultValue: 'INR', example: 'INR' },
      { key: 'billing_rate_hour', label: 'Billing Rate (per hour)', type: 'currency', aliases: ['bill rate', 'hourly rate', 'rate'], example: '2500' },
      { key: 'priority', label: 'Priority', type: 'enum', aliases: ['priority'],
        enumValues: ['low', 'medium', 'high', 'critical'],
        enumAliases: { p1: 'critical', p2: 'high', p3: 'medium', p4: 'low' }, defaultValue: 'medium' },
      { key: 'health', label: 'Health', type: 'enum', aliases: ['rag', 'status colour', 'project health'],
        enumValues: ['green', 'amber', 'red'], enumAliases: { green: 'green', g: 'green', amber: 'amber', a: 'amber', yellow: 'amber', red: 'red', r: 'red' }, defaultValue: 'green' },
    ],
  },

  demand: {
    label: 'Project Demand',
    description: 'Staffing requirements per project role, with skills and dates.',
    naturalKey: ['project_code', 'role_title', 'start_date'],
    fields: [
      { key: 'project_code', label: 'Project Code', type: 'text', required: true, aliases: ['project id', 'project', 'project code'], example: 'PRJ-204' },
      { key: 'role_title', label: 'Role', type: 'text', required: true, aliases: ['role', 'designation', 'position', 'job role'], example: 'Backend Engineer' },
      { key: 'required_skill', label: 'Required Skill', type: 'text', aliases: ['skill', 'primary skill', 'technology'], example: 'Java' },
      { key: 'headcount', label: 'Headcount', type: 'integer', required: true, aliases: ['count', 'positions', 'openings', 'fte required'], example: '2' },
      { key: 'hours_per_week', label: 'Hours / Week (per person)', type: 'number', aliases: ['weekly hours', 'hours', 'capacity required'], defaultValue: 40, example: '40' },
      { key: 'start_date', label: 'Start Date', type: 'date', required: true, aliases: ['start', 'required from', 'from date'], example: '2025-07-01' },
      { key: 'end_date', label: 'End Date', type: 'date', required: true, aliases: ['end', 'required to', 'to date'], example: '2025-12-31' },
      { key: 'priority', label: 'Priority', type: 'enum', aliases: ['priority'],
        enumValues: ['low', 'medium', 'high', 'critical'], enumAliases: { p1: 'critical', p2: 'high', p3: 'medium', p4: 'low' }, defaultValue: 'medium' },
      { key: 'status', label: 'Status', type: 'enum', aliases: ['demand status'],
        enumValues: ['open', 'partially_filled', 'filled', 'cancelled'],
        enumAliases: { open: 'open', 'in progress': 'partially_filled', 'partially filled': 'partially_filled', filled: 'filled', closed: 'filled', cancelled: 'cancelled' }, defaultValue: 'open' },
      { key: 'notes', label: 'Notes', type: 'text', aliases: ['comment', 'remarks', 'description'] },
    ],
  },

  allocations: {
    label: 'Allocations',
    description: 'Who is working on which project, for how many hours and when.',
    naturalKey: ['employee_code', 'project_code', 'start_date'],
    fields: [
      { key: 'employee_code', label: 'Employee ID', type: 'text', required: true, aliases: ['employee id', 'emp id', 'resource id', 'emp code'], example: 'EMP-1001' },
      { key: 'project_code', label: 'Project Code', type: 'text', required: true, aliases: ['project id', 'project', 'project code'], example: 'PRJ-204' },
      { key: 'start_date', label: 'Start Date', type: 'date', required: true, aliases: ['from', 'from date', 'start'], example: '2025-07-01' },
      { key: 'end_date', label: 'End Date', type: 'date', required: true, aliases: ['to', 'to date', 'end'], example: '2025-12-31' },
      { key: 'hours_per_week', label: 'Hours / Week', type: 'number', required: true, aliases: ['weekly hours', 'hours', 'allocation hours'], example: '40' },
      { key: 'allocation_pct', label: 'Allocation %', type: 'percent', aliases: ['allocation', 'percent allocated', '%'], example: '100' },
      { key: 'billable', label: 'Billable', type: 'enum', aliases: ['billable flag', 'is billable'],
        enumValues: ['yes', 'no'], enumAliases: { y: 'yes', yes: 'yes', true: 'yes', '1': 'yes', n: 'no', no: 'no', false: 'no', '0': 'no', billable: 'yes', 'non-billable': 'no', 'non billable': 'no' }, defaultValue: 'yes' },
      { key: 'bill_rate_hour', label: 'Bill Rate (per hour)', type: 'currency', aliases: ['bill rate', 'rate'], example: '2500' },
      { key: 'status', label: 'Status', type: 'enum', aliases: ['allocation status'],
        enumValues: ['planned', 'confirmed', 'cancelled', 'completed'],
        enumAliases: { planned: 'planned', tentative: 'planned', confirmed: 'confirmed', active: 'confirmed', cancelled: 'cancelled', completed: 'completed', done: 'completed' }, defaultValue: 'confirmed' },
      { key: 'note', label: 'Note', type: 'text', aliases: ['comment', 'remark'] },
    ],
  },

  timesheets: {
    label: 'Timesheets',
    description: 'Actual hours worked per employee, project and day. Drives utilization.',
    naturalKey: ['employee_code', 'project_code', 'work_date', 'billable'],
    fields: [
      { key: 'employee_code', label: 'Employee ID', type: 'text', required: true, aliases: ['employee id', 'emp id', 'resource id'], example: 'EMP-1001' },
      { key: 'project_code', label: 'Project Code', type: 'text', aliases: ['project id', 'project', 'project code'], example: 'PRJ-204' },
      { key: 'work_date', label: 'Work Date', type: 'date', required: true, aliases: ['date', 'day', 'timesheet date'], example: '2025-09-15' },
      { key: 'hours', label: 'Hours', type: 'number', required: true, aliases: ['hours worked', 'hrs', 'duration'], example: '8' },
      { key: 'billable', label: 'Billable', type: 'enum', aliases: ['billable flag', 'billable?'],
        enumValues: ['yes', 'no'], enumAliases: { y: 'yes', yes: 'yes', true: 'yes', '1': 'yes', n: 'no', no: 'no', false: 'no', '0': 'no', billable: 'yes', 'non-billable': 'no', 'non billable': 'no' }, defaultValue: 'yes' },
    ],
  },

  invoices: {
    label: 'Invoices / Billing',
    description: 'Invoiced amounts by project and month.',
    naturalKey: ['invoice_number'],
    fields: [
      { key: 'invoice_number', label: 'Invoice Number', type: 'text', required: true, aliases: ['invoice no', 'invoice id', 'invoice'], example: 'INV-2025-0912' },
      { key: 'project_code', label: 'Project Code', type: 'text', aliases: ['project id', 'project', 'project code'], example: 'PRJ-204' },
      { key: 'period_month', label: 'Period (YYYY-MM)', type: 'text', required: true, aliases: ['month', 'invoice month', 'period', 'billing month'], example: '2025-09' },
      { key: 'amount', label: 'Amount', type: 'currency', required: true, aliases: ['invoice amount', 'value', 'total'], example: '4500000' },
      { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'], defaultValue: 'INR' },
      { key: 'status', label: 'Status', type: 'enum', aliases: ['invoice status'],
        enumValues: ['draft', 'issued', 'paid', 'overdue', 'cancelled'],
        enumAliases: { draft: 'draft', issued: 'issued', sent: 'issued', open: 'issued', paid: 'paid', overdue: 'overdue', cancelled: 'cancelled' }, defaultValue: 'issued' },
      { key: 'issued_date', label: 'Issued Date', type: 'date', aliases: ['invoice date'] },
      { key: 'due_date', label: 'Due Date', type: 'date', aliases: ['payment due'] },
      { key: 'paid_date', label: 'Paid Date', type: 'date', aliases: ['payment date', 'received date'] },
    ],
  },

  expenses: {
    label: 'Operating Expenses',
    description: 'Non-payroll operating costs by project or department.',
    naturalKey: ['period_month', 'category', 'amount', 'department', 'project_code'],
    fields: [
      { key: 'period_month', label: 'Period (YYYY-MM)', type: 'text', required: true, aliases: ['month', 'period'], example: '2025-09' },
      { key: 'category', label: 'Category', type: 'text', required: true, aliases: ['expense category', 'type', 'head'], example: 'software' },
      { key: 'amount', label: 'Amount', type: 'currency', required: true, aliases: ['cost', 'value', 'spend'], example: '125000' },
      { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'], defaultValue: 'INR' },
      { key: 'project_code', label: 'Project Code', type: 'text', aliases: ['project', 'project id'] },
      { key: 'department', label: 'Department', type: 'text', aliases: ['dept'] },
      { key: 'description', label: 'Description', type: 'text', aliases: ['details', 'narration', 'comment'] },
    ],
  },
};

export function getSchema(entityType) {
  const s = ENTITY_SCHEMAS[entityType];
  if (!s) {
    const err = new Error(`Unknown data type "${entityType}".`);
    err.status = 400;
    err.code = 'UNKNOWN_ENTITY';
    throw err;
  }
  return s;
}

/** Best-effort automatic mapping by header alias matching (reviewed by the user). */
export function suggestMapping(entityType, headers) {
  const schema = getSchema(entityType);
  const mapping = {};
  const used = new Set();
  for (const h of headers) {
    const target = schema.fields.find(
      (f) => !used.has(f.key) && (norm(f.label) === norm(h) || norm(f.key) === norm(h) || (f.aliases || []).some((a) => norm(a) === norm(h)))
    );
    if (target) { mapping[h] = target.key; used.add(target.key); }
  }
  return mapping;
}
