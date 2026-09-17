'use strict';

const fs = require('fs');
const path = require('path');

const CLIPS_DIR = path.join(__dirname, '..', 'assets', 'clips');

class ClipRegistry {
  constructor() {
    this._cache = new Map();
  }

  listClips() {
    try {
      const dirs = fs.readdirSync(CLIPS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      return dirs.map(dirName => {
        try {
          const meta = this.getClipMeta(dirName);
          if (!meta) return null;
          return { id: meta.id, titolo: meta.titolo || meta.id };
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      console.warn('[ClipRegistry] listClips error:', e.message);
      return [];
    }
  }

  getClipMeta(clipId) {
    if (this._cache.has(clipId)) return this._cache.get(clipId);

    const metaPath = path.join(CLIPS_DIR, clipId, `${clipId}.json`);
    if (!fs.existsSync(metaPath)) return null;

    try {
      const raw = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      this._cache.set(clipId, meta);
      return meta;
    } catch (e) {
      console.error(`[ClipRegistry] Error reading meta for ${clipId}:`, e.message);
      return null;
    }
  }

  invalidate(clipId) {
    this._cache.delete(clipId);
  }
}

module.exports = ClipRegistry;
