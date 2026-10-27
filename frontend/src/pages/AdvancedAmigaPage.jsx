import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { zipSync } from 'fflate';
import { apiFetch, API_BASE_URL } from '../api/client';
import { validateMediaSize, uploadPrivateMedia, SESSION_MEDIA_BYTES } from '../features/amiga/privateMediaUpload';

const API = '/auth/admin/amiga';
const presets = {
  A500: { cpu: 68000, chipset: 'ocs', chip: 0.5, slow: 0.5, fast: 0 },
  A600: { cpu: 68000, chipset: 'ecs', chip: 2, slow: 0, fast: 0 },
  A1200: { cpu: 68020, chipset: 'aga', chip: 2, slow: 0, fast: 8 },
  A4000: { cpu: 68040, chipset: 'aga', chip: 2, slow: 0, fast: 8 },
};
const initial = { name: 'Amiga 1200 - Workbench', model: 'A1200', ...presets.A1200,
  ntsc: false, compatible: false, kickstart: null, floppies: [], drives: [], default: false };
const uuid = () => crypto.randomUUID().replaceAll('-', '');

async function binary(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${API}${path}`, {
    ...options, cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Private media request failed (${response.status})`);
  }
  return response;
}

export default function AdvancedAmigaPage() {
  const [catalogue, setCatalogue] = useState(null);
  const [profile, setProfile] = useState(initial);
  const [id, setId] = useState(uuid);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [player, setPlayer] = useState(false);
  const [folders, setFolders] = useState(null);
  const frame = useRef(null);
  const upload = useRef(null);
  const folderInput = useRef(null);
  const uploadKind = useRef('hdf');
  const launchData = useRef(null);
  const change = (key, value) => setProfile(p => ({ ...p, [key]: value }));
  const refresh = async () => {
    const data = await apiFetch(API);
    setCatalogue(data);
    return data;
  };
  useEffect(() => {
    refresh().then(data => {
      const saved = data.profiles.find(p => p.default);
      if (saved) { const { id: key, ...value } = saved; setId(key); setProfile(value); }
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    const warn = event => { if (player) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [player]);
  async function action(fn) {
    setBusy(true); setError(''); setStatus('');
    try { await fn(); } catch (e) { setStatus(''); setError(e.message); } finally { setBusy(false); }
  }
  async function save(key = id) {
    await apiFetch(`${API}/profiles/${key}`, { method: 'PUT', body: JSON.stringify(profile) });
    setId(key); await refresh(); setStatus('Profile saved. Source media are stored privately; guest disk writes are disabled.');
  }
  async function importImage(file, kind, name = file.name) {
    validateMediaSize(file, kind);
    const progress = percent => setStatus(`Uploading ${name} (${(file.size / 1024 / 1024).toFixed(1)} MiB): ${percent}%${percent === 100 ? ' - waiting for server confirmation...' : ''}`);
    progress(0);
    const asset = await uploadPrivateMedia({
      url: `${API_BASE_URL}${API}/assets?kind=${kind}&name=${encodeURIComponent(name)}`,
      token: localStorage.getItem('token'), file, onProgress: progress,
    });
    // Attach the confirmed upload immediately; a failed catalogue refresh must not hide it.
    setCatalogue(current => ({ ...current, assets: [...current.assets, asset] }));
    setProfile(current => {
      if (kind === 'rom') return { ...current, kickstart: asset.id };
      if (kind === 'adf') return { ...current, floppies: [...current.floppies, asset.id].slice(0, 4) };
      return { ...current, drives: [...current.drives, { asset: asset.id, label: kind === 'hdf' ? 'Workbench' : 'Games', priority: current.drives.length ? -128 : 0, mode: 'ro', geometry: 'rdb', sectors: 32, surfaces: 1, reserved: 2, block_size: 512 }] };
    });
    setStatus(`${name} imported${kind === 'hdf' || kind === 'folder' ? ' and added to the drive list below' : ''}. Save the profile to keep this selection.`);
  }
  async function importFolder(files) {
    if (files.length > 4096 || files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024) throw new Error('Folder exceeds 4096 files or 128 MiB');
    const entries = {};
    const names = new Set();
    for (const file of files) {
      const path = file.webkitRelativePath.split('/').slice(1).join('/');
      if (!path || path.split('/').some(p => !p || p === '..' || p === '.' || /[\\:"\x00-\x1f]/.test(p))) throw new Error('Invalid Amiga filename');
      if (names.has(path.toLowerCase())) throw new Error('Filenames collide ignoring case');
      names.add(path.toLowerCase()); entries[path] = new Uint8Array(await file.arrayBuffer());
    }
    const bytes = zipSync(entries, { level: 0 });
    await importImage(new Blob([bytes]), 'folder', files[0].webkitRelativePath.split('/')[0]);
  }
  async function start() {
    if (!profile.floppies.length && !profile.drives.some(d => d.priority > -128)) {
      throw new Error('No boot media selected. Import your Workbench HDF and select its DH device as the boot drive. Kickstart alone shows the insert-disk screen.');
    }
    await save();
    const launch = await apiFetch(`${API}/profiles/${id}/launch`, { method: 'POST' });
    const files = [];
    let total = 0;
    for (const [key, asset] of Object.entries(launch.assets)) {
      const items = asset.type === 'folder' ? asset.files : [{ path: null, size: asset.size }];
      for (const entry of items) {
        total += entry.size;
        if (total > SESSION_MEDIA_BYTES + 8 * 1024 * 1024) throw new Error('Mounted media exceed the 1152 MiB session budget');
        setStatus(`Loading ${asset.name} for the emulator (${(total / 1024 / 1024).toFixed(1)} MiB)...`);
        const response = await binary(`/assets/${key}/content${entry.path ? `?path=${encodeURIComponent(entry.path)}` : ''}`);
        files.push({ path: asset.type === 'folder' ? `/advanced/${key}/${entry.path}` : asset.type === 'rom' ? '/advanced/kick.rom' : `/advanced/${key}.${asset.type}`, bytes: await response.arrayBuffer() });
      }
    }
    launchData.current = { uae: launch.uae, files }; setPlayer(true); setStatus('Loading the PUAE runtime...');
  }
  const assetName = key => catalogue?.assets.find(a => a.id === key)?.name || 'Missing source';
  const driveChange = (index, key, value) => change('drives', profile.drives.map((d, i) => i === index ? { ...d, [key]: value } : d));
  if (!catalogue) return <div className="page"><div className="card"><Link to="/admin">Admin</Link><p>{error || 'Checking administrator access...'}</p></div></div>;
  return <div className="page admin-page"><div className="card admin-card">
    <div className="lobby-header"><h1>Advanced Amiga</h1><Link to="/admin">Admin dashboard</Link></div>
    <p>Experimental administrator environment. Hardware changes require restarting the player.</p>
    <p className="error">{catalogue.capabilities.reason} Workbench installation and blank-drive creation are unavailable in this build.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <p role="status">{status}</p>
    <fieldset disabled={busy || player} style={{ display: 'grid', gap: 12 }}>
      <legend>Saved profiles and hardware</legend>
      <select aria-label="Load profile" value={catalogue.profiles.some(p => p.id === id) ? id : ''} onChange={e => {
        const selected = catalogue.profiles.find(p => p.id === e.target.value);
        if (selected) { const { id: key, ...data } = selected; setId(key); setProfile(data); }
      }}><option value="">Unsaved profile</option>{catalogue.profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.default ? ' (default)' : ''}</option>)}</select>
      <label>Name <input value={profile.name} maxLength={80} onChange={e => change('name', e.target.value)} /></label>
      <label>Model <select value={profile.model} onChange={e => setProfile(p => ({ ...p, model: e.target.value, ...(presets[e.target.value] || {}) }))}>{['A500', 'A600', 'A1200', 'A4000', 'Custom'].map(x => <option key={x}>{x}</option>)}</select></label>
      {[['cpu', 'CPU', [68000, 68010, 68020, 68030, 68040]], ['chipset', 'Chipset', ['ocs', 'ecs', 'aga']], ['chip', 'Chip RAM (MB)', [0.5, 1, 2]], ['slow', 'Slow RAM (MB)', [0, 0.5, 1, 1.5]], ['fast', 'Fast RAM (MB)', [0, 2, 4, 8, 16, 32]]].map(([key, label, options]) =>
        <label key={key}>{label} <select value={profile[key]} onChange={e => change(key, key === 'chipset' ? e.target.value : Number(e.target.value))}>{options.map(x => <option key={x} value={x} disabled={(key === 'fast' && x > 8 && profile.cpu < 68020) || (key === 'slow' && x > 0 && profile.cpu >= 68020) || (key === 'chip' && x > 1 && profile.chipset === 'ocs')}>{x}</option>)}</select></label>)}
      <label><input type="checkbox" checked={profile.ntsc} onChange={e => change('ntsc', e.target.checked)} /> NTSC (otherwise PAL)</label>
      <label><input type="checkbox" checked={profile.compatible} onChange={e => change('compatible', e.target.checked)} /> CPU compatibility</label>
      <label><input type="checkbox" checked={profile.default} onChange={e => change('default', e.target.checked)} /> Default administrator profile</label>
      <label>Kickstart <select value={profile.kickstart || ''} onChange={e => change('kickstart', e.target.value || null)}><option value="">Select compatible administrator ROM</option>{catalogue.assets.filter(a => a.type === 'rom').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <div>{['rom', 'adf', 'hdf'].map(kind => <button key={kind} onClick={() => { uploadKind.current = kind; upload.current.click(); }}>Import {kind === 'rom' ? 'Kickstart' : kind.toUpperCase()}</button>)}</div>
      <p>HDF limit: 1 GiB per image. Folder and other media imports: 128 MiB. Stop Amiga before importing.</p>
      <div aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : <p role="status">{status}</p>}</div>
      <input hidden ref={upload} type="file" onChange={e => { const file = e.target.files[0]; if (file) action(() => importImage(file, uploadKind.current)); e.target.value = ''; }} />
      <div>{profile.floppies.map((key, i) => <p key={`${key}-${i}`}>DF{i}: {assetName(key)} <button onClick={() => change('floppies', profile.floppies.filter((_, j) => j !== i))}>Eject on restart</button></p>)}</div>
      <h2>Mounted drive configuration</h2>
      <p>Sources are private imported copies. Local folders are uploaded to this server with their hierarchy; no live synchronisation. Drive attachment remains unverified until checked inside Workbench.</p>
      <table><thead><tr><th>Device</th><th>Source</th><th>Mode / boot priority</th><th>Actions</th></tr></thead><tbody>{profile.drives.map((drive, i) => <tr key={`${drive.asset}-${i}`}>
        <td>DH{i}</td><td>{assetName(drive.asset)}<br />{catalogue.assets.find(a => a.id === drive.asset)?.source || 'Persistent private HDF'}
        {catalogue.assets.find(a => a.id === drive.asset)?.type === 'hdf' && <div><select aria-label={`DH${i} geometry`} value={drive.geometry} onChange={e => driveChange(i, 'geometry', e.target.value)}><option value="rdb">RDB (image geometry)</option><option value="manual">Non-RDB (manual geometry)</option></select>
          {drive.geometry === 'manual' && ['sectors', 'surfaces', 'reserved', 'block_size'].map(key => <label key={key}>{key} <input type="number" value={drive[key]} onChange={e => driveChange(i, key, Number(e.target.value))} /></label>)}</div>}</td>
        <td>Read only <input aria-label={`DH${i} boot priority`} type="number" min="-128" max="127" value={drive.priority} onChange={e => driveChange(i, 'priority', Number(e.target.value))} /></td>
        <td><button disabled={i === 0} onClick={() => { const drives = [...profile.drives]; [drives[i - 1], drives[i]] = [drives[i], drives[i - 1]]; change('drives', drives); }}>Move up</button><button onClick={() => change('drives', profile.drives.filter((_, j) => i !== j))}>Remove</button></td>
      </tr>)}</tbody></table>
      <label>Add existing private drive <select value="" onChange={e => { if (e.target.value) change('drives', [...profile.drives, { asset: e.target.value, label: 'Games', priority: -128, mode: 'ro', geometry: 'rdb', sectors: 32, surfaces: 1, reserved: 2, block_size: 512 }]); }}><option value="">Select source</option>{catalogue.assets.filter(a => ['hdf', 'folder'].includes(a.type)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Boot drive <select value={profile.drives.findIndex(d => d.priority > -128)} onChange={e => change('drives', profile.drives.map((d, i) => ({ ...d, priority: i === Number(e.target.value) ? 0 : -128 })))}><option value={-1}>Floppy only</option>{profile.drives.map((_, i) => <option key={i} value={i}>DH{i}</option>)}</select></label>
      <div><button onClick={() => folderInput.current.click()}>Mount Local Folder</button><button onClick={() => action(async () => setFolders((await apiFetch(`${API}/library`)).folders))}>Mount Server Folder</button><button disabled title="Requires a verified writable-drive flush bridge">Create Hard Drive (unavailable)</button></div>
      <input hidden ref={folderInput} type="file" webkitdirectory="" multiple onChange={e => { const files = [...e.target.files]; if (files.length) action(() => importFolder(files)); e.target.value = ''; }} />
      {folders && <div>{folders.length ? folders.map(name => <button key={name} onClick={() => action(async () => { const asset = await apiFetch(`${API}/library/import`, { method: 'POST', body: JSON.stringify({ folder: name }) }); await refresh(); change('drives', [...profile.drives, { asset: asset.id, label: 'Games', priority: -128, mode: 'ro', geometry: 'rdb', sectors: 32, surfaces: 1, reserved: 2, block_size: 512 }]); setFolders(null); })}>{name}</button>) : 'No approved folders. Place installed-game directories in the private advanced-amiga/library storage folder.'}</div>}
      <div><button onClick={() => { setId(uuid()); setProfile(initial); }}>New profile</button><button onClick={() => action(() => save())}>Save Drive Configuration / Profile</button><button onClick={() => action(() => save(uuid()))}>Duplicate profile</button><button onClick={() => action(async () => { await apiFetch(`${API}/profiles/${id}`, { method: 'DELETE' }); setId(uuid()); setProfile(initial); await refresh(); })}>Delete profile</button><button onClick={() => action(start)}>Start Workbench</button></div>
    </fieldset>
    {player && <><button onClick={() => { setPlayer(false); launchData.current = null; setStatus('Stopped. Read-only source drives are unchanged.'); }}>Stop Amiga</button><button onClick={() => frame.current?.requestFullscreen()}>Fullscreen</button>
      <iframe ref={frame} title="Advanced Amiga player" src="/amiga-aga/launcher.html" allow="autoplay; fullscreen; gamepad" style={{ width: '100%', height: '70vh', border: 0 }} onLoad={() => action(async () => {
        await frame.current.contentWindow.startAdvancedAmiga(launchData.current);
        launchData.current = null; setStatus('PUAE started. Confirm Workbench boot and mounted volumes inside the guest; they have not been verified automatically.');
      })} /></>}
  </div></div>;
}
