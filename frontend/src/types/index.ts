export interface User {
  id: string;
  googleId?: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  createdAt?: string;
}

export interface Sender {
  id: string;
  displayName: string;
  email: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface SlackStatus {
  teamName?: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  channelName?: string;
  updatedAt?: string;
}

export interface Campaign {
  id: string;
  name?: string;
  subject: string;
  body: string;
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export interface EmailJob {
  id: string;
  campaignId: string;
  recipientEmail: string;
  subjectSnapshot: string;
  bodySnapshot: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: 'SCHEDULED' | 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  etherealPreviewUrl?: string | null;
  errorMessage?: string | null;
  campaign?: {
    id: string;
    name?: string;
    subject: string;
  };
  sender?: {
    email: string;
    displayName: string;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RecipientParseStats {
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  totalParsed: number;
  validSample: string[];
  invalidSample: string[];
  duplicateSample: string[];
}
