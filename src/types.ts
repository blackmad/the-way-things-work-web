export interface MediaAsset {
  id: string
  source: string
  url: string
  bytes: number
  width?: number
  height?: number
  playable?: boolean
  archiveUrl?: string
  frames?: number
  framesPerSecond?: number
  duration?: number
  inferredBase?: boolean
  baseId?: string
  hotspots?: Hotspot[]
}

export interface Hotspot {
  rect: [number, number, number, number]
  action: 'play' | 'open' | 'navigate' | 'sound'
  target: string
  url: string
  topicId?: string
  /** Screen index within the destination topic for navigate actions. */
  screen?: number
  /** Authored top-left position of an opened card on its 540×450 page. */
  at?: [number, number]
  /** A sound the original control played alongside its main action. */
  sound?: string
}

export interface Topic {
  id: string
  code: string
  title: string
  sourcePath: string
  images: MediaAsset[]
  animations: MediaAsset[]
  audio: MediaAsset[]
}

export interface Section {
  id: string
  title: string
  topics: Topic[]
}

export interface IndexEntry {
  label: string
  topicId: string
  screen: number
  /** Card to open once the page is showing. */
  open?: string
  url?: string
}

export interface ContentManifest {
  schemaVersion: number
  source: { label: string; sha256: string }
  generatedAt: string
  totals: { topics: number; images: number; animations: number; audio: number; hotspots?: number }
  sections: Section[]
  index?: IndexEntry[]
}
