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
  action: 'play' | 'open' | 'navigate'
  target: string
  url: string
  topicId?: string
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

export interface ContentManifest {
  schemaVersion: number
  source: { label: string; sha256: string }
  generatedAt: string
  totals: { topics: number; images: number; animations: number; audio: number; hotspots?: number }
  sections: Section[]
}
