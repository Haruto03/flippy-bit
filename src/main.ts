/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import {
    Observable,
    catchError,
    filter,
    fromEvent,
    interval,
    map,
    merge,
    scan,
    switchMap,
    take,
} from "rxjs";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const TargetView = {
    WIDTH: 64,
    HEIGHT: 36,
} as const;

const Constants = {
    DIGIT_COUNT: 8,
    TICK_RATE_MS: 20, // Might need to change this!
    DEAD_LINE_Y: 300,
    SPAWN_INTERVAL_TICKS: 150,
    TARGET_SPEED: 0.7, // The number of pixels the target moves per tick
} as const;

type Target = Readonly<{
    id: string;
    value: number;
    x: number;
    y: number;
}>;

// State processing
type State = Readonly<{
    time: number;
    gameEnd: boolean;
    bits: ReadonlyArray<boolean>;
    targets: ReadonlyArray<Target>;
    exit: ReadonlyArray<Target>;
    objCount: number;
    score: number;
}>;

const initialState: State = {
    time: 0,
    gameEnd: false,
    bits: Array.from({ length: Constants.DIGIT_COUNT }, () => false),
    targets: [],
    exit: [],
    objCount: 0,
    score: 0,
};

/**
 * Negates a predicate.
 *
 * Lets a single predicate drive both halves of a partition, so the two
 * filters cannot drift out of agreement.
 */
const not = <T>(f: (x: T) => boolean) => (x: T): boolean => !f(x);

/**
 * The value of the digit row read as a binary number, most significant
 * digit first.
 *
 * The state stores digits rather than a value so that flipping one is a
 * simple map; the value is derived only where a comparison needs it, which
 * keeps the two from ever disagreeing.
 */
const bitsValue = (bits: ReadonlyArray<boolean>): number =>
    bits.reduce((acc, b) => acc * 2 + (b ? 1 : 0), 0);

/**
 * Values of the falling targets, in order.
 *
 * The minimum requirements allow a fixed sequence. Keeping the values in
 * one array means switching to random generation later only replaces this
 * definition, not the spawning logic.
 */
const SEQUENCE = [0x13, 0x2a, 0x07, 0xb4, 0x5c, 0x91, 0x6e, 0xf0] as const;

/**
 * Creates a target just above the top edge of the canvas.
 *
 * Starting fully off-screen makes the target slide into view rather than
 * appear abruptly. Horizontal placement happens here so that the state
 * carries real coordinates and the view stays a plain projection of it.
 *
 * @param count Number of targets created so far; supplies a unique id
 * @returns A new target
 */
const createTarget = (count: number): Target => ({
    id: `target${count}`,
    value: SEQUENCE[count % SEQUENCE.length],
    x: Viewport.CANVAS_WIDTH / 2 - TargetView.WIDTH / 2,
    y: -TargetView.HEIGHT,
});

