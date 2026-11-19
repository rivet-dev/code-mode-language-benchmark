```javascript
const codeOf = (e) =>
  e && typeof e.code === 'string' ? e.code : String(e?.code ?? 'UNKNOWN');

const out = [];
let resolved = 0;
let unresolved = 0;

const ids = await tools.list_user_ids();

for (const id of ids) {
  let line;
  try {
    const p = await tools.get_profile(id);
    line = `${id} | ${p.display_name} | ${p.email} | primary`;
    resolved++;
  } catch (e1) {
    if (codeOf(e1) !== 'NOT_FOUND') {
      unresolved++;
      line = `${id} | unresolved | ${codeOf(e1)}`;
    } else {
      try {
        const l = await tools.get_legacy_profile(id);
        const email = l.mail === null || l.mail === undefined ? '-' : l.mail;
        line = `${id} | ${l.name.first} ${l.name.last} | ${email} | legacy`;
        resolved++;
      } catch (e2) {
        unresolved++;
        line = `${id} | unresolved | ${codeOf(e2)}`;
      }
    }
  }
  out.push(line);
}

out.push(`resolved=${resolved} unresolved=${unresolved}`);
console.log(out.join('\n'));
```
