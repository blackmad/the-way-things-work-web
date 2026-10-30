import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import type { ContentManifest, Hotspot, IndexEntry, MediaAsset, Section, Topic } from './types'
import './styles.css'

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '')
const pageUrl = (path: string) => `${BASE_PATH}${path}`
const assetUrl = (url: string) => `${BASE_PATH}${url.startsWith('/') ? url : `/${url}`}`
const MANIFEST_URL = assetUrl('/content/manifest.json')

function useHashRoute() {
  const read = () => {
    const match = location.hash.match(/^#\/topic\/(.+?)(?:\?screen=(\d+))?$/)
    return { topicId: match ? decodeURIComponent(match[1]) : '', screen: Number(match?.[2] || 0) }
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const update = () => setRoute(read())
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  return route
}

function navigate(topicId: string, screen = 0) {
  location.hash = `/topic/${encodeURIComponent(topicId)}${screen ? `?screen=${screen}` : ''}`
}

let currentSound: HTMLAudioElement | null = null
function playSound(url: string) {
  currentSound?.pause()
  currentSound = new Audio(assetUrl(url))
  currentSound.play().catch(() => { /* Autoplay policies can refuse; the control stays usable. */ })
}

const HOTSPOT_VERBS: Record<Hotspot['action'], string> = {
  play: 'Play original animation',
  open: 'Open original card',
  navigate: 'Open subject',
  sound: 'Play original sound',
}
const hotspotLabel = (hotspot: Hotspot) => `${HOTSPOT_VERBS[hotspot.action]} ${hotspot.target}`

function hotspotStyle(hotspot: Hotspot, width: number, height: number) {
  const [left, top, right, bottom] = hotspot.rect
  return { left: `${left / width * 100}%`, top: `${top / height * 100}%`, width: `${(right - left) / width * 100}%`, height: `${(bottom - top) / height * 100}%` }
}

// A screen with no authored controls that owns animations is a "Mammoth
// Movies" page: the original plays its title card and film on arrival.
function movieSequence(topic: Topic | undefined, image: MediaAsset | undefined) {
  if (!topic || !image || image.hotspots?.length) return []
  return topic.animations.filter((animation) => animation.playable && animation.baseId === image.id)
}
const playHotspot = (animation: MediaAsset): Hotspot => ({ rect: [0, 0, 0, 0], action: 'play', target: animation.id, url: animation.url })
function nextInSequence(sequence: MediaAsset[], current: Hotspot | null) {
  const index = current ? sequence.findIndex((animation) => animation.url === current.url) : -1
  return index >= 0 && index + 1 < sequence.length ? playHotspot(sequence[index + 1]) : null
}

// The Index screen is a text field and a list box drawn into the INDE00
// artwork. Choosing an entry shows its page and then opens its card.
const INDEX_FIELD = { left: 26, top: 85, width: 312, height: 21 }
const INDEX_LIST = { left: 26, top: 136, width: 312, height: 174 }
let pendingCard: IndexEntry | null = null

function IndexPanel({ entries, image }: { entries: IndexEntry[]; image: MediaAsset }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? entries.filter((entry) => entry.label.toLowerCase().includes(needle)) : entries
  }, [query, entries])
  const box = (area: typeof INDEX_FIELD) => percentBox(area.left, area.top, area.width, area.height, image.width!, image.height!)
  return <>
    <input
      className="index-field"
      style={box(INDEX_FIELD)}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Type a word"
      aria-label="Find an index entry"
      autoFocus
    />
    <ul className="index-list" style={box(INDEX_LIST)} aria-label="Index entries">
      {visible.map((entry, position) => (
        <li key={`${entry.label}-${position}`}>
          <button onClick={() => {
            pendingCard = entry.open ? entry : null
            navigate(entry.topicId, entry.screen)
          }}>{entry.label}</button>
        </li>
      ))}
      {visible.length === 0 && <li className="index-empty">Nothing matches “{query}”.</li>}
    </ul>
  </>
}

// After arriving from the Index, open the entry's card where its page would.
function takePendingCard(topic: Topic | undefined, image: MediaAsset | undefined): Hotspot | null {
  const entry = pendingCard
  if (!entry || !topic || !image || topic.id !== entry.topicId || !entry.url) return null
  pendingCard = null
  const authored = topic.images.flatMap((candidate) => candidate.hotspots || []).find((hotspot) => hotspot.action === 'open' && hotspot.url === entry.url)
  return { rect: [0, 0, 0, 0], action: 'open', target: entry.open!, url: entry.url, ...(authored?.at ? { at: authored.at } : {}) }
}

