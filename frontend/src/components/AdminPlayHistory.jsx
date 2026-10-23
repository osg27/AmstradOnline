import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import './adminPlayHistory.css';

const duration = (seconds) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : seconds >= 60 ? `${Math.floor(seconds / 60)}m` : `${seconds}s`;
const date = (value) => new Date(value).toLocaleString();
const systems = ['cpc', 'cpc_party', 'spectrum', 'c64', 'msx', 'amiga', 'amiga_aga', 'atarist', 'nes', 'snes', 'mastersystem', 'megadrive', 'pcengine', 'arcade'];

function SessionRows({ rows, onRoom }) {
  return <div className="admin-table-wrap"><table className="admin-table history-table">
    <thead><tr><th>Game / room</th><th>Player</th><th>Started</th><th>Session time</th><th>Connection</th><th>Status</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>
      <td><strong>{row.game || 'Waiting for a game'}</strong><small>{row.system.toUpperCase()} · {row.mode} · <button className="history-link" onClick={() => onRoom(row.room_code)}>{row.room_code} ↗</button></small></td>
      <td>{row.username}<small>{row.is_host ? 'Host' : `Guest · host ${row.host_name}`}</small></td>
      <td>{date(row.started_at)}</td><td>{duration(row.duration_seconds)}</td>
      <td><span className={`history-badge ${row.ever_connected ? 'success' : ''}`}>{row.ever_connected ? 'Peer connected' : 'No peer reported'}</span>{row.ever_connected && <small>{duration(row.connected_seconds)} observed</small>}</td>
      <td><span className={`history-badge ${!row.ended_at ? 'live' : ''}`}>{row.ended_at ? 'Ended' : 'Live'}</span>{row.ended_at && <small>{date(row.ended_at)}<br />{row.end_reason?.replaceAll('_', ' ')}</small>}</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function AdminPlayHistory() {
  const [filters, setFilters] = useState({ days: '7', search: '', system: '', mode: '', connected: '' });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [room, setRoom] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const [detailError, setDetailError] = useState('');
  const detailRef = useRef(null);
  useEffect(() => { if (room) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [room]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ offset, limit: 25 });
    for (const key of ['search', 'system', 'mode', 'connected']) if (applied[key]) params.set(key, applied[key]);
    params.set('since', new Date(Date.now() - Number(applied.days) * 86400000).toISOString());
    setBusy(true); setError('');
    apiFetch(`/auth/admin/play-history?${params}`).then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [applied, offset, revision]);
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    setDetail(null); setDetailError('');
    apiFetch(`/auth/admin/play-history?room_code=${encodeURIComponent(room)}&offset=${detailOffset}&limit=25`)
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((err) => { if (!cancelled) setDetailError(err.message); });
    return () => { cancelled = true; };
  }, [room, detailOffset, revision]);
  function openRoom(code) { setRoom(code); setDetailOffset(0); }
  const update = (key) => (event) => setFilters({ ...filters, [key]: event.target.value });
  const maxDaily = Math.max(1, ...(data?.daily || []).map((day) => day.seconds));
  const maxSystem = Math.max(1, ...(data?.systems || []).map((item) => item.seconds));
  return <section className="play-history" aria-label="Gameplay analytics">
    <header className="history-heading"><div><span className="history-eyebrow">ROOM INSIGHTS</span><h2>Behind the gameplay</h2><p>See what people play, who hosts, and when multiplayer connects.</p></div><button className="secondary" disabled={busy} onClick={() => setRevision((value) => value + 1)}>{busy ? 'Updating…' : '↻ Refresh'}</button></header>
    <form className="history-filters" onSubmit={(event) => { event.preventDefault(); setOffset(0); setApplied({ ...filters }); }}>
      <label>Period<select value={filters.days} onChange={update('days')}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
      <label className="history-search">Find activity<input value={filters.search} onChange={update('search')} placeholder="Game, player, host or room code" maxLength={120} /></label>
      <label>System<select value={filters.system} onChange={update('system')}><option value="">All systems</option>{systems.map((system) => <option key={system} value={system}>{system.toUpperCase()}</option>)}</select></label>
      <label>Room type<select value={filters.mode} onChange={update('mode')}><option value="">All rooms</option><option value="solo">Solo</option><option value="multiplayer">Multiplayer</option></select></label>
      <label>Connection<select value={filters.connected} onChange={update('connected')}><option value="">Any outcome</option><option value="true">Peer connected</option><option value="false">No peer reported</option></select></label>
      <button type="submit" disabled={busy}>Apply</button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {data && <>
      <div className="history-metrics">{[
        ['Rooms hosted', data.summary.rooms, 'Distinct rooms in this view'],
        ['Players', data.summary.players, 'Hosts and guests'],
        ['Game-session time', duration(data.summary.game_seconds), 'Host time · not summed player time'],
        ['Connected rooms', data.summary.connected_rooms, 'Host reported a peer connection'],
      ].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
      <div className="history-charts">
        <article className="history-chart"><h3>Playing over time</h3><p>Host game-session time · UTC · latest 31 active days</p>
          {data.daily.length ? <div className="history-bars" role="img" aria-label={data.daily.map((day) => `${day.day}: ${duration(day.seconds)}`).join(', ')}>{data.daily.map((day) => <div key={day.day} title={`${day.day}: ${duration(day.seconds)}`}><span style={{ height: `${Math.max(2, day.seconds / maxDaily * 100)}%` }} /><small>{day.day.slice(5)}</small></div>)}</div> : <div className="history-empty">Activity will appear here after the first game session.</div>}
        </article>
        <article className="history-chart"><h3>Most-played systems</h3><p>Ranked by host game-session time</p><div className="history-ranking">{data.systems.map((item) => <button key={item.system} onClick={() => { setFilters({ ...filters, system: item.system }); setApplied({ ...applied, system: item.system }); setOffset(0); }}><span>{item.system.toUpperCase()}<strong>{duration(item.seconds)}</strong></span><i style={{ width: `${Math.max(1, item.seconds / maxSystem * 100)}%` }} /></button>)}{!data.systems.length && <p>No games recorded in this period.</p>}</div></article>
      </div>
      <div className="history-list"><div className="history-heading"><div><h3>Session history</h3><p>{data.total.toLocaleString()} player sessions · select a room to inspect its timeline</p></div></div>
        {data.sessions.length ? <SessionRows rows={data.sessions} onRoom={openRoom} /> : <div className="history-empty">No sessions match these filters. History starts after this update is deployed.</div>}
        <nav className="history-pagination" aria-label="Session pages"><button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>{data.total ? `${offset + 1}–${Math.min(offset + 25, data.total)} of ${data.total}` : '0 sessions'}</span><button disabled={busy || offset + 25 >= data.total} onClick={() => setOffset(offset + 25)}>Next</button></nav>
      </div>
    </>}
    {room && <section ref={detailRef} className="history-detail" aria-label={`Room ${room} timeline`}>
      <div className="history-heading"><div><span className="history-eyebrow">ROOM TIMELINE</span><h3>{room}</h3><p>All recorded players and game changes · newest first</p></div><button className="secondary" onClick={() => setRoom('')}>Close</button></div>
      {detailError ? <p className="error" role="alert">{detailError}</p> : !detail ? <p>Loading room timeline…</p> : <><SessionRows rows={detail.sessions} onRoom={openRoom} /><nav className="history-pagination"><button disabled={!detailOffset} onClick={() => setDetailOffset(detailOffset - 25)}>Previous</button><span>{detail.total} records</span><button disabled={detailOffset + 25 >= detail.total} onClick={() => setDetailOffset(detailOffset + 25)}>Next</button></nav></>}
    </section>}
    <p className="history-note">Session time measures room attendance while a game is loaded, not active input. Peer connections are browser-reported, not proof of a working stream. Updates are sampled every 15 seconds; a missing heartbeat ends a session at its last observation after 60 seconds. No chat, voice or gameplay footage is stored.</p>
  </section>;
}
