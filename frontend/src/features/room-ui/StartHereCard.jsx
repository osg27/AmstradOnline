import React from 'react';
import { withIndefiniteArticle } from './roomUiConfig';

/** "Start here" card shown over the empty screen until a game (and Kickstart) is ready. */
export default function StartHereCard({
  isPuaeAmiga,
  isArcade,
  loadedDiskName,
  amigaRequiredModel,
  systemLabel,
  hasLibraryGames,
  onChooseLibrary,
  onChooseFile,
  onLoadKickstart,
  onChooseRomFolder,
  startButton,
}) {
  const kickstartLabel = amigaRequiredModel === 'CD32' ? 'CD32 ROMs' : amigaRequiredModel === 'A1200' ? 'Kickstart 3.1' : 'Kickstart 1.3';
  const kickstartNeed = amigaRequiredModel === 'CD32'
    ? 'This CD32 disc needs the CD32 Kickstart 40.060 and extended ROMs (select both files, a zip, or one 1 MB combined ROM).'
    : amigaRequiredModel === 'A1200' ? 'This WHDLoad/A1200 game needs Kickstart 3.1.' : 'This A500/floppy game needs Kickstart 1.3.';
  const gameNoun = isArcade ? 'an arcade game' : `${withIndefiniteArticle(systemLabel)} game`;

  return (
    <section className="osg-start-card" aria-labelledby="room-getting-started-title">
      <div className="osg-start-copy">
        <span className="osg-eyebrow">Start here</span>
        <strong id="room-getting-started-title">
          {isPuaeAmiga && loadedDiskName ? `Now load ${kickstartLabel}` : `Choose ${gameNoun}`}
        </strong>
        <small>
          {isPuaeAmiga
            ? loadedDiskName
              ? `${kickstartNeed} It is stored only in this browser for next time.`
              : 'Choose the game first: floppies, WHDLoad, or a CD32 disc. We will identify which Kickstart it needs.'
            : hasLibraryGames
              ? 'Pick a game from your connected library, or choose a file from this device.'
              : 'Choose a game file from this device. You can connect a whole folder from the Library later.'}
        </small>
      </div>
      <div className="osg-start-steps">
        {isPuaeAmiga && loadedDiskName ? (
          <button type="button" onClick={onLoadKickstart}>
            <span>2</span>{`Load ${kickstartLabel}`}
          </button>
        ) : null}
        {!loadedDiskName && hasLibraryGames ? (
          <button type="button" onClick={onChooseLibrary}>
            <span>1</span>Choose from library
          </button>
        ) : null}
        {!loadedDiskName && onChooseRomFolder ? (
          <button type="button" onClick={onChooseRomFolder}>
            <span>1</span>Choose ROM folder
          </button>
        ) : null}
        {!loadedDiskName ? (
          <button type="button" className="secondary" onClick={onChooseFile}>
            <span>1</span>Choose game file
          </button>
        ) : null}
        {startButton}
        {isPuaeAmiga ? (
          <small>{loadedDiskName ? 'Once the correct Kickstart is ready, the game can boot.' : 'We check the game type before asking for a Kickstart ROM.'}</small>
        ) : null}
      </div>
    </section>
  );
}
