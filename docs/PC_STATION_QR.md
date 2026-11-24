# PC Station Login QR

Each PC Set can have a printable login/logout QR code. Generate it from the
**QR Log** action in Equipment Inventory's PC Sets view. Set `BASE_URL` to the
server address reachable by users' phones before generating codes.

## Student sign-in and station locks

Students must scan a valid PC station QR code before signing in. The station
must exist in `equipment_sets` and have the operational status `active`. The
`equipment_sets.status` field describes whether the station is available for
use; it does not track who is using it.

Occupancy is tracked by the station's row in `pc_station_sessions`. A
non-null `activeUserId` with an unexpired session means the station is locked
to that user. An empty or expired session is available. The first student to
claim an available station is recorded before the ComLab login session is
created.

Another user cannot take over an occupied station. Their login is rejected,
their authentication session is cleared, and the scan screen displays
**“PC station currently in use. Please choose another PC station.”** The only
next action on that screen is **Scan Another PC**.

When a student scans their own active station QR again, the station session
and usage record are closed, the station becomes available, and the student is
signed out of ComLab. Logging out of ComLab also closes that user's active
station sessions.

Student portal routes require an active station session. If the student no
longer has one, ComLab clears the authentication session and redirects to the
landing/scan page.

Station activity is stored as `Login` and `Logout` entries in Authentication
audit logs. Administrators can see all entries in the **Login / Logout
History** tab and filter by role; faculty have a **Login / Logout History**
tab in Audit & History; students can view their own entries from Audit
History.

The application creates `pc_station_sessions` during database initialization.
No separate `pc_sessions` or `pc_stations` tables are used.
