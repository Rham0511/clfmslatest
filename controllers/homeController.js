
    /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    import path from "path";
    import { getPcStationIdentifierFromRequest } from "../utils/pcStationQr.js";

export const homePage = (req, res) => {
      const scannedIdentifier = getPcStationIdentifierFromRequest(req);
  if (!req.session?.userId && scannedIdentifier) {
        req.session.redirectTo = `/pc-station/uid/${encodeURIComponent(scannedIdentifier)}`;
        req.session.pendingPcStationToken = scannedIdentifier;
    return req.session.save(() =>
          res.redirect(`/pc-station/uid/${encodeURIComponent(scannedIdentifier)}/status`)
    );
  }
  const isStudentLoginScan = req.query?.scan === "student-login";
  if (req.session?.userId && !isStudentLoginScan) {
    return res.redirect("/dashboard");
  }
  const sessionExpiredNotice = req.query?.sessionExpired === "pc-station"
    ? "Your 3-hour PC station session has expired. Please scan an available PC station to log in again."
    : null;
  return res.render("home", {
    title: "ComLab | Computer Laboratory Facilities Management System",
    isStudentLoginScan,
    sessionExpiredNotice
  });
};
