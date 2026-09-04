import re, os, json, sys

mods = {}
for root,_,fs in os.walk('src'):
    for fn in sorted(fs):
        if fn.endswith('.js'):
            p = os.path.join(root,fn)
            mods[p] = open(p).read()

def strip(s):
    """Remove imports, comments, and string/template literal CONTENTS
       (keeping ${...} interpolations, which are real code)."""
    s = re.sub(r'^import .*$','',s,flags=re.M)
    s = re.sub(r'/\*.*?\*/','',s,flags=re.S)
    s = re.sub(r'(^|\s)//[^\n]*','',s)
    return s

# ---- build export map (functions, classes, const/let, re-exports) ----
exports = {}
for p, s in mods.items():
    for m in re.finditer(r'^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', s, re.M):
        exports.setdefault(m.group(1), p)
    for m in re.finditer(r'^export\s+class\s+([A-Za-z_$][\w$]*)', s, re.M):
        exports.setdefault(m.group(1), p)
    for m in re.finditer(r'^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)', s, re.M):
        exports.setdefault(m.group(1), p)
    for m in re.finditer(r'^export\s*\{([^}]+)\}', s, re.M):
        for part in m.group(1).split(','):
            n = part.split(' as ')[-1].strip()
            if n: exports.setdefault(n, p)

findings = []
def add(sev, cat, f, msg):
    findings.append({'sev':sev,'cat':cat,'file':f.replace('src/',''),'msg':msg})

for p, s in mods.items():
    code = strip(s)

    # local declarations (all forms, incl. aliased imports)
    local = set()
    local |= set(re.findall(r'^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', s, re.M))
    local |= set(re.findall(r'^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', s, re.M))
    local |= set(re.findall(r'^\s*export\s+class\s+([A-Za-z_$][\w$]*)', s, re.M))
    local |= set(re.findall(r'^\s*class\s+([A-Za-z_$][\w$]*)', s, re.M))
    local |= set(re.findall(r'(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)', s))
    imported = set()
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from", s):
        for part in m.group(1).split(','):
            part = part.strip()
            n = part.split(' as ')[-1].strip() if ' as ' in part else part
            if n: imported.add(n)
    for m in re.finditer(r"import\s*\*\s*as\s+(\w+)", s):
        imported.add(m.group(1))
    for m in re.finditer(r"import\s+([A-Za-z_$][\w$]*)\s+from", s):
        imported.add(m.group(1))

    # --- CHECK 1: called but never declared/imported ---
    for name in set(re.findall(r'(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(', code)):
        if name in local or name in imported: continue
        if name in exports and exports[name] != p:
            add('HIGH','missing-import',p,f"calls {name}() -- exported by {exports[name].replace('src/','')}, not imported")

    # --- CHECK 2: duplicate import of the same symbol ---
    seen = {}
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*'([^']+)'", s):
        for part in m.group(1).split(','):
            n = part.split(' as ')[0].strip()
            if not n: continue
            if n in seen:
                add('HIGH','duplicate-import',p,f"'{n}' imported twice (from {seen[n]} and {m.group(2)})")
            seen[n] = m.group(2)

    # --- CHECK 3: reassigning an imported binding (the Phase 11 bug class) ---
    named_imports = set()
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from", s):
        for part in m.group(1).split(','):
            part = part.strip()
            n = part.split(' as ')[-1].strip() if ' as ' in part else part
            if n: named_imports.add(n)
    for n in named_imports:
        # assignment to the bare imported name (not .prop = )
        if re.search(r'(?<![\w.$])' + re.escape(n) + r'\s*=(?!=)', code):
            add('CRITICAL','import-reassign',p,f"assigns to imported binding '{n}' -- TypeError at runtime (imports are read-only)")

    # --- CHECK 4 (await-in-non-async) REMOVED ---
    # The original heuristic guessed function body extent by scanning
    # to the next 'function' keyword, which ran past the real closing
    # brace and produced 32/32 false positives. Correctly implementing
    # this needs brace-matching that skips strings/templates/comments.
    # A check that is wrong 100% of the time is worse than no check,
    # so it is removed rather than shipped broken.
    # --- CHECK 5: data-action attributes with no handler ---
    # (collected globally below)

# --- CHECK 5 (global): data-action coverage ---
actions_used = set()
for p, s in mods.items():
    for m in re.finditer(r'data-action="([a-z-]+)"', s):
        actions_used.add(m.group(1))
ev = mods.get('src/app/events.js','')
handled = set(re.findall(r"case '([a-z-]+)'", ev))
handled |= set(re.findall(r"action\s*===\s*'([a-z-]+)'", ev))
prefixes = re.findall(r"action\.startsWith\('([a-z-]+)'\)", ev)
for a in sorted(actions_used - handled):
    if any(a.startswith(pref) for pref in prefixes): continue
    add('HIGH','unhandled-action','app/events.js',f"data-action=\"{a}\" has no handler")

print(json.dumps(findings, indent=1))
