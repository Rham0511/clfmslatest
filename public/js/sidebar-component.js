(function() {
  try {
    const saved = localStorage.getItem('comlab-main-theme');
    const isLight = saved === 'light';
    document.documentElement.classList.toggle('theme-light', isLight);
    document.documentElement.classList.toggle('theme-dark', !isLight);
    document.documentElement.classList.toggle('dark', !isLight);
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
  } catch (e) {}
})();

const defaultSidebarItems = [
  { label: 'Dashboard', href: '/admin-dashboard', icon: 'fas fa-chart-line' },
  { label: 'Maintenance Monitoring', href: '/maintenance-monitoring', icon: 'fas fa-screwdriver-wrench' },
  { label: 'Equipment Inventory', href: '/equipment-inventory', icon: 'fas fa-microchip' },
  { label: 'Equipment Assignment', href: '/equipment-assignment', icon: 'fas fa-user-check' },
  { label: 'Equipment Availability', href: '/admin-dashboard#equipment-availability', icon: 'fas fa-chart-simple' },
  { label: 'Computer Labs', href: '/page/computer-labs', icon: 'fas fa-building' },
  { label: 'Faculty Management', href: '/faculty-management', icon: 'fas fa-chalkboard-user' },
  { label: 'Equipment Borrowed', href: '/borrow-equipment', icon: 'fas fa-people-carry' },
  { label: 'Laboratory Schedules', href: '/page/laboratory-schedules', icon: 'fas fa-calendar-alt' },
  { label: 'Reports', href: '/page/reports', icon: 'fas fa-file-pdf' },
  { label: 'Technician Accomplishments', href: '/technician-accomplishments', icon: 'fas fa-clipboard-check' },
  { label: 'Audits', href: '/page/audit-logs', icon: 'fas fa-shield-halved' },
  { label: 'Archived Records', href: '/archived-records', icon: 'fas fa-box-archive' },
  { label: 'Logout', href: '/logout', icon: 'fas fa-right-from-bracket' }
];

const isFacilitiesEmbeddedPage = new URLSearchParams(window.location.search).get('embedded') === 'facilities';
if (isFacilitiesEmbeddedPage) document.body?.classList.add('facilities-embedded');
const isAppContentEmbeddedPage = new URLSearchParams(window.location.search).get('embedded') === 'app-shell';
if (isAppContentEmbeddedPage) document.body?.classList.add('app-content-embedded');

const defaultSidebarHeader = {
  iconClass: 'fas fa-server',
  logoText: 'ComLab',
  tagline: 'Laboratory Facilities Management'
};

function getSidebarConfig() {
  const currentRole = String(window.__CURRENT_USER__?.role || '').trim().toLowerCase();
  const isFaculty = ['faculty', 'instructor'].includes(currentRole);
  if (isFaculty) {
    const configuredFaculty = [window.studentSidebarConfig, window.sidebarConfig]
      .find(config => config?.role === 'faculty' && Array.isArray(config.items));
    return configuredFaculty || {
      iconClass: 'fas fa-user-tie',
      logoText: 'ComLab Faculty',
      tagline: 'Faculty Portal',
      role: 'faculty',
      defaultActive: '/faculty-borrow-equipment',
      preferredActiveLabel: 'Borrow Equipment',
      items: [
        { label: 'Dashboard', href: '/faculty-dashboard', icon: 'fas fa-house' },
        { label: 'Laboratory Schedules', href: '/faculty-laboratory-schedules', icon: 'fas fa-calendar-days' },
        { label: 'My MR Items', href: '/faculty-mir-items', icon: 'fas fa-clipboard-list' },
        { label: 'Borrow Equipment', href: '/faculty-borrow-equipment', icon: 'fas fa-box-open' },
        { label: 'Report Equipment Issue', href: '/faculty-report-equipment', icon: 'fas fa-triangle-exclamation' },
        { label: 'Audit & History', href: '/faculty-audit-history', icon: 'fas fa-clock-rotate-left' },
        { label: 'Logout', href: '/logout', icon: 'fas fa-right-from-bracket' }
      ]
    };
  }
  return window.sidebarConfig || {};
}

function getSidebarItems() {
  const config = getSidebarConfig();
  const isAdminShell = document.body.classList.contains('admin-shell');
  if (Array.isArray(config.items) && config.items.length > 0) {
    const items = [...config.items];
    const role = String(window.__CURRENT_USER__?.role || config.role || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (role.includes('admin')) {
      const insertAdminItem = (item) => {
        const exists = items.some((candidate) => normalizeRoute(String(candidate.href || '').split(/[?#]/, 1)[0]) === normalizeRoute(item.href));
        if (!exists) {
          const logoutIndex = items.findIndex((candidate) => candidate.href === '/logout');
          items.splice(logoutIndex >= 0 ? logoutIndex : items.length, 0, item);
        }
      };
      insertAdminItem({ label: 'Faculty Management', href: '/faculty-management', icon: 'fas fa-chalkboard-user' });
      insertAdminItem({ label: 'User Management', href: '/user-management', icon: 'fas fa-user-gear' });
      insertAdminItem({ label: 'Technician Accomplishments', href: '/technician-accomplishments', icon: 'fas fa-clipboard-check' });
      const archivedItem = items.find((item) =>
        normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) === '/archived-records' ||
        String(item.label || '').trim().toLowerCase() === 'archived records'
      ) || { label: 'Archived Records', href: '/archived-records', icon: 'fas fa-box-archive' };
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (
          normalizeRoute(String(items[index].href || '').split(/[?#]/, 1)[0]) === '/archived-records' ||
          String(items[index].label || '').trim().toLowerCase() === 'archived records'
        ) {
          items.splice(index, 1);
        }
      }
      const logoutIndex = items.findIndex((item) => item.href === '/logout');
      items.splice(logoutIndex >= 0 ? logoutIndex : items.length, 0, archivedItem);

      const accomplishmentIndex = items.findIndex((item) =>
        normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) === '/technician-accomplishments' ||
        String(item.label || '').trim().toLowerCase() === 'technician accomplishments'
      );
      if (accomplishmentIndex >= 0) {
        const [accomplishmentsItem] = items.splice(accomplishmentIndex, 1);
        const reportsIndex = items.findIndex((item) =>
          normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) === '/page/reports' ||
          String(item.label || '').trim().toLowerCase() === 'reports'
        );
        const archivedIndex = items.findIndex((item) =>
          normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) === '/archived-records' ||
          String(item.label || '').trim().toLowerCase() === 'archived records'
        );
        const insertIndex = reportsIndex >= 0 ? reportsIndex + 1 : archivedIndex >= 0 ? archivedIndex : items.length;
        items.splice(insertIndex, 0, accomplishmentsItem);
      }
    }
    if (!role.includes('admin')) {
      const isStudent = role === 'student' || config.role === 'student' || document.body.classList.contains('student-portal');
      return isStudent
        ? items.filter((item) => {
            const path = normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]);
            const label = String(item.label || '').trim().toLowerCase();
            return path !== '/student-profile' && label !== 'my profile' &&
              path !== '/student/my-requests' && label !== 'my reports';
          })
        : items;
    }

    return normalizeAdminFacilityItems(items)
      .filter((item) => normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) !== '/page/laboratory-schedules');
  }

  // Fallback: if page indicates student portal, show student-specific items
  const isStudent = config.role === 'student' || document.body.classList.contains('student-portal');
  if (isStudent) {
    return [
      { label: 'Dashboard', href: '/student-dashboard', icon: 'fas fa-house' },
      { label: 'My PC Station', href: '/my-pc-station', icon: 'fas fa-desktop' },
      { label: 'Borrow Equipment', href: '/student/borrow-equipment', icon: 'fas fa-people-carry' },
      { label: 'Report Issue', href: '/student/report-issue', icon: 'fas fa-exclamation-triangle' },
      { label: 'Audit History', href: '/student-audit-history', icon: 'fas fa-clock-rotate-left' },
      { label: 'Logout', href: '/logout', icon: 'fas fa-right-from-bracket' }
    ];
  }

  const role = String(window.__CURRENT_USER__?.role || config.role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return role.includes('admin') || isAdminShell
    ? normalizeAdminFacilityItems(defaultSidebarItems).filter((item) => normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) !== '/page/laboratory-schedules')
    : defaultSidebarItems;
}

