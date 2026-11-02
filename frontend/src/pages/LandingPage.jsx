import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import logoUrl from '../../assets/Logo.png';
import '../features/landing/landing.css';

const TITLE = 'Old Style Gaming - play your retro games online with friends';
const DESCRIPTION = 'Play Amstrad, Spectrum, C64, Amiga, Mega Drive, SNES and arcade games you own, on your own, online with a friend, or taking turns. Your game files never leave your computer.';

const SYSTEMS = [
  ['Amstrad CPC', '#3fdc8a'], ['ZX Spectrum', '#ea3a30'], ['Commodore 64', '#ffb547'],
  ['MSX / MSX2', '#2f86e0'], ['Atari ST', '#ea3a30'], ['Commodore Amiga', '#2f86e0'],
  ['Sharp X68000', '#ea3a30'], ['Sega Master System', '#a07cf0'], ['Nintendo Entertainment System', '#ea3a30'],
  ['Mega Drive', '#a07cf0'], ['SNES', '#ffb547'], ['PC Engine / TurboGrafx-16', '#ffc82e'],
  ['Sony PlayStation', '#a07cf0'], ['MAME Arcade', '#ffc82e'],
];

const COVERS = [
  ['snes-smw-box.jpg', 'Super Mario World box art'],
  ['md-sonic-box.jpg', 'Sonic the Hedgehog box art'],
  ['mame-sf2-box.jpg', 'Street Fighter II box art'],
  ['amiga-lemmings-box.jpg', 'Lemmings box art'],
  ['cpc-robocop-box.jpg', 'RoboCop box art'],
];

const STEPS = [
  ['1', 'Pick your machines', 'Choose the computers and consoles you grew up with.'],
  ['2', 'Add your games', 'Point the site at game files you already own. They stay on your computer.'],
  ['3', 'Play, alone or with friends', 'Jump in solo, share a room code with a mate, or take turns in a group.'],
];

const FEATURES = [
  ['bi-people-fill', 'Online 2-player rooms', 'Start a room, send a code, and play together. Works on every system.'],
  ['bi-joystick', 'Party Mode', 'Take turns with a group on Amstrad CPC, Commodore 64 and arcade cabinets.'],
  ['bi-trophy-fill', 'Tournaments and high scores', 'Compete for the top of the board in tournaments.'],
  ['bi-award-fill', 'RetroAchievements', 'Earn achievements on supported consoles: Mega Drive, Master System, SNES, NES and Amstrad CPC.'],
];

export default function LandingPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', DESCRIPTION);
    return () => {
      document.title = previous;
      if (created) meta.remove();
      else if (prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, []);

  return (
    <div className="lp">
      <a className="lp-skip" href="#lp-main">Skip to content</a>
      <header className="lp-top">
        <div className="lp-top-inner">
          <Link to="/" className="lp-brand">
            <img src={logoUrl} alt="" width="40" height="40" />
            <span>Old Style Gaming</span>
          </Link>
          <nav className="lp-nav" aria-label="Main">
            <a href="#systems">Systems</a>
            <a href="#compete">Compete</a>
            <a href="#how">How it works</a>
          </nav>
          <div className="lp-top-actions">
            <Link to="/login" className="lp-btn lp-btn-ghost">Sign in</Link>
            <Link to="/register" className="lp-btn lp-btn-coin">Start playing</Link>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Retro games, together</p>
            <h1>Your old games. Online with mates.</h1>
            <p className="lp-sub">
              Play Amstrad, Spectrum, C64, Amiga, Mega Drive, SNES and arcade games you own.
              Play on your own, online with a friend, or take turns with a group.
            </p>
            <div className="lp-cta">
              <Link to="/register" className="lp-btn lp-btn-coin lp-btn-lg">Start playing, it&apos;s free</Link>
              <a href="#how" className="lp-btn lp-btn-ghost lp-btn-lg">How it works</a>
            </div>
            <ul className="lp-trust">
              <li><i className="bi bi-shield-check" aria-hidden="true" /> Your game files stay on your computer and are never uploaded</li>
              <li><i className="bi bi-browser-chrome" aria-hidden="true" /> No install needed</li>
            </ul>
          </div>
          <div className="lp-hero-art">
            <div className="lp-crt">
              <img src="/landing/md-sor2-snap.png" alt="Streets of Rage 2 running on the Mega Drive" width="320" height="224" />
            </div>
            <ul className="lp-covers" aria-label="Example games">
              {COVERS.map(([file, alt]) => (
                <li key={file}><img src={`/landing/${file}`} alt={alt} loading="lazy" width="120" height="160" /></li>
              ))}
            </ul>
          </div>
        </section>

        <section id="systems" className="lp-section" aria-labelledby="lp-systems-h">
          <h2 id="lp-systems-h">Your machines are here</h2>
          <p className="lp-lede">From 8-bit home computers to 16-bit consoles and the arcade.</p>
          <ul className="lp-chips">
            {SYSTEMS.map(([name, color]) => (
              <li key={name} className="lp-chip"><i style={{ background: color }} aria-hidden="true" />{name}</li>
            ))}
          </ul>
        </section>

        <section id="how" className="lp-section" aria-labelledby="lp-how-h">
          <h2 id="lp-how-h">How it works</h2>
          <ol className="lp-steps">
            {STEPS.map(([n, title, text]) => (
              <li key={n}>
                <span className="lp-step-n" aria-hidden="true">{n}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="compete" className="lp-section" aria-labelledby="lp-feat-h">
          <h2 id="lp-feat-h">Play it your way</h2>
          <ul className="lp-features">
            {FEATURES.map(([icon, title, text]) => (
              <li key={title}>
                <i className={`bi ${icon}`} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-final" aria-labelledby="lp-final-h">
          <h2 id="lp-final-h">Ready for another go?</h2>
          <p>Make a free account and be playing in a few minutes.</p>
          <div className="lp-cta lp-cta-center">
            <Link to="/register" className="lp-btn lp-btn-coin lp-btn-lg">Start playing, it&apos;s free</Link>
            <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">Sign in</Link>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <p>Old Style Gaming. Bring your own game files. Game names and box art belong to their owners.</p>
      </footer>
    </div>
  );
}
