import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ChevronDown,
  Copy,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  ScrollText,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { createNewSessionFromPicker } from '../../lib/sessionActions';
import { useUIStore } from '../../stores/uiStore';
import type { RightPanelType } from '../../types';
import { cn } from '../shared/utils';

type MenuId = 'file' | 'view' | 'server';

interface TitleMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

interface DesktopTitleBarProps {
  title?: string;
  showMenus?: boolean;
  showServerStatus?: boolean;
}

export function DesktopTitleBar({
  title = 'Pi Agent Desktop',
  showMenus = true,
  showServerStatus = true,
}: DesktopTitleBarProps) {
  const { language } = useI18n();
  const text = TITLEBAR_TEXT[language] ?? TITLEBAR_TEXT.en;
  const addToast = useUIStore((s) => s.addToast);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const rightPanelType = useUIStore((s) => s.rightPanelType);
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const [lastRightPanelType, setLastRightPanelType] = useState<Exclude<RightPanelType, null>>('files');
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [windowState, setWindowState] = useState<DesktopWindowState>({ maximized: false, focused: true });
  const [serverInfo, setServerInfo] = useState<DesktopStartupInfo | null>(null);

  useEffect(() => {
    const bridge = window.piDesktop;
    if (!bridge) return;

    bridge.getWindowState().then(setWindowState).catch(() => undefined);
    bridge.getStartupInfo().then(setServerInfo).catch(() => undefined);
    const disposeWindowState = bridge.onWindowState(setWindowState);
    const disposeServerStatus = bridge.onServerStatus(setServerInfo);

    return () => {
      disposeWindowState();
      disposeServerStatus();
    };
  }, []);

  useEffect(() => {
    if (rightPanelType) {
      setLastRightPanelType(rightPanelType);
    }
  }, [rightPanelType]);

  if (!window.piDesktop) return null;

  const runAction = (action: () => void | Promise<void>) => {
    setOpenMenu(null);
    try {
      Promise.resolve(action()).catch((err) => {
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const openDirectory = (type: 'data' | 'logs') =>
    runAction(async () => {
      const error =
        type === 'data'
          ? await window.piDesktop?.openDataDirectory()
          : await window.piDesktop?.openLogsDirectory();
      if (error) throw new Error(error);
    });

  const fileItems: TitleMenuItem[] = [
    {
      label: text.newSession,
      icon: Plus,
      onSelect: () => runAction(createNewSessionFromPicker),
    },
    {
      label: text.openProject,
      icon: FolderOpen,
      onSelect: () => runAction(createNewSessionFromPicker),
    },
  ];

  const viewItems: TitleMenuItem[] = [
    {
      label: text.toggleSidebar,
      icon: PanelLeft,
      onSelect: () => runAction(() => useUIStore.getState().toggleSidebar()),
    },
    {
      label: text.showChanges,
      icon: GitBranch,
      onSelect: () => runAction(() => useUIStore.getState().setRightPanel('changes')),
    },
    {
      label: text.showFiles,
      icon: FileText,
      onSelect: () => runAction(() => useUIStore.getState().setRightPanel('files')),
    },
    {
      label: text.showTerminal,
      icon: Terminal,
      onSelect: () => runAction(() => useUIStore.getState().setRightPanel('terminal')),
    },
  ];

  const serverItems: TitleMenuItem[] = [
    {
      label: text.restartServer,
      icon: RotateCw,
      onSelect: () => runAction(async () => {
        const info = await window.piDesktop?.restartServer();
        if (info) setServerInfo(info);
      }),
    },
    {
      label: text.diagnostics,
      icon: Activity,
      onSelect: () => runAction(() => {
        window.dispatchEvent(new Event('pi:desktop-open-diagnostics'));
      }),
    },
    {
      label: text.openData,
      icon: Database,
      onSelect: () => openDirectory('data'),
    },
    {
      label: text.openLogs,
      icon: ScrollText,
      onSelect: () => openDirectory('logs'),
    },
  ];

  const serverReady = Boolean(serverInfo?.serverUrl && !serverInfo.startupError);
  const toggleRightSidebar = () => setRightPanel(rightPanelType ? null : lastRightPanelType);

  return (
    <div
      className={cn(
        'pi-titlebar-material app-region-drag relative z-30 flex h-10 flex-shrink-0 items-center border-b text-pi-titlebar-text',
        windowState.focused ? 'opacity-100' : 'opacity-95'
      )}
      onDoubleClick={() => void window.piDesktop?.toggleMaximizeWindow()}
    >
      {openMenu && (
        <div
          className="app-region-no-drag fixed inset-0 z-40"
          onMouseDown={() => setOpenMenu(null)}
        />
      )}

      <div className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-black text-[11px] font-bold leading-none text-white shadow-md shadow-black/25 ring-1 ring-white/10">
          Pi
        </div>
        <div className="mr-1 min-w-0 truncate text-[12px] font-semibold tracking-[0.01em]">{title}</div>

        {showMenus && (
          <div className="app-region-no-drag z-50 flex h-full items-center">
            <TitleMenu
              id="file"
              label={text.file}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              items={fileItems}
            />
            <TitleMenu
              id="view"
              label={text.view}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              items={viewItems}
            />
            <TitleMenu
              id="server"
              label={text.server}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              items={serverItems}
            />
          </div>
        )}
      </div>

      {showMenus && (
        <div className="pi-glass-control app-region-no-drag mr-2 hidden h-7 items-center gap-0.5 rounded-lg p-0.5 md:flex">
          <ChromeToggleButton
            title={sidebarOpen ? text.hideLeftSidebar : text.showLeftSidebar}
            active={sidebarOpen}
            icon={PanelLeft}
            onClick={toggleSidebar}
          />
          <ChromeToggleButton
            title={rightPanelType ? text.hideRightSidebar : text.showRightSidebar}
            active={Boolean(rightPanelType)}
            icon={PanelRight}
            onClick={toggleRightSidebar}
          />
        </div>
      )}

      {showServerStatus && (
      <div className="pi-glass-control app-region-no-drag mr-2 hidden h-6 items-center gap-1 rounded-full px-2.5 text-[10px] text-pi-titlebar-text/80 md:flex">
        <span className={cn('h-1.5 w-1.5 rounded-full', serverReady ? 'bg-pi-success' : 'bg-pi-warning')} />
        <span className="max-w-[220px] truncate">
          {serverReady ? text.serverReady : text.serverUnavailable}
        </span>
      </div>
      )}

      <div className="app-region-no-drag z-50 flex h-full items-center pr-1">
        <WindowButton
          title={text.minimize}
          onClick={() => void window.piDesktop?.minimizeWindow()}
          icon={Minus}
        />
        <WindowButton
          title={windowState.maximized ? text.restore : text.maximize}
          onClick={() => void window.piDesktop?.toggleMaximizeWindow()}
          icon={windowState.maximized ? Copy : Square}
        />
        <WindowButton
          title={text.close}
          onClick={() => void window.piDesktop?.closeWindow()}
          icon={X}
          danger
        />
      </div>
    </div>
  );
}

function ChromeToggleButton({
  title,
  icon: Icon,
  active,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-pressed={active}
      className={cn(
        'flex h-6 w-7 items-center justify-center rounded-md transition-colors hover:text-pi-titlebar-text',
        active
          ? 'bg-pi-titlebar-active text-pi-accent shadow-inner'
          : 'text-pi-titlebar-text/65 hover:bg-pi-titlebar-hover'
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Icon size={14} />
    </button>
  );
}

function TitleMenu({
  id,
  label,
  openMenu,
  setOpenMenu,
  items,
}: {
  id: MenuId;
  label: string;
  openMenu: MenuId | null;
  setOpenMenu: (id: MenuId | null) => void;
  items: TitleMenuItem[];
}) {
  const open = openMenu === id;

  return (
    <div className="relative h-full" onDoubleClick={(event) => event.stopPropagation()}>
      <button
        className={cn(
          'my-1 flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] text-pi-titlebar-text/80 transition-colors hover:bg-pi-titlebar-hover hover:text-pi-titlebar-text',
          open && 'bg-pi-titlebar-active text-pi-titlebar-text shadow-inner'
        )}
        onClick={(event) => {
          event.stopPropagation();
          setOpenMenu(open ? null : id);
        }}
      >
        {label}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="pi-glass-menu absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl py-1"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect }) => (
            <button
              key={itemLabel}
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
              onClick={onSelect}
            >
              <Icon size={14} />
              <span className="truncate">{itemLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WindowButton({
  title,
  icon: Icon,
  onClick,
  danger = false,
}: {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      className={cn(
        'my-1 flex h-8 w-9 items-center justify-center rounded-md text-pi-titlebar-text/70 transition-colors hover:text-pi-titlebar-text',
        danger ? 'hover:bg-pi-error/90 hover:text-white' : 'hover:bg-pi-titlebar-hover'
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Icon size={14} />
    </button>
  );
}

const TITLEBAR_TEXT = {
  en: {
    file: 'File',
    view: 'View',
    server: 'Pi Server',
    newSession: 'New Session',
    openProject: 'Open Project',
    toggleSidebar: 'Toggle Sidebar',
    showChanges: 'Show Changes',
    showFiles: 'Show Files',
    showTerminal: 'Show Terminal',
    showLeftSidebar: 'Show Left Sidebar',
    hideLeftSidebar: 'Hide Left Sidebar',
    showRightSidebar: 'Show Right Sidebar',
    hideRightSidebar: 'Hide Right Sidebar',
    restartServer: 'Restart Server',
    diagnostics: 'Diagnostics',
    openData: 'Open Data Folder',
    openLogs: 'Open Logs Folder',
    serverReady: 'Local server ready',
    serverUnavailable: 'Local server unavailable',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },
  zh: {
    file: '文件',
    view: '视图',
    server: 'Pi 服务',
    newSession: '新建会话',
    openProject: '打开项目',
    toggleSidebar: '切换侧边栏',
    showChanges: '查看变更',
    showFiles: '查看文件',
    showTerminal: '打开终端',
    showLeftSidebar: '显示左侧栏',
    hideLeftSidebar: '隐藏左侧栏',
    showRightSidebar: '显示右侧栏',
    hideRightSidebar: '隐藏右侧栏',
    restartServer: '重启服务',
    diagnostics: '诊断',
    openData: '打开数据目录',
    openLogs: '打开日志目录',
    serverReady: '本地服务已就绪',
    serverUnavailable: '本地服务不可用',
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
    close: '关闭',
  },
  ja: {
    file: 'ファイル',
    view: '表示',
    server: 'Pi サーバー',
    newSession: '新規セッション',
    openProject: 'プロジェクトを開く',
    toggleSidebar: 'サイドバーを切り替え',
    showChanges: '変更を表示',
    showFiles: 'ファイルを表示',
    showTerminal: 'ターミナルを表示',
    showLeftSidebar: '左サイドバーを表示',
    hideLeftSidebar: '左サイドバーを非表示',
    showRightSidebar: '右サイドバーを表示',
    hideRightSidebar: '右サイドバーを非表示',
    restartServer: 'サーバーを再起動',
    diagnostics: '診断',
    openData: 'データフォルダーを開く',
    openLogs: 'ログフォルダーを開く',
    serverReady: 'ローカルサーバー準備完了',
    serverUnavailable: 'ローカルサーバー利用不可',
    minimize: '最小化',
    maximize: '最大化',
    restore: '元に戻す',
    close: '閉じる',
  },
} as const;