function normalizeAdminFacilityItems(sourceItems) {
  const legacyEquipmentPaths = new Set([
    '/equipment-inventory',
    '/equipment-assignment',
    '/equipment-availability',
    '/equipment-borrowed',
    '/admin-dashboard',
    '/borrow-equipment'
  ]);
  const legacyEquipmentLabels = new Set([
    'equipment inventory',
    'equipment assignment',
    'equipment availability',
    'equipment borrowed',
    'borrowed equipment'
  ]);
  const isLegacyEquipmentItem = (item) => {
    const path = normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]);
    const label = String(item.label || '').trim().toLowerCase();
    return (legacyEquipmentPaths.has(path) && path !== '/admin-dashboard') ||
      legacyEquipmentLabels.has(label) ||
      (path === '/admin-dashboard' && label === 'equipment availability');
  };
  const items = [...sourceItems];
  const firstLegacyIndex = items.findIndex(isLegacyEquipmentItem);
  const filteredItems = items.filter((item) => !isLegacyEquipmentItem(item));

  const existingFacilitiesItem = filteredItems.find((item) =>
    normalizeRoute(String(item.href || '').split(/[?#]/, 1)[0]) === '/page/facilities' ||
    String(item.label || '').trim().toLowerCase() === 'facilities'
  );
  if (existingFacilitiesItem) {
    existingFacilitiesItem.label = 'Facilities';
    existingFacilitiesItem.href = '/page/facilities';
    existingFacilitiesItem.icon ||= 'fas fa-building-circle-check';
  } else {
    const insertionIndex = firstLegacyIndex >= 0 ? Math.min(firstLegacyIndex, filteredItems.length) : Math.min(2, filteredItems.length);
    filteredItems.splice(insertionIndex, 0, { label: 'Facilities', href: '/page/facilities', icon: 'fas fa-building-circle-check' });
  }
  return filteredItems;
}

function getSidebarHeader() {
  const config = getSidebarConfig();
  return {
    ...defaultSidebarHeader,
    ...config,
  };
}

function normalizeRoute(path) {
  if (!path) return '/';
  const trimmed = String(path).trim().toLowerCase();
  if (!trimmed) return '/';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
}

function getRouteAliases() {
  return {
    '/student-dashboard': '/student/dashboard',
    '/student-profile': '/student/profile',
    '/student-report-issue': '/student/report-issue',
    '/student-report-equipment': '/student/report-issue',
    '/student-my-requests': '/student/my-requests',
    '/student-borrow-equipment': '/student/borrow-equipment',
    '/student/dashboard': '/student/dashboard',
    '/student/profile': '/student/profile',
    '/student/report-issue': '/student/report-issue',
    '/student/my-requests': '/student/my-requests',
    '/student/borrow-equipment': '/student/borrow-equipment'
  };
}

function getActivePath() {
  const config = getSidebarConfig();
  const pathname = normalizeRoute(window.location.pathname);
  const hash = window.location.hash ? window.location.hash.toLowerCase() : '';
  const aliases = getRouteAliases();
  const aliasedPath = aliases[pathname] || pathname;

  if (pathname === '/page/audit-logs' && new URLSearchParams(window.location.search).get('view') === 'trail') {
    return `${aliasedPath}?view=trail`;
  }

  if (hash) {
    if (pathname === '/page/computer-labs' && hash === '#schedules') return aliasedPath;
    if (pathname === '/page/facilities') return aliasedPath;
    return `${aliasedPath}${hash}`;
  }

  const configuredMatch = (config.items || []).find((item) => {
    const itemPath = normalizeRoute(String(item.href || '').split('#')[0]);
    return itemPath === pathname;
  });
  if (configuredMatch) {
    return configuredMatch.href;
  }

  if (
    config.defaultActive &&
    pathname === normalizeRoute(String(config.defaultActive).split('#')[0])
  ) {
    return normalizeRoute(config.defaultActive);
  }

  if (pathname === '/' || pathname === '/dashboard') {
    return '/admin-dashboard';
  }

  return aliasedPath;
}

function updateSidebarNewReportsNotification(count) {
  const badgeCount = Number(count) || 0;
  const bells = document.querySelectorAll('[data-sidebar-bell]');
  const badges = document.querySelectorAll('[data-new-reports-badge]');

  bells.forEach((bell) => {
    bell.style.display = badgeCount > 0 ? 'inline-block' : 'none';
    bell.setAttribute('aria-hidden', badgeCount > 0 ? 'false' : 'true');
  });

  badges.forEach((badge) => {
    badge.textContent = String(badgeCount);
    badge.style.display = badgeCount > 0 ? 'inline-flex' : 'none';
  });
}

function updateBorrowNotificationBadge(count) {
  const badgeCount = Number(count) || 0;
  document.querySelectorAll('[data-borrow-notif-badge]').forEach((badge) => {
    badge.textContent = String(badgeCount);
    badge.style.display = badgeCount > 0 ? 'inline-flex' : 'none';
  });
  document.querySelectorAll('[data-borrow-notif-icon]').forEach((icon) => {
    icon.style.display = badgeCount > 0 ? 'inline-block' : 'none';
  });
}

window.syncSidebarPendingReportBadge = async function syncSidebarPendingReportBadge() {
  try {
    const response = await fetch('/api/maintenance?status=Pending', { cache: 'no-store' });
    if (!response.ok) {
      updateSidebarNewReportsNotification(0);
      return 0;
    }

    const data = await response.json();
    const pendingReports = Array.isArray(data) ? data : [];
    const unreadCount = pendingReports.filter((report) => {
      const status = String(report?.status || 'Pending').trim().toLowerCase();
      return status === 'pending' || status === 'new';
    }).length;

    updateSidebarNewReportsNotification(unreadCount);
    return unreadCount;
  } catch (error) {
    updateSidebarNewReportsNotification(0);
    return 0;
  }
};

window.syncBorrowSidebarBadge = async function syncBorrowSidebarBadge() {
  try {
    const response = await fetch('/api/borrow-records', { cache: 'no-store' });
    if (!response.ok) {
      updateBorrowNotificationBadge(0);
      return 0;
    }

    const records = await response.json();
    const pendingCount = Array.isArray(records)
      ? records.filter((record) => String(record?.status || '').trim().toLowerCase() === 'pending').length
      : 0;

    updateBorrowNotificationBadge(pendingCount);
    return pendingCount;
  } catch (error) {
    updateBorrowNotificationBadge(0);
    return 0;
  }
};

function renderSidebarComponent() {
  const container = document.getElementById('shared-sidebar');
  if (!container) return;

  const header = getSidebarHeader();
  const currentUser = window.__CURRENT_USER__ || getSidebarConfig().user || null;
  function getInitials(name) {
    const value = (name || '').trim();
    if (!value) return 'ST';
    return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'ST';
  }
  const sidebarItems = getSidebarItems();
  const currentRole = String(window.__CURRENT_USER__?.role || getSidebarConfig().role || '').trim().toLowerCase();
  const navLinks = sidebarItems.map(item => {
    if (item.href === '/equipment-assignment' && !['admin', 'administrator'].includes(currentRole)) return '';
    const isNewReports = String(item.label || '').trim() === 'New Reports';
    const isBorrowLink = /borrow-equipment/i.test(String(item.label || '')) || /borrow-equipment/i.test(String(item.href || '')) || String(item.label || '').trim().toLowerCase() === 'facilities';
    const isBorrowRequests = /borrow requests/i.test(String(item.label || '')) || /borrow-requests/i.test(String(item.href || ''));
    const href = item.href || '/';
    const clickHandler = `setActive(this); closeSidebarOnMobile();`;
    const notifHtml = isBorrowRequests && (getSidebarConfig().role === 'technician' || document.body.classList.contains('technician-portal'))
      ? `<span style="margin-left:auto;display:flex;align-items:center;gap:6px">
            <i class="fas fa-bell" aria-hidden="true" style="color:#ff4d4f;font-size:0.95rem;line-height:1;opacity:0.95;display:none;" data-borrow-notif-icon></i>
            <span data-borrow-notif-badge style="display:none;min-width:18px;padding:2px 6px;border-radius:999px;background:#ff4d4f;color:#fff;font-size:0.75rem;font-weight:700;text-align:center;line-height:1;">0</span>
         </span>`
      : isNewReports && (getSidebarConfig().role === 'technician' || document.body.classList.contains('technician-portal'))
      ? `<span style="margin-left:auto;display:flex;align-items:center;gap:6px">
            <i class="fas fa-bell" aria-hidden="true" style="color:#ff4d4f;font-size:0.95rem;line-height:1;opacity:0.95;display:none;" data-sidebar-bell></i>
            <span data-new-reports-badge style="display:none;min-width:18px;padding:2px 6px;border-radius:999px;background:#ff4d4f;color:#fff;font-size:0.75rem;font-weight:700;text-align:center;line-height:1;">0</span>
         </span>`
      : '';

    return `
      <a class="nav-item sidebar-nav-link text-sm font-medium${isBorrowLink ? ' borrow-link' : ''}" href="${href}" data-open-borrow-modal="false" onclick="${clickHandler}">
        <i class="${item.icon}"></i>
        <span class="sidebar-nav-label">${item.label}</span>
        ${notifHtml}
      </a>
    `;
  }).join('');
  const backLink = header.backRoute ? `
    <a class="nav-item sidebar-nav-link text-sm font-medium sidebar-back-link" href="${header.backRoute}">
      <i class="fas fa-arrow-left"></i>
      <span>${header.backLabel || 'Back'}</span>
    </a>
  ` : '';
  container.innerHTML = `
    <div class="sidebar-overlay" id="sidebarOverlay" hidden></div>
    <div class="sidebar mobile-closed" id="sidebar">
      <div class="sidebar-header">
        <button class="sidebar-close-btn" type="button" aria-label="Collapse navigation" title="Collapse navigation" onclick="closeSidebar()">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
        <div class="sidebar-logo">
          <i class="${header.iconClass}"></i>
          <div class="sidebar-brand-copy">
            <span class="sidebar-logo-text">${header.logoText}</span>
            <p class="sidebar-tagline">${header.tagline}</p>
          </div>
        </div>
      </div>
      <nav class="sidebar-nav">
        ${navLinks}
      </nav>
      ${backLink ? `<div class="sidebar-footer">${backLink}</div>` : ''}
    </div>
  `;

  if (document.body.classList.contains('technician-portal')) {
    window.syncSidebarPendingReportBadge?.();
  }
  if (getSidebarConfig().role === 'admin' || getSidebarConfig().role === 'administrator' || document.body.classList.contains('admin-shell')) {
    window.syncBorrowSidebarBadge?.();
  }
}

function setActive(elementOrHref) {
  const activePath = typeof elementOrHref === 'string'
    ? elementOrHref
    : elementOrHref.getAttribute('href');

  const allItems = document.querySelectorAll('.nav-item');
  allItems.forEach(item => {
    item.classList.remove('active');
    item.removeAttribute('aria-current');
  });

  const matched = Array.from(allItems).find(item => item.getAttribute('href') === activePath);
  if (matched) {
    matched.classList.add('active');
    matched.setAttribute('aria-current', 'page');
  }
}

function markActiveItem() {
  const allItems = document.querySelectorAll('.nav-item');
  const config = getSidebarConfig();
  const currentPath = getActivePath();
  let matchedItem = null;

  if (
    !window.location.hash &&
    new URLSearchParams(window.location.search).get('view') !== 'availability' &&
    config.preferredActiveLabel &&
    normalizeRoute(window.location.pathname) === normalizeRoute(config.defaultActive)
  ) {
    matchedItem = Array.from(allItems).find((item) =>
      item.querySelector('.sidebar-nav-label')?.textContent.trim() === config.preferredActiveLabel
    );
  }

  matchedItem ||= Array.from(allItems).find((item) => item.getAttribute('href') === currentPath);

  if (!matchedItem && !window.location.hash && String(config.defaultActive || '').startsWith('#')) {
    matchedItem = Array.from(allItems).find((item) =>
      item.getAttribute('href') === config.defaultActive
    );
  }

  if (!matchedItem) {
    const currentUrl = new URL(window.location.href);
    const aliases = getRouteAliases();
    const currentPathname = aliases[normalizeRoute(currentUrl.pathname)] || normalizeRoute(currentUrl.pathname);
    matchedItem = Array.from(allItems).find((item) => {
      const href = item.getAttribute('href');
      if (!href) return false;
      const itemUrl = new URL(href, currentUrl);
      const itemPathname = aliases[normalizeRoute(itemUrl.pathname)] || normalizeRoute(itemUrl.pathname);
      if (itemPathname !== currentPathname || itemUrl.hash !== currentUrl.hash) return false;
      const itemView = itemUrl.searchParams.get('view');
      return !itemView || itemView === currentUrl.searchParams.get('view');
    });
  }

  allItems.forEach(item => {
    const isAuditSection = item === matchedItem &&
      normalizeRoute(window.location.pathname) === '/page/audit-logs';
    const isActive = item === matchedItem || isAuditSection;
    item.classList.toggle('active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}

function bindBorrowTrigger() {
  const items = document.querySelectorAll('.nav-item[href*="borrow-equipment"]');
  items.forEach((item) => {
    item.removeEventListener('click', item.__borrowTriggerHandler);
    const handler = (event) => {
      setActive(item);
      closeSidebarOnMobile();
      const href = item.getAttribute('href');
      if (href && href !== '#') {
        if (event) {
          event.preventDefault();
        }
        window.location.assign(href);
        return false;
      }
      return true;
    };
    item.__borrowTriggerHandler = handler;
    item.addEventListener('click', handler);
  });
}

function setSidebarState(isOpen) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const shouldUseMobileLayout = window.innerWidth < 1024;
  const shouldOpen = shouldUseMobileLayout ? isOpen : true;

  sidebar.classList.toggle('mobile-open', shouldOpen);
  sidebar.classList.toggle('mobile-closed', !shouldOpen && shouldUseMobileLayout);

  const isMobileSidebarOpen = shouldOpen && shouldUseMobileLayout;
  if (overlay) {
    overlay.classList.toggle('active', isMobileSidebarOpen);
    overlay.hidden = !isMobileSidebarOpen;
  }

  document.body.classList.toggle('sidebar-open', isMobileSidebarOpen);
  document.documentElement.classList.toggle('sidebar-open', isMobileSidebarOpen);
  // update hamburger aria state if present
  try {
    const toggleBtn = document.getElementById('mobileMenuToggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(Boolean(shouldOpen && shouldUseMobileLayout)));
  } catch (e) { /* ignore */ }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains('mobile-open');
  setSidebarState(!isOpen);
}

function closeSidebar() {
  setSidebarState(false);
}

function closeSidebarOnMobile() {
  if (window.innerWidth < 1024) {
    closeSidebar();
  }
}

function isInternalShellNavigation(url) {
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === '/logout' || url.pathname === '/login' || url.pathname.startsWith('/api/')) return false;
  return !url.pathname.startsWith('/css/') && !url.pathname.startsWith('/js/') && !url.pathname.startsWith('/img/');
}

function updateAppShellHeader(frameDocument, requestedUrl) {
  const header = document.querySelector('.comlab-slim-page-header');
  const titleSelector = 'h1, .page-title, .header-title, .student-page-title, .page-header-title, .comlab-page-heading-title';
  const hidePageTitle = frameDocument?.querySelector('meta[name="app-hide-page-title"]')?.content?.trim().toLowerCase() === 'true';
  if (hidePageTitle) {
    header?.querySelector(titleSelector)?.remove();
    return;
  }
  const rawPageTitle = String(frameDocument?.title || '').trim();
  const targetUrl = requestedUrl ? new URL(requestedUrl.href) : null;
  const matchingItems = targetUrl
    ? getSidebarItems().filter((item) => normalizeRoute(new URL(item.href, targetUrl).pathname) === normalizeRoute(targetUrl.pathname))
    : [];
  const matchingItem = matchingItems.find((item) => {
    const itemUrl = new URL(item.href, targetUrl);
    return itemUrl.hash === targetUrl.hash && itemUrl.searchParams.get('view') === targetUrl.searchParams.get('view');
  }) || matchingItems.find((item) => {
    const itemUrl = new URL(item.href, targetUrl);
    return !itemUrl.hash && !itemUrl.searchParams.has('view');
  }) || matchingItems[0];
  const pageTitleOverride = frameDocument?.querySelector('meta[name="app-page-title"]')?.content?.trim();
  let pageTitle = pageTitleOverride || matchingItem?.label || rawPageTitle.split(/\s*[|•]\s*/)[0].trim();
  if (/^comlab student portal$/i.test(pageTitle)) {
    pageTitle = frameDocument?.querySelector('.system-dashboard-heading h1')?.textContent.trim() || pageTitle;
  }
  if (!header || !pageTitle) return;

  let title = header.querySelector(titleSelector);
  if (!title) {
    title = document.createElement('h1');
    title.className = 'comlab-page-heading-title';
    const target = header.matches('.top-header')
      ? header.querySelector('.top-header-card') || header
      : header;
    const actions = target.querySelector('.system-dashboard-heading-actions, .header-actions, .header-right, .header-icons');
    if (actions?.parentElement === target) target.insertBefore(title, actions);
    else target.prepend(title);
  }
  const headingMain = header.querySelector('.system-dashboard-heading-main, .header-left, .student-page-heading, .heading-copy');
  if (headingMain && title.parentElement !== headingMain) {
    headingMain.prepend(title);
  }
  title.textContent = pageTitle;
  title.style.setProperty('display', 'block', 'important');
  title.style.setProperty(
    'color',
    document.documentElement.classList.contains('theme-light') ? '#1F2937' : '#E6F5EC',
    'important'
  );
  const suffix = rawPageTitle.match(/\s*[|•]\s*.+$/)?.[0] || ' | ComLab';
  document.title = `${pageTitle}${suffix}`;
}

function updateAppShellFrameLayout(frame, hasHeaderSpacer = false) {
  const header = document.querySelector('.comlab-slim-page-header');
  if (!header) return;

  const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
  if (!headerBottom) return;

  if (hasHeaderSpacer) {
    frame.style.marginTop = '0';
    return;
  }

  frame.style.marginTop = `${headerBottom}px`;
  frame.style.height = `calc(100vh - ${headerBottom}px)`;
  frame.style.minHeight = `calc(100vh - ${headerBottom}px)`;
}

function syncStudentAppShellFrameTheme(frame) {
  const isLight = document.documentElement.classList.contains('theme-light');
  try {
    const frameDoc = frame.contentDocument;
    if (frameDoc) {
      frameDoc.documentElement.classList.toggle('dark', !isLight);
      frameDoc.documentElement.classList.toggle('theme-light', isLight);
      frameDoc.documentElement.classList.toggle('theme-dark', !isLight);
      frameDoc.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
      frameDoc.body?.classList.toggle('theme-light', isLight);
      frameDoc.body?.classList.toggle('theme-dark', !isLight);
      frameDoc.body?.setAttribute('data-theme', isLight ? 'light' : 'dark');
      frameDoc.querySelectorAll(COMLAB_MAIN_THEME_CONTAINERS).forEach((container) => {
        container.classList.toggle('theme-light', isLight);
        container.classList.toggle('theme-dark', !isLight);
      });
    }
  } catch (error) {}

  const applyFrameTheme = frame.contentWindow?.applyMainTheme;
  if (typeof applyFrameTheme === 'function') {
    applyFrameTheme(isLight ? 'light' : 'dark');
  }
}

function initializeFixedTableHeaderTheme() {
  if (document.body?.classList.contains('reports-page')) return;

  document.querySelectorAll(COMLAB_MAIN_THEME_CONTAINERS).forEach((container) => {
    applyFixedTableHeaderClasses(container);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            applyFixedTableHeaderClasses(node);
          }
        });
      });
    });
    observer.observe(container, { childList: true, subtree: true });
  });
}

