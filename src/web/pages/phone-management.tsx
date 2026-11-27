import { useState } from 'react';
import { AccountSettings } from '../components/account-settings';
import type { AccountTab } from '../components/account-menu';
import type { useSession } from '../hooks/use-session';
import { Apps } from './apps';

export function PhoneManagement({ state }: { state: ReturnType<typeof useSession> }) {
  const [settings, setSettings] = useState(location.pathname === '/phone/settings');
  const [tab, setTab] = useState<AccountTab>('General');
  const [message, setMessage] = useState('');
  const session = state.session;
  if (!session?.user || !session.settings)
    return (
      <main>
        {state.loading ? 'Opening Nod…' : state.error || 'Reopen management from Nodilus Settings.'}
      </main>
    );
  const openSettings = (next: AccountTab) => {
    setTab(next);
    setSettings(true);
  };
  return (
    <main className="phone-management">
      <nav aria-label="Phone management">
        <button type="button" onClick={() => setSettings(false)}>
          Apps
        </button>
        <button type="button" onClick={() => openSettings('General')}>
          Server settings
        </button>
      </nav>
      {message && <p role="status">{message}</p>}
      {settings ? (
        <AccountSettings
          open
          initialTab={tab}
          openRequest={1}
          onOpenChange={setSettings}
          account={{
            user: session.user,
            theme: session.settings.theme,
            usageData: session.settings.usageData,
            traces: session.capabilities.traces ? session.settings.traces : undefined,
            saving: state.mutating,
            onSettings: openSettings,
            onTheme: (theme) => state.update({ theme }),
            onUsageData: (usageData) => state.update({ usageData }),
            onTraces: (traces) => state.update({ traces }),
          }}
        />
      ) : (
        <>
          <p>Provider sign-in opens on your paired Mac.</p>
          <Apps
            onAsk={() => setMessage('Continue this assistant-guided setup in Nod on your Mac.')}
          />
        </>
      )}
    </main>
  );
}
