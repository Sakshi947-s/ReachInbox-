'use client';

import React, { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { Sender, RecipientParseStats } from '@/types';
import { toast } from 'sonner';
import {
  X,
  Upload,
  FileText,
  Clock,
  Gauge,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Send,
  Loader2,
  Trash2,
} from 'lucide-react';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  senders: Sender[];
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  senders,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senderId, setSenderId] = useState(senders[0]?.id || '');
  const [startTime, setStartTime] = useState(() => {
    // Default to 10 minutes in future
    const d = new Date(Date.now() + 10 * 60 * 1000);
    // Format for datetime-local input: YYYY-MM-DDTHH:mm
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);

  // Recipient handling
  const [file, setFile] = useState<File | null>(null);
  const [rawTextRecipients, setRawTextRecipients] = useState('');
  const [parseStats, setParseStats] = useState<RecipientParseStats | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsParsing(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await api.parseRecipients(formData);
      setParseStats(res.data);
      toast.success(
        `Parsed ${res.data.validCount} valid recipients (${res.data.duplicateCount} duplicates filtered)`
      );
    } catch (err: any) {
      toast.error('Failed to parse recipient file: ' + err.message);
      setFile(null);
      setParseStats(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim()) {
      toast.error('Please enter an email subject');
      return;
    }
    if (!body.trim()) {
      toast.error('Please enter an email body');
      return;
    }

    const hasFile = !!file;
    const hasText = rawTextRecipients.trim().length > 0;

    if (!hasFile && !hasText) {
      toast.error('Please upload a CSV file or enter recipient email addresses');
      return;
    }

    setIsSubmitting(true);

    try {
      let payload: any = {
        subject,
        body,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmailsMs: Math.max(0, delaySeconds * 1000),
        hourlyLimit: Math.max(1, hourlyLimit),
        senderId: senderId || undefined,
      };

      if (hasFile) {
        // Read file as text for submission
        const textContent = await file.text();
        payload.csvContent = textContent;
      } else {
        payload.csvContent = rawTextRecipients;
      }

      const res = await api.createCampaign(payload);
      toast.success(`Campaign scheduled! ${res.campaign.totalRecipients} emails enqueued.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to schedule campaign');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Compose New Email Campaign</h2>
              <p className="text-xs text-slate-500">
                Staggered BullMQ scheduling with distributed hourly rate-limiting
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Sender & Subject row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                From (Sender)
              </label>
              <select
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} ({s.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Subject Line *
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Introducing our new automated platform"
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          {/* Recipient Upload Section */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Recipients (CSV or Text File) *
            </label>

            {!file ? (
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50 hover:bg-indigo-50/30 rounded-xl p-5 text-center cursor-pointer transition-all"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  accept=".csv,.txt"
                  className="hidden"
                />
                <div className="flex flex-col items-center space-y-2">
                  <div className="p-3 bg-white shadow-sm border border-slate-200 rounded-full text-indigo-600">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    Drag and drop your CSV or TXT file here, or{' '}
                    <span className="text-indigo-600 underline">browse</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Automatic column detection, deduplication, and syntax validation
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  <div>
                    <span className="text-sm font-medium text-slate-800">{file.name}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setParseStats(null);
                  }}
                  className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"
                  title="Remove file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Parsing Stats Badges */}
            {isParsing && (
              <div className="flex items-center space-x-2 text-xs text-indigo-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Parsing recipients and filtering duplicates...</span>
              </div>
            )}

            {parseStats && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{parseStats.validCount} Valid Emails</span>
                </span>
                {parseStats.duplicateCount > 0 && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{parseStats.duplicateCount} Duplicates Skipped</span>
                  </span>
                )}
                {parseStats.invalidCount > 0 && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{parseStats.invalidCount} Invalid Skipped</span>
                  </span>
                )}
              </div>
            )}

            {/* Fallback Text Input if no file uploaded */}
            {!file && (
              <div className="mt-2">
                <textarea
                  value={rawTextRecipients}
                  onChange={(e) => setRawTextRecipients(e.target.value)}
                  placeholder="Or paste email addresses here (one per line or comma-separated)"
                  rows={2}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>
            )}
          </div>

          {/* Email Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email Content (HTML supported) *
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Dear customer, welcome to our platform!</p>"
              rows={4}
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-slate-800"
              required
            />
          </div>

          {/* Scheduling & Rate Limiting Controls */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 mb-1">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>Start Time (UTC/Local)</span>
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                required
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Local: {new Date(startTime).toLocaleString()}
              </span>
            </div>

            <div>
              <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 mb-1">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Delay Between Sends</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10) || 0)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                />
                <span className="absolute right-3 top-2 text-xs text-slate-400">sec</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Staggers BullMQ queue jobs
              </span>
            </div>

            <div>
              <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 mb-1">
                <Gauge className="w-3.5 h-3.5 text-indigo-600" />
                <span>Max Sends / Hour</span>
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 100)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Reschedules on quota limit
              </span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || isParsing}
              className="flex items-center space-x-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Scheduling Campaign...</span>
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4" />
                  <span>Schedule Campaign</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
