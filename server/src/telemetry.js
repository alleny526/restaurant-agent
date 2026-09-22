export class Telemetry {
  constructor(limit = 200) {
    this.limit = limit;
    this.events = [];
  }

  record(value) {
    const event = {
      timestamp: new Date().toISOString(),
      action: String(value.action ?? 'unknown').slice(0, 40),
      totalMs: Math.max(0, Number(value.totalMs) || 0),
      amapMs: Math.max(0, Number(value.amapMs) || 0),
      modelMs: Math.max(0, Number(value.modelMs) || 0),
      httpStatus: Math.max(0, Number(value.httpStatus) || 0),
      modelUsed: value.modelUsed === true,
      modelFallback: value.modelFallback === true,
      idempotencyHit: value.idempotencyHit === true,
      ocrSource: String(value.ocrSource ?? '').slice(0, 40)
    };
    this.events.push(event);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
  }

  snapshot() {
    const byAction = {};
    for (const event of this.events) {
      const bucket = byAction[event.action] ?? { count: 0, totalMs: 0, modelMs: 0, amapMs: 0, errors: 0 };
      bucket.count += 1;
      bucket.totalMs += event.totalMs;
      bucket.modelMs += event.modelMs;
      bucket.amapMs += event.amapMs;
      if (event.httpStatus >= 400) bucket.errors += 1;
      byAction[event.action] = bucket;
    }
    const summary = Object.fromEntries(Object.entries(byAction).map(([action, item]) => [action, {
      count: item.count,
      averageTotalMs: Math.round(item.totalMs / item.count),
      averageModelMs: Math.round(item.modelMs / item.count),
      averageAmapMs: Math.round(item.amapMs / item.count),
      errors: item.errors
    }]));
    return { summary, recent: structuredClone(this.events.slice(-50)) };
  }
}