/**
 * Updates the state by proceeding with one time step.
 *
 * Targets fall, and the lowest one is judged when its bottom edge reaches
 * the dead line: a matching digit row resolves it and scores a point, a
 * mismatch ends the game. Targets above the lowest are ignored until it has
 * been dealt with, as the specification requires.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State): State => {
    const moved = s.targets.map(t => ({
        ...t,
        y: t.y + Constants.TARGET_SPEED,
    }));

    // The lowest target is the only one in play. Searching by position
    // rather than by array order keeps this correct however targets are
    // added or removed.
    const lowest = moved.reduce<Target | undefined>(
        (lo, t) => (lo === undefined || t.y > lo.y ? t : lo),
        undefined,
    );

    // Judged the moment the bottom edge touches the line, i.e. when the
    // target visually reaches it rather than after passing through.
    const judged =
        lowest !== undefined &&
        lowest.y + TargetView.HEIGHT >= Constants.DEAD_LINE_Y
            ? lowest
            : undefined;

    const correct = judged !== undefined && bitsValue(s.bits) === judged.value;
    const resolvedId = correct ? judged?.id : undefined;

    // Two ways to leave the canvas: matched at the line, or fallen past the
    // bottom. Both must be reported so the view can remove their elements.
    const leaving = (t: Target): boolean =>
        t.id === resolvedId || t.y > Viewport.CANVAS_HEIGHT;

    const spawning = s.time % Constants.SPAWN_INTERVAL_TICKS === 0;
    const remaining = moved.filter(not(leaving));

    return {
        ...s,
        time: s.time + 1,
        targets: spawning
            ? remaining.concat(createTarget(s.objCount))
            : remaining,
        objCount: spawning ? s.objCount + 1 : s.objCount,
        exit: moved.filter(leaving),
        score: correct ? s.score + 1 : s.score,
        gameEnd: judged !== undefined && !correct,
    };
};

/**
 * An action transforms one state into the next.
 *
 * Every input to the game — the clock, the keyboard, and later the mouse —
 * is expressed as an Action. Giving them a common type is what allows them
 * to be merged into a single stream, and it keeps the state transition
 * function free of any branching on the kind of input.
 */
interface Action {
    apply(s: State): State;
}

/**
 * Advances the simulation by one time step.
 *
 * The clock keeps running after a game over and the state is simply held
 * still, rather than unsubscribing: the stream must stay alive so that a
 * restart can be added without re-subscribing the whole game.
 */
class Tick implements Action {
    apply = (s: State): State => (s.gameEnd ? s : tick(s));
}

/**
 * Flips a single digit of the player's row.
 *
 * The index is carried by the action rather than read from the state, so
 * that keyboard and mouse input can produce the same action type.
 */
class FlipBit implements Action {
    constructor(public readonly index: number) {}

    apply = (s: State): State => ({
        ...s,
        bits: s.bits.map((b, i) => (i === this.index ? !b : b)),
    });
}

/**
 * Applies an action to the state; used as the accumulator of `scan`.
 *
 * Subtype polymorphism means this needs no branching: adding a new kind of
 * action never requires changing this function.
 */
const reduceState = (s: State, action: Action): State => action.apply(s);

// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * Builds the SVG for one target: a rounded box showing its value in hex.
 *
 * The children are positioned relative to the group's origin, so moving a
 * target only requires updating the group's transform, and removing it
 * only requires removing the group.
 *
 * @param svg The canvas to append to
 * @param t The target to build a view for
 * @returns The group element representing the target
 */
const createTargetView = (svg: SVGSVGElement, t: Target): SVGElement => {
    const g = createSvgElement(svg.namespaceURI, "g", { id: t.id });
    const box = createSvgElement(svg.namespaceURI, "rect", {
        x: "0",
        y: "0",
        width: `${TargetView.WIDTH}`,
        height: `${TargetView.HEIGHT}`,
        rx: "6",
        fill: "white",
        stroke: "black",
        "stroke-width": "2",
    });
    const label = createSvgElement(svg.namespaceURI, "text", {
        x: `${TargetView.WIDTH / 2}`,
        y: `${TargetView.HEIGHT / 2 + 6}`,
        "text-anchor": "middle",
        "font-family": "monospace",
        fill: "black",
    });
    // The value is stored as a number; base 16 is a display concern only.
    label.textContent = t.value.toString(16).toUpperCase();
    g.appendChild(box);
    g.appendChild(label);
    svg.appendChild(g);
    return g;
};

