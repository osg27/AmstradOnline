import React from 'react';
import Icon from './icons';

const AVATAR_TONES = [
  'linear-gradient(140deg,#6c4dff,#2f86e0)',
  'linear-gradient(140deg,#ff7a45,#ea3a30)',
  'linear-gradient(140deg,#3fdc8a,#1f8f6a)',
  'linear-gradient(140deg,#ffc82e,#e0841f)',
];

export function PlayerAvatar({ name, label, index = 0, connected = true }) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={`osg-pl ${connected ? '' : 'waiting'}`} style={{ background: AVATAR_TONES[index % AVATAR_TONES.length] }} title={name}>
      {initial}
      {label ? <small>{label}</small> : null}
    </span>
  );
}

/**
 * Thin top bar: back/leave, game title + cover + system chip, solo/online status,
 * player avatars, mic/chat/invite (online), and the Menu button.
 */
export default function RoomTopBar({
  backLabel,
  onBack,
  title,
  cover,
  systemLabel,
  systemColor,
  online,
  statusChip,
  roomCodeChip,
  players,
  mic,
  chat,
  invite,
  onOpenMenu,
  menuShortcut,
}) {
  return (
    <header className="osg-top">
      <button className="osg-back" type="button" onClick={onBack}>
        <Icon name="back" />
        <span>{backLabel}</span>
      </button>
      <div className="osg-title">
        {cover ? <img src={cover} alt="" /> : null}
        <b title={title}>{title}</b>
        {title !== systemLabel ? (
          <span className="osg-chip" style={{ '--osg-sys': systemColor }}><i className="osg-dot" />{systemLabel}</span>
        ) : null}
      </div>
      {online && roomCodeChip ? (
        <button type="button" className="osg-chip live osg-hide-ph osg-code-chip" onClick={roomCodeChip.onClick} title="Copy room code">
          <i className="osg-dot" />{roomCodeChip.label}
        </button>
      ) : statusChip ? (
        <span className="osg-chip osg-hide-ph">{statusChip}</span>
      ) : null}
      {online && players?.length ? (
        <div className="osg-players" title={`${players.length} player${players.length === 1 ? '' : 's'}`}>
          {players.slice(0, 5).map((player, index) => (
            <PlayerAvatar key={`${player.label}-${player.name}`} name={player.name} label={player.label} index={index} connected={player.connected} />
          ))}
          {players.length > 5 ? <span className="osg-pl more">+{players.length - 5}</span> : null}
        </div>
      ) : null}
      <div className="osg-top-right">
        {mic ? (
          <button
            className={`osg-tbtn icon osg-hide-ph ${mic.on ? 'on' : ''}`}
            type="button"
            onClick={mic.onClick}
            aria-label={mic.label}
            title={mic.label}
          >
            <Icon name={mic.on ? 'mic' : 'micOff'} />
          </button>
        ) : null}
        {chat ? (
          <button className="osg-tbtn osg-hide-ph" type="button" onClick={chat.onClick} aria-label={`Room chat${chat.unread ? `, ${chat.unread} unread` : ''}`}>
            <Icon name="chat" />
            {chat.unread ? <span className="osg-badge">{chat.unread}</span> : null}
          </button>
        ) : null}
        {invite ? (
          <button className="osg-tbtn osg-hide-ph" type="button" onClick={invite.onClick} disabled={invite.disabled}>
            <Icon name={invite.icon || 'link'} />
            {invite.label}
          </button>
        ) : null}
        <button className="osg-tbtn osg-menu-btn" type="button" onClick={onOpenMenu} aria-label="Open game menu">
          <Icon name="menu" />
          <span className="osg-lbl">Menu</span>
          {menuShortcut}
        </button>
      </div>
    </header>
  );
}