let appShellHistoryIndex = Number(window.history.state?.appShellIndex) || 0;
let appShellNavigationId = 0;

function loadAdminContent(url, { updateHistory = true, direction = 'forward' } = {}) {
  const contentContainer = document.querySelector(
    '.main-container, .facilities-main, .audit-page-content, body > .page-shell'
  );
  if (!contentContainer) return false;
  const navigationId = ++appShellNavigationId;
  const nestedPageHeader = contentContainer.querySelector('.comlab-slim-page-header');
  const existingShellHeader = Array.from(document.querySelectorAll('.comlab-slim-page-header'))
    .find((header) => !contentContainer.contains(header));
  if (nestedPageHeader) {
    if (existingShellHeader) {
      nestedPageHeader.remove();
    } else {
      document.body.append(nestedPageHeader);
    }
  }
  const currentRole = getCurrentComLabRole();
  contentContainer.style.setProperty('padding-left', '0', 'important');
  contentContainer.style.setProperty('padding-right', '0', 'important');
  const appShellHeaderSpacer = currentRole === 'admin'
    ? document.querySelector('.comlab-page-header-spacer')
    : null;
  const appShellHeaderSpacerStyle = appShellHeaderSpacer
    ? window.getComputedStyle(appShellHeaderSpacer)
    : null;
  const appShellHeaderOffset = appShellHeaderSpacer && appShellHeaderSpacerStyle
    ? appShellHeaderSpacer.getBoundingClientRect().height
      + (parseFloat(appShellHeaderSpacerStyle.marginTop) || 0)
      + (parseFloat(appShellHeaderSpacerStyle.marginBottom) || 0)
    : 0;
  if (currentRole === 'student') {
    ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].forEach((property) => {
      contentContainer.style.setProperty(property, '0', 'important');
    });
  }
  if (document.body.classList.contains('faculty-page')) {
    contentContainer.style.setProperty('padding-top', '0', 'important');
    contentContainer.style.setProperty('padding-bottom', '0', 'important');
    if (contentContainer.classList.contains('audit-page-content')) {
      contentContainer.style.setProperty('height', 'auto', 'important');
      contentContainer.style.setProperty('overflow', 'visible', 'important');
    }
  }

  const contentUrl = new URL(url.href);
  contentUrl.searchParams.set('embedded', 'app-shell');
  updateAppShellHeader(null, url);
  const frame = document.createElement('iframe');
  frame.className = 'app-content-frame';
  if (currentRole === 'faculty') frame.classList.add('app-content-frame-faculty');
  if (direction === 'back') frame.classList.add('app-content-frame-back');
  frame.title = 'ComLab page content';
  frame.style.display = 'block';
  frame.style.width = currentRole === 'faculty' ? '100vw' : '100%';
  if (currentRole === 'faculty') {
    frame.style.position = 'relative';
    frame.style.left = window.innerWidth >= 1024 ? 'calc(-1 * var(--sidebar-width))' : '0';
  }
  frame.style.height = '100vh';
  frame.style.minHeight = '100vh';
  frame.style.border = '0';
  frame.style.visibility = 'visible';
  if (appShellHeaderSpacer && appShellHeaderOffset > 0) {
    frame.style.height = `calc(100vh - ${appShellHeaderOffset}px)`;
    frame.style.minHeight = `calc(100vh - ${appShellHeaderOffset}px)`;
  }
  updateAppShellFrameLayout(frame, Boolean(appShellHeaderSpacer));
  frame.src = contentUrl.href;
  frame.addEventListener('load', () => {
    if (navigationId !== appShellNavigationId || !frame.isConnected) return;
    frame.style.visibility = 'visible';
    try {
      const frameDocument = frame.contentDocument;
      if (!frameDocument) {
        console.warn('The page loaded in the app shell, but its document is inaccessible.');
        return;
      }
      frameDocument.body?.classList.add('app-content-embedded');
      frameDocument.querySelectorAll(
        '#shared-sidebar, .sidebar-overlay, .sidebar, .comlab-slim-page-header, .comlab-page-header-spacer, .audit-header-spacer, .top-header, #mobileMenuToggle'
      ).forEach((element) => element.remove());
      if (
        frameDocument.body?.classList.contains('student-portal')
        && !frameDocument.body.classList.contains('faculty-portal')
        && !frameDocument.body.classList.contains('faculty-page')
      ) {
        frameDocument.querySelectorAll('#qr-scan-float-btn, #comlab-help-float-btn')
          .forEach((button) => button.style.setProperty('display', 'none', 'important'));
        frameDocument.querySelectorAll(
          '.student-page-header, .audit-page-heading, .page-header-card, .attendance-page-header'
        ).forEach((header) => {
          header.style.setProperty('display', 'none', 'important');
        });
      }
      const embeddedStyle = frameDocument.createElement('style');
      embeddedStyle.textContent = `
        #shared-sidebar,
        .sidebar-overlay,
        .top-header,
        .comlab-slim-page-header,
        .comlab-page-header-spacer,
        #mobileMenuToggle,
        #qr-scan-float-btn,
        #comlab-help-float-btn,
        #comlab-help-panel,
        .hero:not(.report-hero),
        .page-heading:not(.facilities-heading),
        body:not(.facilities-embedded) :is(.hero:not(.report-hero), .page-heading:not(.facilities-heading)),
        .system-dashboard-heading:not(.facilities-heading),
        body.student-portal:not(.faculty-portal):not(.faculty-page) :is(.student-page-header, .audit-page-heading, .page-header-card, .attendance-page-header) {
          display: none !important;
        }

        html body.app-content-embedded .main-container,
        html body.app-content-embedded .facilities-main {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: none !important;
          min-height: 100vh;
          margin-left: 0 !important;
          transition: none !important;
          transform: none !important;
          animation: none !important;
        }

        html body.app-content-embedded .main-container.computer-labs-page {
          width: 100% !important;
          margin-left: 0 !important;
        }

        html body.app-content-embedded .page-shell {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: none !important;
          margin-left: 0 !important;
        }

        html body.app-content-embedded.faculty-page > :is(.main-container, .audit-page-content, .page-shell) {
          box-sizing: border-box !important;
          width: calc(100vw - var(--sidebar-width)) !important;
          max-width: none !important;
          min-width: 0 !important;
          margin-left: var(--sidebar-width) !important;
          padding-top: .5rem !important;
        }

        .page-content {
          transition: none !important;
          transform: none !important;
          animation: none !important;
        }

        .main-container *:not(.fa-spin),
        .facilities-main *:not(.fa-spin) {
          animation: none !important;
          transition: none !important;
        }

        @media (max-width: 1023px) {
          html body.app-content-embedded.faculty-page > :is(.main-container, .audit-page-content, .page-shell) {
            width: 100vw !important;
            margin-left: 0 !important;
            padding-top: 0 !important;
          }
        }
      `;
      embeddedStyle.textContent += 'html body.app-content-embedded .system-dashboard-heading:not(.facilities-heading),html body.app-content-embedded .comlab-slim-page-header:not(#comlab-header-specificity),html body.app-content-embedded .comlab-page-header-spacer{display:none!important}';
      embeddedStyle.textContent += 'html body.app-content-embedded .facilities-heading{display:none!important}';
      if (
        frameDocument.body?.classList.contains('student-portal')
        && !frameDocument.body.classList.contains('faculty-portal')
        && !frameDocument.body.classList.contains('faculty-page')
      ) {
        embeddedStyle.textContent += 'html body.app-content-embedded.student-portal:not(.faculty-portal):not(.faculty-page) > .main-container,html body.app-content-embedded.student-portal:not(.faculty-portal):not(.faculty-page) > .audit-page-content{padding-top:0!important}html body.app-content-embedded.student-portal:not(.faculty-portal):not(.faculty-page) > .page-shell{box-sizing:border-box!important;width:100%!important;max-width:none!important;margin:0!important;padding-top:0!important;padding-right:clamp(.65rem,3vw,1rem)!important;padding-left:clamp(.65rem,3vw,1rem)!important}';
      }
      frameDocument.head?.appendChild(embeddedStyle);
      syncStudentAppShellFrameTheme(frame);
      updateAppShellHeader(frameDocument, url);
      frame.style.animation = 'none';
      void frame.offsetWidth;
      frame.style.visibility = 'visible';
      frame.style.animation = '';
      frameDocument.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (!link) return;
        const targetUrl = new URL(link.href, frameDocument.baseURI);
        if (!isInternalShellNavigation(targetUrl)) return;
        event.preventDefault();
        loadAdminContent(targetUrl);
      });
    } catch (error) {
      console.error('Unable to prepare the loaded page in the app shell.', error);
    }
  });
  if (appShellHeaderSpacer) {
    contentContainer.replaceChildren(appShellHeaderSpacer, frame);
  } else {
    contentContainer.replaceChildren(frame);
  }
  if (updateHistory) {
    contentContainer.scrollTo(0, 0);
    window.scrollTo(0, 0);
    appShellHistoryIndex += 1;
    window.history.pushState({ appShell: true, appShellIndex: appShellHistoryIndex }, '', url.href);
  }
  markActiveItem();
  closeSidebarOnMobile();
  return true;
}

