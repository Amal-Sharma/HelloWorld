import { BookmarkPlus, Copy, Focus, Link, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Viewpoint } from '../lib/viewpoints'
import { catalog, objectById } from '../data/catalog'
import { missions } from '../data/missions'
import { atlasExperiences } from '../data/experiences'
import { physicalRadius } from '../lib/scienceTools'
import { observerPresets, upcomingEvents, validObserver } from '../lib/observer'
import type { ObserverSite, SkyEvent } from '../lib/observer'

export type ExplorationTab = 'views' | 'compare' | 'sky' | 'events' | 'missions' | 'atlas'

interface Props {
  tab: ExplorationTab
  onTabChange: (tab: ExplorationTab) => void
  views: Viewpoint[]
  shareUrl: string
  onCapture: (name: string, share: boolean) => void
  onRestore: (point: Viewpoint) => void
  onDelete: (index: number) => void
  onClose: () => void
  onNotice: (message: string) => void
  comparison: string[]
  onCompare: (ids: string[], show?: boolean) => void
  observer: ObserverSite
  timestamp: number
  onObserve: (site: ObserverSite, event?: SkyEvent) => void
  activeEvent: SkyEvent | null
  onEventTime: (timestamp: number) => void
  onMission: (id: string, timestamp: number, overview: boolean) => void
  onExplore: (id: string, view: 'map' | 'object' | 'orbit') => void
}

