import React from 'react';
import '../home/home.css';

/** Title row: page name, game count and the single "Add games" action. */
export default function LibraryHeader({ title, subtitle, onAddGames }) {
  return (
    <div className="osg-lib-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button type="button" className="osg-btn coin osg-lib-add" onClick={onAddGames} aria-haspopup="dialog">
        <i className="bi bi-plus-lg" aria-hidden="true" />
        Add games
      </button>
    </div>
  );
}
