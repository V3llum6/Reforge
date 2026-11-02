import React, { useState } from 'react';
import { LogIn, LogOut, ChevronDown } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { WorkspaceNavTab } from '../types';

interface TopBarProps {
  activeNav: WorkspaceNavTab;
  onNavigate: (tab: WorkspaceNavTab) => void;
  user: User | null;
  authLoading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeNav,
  onNavigate,
  user,
  authLoading,
  onSignIn,
  onSignOut,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const navItems: Array<{ id: WorkspaceNavTab; label: string }> = [
    { id: 'workbench', label: 'Workbench' },
    { id: 'security', label: 'Security Audit' },
    { id: 'projects', label: 'Saved Projects' },
    { id: 'samples', label: 'Sample Library' },
  ];

  const initials = (user?.displayName || user?.email || 'EN')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <header className="flex items-center justify-between gap-8 px-6 h-14 border-b border-slate-800/80 bg-[#0B1120] shrink-0">
      {/* Zone 1: Single text element Brand wordmark */}
      <button
        type="button"
        onClick={() => onNavigate('workbench')}
        className="font-display text-base font-bold tracking-tight text-slate-100 hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
      >
        Reforge Studio
      </button>

      {/* Zone 2: 4 concise single-line text navigation links */}
      <nav aria-label="Primary Workspace Navigation" className="hidden md:flex items-center gap-6">
        {navItems.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`text-sm font-medium py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isActive
                  ? 'text-slate-100 border-sky-400'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary account/sign-in action */}
      <div className="relative flex items-center shrink-0">
        {authLoading ? (
          <div className="h-8 w-28 rounded-lg bg-slate-800/60 animate-pulse" />
        ) : user ? (
          <div>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[#131C2E] border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {user.photoURL && !avatarFailed ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Signed-in engineer avatar'}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                />
              ) : (
                <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {initials || 'EN'}
                </span>
              )}
              <span className="max-w-[140px] truncate">
                {user.displayName || user.email || 'Signed In'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 mt-2 w-56 z-40 rounded-lg bg-[#131C2E] border border-slate-800 shadow-xl py-1.5">
                  <div className="px-3.5 py-2 border-b border-slate-800/80">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {user.displayName || 'Cloud Engineer'}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate('projects');
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Cloud Saved Projects
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onSignOut();
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs text-red-300 hover:bg-slate-800/60 hover:text-red-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
};
