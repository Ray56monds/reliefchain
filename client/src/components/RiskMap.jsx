import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import VulnerabilityBadge from './VulnerabilityBadge';
import PaymentStatus from './PaymentStatus';
import { NEIGHBOURHOODS, KAMPALA_CENTER, PRIORITY_STYLES, jitter, timeAgo } from '../lib/constants';

/**
 * Kampala relief map: shaded flood-risk zones + one pin per report, coloured by AI priority
 * (red = CRITICAL, amber = HIGH, green = MEDIUM/LOW).
 */
export default function RiskMap({ reports = [], height = 480, onSelect }) {
  const byHood = Object.fromEntries(NEIGHBOURHOODS.map((n) => [n.name, n]));

  return (
    <MapContainer center={KAMPALA_CENTER} zoom={13} scrollWheelZoom={false} style={{ height, width: '100%' }} className="rounded-2xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {NEIGHBOURHOODS.map((n) => {
        const count = reports.filter((r) => r.neighbourhood === n.name).length;
        const high = n.risk === 'HIGH';
        return (
          <Circle
            key={n.name}
            center={[n.lat, n.lon]}
            radius={high ? 900 : 700}
            pathOptions={{ color: high ? '#dc2626' : '#d97706', weight: 1, fillOpacity: high ? 0.1 : 0.06, dashArray: '4 4' }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <strong>{n.name}</strong> — {n.risk} flood risk · {count} report{count === 1 ? '' : 's'}
            </Tooltip>
          </Circle>
        );
      })}

      {reports.map((r) => {
        const hood = byHood[r.neighbourhood];
        if (!hood) return null;
        const priority = r.priority || r.ai?.priority;
        const score = r.score ?? r.ai?.vulnerability_score;
        const color = priority === 'LOW' ? PRIORITY_STYLES.MEDIUM.color : (PRIORITY_STYLES[priority] || PRIORITY_STYLES.LOW).color;
        return (
          <CircleMarker
            key={r.id}
            center={jitter(r.id, hood.lat, hood.lon)}
            radius={priority === 'CRITICAL' ? 9 : 7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }}
            eventHandlers={onSelect ? { click: () => onSelect(r) } : undefined}
          >
            <Popup>
              <div className="space-y-1.5 text-sm">
                <div className="font-semibold">{r.neighbourhood}</div>
                <VulnerabilityBadge priority={priority} score={score} />
                <div>
                  <PaymentStatus status={r.status} />
                </div>
                <div className="text-xs text-slate-500">
                  Household of {r.householdSize} · {timeAgo(r.createdAt)}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

export function MapLegend() {
  const items = [
    ['Critical', PRIORITY_STYLES.CRITICAL.color],
    ['High', PRIORITY_STYLES.HIGH.color],
    ['Medium / Low', PRIORITY_STYLES.MEDIUM.color],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: color }} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full border border-dashed border-red-500 bg-red-500/10" />
        High flood-risk zone
      </span>
    </div>
  );
}
