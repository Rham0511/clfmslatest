# PC Station Login QR

Each PC Set can have a printable login/logout QR code. Generate it from the
**QR Log** action in Equipment Inventory's PC Sets view. Set `BASE_URL` to the
server address reachable by users' phones before generating codes.

After signing in to ComLab, scan a station QR once to record a station login.
Scan the same code again to record a station logout. If a different user scans
while the station is active, the previous user's station session is closed and
both the automatic logout and new login are recorded. Logging out of ComLab
also closes any station sessions belonging to that user.

Station activity is stored as `Login` and `Logout` entries in Authentication
audit logs. Administrators can see all entries in the **Login / Logout History**
tab and filter by role; faculty have a **Login / Logout History** tab in Audit
& History; students can view their own entries from Audit History.

Before deploying this feature, apply
[`030_pc_station_sessions.sql`](../migrations/030_pc_station_sessions.sql) to
the application database. It creates the table that tracks which user is
currently active at each station.
