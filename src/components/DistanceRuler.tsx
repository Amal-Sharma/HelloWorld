import { useEffect, useId, useState } from 'react'
import { ArrowLeftRight, Eraser, Focus, X } from 'lucide-react'
import { objectById, searchCatalog } from '../data/catalog'
import { formatLightTime, formatRulerDistance } from '../lib/mapCoordinates'
import type { DistanceMeasurement } from '../lib/mapCoordinates'

function Endpoint({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (id: string) => void
}) {
  const listId = useId()
  const [query, setQuery] = useState(objectById.get(value)?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    setQuery(objectById.get(value)?.name ?? '')
  }, [value])
  const matches = searchCatalog(query, 'all', 8).slice(0, 8)
  const choose = (id: string) => {
    onChange(id)
    setQuery(objectById.get(id)?.name ?? '')
    setOpen(false)
  }
  return (
    <div
      className="ruler-endpoint"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
          setQuery(objectById.get(value)?.name ?? '')
        }
      }}
    >
      <label>
        <span>{label}</span>
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && matches[active] ? `${listId}-${active}` : undefined
          }
          value={query}
          placeholder="Search objects"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
              setQuery(objectById.get(value)?.name ?? '')
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActive((current) =>
                Math.max(
                  0,
                  Math.min(
                    matches.length - 1,
                    current + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              )
            }
            if (event.key === 'Enter' && open && matches[active]) {
              event.preventDefault()
              choose(matches[active].id)
            }
          }}
        />
      </label>
      {open && (
        <div
          className="ruler-matches"
          id={listId}
          role="listbox"
          aria-label={`${label} objects`}
        >
          {matches.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              id={`${listId}-${index}`}
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item.id)}
            >
              <span>{item.name}</span>
              <small>{item.classification}</small>
            </button>
          ))}
          {!matches.length && <div className="ruler-empty">No matches</div>}
        </div>
      )}
    </div>
  )
}

interface Props {
  endpoints: [string, string]
  measurement: DistanceMeasurement | null
  onChange: (endpoints: [string, string]) => void
  onFrame: () => void
  onClose: () => void
}

export default function DistanceRuler({
  endpoints,
  measurement,
  onChange,
  onFrame,
  onClose,
}: Props) {
  const current =
    measurement?.fromId === endpoints[0] && measurement?.toId === endpoints[1]
      ? measurement
      : null
  const ready =
    current?.distancePc !== null && current?.distancePc !== undefined
  const hostCoordinates = endpoints.some(
    (id) => objectById.get(id)?.kind === 'exoplanet',
  )
  return (
    <section className="distance-ruler" aria-label="Distance ruler">
      <div className="ruler-heading">
        <h2>Distance ruler</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close distance ruler"
          title="Close distance ruler"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <Endpoint
        label="From"
        value={endpoints[0]}
        onChange={(id) => onChange([id, endpoints[1]])}
      />
      <Endpoint
        label="To"
        value={endpoints[1]}
        onChange={(id) => onChange([endpoints[0], id])}
      />
      <div className="ruler-actions">
        <button
          type="button"
          className="icon-button"
          title="Swap endpoints"
          aria-label="Swap endpoints"
          onClick={() => onChange([endpoints[1], endpoints[0]])}
        >
          <ArrowLeftRight size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Frame measurement"
          aria-label="Frame measurement"
          disabled={!ready}
          onClick={onFrame}
        >
          <Focus size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Clear measurement"
          aria-label="Clear measurement"
          onClick={() => onChange(['', ''])}
        >
          <Eraser size={17} />
        </button>
      </div>
      <dl
        className="ruler-result"
        data-distance-pc={ready ? current!.distancePc : undefined}
        data-light-seconds={ready ? current!.lightSeconds : undefined}
      >
        <div>
          <dt>Center-to-center</dt>
          <dd>
            <output aria-label="Measured distance">
              {ready
                ? `${current!.basis === 'calculated' ? '' : '~'}${formatRulerDistance(current!.distancePc!)}`
                : 'Unavailable'}
            </output>
          </dd>
        </div>
        <div>
          <dt>One-way light time</dt>
          <dd>
            <output aria-label="Light travel time">
              {ready ? formatLightTime(current!.lightSeconds!) : 'Unavailable'}
            </output>
          </dd>
        </div>
      </dl>
      <p className="ruler-basis">
        {!endpoints[0] || !endpoints[1]
          ? 'No endpoints'
          : (current?.unavailable ??
            (ready
              ? current!.basis === 'calculated'
                ? 'Calculated positions at simulation time.'
                : current!.basis === 'catalog'
                  ? 'Approximate catalog positions. Distance / c in static space.'
                  : 'Approximate map distance. Light time ignores cosmic expansion; not a lookback time.'
              : 'Resolving positions...'))}
      </p>
      {ready && hostCoordinates && (
        <p className="ruler-basis">
          Exoplanet endpoints use host-star coordinates, not planetary orbital
          positions.
        </p>
      )}
    </section>
  )
}
