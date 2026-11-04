# Views Directory

This folder contains all view templates for the ComLab application.

## 📁 Structure

```
views/
├── admin/          # Admin dashboard and management pages
├── student/        # Student portal pages
├── technician/     # Technician dashboard pages
├── partials/       # Reusable template components
└── *.xian          # Handlebars templates for auth & shared pages
```

## 📄 File Organization

### Admin Views (`admin/`)
- `admin-dashboard.html` - Main admin dashboard
- `attendance.html` - Attendance monitoring page
- `borrow-equipment.html` - Equipment borrowing management
- `equipment-inventory.html` - Equipment inventory management
- `archived-records.html` - Admin-only archive listing with restore actions
- `maintenance-reports.html` - Maintenance reports page

### Student Views (`student/`)
- `student-dashboard.html` - Student main dashboard
- `student-borrow-equipment.html` - Equipment borrowing interface
- `student-profile.html` - Student profile page
- `student-my-requests.html` - View student issue reports and faculty borrow requests
- `student-report-equipment.html` - Report equipment issues
- `student-report-issue.html` - General issue reporting
- `student-scan-attendance.html` - QR code attendance scanning
- `my-pc-station.html` - PC station assignment

### Technician Views (`technician/`)
- `technician-dashboard.html` - Technician dashboard

### Handlebars Templates (`.xian`)
- `login.xian` - Login page
- `register.xian` - Registration page
- `home.xian` - Home/landing page
- `dashboard.xian` - Generic dashboard template
- `forgotpassword.xian` - Password recovery
- `reset-password.xian` - Password reset
- `verify-otp.xian` - OTP verification
- `verify-result.xian` - Verification result page
- `check-email.xian` - Email verification prompt

### Partials (`partials/`)
Reusable template components used across multiple views.

## 🔧 Usage

### HTML Files
HTML files are served through `routes/index.js` using the `serveHtmlPage` function. The routing automatically determines the subfolder based on the page name prefix:
- `admin-*` → `views/admin/`
- `student-*` → `views/student/`
- `technician-*` → `views/technician/`

### Handlebars Templates
`.xian` files are rendered using the Handlebars engine through controllers (e.g., `authController.js`).
The root route (`/`) renders `home.xian` for signed-out visitors; its login and registration links go to `/login` and `/register`.

Example:
```javascript
res.render("login", { title: "Login" });
```

## 📝 Notes
- All static HTML files should be placed in their appropriate subdirectory
- Handlebars templates (`.xian`) remain in the root `views/` folder
- Partials are stored in `views/partials/` for reuse across templates
