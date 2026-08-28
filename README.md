# DxL Word Grid

A timed, multiplayer word hunt. Each group gets a room. People join from their own phones or computers and hunt on the same board. Unique finds score more than words several people spotted.

## How to play

1. One person creates a room, then shares the 4-letter code.
2. Everyone else opens the same site, types their name, and joins with that code.
3. The host starts when at least two people are in. Board size and time are set by the host.
4. Drag through connected letters on your own screen. The trail can turn. You cannot reuse a cell.
5. Unique word: **length × length**. Shared word: **1 point per letter**.
6. When time ends, everyone sees the same point breakdown.

Several groups can play at once — each room is separate.

## Run

```bash
npm install
npm start
```

On this computer: [http://localhost:5173](http://localhost:5173)

On phones on the same network: use the `http://…:5173` address printed in the terminal.

## Tests

```bash
npm test
```
