/** Tipos de la API consumidos por la interfaz. */

export type Role = 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'VIEWER';

export type Permission =
  | 'inbox:read'
  | 'inbox:assign'
  | 'inbox:archive'
  | 'inbox:moderate'
  | 'reply:draft'
  | 'reply:approve'
  | 'reply:publish'
  | 'accounts:read'
  | 'accounts:write'
  | 'tone:read'
  | 'tone:write'
  | 'templates:read'
  | 'templates:write'
  | 'users:read'
  | 'users:write'
  | 'analytics:read'
  | 'alerts:read'
  | 'alerts:write'
  | 'audit:read';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type InteractionStatus = 'PENDING' | 'IN_PROGRESS' | 'ANSWERED' | 'ARCHIVED' | 'HIDDEN';
export type ReplyStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'FAILED';

export interface AccountRef {
  id: string;
  name: string;
  provider: string;
  campus: string;
}

export interface PostRef {
  id: string;
  permalink: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
}

export interface Reply {
  id: string;
  status: ReplyStatus;
  origin: 'AI_DRAFT' | 'HUMAN';
  channel: 'PUBLIC' | 'PRIVATE_REPLY';
  draftText: string;
  finalText: string | null;
  rejectionReason: string | null;
  publishError: string | null;
  publishedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  aiModel: string | null;
  autoPublished: boolean;
  createdBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
}

export interface Interaction {
  id: string;
  kind: 'COMMENT' | 'DIRECT_MESSAGE';
  text: string;
  authorName: string | null;
  permalink: string | null;
  remoteCreatedAt: string;
  sentiment: Sentiment | null;
  topic: string | null;
  urgency: Urgency;
  summary: string | null;
  piiFlags: string | null;
  requiresHuman: boolean;
  status: InteractionStatus;
  isHidden: boolean;
  /** true si la IA aprobo y publico la respuesta sola, sin intervencion humana. */
  autoAnswered: boolean;
  answeredExternally: boolean;
  assignedAt: string | null;
  firstResponseSeconds: number | null;
  account: AccountRef;
  assignedTo: { id: string; name: string } | null;
  post: PostRef | null;
  _count: { replies: number };
}

export interface InteractionDetail extends Interaction {
  classifierNote: string | null;
  confidence: number | null;
  externalId: string;
  replies: Reply[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

export interface SocialAccount {
  id: string;
  provider: string;
  externalId: string;
  name: string;
  campus: string;
  isActive: boolean;
  isConnected: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  historicalImportedAt: string | null;
  createdAt: string;
  _count: { interactions: number };
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AnalyticsSummary {
  range: { from: string; to: string };
  totals: {
    total: number;
    pending: number;
    urgent: number;
    answered: number;
    hidden: number;
    requiresHuman: number;
    unanswered: number;
    responseRate: number;
  };
  responseTime: { averageSeconds: number; measured: number };
  ai: {
    classified: number;
    bySource: Record<string, number>;
    avoidedCalls: number;
    avoidedRate: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    models: { classify: string; draft: string };
  };
}

export interface BreakdownRow {
  key: string;
  count: number;
  campus?: string | null;
  provider?: string | null;
}

export interface AnalyticsBreakdown {
  bySentiment: BreakdownRow[];
  byTopic: BreakdownRow[];
  byUrgency: BreakdownRow[];
  byStatus: BreakdownRow[];
  byAccount: BreakdownRow[];
}

export interface Alert {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: string;
  notifiedAt: string | null;
  interactionId: string | null;
  account: { id: string; name: string } | null;
}

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface ProgramTemplate {
  id: string;
  name: string;
  faculty: string;
  level: string;
  modality: string;
  campuses: string;
  semesterValue: number | null;
  enrollmentFee: number | null;
  otherFeesNote: string | null;
  discountNote: string | null;
  durationSemesters: number | null;
  credits: number | null;
  requirements: string | null;
  degreeAwarded: string | null;
  sniesCode: string | null;
  description: string | null;
  professionalProfile: string | null;
  curriculum: string | null;
  scheduleNote: string | null;
  admissionProcess: string | null;
  homologationNote: string | null;
  faq: string | null;
  officialUrl: string | null;
  validFrom: string | null;
  validUntil: string | null;
  costIsPublic: boolean;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
  vigente: boolean;
  usable: boolean;
}

export interface TemplateListResponse {
  templates: ProgramTemplate[];
  resumen: { total: number; usables: number; sinCosto: number; vencidas: number };
}
