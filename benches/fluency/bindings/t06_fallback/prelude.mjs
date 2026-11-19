import { execFile } from 'node:child_process';
class ToolError extends Error { constructor(code, message) { super(message); this.name = 'ToolError'; this.code = code; } }
const call = (name, args) => new Promise((res, rej) => execFile("python3", ['-I', '-S', "benches/fluency/toolhost.py", 'envelope', name, JSON.stringify(args.map(a => a === undefined ? null : a))], (err, out) => {
  if (err && !out) return rej(err); const e = JSON.parse(out); e.ok ? res(e.value) : rej(new ToolError(e.error.code, e.error.message)); }));
globalThis.ToolError = ToolError;
globalThis.tools = {
  list_user_ids: (...a) => call('list_user_ids', a),
  get_profile: (...a) => call('get_profile', a),
  get_legacy_profile: (...a) => call('get_legacy_profile', a),
};
