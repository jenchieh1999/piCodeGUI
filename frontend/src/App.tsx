import { useEffect } from 'react';
import { useChatStore } from './stores/chatStore';
import { useUIStore, useSettingsStore } from './stores';
import { piApi } from './api/client';
import { AppShell } from './components/layout/AppShell';
import { ChatView } from './components/chat/ChatView';
import { SettingsView } from './components/settings/SettingsView';
import { PackagesView } from './components/settings/PackagesView';
import { ThemeEditor } from './components/settings/ThemeEditor';
import { EmptyState } from './components/shared/EmptyState';

export default function App() {
  const activeView = useUIStore((s) => s.activeView);
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  // Initialize settings and connect WebSocket
  useEffect(() => {
    useSettingsStore.getState().loadSettings();
    piApi.connect();
    
    return () => {
      piApi.disconnect();
    };
  }, []);

  const renderContent = () => {
    switch (activeView) {
      case 'chat':
        return activeSessionId ? <ChatView /> : <EmptyState />;
      case 'settings':
        return <SettingsView />;
      case 'packages':
        return <PackagesView />;
      case 'themes':
        return <ThemeEditor />;
      default:
        return <EmptyState />;
    }
  };

  return <AppShell>{renderContent()}</AppShell>;
}
