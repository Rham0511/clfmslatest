# Production Deployment Checklist

## After a system update

1. Deploy the reviewed application changes and apply any required database
   migrations.
   For individual student attendance QR codes, apply
   [`migrations/031_student_bound_attendance_qr.sql`](../migrations/031_student_bound_attendance_qr.sql)
   before using the Faculty Attendance QR action. Faculty select only BYOD
   students from the class roster; lab-PC users continue with the existing
   PC station QR flow, which this change does not modify.
   For class-list imports on laboratory schedules, apply
   [`migrations/032_fix_class_list_entries_id.sql`](../migrations/032_fix_class_list_entries_id.sql)
   so roster rows receive generated primary keys.
   For PC station login/logout QR activity, apply
   [`migrations/030_pc_station_sessions.sql`](../migrations/030_pc_station_sessions.sql)
   to the configured ComLab database before testing a station scan. Verify the
   `pc_station_sessions` table exists.
   For computer-lab management and its archive/restore cascade, apply
   [`migrations/035_computer_labs.sql`](../migrations/035_computer_labs.sql)
   through [`migrations/038_use_registered_comlab_labels.sql`](../migrations/038_use_registered_comlab_labels.sql)
   in order.
2. From the application directory, restart the ComLab process and reload its
   environment:

   ```bash
   pm2 restart xianfires --update-env
   ```

3. Confirm that PM2 reports the app as `online`:

   ```bash
   pm2 status xianfires
   ```

4. Check that the local application responds before considering deployment
   complete:

   ```bash
   curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null
   ```

## SMTP credentials rejected

For Gmail SMTP, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, and use the
full Gmail address for both `SMTP_USER` and `MAIL_FROM`. `SMTP_PASS` must be a
Google App Password for that account; a regular account password will be
rejected. The mailer removes grouping spaces from Gmail App Passwords, so the
four groups Google displays can be pasted as-is.

Update the environment on the production server, then reload the PM2 process:

```bash
pm2 restart xianfires --update-env
```

If authentication still fails, generate a new App Password for the configured
Google account and replace `SMTP_PASS` in the production environment before
restarting the app.

## First PM2 setup

If the app has not yet been registered with PM2, run these commands from the
application directory:

```bash
pm2 start npm --name xianfires -- run xian-start
pm2 save
```

Do not start a second copy if `xianfires` is already online. Check with
`pm2 status xianfires` first.
