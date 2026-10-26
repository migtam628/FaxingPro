export type FaxStatus = 'received' | 'sent' | 'queued' | 'failed' | 'draft';
export type Fax = {
  id: string; title: string; contact: string; number: string; pages: number;
  status: FaxStatus; direction: 'inbound' | 'outbound'; createdAt: string;
  unread?: boolean; source?: 'demo' | 'local';
};
export type Page = 'dashboard' | 'inbox' | 'sent' | 'compose' | 'contacts' |
  'documents' | 'numbers' | 'team' | 'reports' | 'server' | 'sip' | 'queue' |
  'security' | 'settings' | 'viewer';
