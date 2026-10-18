'use client';

import React, { useState } from 'react';
import { SlackStatus } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Slack, X, CheckCircle2, AlertTriangle, Send, Unlink, ExternalLink, Loader2, Settings } from 'lucide-react';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL.replace('/api', '')
  : 'http://localhost:5000';


interface SlackModalProps {
  isOpen: boolean;
  onClose: () => void;
  slackStatus?: SlackStatus;
  onStatusUpdated: () => void;
  /** Whether SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are configured in the backend .env */
  slackConfigured?: boolean;
}


export const SlackModal: React.FC<SlackModalProps> = ({
  isOpen,
  onClose,
  slackStatus,
  onStatusUpdated,
  slackConfigured = true,
}) => {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  if (!isOpen) return null;

  const isConnected = slackStatus?.status === 'CONNECTED';

  const handleConnect = () => {
    if (!slackConfigured) return;
    window.location.href = `${API_ORIGIN}/api/slack/auth`;
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await api.disconnectSlack();
      toast.success('Slack disconnected successfully');
      onStatusUpdated();
    } catch (err: any) {
      toast.error('Failed to disconnect Slack: ' + err.message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSendTest = async () => {
    setIsSendingTest(true);
    try {
      await api.testSlackMessage();
      toast.success('Test notification sent to Slack channel!');
    } catch (err: any) {
      toast.error('Failed to send test Slack alert: ' + err.message);
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <Slack className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Slack Integration</h2>
              <p className="text-xs text-slate-500">Real-time quota exhaustion alerts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {isConnected ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start space-x-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-900">
                <span className="font-semibold block text-sm">
                  Connected to {slackStatus?.teamName || 'Slack Workspace'}
                </span>
                <span className="text-emerald-700 mt-1 block">
                  Alert channel: {slackStatus?.channelName || 'Configured default webhook channel'}
                </span>
                <p className="mt-2 text-emerald-800">
                  When a sender reaches their hourly email quota, an alert identifying the sender, quota window, and rescheduled time is automatically sent.
                </p>
              </div>
            </div>
          ) : !slackConfigured ? (
            /* Slack credentials not configured in backend .env */
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3">
              <Settings className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-800">
                <span className="font-semibold block text-sm">Slack credentials not configured</span>
                <p className="mt-1">
                  Add <code className="bg-red-100 px-1 rounded">SLACK_CLIENT_ID</code> and{' '}
                  <code className="bg-red-100 px-1 rounded">SLACK_CLIENT_SECRET</code> to your{' '}
                  <code className="bg-red-100 px-1 rounded">.env</code> file, then restart the backend.
                </p>
                <p className="mt-1 text-red-600">See README for Slack App setup instructions.</p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-slate-600">
                <span className="font-semibold block text-sm text-slate-800">Slack is not connected</span>
                <p className="mt-1">
                  Connect your Slack workspace using OAuth 2.0 to receive immediate notifications when email sending reaches the configured hourly rate limit.
                </p>
              </div>
            </div>
          )}


          {/* Configuration Note */}
          <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
            <span className="font-semibold text-slate-700 block">How Slack OAuth works:</span>
            <p>1. Redirects to official Slack OAuth authorization.</p>
            <p>2. Encrypts and securely stores the access token using AES-256-GCM.</p>
            <p>3. Deduplicates notifications so only 1 alert is sent per sender per hourly window.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          {isConnected ? (
            <>
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="flex items-center space-x-1.5 text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
              >
                {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                <span>Disconnect</span>
              </button>

              <div className="flex space-x-2">
                <button
                  onClick={handleSendTest}
                  disabled={isSendingTest}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  {isSendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Test Notification</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                Close
              </button>
              <button
                onClick={handleConnect}
                disabled={!slackConfigured}
                title={!slackConfigured ? 'Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to .env first' : undefined}
                className="flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect Slack Workspace</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
