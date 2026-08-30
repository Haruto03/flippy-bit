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
    gameEnd: boolean;
    bits: ReadonlyArray<boolean>;
    targets: ReadonlyArray<Target>;
    exit: ReadonlyArray<Target>;
    objCount: number;
    score: number;
}>;

const initialState: State = {
    gameEnd: false,
    bits: Array.from({ length: Constants.DIGIT_COUNT }, () => false),
    // TEMPORARY: a fixed target to verify rendering before spawning exists.
    targets: [
        {
            id: "target0",
            value: 0x13,
            x: Viewport.CANVAS_WIDTH / 2 - TargetView.WIDTH / 2,
            y: 50,
        },
    ],
    exit: [],
    objCount: 1,
    score: 0,
};

/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */
const tick = (s: State) => s;

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
 * Delegates to `tick` so that the falling/collision logic stays in one
 * named function rather than inside a class.
 */
class Tick implements Action {
    apply = (s: State): State => tick(s);
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