function initializeAdminContentNavigation() {
  if (isAppContentEmbeddedPage) return;
  document.addEventListener('click', (event) => {
    const link = event.target.closest('.sidebar-nav-link[href]');
    if (!link) return;
    const targetUrl = new URL(link.href, window.location.href);
    if (!isInternalShellNavigation(targetUrl)) return;
    if (!loadAdminContent(targetUrl)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('popstate', (event) => {
    const targetHistoryIndex = Number(event.state?.appShellIndex) || 0;
    loadAdminContent(new URL(window.location.href), {
      updateHistory: false,
      direction: targetHistoryIndex < appShellHistoryIndex ? 'back' : 'forward'
    });
    appShellHistoryIndex = targetHistoryIndex;
  });
  window.addEventListener('resize', () => {
    const frame = document.querySelector('.app-content-frame');
    if (frame) {
      if (frame.classList.contains('app-content-frame-faculty')) {
        frame.style.left = window.innerWidth >= 1024 ? 'calc(-1 * var(--sidebar-width))' : '0';
      }
      updateAppShellFrameLayout(frame, Boolean(document.querySelector('.comlab-page-header-spacer')));
    }
  });
}

function setProfileAvatarContent(element, initials, photoUrl) {
  if (!element) return;
  const isAdminHeaderAvatar = getCurrentComLabRole() === 'admin'
    && element.matches('.system-profile-badge-avatar, .user-avatar, .faculty-profile-avatar');
  if (isAdminHeaderAvatar) {
    element.style.setProperty('box-sizing', 'border-box', 'important');
    element.style.setProperty('width', '1.75rem', 'important');
    element.style.setProperty('height', '1.75rem', 'important');
    element.style.setProperty('min-width', '1.75rem', 'important');
    element.style.setProperty('flex', '0 0 1.75rem', 'important');
    element.style.setProperty('overflow', 'hidden', 'important');
    element.style.setProperty('padding', '0', 'important');
    element.style.setProperty('border', '0', 'important');
    element.style.setProperty('border-radius', '50%', 'important');
  }
  const url = typeof photoUrl === 'string' ? photoUrl.trim() : '';
  if (!url) {
    element.textContent = initials;
    element.classList.remove('has-profile-photo');
    return;
  }

  const image = document.createElement('img');
  image.className = 'profile-avatar-photo';
  image.src = url;
  image.alt = 'Profile photo';
  image.draggable = false;
  if (isAdminHeaderAvatar) {
    image.style.setProperty('display', 'block', 'important');
    image.style.setProperty('width', '100%', 'important');
    image.style.setProperty('height', '100%', 'important');
    image.style.setProperty('max-width', '100%', 'important');
    image.style.setProperty('max-height', '100%', 'important');
    image.style.setProperty('object-fit', 'contain', 'important');
    image.style.setProperty('border-radius', '50%', 'important');
  }
  if (
    document.body.classList.contains('admin-profile-page') &&
    element.matches('.system-profile-badge-avatar, [data-admin-profile-initials]')
  ) {
    element.style.setProperty('overflow', 'hidden', 'important');
    element.style.setProperty('border', '0', 'important');
    element.style.setProperty('border-radius', '50%', 'important');
    element.style.setProperty('outline', '0', 'important');
    element.style.setProperty('box-shadow', 'none', 'important');
    image.style.setProperty('display', 'block', 'important');
    image.style.setProperty('width', '100%', 'important');
    image.style.setProperty('height', '100%', 'important');
    image.style.setProperty('border', '0', 'important');
    image.style.setProperty('border-radius', '50%', 'important');
    image.style.setProperty('clip-path', 'circle(50% at 50% 50%)', 'important');
    image.style.setProperty('-webkit-clip-path', 'circle(50% at 50% 50%)', 'important');
  }
  image.addEventListener('error', () => {
    element.textContent = initials;
    element.classList.remove('has-profile-photo');
  }, { once: true });
  element.replaceChildren(image);
  element.classList.add('has-profile-photo');
}
window.setProfileAvatarContent = setProfileAvatarContent;

function hydrateStudentPageHeader() {
  if (!document.body.classList.contains('student-portal')) return;

  const user = window.__CURRENT_USER__ || {};
  const role = String(user.role || 'Student').trim().toLowerCase();
  const displayName = [user.name, user.fullName, user.displayName]
    .find(value => typeof value === 'string' && value.trim()) || '';
  const initials = String(displayName)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'ST';
  const photoUrl = user.photo || user.photoUrl || user.avatarUrl || user.avatar || '';

  document.querySelectorAll('.student-page-user-initials').forEach(element => {
    setProfileAvatarContent(element, initials, photoUrl);
  });
  document.querySelectorAll('[data-user-name]').forEach(element => {
    element.textContent = displayName || (['faculty', 'instructor'].includes(role) ? 'Faculty' : 'User');
  });
  document.querySelectorAll('.student-page-user-role').forEach(element => {
    element.textContent = ['faculty', 'instructor'].includes(role)
      ? 'Faculty'
      : role.charAt(0).toUpperCase() + role.slice(1);
  });

  document.querySelectorAll('.student-page-user').forEach(identity => {
    if (!identity.querySelector('[data-user-name]')) {
      const copy = identity.querySelector('.student-page-user-copy') || document.createElement('span');
      copy.classList.add('student-page-user-copy');
      copy.style.display = 'grid';
      copy.style.minWidth = '0';

      const name = document.createElement('span');
      name.className = 'student-page-user-name';
      name.dataset.userName = '';
      name.textContent = displayName || (['faculty', 'instructor'].includes(role) ? 'Faculty' : 'User');
      name.style.maxWidth = '9rem';
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.whiteSpace = 'nowrap';

      const roleLabel = identity.querySelector('.student-page-user-role');
      copy.replaceChildren(name);
      if (roleLabel) copy.append(roleLabel);
      else {
        const newRoleLabel = document.createElement('span');
        newRoleLabel.className = 'student-page-user-role';
        newRoleLabel.textContent = ['faculty', 'instructor'].includes(role)
          ? 'Faculty'
          : role.charAt(0).toUpperCase() + role.slice(1);
        copy.append(newRoleLabel);
      }
      identity.append(copy);
    }
  });
}

const COMLAB_MAIN_THEME_KEY = 'comlab-main-theme';
const COMLAB_MAIN_THEME_CONTAINERS = [
  '.main-container',
  '.main-content',
  'body.student-borrow-equipment-page > .page-shell',
  'body.faculty-borrow-equipment-page > .page-shell',
  '.page-shell',
  '.audit-page-content',
  '.facilities-main',
  '.assignment-content',
  '#shared-sidebar',
  '#sidebar',
  '.sidebar',
  '.comlab-slim-page-header'
].join(', ');

function isDashboardThemeManagedPage() {
  return document.body.matches('[data-theme-managed-by-dashboard]');
}

function applyMainTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  const isLight = selectedTheme === 'light';
  document.documentElement.classList.toggle('dark', !isLight);
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  document.documentElement.setAttribute('data-theme', selectedTheme);
  document.body?.classList.toggle('theme-light', isLight);
  document.body?.classList.toggle('theme-dark', !isLight);
  document.body?.setAttribute('data-theme', selectedTheme);

  document.querySelectorAll(COMLAB_MAIN_THEME_CONTAINERS).forEach((container) => {
    container.classList.toggle('theme-light', isLight);
    container.classList.toggle('theme-dark', !isLight);
  });
  document.querySelectorAll('.audit-details-popover').forEach((popover) => {
    popover.classList.toggle('theme-light', isLight);
    popover.classList.toggle('theme-dark', !isLight);
  });

  document.querySelectorAll('[data-main-theme-toggle]').forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(isLight));
    toggle.setAttribute('aria-label', `Switch application to ${isLight ? 'dark' : 'light'} mode`);
    toggle.title = `Switch application to ${isLight ? 'dark' : 'light'} mode`;
    toggle.innerHTML = `<i class="fas ${isLight ? 'fa-moon' : 'fa-sun'}" aria-hidden="true"></i>`;
  });

  const shellTitle = document.querySelector('.comlab-slim-page-header :is(h1, .page-title, .header-title, .student-page-title, .page-header-title, .comlab-page-heading-title)');
  if (shellTitle) {
    shellTitle.style.setProperty('color', isLight ? '#1F2937' : '#E6F5EC', 'important');
  }

  document.querySelectorAll('.system-profile-badge, .student-page-user, header .user-profile').forEach((badge) => {
    badge.classList.toggle('theme-light', isLight);
    badge.classList.toggle('theme-dark', !isLight);
    if (isLight) {
      badge.classList.remove('bg-[#04281b]', 'text-white');
      badge.querySelectorAll('.system-profile-badge-avatar, .student-page-user-initials, .user-avatar')
        .forEach((avatar) => avatar.classList.remove('bg-[#06402b]', 'text-emerald-300'));
      badge.querySelectorAll('.system-profile-badge-name, .student-page-user-name, .user-name')
        .forEach((name) => name.classList.remove('text-white'));
      badge.querySelectorAll('.system-profile-badge-copy, .student-page-user-copy')
        .forEach((copy) => copy.classList.remove('text-white'));
      badge.querySelectorAll('.system-profile-badge-role, .student-page-user-role, .user-role')
        .forEach((role) => role.classList.remove('text-emerald-400'));
    } else {
      badge.classList.add('bg-[#04281b]', 'text-white');
      badge.querySelectorAll('.system-profile-badge-avatar, .student-page-user-initials, .user-avatar')
        .forEach((avatar) => avatar.classList.add('bg-[#06402b]', 'text-emerald-300'));
      badge.querySelectorAll('.system-profile-badge-name, .student-page-user-name, .user-name')
        .forEach((name) => name.classList.add('text-white'));
      badge.querySelectorAll('.system-profile-badge-copy, .student-page-user-copy')
        .forEach((copy) => copy.classList.add('text-white'));
      badge.querySelectorAll('.system-profile-badge-role, .student-page-user-role, .user-role')
        .forEach((role) => role.classList.add('text-emerald-400'));
    }
  });

  document.querySelectorAll('iframe.app-content-frame, iframe.facilities-frame, iframe[data-comlab-frame]').forEach(syncStudentAppShellFrameTheme);
}
window.applyMainTheme = applyMainTheme;

function applyFixedTableHeaderClasses(container) {
  const fixedHeaders = [];
  if (container.matches?.('table thead, table thead th')) fixedHeaders.push(container);
  if (container.matches?.('thead') || container.closest?.('thead')) {
    if (container.matches?.('thead, th')) fixedHeaders.push(container);
    fixedHeaders.push(...container.querySelectorAll('th'));
  }
  fixedHeaders.push(...container.querySelectorAll('table thead, table thead th'));
  fixedHeaders.forEach((element) => {
    element.classList.add('theme-locked-table-header', 'bg-[#0a2e1d]', 'text-white');
  });
}

function hydrateAuthenticatedProfileNames() {
  const user = window.__CURRENT_USER__ || {};
  const isTechnician = String(user.role || window.__CURRENT_USER_ROLE__ || '').toLowerCase().includes('technician')
    || document.body.classList.contains('technician-portal');
  const displayName = [user.fullName, user.displayName, user.name]
    .find(value => typeof value === 'string' && value.trim()) || (isTechnician ? 'Technician' : '');
  const currentRole = String(user.role || window.__CURRENT_USER_ROLE__ || '').trim();
  const normalizedRole = currentRole.toLowerCase().replace(/[\s_-]+/g, '');
  const displayRole = normalizedRole.includes('superadmin')
    ? 'Super Admin'
    : normalizedRole.includes('admin')
      ? 'Admin'
      : normalizedRole.includes('technician')
        ? 'Technician'
        : ['faculty', 'instructor'].includes(normalizedRole)
          ? 'Faculty'
          : normalizedRole === 'student'
            ? 'Student'
            : currentRole;

  if (displayName) {
    const initials = displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');

    document.querySelectorAll('.system-profile-badge-name, .user-name, [data-user-name], [data-tech-name], [data-tech-header-name], [data-tech-profile-name], #adminUserName, #adminBadgeName')
      .forEach(element => {
        element.textContent = displayName;
      });
    document.querySelectorAll('.system-profile-badge-avatar, .user-avatar, [data-user-initials]:not(.student-page-user-initials), [data-tech-initials], [data-tech-header-initials], [data-tech-avatar], #adminAvatar, #adminBadgeAvatar')
      .forEach(element => {
        setProfileAvatarContent(element, initials, user.photo || user.photoUrl || user.avatarUrl || user.avatar || '');
      });
    document.querySelectorAll('.system-profile-badge, .technician-profile-identity').forEach(element => {
      element.setAttribute('aria-label', `${displayName}, ${displayRole || 'Technician'}`);
    });
  }

  if (displayRole) {
    document.querySelectorAll('.system-profile-badge-role, .user-role, [data-user-role], [data-tech-role], [data-tech-header-role], [data-tech-profile-role], #adminUserRole, #adminBadgeRole')
      .forEach(element => {
        element.textContent = displayRole;
      });
  }
}

async function hydrateAuthenticatedProfilePhoto() {
  try {
    const response = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const profile = payload?.user || payload;
    const photoUrl = profile?.photo || profile?.photoUrl || profile?.avatarUrl || profile?.avatar || '';
    if (!photoUrl) return;
    window.__CURRENT_USER__ = { ...(window.__CURRENT_USER__ || {}), photo: photoUrl };
    const displayName = [window.__CURRENT_USER__?.name, profile?.name, profile?.fullName]
      .find(value => typeof value === 'string' && value.trim()) || 'User';
    const initials = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => part.charAt(0).toUpperCase()).join('') || 'U';
    document.querySelectorAll('.system-profile-badge-avatar, .student-page-user-initials, .user-avatar, [data-user-initials]')
      .forEach(element => setProfileAvatarContent(element, initials, photoUrl));
  } catch (error) {
    console.debug('Profile photo could not be loaded for the header.', error);
  }
}

