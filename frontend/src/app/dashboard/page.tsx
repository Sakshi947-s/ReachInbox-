'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { User, Sender, SlackStatus, EmailJob, Pagination } from '@/types';
import { Sidebar } from '@/components/layout/Sidebar';
import { EmailTable } from '@/components/dashboard/EmailTable';
import { EmailDetailView } from '@/components/dashboard/EmailDetailView';
import { ComposeView } from '@/components/compose/ComposeView';
import { SlackModal } from '@/components/dashboard/SlackModal';
import { toast } from 'sonner';
import { Search, RefreshCw, Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();

  // User & Global State
  const [user, setUser] = useState<User | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | undefined>();
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<{
    googleOAuthConfigured: boolean;
    slackConfigured: boolean;
    smtpProvider: string;
  } | null>(null);

  // Active Navigation & View
  const [activeFolder, setActiveFolder] = useState<'scheduled' | 'sent'>('scheduled');
  const [currentView, setCurrentView] = useState<'list' | 'compose' | 'detail'>('list');
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);

  // Modals
  const [isSlackOpen, setIsSlackOpen] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Data states
  const [scheduledEmails, setScheduledEmails] = useState<EmailJob[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailJob[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Paginations
  const [scheduledPagination, setScheduledPagination] = useState<Pagination>({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
  });

  const [sentPagination, setSentPagination] = useState<Pagination>({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
  });

  // Load User profile & check authentication
  const loadUser = useCallback(async () => {
    try {
      const data = await api.getMe();
      setUser(data.user);
      setSenders(data.senders || []);
      setSlackStatus(data.slack);
    } catch {
      router.push('/login');
    } finally {
      setIsAuthLoading(false);
    }
  }, [router]);

  // Fetch integration status
  useEffect(() => {
    api.getAuthStatus().then(setAuthStatus).catch(() => {});
  }, []);

  // Fetch Scheduled Emails
  const fetchScheduled = useCallback(async (page = 1) => {
    setIsLoadingData(true);
    try {
      const res = await api.getScheduledEmails(page, 15);
      setScheduledEmails(res.emails);
      setScheduledPagination(res.pagination);
    } catch (err: any) {
      toast.error('Failed to load scheduled emails: ' + err.message);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Fetch Sent Emails
  const fetchSent = useCallback(async (page = 1) => {
    setIsLoadingData(true);
    try {
      const res = await api.getSentEmails(page, 15);
      setSentEmails(res.emails);
      setSentPagination(res.pagination);
    } catch (err: any) {
      toast.error('Failed to load sent emails: ' + err.message);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Search handler (uses Elasticsearch backend)
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      if (activeFolder === 'scheduled') fetchScheduled(1);
      else fetchSent(1);
      return;
    }

    setIsSearching(true);
    try {
      const res = await api.searchEmails(searchQuery);
      if (activeFolder === 'scheduled') {
        setScheduledEmails(res.emails);
        setScheduledPagination(res.pagination);
      } else {
        setSentEmails(res.emails);
        setSentPagination(res.pagination);
      }
      toast.info(`Found ${res.pagination.total} result(s)`);
    } catch (err: any) {
      toast.error('Search failed: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      toast.success('Logged out');
      router.push('/login');
    } catch {
      router.push('/login');
    }
  };

  const handleCancelEmail = async (campaignId: string) => {
    try {
      await api.cancelCampaign(campaignId);
      toast.success('Campaign cancelled');
      fetchScheduled(scheduledPagination.page);
    } catch (err: any) {
      toast.error('Failed to cancel campaign: ' + err.message);
    }
  };

  // Initial load
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Tab switch effect
  useEffect(() => {
    if (user) {
      setSearchQuery('');
      if (activeFolder === 'scheduled') fetchScheduled(1);
      if (activeFolder === 'sent') fetchSent(1);
    }
  }, [activeFolder, user, fetchScheduled, fetchSent]);

  // Real-time polling
  useEffect(() => {
    const interval = setInterval(() => {
      if (user && !searchQuery && currentView === 'list') {
        if (activeFolder === 'scheduled') fetchScheduled(scheduledPagination.page);
        if (activeFolder === 'sent') fetchSent(sentPagination.page);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeFolder, user, searchQuery, currentView, fetchScheduled, fetchSent, scheduledPagination.page, sentPagination.page]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-500 font-medium">Loading Outbox...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex overflow-hidden">
      {/* Left Sidebar matching Figma design */}
      <Sidebar
        user={user}
        activeFolder={activeFolder}
        onSelectFolder={(folder) => {
          setActiveFolder(folder);
          setCurrentView('list');
          setSelectedEmail(null);
        }}
        onOpenCompose={() => {
          setCurrentView('compose');
          setSelectedEmail(null);
        }}
        onOpenSlack={() => setIsSlackOpen(true)}
        onLogout={handleLogout}
        scheduledCount={scheduledPagination.total}
        sentCount={sentPagination.total}
        slackStatus={slackStatus}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-white">
        {currentView === 'compose' ? (
          <ComposeView
            onBack={() => setCurrentView('list')}
            onSuccess={() => {
              fetchScheduled(1);
              fetchSent(1);
            }}
            senders={senders}
          />
        ) : currentView === 'detail' && selectedEmail ? (
          <EmailDetailView
            email={selectedEmail}
            onBack={() => {
              setCurrentView('list');
              setSelectedEmail(null);
            }}
          />
        ) : (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
            {/* Top Bar — Search + Refresh matching Figma */}
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 bg-white">
              {/* Search bar — full-width, light gray background */}
              <form onSubmit={handleSearch} className="relative flex-1">
                <Search className="w-4 h-4 text-gray-350 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search"
                  className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-transparent rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-gray-200 transition-all"
                />
              </form>

              {/* Refresh */}
              <button
                type="button"
                onClick={() => {
                  if (activeFolder === 'scheduled') fetchScheduled(scheduledPagination.page);
                  else fetchSent(sentPagination.page);
                }}
                disabled={isLoadingData}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-40 flex-shrink-0"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingData ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Email Rows List Table */}
            <div className="flex-1 overflow-y-auto">
              <EmailTable
                type={activeFolder}
                emails={activeFolder === 'scheduled' ? scheduledEmails : sentEmails}
                loading={isLoadingData}
                pagination={activeFolder === 'scheduled' ? scheduledPagination : sentPagination}
                onPageChange={(page) => {
                  if (activeFolder === 'scheduled') fetchScheduled(page);
                  else fetchSent(page);
                }}
                onSelectEmail={(email) => {
                  setSelectedEmail(email);
                  setCurrentView('detail');
                }}
                onCancelEmail={handleCancelEmail}
              />
            </div>
          </div>
        )}
      </div>

      {/* Slack Integration Modal */}
      <SlackModal
        isOpen={isSlackOpen}
        onClose={() => setIsSlackOpen(false)}
        slackStatus={slackStatus}
        onStatusUpdated={loadUser}
        slackConfigured={authStatus?.slackConfigured ?? true}
      />
    </div>
  );
}
