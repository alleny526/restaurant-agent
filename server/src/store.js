import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSeedState } from './seed-data.js';

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createSeedState();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async read(fn) {
    return fn(this.snapshot());
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
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