function ensureCompactPageHeaderTitles() {
  const selector = '.system-dashboard-heading, .top-header, .student-page-header, .attendance-page-header, .page-header-card, .technician-profile-header, .page-heading, .hero, .audit-page-heading';
  const titleSelector = 'h1, .page-title, .header-title, .student-page-title, .page-header-title';
  const documentTitle = String(document.title || '').split(/\s*[|•]\s*/)[0].trim();
  const headers = Array.from(document.querySelectorAll(selector));

  headers.forEach((header) => {
    if (header.closest('#shared-sidebar, .sidebar')) return;
    const existingShellHeader = Array.from(document.body.children)
      .find((candidate) => candidate !== header && candidate.matches('.comlab-slim-page-header'));
    if (existingShellHeader && !existingShellHeader.contains(header)) {
      const duplicatesShellControls = header.querySelector(
        '[data-comlab-notification-button], .comlab-notification-button'
      ) && header.querySelector('.system-profile-badge, .user-profile');
      if (duplicatesShellControls && !header.querySelector(titleSelector)) {
        header.remove();
      } else {
        header.classList.remove('comlab-slim-page-header');
        delete header.dataset.comlabFixedPageHeader;
      }
      return;
    }
    if (header.matches('.facilities-heading')) {
      header.classList.add('comlab-slim-page-header');
      header.dataset.comlabManagedHeader = 'true';
      header.dataset.comlabFixedPageHeader = 'true';
      if (!header.previousElementSibling?.matches('.comlab-page-header-spacer')) {
        const spacer = document.createElement('div');
        spacer.className = 'comlab-page-header-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        header.parentElement?.insertBefore(spacer, header);
      }
      return;
    }
    if (header.matches('.page-heading') && document.body.classList.contains('computer-labs-admin-page')) {
      header.classList.add('comlab-slim-page-header');
      header.dataset.comlabFixedPageHeader = 'true';
      if (!header.previousElementSibling?.matches('.comlab-page-header-spacer')) {
        const spacer = document.createElement('div');
        spacer.className = 'comlab-page-header-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        header.parentElement?.insertBefore(spacer, header);
      }
      document.body.append(header);
      return;
    }
    if (header.parentElement?.closest(selector)) return;
    if (header.dataset.comlabFixedPageHeader === 'true') return;

    header.classList.add('comlab-slim-page-header');
    header.dataset.comlabFixedPageHeader = 'true';

    if (documentTitle && header.dataset.comlabHideAutoTitle !== 'true' && !header.querySelector(titleSelector)) {
      const target = header.matches('.top-header')
        ? header.querySelector('.top-header-card') || header
        : header;
      const title = document.createElement('h1');
      title.className = 'comlab-page-heading-title';
      title.textContent = documentTitle;
      const actions = target.querySelector('.system-dashboard-heading-actions, .header-actions, .header-right, .header-icons');
      if (actions?.parentElement === target) target.insertBefore(title, actions);
      else target.prepend(title);
    }
    const heading = header.querySelector(`${titleSelector}, .comlab-page-heading-title`);
    const headingMain = header.querySelector('.system-dashboard-heading-main, .header-left, .student-page-heading, .heading-copy');
    if (heading && headingMain && heading.parentElement !== headingMain) {
      headingMain.prepend(heading);
    }
    if (heading) {
      heading.style.setProperty('display', 'block', 'important');
      heading.style.setProperty(
        'color',
        document.documentElement.classList.contains('theme-light') ? '#1F2937' : '#E6F5EC',
        'important'
      );
    }

    if (header.dataset.comlabNoHeaderSpacer !== 'true') {
      const spacer = document.createElement('div');
      spacer.className = 'comlab-page-header-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      header.parentElement?.insertBefore(spacer, header);
    }
    document.body.append(header);
  });
}

function getCurrentComLabRole() {
  const role = String(window.__CURRENT_USER__?.role || getSidebarConfig().role || '').trim().toLowerCase();
  if (role.includes('admin') || document.body.classList.contains('admin-shell')) return 'admin';
  if (role.includes('technician') || document.body.classList.contains('technician-portal')) return 'technician';
  if (['faculty', 'instructor'].includes(role) || document.body.classList.contains('faculty-page')) return 'faculty';
  if (role === 'student' || document.body.classList.contains('student-portal')) return 'student';
  return '';
}

function ensureRoleNotificationButtons() {
  const role = getCurrentComLabRole();
  if (!role) return;

  const user = window.__CURRENT_USER__ || {};
  const displayName = [user.name, user.fullName, user.displayName]
    .find(value => typeof value === 'string' && value.trim()) || 'User';
  const initials = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part.charAt(0).toUpperCase()).join('') || 'U';
  const configuredRoleLabel = String(user.role || window.__CURRENT_USER_ROLE__ || '').toLowerCase();
  const roleLabel = configuredRoleLabel.includes('super')
    ? 'Super Admin'
    : ({ admin: 'Admin', faculty: 'Faculty', technician: 'Technician', student: 'Student' })[role];

  const destinations = {
    admin: { href: '/borrow-equipment', label: 'Open borrow requests' },
    technician: { href: '/technician-dashboard#new-reports', label: 'Open notification center' },
    faculty: { href: '/faculty-my-requests', label: 'Open my requests and approvals' },
    student: { href: '/student-my-requests', label: 'Open my borrow requests' }
  };
  const destination = destinations[role];

  document.querySelectorAll(
    '.comlab-slim-page-header, .facilities-heading, .computer-labs-admin-page .page-heading'
  ).forEach((header) => {
    let button = header.querySelector('#adminBorrowNotificationsButton, [data-comlab-notification-button]');
    let actions = header.querySelector(
      '.system-dashboard-heading-actions, .student-dashboard-profile-column, .header-actions, .header-right, .header-icons, .borrow-header-actions, .attendance-header-actions, .report-issue-header-actions, .my-requests-header-actions, .student-profile-header-actions'
    );

    // Some page-specific headers (notably Technician Accomplishments) are
    // promoted into the shared slim header without an action-group wrapper.
    // Create the wrapper once so notification, theme, and profile controls
    // stay together on the right side of the header.
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'system-dashboard-heading-actions';
      actions.setAttribute('data-comlab-header-actions', 'true');

      const directThemeControls = Array.from(header.children)
        .find((child) => child.classList.contains('profile-theme-controls'));
      const directProfile = Array.from(header.children)
        .find((child) => child.matches('.system-profile-badge, .student-page-user, .user-profile, .faculty-profile-link, .technician-profile-identity'));

      if (directThemeControls) actions.append(directThemeControls);
      if (directProfile) actions.append(directProfile);
      header.append(actions);
    }
    header.classList.add('comlab-shared-header');
    actions.classList.add('comlab-shared-header-actions');
    actions.style.setProperty('display', 'flex', 'important');
    actions.style.setProperty('align-items', 'center', 'important');
    actions.style.setProperty('justify-content', 'flex-end', 'important');
    actions.style.setProperty('flex-wrap', 'nowrap', 'important');
    actions.style.setProperty('gap', '.45rem', 'important');

    if (!header.querySelector('.system-profile-badge, .student-page-user, .user-profile, .faculty-profile-link, .technician-profile-identity')) {
      const profile = document.createElement('div');
      profile.className = 'system-profile-badge profile-theme-static';
      profile.setAttribute('aria-label', `${displayName}, ${roleLabel}`);
      const avatar = document.createElement('span');
      avatar.className = 'system-profile-badge-avatar';
      avatar.dataset.userInitials = '';
      setProfileAvatarContent(avatar, initials, user.photo || user.photoUrl || user.avatarUrl || user.avatar || '');
      const copy = document.createElement('span');
      copy.className = 'system-profile-badge-copy';
      const name = document.createElement('span');
      name.className = 'system-profile-badge-name';
      name.dataset.userName = '';
      name.textContent = displayName;
      const roleText = document.createElement('span');
      roleText.className = 'system-profile-badge-role';
      roleText.textContent = roleLabel;
      copy.append(name, roleText);
      profile.append(avatar, copy);
      actions.append(profile);
    }

    if (role === 'student') {
      let profile = header.querySelector('.system-profile-badge, .student-page-user, .user-profile, .faculty-profile-link');
      if (profile) {
        const isProfileLink = profile instanceof HTMLAnchorElement
          && new URL(profile.href, window.location.origin).pathname === '/student-profile';
        if (!isProfileLink) {
          const profileLink = document.createElement('a');
          Array.from(profile.attributes).forEach((attribute) => {
            if (!attribute.name.toLowerCase().startsWith('on') && attribute.name !== 'href' && attribute.name !== 'role' && attribute.name !== 'tabindex') {
              profileLink.setAttribute(attribute.name, attribute.value);
            }
          });
          while (profile.firstChild) profileLink.append(profile.firstChild);
          profile.replaceWith(profileLink);
          profile = profileLink;
        }

        profile.classList.add('student-profile-avatar-link');
        profile.href = '/student-profile';
        profile.title = 'Open profile';
        profile.setAttribute('aria-label', `Open profile for ${displayName}`);
      }
    }

    if (!button) {
      button = document.createElement('a');
      button.className = 'comlab-notification-button';
      button.href = destination.href;
      button.dataset.comlabNotificationButton = 'true';
      button.innerHTML = '<i class="fas fa-bell" aria-hidden="true"></i><span class="comlab-notification-badge hidden" data-comlab-notification-count aria-live="polite"></span>';

      const before = actions.querySelector(
        '[data-theme-toggle-anchor], .profile-theme-toggle, .system-profile-badge, .faculty-profile-link, .student-page-user, .technician-profile-identity'
      );
      if (before?.parentElement === actions) actions.insertBefore(button, before);
      else actions.prepend(button);
    }

    button.classList.add('comlab-notification-button');
    button.dataset.comlabNotificationButton = 'true';
    button.setAttribute('aria-label', 'Notifications');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'comlab-technician-notification-panel');
    button.title = destination.label;
    const badge = button.querySelector('#adminBorrowNotificationBadge, [data-comlab-notification-count]');
    if (badge) {
      badge.classList.add('comlab-notification-badge');
      button.style.setProperty('position', 'relative', 'important');
      button.style.setProperty('overflow', 'visible', 'important');
      badge.style.setProperty('position', 'absolute', 'important');
      badge.style.setProperty('top', '0', 'important');
      badge.style.setProperty('right', '0', 'important');
      badge.style.setProperty('transform', 'translate(38%, -38%)', 'important');
      badge.style.setProperty('z-index', '2', 'important');
      badge.style.setProperty('pointer-events', 'none', 'important');
    }

    const setActionOrder = (selector, order) => {
      const action = actions.querySelector(selector);
      action?.style.setProperty('order', String(order), 'important');
    };
    setActionOrder('.comlab-notification-button, [data-comlab-notification-button]', 1);
    setActionOrder('[data-theme-toggle-anchor], .profile-theme-controls, .profile-theme-toggle, [data-main-theme-toggle]', 2);
    setActionOrder('.system-profile-badge, .student-page-user, .user-profile, .faculty-profile-link, .technician-profile-identity', 3);
    setActionOrder('.campus-chip', 4);
  });
}

