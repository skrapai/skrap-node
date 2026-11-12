/**
 * Request and response models for the Skrap.ai API.
 *
 * Response types describe the documented fields. The API may add fields over time; they are
 * passed through untouched, so treat these types as "at least these fields".
 */

/* ------------------------------------------------------------------ shared */

/** Deliverability of an email address. */
export type EmailStatus = 'valid' | 'risky' | 'invalid' | 'unknown';

/** Present when the answer was a free repeat of a lookup you already paid for. */
export interface RepeatInfo {
  free: true;
  /** When the original (charged) lookup happened, ISO 8601. */
  firstChargedAt: string;
}

export interface Location {
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface CompanyRef {
  name: string | null;
  domain: string | null;
  linkedinUrl: string | null;
}

/* ------------------------------------------------------------------ verify */

export interface VerifyEmailParams {
  /** Address to verify. */
  email: string;
}

export interface VerifyChecks {
  syntax: boolean;
  /** null when the domain's DNS could not be read. */
  mxFound: boolean | null;
  smtp: 'accepted' | 'rejected' | 'inconclusive' | 'not_checked';
  /** null when not known. */
  catchAll: boolean | null;
  disposable: boolean;
  roleAccount: boolean;
  freeProvider: boolean;
}

export type RiskReason = 'catch_all' | 'catch_all_unconfirmed' | 'role_account' | 'disposable';

export interface VerifyEmailResponse {
  email: string;
  status: EmailStatus;
  /** true: the answer is `unknown` for a temporary reason, try again later. */
  retryable: boolean;
  domainInfo?: { domain: string; hasMxRecords: boolean };
  /** 95 valid, 10 to 70 risky (by risk reason), 0 invalid, null unknown. */
  score: number | null;
  checks: VerifyChecks;
  /** Only for risky answers. */
  riskReasons: Array<RiskReason | (string & {})>;
  /** Typo hint, e.g. "jane@gmail.com" for "jane@gmial.com". */
  didYouMean: string | null;
  repeat?: RepeatInfo;
}

/* ------------------------------------------------------------------ find */

export interface FindEmailParams {
  /** First name (or give `fullName`). */
  firstName?: string;
  /** Last name (or give `fullName`). */
  lastName?: string;
  /** Split into first and last name when `firstName` is empty. */
  fullName?: string;
  /** Company domain, e.g. example.com. Best results. */
  domain?: string;
  /** Company name, when you have no domain. */
  company?: string;
  /** Optional HQ hint that helps match a company name. */
  location?: string;
}

export interface FoundEmail {
  email: string;
  status: EmailStatus;
}

export interface CompanySuggestion {
  name: string | null;
  domain: string | null;
  employeeCount: number | string | null;
}

export interface CompanyResolution {
  input: string | null;
  resolvedDomain: string | null;
  companyName: string | null;
  needsConfirmation?: boolean;
  suggestions?: CompanySuggestion[];
}

export interface FindEmailResponse {
  emails: FoundEmail[];
  status?: EmailStatus;
  domainStatus: EmailStatus;
  /**
   * true: a slow mail server is still answering. Not charged yet; poll
   * `getFindRefinement(requestId)` (or use `waitForFindRefinement`) until `ready` is true.
   */
  pendingRefinement?: boolean;
  requestId: string;
  retryable?: boolean;
  companyResolution?: CompanyResolution;
  /** A company name matched several companies: resend with one of the suggested domains. */
  needsCompanyConfirmation?: boolean;
  suggestions?: CompanySuggestion[];
  repeat?: RepeatInfo;
}

export interface FindRefinementResponse {
  ready: boolean;
  email?: string;
  status?: EmailStatus;
  domainStatus?: EmailStatus;
  retryable?: boolean;
}

/* ------------------------------------------------------------------ enrichment */

export interface EnrichJob {
  title: string | null;
  company: CompanyRef;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
}

export interface EnrichEducation {
  school: string;
  degree: string | null;
  startYear: number | null;
  endYear: number | null;
}

export interface EnrichPerson {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  location: Location;
  currentJob: EnrichJob | null;
  /** Up to 15 jobs, in profile order. */
  experience: EnrichJob[];
  education: EnrichEducation[];
  skills: string[];
}

export type EmailProvider =
  | 'google_workspace'
  | 'microsoft_365'
  | 'zoho'
  | 'proofpoint'
  | 'mimecast'
  | 'barracuda'
  | 'other';

export interface EnrichCompany {
  name: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  type: string | null;
  size: string | null;
  employees: number | null;
  revenueRange: string | null;
  foundedYear: number | null;
  description: string | null;
  location: Location;
  followers: number | null;
  /** Who hosts the company's email (null: not known). */
  emailProvider: EmailProvider | null;
  /** false: the domain has no mail servers; null: not known. */
  acceptsEmail: boolean | null;
}

export interface HeadcountBreakdownRow {
  name: string;
  count: number;
  percent: number;
}

export interface HeadcountBreakdown {
  total: number | null;
  departments: HeadcountBreakdownRow[];
  countries: HeadcountBreakdownRow[];
}

interface EnrichCharge {
  /** Credits charged for this call (0 when nothing was found). */
  creditsCharged: number;
  requestId: string;
}

export interface ReverseEmailParams {
  /** Work email address (personal mailbox providers such as Gmail are refused). */
  email: string;
  /** Also return the full company profile (+1 credit when found). */
  includeCompany?: boolean;
}

export interface ReverseEmailResponse extends EnrichCharge {
  found: boolean;
  email?: string;
  /** false: the address belongs to a previous employer. */
  emailMatchesCurrentJob?: boolean;
  person: EnrichPerson | null;
  /** The person's current company. */
  company?: CompanyRef | null;
  /** Full company profile, with `includeCompany: true`. */
  companyProfile?: EnrichCompany | null;
}

export interface EnrichPersonParams {
  /** Profile URL, e.g. https://www.linkedin.com/in/jane-doe. */
  linkedinUrl: string;
  /** Look up the work email at the current employer (default true, +1 credit when returned). */
  includeEmail?: boolean;
}

export interface EnrichPersonResponse extends EnrichCharge {
  found: boolean;
  person: EnrichPerson | null;
  /** null when none on record. */
  workEmail?: { address: string; status: EmailStatus } | null;
}

export interface EnrichCompanyParams {
  /** Company domain (a website URL or an email address also works). */
  domain?: string;
  /** LinkedIn company URL, when you have no domain. */
  linkedinUrl?: string;
  /** Headcount by department and by country (+1 credit). */
  includeBreakdown?: boolean;
}

export interface EnrichCompanyResponse extends EnrichCharge {
  found: boolean;
  company: EnrichCompany | null;
  headcountBreakdown?: HeadcountBreakdown | null;
}

export type Seniority = 'c_suite' | 'vp' | 'director' | 'manager' | 'staff' | 'other';

export type Department =
  | 'sales'
  | 'marketing'
  | 'engineering'
  | 'it'
  | 'finance'
  | 'operations'
  | 'human_resources'
  | 'legal'
  | 'customer_service'
  | 'management'
  | 'research'
  | 'purchasing'
  | 'supply_chain'
  | 'manufacturing'
  | 'healthcare'
  | 'education'
  | 'public_sector'
  | 'science'
  | 'creative'
  | 'construction'
  | 'writing'
  | 'other';

export interface CompanyContactsParams {
  /** Company domain (or give `linkedinUrl`). */
  domain?: string;
  /** LinkedIn company URL (or give `domain`). */
  linkedinUrl?: string;
  seniority?: Array<Seniority | (string & {})>;
  department?: Array<Department | (string & {})>;
  /** ISO 2-letter country codes, e.g. ["US", "GB"]. */
  country?: string[];
  /** Only people who started in the last 90 days. */
  recentHires?: boolean;
  /** People per page, 1 to 25 (default 10). Trimmed to what your balance covers. */
  limit?: number;
  /** Page number (default 1, up to 40). */
  page?: number;
  /** Work emails (default true, no extra cost). */
  includeEmails?: boolean;
}

export interface CompanyContact {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  location: Location;
  startDate: string | null;
  /** null when none on record. */
  email: { address: string; status: EmailStatus } | null;
}

export interface CompanyContactsResponse extends EnrichCharge {
  found: boolean;
  company: CompanyRef | null;
  page: number;
  totalPages: number;
  people: CompanyContact[];
}

/* ------------------------------------------------------------------ bulk jobs */

export type TaskStatus = 'pending' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'bulk-verify' | 'bulk-find';

export interface TaskProgress {
  total: number;
  processed: number;
  percentage: number;
}

export interface BulkVerifyParams {
  /** Up to 25,000 addresses. */
  emails: string[];
  /** Optional name shown for the job in the app. */
  listName?: string;
}

export interface BulkFindRow {
  firstName: string;
  lastName?: string;
  /** Company domain (or give `company`). */
  domain?: string;
  /** Company name (or give `domain`). */
  company?: string;
}

export interface BulkFindParams {
  /** Up to 25,000 rows; each needs a first name and a domain or company. */
  data: BulkFindRow[];
  /** Optional name shown for the job in the app. */
  listName?: string;
}

export interface BulkJobCreated {
  taskId: string;
  status: TaskStatus;
  progress: TaskProgress;
  message?: string;
}

export interface TaskControls {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  stalled: boolean;
  stopping: boolean;
}

export interface Task {
  taskId: string;
  type: TaskType | (string & {});
  status: TaskStatus;
  progress: TaskProgress;
  controls?: TaskControls;
  result?: {
    fileUrl?: string;
    expiresAt?: string;
    purgedAt?: string;
    resultsExpired?: boolean;
    hasPartialResults?: boolean;
  };
  error?: { code?: string; message: string };
  metadata?: {
    creditsRequired?: number;
    creditsUsed?: number;
    creditsRefunded?: number;
    startedAt?: string;
    completedAt?: string;
    pausedAt?: string;
    cancelledAt?: string;
    estimatedTimeRemaining?: number;
    pauseReason?: string;
    listName?: string;
    notChargedRows?: number;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskResultsParams {
  /** Rows to skip (default 0). */
  offset?: number;
  /** Rows per page (default 50). */
  limit?: number;
}

export interface TaskResultRow {
  email: string;
  status: EmailStatus;
  recordIndex?: number;
  firstName?: string;
  lastName?: string;
  company?: string;
  domain?: string;
}

export interface StatusCounts {
  valid: number;
  risky: number;
  invalid: number;
  unknown: number;
}

export interface TaskResultsPage {
  taskId: string;
  type?: TaskType | (string & {});
  status: TaskStatus;
  progress?: TaskProgress;
  offset: number;
  limit: number;
  total: number;
  statusCounts: StatusCounts;
  rows: TaskResultRow[];
}

export interface TaskDownloadUrl {
  /** Short-lived signed URL of the results CSV. */
  downloadUrl: string;
  /** Seconds until `downloadUrl` stops working. */
  expiresIn: number;
  message?: string;
}

export interface TaskCsv {
  /** The results file, CSV text. */
  csv: string;
  /** File name suggested by the server, when given. */
  filename: string | null;
}

export interface TaskControlResponse {
  message: string;
  taskId: string;
  paused?: boolean;
  resumed?: boolean;
  controls?: TaskControls;
  reason?: string;
}

export interface WaitForTaskOptions {
  /** Delay between status checks in ms (default 5000). */
  intervalMs?: number;
  /** Give up after this many ms (default: no limit). */
  timeoutMs?: number;
  /** Stop waiting when aborted. */
  signal?: AbortSignal;
  /** Called after every status check. */
  onProgress?: (task: Task) => void;
}

/* ------------------------------------------------------------------ lists */

export type ListKind = 'prospect' | 'company';

export interface ListSummary {
  id: string;
  name: string;
  kind: ListKind;
  leadCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListsResponse {
  success: boolean;
  lists: ListSummary[];
}

export interface CreateListParams {
  name: string;
  /** prospect (people, default) or company. */
  kind?: ListKind;
}

export interface CreatedList {
  success: boolean;
  list: { id: string; name: string; kind: ListKind; leads: Lead[]; createdAt?: string; updatedAt?: string };
}

export interface Lead {
  /** Your id for the lead (unique within the list). */
  id: string;
  /** Person name (or company name on a company list). */
  name: string;
  company: string;
  /** Required on prospect (people) lists. */
  email?: string;
  emailStatus?: 'valid' | 'risky' | 'invalid';
  jobRole?: string;
  domain?: string;
  location?: string;
  linkedinUrl?: string;
  about?: string;
  industry?: string;
  headcount?: string;
  companyType?: string;
  headquarters?: string;
  founded?: string;
  revenue?: string;
}

export interface AddLeadResponse {
  success: boolean;
  message?: string;
  lead: Lead;
}

export interface TransferLeadsParams {
  targetListId: string;
  leadIds: string[];
  /** copy (default) or move. */
  mode?: 'copy' | 'move';
}

export interface TransferLeadsResponse {
  success: boolean;
  mode: 'copy' | 'move';
  matched: number;
  added: number;
  skipped: number;
}

export interface ExportListsParams {
  /** List ids, or "all" (default). */
  ids?: string[] | 'all';
  kind?: ListKind;
  /** Include leads on your do-not-contact list (left out by default). */
  includeSuppressed?: boolean;
}

export interface ListsCsv {
  csv: string;
  /** How many leads were left out because they are on your do-not-contact list. */
  suppressed: number;
}

/* ------------------------------------------------------------------ account */

export interface Account {
  id: string;
  email: string;
  name?: string | null;
  plan: string;
  /** Spendable credits. */
  credits: number;
  team: { id: string; name: string } | null;
  apiKey: { id: string; name: string } | null;
}

/* ------------------------------------------------------------------ webhooks */

export type WebhookEventType = 'bulk_job.completed' | 'bulk_job.failed' | 'credits.low' | 'list.lead_added';

export interface CreateWebhookParams {
  /** Your HTTPS endpoint. */
  url: string;
  events: Array<WebhookEventType | (string & {})>;
  description?: string;
}

export interface CreatedWebhook {
  id: string;
  url: string;
  events: string[];
  /** Signing secret. Returned only once: store it now. */
  secret: string;
  createdAt?: string;
}

export interface Webhook {
  id: string;
  url: string;
  description?: string | null;
  events: string[];
  enabled: boolean;
  source?: string;
  scope?: 'team' | 'personal';
  disabledReason?: string | null;
  consecutiveFailures?: number;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  createdAt?: string;
  secretHint?: string;
}

export interface WebhookList {
  webhooks: Webhook[];
}

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType | (string & {});
  /** ISO 8601. */
  created: string;
  data: T;
}
