const sidebarUserRole = String(window.__CURRENT_USER__?.role || 'student').trim().toLowerCase();
const isFaculty = ['faculty', 'instructor'].includes(sidebarUserRole);

window.studentSidebarConfig = isFaculty ? {
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
} : {
  iconClass: 'fas fa-graduation-cap',
  logoText: 'ComLab',
  tagline: 'Student Portal',
  role: 'student',
  items: [
    { label: 'Dashboard', href: '/student-dashboard', icon: 'fas fa-house' },
    { label: 'My PC Station', href: '/my-pc-station', icon: 'fas fa-desktop' },
    { label: 'Borrow Equipment', href: '/student/borrow-equipment', icon: 'fas fa-people-carry' },
    { label: 'Report Issue', href: '/student/report-issue', icon: 'fas fa-exclamation-triangle' },
    { label: 'Audit History', href: '/student-audit-history', icon: 'fas fa-clock-rotate-left' },
    { label: 'Logout', href: '/logout', icon: 'fas fa-right-from-bracket' }
  ]
};

window.sidebarConfig = window.studentSidebarConfig;