function closeTechnicianNotificationPanel() {
  document.getElementById('comlab-technician-notification-panel')?.remove();
  document.querySelectorAll('[data-comlab-notification-button]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function ensureTechnicianNotificationPanelStyles() {
  if (document.getElementById('comlab-technician-notification-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'comlab-technician-notification-panel-styles';
  style.textContent = `
    #comlab-technician-notification-panel { --notice-bg:#071b13; --notice-surface:rgba(16,49,34,.72); --notice-surface-hover:rgba(21,70,45,.8); --notice-text:#e7f5ec; --notice-heading:#f0fff4; --notice-muted:#a7d9b8; --notice-border:rgba(74,222,128,.3); --notice-soft-border:rgba(74,222,128,.18); --notice-control:rgba(16,49,34,.75); --notice-menu:#082519; --notice-danger:#fda4af; box-sizing:border-box; position:fixed; z-index:100000; top:var(--comlab-notice-top,5rem); right:var(--comlab-notice-right,1rem); width:min(25rem,calc(100vw - 1.5rem)); max-height:min(72vh,38rem); overflow:auto; padding:1rem; border:1px solid var(--notice-border); border-radius:1rem; background:var(--notice-bg); color:var(--notice-text); box-shadow:0 18px 55px rgba(0,0,0,.48); font-family:inherit; font-size:13px; font-weight:500; line-height:1.45; }
    @media (max-width:900px), (pointer:coarse) { #comlab-technician-notification-panel { left:max(12px,env(safe-area-inset-left)); right:max(12px,env(safe-area-inset-right)); width:auto; } }
    html.theme-light #comlab-technician-notification-panel { --notice-bg:#fff; --notice-surface:#f4faf6; --notice-surface-hover:#eaf5ee; --notice-text:#24372c; --notice-heading:#15271c; --notice-muted:#64766b; --notice-border:#cbded0; --notice-soft-border:#dce9df; --notice-control:#f2f8f4; --notice-menu:#fff; --notice-danger:#be123c; box-shadow:0 18px 48px rgba(21,54,34,.2); }
    #comlab-technician-notification-panel .comlab-notice-heading { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding-bottom:.75rem; border-bottom:1px solid var(--notice-soft-border); }
    #comlab-technician-notification-panel .comlab-notice-heading strong { font-size:1rem; color:var(--notice-heading); }
    #comlab-technician-notification-panel .comlab-notice-heading span { color:var(--notice-muted); font-size:.75rem; }
    #comlab-technician-notification-panel .comlab-notice-clear { padding:.3rem .55rem; border:1px solid var(--notice-soft-border); border-radius:.5rem; background:var(--notice-control); color:var(--notice-muted); font:inherit; font-size:.72rem; cursor:pointer; }
    #comlab-technician-notification-panel .comlab-notice-clear:hover { border-color:rgba(74,222,128,.55); color:var(--notice-heading); }
    #comlab-technician-notification-panel .comlab-notice-clear:disabled { opacity:.5; cursor:wait; }
    #comlab-technician-notification-panel .comlab-notice-section { padding-top:.85rem; }
    #comlab-technician-notification-panel .comlab-notice-section-heading { display:flex; align-items:center; justify-content:space-between; gap:.5rem; margin-bottom:.45rem; color:var(--notice-text); font-weight:750; }
    #comlab-technician-notification-panel .comlab-notice-section-heading a { color:#6ee7a5; font-size:.75rem; text-decoration:none; }
    #comlab-technician-notification-panel .comlab-notice-item { position:relative; display:block; margin-top:.4rem; }
    #comlab-technician-notification-panel .comlab-notice-row { display:block; width:100%; min-width:0; padding:.65rem 2.8rem .65rem .75rem; border:1px solid var(--notice-soft-border); border-radius:.7rem; background:var(--notice-surface); color:inherit; text-align:left; text-decoration:none; }
    #comlab-technician-notification-panel .comlab-notice-row:hover, #comlab-technician-notification-panel .comlab-notice-row:focus-visible { border-color:rgba(74,222,128,.5); background:var(--notice-surface-hover); outline:none; }
    #comlab-technician-notification-panel .comlab-notice-row.is-read { opacity:.78; }
    #comlab-technician-notification-panel .comlab-notice-row strong { display:block; overflow:hidden; color:var(--notice-heading); text-overflow:ellipsis; white-space:nowrap; }
    #comlab-technician-notification-panel .comlab-notice-row small { display:block; margin-top:.15rem; color:var(--notice-muted); }
    #comlab-technician-notification-panel .comlab-notice-row .comlab-notice-time { margin-top:.2rem; color:var(--notice-muted); font-size:.68rem; }
    #comlab-technician-notification-panel .comlab-notice-row .comlab-notice-state { font-size:.65rem; font-weight:750; }
    #comlab-technician-notification-panel .comlab-notice-menu-wrap { position:absolute; top:.25rem; right:.3rem; }
    #comlab-technician-notification-panel .comlab-notice-menu-toggle { display:grid; width:2rem; height:2rem; place-items:center; border:1px solid transparent; border-radius:.55rem; background:transparent; color:var(--notice-muted); cursor:pointer; }
    #comlab-technician-notification-panel .comlab-notice-menu-toggle:hover, #comlab-technician-notification-panel .comlab-notice-menu-toggle[aria-expanded="true"] { border-color:var(--notice-soft-border); background:var(--notice-surface); color:var(--notice-heading); }
    #comlab-technician-notification-panel .comlab-notice-menu { position:absolute; z-index:2; top:2.1rem; right:0; display:grid; min-width:8.5rem; gap:.2rem; padding:.3rem; border:1px solid var(--notice-border); border-radius:.7rem; background:var(--notice-menu); box-shadow:0 12px 30px rgba(0,0,0,.24); }
    #comlab-technician-notification-panel .comlab-notice-menu[hidden] { display:none; }
    #comlab-technician-notification-panel .comlab-notice-menu button { display:flex; align-items:center; gap:.55rem; width:100%; padding:.5rem .6rem; border:0; border-radius:.45rem; background:transparent; color:var(--notice-text); font:inherit; text-align:left; cursor:pointer; }
    #comlab-technician-notification-panel .comlab-notice-menu button:hover { background:var(--notice-surface-hover); }
    #comlab-technician-notification-panel .comlab-notice-menu button[data-notification-action="delete"] { color:var(--notice-danger); }
    #comlab-technician-notification-panel .comlab-notice-empty { padding:.6rem .7rem; border-radius:.7rem; background:var(--notice-surface); color:var(--notice-muted); }
    @keyframes comlab-notification-target-pulse { 0%,100% { filter:none; transform:scale(1); box-shadow:none; } 22%,58% { filter:brightness(1.2); transform:scale(1.012); box-shadow:0 0 0 3px rgba(74,222,128,.52); } }
    .comlab-notification-target-highlight { position:relative; z-index:2; transform-origin:center; animation:comlab-notification-target-pulse 1.1s ease-in-out 3; }
    .comlab-notification-target-marker { display:inline-flex; align-items:center; justify-content:center; margin-right:.45rem; color:#43e58b; font-size:1.2em; font-weight:900; animation:comlab-notification-marker-nudge .55s ease-in-out 4; }
    @keyframes comlab-notification-marker-nudge { 0%,100% { transform:translateX(0); } 50% { transform:translateX(.28rem); } }
    @media (prefers-reduced-motion:reduce) { .comlab-notification-target-highlight,.comlab-notification-target-marker { animation:none !important; } }
  `;
  document.head.append(style);
}

function sortNotificationsNewestFirst(notifications) {
  return [...notifications].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || '');
    const rightTime = Date.parse(right.createdAt || '');
    const leftHasTime = Number.isFinite(leftTime);
    const rightHasTime = Number.isFinite(rightTime);
    if (leftHasTime && rightHasTime && leftTime !== rightTime) return rightTime - leftTime;
    if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
    const leftId = String(left.id || '');
    const rightId = String(right.id || '');
    if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
      const idOrder = rightId.length - leftId.length || rightId.localeCompare(leftId);
      if (idOrder !== 0) return idOrder;
    }
    return rightId.localeCompare(leftId);
  });
}