const render = (): ((s: State) => void) => {
    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );

    // Created once here rather than in the per-frame function below,
    // since it never changes with the state.
    const deadLine = createSvgElement(svg.namespaceURI, "line", {
        x1: "0",
        y1: `${Constants.DEAD_LINE_Y}`,
        x2: `${Viewport.CANVAS_WIDTH}`,
        y2: `${Constants.DEAD_LINE_Y}`,
        stroke: "red",
        "stroke-width": "2",
        "stroke-dasharray": "8 4", //draw 8 pix and leave 4 pix space
    });
    svg.appendChild(deadLine);

    /**
     * The player's digit row.
     *
     * The number of digits never changes, so the elements are built once
     * here and only their text and colour are updated per frame. Building
     * them inside the render function would append a new row on every tick.
     */
    const digitWidth = Viewport.CANVAS_WIDTH / Constants.DIGIT_COUNT;
    const bitViews = Array.from({ length: Constants.DIGIT_COUNT }, (_, i) => {
        const rect = createSvgElement(svg.namespaceURI, "rect", {
            x: `${i * digitWidth + 4}`,
            y: `${Viewport.CANVAS_HEIGHT - 50}`,
            width: `${digitWidth - 8}`,
            height: "40",
            stroke: "black",
            "stroke-width": "2",
        });
        const text = createSvgElement(svg.namespaceURI, "text", {
            x: `${i * digitWidth + digitWidth / 2}`,
            y: `${Viewport.CANVAS_HEIGHT - 22}`,
            "text-anchor": "middle",
            "font-family": "monospace",
            fill: "black",
        });
        svg.appendChild(rect);
        svg.appendChild(text);
        return { rect, text };
    });
    const scoreText = document.querySelector("#scoreText") as HTMLElement;
    const gameOverView = document.querySelector("#gameOver") as SVGElement;


    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {
        bitViews.forEach(({ rect, text }, i) => {
            rect.setAttribute("fill", s.bits[i] ? "#a5d6a7" : "#ef9a9a");
            text.textContent = s.bits[i] ? "1" : "0";
        });

        // Targets appear and disappear at runtime, so each one is looked up
        // by the id carried in the state, and built on first sight.
        s.targets.forEach(t => {
            const view: Element =
                document.getElementById(t.id) ?? createTargetView(svg, t);
            view.setAttribute("transform", `translate(${t.x}, ${t.y})`);
        });

        // Nothing else can know what disappeared: the render function only
        // ever sees the current state, so the model reports removals here.
        s.exit.forEach(t => {
            const view = document.getElementById(t.id);
            if (view) svg.removeChild(view);
        });
                scoreText.textContent = String(s.score);

        // Both branches are needed: the view must be able to return to the
        // playing state once a restart is added.
        if (s.gameEnd) {
            show(gameOverView);
        } else {
            hide(gameOverView);
        }
    };
};

/**
 * Key codes of the digit row, left to right.
 *
 * Derived from DIGIT_COUNT so that the row and its controls cannot drift
 * apart, and so that the key layout is defined in exactly one place.
 */
const DIGIT_KEYS = Array.from(
    { length: Constants.DIGIT_COUNT },
    (_, i) => `Digit${i + 1}`,
);

/**
 * Stream of bit flips driven by the keyboard.
 *
 * A single keydown stream is mapped to a digit index rather than creating
 * one stream per key: the eight keys are the same action with a different
 * argument, and this registers one DOM listener instead of eight.
 */
const flipBitKeyboard$ = (): Observable<FlipBit> =>
    fromEvent<KeyboardEvent>(document, "keydown").pipe(
        // Auto-repeat would flip a digit many times while a key is held.
        filter(e => !e.repeat),
        // `code` is the physical key, unaffected by modifiers or layout.
        map(e => DIGIT_KEYS.indexOf(e.code)),
        // indexOf returns -1 for keys that are not part of the digit row.
        filter(i => i >= 0),
        map(i => new FlipBit(i)),
    );

export const state$ = (): Observable<State> => {
    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(map(() => new Tick()));

    // All inputs are merged into one stream of actions so that the state is
    // updated by a single, sequential fold — no concurrent modification.
    return merge(tick$, flipBitKeyboard$()).pipe(
        scan(reduceState, initialState),
    );
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    // Observable: wait for first user click
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    click$.pipe(switchMap(() => state$())).subscribe(render());
}
