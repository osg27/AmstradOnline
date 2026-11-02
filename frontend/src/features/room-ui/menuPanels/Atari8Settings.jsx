import React from 'react';

/** Atari 8-bit machine settings (moved unchanged from RoomPage). */
export default function Atari8Settings({ atari8Config, updateAtari8Config, atari8RamOptions, modelOptions, osOptions }) {
  return (
    <div className="room-system-switch atari8-machine-switch">
      <label>
        <span>Atari model</span>
        <select
          value={atari8Config.model}
          onChange={(event) => updateAtari8Config({ model: event.target.value })}
        >
          {modelOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>RAM</span>
        <select
          value={String(atari8Config.memory)}
          onChange={(event) => updateAtari8Config({ memory: Number(event.target.value) })}
        >
          {atari8RamOptions.map((memory) => (
            <option key={memory} value={memory}>{memory}K</option>
          ))}
        </select>
      </label>
      <label>
        <span>BASIC</span>
        <select
          value={atari8Config.basicDisabled ? 'off' : 'on'}
          onChange={(event) => updateAtari8Config({ basicDisabled: event.target.value === 'off' })}
        >
          <option value="off">Off</option>
          <option value="on">On</option>
        </select>
      </label>
      <label>
        <span>TV</span>
        <select
          value={atari8Config.tv}
          onChange={(event) => updateAtari8Config({ tv: event.target.value })}
        >
          <option value="ntsc">NTSC</option>
          <option value="pal">PAL</option>
        </select>
      </label>
      <label>
        <span>OS</span>
        <select
          value={atari8Config.os}
          onChange={(event) => updateAtari8Config({ os: event.target.value })}
        >
          {osOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {atari8Config.memory > 64 ? (
        <label className="inline-toggle" title="Separate ANTIC access is only needed by some memory upgrades; leave off if a game corrupts after loading.">
          <span>ANTIC</span>
          <input
            type="checkbox"
            checked={atari8Config.separateAnticAccess}
            onChange={(event) => updateAtari8Config({ separateAnticAccess: event.target.checked })}
          />
        </label>
      ) : null}
    </div>
  );
}
