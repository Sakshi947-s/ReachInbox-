'use client';

import React, { useState } from 'react';
import { User, SlackStatus } from '@/types';
import { Clock, Send, Plus, Slack, Activity, LogOut, ChevronDown } from 'lucide-react';

interface SidebarProps {
  user: User | null;
  activeFolder: 'scheduled' | 'sent';
  onSelectFolder: (folder: 'scheduled' | 'sent') => void;
  onOpenCompose: () => void;
  onOpenSlack: () => void;
  onLogout: () => void;
  scheduledCount: number;
  sentCount: number;
  slackStatus?: SlackStatus;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activeFolder,
  onSelectFolder,
  onOpenCompose,
  onOpenSlack,
  onLogout,
  scheduledCount,
  sentCount,
  slackStatus,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const isSlackConnected = slackStatus?.status === 'CONNECTED';

  // Derive display values from the authenticated user — never hardcoded
  const displayName = user?.name || 'Your Account';
  const displayEmail = user?.email || '';
  const initials = displayName
    .split(' ')
    .map((w) => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('');

  return (
    <aside className="w-[272px] border-r border-gray-100 bg-white flex flex-col h-full flex-shrink-0 select-none">

      {/* ── Logo ── */}
      <div className="pt-6 px-6 pb-5">
        <span
          className="text-[28px] font-black tracking-[-0.06em] text-black leading-none block"
          style={{ fontFamily: 'monospace' }}
        >
          ONB
        </span>
      </div>

      {/* ── Profile card ── */}
      <div className="px-4 pb-4 relative">
        <button
          onClick={() => setShowProfileMenu((prev) => !prev)}
          className="w-full p-2.5 bg-gray-50 hover:bg-gray-100/70 border border-gray-200/60 rounded-2xl flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={displayName}
                className="w-8 h-8 rounded-full border border-gray-200 object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-semibold text-xs flex-shrink-0">
                {initials || '?'}
              </div>
            )}
            <div className="min-w-0 text-left">
              <p className="text-xs font-semibold text-gray-900 truncate leading-snug">
                {displayName}
              </p>
              <p className="text-[11px] text-gray-400 truncate leading-tight max-w-[130px]">
                {displayEmail}
              </p>
            </div>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${
              showProfileMenu ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Profile dropdown */}
        {showProfileMenu && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-40 text-xs text-gray-700">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="font-semibold text-gray-900 truncate">{displayName}</p>
              <p className="text-[11px] text-gray-400 truncate">{displayEmail}</p>
            </div>

            <button
              onClick={() => { setShowProfileMenu(false); onOpenSlack(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center space-x-2 transition-colors"
            >
              <Slack className={`w-3.5 h-3.5 ${isSlackConnected ? 'text-emerald-600' : 'text-gray-400'}`} />
              <span>
                {isSlackConnected ? `Slack: ${slackStatus?.teamName || 'Connected'}` : 'Connect Slack'}
              </span>
              {isSlackConnected && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
              )}
            </button>

            <a
              href="http://localhost:5000/admin/queues"
              target="_blank"
              rel="noreferrer"
              onClick={() => setShowProfileMenu(false)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center space-x-2 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-gray-400" />
              <span>Queue Monitor</span>
            </a>

            <div className="border-t border-gray-100 my-1" />

            <button
              onClick={() => { setShowProfileMenu(false); onLogout(); }}
              className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 flex items-center space-x-2 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Compose button ── */}
      <div className="px-4 pb-5">
        <button
          onClick={onOpenCompose}
          className="w-full flex items-center justify-center space-x-1.5 px-4 py-2 border border-green-500 text-green-600 hover:bg-green-50 active:bg-green-100 rounded-xl text-sm font-medium transition-all focus:outline-none"
        >
          <Plus className="w-4 h-4" />
          <span>Compose</span>
        </button>
      </div>

      {/* ── Core nav section ── */}
      <div className="px-5 mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
          CORE
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {/* Scheduled */}
        <button
          onClick={() => onSelectFolder('scheduled')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors ${
            activeFolder === 'scheduled'
              ? 'bg-green-50 text-gray-900 font-semibold'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-normal'
          }`}
        >
          <div className="flex items-center space-x-3">
            <Clock
              className={`w-4 h-4 ${activeFolder === 'scheduled' ? 'text-gray-700' : 'text-gray-400'}`}
              strokeWidth={activeFolder === 'scheduled' ? 2.5 : 2}
            />
            <span>Scheduled</span>
          </div>
          <span className="text-xs text-gray-400 font-normal tabular-nums">
            {scheduledCount > 0 ? scheduledCount : ''}
          </span>
        </button>

        {/* Sent */}
        <button
          onClick={() => onSelectFolder('sent')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors ${
            activeFolder === 'sent'
              ? 'bg-green-50 text-gray-900 font-semibold'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-normal'
          }`}
        >
          <div className="flex items-center space-x-3">
            <Send
              className={`w-4 h-4 ${activeFolder === 'sent' ? 'text-gray-700' : 'text-gray-400'}`}
              strokeWidth={activeFolder === 'sent' ? 2.5 : 2}
            />
            <span>Sent</span>
          </div>
          <span className="text-xs text-gray-400 font-normal tabular-nums">
            {sentCount > 0 ? sentCount : ''}
          </span>
        </button>
      </nav>
    </aside>
  );
};
