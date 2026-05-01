import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importPackFile } from '../src/importPack';
import { reportValidation, validatePackFile } from '../src/validatePack';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'kana-cli-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const VALID_PACK = {
  id: 'test-pack',
  name: 'Test Pack',
  version: '1.0.0',
  items: [
    {
      id: 'word-yama',
      type: 'word',
      surface: '山',
      kana: 'やま',
      romaji: ['yama'],
      meaningsZh: ['山'],
      skillTags: ['kanji_reading'],
    },
    {
      id: 'word-kawa',
      type: 'word',
      surface: '川',
      kana: 'かわ',
      romaji: ['kawa'],
      meaningsZh: ['河'],
      skillTags: ['kanji_reading'],
      confusableItemIds: ['word-yama'],
    },
  ],
};

describe('validatePackFile', () => {
  it('reports OK for a valid pack', () => {
    const path = join(tmp, 'pack.json');
    writeFileSync(path, JSON.stringify(VALID_PACK));
    const outcome = validatePackFile({ packPath: path });
    expect(outcome.ok).toBe(true);
    const text = reportValidation(outcome);
    expect(text).toContain('OK');
  });

  it('reports FAIL for an invalid pack', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PACK)) as typeof VALID_PACK;
    bad.items[0]!.romaji = ['yamaaa'];
    const path = join(tmp, 'bad.json');
    writeFileSync(path, JSON.stringify(bad));
    const outcome = validatePackFile({ packPath: path });
    expect(outcome.ok).toBe(false);
    const text = reportValidation(outcome);
    expect(text).toContain('FAIL');
    expect(text).toContain('round-trip');
  });
});

describe('importPackFile', () => {
  it('imports a valid pack and lets us read items back', () => {
    const path = join(tmp, 'pack.json');
    writeFileSync(path, JSON.stringify(VALID_PACK));
    const dbPath = join(tmp, 'test.sqlite');

    const result = importPackFile({ packPath: path, dbPath });
    expect(result.ok).toBe(true);
    expect(result.itemsUpserted).toBe(2);
    expect(result.confusableEdgesUpserted).toBe(1);

    const db = new Database(dbPath);
    try {
      const items = db
        .prepare<
          [],
          { id: string; surface: string; kana: string }
        >('SELECT id, surface, kana FROM learning_items ORDER BY id')
        .all();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('word-kawa');
      expect(items[1]!.kana).toBe('やま');

      const confusables = db
        .prepare<
          [],
          { item_id: string; confusable_item_id: string }
        >('SELECT item_id, confusable_item_id FROM item_confusables')
        .all();
      expect(confusables).toHaveLength(1);
      expect(confusables[0]!.item_id).toBe('word-kawa');
      expect(confusables[0]!.confusable_item_id).toBe('word-yama');

      const pack = db
        .prepare<[string], { quality: string }>('SELECT quality FROM content_packs WHERE id = ?')
        .get('test-pack');
      expect(pack!.quality).toBe('user_imported');
    } finally {
      db.close();
    }
  });

  it('defaults draft packs to needs_review quality', () => {
    const draftPack = {
      ...VALID_PACK,
      id: 'draft-pack',
      version: '0.1.0-draft',
      items: VALID_PACK.items.map((item) => ({ ...item, tags: ['draft'] })),
    };
    const path = join(tmp, 'draft.json');
    writeFileSync(path, JSON.stringify(draftPack));
    const dbPath = join(tmp, 'test.sqlite');

    const result = importPackFile({ packPath: path, dbPath });
    expect(result.ok).toBe(true);

    const db = new Database(dbPath);
    try {
      const pack = db
        .prepare<[string], { quality: string }>('SELECT quality FROM content_packs WHERE id = ?')
        .get('draft-pack');
      expect(pack!.quality).toBe('needs_review');
    } finally {
      db.close();
    }
  });

  it('honours an explicit import quality override', () => {
    const path = join(tmp, 'pack.json');
    writeFileSync(path, JSON.stringify(VALID_PACK));
    const dbPath = join(tmp, 'test.sqlite');

    const result = importPackFile({ packPath: path, dbPath, quality: 'official' });
    expect(result.ok).toBe(true);

    const db = new Database(dbPath);
    try {
      const pack = db
        .prepare<[string], { quality: string }>('SELECT quality FROM content_packs WHERE id = ?')
        .get('test-pack');
      expect(pack!.quality).toBe('official');
    } finally {
      db.close();
    }
  });

  it('is idempotent across re-runs', () => {
    const path = join(tmp, 'pack.json');
    writeFileSync(path, JSON.stringify(VALID_PACK));
    const dbPath = join(tmp, 'test.sqlite');

    importPackFile({ packPath: path, dbPath });
    const second = importPackFile({ packPath: path, dbPath });
    expect(second.ok).toBe(true);
    expect(second.itemsUpserted).toBe(2);

    const db = new Database(dbPath);
    try {
      const count = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM learning_items').get();
      expect(count!.c).toBe(2);
      const examples = db
        .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM item_examples')
        .get();
      expect(examples!.c).toBe(0);
    } finally {
      db.close();
    }
  });

  it('refuses to import an invalid pack', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PACK)) as typeof VALID_PACK;
    bad.items[0]!.romaji = ['yamaaa'];
    const path = join(tmp, 'bad.json');
    writeFileSync(path, JSON.stringify(bad));
    const dbPath = join(tmp, 'test.sqlite');

    const result = importPackFile({ packPath: path, dbPath });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toMatch(/round-trip/);
  });
});
