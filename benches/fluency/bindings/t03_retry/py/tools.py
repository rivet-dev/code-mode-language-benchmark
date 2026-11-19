import json as _j, subprocess as _s
class ToolError(Exception):
    def __init__(self, code, message):
        super().__init__(f'{code}: {message}'); self.code = code; self.message = message
def _call(name, args):
    p = _s.run(['python3', '-I', '-S', 'benches/fluency/toolhost.py', 'envelope', name, _j.dumps(args)], capture_output=True, text=True)
    e = _j.loads(p.stdout)
    if e['ok']: return e['value']
    raise ToolError(e['error']['code'], e['error']['message'])

def fetch_metric(name):
    return _call('fetch_metric', [name])
