import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { piApi } from '../../api/client';
import { ArrowLeft, Package, Download, Trash2, Puzzle, BookOpen, FileText, Palette } from 'lucide-react';

export function PackagesView() {
  const packages = useExtensionStore((s) => s.packages);
  const setActiveView = useUIStore((s) => s.setActiveView);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-display font-semibold text-pi-text">Pi Packages</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {packages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-pi-dim gap-3">
            <Package size={32} strokeWidth={1} />
            <p className="text-xs">No packages installed</p>
            <p className="text-[10px]">
              Use <code className="font-mono bg-pi-bg-tertiary px-1 rounded">pi install</code> or
              install from the marketplace
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {packages.map((pkg) => (
              <div
                key={pkg.source}
                className="flex items-start gap-3 p-3 rounded-lg border border-pi-border hover:border-pi-muted transition-colors"
              >
                <Package size={16} className="text-pi-accent mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-pi-text">{pkg.name}</span>
                    <span className="text-[10px] text-pi-dim font-mono">v{pkg.version}</span>
                  </div>
                  <div className="text-[10px] text-pi-dim mt-0.5">{pkg.source}</div>
                  <div className="flex items-center gap-3 mt-1">
                    {pkg.extensions.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-pi-dim">
                        <Puzzle size={10} /> {pkg.extensions.length}
                      </span>
                    )}
                    {pkg.skills.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-pi-dim">
                        <BookOpen size={10} /> {pkg.skills.length}
                      </span>
                    )}
                    {pkg.themes.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-pi-dim">
                        <Palette size={10} /> {pkg.themes.length}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => piApi.send({ type: 'package_remove', source: pkg.source })}
                  className="text-pi-dim hover:text-pi-error transition-colors"
                  title="Uninstall"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
