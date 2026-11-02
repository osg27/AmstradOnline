import React from 'react';
import Icon from '../icons';

/** A menu row. Renders a <button> when onClick is set, otherwise a static row. */
export function MenuRow({ icon, title, description, control, onClick, disabled, danger, isNew, className = '', ...rest }) {
  const content = (
    <>
      <span className="osg-ri">{typeof icon === 'string' ? <Icon name={icon} /> : icon}</span>
      <span className="osg-row-text">
        <b>{title}{isNew ? <span className="osg-new">NEW</span> : null}</b>
        {description ? <small>{description}</small> : null}
      </span>
      {control !== undefined && control !== null ? <span className="osg-row-ctrl">{control}</span> : null}
    </>
  );
  const classes = `osg-row ${danger ? 'danger' : ''} ${className}`.trim();
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} disabled={disabled} {...rest}>
        {content}
      </button>
    );
  }
  return <div className={classes} {...rest}>{content}</div>;
}

export function MenuGroup({ title, children, className = '' }) {
  if (React.Children.toArray(children).length === 0) return null;
  return (
    <div className={`osg-group ${className}`.trim()}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  );
}

export function MenuNote({ children, tone = 'info' }) {
  return (
    <div className={`osg-note ${tone === 'warn' ? 'warn' : ''}`}>
      <Icon name="info" />
      <span>{children}</span>
    </div>
  );
}

export function Toggle({ on }) {
  return <span className={`osg-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={Boolean(on)} />;
}

export function Value({ children }) {
  return <span className="osg-val">{children}</span>;
}

/** Wraps an existing control (select, legacy panel) so it sits inside the menu styling. */
export function MenuBlock({ children, className = '' }) {
  return <div className={`osg-block ${className}`.trim()}>{children}</div>;
}