// The original window: a 94×460 navigation panel on the left and the 540×450
// page at (94, 4) inside a thin frame. The panel's buttons are hard-wired in
// the Windows executable rather than authored in the content database.
const WINDOW = { width: 640, height: 460 }
const PAGE_AREA = { left: 94, top: 4, width: 540, height: 450 }
const NAV_BUTTONS: { label: string; rect: [number, number, number, number]; topicId?: string; image?: string; back?: boolean }[] = [
  { label: 'Workshop', rect: [4, 4, 90, 78], topicId: 'WORKSHOP' },
  { label: 'Machines', rect: [4, 85, 90, 150], topicId: 'AZAZ', image: 'AZAZ0M' },
  { label: 'Principles of Science', rect: [4, 156, 90, 230], topicId: 'PRINCIPL' },
  { label: 'History', rect: [4, 236, 90, 303], topicId: 'TIMELINE', image: 'TTTT0M' },
  { label: 'Inventors', rect: [4, 303, 90, 369], topicId: 'INVENTOR/TITLE' },
  { label: 'Back', rect: [4, 377, 90, 393], back: true },
  { label: 'Index', rect: [4, 398, 90, 415], topicId: 'INDEX' },
  { label: 'Options', rect: [4, 417, 90, 434], topicId: 'OPTIONS' },
  { label: 'Help', rect: [4, 436, 90, 453], topicId: 'HELP' },
]
const percentBox = (left: number, top: number, width: number, height: number, areaWidth: number, areaHeight: number) => ({
  left: `${left / areaWidth * 100}%`, top: `${top / areaHeight * 100}%`, width: `${width / areaWidth * 100}%`, height: `${height / areaHeight * 100}%`,
})

function MediaSummary({ topic }: { topic: Topic }) {
  return (
    <span className="media-summary">
      {topic.images.length} page{topic.images.length === 1 ? '' : 's'}
      {topic.animations.length > 0 && ` · ${topic.animations.length} animation${topic.animations.length === 1 ? '' : 's'}`}
      {topic.audio.length > 0 && ` · ${topic.audio.length} sound${topic.audio.length === 1 ? '' : 's'}`}
    </span>
  )
}

