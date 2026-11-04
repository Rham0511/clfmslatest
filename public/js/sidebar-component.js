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
    return items;
  }

  // Fallback: if page indicates student portal, show student-specific items
  const isStudent = config.role === 'student' || document.body.classList.contains('student-portal');
  if (isStudent) {
    return [
      { label: 'Dashboard', href: '/student-dashboard', icon: 'fas fa-house' },
      { label: 'My PC Station', href: '/my-pc-station', icon: 'fas fa-desktop' },
      { label: 'Borrow Equipment', href: '/student/borrow-equipment', icon: 'fas fa-people-carry' },
      { label: 'Report Issue', href: '/student/report-issue', icon: 'fas fa-exclamation-triangle' },
      { label: 'My Reports', href: '/student/my-requests', icon: 'fas fa-list-check' },
      { label: 'My Profile', href: '/student-profile', icon: 'fas fa-user' },
      { label: 'Audit History', href: '/student-audit-history', icon: 'fas fa-clock-rotate-left' },
      { label: 'Logout', href: '/logout', icon: 'fas fa-right-from-bracket' }
    ];
  }

  return defaultSidebarItems;
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
    const isBorrowLink = /borrow-equipment/i.test(String(item.label || '')) || /borrow-equipment/i.test(String(item.href || ''));
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
      : isBorrowLink && (getSidebarConfig().role === 'admin' || getSidebarConfig().role === 'administrator' || document.body.classList.contains('admin-shell'))
        ? `<span style="margin-left:auto;display:flex;align-items:center;gap:6px">
              <i class="fas fa-bell" aria-hidden="true" style="color:#ff4d4f;font-size:0.95rem;line-height:1;opacity:0.95;display:none;" data-borrow-notif-icon></i>
              <span data-borrow-notif-badge style="display:none;min-width:18px;padding:2px 6px;border-radius:999px;background:#ff4d4f;color:#fff;font-size:0.75rem;font-weight:700;text-align:center;line-height:1;">0</span>
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

  if (overlay) {
    overlay.classList.toggle('active', shouldOpen && shouldUseMobileLayout);
    overlay.hidden = !(shouldOpen && shouldUseMobileLayout);
  }

  document.body.classList.toggle('sidebar-open', shouldOpen && shouldUseMobileLayout && document.body.classList.contains('student-portal'));
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

  document.querySelectorAll('.student-page-user-initials').forEach(element => {
    element.textContent = initials;
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
  'body.student-borrow-equipment-page > .page-shell',
  'body.faculty-borrow-equipment-page > .page-shell',
  '.audit-page-content'
].join(', ');

function isDarkOnlyPage() {
  return document.body.matches('.laboratory-schedules-page, .schedule-page, .student-pc-audit-page')
    || /laboratory schedules/i.test(document.title)
    || ['/page/laboratory-schedules', '/faculty-laboratory-schedules'].includes(window.location.pathname);
}

function isDashboardThemeManagedPage() {
  return document.body.matches('[data-theme-managed-by-dashboard]');
}

function applyMainTheme(theme) {
  const darkOnlyPage = isDarkOnlyPage();
  const selectedTheme = !darkOnlyPage && theme === 'light' ? 'light' : 'dark';
  const isLight = selectedTheme === 'light';
  document.documentElement.classList.toggle('dark', !isLight);
  document.documentElement.classList.toggle('theme-light', isLight);
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
}

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
    document.querySelectorAll('.system-profile-badge-avatar, .user-avatar, [data-user-initials], [data-tech-initials], [data-tech-header-initials], [data-tech-avatar], #adminAvatar, #adminBadgeAvatar')
      .forEach(element => {
        element.textContent = initials;
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

function ensureCompactPageHeaderTitles() {
  const selector = '.system-dashboard-heading, .top-header, .student-page-header, .attendance-page-header, .page-header-card, .technician-profile-header, .page-heading, .hero, .audit-page-heading';
  const titleSelector = 'h1, .page-title, .header-title, .student-page-title, .page-header-title';
  const documentTitle = String(document.title || '').split(/\s*[|•]\s*/)[0].trim();
  const headers = Array.from(document.querySelectorAll(selector));

  headers.forEach((header) => {
    if (header.closest('#shared-sidebar, .sidebar')) return;
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

    const spacer = document.createElement('div');
    spacer.className = 'comlab-page-header-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    header.parentElement?.insertBefore(spacer, header);
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
    technician: { href: '/technician-dashboard#borrow-requests', label: 'Open pending work and borrow requests' },
    faculty: { href: '/faculty-my-requests', label: 'Open my requests and approvals' },
    student: { href: '/student-my-requests', label: 'Open my borrow requests' }
  };
  const destination = destinations[role];

  document.querySelectorAll('.comlab-slim-page-header').forEach((header) => {
    let button = header.querySelector('#adminBorrowNotificationsButton, [data-comlab-notification-button]');
    const actions = header.querySelector(
      '.system-dashboard-heading-actions, .student-dashboard-profile-column, .header-actions, .header-right, .header-icons, .borrow-header-actions, .attendance-header-actions, .report-issue-header-actions, .my-requests-header-actions, .student-profile-header-actions'
    ) || header;

    if (!header.querySelector('.system-profile-badge, .student-page-user, .user-profile, .faculty-profile-link, .technician-profile-identity')) {
      const profile = document.createElement('div');
      profile.className = 'system-profile-badge profile-theme-static';
      profile.setAttribute('aria-label', `${displayName}, ${roleLabel}`);
      const avatar = document.createElement('span');
      avatar.className = 'system-profile-badge-avatar';
      avatar.dataset.userInitials = '';
      avatar.textContent = initials;
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
    button.title = destination.label;
    const badge = button.querySelector('#adminBorrowNotificationBadge, [data-comlab-notification-count]');
    if (badge) badge.classList.add('comlab-notification-badge');
  });
}

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

async function refreshRoleNotificationCount() {
  const role = getCurrentComLabRole();
  if (!role) return;

  try {
    if (role === 'technician') {
      const [reportsResponse, borrowResponse] = await Promise.all([
        fetch('/api/maintenance?status=Pending', { cache: 'no-store' }),
        fetch('/api/borrow-notifications?unreadOnly=true', { cache: 'no-store' })
      ]);
      const reports = reportsResponse.ok ? await reportsResponse.json() : [];
      const borrowNotifications = borrowResponse.ok ? await borrowResponse.json() : [];
      const reportCount = Array.isArray(reports) ? reports.length : 0;
      const borrowCount = Array.isArray(borrowNotifications) ? borrowNotifications.length : 0;
      setRoleNotificationCount(reportCount + borrowCount);
      return;
    }

    const response = await fetch('/api/borrow-records', { cache: 'no-store' });
    if (!response.ok) {
      setRoleNotificationCount(0);
      return;
    }
    const records = await response.json();
    if (!Array.isArray(records)) {
      setRoleNotificationCount(0);
      return;
    }

    const count = records.filter((record) => {
      const status = String(record?.effectiveStatus || record?.status || '').trim().toLowerCase();
      if (role === 'admin') return status === 'pending';
      if (role === 'faculty') {
        return record?.canApprove === true || record?.canReturnStudentBorrow === true || (record?.isMyRequest === true && status === 'pending');
      }
      return record?.isMyRequest === true && status === 'pending';
    }).length;
    setRoleNotificationCount(count);
  } catch (error) {
    setRoleNotificationCount(0);
  }
}

function initializeMainThemeToggle() {
  const savedTheme = localStorage.getItem(COMLAB_MAIN_THEME_KEY);
  const darkOnlyPage = isDarkOnlyPage();
  const initialTheme = !darkOnlyPage && savedTheme === 'light' ? 'light' : 'dark';
  applyMainTheme(initialTheme);

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
    profileBadge.classList.add('profile-theme-static', 'bg-[#04281b]', 'text-white');
    profileBadge.querySelectorAll('.system-profile-badge-avatar, .student-page-user-initials, .user-avatar')
      .forEach((avatar) => avatar.classList.add('bg-[#06402b]', 'text-emerald-300'));
    profileBadge.querySelectorAll('.system-profile-badge-name, .student-page-user-name, .user-name')
      .forEach((name) => name.classList.add('text-white'));
    profileBadge.querySelectorAll('.system-profile-badge-copy, .student-page-user-copy')
      .forEach((copy) => copy.classList.add('text-white'));
    profileBadge.querySelectorAll('.system-profile-badge-role, .student-page-user-role, .user-role')
      .forEach((role) => role.classList.add('text-emerald-400'));
  });

  if (darkOnlyPage) {
    document.querySelectorAll('.profile-theme-controls, [data-main-theme-toggle]').forEach((element) => {
      if (!element.closest('#shared-sidebar, .sidebar')) element.remove();
    });
    applyMainTheme('dark');
    return;
  }

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
  hydrateStudentPageHeader();
  hydrateAuthenticatedProfileNames();
  renderSidebarComponent();
  initializeMainThemeToggle();
  ensureCompactPageHeaderTitles();
  ensureRoleNotificationButtons();
  ensureAdminProfileShortcut();
  refreshRoleNotificationCount();
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
        if (!existingToggle.closest('.student-page-header')) {
          const header = document.querySelector('.student-page-header') || document.querySelector('.page-header-card');
          if (header && !header.contains(existingToggle)) {
            const heading = header.querySelector('.student-page-heading') || header;
            heading.insertBefore(existingToggle, heading.firstChild);
          }
        }
      } else {
        existingToggle.classList.add('menu-toggle', 'block', 'lg:hidden');
      }
      return;
    }

    if (isStudentPortal) {
      const header = document.querySelector('.student-page-header');
      if (header) {
        const btn = document.createElement('button');
        btn.id = 'mobileMenuToggle';
        btn.type = 'button';
        btn.className = 'student-page-menu';
        btn.setAttribute('aria-label', 'Open navigation');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('onclick', 'toggleSidebar()');
        btn.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i>';
        const heading = header.querySelector('.student-page-heading') || header;
        heading.insertBefore(btn, heading.firstChild);
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