function createNotificationPanelItem(notification) {
  const item = document.createElement('div');
  item.className = 'comlab-notice-item';
  const link = document.createElement('a');
  link.className = 'comlab-notice-row';
  link.href = notification.targetUrl || '#';
  link.dataset.comlabNotificationItem = 'true';
  link.dataset.notificationId = String(notification.id || '');
  const isRead = Boolean(notification.readAt);
  if (isRead) link.classList.add('is-read');
  const rowTitle = document.createElement('strong');
  rowTitle.textContent = notification.title || 'Notification';
  const rowMeta = document.createElement('small');
  rowMeta.textContent = notification.message || '';
  const createdAt = new Date(notification.createdAt);
  const hasCreatedAt = Boolean(notification.createdAt) && Number.isFinite(createdAt.getTime());
  const rowTime = hasCreatedAt ? document.createElement('time') : null;
  if (rowTime) {
    rowTime.className = 'comlab-notice-time';
    rowTime.dateTime = createdAt.toISOString();
    rowTime.textContent = createdAt.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  const rowState = document.createElement('small');
  rowState.className = 'comlab-notice-state';
  rowState.textContent = isRead ? 'Read' : 'Unread';
  link.append(rowTitle, rowMeta);
  if (rowTime) link.append(rowTime);
  link.append(rowState);

  const menuWrap = document.createElement('div');
  menuWrap.className = 'comlab-notice-menu-wrap';
  const menuToggle = document.createElement('button');
  menuToggle.type = 'button';
  menuToggle.className = 'comlab-notice-menu-toggle';
  menuToggle.setAttribute('aria-label', 'Notification options');
  menuToggle.setAttribute('aria-haspopup', 'menu');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.innerHTML = '<i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>';
  menuToggle.dataset.comlabNotificationMenuToggle = 'true';
  const menu = document.createElement('div');
  menu.className = 'comlab-notice-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  [
    { action: 'hide', label: 'Hide', icon: 'fa-eye-slash' },
    { action: 'mute', label: 'Mute', icon: 'fa-bell-slash' },
    { action: 'delete', label: 'Delete', icon: 'fa-trash' }
  ].forEach(({ action, label, icon }) => {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.setAttribute('role', 'menuitem');
    actionButton.dataset.notificationAction = action;
    actionButton.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i><span>${label}</span>`;
    menu.append(actionButton);
  });
  menuWrap.append(menuToggle, menu);
  item.append(link, menuWrap);
  return item;
}

function updateNotificationPanelItem(item, notification) {
  const link = item.querySelector('[data-comlab-notification-item]');
  if (!link) return;
  link.href = notification.targetUrl || '#';
  const title = link.querySelector('strong');
  const message = link.querySelector('small:not(.comlab-notice-state)');
  if (title) title.textContent = notification.title || 'Notification';
  if (message) message.textContent = notification.message || '';

  const date = new Date(notification.createdAt);
  const hasCreatedAt = Boolean(notification.createdAt) && Number.isFinite(date.getTime());
  let time = link.querySelector('.comlab-notice-time');
  if (!hasCreatedAt) {
    time?.remove();
    return;
  }
  if (!time) {
    time = document.createElement('time');
    time.className = 'comlab-notice-time';
    const state = link.querySelector('.comlab-notice-state');
    if (state) state.before(time);
    else link.append(time);
  }
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function toggleTechnicianNotificationPanel(button) {
  const role = getCurrentComLabRole();
  if (!role) return;
  if (document.getElementById('comlab-technician-notification-panel')) {
    closeTechnicianNotificationPanel();
    return;
  }

  ensureTechnicianNotificationPanelStyles();
  const panel = document.createElement('section');
  panel.id = 'comlab-technician-notification-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  panel.innerHTML = '<div class="comlab-notice-heading"><strong>Notifications</strong><span>Loading…</span></div><div class="comlab-notice-empty">Loading your notifications…</div>';
  document.body.append(panel);
  button.setAttribute('aria-expanded', 'true');

  const placePanel = () => {
    if (!panel.isConnected) return;
    const rect = button.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - rect.right);
    const top = Math.min(rect.bottom + 10, Math.max(12, window.innerHeight - 180));
    panel.style.setProperty('--comlab-notice-right', `${right}px`);
    panel.style.setProperty('--comlab-notice-top', `${top}px`);
    if (window.matchMedia('(max-width: 900px), (pointer: coarse)').matches) {
      panel.style.left = 'max(12px, env(safe-area-inset-left))';
      panel.style.right = 'max(12px, env(safe-area-inset-right))';
      panel.style.width = 'auto';
    }
  };
  placePanel();
  window.addEventListener('resize', placePanel, { passive: true, once: true });

  let notificationData;
  let loadError = null;
  try {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Notification request failed with status ${response.status}.`);
    notificationData = await response.json();
  } catch (error) {
    loadError = error;
    console.error('Unable to load notifications.', error);
  }
  if (!panel.isConnected) return;
  const notifications = sortNotificationsNewestFirst(
    Array.isArray(notificationData?.notifications) ? notificationData.notifications : []
  );
  const failed = Boolean(loadError);
  const unreadCount = Number(notificationData?.unreadCount) || 0;
  const totalCount = Number(notificationData?.totalCount) || notifications.length;
  panel.dataset.unreadCount = String(unreadCount);
  panel.dataset.totalCount = String(totalCount);
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'comlab-notice-heading';
  const headingCopy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Notifications';
  const summary = document.createElement('span');
  summary.textContent = failed
    ? 'Could not load notifications'
    : `${unreadCount} unread · ${totalCount} total`;
  headingCopy.append(title, summary);
  headingCopy.style.display = 'grid';
  const markAllRead = document.createElement('button');
  markAllRead.type = 'button';
  markAllRead.className = 'comlab-notice-clear';
  markAllRead.textContent = 'Mark all read';
  markAllRead.disabled = unreadCount === 0 || failed;
  markAllRead.dataset.comlabNotificationReadAll = 'true';
  header.append(headingCopy, markAllRead);
  panel.append(header);

  if (failed) {
    const error = document.createElement('div');
    error.className = 'comlab-notice-empty';
    error.textContent = 'Unable to load notifications. Please close and reopen the panel to try again.';
    panel.append(error);
  } else {
    if (!notifications.length) {
      const empty = document.createElement('div');
      empty.className = 'comlab-notice-empty comlab-notice-empty-state';
      empty.textContent = 'You are all caught up.';
      panel.append(empty);
    }
    notifications.forEach(notification => panel.append(createNotificationPanelItem(notification)));
  }

  if (!failed) {
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'comlab-notice-clear';
    clearAll.textContent = 'Clear all';
    clearAll.disabled = totalCount === 0;
    clearAll.dataset.comlabNotificationClearAll = 'true';
    clearAll.style.display = 'block';
    clearAll.style.width = '100%';
    clearAll.style.marginTop = '.5rem';
    panel.append(clearAll);
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-comlab-notification-button]');
  const role = getCurrentComLabRole();
  if (button && role) {
    event.preventDefault();
    event.stopPropagation();
    toggleTechnicianNotificationPanel(button);
    return;
  }
  const panel = document.getElementById('comlab-technician-notification-panel');
  if (!panel) return;
  if (panel.contains(event.target)) {
    const menuToggle = event.target.closest('[data-comlab-notification-menu-toggle]');
    if (menuToggle) {
      event.preventDefault();
      const menu = menuToggle.parentElement?.querySelector('.comlab-notice-menu');
      if (!menu) return;
      const willOpen = menu.hidden;
      panel.querySelectorAll('.comlab-notice-menu').forEach(otherMenu => {
        otherMenu.hidden = true;
        otherMenu.parentElement?.querySelector('[data-comlab-notification-menu-toggle]')?.setAttribute('aria-expanded', 'false');
      });
      menu.hidden = !willOpen;
      menuToggle.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    const actionButton = event.target.closest('[data-notification-action]');
    if (actionButton) {
      event.preventDefault();
      const item = actionButton.closest('.comlab-notice-item');
      const notificationRow = item?.querySelector('[data-comlab-notification-item]');
      const notificationId = notificationRow?.dataset.notificationId;
      const action = actionButton.dataset.notificationAction;
      if (!notificationId || !['hide', 'mute', 'delete'].includes(action)) return;
      const wasUnread = !notificationRow.classList.contains('is-read');
      actionButton.disabled = true;
      const actionUrl = action === 'delete'
        ? `/api/notifications/${encodeURIComponent(notificationId)}`
        : `/api/notifications/${encodeURIComponent(notificationId)}/${action}`;
      fetch(actionUrl, {
        method: action === 'delete' ? 'DELETE' : 'PUT',
        cache: 'no-store'
      }).then(response => {
        if (!response.ok) throw new Error(`Could not ${action} notification (${response.status}).`);
        item.remove();
        refreshRoleNotificationCount();
        const remainingCount = Math.max(0, Number(panel.dataset.totalCount) - 1);
        const remainingUnread = Math.max(0, Number(panel.dataset.unreadCount) - (wasUnread ? 1 : 0));
        panel.dataset.totalCount = String(remainingCount);
        panel.dataset.unreadCount = String(remainingUnread);
        const summary = panel.querySelector('.comlab-notice-heading span');
        if (summary) summary.textContent = `${remainingUnread} unread · ${remainingCount} total`;
        const markAllRead = panel.querySelector('[data-comlab-notification-read-all]');
        if (markAllRead) markAllRead.disabled = remainingUnread === 0;
        if (!panel.querySelector('.comlab-notice-item')) {
          const empty = document.createElement('div');
          empty.className = 'comlab-notice-empty comlab-notice-empty-state';
          empty.textContent = 'You are all caught up.';
          panel.insertBefore(empty, panel.querySelector('[data-comlab-notification-clear-all]'));
        }
        const clearAll = panel.querySelector('[data-comlab-notification-clear-all]');
        if (clearAll) clearAll.disabled = !panel.querySelector('.comlab-notice-item');
      }).catch(error => {
        console.error(`Unable to ${action} notification.`, error);
        actionButton.disabled = false;
        const message = panel.querySelector('.comlab-notice-error') || document.createElement('div');
        message.className = 'comlab-notice-empty comlab-notice-error';
        message.textContent = `Could not ${action} this notification. Please try again.`;
        panel.append(message);
      });
      return;
    }

    if (event.target.closest('[data-comlab-notification-clear-all]')) {
      event.preventDefault();
      const clearButton = event.target.closest('[data-comlab-notification-clear-all]');
      clearButton.disabled = true;
      fetch('/api/notifications/clear', { method: 'PUT', cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`Could not clear notifications (${response.status}).`);
        panel.querySelectorAll('.comlab-notice-item').forEach(item => item.remove());
        panel.dataset.unreadCount = '0';
        panel.dataset.totalCount = '0';
        panel.querySelector('.comlab-notice-heading span').textContent = '0 unread · 0 total';
        panel.querySelector('[data-comlab-notification-read-all]').disabled = true;
        const empty = document.createElement('div');
        empty.className = 'comlab-notice-empty comlab-notice-empty-state';
        empty.textContent = 'You are all caught up.';
        panel.insertBefore(empty, clearButton);
        refreshRoleNotificationCount();
      }).catch(error => {
        console.error('Unable to clear notifications.', error);
        clearButton.disabled = false;
        const message = panel.querySelector('.comlab-notice-error') || document.createElement('div');
        message.className = 'comlab-notice-empty comlab-notice-error';
        message.textContent = 'Could not clear notifications. Please try again.';
        panel.append(message);
      });
      return;
    }

    const notificationItem = event.target.closest('[data-comlab-notification-item]');
    if (notificationItem) {
      event.preventDefault();
      const notificationId = notificationItem.dataset.notificationId;
      const target = new URL(notificationItem.href, window.location.origin);
      if (target.origin !== window.location.origin || !notificationId) return;
      fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PUT',
        cache: 'no-store',
        keepalive: true
      }).then(response => {
        if (!response.ok) throw new Error(`Could not mark notification as read (${response.status}).`);
      }).catch(error => {
        console.error('Unable to mark the opened notification as read.', error);
      });
      closeTechnicianNotificationPanel();
      window.location.assign(target.href);
      return;
    }
    if (event.target.closest('[data-comlab-notification-read-all]')) {
      event.preventDefault();
      fetch('/api/notifications/read-all', { method: 'PUT', cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`Could not mark notifications as read (${response.status}).`);
        panel.querySelectorAll('.comlab-notice-row:not(.is-read)').forEach(row => {
          row.classList.add('is-read');
          const state = row.querySelector('.comlab-notice-state');
          if (state) state.textContent = 'Read';
        });
        const unreadTotal = panel.querySelector('.comlab-notice-heading span');
        if (unreadTotal) unreadTotal.textContent = `0 unread · ${panel.dataset.totalCount} total`;
        panel.dataset.unreadCount = '0';
        panel.querySelector('[data-comlab-notification-read-all]').disabled = true;
        refreshRoleNotificationCount();
      }).catch(error => {
        console.error('Unable to mark all notifications as read.', error);
        const message = panel.querySelector('.comlab-notice-error') || document.createElement('div');
        message.className = 'comlab-notice-empty comlab-notice-error';
        message.textContent = 'Could not mark notifications as read. Please try again.';
        panel.append(message);
      });
      return;
    }
    if (event.target.closest('[data-comlab-notification-link]')) closeTechnicianNotificationPanel();
    return;
  }
  closeTechnicianNotificationPanel();
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeTechnicianNotificationPanel();
});

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const maintenanceId = params.get('maintenanceId');
  const borrowRecordId = params.get('borrowRecordId');
  if (!maintenanceId && !borrowRecordId) return;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('comlab:focus-technician-notification', {
      detail: maintenanceId
        ? { type: 'maintenance', recordId: maintenanceId }
        : { type: 'borrow', recordId: borrowRecordId }
    }));
    params.delete('maintenanceId');
    params.delete('borrowRecordId');
    const remainingQuery = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`
    );
  }, 900);
});

function ensureAdminProfileShortcut() {
  if (getCurrentComLabRole() !== 'admin') return;

  if (!document.getElementById('comlab-admin-profile-shortcut-styles')) {
    const style = document.createElement('style');
    style.id = 'comlab-admin-profile-shortcut-styles';
    style.textContent = `
      .admin-profile-shortcut { cursor: pointer !important; transition: filter .16s ease, box-shadow .16s ease; }
      .admin-profile-shortcut:hover { filter: brightness(1.12); }
      .admin-profile-shortcut:focus-visible { outline: 2px solid #34d399; outline-offset: 3px; }
    `;
    document.head.append(style);
  }

  document.querySelectorAll('.system-profile-badge, header .user-profile, .top-header .user-profile').forEach(profile => {
    if (profile.closest('#shared-sidebar, .sidebar')) return;
    profile.classList.add('admin-profile-shortcut');
    profile.title = 'Open profile management';
    profile.setAttribute('aria-label', `${profile.querySelector('.system-profile-badge-name, .user-name')?.textContent.trim() || 'Administrator'} — open profile management`);
    if (profile instanceof HTMLAnchorElement) {
      profile.href = '/admin-profile';
    } else {
      profile.setAttribute('role', 'link');
      profile.tabIndex = 0;
      profile.dataset.adminProfileShortcut = 'true';
    }
  });
}

function ensureFloatingScanButton() {
  if (!getCurrentComLabRole() || window.__COMLAB_QR_SCANNER_BUTTON_INITIALIZED__) return;
  if (document.querySelector('script[data-comlab-floating-scanner]')) return;

  const scannerScript = document.createElement('script');
  scannerScript.src = '/js/qr-scanner-button.js?v=11';
  scannerScript.dataset.comlabFloatingScanner = 'true';
  document.head.append(scannerScript);
}

document.addEventListener('click', event => {
  const profile = event.target.closest('[data-admin-profile-shortcut="true"]');
  if (!profile) return;
  event.preventDefault();
  window.location.assign('/admin-profile');
});

document.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const profile = event.target.closest?.('[data-admin-profile-shortcut="true"]');
  if (!profile) return;
  event.preventDefault();
  window.location.assign('/admin-profile');
});

function setRoleNotificationCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  document.querySelectorAll('[data-comlab-notification-button]').forEach((button) => {
    const badge = button.querySelector('[data-comlab-notification-count], #adminBorrowNotificationBadge');
    if (!badge) return;
    badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    badge.classList.toggle('hidden', safeCount < 1);
    const countLabel = safeCount === 1 ? '1 item needs attention' : `${safeCount} items need attention`;
    button.setAttribute('aria-label', `Notifications, ${countLabel}`);
    button.title = countLabel;
  });
}

function syncOpenNotificationPanel(notificationData) {
  const panel = document.getElementById('comlab-technician-notification-panel');
  if (!panel || !Array.isArray(notificationData?.notifications)) return;

  const notifications = sortNotificationsNewestFirst(notificationData.notifications);
  const unreadValue = Number(notificationData.unreadCount);
  const totalValue = Number(notificationData.totalCount);
  const unreadCount = Number.isFinite(unreadValue) ? Math.max(0, unreadValue) : 0;
  const totalCount = Number.isFinite(totalValue) ? Math.max(0, totalValue) : notifications.length;
  const notificationsById = new Map(
    notifications.map((notification) => [String(notification.id || ''), notification])
  );
  const itemsById = new Map();

  panel.querySelectorAll('.comlab-notice-item').forEach((item) => {
    const row = item.querySelector('[data-comlab-notification-item]');
    const notificationId = String(row?.dataset.notificationId || '');
    const notification = notificationsById.get(notificationId);
    if (!notification) {
      item.remove();
      return;
    }
    itemsById.set(notificationId, item);
    updateNotificationPanelItem(item, notification);
    const isRead = Boolean(notification.readAt);
    row.classList.toggle('is-read', isRead);
    const state = row.querySelector('.comlab-notice-state');
    if (state) state.textContent = isRead ? 'Read' : 'Unread';
  });

  let hasNewNotifications = false;
  notifications.forEach((notification) => {
    const notificationId = String(notification.id || '');
    if (itemsById.has(notificationId)) return;
    itemsById.set(notificationId, createNotificationPanelItem(notification));
    hasNewNotifications = true;
  });

  const orderedItems = notifications
    .map((notification) => itemsById.get(String(notification.id || '')))
    .filter(Boolean);
  const currentOrder = Array.from(panel.querySelectorAll('.comlab-notice-item'))
    .map((item) => String(item.querySelector('[data-comlab-notification-item]')?.dataset.notificationId || ''));
  const expectedOrder = orderedItems.map((item) =>
    String(item.querySelector('[data-comlab-notification-item]')?.dataset.notificationId || '')
  );
  const orderChanged = currentOrder.some((notificationId, index) => notificationId !== expectedOrder[index])
    || currentOrder.length !== expectedOrder.length;
  if (orderChanged) {
    panel.querySelector('.comlab-notice-empty-state')?.remove();
    const fragment = document.createDocumentFragment();
    orderedItems.forEach((item) => fragment.append(item));
    panel.insertBefore(fragment, panel.querySelector('[data-comlab-notification-clear-all]') || null);
  }

  const hasNotifications = orderedItems.length > 0;
  const emptyState = panel.querySelector('.comlab-notice-empty-state');
  if (!hasNotifications && !emptyState) {
    const empty = document.createElement('div');
    empty.className = 'comlab-notice-empty comlab-notice-empty-state';
    empty.textContent = 'You are all caught up.';
    panel.insertBefore(empty, panel.querySelector('[data-comlab-notification-clear-all]') || null);
  } else if (hasNotifications) {
    emptyState?.remove();
  }
  if (hasNewNotifications || orderChanged) panel.scrollTop = 0;

  panel.dataset.unreadCount = String(unreadCount);
  panel.dataset.totalCount = String(totalCount);
  const summary = panel.querySelector('.comlab-notice-heading span');
  if (summary) summary.textContent = `${unreadCount} unread · ${totalCount} total`;
  const markAllRead = panel.querySelector('[data-comlab-notification-read-all]');
  if (markAllRead) markAllRead.disabled = unreadCount === 0;
  const clearAll = panel.querySelector('[data-comlab-notification-clear-all]');
  if (clearAll) clearAll.disabled = totalCount === 0;
}

async function refreshRoleNotificationCount() {
  const role = getCurrentComLabRole();
  if (!role) return;

  try {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Notification count request failed with status ${response.status}.`);
    const data = await response.json();
    setRoleNotificationCount(data?.unreadCount);
    syncOpenNotificationPanel(data);
  } catch (error) {
    console.error('Unable to refresh notification count.', error);
  }
}

