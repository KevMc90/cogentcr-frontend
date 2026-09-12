# Known gaps

Things that are true about this repo and are easy to rediscover the hard way.
Recorded deliberately; not scheduled for fixing.

---

## The CI lint gate is not armed

**Status:** known and deliberately left alone (2026-09-12).

`package.json` has **no `eslintConfig` key**. Create React App's webpack config
therefore builds its ESLint plugin with only:

```js
baseConfig: { extends: [require.resolve('eslint-config-react-app/base')] }
```

`eslint-config-react-app/base` sets the parser, the environment, and exactly
**two rules**:

```js
rules: {
  'react/jsx-uses-vars': 'warn',
  'react/jsx-uses-react': 'warn',
}
```

That is the entire enforced rule set. In particular these are **not** enforced:

- `no-unused-vars`
- `react-hooks/rules-of-hooks`
- `react-hooks/exhaustive-deps`
- `no-undef`, `import/*`, and everything else in the full `react-app` config

**Verified, not assumed.** Appending a deliberately unused
`const __aio_lint_probe = 1;` to `src/App.js` and running
`DISABLE_ESLINT_PLUGIN=false CI=true npx react-scripts build` still exited 0.

### What this means

A green `npm run build` proves the file **parses**. It does not prove there are
no unused variables, and — the one that can actually cost you a production
bug — it does not prove hooks are called unconditionally and in a stable order.
A hooks-order violation will build clean and fail at runtime.

Because of this, `src/App.aionly.test.js` is the real safety net for the demo
form: it mounts the component and drives it against a recorded API response.
Run it with `CI=true npx react-scripts test`.

### This also explains the earlier Vercel build failure

A build that passes locally but fails on Vercel with an ESLint complaint about a
**rule name** is this same gap seen from the other side. When a file carries a
disable comment for a rule that is not loaded —

```js
// eslint-disable-next-line react-hooks/exhaustive-deps
```

— ESLint does not ignore the comment. It raises
`Definition for rule 'react-hooks/exhaustive-deps' was not found`, which is an
**error**, not a warning, so `CI=true` fails the build. The disable comment was
written for a rule set that is not actually loaded here.

Two consequences worth remembering:

- A disable comment in this repo is not harmless. If it names a rule outside
  the two above, it is a build error waiting to happen.
- Local builds hide it, because `.env` (gitignored, so it never reaches Vercel)
  contains `DISABLE_ESLINT_PLUGIN=true`. To reproduce what Vercel does, run
  `DISABLE_ESLINT_PLUGIN=false CI=true npx react-scripts build`.

### Why it is not being fixed

Adding `"eslintConfig": { "extends": "react-app" }` to `package.json` would arm
the full rule set across ~8,500 lines of `src/App.js` and surface every latent
warning at once. Under `CI=true` every one of those becomes a build failure.
That is a triage project, not a side effect of another change. Left as a gap on
purpose.

---

## The demo branch does not persist runs

`demo-ur-only` posts to `POST /v1/aionly/evaluate`, which writes nothing to the
database — unlike `/api/generate-review`, which inserts into `reviews`. The
session log on the demo page is in-memory only and is lost on reload; export it
to CSV before closing the tab if the runs matter.
