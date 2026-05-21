import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { RightPanel } from './RightPanel';
import { DesktopTitleBar } from '../desktop/DesktopTitleBar';
import { ToastContainer } from '../shared/ToastContainer';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../shared/utils';

interface AppShellProps {
  children: React.ReactNode;
}

const RIGHT_PANEL_DEFAULT_WIDTH = 380;
const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_WIDTH = 760;
const RIGHT_PANEL_MAIN_MIN_WIDTH = 420;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function AppShell({ children }: AppShellProps) {
  const { t } = useI18n();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const rightPanelType = useUIStore((s) => s.rightPanelType);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);
  const resizeStateRef = useRef({ startX: 0, startWidth: RIGHT_PANEL_DEFAULT_WIDTH });

  const getRightPanelMaxWidth = useCallback(() => {
    if (typeof window === 'undefined') return RIGHT_PANEL_MAX_WIDTH;

    const availableWidth =
      window.innerWidth -
      (sidebarOpen ? sidebarWidth : 0) -
      RIGHT_PANEL_MAIN_MIN_WIDTH;

    return clamp(availableWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
  }, [sidebarOpen, sidebarWidth]);

  const startRightPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: rightPanelWidth,
      };
      setIsResizingRightPanel(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [rightPanelWidth]
  );

  const handleRightPanelResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 24;
      const maxWidth = getRightPanelMaxWidth();

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setRightPanelWidth(clamp(rightPanelWidth + step, RIGHT_PANEL_MIN_WIDTH, maxWidth));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setRightPanelWidth(clamp(rightPanelWidth - step, RIGHT_PANEL_MIN_WIDTH, maxWidth));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setRightPanelWidth(RIGHT_PANEL_MIN_WIDTH);
      } else if (event.key === 'End') {
        event.preventDefault();
        setRightPanelWidth(maxWidth);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH);
      }
    },
    [getRightPanelMaxWidth, rightPanelWidth, setRightPanelWidth]
  );

  useEffect(() => {
    if (!isResizingRightPanel) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const { startX, startWidth } = resizeStateRef.current;
      const nextWidth = startWidth + startX - event.clientX;
      setRightPanelWidth(clamp(nextWidth, RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth()));
    };

    const stopResize = () => {
      setIsResizingRightPanel(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [getRightPanelMaxWidth, isResizingRightPanel, setRightPanelWidth]);

  useEffect(() => {
    if (!rightPanelType) return;
    const fitRightPanel = () => {
      const nextWidth = clamp(rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth());
      if (nextWidth !== rightPanelWidth) {
        setRightPanelWidth(nextWidth);
      }
    };

    fitRightPanel();
    window.addEventListener('resize', fitRightPanel);

    return () => {
      window.removeEventListener('resize', fitRightPanel);
    };
  }, [getRightPanelMaxWidth, rightPanelType, rightPanelWidth, setRightPanelWidth]);

  return (
    <div className="pi-shell h-screen w-screen flex flex-col text-pi-text select-none">
      <DesktopTitleBar />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <div
            className="pi-sidebar-material flex-shrink-0 border-r"
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
          <>
            <div
              role="separator"
              aria-label={t('app.resizeRightPanel')}
              aria-orientation="vertical"
              aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
              aria-valuemax={getRightPanelMaxWidth()}
              aria-valuenow={rightPanelWidth}
              tabIndex={0}
              title={t('app.resizeRightPanelHint')}
              onPointerDown={startRightPanelResize}
              onKeyDown={handleRightPanelResizeKeyDown}
              onDoubleClick={() => setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH)}
              className={cn(
                'group relative z-20 flex w-2 flex-shrink-0 cursor-col-resize touch-none items-stretch justify-center',
                'before:absolute before:inset-y-2 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:bg-pi-border/70 before:transition-colors',
                'after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-transparent after:transition-colors',
                'outline-none hover:before:bg-pi-accent/70 hover:after:bg-pi-accent/25 focus-visible:bg-pi-accent/10 focus-visible:before:bg-pi-accent focus-visible:after:bg-pi-accent/35',
                isResizingRightPanel && 'bg-pi-accent/10 before:bg-pi-accent after:bg-pi-accent/40'
              )}
            />
            <div
              className="pi-panel-material flex-shrink-0 overflow-hidden border-l"
              style={{ width: rightPanelWidth }}
            >
              <RightPanel type={rightPanelType} />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Toast Container */}
      <ToastContainer />
    </div>
  );
}