function Sidebar({ sections, activeId, search, setSearch, close }: {
  sections: Section[]
  activeId: string
  search: string
  setSearch: (value: string) => void
  close: () => void
}) {
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sections
    return sections
      .map((section) => ({ ...section, topics: section.topics.filter((topic) =>
        `${topic.title} ${topic.code}`.toLowerCase().includes(query),
      ) }))
      .filter((section) => section.topics.length)
  }, [search, sections])

  return (
    <aside className="sidebar" aria-label="Encyclopedia contents">
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">Dorling Kindersley · 1994</span>
          <h1>The Way<br />Things Work</h1>
        </div>
        <button className="icon-button close" onClick={close} aria-label="Close contents">×</button>
      </div>
      <label className="search">
        <span>Find a subject</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="airplane, gears…" />
      </label>
      <nav className="contents">
        {visible.map((section) => (
          <details key={section.id} open={section.topics.some((topic) => topic.id === activeId) || Boolean(search)}>
            <summary>{section.title}<span>{section.topics.length}</span></summary>
            <ul>
              {section.topics.map((topic) => (
                <li key={topic.id}>
                  <a
                    href={`#/topic/${encodeURIComponent(topic.id)}`}
                    className={topic.id === activeId ? 'active' : ''}
                    onClick={close}
                  >
                    <strong>{topic.title}</strong>
                    <MediaSummary topic={topic} />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {visible.length === 0 && <p className="empty-search">Nothing matched “{search}”.</p>}
      </nav>
    </aside>
  )
}

function AudioShelf({ tracks }: { tracks: MediaAsset[] }) {
  if (!tracks.length) return null
  return (
    <section className="media-shelf" aria-labelledby="sounds-title">
      <div className="shelf-heading">
        <span className="shelf-number">02</span>
        <div><h3 id="sounds-title">Original sounds</h3><p>Digitized from Microsoft ADPCM</p></div>
      </div>
      <div className="audio-list">
        {tracks.map((track) => (
          <div className="audio-track" key={track.id}>
            <span>{track.id}</span>
            <audio controls preload="none" src={assetUrl(track.url)}>Your browser cannot play this sound.</audio>
          </div>
        ))}
      </div>
    </section>
  )
}

function AnimationShelf({ animations }: { animations: MediaAsset[] }) {
  if (!animations.length) return null
  return (
    <section className="media-shelf" aria-labelledby="animations-title">
      <div className="shelf-heading">
        <span className="shelf-number">03</span>
        <div><h3 id="animations-title">Animation archive</h3><p>Preserved original sequences</p></div>
      </div>
      <div className="animation-grid">
        {animations.map((animation) => (
          animation.playable ? (
            <div className="animation-player" key={animation.id}>
              <video controls preload="metadata" src={assetUrl(animation.url)} aria-label={`Original animation ${animation.id}`} />
              <div><strong>{animation.id}</strong><small>{animation.frames} frames · {animation.framesPerSecond} fps · {animation.duration?.toFixed(1)} sec{animation.inferredBase ? ' · inferred base' : ''}</small></div>
            </div>
          ) : (
            <div className="animation-chip" key={animation.id} title={animation.source}>
              <span className="play-mark">◆</span>
              <span><strong>{animation.id}</strong><small>{Math.ceil(animation.bytes / 1024)} KB · preserved ANI variant</small></span>
            </div>
          )
        ))}
      </div>
      {animations.some((animation) => !animation.playable) && <p className="preservation-note">Unplayable variants remain available in the preservation archive and are never discarded by conversion.</p>}
    </section>
  )
}

function CardOverlay({ asset, fallback, close, activate, animation, playAnimation, classic = false, page }: {
  asset?: MediaAsset
  fallback: Hotspot
  close: () => void
  activate: (hotspot: Hotspot) => void
  animation?: MediaAsset
  playAnimation?: () => void
  classic?: boolean
  /** Dimensions of the page the card sits on, used to honour the authored card position. */
  page?: { width: number; height: number }
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [close])
  const width = asset?.width || 242
  const height = asset?.height || 162
  // Cards are authored for the 540×450 page. Place them where the original
  // did whenever the card fits inside the page it is shown on.
  const at = fallback.at && page && fallback.at[0] + width <= page.width + 1 && fallback.at[1] + height <= page.height + 1
    ? percentBox(fallback.at[0], fallback.at[1], width, height, page.width, page.height)
    : null
  // A card's own animation paints into a blank area of its artwork, so the
  // film is shown in place, paused on its first frame until it is asked for.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [filmPlaying, setFilmPlaying] = useState(false)
  const [filmProgress, setFilmProgress] = useState(0)
  const [filmTouched, setFilmTouched] = useState(false)
  const inlineFilm = animation && animation.width === width && animation.height === height ? animation : undefined
  // The original drew a 74×22 rewind/play/progress strip into a slot left
  // in the card artwork; the strip and its buttons come from TWTW.EXE.
  const control = inlineFilm?.control
  function playInline(fromStart = true) {
    const video = videoRef.current
    if (!video) return false
    if (fromStart || video.ended) video.currentTime = 0
    setFilmTouched(true)
    video.play().catch(() => { /* Autoplay policies can refuse; the control stays usable. */ })
    return true
  }
  function rewindInline() {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = 0
    setFilmProgress(0)
  }
  return <div
    className={`card-backdrop${classic ? ' classic-card-backdrop' : ''}${at ? ' positioned' : ''}`}
    role="dialog"
    aria-modal="true"
    aria-label={`Information card ${fallback.target}. Click anywhere to close.`}
    onClick={close}
  >
    <div className="card-surface" style={at ? { ...at, aspectRatio: `${width} / ${height}` } : { aspectRatio: `${width} / ${height}` }}>
      <img src={assetUrl(fallback.url)} alt={`Information card ${fallback.target}`} />
      {inlineFilm && <video
        ref={videoRef}
        className="card-film"
        src={assetUrl(inlineFilm.url)}
        preload="auto"
        playsInline
        autoPlay={false}
        onClick={(event) => event.stopPropagation()}
        onPlay={() => setFilmPlaying(true)}
        onPause={() => setFilmPlaying(false)}
        onEnded={() => setFilmPlaying(false)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          setFilmProgress(video.duration ? video.currentTime / video.duration : 0)
        }}
        aria-label={`Original animation ${inlineFilm.id}`}
      />}
      {inlineFilm && control && <div
        className={`film-control${filmTouched ? '' : ' idle'}`}
        style={{
          ...percentBox(control[0], control[1], 74, 22, width, height),
          backgroundImage: `url(${assetUrl('/content/ui/anim-control.png')})`,
          '--play': `url(${assetUrl('/content/ui/anim-play.png')})`,
          '--play-down': `url(${assetUrl('/content/ui/anim-play-down.png')})`,
          '--pause': `url(${assetUrl('/content/ui/anim-pause.png')})`,
          '--rewind': `url(${assetUrl('/content/ui/anim-rewind.png')})`,
          '--rewind-down': `url(${assetUrl('/content/ui/anim-rewind-down.png')})`,
        } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
        role="group"
        aria-label="Animation control"
      >
        <button
          className="film-rewind"
          style={percentBox(3, 3, 15, 16, 74, 22)}
          onClick={rewindInline}
          aria-label="Rewind animation"
          title="Rewind"
        />
        <button
          className={`film-play${filmPlaying ? ' playing' : ''}`}
          style={percentBox(20, 3, 16, 16, 74, 22)}
          onClick={() => (filmPlaying ? videoRef.current?.pause() : playInline(false))}
          aria-label={filmPlaying ? 'Pause animation' : 'Play animation'}
          title={filmPlaying ? 'Pause' : 'Play animation'}
        />
        <div className="film-progress" style={percentBox(40, 8, 29, 8, 74, 22)} aria-hidden="true">
          <div style={{ width: `${filmProgress * 100}%` }} />
        </div>
      </div>}
      {inlineFilm && !control && !filmPlaying && <button
        className="film-badge"
        style={inlineFilm.region
          ? { left: `${(inlineFilm.region[0] + inlineFilm.region[2]) / 2 / width * 100}%`, top: `${(inlineFilm.region[1] + inlineFilm.region[3]) / 2 / height * 100}%` }
          : { left: '50%', top: '50%' }}
        onClick={(event) => {
          event.stopPropagation()
          playInline()
        }}
        aria-label={`Play original animation ${inlineFilm.id}`}
        title="Play animation"
      >▶</button>}
      {asset?.hotspots?.map((hotspot, index) => (
        <button
          key={`${hotspot.target}-${index}`}
          className={`card-hotspot ${hotspot.action}`}
          style={hotspotStyle(hotspot, width, height)}
          onClick={(event) => {
            event.stopPropagation()
            if (hotspot.action === 'play' && inlineFilm && hotspot.url === inlineFilm.url && playInline()) return
            activate(hotspot)
          }}
          aria-label={hotspotLabel(hotspot)}
          title={hotspotLabel(hotspot)}
        />
      ))}
    </div>
    {animation && playAnimation && !control && <button className="card-play" onClick={(event) => {
      event.stopPropagation()
      if (!playInline()) playAnimation()
    }}>▶ Play animation</button>}
    <button className="close-card" onClick={close} aria-label="Close card">×</button>
  </div>
}

function TopicViewer({ topic, initialScreen, imagesByUrl, index }: { topic: Topic; initialScreen: number; imagesByUrl: Map<string, MediaAsset>; index: IndexEntry[] }) {
  const [screen, setScreen] = useState(Math.min(initialScreen, Math.max(0, topic.images.length - 1)))
  const [activeAnimation, setActiveAnimation] = useState<Hotspot | null>(null)
  useEffect(() => {
    setScreen(Math.min(initialScreen, Math.max(0, topic.images.length - 1)))
    setActiveAnimation(null)
  }, [topic.id, initialScreen])
  const image = topic.images[screen]
  const movie = movieSequence(topic, image)
  useEffect(() => {
    const card = takePendingCard(topic, image)
    if (card) setActiveAnimation(card)
    else if (movie.length) setActiveAnimation(playHotspot(movie[0]))
  }, [topic.id, screen])
  const cardAnimation = activeAnimation ? topic.animations.find((animation) =>
    animation.baseId === activeAnimation.target || animation.id.startsWith(`${activeAnimation.target}0`),
  ) : undefined

  function choose(index: number) {
    setScreen(index)
    setActiveAnimation(null)
    history.replaceState(null, '', `#/topic/${encodeURIComponent(topic.id)}${index ? `?screen=${index}` : ''}`)
  }

  function activate(hotspot: Hotspot) {
    if (hotspot.sound) playSound(hotspot.sound)
    if (hotspot.action === 'sound') playSound(hotspot.url)
    else if (hotspot.action === 'navigate' && hotspot.topicId) navigate(hotspot.topicId, hotspot.screen)
    else setActiveAnimation(hotspot)
  }

  return (
    <article className="topic-viewer">
      <header className="topic-header">
        <div>
          <span className="eyebrow">Archive reference {topic.code}</span>
          <h2>{topic.title}</h2>
        </div>
        <MediaSummary topic={topic} />
      </header>

      <section className="page-section" aria-labelledby="original-pages-title">
        <div className="shelf-heading page-heading">
          <span className="shelf-number">01</span>
          <div><h3 id="original-pages-title">Original illustrated pages</h3><p>Lossless conversion from the CD-ROM artwork</p></div>
        </div>
        <div className={`stage ${activeAnimation ? 'playing' : ''}`}>
          {image ? (
            <div className="screen-frame" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
              {activeAnimation ? (
                <>
                  {activeAnimation.action === 'play'
                    ? <video key={activeAnimation.url} src={assetUrl(activeAnimation.url)} autoPlay controls onEnded={() => setActiveAnimation(nextInSequence(movie, activeAnimation))} aria-label={`Original animation ${activeAnimation.target}`} />
                    : <CardOverlay asset={imagesByUrl.get(activeAnimation.url)} fallback={activeAnimation} close={() => setActiveAnimation(null)} activate={activate} animation={cardAnimation} page={{ width: image.width!, height: image.height! }} playAnimation={() => cardAnimation && setActiveAnimation({ rect: [0, 0, 0, 0], action: 'play', target: cardAnimation.id, url: cardAnimation.url })} />}
                  {activeAnimation.action === 'play' && <button className="close-animation" onClick={() => {
                    if (movie.length && screen > 0) choose(0)
                    else setActiveAnimation(null)
                  }} aria-label="Close animation">×</button>}
                </>
              ) : (
                <>
                  <img
                    key={image.url}
                    src={assetUrl(image.url)}
                    width={image.width}
                    height={image.height}
                    alt={`${topic.title}, original screen ${screen + 1} of ${topic.images.length}`}
                  />
                  {movie.length > 0 && <button className="replay-movie" onClick={() => setActiveAnimation(playHotspot(movie[0]))}>▶ Play the film again</button>}
                  {topic.id === 'INDEX' && <IndexPanel entries={index} image={image} />}
                  {image.hotspots?.map((hotspot, index) => (
                    <button
                      key={`${hotspot.target}-${index}`}
                      className={`original-hotspot ${hotspot.action}`}
                      style={hotspotStyle(hotspot, image.width!, image.height!)}
                      onClick={() => activate(hotspot)}
                      aria-label={hotspotLabel(hotspot)}
                      title={hotspotLabel(hotspot)}
                    />
                  ))}
                </>
              )}
            </div>
          ) : <div className="no-image">This section contains media but no illustrated page.</div>}
        </div>
        {image?.hotspots?.length ? <p className="interaction-note">{image.hotspots.length} original interactive area{image.hotspots.length === 1 ? '' : 's'} · outlined on the page</p> : null}
        {topic.images.length > 1 && (
          <>
            <div className="pager">
              <button onClick={() => choose(Math.max(0, screen - 1))} disabled={screen === 0}>← Previous</button>
              <span>Screen {screen + 1} / {topic.images.length}</span>
              <button onClick={() => choose(Math.min(topic.images.length - 1, screen + 1))} disabled={screen === topic.images.length - 1}>Next →</button>
            </div>
            <div className="filmstrip" aria-label="Choose an original screen">
              {topic.images.map((candidate, index) => (
                <button key={candidate.id} className={index === screen ? 'selected' : ''} onClick={() => choose(index)} aria-label={`Screen ${index + 1}: ${candidate.id}`}>
                  <img src={assetUrl(candidate.url)} alt="" loading="lazy" />
                  <span>{candidate.id}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      <AudioShelf tracks={topic.audio} />
      <AnimationShelf animations={topic.animations} />
    </article>
  )
}

function Welcome({ manifest, openTopic }: { manifest: ContentManifest; openTopic: (id: string) => void }) {
  const machines = manifest.sections.filter((section) => section.id.startsWith('ARTICLE')).flatMap((section) => section.topics)
  const highlights = ['ARTICLE1/AIRP', 'ARTICLE1/GEAR', 'ARTICLE2/HELI', 'ARTICLE3/ROBO']
    .map((id) => machines.find((topic) => topic.id === id)).filter(Boolean) as Topic[]
  return (
    <main className="welcome">
      <span className="eyebrow">A preserved interactive encyclopedia</span>
      <h2>Open the workshop.<br /><em>See inside everything.</em></h2>
      <p className="welcome-copy">Explore the original illustrated screens and sounds from the 1994 CD-ROM, carefully translated for a modern browser.</p>
      <div className="stat-row">
        <div><strong>{manifest.totals.topics}</strong><span>subjects</span></div>
        <div><strong>{manifest.totals.images.toLocaleString()}</strong><span>illustrations</span></div>
        <div><strong>{manifest.totals.animations}</strong><span>animations preserved</span></div>
      </div>
      <div className="highlight-grid">
        {highlights.map((topic, index) => (
          <button key={topic.id} onClick={() => openTopic(topic.id)}>
            <span>0{index + 1}</span><strong>{topic.title}</strong><small>Explore subject →</small>
          </button>
        ))}
      </div>
    </main>
  )
}

function OpeningSequence({ topic, onFinish }: { topic?: Topic; onFinish: () => void }) {
  const animations = useMemo(() => topic?.animations.filter((animation) => animation.playable) || [], [topic])
  const [index, setIndex] = useState(0)
  const [needsGesture, setNeedsGesture] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const current = animations[index]
  const poster = topic?.images[index === 0 ? 0 : 1] || topic?.images?.[0]

  useEffect(() => {
    setIndex(0)
    setNeedsGesture(false)
  }, [topic?.id])

  useEffect(() => {
    if (!current) return
    const video = videoRef.current
    if (!video) return
    video.play().catch(() => setNeedsGesture(true))
  }, [current])

  function advance() {
    if (index + 1 < animations.length) {
      setIndex(index + 1)
      setNeedsGesture(false)
    } else {
      onFinish()
    }
  }

  if (!current) {
    return <div className="classic-opening">
      {poster && <img src={assetUrl(poster.url)} alt="The Way Things Work title screen" />}
      <button className="opening-start" onClick={onFinish}>Enter the workshop →</button>
    </div>
  }

  return <div className="classic-opening">
    <video
      key={current.url}
      ref={videoRef}
      src={assetUrl(current.url)}
      poster={poster ? assetUrl(poster.url) : undefined}
      autoPlay
      playsInline
      onPlay={() => setNeedsGesture(false)}
      onEnded={advance}
    />
    {needsGesture && <button className="opening-start" onClick={() => {
      setNeedsGesture(false)
      videoRef.current?.play().catch(() => setNeedsGesture(true))
    }}>▶ Play the opening</button>}
    <button className="opening-skip" onClick={onFinish}>Skip to workshop →</button>
  </div>
}

function ClassicApp({ manifest, topic, initialScreen }: { manifest: ContentManifest; topic?: Topic; initialScreen: number }) {
  const topics = manifest.sections.flatMap((section) => section.topics)
  const imagesByUrl = useMemo(() => new Map(topics.flatMap((candidate) => candidate.images).map((image) => [image.url, image])), [topics])
  const [contentsOpen, setContentsOpen] = useState(false)
  const [screen, setScreen] = useState(initialScreen)
  const [active, setActive] = useState<Hotspot | null>(null)
  useEffect(() => {
    setScreen(Math.min(initialScreen, Math.max(0, (topic?.images.length || 1) - 1)))
    setActive(null)
    if (topic) setContentsOpen(false)
  }, [topic?.id, initialScreen])
  const image = topic?.images[screen]
  const movie = movieSequence(topic, image)
  useEffect(() => {
    const card = takePendingCard(topic, image)
    if (card) setActive(card)
    else if (movie.length) setActive(playHotspot(movie[0]))
  }, [topic?.id, screen])
  const cardAnimation = active?.action === 'open' ? topic?.animations.find((animation) =>
    animation.baseId === active.target || animation.id.startsWith(`${active.target}0`),
  ) : undefined
  const titleTopic = topics.find((candidate) => candidate.id === 'TITLE')
  const workshopTopic = topics.find((candidate) => candidate.id === 'WORKSHOP') || topics[0]
  const showingOpening = !topic || topic.id === 'TITLE'

  function enterWorkshop() {
    if (workshopTopic) location.hash = `/topic/${encodeURIComponent(workshopTopic.id)}`
  }

  function choose(index: number) {
    if (!topic) return
    setScreen(index)
    setActive(null)
    history.replaceState(null, '', pageUrl(`/classic#/topic/${encodeURIComponent(topic.id)}${index ? `?screen=${index}` : ''}`))
  }

  function activate(hotspot: Hotspot) {
    if (hotspot.sound) playSound(hotspot.sound)
    if (hotspot.action === 'sound') playSound(hotspot.url)
    else if (hotspot.action === 'navigate' && hotspot.topicId) navigate(hotspot.topicId, hotspot.screen)
    else setActive(hotspot)
  }

  function pressNavButton(button: typeof NAV_BUTTONS[number]) {
    if (button.back) {
      history.back()
      return
    }
    const destination = topics.find((candidate) => candidate.id === button.topicId)
    if (!destination) return
    const index = button.image ? destination.images.findIndex((candidate) => candidate.id === button.image) : 0
    navigate(destination.id, Math.max(0, index))
  }

  const navImage = topics.find((candidate) => candidate.id === 'NAV')?.images
  const navArt = (id: string) => navImage?.find((candidate) => candidate.id === id)
  // Fit the current screen inside the original page area, which most screens
  // fill exactly; help, index, and card screens are smaller and sit centered.
  const fit = image ? Math.min(PAGE_AREA.width / image.width!, PAGE_AREA.height / image.height!, 1) : 1
  const screenBox = image ? percentBox(
    PAGE_AREA.left + (PAGE_AREA.width - image.width! * fit) / 2,
    PAGE_AREA.top + (PAGE_AREA.height - image.height! * fit) / 2,
    image.width! * fit,
    image.height! * fit,
    WINDOW.width,
    WINDOW.height,
  ) : null

  return (
    <main className="classic-shell">
      <header className="classic-toolbar">
        <button onClick={() => setContentsOpen(true)}>Contents</button>
        <a href={pageUrl('/classic#/')}>The Way Things Work</a>
        <a href={pageUrl(topic ? `/#/topic/${encodeURIComponent(topic.id)}${screen ? `?screen=${screen}` : ''}` : '/#/')}>Archive view</a>
      </header>

      <section className="classic-workspace" aria-label="Original-style encyclopedia viewer">
        {showingOpening ? (
          <OpeningSequence topic={titleTopic} onFinish={enterWorkshop} />
        ) : image && screenBox ? (
          <div className="classic-window" style={{ aspectRatio: `${WINDOW.width} / ${WINDOW.height}` }}>
            <nav className="classic-nav" aria-label="Original navigation panel">
              {navArt('NAV') && <img src={assetUrl(navArt('NAV')!.url)} alt="" />}
              {NAV_BUTTONS.map((button) => (
                <button
                  key={button.label}
                  className="classic-nav-button"
                  style={percentBox(button.rect[0], button.rect[1], button.rect[2] - button.rect[0], button.rect[3] - button.rect[1], 94, WINDOW.height)}
                  onClick={() => pressNavButton(button)}
                  aria-label={button.label}
                  title={button.label}
                />
              ))}
            </nav>
            {navArt('FRAMETOP') && <img className="classic-frame" src={assetUrl(navArt('FRAMETOP')!.url)} alt="" style={percentBox(PAGE_AREA.left, 0, 544, 4, WINDOW.width, WINDOW.height)} />}
            {navArt('FRAMESID') && <img className="classic-frame" src={assetUrl(navArt('FRAMESID')!.url)} alt="" style={percentBox(PAGE_AREA.left + PAGE_AREA.width, PAGE_AREA.top, 4, 452, WINDOW.width, WINDOW.height)} />}
            {navArt('FRAMEBOT') && <img className="classic-frame" src={assetUrl(navArt('FRAMEBOT')!.url)} alt="" style={percentBox(PAGE_AREA.left, PAGE_AREA.top + PAGE_AREA.height, 545, 5, WINDOW.width, WINDOW.height)} />}
            <div className="classic-screen" style={screenBox}>
              <img src={assetUrl(image.url)} width={image.width} height={image.height} alt={`${topic?.title}, screen ${screen + 1}`} />
              {!active && image.hotspots?.map((hotspot, index) => (
                <button
                  key={`${hotspot.target}-${index}`}
                  className={`classic-hotspot ${hotspot.action}`}
                  style={hotspotStyle(hotspot, image.width!, image.height!)}
                  onClick={() => activate(hotspot)}
                  aria-label={hotspotLabel(hotspot)}
                  title={hotspotLabel(hotspot)}
                />
              ))}
              {!active && movie.length > 0 && <button className="replay-movie" onClick={() => setActive(playHotspot(movie[0]))}>▶ Play the film again</button>}
              {!active && topic?.id === 'INDEX' && <IndexPanel entries={manifest.index || []} image={image} />}
              {active?.action === 'play' && <div className="classic-media-overlay"><video key={active.url} src={assetUrl(active.url)} autoPlay controls onEnded={() => setActive(nextInSequence(movie, active))} /><button onClick={() => {
                // Leaving a film page returns to the article it belongs to.
                if (movie.length && topic && screen > 0) navigate(topic.id, 0)
                else setActive(null)
              }} aria-label="Close animation">×</button></div>}
              {active?.action === 'open' && <CardOverlay asset={imagesByUrl.get(active.url)} fallback={active} close={() => setActive(null)} activate={activate} animation={cardAnimation} page={{ width: image.width!, height: image.height! }} playAnimation={() => cardAnimation && setActive({ rect: [0, 0, 0, 0], action: 'play', target: cardAnimation.id, url: cardAnimation.url })} classic />}
            </div>
          </div>
        ) : (
          <div className="classic-intro">
            <span>Dorling Kindersley · 1994</span>
            <h1>The Way Things Work</h1>
            <p>Choose a subject from Contents to begin.</p>
            <button onClick={() => setContentsOpen(true)}>Open contents</button>
          </div>
        )}
      </section>

      {showingOpening && <footer className="classic-statusbar">
        <span>The Way Things Work · opening sequence</span>
        <button onClick={enterWorkshop}>Skip to workshop →</button>
      </footer>}
      {topic && !showingOpening && <footer className="classic-statusbar">
        <button onClick={() => choose(Math.max(0, screen - 1))} disabled={screen === 0}>◀</button>
        <span>{topic.title} · {image?.id} · {image?.hotspots?.length || 0} active areas</span>
        <button onClick={() => choose(Math.min(topic.images.length - 1, screen + 1))} disabled={screen === topic.images.length - 1}>▶</button>
      </footer>}

      {contentsOpen && <div className="classic-contents" role="dialog" aria-modal="true" aria-label="Contents">
        <div className="classic-contents-panel">
          <header><h2>Contents</h2><button onClick={() => setContentsOpen(false)} aria-label="Close contents">×</button></header>
          {manifest.sections.map((section) => <section key={section.id}>
            <h3>{section.title}</h3>
            <div>{section.topics.map((candidate) => <a key={candidate.id} href={pageUrl(`/classic#/topic/${encodeURIComponent(candidate.id)}`)} onClick={() => setContentsOpen(false)}>{candidate.title}</a>)}</div>
          </section>)}
        </div>
      </div>}
    </main>
  )
}

function MissingContent() {
  return (
    <main className="missing">
      <span className="eyebrow">One-time setup required</span>
      <h2>Bring your CD-ROM.</h2>
      <p>The web application is ready, but its generated content is intentionally not committed. Import your legally obtained disc image:</p>
      <pre><code>npm run import -- "/absolute/path/to/Way Things Work.iso"</code></pre>
      <p>Then run <code>npm run dev</code> again.</p>
    </main>
  )
}

function App() {
  const [manifest, setManifest] = useState<ContentManifest | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const route = useHashRoute()
  const imagesByUrl = useMemo(() => new Map((manifest?.sections || []).flatMap((section) => section.topics).flatMap((topic) => topic.images).map((image) => [image.url, image])), [manifest])
  useEffect(() => {
    fetch(MANIFEST_URL).then((response) => {
      if (!response.ok) throw new Error(String(response.status))
      return response.json()
    }).then(setManifest).catch(() => setLoadError(true))
  }, [])

  if (loadError) return <MissingContent />
  if (!manifest) return <div className="loading">Opening the workshop…</div>
  const topics = manifest.sections.flatMap((section) => section.topics)
  const topic = topics.find((candidate) => candidate.id === route.topicId)
  if (location.pathname.startsWith(pageUrl('/classic'))) return <ClassicApp manifest={manifest} topic={topic} initialScreen={route.screen} />
  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <Sidebar sections={manifest.sections} activeId={topic?.id || ''} search={search} setSearch={setSearch} close={() => setMenuOpen(false)} />
      <div className="main-column">
        <div className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)}>☰ <span>Contents</span></button>
          <a className="wordmark" href="#/">TWTW <span>web archive</span></a>
          <a className="classic-link" href={pageUrl(topic ? `/classic#/topic/${encodeURIComponent(topic.id)}${route.screen ? `?screen=${route.screen}` : ''}` : '/classic#/')}>Classic mode</a>
          {topic && <button className="surprise" onClick={() => navigate(topics[Math.floor(Math.random() * topics.length)].id)}>Surprise me</button>}
        </div>
        {topic ? <TopicViewer topic={topic} initialScreen={route.screen} imagesByUrl={imagesByUrl} index={manifest.index || []} /> : <Welcome manifest={manifest} openTopic={navigate} />}
        <footer>Private preservation build · Source image {manifest.source.sha256.slice(0, 12)}…</footer>
      </div>
      <button className="backdrop" aria-label="Close contents" onClick={() => setMenuOpen(false)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
