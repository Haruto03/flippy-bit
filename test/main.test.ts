import { assert, describe, expect, it } from "vitest";
import {
    Constants,
    FlipBit,
    Pause,
    RNG,
    Restart,
    type State,
    type Target,
    TargetView,
    Tick,
    Viewport,
    bitsValue,
    createTarget,
    currentSpeed,
    initialState,
    levelFor,
    randomInRange,
    soundEvents,
    state$,
    tick,
} from "../src/main";

/** A state mid-game with no spawn due, so tests control every target. */
const playing = (overrides: Partial<State> = {}): State => ({
    ...initialState,
    nextSpawnTime: Number.POSITIVE_INFINITY,
    ...overrides,
});

/** A target whose bottom edge already touches the dead line. */
const atLine = (id: string, value: number): Target => ({
    id,
    value,
    x: 0,
    y: Constants.DEAD_LINE_Y - TargetView.HEIGHT,
});

/** Digits for a value, most significant first. */
const bitsFor = (value: number): ReadonlyArray<boolean> =>
    Array.from(
        { length: Constants.DIGIT_COUNT },
        (_, i) => ((value >> (Constants.DIGIT_COUNT - 1 - i)) & 1) === 1,
    );

/** Applies `tick` n times. */
const run = (s: State, n: number): State =>
    Array.from({ length: n }).reduce<State>(acc => tick(acc), s);

describe("state$", () => {
    it("is a function", () => {
        assert.isFunction(state$);
    });
});

describe("bitsValue", () => {
    it("reads the digits as binary, most significant first", () => {
        expect(bitsValue(bitsFor(0))).toBe(0);
        expect(bitsValue(bitsFor(0x2b))).toBe(43);
        expect(bitsValue(bitsFor(255))).toBe(255);
        expect(
            bitsValue([true, false, false, false, false, false, false, false]),
        ).toBe(128);
        expect(
            bitsValue([false, false, false, false, false, false, false, true]),
        ).toBe(1);
    });
});

describe("currentSpeed", () => {
    it("starts at the base speed", () => {
        expect(currentSpeed(initialState)).toBe(Constants.BASE_SPEED);
    });

    it("grows with time survived", () => {
        expect(currentSpeed(playing({ time: 1000 }))).toBeGreaterThan(
            Constants.BASE_SPEED,
        );
    });

    it("never exceeds the cap", () => {
        expect(currentSpeed(playing({ time: 10_000_000 }))).toBe(
            Constants.MAX_SPEED,
        );
    });
});

describe("RNG", () => {
    it("is deterministic", () => {
        expect(RNG.hash(42)).toBe(RNG.hash(42));
    });

    it("keeps randomInRange within bounds and whole", () => {
        const seeds = Array.from({ length: 1000 }).reduce<number[]>(
            acc => acc.concat(RNG.hash(acc[acc.length - 1])),
            [Constants.SEED],
        );
        seeds.forEach(seed => {
            const n = randomInRange(seed, 50, 150);
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(50);
            expect(n).toBeLessThanOrEqual(150);
        });
    });
});

describe("createTarget", () => {
    const columnWidth = Viewport.CANVAS_WIDTH / Constants.DIGIT_COUNT;

    it("starts fully above the canvas, centred over its column", () => {
        const t = createTarget(3, 99, 2);
        expect(t).toMatchObject({ id: "target3", value: 99 });
        expect(t.y + TargetView.HEIGHT).toBeLessThanOrEqual(0);
        expect(t.x + TargetView.WIDTH / 2).toBe(2.5 * columnWidth);
    });

    it("stays inside the canvas in the outermost columns", () => {
        expect(createTarget(0, 0, 0).x).toBeGreaterThanOrEqual(0);
        const right = createTarget(0, 0, Constants.DIGIT_COUNT - 1);
        expect(right.x + TargetView.WIDTH).toBeLessThanOrEqual(
            Viewport.CANVAS_WIDTH,
        );
    });
});

describe("levels", () => {
    it("go up every POINTS_PER_LEVEL points", () => {
        expect(levelFor(0)).toBe(1);
        expect(levelFor(Constants.POINTS_PER_LEVEL - 1)).toBe(1);
        expect(levelFor(Constants.POINTS_PER_LEVEL)).toBe(2);
        expect(levelFor(Constants.POINTS_PER_LEVEL * 3)).toBe(4);
    });

    it("make targets fall faster", () => {
        expect(
            currentSpeed(playing({ score: Constants.POINTS_PER_LEVEL })),
        ).toBeGreaterThan(currentSpeed(playing({ score: 0 })));
    });

    it("record when a level is reached, for the banner", () => {
        const almost = playing({
            time: 40,
            score: Constants.POINTS_PER_LEVEL - 1,
            bits: bitsFor(9),
            targets: [atLine("a", 9)],
        });
        expect(tick(almost).levelUpTime).toBe(40);

        const noLevel = playing({
            bits: bitsFor(9),
            targets: [atLine("a", 9)],
        });
        expect(tick(noLevel).levelUpTime).toBeNull();
    });
});

describe("soundEvents", () => {
    it("plays a sound for a point", () => {
        expect(soundEvents(playing(), playing({ score: 1 }))).toEqual([
            "score",
        ]);
    });

    it("plays the level-up sound instead of the point sound", () => {
        const before = playing({ score: Constants.POINTS_PER_LEVEL - 1 });
        const after = playing({ score: Constants.POINTS_PER_LEVEL });
        expect(soundEvents(before, after)).toEqual(["levelUp"]);
    });

    it("plays a sound once when the game ends", () => {
        const over = playing({ gameEnd: true });
        expect(soundEvents(playing(), over)).toEqual(["gameOver"]);
        expect(soundEvents(over, over)).toEqual([]);
    });

    it("stays silent on restart and ordinary ticks", () => {
        const midGame = playing({ score: 7 });
        expect(soundEvents(midGame, new Restart().apply(midGame))).toEqual([]);
        expect(soundEvents(initialState, tick(initialState))).toEqual([]);
    });
});

