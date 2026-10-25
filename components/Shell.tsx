'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { href: '/pipeline', label: 'Pipeline', icon: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z' },
  { href: '/leads', label: 'Enquiries', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/follow-ups', label: 'Follow-ups', icon: 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  { href: '/suppliers', label: 'Suppliers', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4' },
  { href: '/reports', label: 'Reports', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { href: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

/**
 * Skyroad Holidays logo with "CRM" underneath.
 * The logo image is the file  public/logo.svg  – replace that file to change it.
 * `small` (phone top bar) shows the logo only.
 */
export function Logo({ small }: { small?: boolean }) {
  return (
    <span className={`logo${small ? ' logo-sm' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Skyroad Holidays" className="logo-img" />
      {!small && <span className="logo-caption">Sales CRM</span>}
    </span>
  );
}

export function Shell({ children, username, logout }: { children: ReactNode; username: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <div className={`shell${open ? ' nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/" className="sidebar-brand"><Logo /></Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`nav-link${active(n.href) ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="avatar" />
            <span>{username}</span>
          </div>
          <form action={logout}>
            <button className="btn btn-link" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" type="button" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="topbar-logo"><Logo small /></span>
          <form action="/search" className="search" role="search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input name="q" type="search" placeholder="Search client, phone, destination, SKQ no…" aria-label="Search" />
          </form>
          <Link href="/leads/new" className="btn btn-primary btn-new">
            <span aria-hidden>+</span><span className="hide-sm"> New enquiry</span>
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
