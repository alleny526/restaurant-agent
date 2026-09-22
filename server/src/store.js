import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import initSqlJs from 'sql.js';
import { createSeedState } from './seed-data.js';

function rowValue(database, sql, params = []) {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function normalizeState(value) {
  const seed = createSeedState();
  return {
    version: Number(value?.version) || seed.version,
    restaurants: [],
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    menuVersions: Array.isArray(value?.menuVersions) ? value.menuVersions : [],
    processedRequests: Array.isArray(value?.processedRequests) ? value.processedRequests : [],
    reviews: Array.isArray(value?.reviews) ? value.reviews : [],
    users: Array.isArray(value?.users) ? value.users : [],
    otpRequests: Array.isArray(value?.otpRequests) ? value.otpRequests : []
  };
}

function restaurantDocument(restaurant) {
  const { menu: _menu, ...document } = restaurant;
  return document;
}

export class SqliteStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.database = null;
    this.state = normalizeState(createSeedState());
    this.initialRestaurants = structuredClone(options.initialRestaurants ?? []);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    const SQL = await initSqlJs();
    let created = false;
    try {
      const bytes = await readFile(this.filePath);
      this.database = new SQL.Database(bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.database = new SQL.Database();
      created = true;
    }
    this.ensureSchema();

    const stateRow = rowValue(this.database,
      "SELECT value FROM app_documents WHERE key = 'state'");
    this.state = normalizeState(stateRow ? JSON.parse(String(stateRow.value)) : createSeedState());
    this.state.restaurants = this.loadRestaurants();
    const storedMenuVersions = this.loadMenuVersions();
    if (storedMenuVersions.length > 0) this.state.menuVersions = storedMenuVersions;

    const legacyDummyIds = new Set(this.state.restaurants
      .filter((item) => item.source === 'seed' || item.id.startsWith('demo-r-'))
      .map((item) => item.id));
    if (legacyDummyIds.size > 0) {
      this.state.restaurants = this.state.restaurants.filter((item) => !legacyDummyIds.has(item.id));
      this.state.sessions = this.state.sessions.filter((item) => !legacyDummyIds.has(item.selectedRestaurantId));
      this.state.menuVersions = this.state.menuVersions.filter((item) => !legacyDummyIds.has(item.restaurantId));
      this.state.reviews = this.state.reviews.filter((item) => !legacyDummyIds.has(item.restaurantId));
      this.state.processedRequests = this.state.processedRequests.filter((item) => {
        const serialized = JSON.stringify(item);
        return !Array.from(legacyDummyIds).some((id) => serialized.includes(id));
      });
      created = true;
    }
    if (this.state.restaurants.length === 0 && this.initialRestaurants.length > 0) {
      this.state.restaurants = structuredClone(this.initialRestaurants);
      created = true;
    }
    if (created || !stateRow) await this.persist();
    return this;
  }

  ensureSchema() {
    this.database.run('PRAGMA foreign_keys = ON');
    this.database.run(`
      CREATE TABLE IF NOT EXISTS app_documents (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        external_poi_id TEXT,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        cuisines TEXT NOT NULL,
        tags TEXT NOT NULL,
        average_price REAL NOT NULL,
        rating REAL NOT NULL,
        is_open INTEGER NOT NULL,
        open_status_known INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_restaurants_name ON restaurants(name);
      CREATE INDEX IF NOT EXISTS idx_restaurants_source ON restaurants(source);
      CREATE TABLE IF NOT EXISTS menu_items (
        restaurant_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        ingredients TEXT NOT NULL,
        tags TEXT NOT NULL,
        confidence REAL NOT NULL,
        PRIMARY KEY (restaurant_id, item_id),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS menu_versions (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        low_confidence_fields TEXT NOT NULL,
        items TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_menu_versions_restaurant ON menu_versions(restaurant_id, created_at);
      CREATE TABLE IF NOT EXISTS external_store_bindings (
        restaurant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_store_id TEXT NOT NULL,
        authorized INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, provider),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      );
    `);
  }

  loadRestaurants() {
    const result = this.database.exec('SELECT id, source, payload FROM restaurants ORDER BY rowid');
    if (result.length === 0) return [];
    return result[0].values.map(([id, source, payload]) => {
      const restaurant = JSON.parse(String(payload));
      const menuResult = this.database.exec(
        `SELECT item_id, name, category, price, ingredients, tags, confidence
         FROM menu_items WHERE restaurant_id = ? ORDER BY rowid`, [id]);
      const menu = menuResult.length === 0 ? [] : menuResult[0].values.map((row) => ({
        id: String(row[0]), name: String(row[1]), category: String(row[2]), price: Number(row[3]),
        ingredients: JSON.parse(String(row[4])), tags: JSON.parse(String(row[5])), confidence: Number(row[6])
      }));
      return { ...restaurant, source: restaurant.source ?? String(source), menu };
    });
  }

  loadMenuVersions() {
    const result = this.database.exec(`
      SELECT id, restaurant_id, session_id, source, status, low_confidence_fields,
             items, created_at, confirmed_at
      FROM menu_versions ORDER BY created_at
    `);
    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
      id: String(row[0]), restaurantId: String(row[1]), sessionId: String(row[2]),
      source: String(row[3]), status: String(row[4]),
      lowConfidenceFields: JSON.parse(String(row[5])), items: JSON.parse(String(row[6])),
      createdAt: String(row[7]), confirmedAt: row[8] ? String(row[8]) : ''
    }));
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async read(fn) {
    return fn(this.snapshot());
  }

  async listRestaurants() {
    return structuredClone(this.state.restaurants);
  }

  async queryRestaurants(params = {}) {
    const query = String(params.query ?? '').trim();
    const cuisine = String(params.cuisine ?? '').trim();
    const taste = String(params.taste ?? '').trim();
    const onlyOpen = params.openNow === true || params.openNow === 'true';
    const maxPrice = params.maxPrice === undefined || params.maxPrice === '' ? null : Number(params.maxPrice);
    const conditions = [];
    const values = [];
    if (query) {
      conditions.push(`(
        name LIKE ? OR address LIKE ? OR cuisines LIKE ? OR tags LIKE ?
        OR EXISTS (
          SELECT 1 FROM menu_items menu_search
          WHERE menu_search.restaurant_id = restaurants.id
            AND (menu_search.name LIKE ? OR menu_search.ingredients LIKE ? OR menu_search.tags LIKE ?)
        )
      )`);
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    if (cuisine) {
      conditions.push('cuisines LIKE ?');
      values.push(`%${cuisine}%`);
    }
    if (taste) {
      conditions.push('tags LIKE ?');
      values.push(`%${taste}%`);
    }
    if (onlyOpen) conditions.push('(open_status_known = 0 OR is_open = 1)');
    if (Number.isFinite(maxPrice)) {
      conditions.push('(average_price = 0 OR average_price <= ?)');
      values.push(maxPrice);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = this.database.exec(`SELECT id FROM restaurants ${where} ORDER BY rating DESC, name LIMIT 200`, values);
    if (result.length === 0) return [];
    const ids = new Set(result[0].values.map((row) => String(row[0])));
    return structuredClone(this.state.restaurants.filter((item) => ids.has(item.id)));
  }

  async upsertRestaurants(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) return [];
    return this.transaction((state) => {
      for (const incoming of restaurants) {
        const index = state.restaurants.findIndex((item) => item.id === incoming.id);
        const previous = index >= 0 ? state.restaurants[index] : null;
        const merged = {
          ...previous,
          ...incoming,
          menu: incoming.menu?.length ? incoming.menu : previous?.menu ?? []
        };
        if (index >= 0) state.restaurants[index] = merged;
        else state.restaurants.push(merged);
      }
      return restaurants.map((item) => state.restaurants.find((saved) => saved.id === item.id));
    });
  }

  async transaction(fn) {
    const run = async () => {
      const result = await fn(this.state);
      await this.persist();
      return structuredClone(result);
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return this.writeQueue;
  }

  async persist() {
    const database = this.database;
    database.run('BEGIN TRANSACTION');
    try {
      const restaurantIds = this.state.restaurants.map((item) => item.id);
      if (restaurantIds.length > 0) {
        database.run(`DELETE FROM restaurants WHERE id NOT IN (${restaurantIds.map(() => '?').join(',')})`, restaurantIds);
      } else {
        database.run('DELETE FROM restaurants');
      }
      for (const restaurant of this.state.restaurants) {
        const document = restaurantDocument(restaurant);
        database.run(
          `INSERT INTO restaurants
           (id, external_poi_id, source, name, address, cuisines, tags, average_price, rating,
            is_open, open_status_known, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             external_poi_id = excluded.external_poi_id,
             source = excluded.source,
             name = excluded.name,
             address = excluded.address,
             cuisines = excluded.cuisines,
             tags = excluded.tags,
             average_price = excluded.average_price,
             rating = excluded.rating,
             is_open = excluded.is_open,
             open_status_known = excluded.open_status_known,
             updated_at = excluded.updated_at,
             payload = excluded.payload`,
          [restaurant.id, restaurant.externalPoiId ?? '', restaurant.source ?? 'seed', restaurant.name,
            restaurant.address, JSON.stringify(restaurant.cuisines ?? []), JSON.stringify(restaurant.tags ?? []),
            Number(restaurant.averagePrice) || 0, Number(restaurant.rating) || 0, restaurant.isOpen ? 1 : 0,
            restaurant.openStatusKnown === false ? 0 : 1,
            restaurant.dataUpdatedAt ?? new Date().toISOString(), JSON.stringify(document)]
        );
        database.run('DELETE FROM menu_items WHERE restaurant_id = ?', [restaurant.id]);
        for (const item of restaurant.menu ?? []) {
          database.run(
            `INSERT INTO menu_items
             (restaurant_id, item_id, name, category, price, ingredients, tags, confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [restaurant.id, item.id, item.name, item.category ?? '待分类', Number(item.price) || 0,
              JSON.stringify(item.ingredients ?? []), JSON.stringify(item.tags ?? []), Number(item.confidence) || 0]
          );
        }
      }
      database.run('DELETE FROM menu_versions');
      for (const version of this.state.menuVersions ?? []) {
        database.run(
          `INSERT INTO menu_versions
           (id, restaurant_id, session_id, source, status, low_confidence_fields, items, created_at, confirmed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [version.id, version.restaurantId, version.sessionId, version.source, version.status,
            JSON.stringify(version.lowConfidenceFields ?? []), JSON.stringify(version.items ?? []),
            version.createdAt, version.confirmedAt || null]
        );
      }
      const { restaurants: _restaurants, ...stateDocument } = this.state;
      database.run(
        `INSERT INTO app_documents(key, value, updated_at) VALUES ('state', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [JSON.stringify(stateDocument), new Date().toISOString()]
      );
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, Buffer.from(database.export()));
    await rename(tempPath, this.filePath);
  }
}
