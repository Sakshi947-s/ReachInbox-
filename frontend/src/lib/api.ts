const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Include session cookie in requests
  });

  const contentType = response.headers.get('content-type');
  const data = contentType && contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMsg = typeof data === 'object' && data !== null && 'message' in data
      ? (data as any).message
      : typeof data === 'string'
      ? data
      : 'API request failed';
    const error = new Error(errorMsg);
    (error as any).status = response.status;
    (error as any).data = data;
    throw error;
  }

  return data as T;
}

export const api = {
  // Auth
  getMe: () => request<{ user: any; senders: any[]; slack: any }>('/auth/me'),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  devLogin: (email: string, name?: string) =>
    request<{ success: boolean; user: any }>('/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    }),
  /** Returns which integrations are configured without exposing secrets */
  getAuthStatus: () =>
    request<{
      googleOAuthConfigured: boolean;
      slackConfigured: boolean;
      smtpProvider: 'real' | 'ethereal';
      smtpFrom: string;
      isProduction: boolean;
    }>('/auth/status'),

  // Campaigns
  parseRecipients: (formData: FormData) =>
    request<{ success: boolean; data: any }>('/campaigns/parse-recipients', {
      method: 'POST',
      body: formData,
    }),
  createCampaign: (payload: any) =>
    request<{ success: boolean; campaign: any }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getCampaigns: (page = 1, limit = 10) =>
    request<{ campaigns: any[]; pagination: any }>(`/campaigns?page=${page}&limit=${limit}`),
  cancelCampaign: (id: string) =>
    request<{ success: boolean }>(`/campaigns/${id}/cancel`, { method: 'POST' }),

  // Emails
  getScheduledEmails: (page = 1, limit = 15, status?: string) =>
    request<{ emails: any[]; pagination: any }>(
      `/emails/scheduled?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`
    ),
  getSentEmails: (page = 1, limit = 15, status?: string) =>
    request<{ emails: any[]; pagination: any }>(
      `/emails/sent?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`
    ),
  searchEmails: (query: string, page = 1, limit = 20) =>
    request<{ emails: any[]; pagination: any; source: string }>(
      `/emails/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`
    ),
  getEmailById: (id: string) =>
    request<{ email: any }>(`/emails/${id}`),
  /** Sends a test email to the authenticated user's own email address */
  testSendEmail: () =>
    request<{
      success: boolean;
      provider: 'real' | 'ethereal';
      messageId?: string;
      previewUrl?: string | null;
      smtpVerified: boolean;
      from: string;
      to: string;
      hint?: string | null;
    }>('/emails/test-send', { method: 'POST' }),

  // Slack
  getSlackStatus: () => request<{ connected: boolean; connection?: any }>('/slack/status'),
  disconnectSlack: () => request<{ success: boolean }>('/slack/disconnect', { method: 'POST' }),
  testSlackMessage: () => request<{ success: boolean }>('/slack/test', { method: 'POST' }),

  // Health
  getHealthReady: () => request<any>('/health/ready'),
};
