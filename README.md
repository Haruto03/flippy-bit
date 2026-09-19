# Flippy Bit

A browser game written in TypeScript with RxJS, built in a purely functional
reactive style. Binary numbers fall from the top of the canvas; flip the bits
of an 8-digit row at the bottom so that its value matches the lowest target
before it reaches the dead line.

Built for FIT2102 (Programming Paradigms) at Monash University, Semester 2 2026.

## How to play

| Input | Action |
|---|---|
| `1` – `8` | Flip the corresponding bit (leftmost is the most significant) |
| Click a digit box | Flip that bit |
| `P` | Pause / resume |
| `R` | Restart (during play or after game over) |

Click anywhere on the page to start. A target is judged the moment its bottom
edge touches the dead line: a match scores a point and removes the target, a
mismatch ends the game. Targets fall faster the longer you survive.

## Running locally

Requires Node.js.

```bash
npm install
npm run dev      # serve on localhost, ctrl-click the URL in the console
npm test         # vitest
npm run build    # type-check and bundle
```

## Design

The whole game lives in [`src/main.ts`](src/main.ts) and follows a
Model–View–Update architecture on top of RxJS.

- **State is immutable.** `State` and `Target` are `Readonly` types; every
  update produces a new object with spread syntax.
- **Every input is an `Action`.** The 20 ms clock (`Tick`), keyboard and mouse
  bit flips (`FlipBit`), `Pause` and `Restart` all implement one interface
  with an `apply(s: State): State` method. Keyboard and mouse produce the
  *same* `FlipBit` action, so the model cannot tell the two inputs apart.
- **One fold drives everything.** The input observables are `merge`d into a
  single stream of actions and reduced with `scan(reduceState, initialState)`.
  Because actions are applied sequentially, there is no concurrent
  modification and adding a new kind of input never touches the reducer.
- **Randomness is pure.** Target values and spawn gaps come from a seeded
  linear congruential generator whose seed is carried in the state, so `tick`
  is a pure function and a whole run can be reproduced from a single seed.
- **Derived values are not stored.** The numeric value of the digit row and
  the current fall speed are computed from the state where needed, so they
  can never disagree with it.
- **Side effects are confined to the view.** `render` is the only place that
  touches the DOM; it is a plain projection of state onto SVG. Targets that
  leave the canvas are reported through an `exit` list so the view can remove
  their elements.
- **The stream never completes.** On game over or pause, `Tick` holds the
  state still instead of unsubscribing, which is what lets restart and resume
  be ordinary actions rather than special cases.

## Project layout

```
src/main.ts        game logic, actions, input streams and rendering
src/style.css      stylesheet
index.html         SVG canvas scaffold
test/main.test.ts  vitest tests
```

The build configuration and the SVG scaffold were provided as a course
skeleton; the game logic, actions, input handling and rendering are my own.
