// Подмена Cloudflare D1 на настоящий SQLite из Node: те же prepare().bind().first()/run()
import { DatabaseSync } from 'node:sqlite';
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let fail = false;
  return {
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async first() { if (fail) throw new Error('D1 down'); const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
        async run() { if (fail) throw new Error('D1 down'); const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { if (fail) throw new Error('D1 down'); return { results: db.prepare(sql).all(...args).map((x) => ({ ...x })) }; },
      };
      return st;
    },
    _db: db,
    _fail(v) { fail = v; },
  };
}
