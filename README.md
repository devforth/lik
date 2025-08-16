# lik

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

## End-to-end encryption (E2EE)

Scoreboards use a symmetric AES-GCM secret for encrypting join requests, board metadata (PRE lik::brd::<id>), and CRDT snapshots.

- Secret derivation: sha512Hex(`${ownerPrivHex}::${boardId}`), stored only locally in IndexedDB with the scoreboard object. It is never published to Nostr.
- Invite/share code format: `lik::<scoreboard_id>::<secret>` (shown in the Invite drawer and QR). Share this code with participants.
- Join flow: the app expects the code above; join requests are encrypted with the secret and ignored by the owner if decryption fails.
- Recovery: CRDT PRE bodies are encrypted; recovery decrypts with the provided secret.
- Board metadata PRE (`lik::brd::<id>`) is also encrypted with the same secret; only the d-tag reveals the board id.