export default function ExplorationTools({
  tab,
  onTabChange,
  views,
  shareUrl,
  onCapture,
  onRestore,
  onDelete,
  onClose,
  onNotice,
  comparison,
  onCompare,
  observer,
  timestamp,
  onObserve,
  activeEvent,
  onEventTime,
  onMission,
  onExplore,
}: Props) {
  const [name, setName] = useState('')
  const [missionId, setMissionId] = useState('voyager-1')
  const mission = missions.find((item) => item.id === missionId)!
  const trajectory = objectById.get(missionId)!.trajectory!
  const [site, setSite] = useState(observer)
  const [events, setEvents] = useState<SkyEvent[]>([])
  const comparable = catalog.filter((object) => physicalRadius(object))
  return (
    <section className="exploration-tools" aria-label="Exploration tools">
      <div className="ruler-heading">
        <h2>Exploration tools</h2>
        <button
          className="icon-button"
          aria-label="Close exploration tools"
          title="Close exploration tools"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="tool-tabs" role="tablist" aria-label="Exploration tool">
        {(
          [
            ['views', 'Views'],
            ['compare', 'Scale'],
            ['sky', 'Sky'],
            ['events', 'Events'],
            ['missions', 'Missions'],
            ['atlas', 'Atlas'],
          ] as const
        ).map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === 'atlas' ? (
        <nav className="atlas-destinations" aria-label="Atlas destinations">
          {atlasExperiences.map((item) => (
            <button className="science-event" key={item.reference} onClick={() => onExplore(item.id, item.view)}>
              <strong>{item.name}</strong><Focus size={15} />
            </button>
          ))}
        </nav>
      ) : tab === 'missions' ? (
        <>
          <h3>Mission timeline</h3>
          <label className="tool-field">
            Spacecraft
            <select
              value={missionId}
              onChange={(event) => setMissionId(event.target.value)}
            >
              {missions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="tool-field">
            Mission date
            <input
              type="range"
              aria-label="Mission date"
              min={trajectory[0][0]}
              max={trajectory[trajectory.length - 1][0]}
              step={60000}
              value={Math.max(
                trajectory[0][0],
                Math.min(trajectory[trajectory.length - 1][0], timestamp),
              )}
              onChange={(event) =>
                onMission(missionId, Number(event.target.value), false)
              }
            />
          </label>
          <output>
            {new Date(
              Math.max(
                trajectory[0][0],
                Math.min(trajectory[trajectory.length - 1][0], timestamp),
              ),
            )
              .toISOString()
              .slice(0, 16)
              .replace('T', ' ')}{' '}
            UTC
          </output>
          {mission.events.map((event) => (
            <button
              className="science-event"
              key={event.name}
              onClick={() => onMission(missionId, Date.parse(event.date), true)}
            >
              <strong>{event.name}</strong>
              <span>{event.date.slice(0, 10)}</span>
            </button>
          ))}
          <p className="ruler-basis">
            JPL Horizons sampled trajectories. Flyby times are reference
            milestones; attitude is illustrative. Snapshot ends 2030-01-01.
            Heliopause dates are not minute-precision events.
          </p>
          <a
            className="source-link"
            href={mission.source}
            target="_blank"
            rel="noreferrer"
          >
            NASA mission source
          </a>
        </>
      ) : tab === 'sky' || tab === 'events' ? (
        <>
          <h3>{tab === 'sky' ? 'Sky from Earth' : 'Eclipses and transits'}</h3>
          <label className="tool-field">
            Location preset
            <select
              defaultValue=""
              onChange={(event) => {
                const chosen = observerPresets.find(
                  (item) => item.name === event.target.value,
                )
                if (chosen) setSite(chosen)
              }}
            >
              <option value="" disabled>
                Custom location
              </option>
              {observerPresets.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="tool-location">
            {(['latitude', 'longitude', 'elevation'] as const).map((field) => (
              <label className="tool-field" key={field}>
                {field === 'elevation'
                  ? 'Elevation (m)'
                  : field === 'latitude'
                    ? 'Latitude (deg)'
                    : 'Longitude (deg)'}
                <input
                  type="number"
                  value={Number.isFinite(site[field]) ? site[field] : ''}
                  min={
                    field === 'latitude'
                      ? -90
                      : field === 'longitude'
                        ? -180
                        : -500
                  }
                  max={
                    field === 'latitude'
                      ? 90
                      : field === 'longitude'
                        ? 180
                        : 10000
                  }
                  step="any"
                  onChange={(event) =>
                    setSite({ ...site, [field]: event.target.valueAsNumber })
                  }
                />
              </label>
            ))}
          </div>
          <label className="tool-checkbox">
            <input
              type="checkbox"
              checked={site.constellations}
              onChange={(event) =>
                setSite({ ...site, constellations: event.target.checked })
              }
            />
            Constellation names
          </label>
          <div className="tool-actions">
            {tab === 'sky' ? (
              <button
                disabled={!validObserver(site)}
                onClick={() => onObserve(site)}
              >
                <Focus size={16} /> Observe sky
              </button>
            ) : (
              <button
                disabled={!validObserver(site)}
                onClick={() =>
                  setEvents(upcomingEvents(new Date(timestamp), site))
                }
              >
                <Focus size={16} /> Find next events
              </button>
            )}
          </div>
          {tab === 'sky' ? (
            <p className="ruler-basis">
              Topocentric positions at simulation time; standard refraction.
              Constellation labels identify IAU sky regions. Stars omit proper
              motion and weather.
            </p>
          ) : (
            <>
              {activeEvent && (
                <>
                  <h3>{activeEvent.label}</h3>
                  <div className="tool-actions">
                    {(
                      [
                        ['Start', activeEvent.start],
                        ['Peak', activeEvent.peak],
                        ['End', activeEvent.finish],
                      ] as const
                    ).map(([label, time]) => (
                      <button key={label} onClick={() => onEventTime(time)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="ruler-basis">
                    Apparent disks use calculated angular radii. Lunar shadow
                    tint is illustrative; Earth shadow dimensions use ephemeris
                    geometry.
                  </p>
                </>
              )}
              {events.map((event) => (
                <button
                  className="science-event"
                  key={event.id}
                  onClick={() => onObserve(event.site, event)}
                >
                  <strong>{event.label}</strong>
                  <span>
                    {new Date(event.peak)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}{' '}
                    UTC
                  </span>
                  <small>
                    {event.altitude >= 0
                      ? 'Above horizon'
                      : 'Below horizon at peak'}{' '}
                    / {event.altitude.toFixed(1)} deg
                  </small>
                </button>
              ))}
              <p className="ruler-basis">
                Solar eclipses use this location; lunar and transit times are
                geocentric. Local horizon visibility is shown. Never look at the
                Sun without certified protection.
              </p>
            </>
          )}
        </>
      ) : tab === 'compare' ? (
        <>
          <h3>True-scale comparison</h3>
          {comparison.map((id, index) => (
            <label className="tool-field" key={index}>
              Body {index + 1}
              <select
                value={id}
                onChange={(event) =>
                  onCompare(
                    comparison.map((value, item) =>
                      item === index ? event.target.value : value,
                    ),
                  )
                }
              >
                {comparable.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="tool-actions">
            <button onClick={() => onCompare(comparison, true)}>
              <Focus size={16} /> Show comparison
            </button>
          </div>
          <dl className="tool-facts">
            {comparison.map((id, index) => {
              const object = comparable.find((item) => item.id === id)
              return object ? (
                <div key={index}>
                  <dt>{object.name}</dt>
                  <dd>
                    {physicalRadius(object)!.toLocaleString('en-US', {
                      maximumSignificantDigits: 5,
                    })}{' '}
                    km radius{object.blackHole ? ' (horizon)' : ''}
                  </dd>
                </div>
              ) : null
            })}
          </dl>
          <p className="ruler-basis">
            One linear physical scale. Lighting and spacing are illustrative;
            small bodies may be subpixel.
          </p>
        </>
      ) : (
        <>
          <h3>Viewpoints</h3>
          <label className="tool-field">
            Viewpoint name
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Current view"
            />
          </label>
          <div className="tool-actions">
            <button onClick={() => onCapture(name, false)}>
              <BookmarkPlus size={16} /> Save view
            </button>
            <button onClick={() => onCapture(name, true)}>
              <Link size={16} /> Share view
            </button>
          </div>
          {shareUrl && (
            <div className="tool-share">
              <label className="tool-field">
                Share link
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                className="icon-button"
                title="Copy view link"
                aria-label="Copy view link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl)
                    onNotice('View link copied')
                  } catch {
                    onNotice(
                      'Clipboard unavailable. Select the link to copy it.',
                    )
                  }
                }}
              >
                <Copy size={17} />
              </button>
            </div>
          )}
          <div className="saved-viewpoints">
            {!views.length && (
              <p className="ruler-basis">No saved viewpoints</p>
            )}
            {views.map((point, index) => (
              <div key={`${index}-${point.name}`} className="saved-viewpoint">
                <button
                  className="saved-viewpoint-name"
                  onClick={() => onRestore(point)}
                  aria-label={`Restore ${point.name}`}
                >
                  <Focus size={15} />
                  <span>
                    {point.name}
                    <small>
                      {new Date(point.timestamp).toISOString().slice(0, 10)} /{' '}
                      {point.view}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  title={`Delete ${point.name}`}
                  aria-label={`Delete ${point.name}`}
                  onClick={() => onDelete(index)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
