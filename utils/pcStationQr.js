const stationQueryKeys = [
  "station",
  "stationToken",
  "pcStation",
  "pcStationToken",
  "pc",
  "pcId",
  "pc_id",
  "code",
  "pending_station",
  "pendingStation"
];

export const getPcStationIdentifier = (value) => {
  const text = String(value || "").trim();
  if (!text || text.length > 2048) return null;

  if (text.startsWith("{")) {
    try {
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const station = [payload.station, payload.data, payload.pcStation]
        .find((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) || {};
      const identifier = payload.pcSetId || payload.pc_set_id || payload.setId || payload.set_id ||
        payload.stationId || payload.station_id || payload.pcStationId || payload.pc_station_id ||
        payload.stationToken || payload.qrToken || payload.token || payload.code ||
        station.pcSetId || station.setId || station.stationId || station.token || station.code ||
        (typeof payload.station === "string" ? payload.station : "");
      const url = payload.url || payload.qrUrl || payload.path || payload.value || station.url;
      return getPcStationIdentifier(url || identifier);
    } catch {
      return null;
    }
  }

  if (/^(?:https?:\/\/|\/|pc-station\/|scan\/pc\/)/i.test(text)) {
    try {
      const url = new URL(text, "http://comlab.local");
      const path = url.pathname;
      const opaqueMatch = path.match(/^\/pc-station\/(?:uid|s)\/([A-Za-z0-9_-]+)\/?$/i);
      if (opaqueMatch) return opaqueMatch[1];
      const stationMatch = path.match(/^\/pc-station\/([^/]+)\/?$/i);
      if (stationMatch) return decodeURIComponent(stationMatch[1]).slice(0, 255) || null;
      const scanMatch = path.match(/^\/scan\/pc\/([^/]+)\/?$/i);
      if (scanMatch) return decodeURIComponent(scanMatch[1]).slice(0, 255) || null;
      for (const key of stationQueryKeys) {
        const queryValue = url.searchParams.get(key);
        if (queryValue) return getPcStationIdentifier(queryValue);
      }
      return null;
    } catch {
      return null;
    }
  }

  return text.length <= 255 ? text : null;
};

export const getPcStationIdentifierFromRequest = (req) => {
  for (const key of stationQueryKeys) {
    const value = req.query?.[key] ?? req.body?.[key];
    if (value) return getPcStationIdentifier(value);
  }
  return null;
};