function initializeMainThemeToggle() {
  const savedTheme = localStorage.getItem(COMLAB_MAIN_THEME_KEY);
  const initialTheme = savedTheme === 'light' ? 'light' : 'dark';
  applyMainTheme(initialTheme);
  initializeFixedTableHeaderTheme();

  const profileBadges = Array.from(document.querySelectorAll(
    '.system-profile-badge, .student-page-user, header .user-profile'
  )).filter((badge) => !badge.closest('#shared-sidebar, .sidebar'));
  profileBadges.forEach((profileBadge) => {
    const profileElements = [profileBadge, ...profileBadge.querySelectorAll('*')];
    profileElements.forEach((element) => {
      element.classList.remove(
        'bg-white',
        'bg-[#0a2e1d]',
        'text-gray-900',
        'text-gray-800',
        'theme-light',
        'theme-dark'
      );
    });
    profileBadge.classList.add('profile-theme-static');
    if (initialTheme === 'light') {
      profileBadge.classList.add('theme-light');
    } else {
      profileBadge.classList.add('bg-[#04281b]', 'text-white');
      profileBadge.querySelectorAll('.system-profile-badge-avatar, .student-page-user-initials, .user-avatar')
        .forEach((avatar) => avatar.classList.add('bg-[#06402b]', 'text-emerald-300'));
      profileBadge.querySelectorAll('.system-profile-badge-name, .student-page-user-name, .user-name')
        .forEach((name) => name.classList.add('text-white'));
      profileBadge.querySelectorAll('.system-profile-badge-copy, .student-page-user-copy')
        .forEach((copy) => copy.classList.add('text-white'));
      profileBadge.querySelectorAll('.system-profile-badge-role, .student-page-user-role, .user-role')
        .forEach((role) => role.classList.add('text-emerald-400'));
    }
  });

  if (isDashboardThemeManagedPage()) {
    document.querySelectorAll('.profile-theme-controls, [data-main-theme-toggle]').forEach((element) => {
      if (!element.closest('#shared-sidebar, .sidebar')) element.remove();
    });
    return;
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'profile-theme-toggle';
  toggle.setAttribute('data-main-theme-toggle', '');
  toggle.addEventListener('click', () => {
    const nextTheme = toggle.getAttribute('aria-pressed') === 'true' ? 'dark' : 'light';
    localStorage.setItem(COMLAB_MAIN_THEME_KEY, nextTheme);
    applyMainTheme(nextTheme);
  });

  const controls = document.createElement('div');
  controls.className = 'profile-theme-controls';
  controls.append(toggle);

  const toggleAnchor = document.querySelector('[data-theme-toggle-anchor]');
  if (toggleAnchor) {
    toggleAnchor.append(controls);
  } else {
    const headerSelector = [
      '.system-dashboard-heading',
      '.inventory-toolbar',
      '.student-page-header',
      '.attendance-page-header',
      '.top-header-card',
      '.top-header',
      '.page-header-card',
      '.technician-profile-header',
      'header'
    ].join(', ');
    const headers = Array.from(document.querySelectorAll(headerSelector))
      .filter((candidate) => !candidate.closest('#shared-sidebar, .sidebar'));
    const visibleHeaders = headers.filter((candidate) => {
      const style = window.getComputedStyle(candidate);
      return candidate.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
    const header = visibleHeaders.find((candidate) =>
      profileBadges.some((badge) => candidate.contains(badge))
    ) || visibleHeaders[0];

    if (header) {
      const profileBadge = profileBadges.find((badge) => header.contains(badge));
      const profileItem = profileBadge;
      const headerAction = header.querySelector(
        '.system-dashboard-heading-actions, .inventory-header-actions, .header-actions, .header-right, .header-icons'
      ) || profileItem?.parentElement;
      const target = headerAction || header;
      if (profileItem?.parentElement === target) {
        target.insertBefore(controls, profileItem);
      } else {
        target.append(controls);
      }
    } else {
      const main = document.querySelector('.main-container, .audit-page-content, .page-shell');
      if (!main) return;
      const fallbackHeader = document.createElement('header');
      fallbackHeader.className = 'system-dashboard-heading theme-toggle-header-fallback';
      fallbackHeader.append(controls);
      main.prepend(fallbackHeader);
    }
  }

  applyMainTheme(initialTheme);
}

window.addEventListener('storage', (event) => {
  if (event.key === COMLAB_MAIN_THEME_KEY) {
    applyMainTheme(event.newValue === 'light' ? 'light' : 'dark');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  if (isFacilitiesEmbeddedPage || isAppContentEmbeddedPage) {
    document.getElementById('shared-sidebar')?.remove();
    document.querySelectorAll(
      '.comlab-slim-page-header, .comlab-page-header-spacer, .top-header, #mobileMenuToggle'
    ).forEach((element) => element.remove());
    applyMainTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    if (isAppContentEmbeddedPage) initializeFixedTableHeaderTheme();
    return;
  }
  hydrateStudentPageHeader();
  hydrateAuthenticatedProfileNames();
  renderSidebarComponent();
  initializeMainThemeToggle();
  ensureCompactPageHeaderTitles();
  ensureRoleNotificationButtons();
  ensureAdminProfileShortcut();
  ensureFloatingScanButton();
  refreshRoleNotificationCount();
  hydrateAuthenticatedProfilePhoto();
  if (window.__COMLAB_HEADER_NOTIFICATION_TIMER__) {
    window.clearInterval(window.__COMLAB_HEADER_NOTIFICATION_TIMER__);
  }
  window.__COMLAB_HEADER_NOTIFICATION_TIMER__ = window.setInterval(refreshRoleNotificationCount, 30000);
  markActiveItem();
  bindBorrowTrigger();
  setSidebarState(window.innerWidth >= 1024);
  window.toggleSidebar = toggleSidebar;
  window.setActive = setActive;
  window.closeSidebar = closeSidebar;
  window.closeSidebarOnMobile = closeSidebarOnMobile;
  // inject a mobile menu toggle into the page header if missing
  const ensureMobileToggle = () => {
    const isStudentPortal = document.body.classList.contains('student-portal');
    const toggleButtons = Array.from(document.querySelectorAll('#mobileMenuToggle, .menu-toggle'))
      .filter(element => element instanceof HTMLButtonElement);
    const existingToggle = document.getElementById('mobileMenuToggle') || toggleButtons[0];

    if (isStudentPortal) {
      toggleButtons.forEach(button => {
        if (button !== existingToggle) button.remove();
      });
    }

    if (existingToggle) {
      existingToggle.id = existingToggle.id || 'mobileMenuToggle';
      existingToggle.type = existingToggle.type || 'button';
      existingToggle.setAttribute('aria-label', 'Open navigation');
      existingToggle.setAttribute('aria-expanded', 'false');
      if (!existingToggle.hasAttribute('onclick')) {
        existingToggle.setAttribute('onclick', 'toggleSidebar()');
      }
      if (isStudentPortal) {
        existingToggle.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i>';
        existingToggle.classList.remove('menu-toggle', 'block', 'lg:hidden');
        existingToggle.classList.add('student-page-menu');
        const header = existingToggle.closest(
          '.comlab-slim-page-header, .system-dashboard-heading, .student-page-header, .page-header-card, header'
        ) || document.querySelector(
          '.comlab-slim-page-header, .system-dashboard-heading, .student-page-header, .page-header-card, header'
        );
        if (header) {
          const headingMain = header.querySelector(
            '.system-dashboard-heading-main, .student-page-heading, .header-left, .heading-copy'
          );
          const firstContent = headingMain?.parentElement === header
            ? headingMain
            : header.firstElementChild;
          header.insertBefore(existingToggle, firstContent);
        }
      } else {
        existingToggle.classList.add('menu-toggle', 'block', 'lg:hidden');
      }
      return;
    }

    if (isStudentPortal) {
      const header = document.querySelector(
        '.comlab-slim-page-header, .system-dashboard-heading, .student-page-header, .page-header-card, header'
      );
      if (header) {
        const btn = document.createElement('button');
        btn.id = 'mobileMenuToggle';
        btn.type = 'button';
        btn.className = 'student-page-menu';
        btn.setAttribute('aria-label', 'Open navigation');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('onclick', 'toggleSidebar()');
        btn.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i>';
        const headingMain = header.querySelector(
          '.system-dashboard-heading-main, .student-page-heading, .header-left, .heading-copy'
        );
        const firstContent = headingMain?.parentElement === header
          ? headingMain
          : header.firstElementChild;
        header.insertBefore(btn, firstContent);
        return;
      }
    }

    const header = document.querySelector('.page-header-card') || document.querySelector('header');
    const btn = document.createElement('button');
    btn.id = 'mobileMenuToggle';
    btn.type = 'button';
    btn.className = 'menu-toggle block lg:hidden';
    btn.setAttribute('aria-label', 'Open navigation');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('onclick', 'toggleSidebar()');
    btn.innerHTML = '<i class="fas fa-bars"></i>';
    if (header && header.parentElement) {
      // try to insert into header area
      try { header.insertBefore(btn, header.firstChild); return; } catch (e) { /* fallthrough */ }
    }
    // fallback: append to body so it's always reachable (fixed positioned via CSS)
    document.body.appendChild(btn);
  };
  ensureMobileToggle();
  initializeAdminContentNavigation();
  // ensure overlay click closes sidebar (defensive)
  const overlayEl = document.getElementById('sidebarOverlay');
  if (overlayEl) overlayEl.addEventListener('click', () => { closeSidebar(); const mb=document.getElementById('mobileMenuToggle'); if (mb) mb.setAttribute('aria-expanded', 'false'); });
  // ensure hamburger also toggles aria when clicked (safe hookup if toggle existed prior)
  const mobileToggleEl = document.getElementById('mobileMenuToggle');
  if (mobileToggleEl && !mobileToggleEl.dataset.hook) {
    mobileToggleEl.addEventListener('click', () => {
      const s = document.getElementById('sidebar');
      mobileToggleEl.setAttribute('aria-expanded', String(!!s && s.classList.contains('mobile-open')));
    });
    mobileToggleEl.dataset.hook = '1';
  }
});

window.addEventListener('hashchange', () => {
  markActiveItem();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeSidebar();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) {
    setSidebarState(true);
  } else {
    setSidebarState(false);
  }
});

window.addEventListener('click', event => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar || window.innerWidth >= 1024) return;
  const toggle = event.target.closest('[onclick="toggleSidebar()"], #mobileMenuToggle, .menu-toggle');
  if (overlay && event.target === overlay) {
    closeSidebar();
    return;
  }
  if (!sidebar.contains(event.target) && !toggle) {
    closeSidebar();
  }
});