describe("tick", () => {
    it("advances time and moves targets down by the current speed", () => {
        const s = playing({ targets: [{ id: "a", value: 1, x: 0, y: 10 }] });
        const next = tick(s);
        expect(next.time).toBe(s.time + 1);
        expect(next.targets[0].y).toBe(10 + currentSpeed(s));
    });

    it("spawns a target when the scheduled time arrives", () => {
        const next = tick(initialState);
        expect(next.targets).toHaveLength(1);
        expect(next.objCount).toBe(1);
        expect(next.targets[0].value).toBeGreaterThanOrEqual(0);
        expect(next.targets[0].value).toBeLessThanOrEqual(255);
        expect(next.rngSeed).not.toBe(initialState.rngSeed);

        const gap = next.nextSpawnTime - initialState.time;
        expect(gap).toBeGreaterThanOrEqual(Constants.MIN_SPAWN_TICKS);
        expect(gap).toBeLessThanOrEqual(Constants.MAX_SPAWN_TICKS);
    });

    it("spawns targets in varying columns", () => {
        // Collect every target spawned over a long run, ignoring the dead
        // line so the game can't end first
        const spawnedXs = Array.from({ length: 3000 }).reduce<{
            s: State;
            xs: Set<number>;
        }>(
            ({ s, xs }) => {
                const next = tick({ ...s, targets: [] });
                next.targets.forEach(t => xs.add(t.x));
                return { s: next, xs };
            },
            { s: initialState, xs: new Set() },
        ).xs;
        expect(spawnedXs.size).toBeGreaterThan(3);
    });

    it("does not spawn before the scheduled time", () => {
        const next = tick(playing({ nextSpawnTime: 10 }));
        expect(next.targets).toHaveLength(0);
        expect(next.rngSeed).toBe(initialState.rngSeed);
    });

    it("scores and removes the lowest target when the row matches", () => {
        const target = atLine("a", 0x2b);
        const next = tick(playing({ bits: bitsFor(0x2b), targets: [target] }));
        expect(next.score).toBe(1);
        expect(next.gameEnd).toBe(false);
        expect(next.targets).toHaveLength(0);
        expect(next.exit.map(t => t.id)).toEqual(["a"]);
    });

    it("ends the game when the row does not match", () => {
        const next = tick(
            playing({ bits: bitsFor(1), targets: [atLine("a", 2)] }),
        );
        expect(next.gameEnd).toBe(true);
        expect(next.score).toBe(0);
    });

    it("does not judge a target before it reaches the line", () => {
        const high = { id: "a", value: 7, x: 0, y: 0 };
        const next = tick(playing({ bits: bitsFor(0), targets: [high] }));
        expect(next.gameEnd).toBe(false);
        expect(next.targets).toHaveLength(1);
    });

    it("judges only the lowest target", () => {
        const low = atLine("low", 5);
        const high = { id: "high", value: 200, x: 0, y: 0 };
        // Array order must not matter: the lowest is found by position
        const next = tick(playing({ bits: bitsFor(5), targets: [high, low] }));
        expect(next.score).toBe(1);
        expect(next.gameEnd).toBe(false);
        expect(next.targets.map(t => t.id)).toEqual(["high"]);
    });

    it("does not modify its input", () => {
        const s = playing({ bits: bitsFor(3), targets: [atLine("a", 3)] });
        const snapshot = JSON.stringify(s);
        tick(s);
        expect(JSON.stringify(s)).toBe(snapshot);
    });

    it("reproduces a whole run from the same seed", () => {
        const values = (s: State) => run(s, 500).targets.map(t => t.value);
        expect(values(initialState)).toEqual(values(initialState));
        expect(values(initialState)).not.toEqual(
            values({ ...initialState, rngSeed: 999 }),
        );
    });
});

describe("actions", () => {
    it("Tick advances the game while playing", () => {
        expect(new Tick().apply(initialState).time).toBe(1);
    });

    it("Tick holds the state still while paused or after game over", () => {
        const paused = playing({ paused: true });
        const over = playing({ gameEnd: true });
        expect(new Tick().apply(paused)).toBe(paused);
        expect(new Tick().apply(over)).toBe(over);
    });

    it("Pause toggles, but not after game over", () => {
        const once = new Pause().apply(initialState);
        expect(once.paused).toBe(true);
        expect(new Pause().apply(once).paused).toBe(false);
        expect(new Pause().apply(playing({ gameEnd: true })).paused).toBe(
            false,
        );
    });

    it("FlipBit flips only its own digit, and flipping twice undoes it", () => {
        const flipped = new FlipBit(0).apply(initialState);
        expect(flipped.bits).toEqual([
            true,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
        ]);
        expect(bitsValue(flipped.bits)).toBe(128);
        expect(new FlipBit(0).apply(flipped).bits).toEqual(initialState.bits);
    });

    it("Restart resets everything and hands old targets to exit", () => {
        const midGame = run(initialState, 300);
        const restarted = new Restart().apply({
            ...midGame,
            score: 5,
            gameEnd: true,
        });
        expect(restarted).toEqual({ ...initialState, exit: midGame.targets });
    });
});
