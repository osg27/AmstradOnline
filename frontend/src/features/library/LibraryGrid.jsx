import React, { memo, useMemo, useRef, useState } from 'react';
import { PlayIcon } from '../home/icons';
import { systemStyle } from '../home/systemCapabilities';
import { boxArtFor } from '../home/homeLibrary';
import '../home/home.css';

const LibraryCard = memo(function LibraryCard({ game, favourite, broken, actions }) {
  const [failed, setFailed] = useState(false);
  const art = broken || failed ? '' : boxArtFor(game);
  const style = systemStyle(game.system);
  const versions = game.variantCount > 1 || game.source === 'vip-snes-gameplay';
  return (
    <div className="osg-lib-card">
      <button type="button" className="osg-cover-card" onClick={() => actions.open(game)}>
        <span className="osg-cover">
          {art ? (
            <img
              src={art}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => { setFailed(true); actions.imageError(game.id); }}
            />
          ) : (
            <span className="osg-cover-fallback" style={{ '--sys': style.color }}>{style.label}</span>
          )}
          <span className="osg-play" aria-hidden="true"><PlayIcon /></span>
        </span>
        <span>
          <span className="t">{game.title}</span>
          <span className="s" style={{ '--sys': style.color }}><i />{style.label}</span>
        </span>
      </button>
      <button
        type="button"
        className={`osg-lib-fav${favourite ? ' on' : ''}`}
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
        title={favourite ? 'Remove favourite' : 'Add favourite'}
        onClick={() => actions.favourite(game)}
      >
        <i className={favourite ? 'bi bi-star-fill' : 'bi bi-star'} aria-hidden="true" />
      </button>
      {versions ? (
        <button
          type="button"
          className="osg-lib-versions"
          aria-haspopup="dialog"
          aria-label={`Choose version of ${game.title}`}
          onClick={() => actions.versions(game)}
        >
          {game.variantCount > 1 ? `${game.variantCount} versions` : 'Versions'}
        </button>
      ) : null}
    </div>
  );
});

/**
 * Responsive box-art grid. The page owns paging (`games` is already the visible
 * slice and more load on scroll); cards are memoised so adding a page does not
 * re-render the ones already shown.
 */
export default function LibraryGrid({ games, favouriteSet, brokenIds, canShowMore, onOpen, onToggleFavourite, onVersions, onImageError }) {
  const latest = useRef(null);
  latest.current = { onOpen, onToggleFavourite, onVersions, onImageError };
  const actions = useMemo(() => ({
    open: (game) => latest.current.onOpen(game),
    favourite: (game) => latest.current.onToggleFavourite(game),
    versions: (game) => latest.current.onVersions(game),
    imageError: (id) => latest.current.onImageError(id),
  }), []);

  return (
    <>
      <div className="osg-lib-grid">
        {games.map((game) => (
          <LibraryCard
            key={game.id}
            game={game}
            favourite={game.variants.some((variant) => favouriteSet.has(variant.id))}
            broken={brokenIds.has(game.id)}
            actions={actions}
          />
        ))}
      </div>
      {canShowMore ? <p className="osg-lib-more" role="status">More games load as you scroll</p> : null}
    </>
  );
}
