'use client';

import React from 'react';
import { User, SlackStatus } from '@/types';
import {
  Mail,
  Calendar,
  Send,
  LogOut,
  Slack,
  Activity,
  Plus,
  Layers,
} from 'lucide-react';

interface NavbarProps {
  user: User | null;
  activeTab: 'scheduled' | 'sent' | 'campaigns';
  onTabChange: (tab: 'scheduled' | 'sent' | 'campaigns') => void;
  onOpenCompose: () => void;
  onOpenSlack: () => void;
  onLogout: () => void;
  slackStatus?: SlackStatus;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTab,
  onTabChange,
  onOpenCompose,
  onOpenSlack,
  onLogout,
  slackStatus,
}) => {
  const isSlackConnected = slackStatus?.status === 'CONNECTED';

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Brand Logo & Title */}
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-200">
                <Mail className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg text-slate-900 tracking-tight leading-none">
                  ReachInbox
                </span>
                <span className="text-xs text-indigo-600 font-medium leading-tight">
                  Job Scheduler
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex space-x-1">
              <button
                onClick={() => onTabChange('scheduled')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'scheduled'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>Scheduled Emails</span>
              </button>

              <button
                onClick={() => onTabChange('sent')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'sent'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>Sent Emails</span>
              </button>

              <button
                onClick={() => onTabChange('campaigns')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'campaigns'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Campaigns</span>
              </button>
            </nav>
          </div>

          {/* Right: Actions, Slack pill, Queue dashboard, User profile */}
          <div className="flex items-center space-x-3">
            {/* Bull Board Link */}
            <a
              href="http://localhost:5000/admin/queues"
              target="_blank"
              rel="noreferrer"
              className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              title="Open BullMQ Queue Monitor"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-600" />
              <span>Queue Monitor</span>
            </a>

            {/* Slack Connection Pill */}
            <button
              onClick={onOpenSlack}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                isSlackConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Slack className={`w-3.5 h-3.5 ${isSlackConnected ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span>{isSlackConnected ? (slackStatus?.teamName || 'Slack Connected') : 'Connect Slack'}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${isSlackConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            </button>

            {/* Compose Button */}
            <button
              onClick={onOpenCompose}
              className="flex items-center space-x-1.5 px-3.5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              <Plus className="w-4 h-4" />
              <span>Compose Email</span>
            </button>

            {/* User Profile & Logout */}
            {user && (
              <div className="flex items-center pl-2 border-l border-slate-200 space-x-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="w-8 h-8 rounded-full border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="hidden xl:flex flex-col text-left">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-slate-500 leading-tight truncate max-w-[120px]">
                    {user.email}
                  </span>
                </div>
                <button
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                  title="Log out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
