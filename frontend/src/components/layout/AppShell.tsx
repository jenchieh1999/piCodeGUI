import React from 'react';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { RightPanel } from './RightPanel';
import { PermissionOverlay } from '../chat/PermissionDialog';
import { ToastContainer } from '../shared/ToastContainer';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelType = useUIStore((s) => s.rightPanelType);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const pendingPermission = useChatStore((s) => s.pendingPermission);

  return (
    <div className="h-screen w-screen flex flex-col bg-pi-bg text-pi-text select-none">
      {/* Tab Bar */}
      <TabBar />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <div
            className="flex-shrink-0 border-r border-pi-border bg-pi-bg-secondary"
            style={{ width: sidebarWidth }}
          >
            <Sidebar />
          </div>
        )}

        {/* Center Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>

        {/* Right Panel */}
        {rightPanelType && (
          <div
            className="flex-shrink-0 border-l border-pi-border bg-pi-bg-secondary overflow-hidden"
            style={{ width: rightPanelWidth }}
          >
            <RightPanel type={rightPanelType} />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Permission Overlay */}
      {pendingPermission && <PermissionOverlay />}

      {/* Toast Container */}
      <ToastContainer />
    </div>
  );
}
