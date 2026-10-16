'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { User, Sender, SlackStatus, EmailJob, Campaign, Pagination } from '@/types';
import { Navbar } from '@/components/layout/Navbar';
import { ComposeModal } from '@/components/compose/ComposeModal';
import { ScheduledTable } from '@/components/dashboard/ScheduledTable';
import { SentTable } from '@/components/dashboard/SentTable';
import { CampaignsTable } from '@/components/dashboard/CampaignsTable';
import { SlackModal } from '@/components/dashboard/SlackModal';
import { toast } from 'sonner';
import {
  Search,
  RefreshCw,
  Clock,
  Send,
  Layers,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();

  // User & Global State
  const [user, setUser] = useState<User | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | undefined>();
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent' | 'campaigns'>('scheduled');

  // Modals
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSlackOpen, setIsSlackOpen] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Data states
  const [scheduledEmails, setScheduledEmails] = useState<EmailJob[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailJob[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

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

  const [campaignPagination, setCampaignPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
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

  // Fetch Campaigns
  const fetchCampaigns = useCallback(async (page = 1) => {
    setIsLoadingData(true);
    try {
      const res = await api.getCampaigns(page, 10);
      setCampaigns(res.campaigns);
      setCampaignPagination(res.pagination);
    } catch (err: any) {
      toast.error('Failed to load campaigns: ' + err.message);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Search handler (uses Elasticsearch backend)
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      refreshActiveTab();
      return;
    }

    setIsSearching(true);
    try {
      const res = await api.searchEmails(searchQuery);
      if (activeTab === 'scheduled') {
        setScheduledEmails(res.emails);
        setScheduledPagination(res.pagination);
      } else {
        setSentEmails(res.emails);
        setSentPagination(res.pagination);
      }
      toast.info(`Search returned ${res.pagination.total} results (via ${res.source})`);
    } catch (err: any) {
      toast.error('Search failed: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const refreshActiveTab = useCallback(() => {
    if (activeTab === 'scheduled') {
      fetchScheduled(scheduledPagination.page);
    } else if (activeTab === 'sent') {
      fetchSent(sentPagination.page);
    } else {
      fetchCampaigns(campaignPagination.page);
    }
  }, [activeTab, fetchScheduled, fetchSent, fetchCampaigns, scheduledPagination.page, sentPagination.page, campaignPagination.page]);

  const handleLogout = async () => {
    try {
      await api.logout();
      toast.success('Logged out');
      router.push('/login');
    } catch {
      router.push('/login');
    }
  };

  const handleCancelCampaign = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this campaign? Pending scheduled emails will be stopped.')) {
      return;
    }

    try {
      await api.cancelCampaign(id);
      toast.success('Campaign cancelled');
      fetchCampaigns(campaignPagination.page);
      fetchScheduled(1);
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
      if (activeTab === 'scheduled') fetchScheduled(1);
      if (activeTab === 'sent') fetchSent(1);
      if (activeTab === 'campaigns') fetchCampaigns(1);
    }
  }, [activeTab, user, fetchScheduled, fetchSent, fetchCampaigns]);

  // Auto-refresh polling every 10 seconds to display real-time worker execution
  useEffect(() => {
    const interval = setInterval(() => {
      if (user && !searchQuery) {
        if (activeTab === 'scheduled') fetchScheduled(scheduledPagination.page);
        if (activeTab === 'sent') fetchSent(sentPagination.page);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeTab, user, searchQuery, fetchScheduled, fetchSent, scheduledPagination.page, sentPagination.page]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-slate-600">Loading ReachInbox Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <Navbar
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenCompose={() => setIsComposeOpen(true)}
        onOpenSlack={() => setIsSlackOpen(true)}
        onLogout={handleLogout}
        slackStatus={slackStatus}
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Metric Cards Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Upcoming Queue
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {scheduledPagination.total}
              </div>
              <span className="text-[11px] text-indigo-600 font-medium">Delayed BullMQ jobs</span>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Delivered Emails
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {sentPagination.total}
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">Ethereal test deliveries</span>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Send className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Active Campaigns
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {campaignPagination.total}
              </div>
              <span className="text-[11px] text-blue-600 font-medium">Batched schedules</span>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Layers className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Rate Limit Status
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                100/hr
              </div>
              <span className="text-[11px] text-purple-600 font-medium">Auto-reschedule enabled</span>
            </div>
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Action & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          {/* Search bar */}
          <form onSubmit={handleSearch} className="relative w-full sm:w-96">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipients, subjects, body..."
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </form>

          {/* Refresh & Controls */}
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              onClick={refreshActiveTab}
              disabled={isLoadingData}
              className="flex items-center space-x-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh table"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'scheduled' && (
          <ScheduledTable
            emails={scheduledEmails}
            loading={isLoadingData}
            pagination={scheduledPagination}
            onPageChange={(page) => fetchScheduled(page)}
            onRefresh={() => fetchScheduled(scheduledPagination.page)}
          />
        )}

        {activeTab === 'sent' && (
          <SentTable
            emails={sentEmails}
            loading={isLoadingData}
            pagination={sentPagination}
            onPageChange={(page) => fetchSent(page)}
            onRefresh={() => fetchSent(sentPagination.page)}
          />
        )}

        {activeTab === 'campaigns' && (
          <CampaignsTable
            campaigns={campaigns}
            loading={isLoadingData}
            pagination={campaignPagination}
            onPageChange={(page) => fetchCampaigns(page)}
            onCancelCampaign={handleCancelCampaign}
            onRefresh={() => fetchCampaigns(campaignPagination.page)}
          />
        )}
      </main>

      {/* Compose Campaign Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSuccess={() => {
          fetchScheduled(1);
          fetchCampaigns(1);
        }}
        senders={senders}
      />

      {/* Slack Integration Modal */}
      <SlackModal
        isOpen={isSlackOpen}
        onClose={() => setIsSlackOpen(false)}
        slackStatus={slackStatus}
        onStatusUpdated={loadUser}
      />
    </div>
  );
}
