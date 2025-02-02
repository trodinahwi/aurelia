// The commented-out terminal symbols below are for reference / potential future need (should there be use cases to loosen up the syntax)
// These symbols are basically the minimum necessary terminals.
// const viewportTerminal = ['?', '#', '/', '+', ')', '!'];
// const actionTerminal = [...componentTerminal, '@', '('];
// const componentTerminal = [...actionTerminal, '.'];
// const paramTerminal = ['=', ',', ')'];

import { Events, getMessage } from './events';
import { ViewportInstructionTree, ViewportInstruction, Params } from './instructions';
import { type NavigationOptions } from './options';
import { emptyQuery } from './router';
import { mergeURLSearchParams } from './util';

// These are the currently used terminal symbols.
// We're deliberately having every "special" (including the not-in-use '&', ''', '~', ';') as a terminal symbol,
// so as to make the syntax maximally restrictive for consistency and to minimize the risk of us having to introduce breaking changes in the future.
const terminal = ['?', '#', '/', '+', '(', ')', '.', '@', '!', '=', ',', '&', '\'', '~', ';'] as const;

/** @internal */
class ParserState {
  public get _done() {
    return this._rest.length === 0;
  }

  private _rest: string;
  private readonly _buffers: string[] = [];
  private _bufferIndex: number = 0;
  private _index: number = 0;

  public constructor(
    private readonly _input: string,
  ) {
    this._rest = _input;
  }

  public _startsWith(...values: readonly string[]): boolean {
    const rest = this._rest;
    return values.some(function (value) {
      return rest.startsWith(value);
    });
  }

  public _consumeOptional(str: string): boolean {
    if (this._startsWith(str)) {
      this._rest = this._rest.slice(str.length);
      this._index += str.length;
      this._append(str);
      return true;
    }
    return false;
  }

  public _consume(str: string): void {
    if (!this._consumeOptional(str)) {
      this._expect(`'${str}'`);
    }
  }

  public _expect(msg: string): void {
    throw new Error(getMessage(Events.exprUnexpectedSegment, msg, this._index, this._input, this._rest, this._rest));
  }

  public _ensureDone(): void {
    if (!this._done) {
      throw new Error(getMessage(Events.exprNotDone, this._rest, this._index, this._input));
    }
  }

  public _advance(): void {
    const char = this._rest[0];
    this._rest = this._rest.slice(1);
    ++this._index;
    this._append(char);
  }

  public _record(): void {
    this._buffers[this._bufferIndex++] = '';
  }

  public _playback(): string {
    const bufferIndex = --this._bufferIndex;
    const buffers = this._buffers;
    const buffer = buffers[bufferIndex];
    buffers[bufferIndex] = '';
    return buffer;
  }

  public _discard(): void {
    this._buffers[--this._bufferIndex] = '';
  }

  private _append(str: string): void {
    const bufferIndex = this._bufferIndex;
    const buffers = this._buffers;
    for (let i = 0; i < bufferIndex; ++i) {
      buffers[i] += str;
    }
  }
}

export const enum ExpressionKind {
  Route,
  CompositeSegment,
  ScopedSegment,
  SegmentGroup,
  Segment,
  Component,
  Action,
  Viewport,
  ParameterList,
  Parameter,
}

const fragmentRouteExpressionCache = new Map<string, RouteExpression>();
const routeExpressionCache = new Map<string, RouteExpression>();

export type RouteExpressionOrHigher = CompositeSegmentExpressionOrHigher | RouteExpression;
export class RouteExpression {
  public get kind(): ExpressionKind.Route { return ExpressionKind.Route; }

  public constructor(
    public readonly raw: string,
    public readonly isAbsolute: boolean,
    public readonly root: CompositeSegmentExpressionOrHigher,
    public readonly queryParams: Readonly<URLSearchParams>,
    public readonly fragment: string | null,
    public readonly fragmentIsRoute: boolean,
  ) {}

  public static parse(path: string, fragmentIsRoute: boolean): RouteExpression {
    const cache = fragmentIsRoute ? fragmentRouteExpressionCache : routeExpressionCache;
    let result = cache.get(path);
    if (result === void 0) {
      cache.set(path, result = RouteExpression._$parse(path, fragmentIsRoute));
    }
    return result;
  }

  /** @internal */
  private static _$parse(path: string, fragmentIsRoute: boolean): RouteExpression {
    // First strip off the fragment (and if fragment should be used as route, set it as the path)
    let fragment: string | null = null;
    const fragmentStart = path.indexOf('#');
    if (fragmentStart >= 0) {
      const rawFragment = path.slice(fragmentStart + 1);
      fragment = decodeURIComponent(rawFragment);
      if (fragmentIsRoute) {
        path = fragment;
      } else {
        path = path.slice(0, fragmentStart);
      }
    }

    // Strip off and parse the query string using built-in URLSearchParams.
    let queryParams: URLSearchParams | null = null;
    const queryStart = path.indexOf('?');
    if (queryStart >= 0) {
      const queryString = path.slice(queryStart + 1);
      path = path.slice(0, queryStart);
      queryParams = new URLSearchParams(queryString);
    }
    if (path === '') {
      return new RouteExpression(
        '',
        false,
        SegmentExpression.EMPTY,
        queryParams != null ? Object.freeze(queryParams) : emptyQuery,
        fragment,
        fragmentIsRoute,
      );
    }

    /*
     * Now parse the actual route
     *
     * Notes:
     * A NT-Name as per DOM level 2: https://www.w3.org/TR/1998/REC-xml-19980210#NT-Name
     *  [4]  NameChar ::= Letter | Digit | '.' | '-' | '_' | ':' | CombiningChar | Extender
     *  [5]  Name     ::= (Letter | '_' | ':') (NameChar)*
     *
     * As per https://url.spec.whatwg.org/#url-code-points - URL code points (from the ASCII range) are:
     * a-zA-Z0-9!$&'()*+,-./:;=?@_~
     * The other valid option is a % followed by two ASCII hex digits
     * Anything else is invalid.
     */
    const state = new ParserState(path);
    state._record();
    const isAbsolute = state._consumeOptional('/');

    const root = CompositeSegmentExpression._parse(state);
    state._ensureDone();

    const raw = state._playback();
    return new RouteExpression(raw, isAbsolute, root, queryParams !=null ? Object.freeze(queryParams) : emptyQuery, fragment, fragmentIsRoute);
  }

  public toInstructionTree(options: NavigationOptions): ViewportInstructionTree {
    return new ViewportInstructionTree(
      options,
      this.isAbsolute,
      this.root._toInstructions(0, 0),
      mergeURLSearchParams(this.queryParams, options.queryParams, true),
      this.fragment ?? options.fragment,
    );
  }

  public toString(): string {
    return this.raw;
  }
}

export type CompositeSegmentExpressionOrHigher = ScopedSegmentExpressionOrHigher | CompositeSegmentExpression;
export type CompositeSegmentExpressionOrLower = RouteExpression | CompositeSegmentExpression;
/**
 * A single 'traditional' (slash-separated) segment consisting of one or more sibling segments.
 *
 * ### Variations:
 *
 * 1: `a+b`
 * - siblings: [`a`, `b`]
 * - append: `false`
 *
 * 2: `+a`
 * - siblings: [`a`]
 * - append: `true`
 *
 * 3: `+a+a`
 * - siblings: [`a`, `b`]
 * - append: `true`
 *
 * Where
 * - a = `CompositeSegmentExpressionOrHigher` (`SegmentExpression | SegmentGroupExpression | ScopedSegmentExpression | CompositeSegmentExpression`)
 * - b = `CompositeSegmentExpressionOrHigher` (`SegmentExpression | SegmentGroupExpression | ScopedSegmentExpression | CompositeSegmentExpression`)
 */
export class CompositeSegmentExpression {
  public get kind(): ExpressionKind.CompositeSegment { return ExpressionKind.CompositeSegment; }

  public constructor(
    public readonly raw: string,
    public readonly siblings: readonly ScopedSegmentExpressionOrHigher[],
  ) {}

  /** @internal */
  public static _parse(state: ParserState): CompositeSegmentExpressionOrHigher {
    state._record();

    // If a segment starts with '+', e.g. '/+a' / '/+a@vp' / '/a/+b' / '/+a+b' etc, then its siblings
    // are considered to be "append"
    const append = state._consumeOptional('+');
    const siblings = [];
    do {
      siblings.push(ScopedSegmentExpression._parse(state));
    } while (state._consumeOptional('+'));

    if (!append && siblings.length === 1) {
      state._discard();
      return siblings[0];
    }

    const raw = state._playback();
    return new CompositeSegmentExpression(raw, siblings);
  }

  /** @internal */
  public _toInstructions(open: number, close: number): ViewportInstruction[] {
    switch (this.siblings.length) {
      case 0:
        return [];
      case 1:
        return this.siblings[0]._toInstructions(open, close);
      case 2:
        return [
          ...this.siblings[0]._toInstructions(open, 0),
          ...this.siblings[1]._toInstructions(0, close),
        ];
      default:
        return [
          ...this.siblings[0]._toInstructions(open, 0),
          ...this.siblings.slice(1, -1).flatMap(function (x) {
            return x._toInstructions(0, 0);
          }),
          ...this.siblings[this.siblings.length - 1]._toInstructions(0, close),
        ];
    }
  }

  public toString(): string {
    return this.raw;
  }
}

export type ScopedSegmentExpressionOrHigher = SegmentGroupExpressionOrHigher | ScopedSegmentExpression;
export type ScopedSegmentExpressionOrLower = CompositeSegmentExpressionOrLower | ScopedSegmentExpression;
/**
 * The (single) left-hand side and the (one or more) right-hand side of a slash-separated segment.
 *
 * Variations:
 *
 * 1: `a/b`
 * - left: `a`
 * - right: `b`
 *
 * Where
 * - a = `SegmentGroupExpressionOrHigher` (`SegmentExpression | SegmentGroupExpression`)
 * - b = `ScopedSegmentExpressionOrHigher` (`SegmentExpression | SegmentGroupExpression | ScopedSegmentExpression`)
 */
export class ScopedSegmentExpression {
  public get kind(): ExpressionKind.ScopedSegment { return ExpressionKind.ScopedSegment; }

  public constructor(
    public readonly raw: string,
    public readonly left: SegmentGroupExpressionOrHigher,
    public readonly right: ScopedSegmentExpressionOrHigher,
  ) {}

  /** @internal */
  public static _parse(state: ParserState): ScopedSegmentExpressionOrHigher {
    state._record();

    const left = SegmentGroupExpression._parse(state);

    if (state._consumeOptional('/')) {
      const right = ScopedSegmentExpression._parse(state);

      const raw = state._playback();
      return new ScopedSegmentExpression(raw, left, right);
    }

    state._discard();
    return left;
  }

  /** @internal */
  public _toInstructions(open: number, close: number): ViewportInstruction[] {
    const leftInstructions = this.left._toInstructions(open, 0);
    const rightInstructions = this.right._toInstructions(0, close);
    let cur = leftInstructions[leftInstructions.length - 1];
    while (cur.children.length > 0) {
      cur = cur.children[cur.children.length - 1];
    }
    cur.children.push(...rightInstructions);
    return leftInstructions;
  }

  public toString(): string {
    return this.raw;
  }
}

export type SegmentGroupExpressionOrHigher = SegmentExpression | SegmentGroupExpression;
export type SegmentGroupExpressionOrLower = ScopedSegmentExpressionOrLower | SegmentGroupExpression;
/**
 * Any kind of segment wrapped in parentheses, increasing its precedence.
 * Specifically, the parentheses are needed to deeply specify scoped siblings.
 * The precedence is intentionally similar to the familiar mathematical `/` and `+` operators.
 *
 * For example, consider this viewport structure:
 * - viewport-a
 * - - viewport-a1
 * - - viewport-a2
 * - viewport-b
 * - - viewport-b1
 *
 * This can only be deeply specified by using the grouping operator: `a/(a1+a2)+b/b1`
 *
 * Because `a/a1+a2+b/b1` would be interpreted differently:
 * - viewport-a
 * - - viewport-a1
 * - viewport-a2
 * - viewport-b
 * - - viewport-b1
 *
 * ### Variations:
 *
 * 1: `(a)`
 * - expression: `a`
 *
 * Where
 * - a = `CompositeSegmentExpressionOrHigher` (`SegmentExpression | SegmentGroupExpression | ScopedSegmentExpression | CompositeSegmentExpression`)
 */
export class SegmentGroupExpression {
  public get kind(): ExpressionKind.SegmentGroup { return ExpressionKind.SegmentGroup; }

  public constructor(
    public readonly raw: string,
    public readonly expression: CompositeSegmentExpressionOrHigher,
  ) {}

  /** @internal */
  public static _parse(state: ParserState): SegmentGroupExpressionOrHigher {
    state._record();

    if (state._consumeOptional('(')) {
      const expression = CompositeSegmentExpression._parse(state);
      state._consume(')');

      const raw = state._playback();
      return new SegmentGroupExpression(raw, expression);
    }

    state._discard();
    return SegmentExpression._parse(state);
  }

  /** @internal */
  public _toInstructions(open: number, close: number): ViewportInstruction[] {
    return this.expression._toInstructions(open + 1, close + 1);
  }

  public toString(): string {
    return this.raw;
  }
}

/**
 * A (non-composite) segment specifying a single component and (optional) viewport / action.
 */
export class SegmentExpression {
  public get kind(): ExpressionKind.Segment { return ExpressionKind.Segment; }

  public static get EMPTY(): SegmentExpression { return new SegmentExpression('', ComponentExpression.EMPTY, ActionExpression.EMPTY, ViewportExpression.EMPTY, true); }

  public constructor(
    public readonly raw: string,
    public readonly component: ComponentExpression,
    public readonly action: ActionExpression,
    public readonly viewport: ViewportExpression,
    public readonly scoped: boolean,
  ) {}

  /** @internal */
  public static _parse(state: ParserState): SegmentExpression {
    state._record();

    const component = ComponentExpression._parse(state);
    const action = ActionExpression._parse(state);
    const viewport = ViewportExpression._parse(state);
    const scoped = !state._consumeOptional('!');

    const raw = state._playback();
    return new SegmentExpression(raw, component, action, viewport, scoped);
  }

  /** @internal */
  public _toInstructions(open: number, close: number): ViewportInstruction[] {
    return [
      ViewportInstruction.create({
        component: this.component.name,
        params: this.component.parameterList._toObject(),
        viewport: this.viewport.name,
        open,
        close,
      }),
    ];
  }

  public toString(): string {
    return this.raw;
  }
}

export class ComponentExpression {
  public get kind(): ExpressionKind.Component { return ExpressionKind.Component; }

  public static get EMPTY(): ComponentExpression { return new ComponentExpression('', '', ParameterListExpression.EMPTY); }

  /**
   * A single segment matching parameter, e.g. `:foo` (will match `a` but not `a/b`)
   */
  public readonly isParameter: boolean;
  /**
   * A multi-segment matching parameter, e.g. `*foo` (will match `a` as well as `a/b`)
   */
  public readonly isStar: boolean;
  /**
   * Whether this is either a parameter or a star segment.
   */
  public readonly isDynamic: boolean;
  /**
   * If this is a dynamic segment (parameter or star), this is the name of the parameter (the name without the `:` or `*`)
   */
  public readonly parameterName: string;

  public constructor(
    public readonly raw: string,
    public readonly name: string,
    public readonly parameterList: ParameterListExpression,
  ) {
    switch (name.charAt(0)) {
      case ':':
        this.isParameter = true;
        this.isStar = false;
        this.isDynamic = true;
        this.parameterName = name.slice(1);
        break;
      case '*':
        this.isParameter = false;
        this.isStar = true;
        this.isDynamic = true;
        this.parameterName = name.slice(1);
        break;
      default:
        this.isParameter = false;
        this.isStar = false;
        this.isDynamic = false;
        this.parameterName = name;
        break;
    }
  }

  /** @internal */
  public static _parse(state: ParserState): ComponentExpression {
    state._record();
    state._record();
    if (!state._done) {
      if (state._startsWith('./')) {
        state._advance();
      } else if (state._startsWith('../')) {
        state._advance();
        state._advance();
      } else {
        while (!state._done && !state._startsWith(...terminal)) {
          state._advance();
        }
      }
    }

    const name = decodeURIComponent(state._playback());
    if (name.length === 0) {
      state._expect('component name');
    }
    const parameterList = ParameterListExpression._parse(state);

    const raw = state._playback();
    return new ComponentExpression(raw, name, parameterList);
  }

  public toString(): string {
    return this.raw;
  }
}

export class ActionExpression {
  public get kind(): ExpressionKind.Action { return ExpressionKind.Action; }

  public static get EMPTY(): ActionExpression { return new ActionExpression('', '', ParameterListExpression.EMPTY); }

  public constructor(
    public readonly raw: string,
    public readonly name: string,
    public readonly parameterList: ParameterListExpression,
  ) {}

  /** @internal */
  public static _parse(state: ParserState): ActionExpression {
    state._record();
    let name = '';

    if (state._consumeOptional('.')) {
      state._record();
      while (!state._done && !state._startsWith(...terminal)) {
        state._advance();
      }

      name = decodeURIComponent(state._playback());
      if (name.length === 0) {
        state._expect('method name');
      }
    }

    const parameterList = ParameterListExpression._parse(state);

    const raw = state._playback();
    return new ActionExpression(raw, name, parameterList);
  }

  public toString(): string {
    return this.raw;
  }
}

export class ViewportExpression {
  public get kind(): ExpressionKind.Viewport { return ExpressionKind.Viewport; }

  public static get EMPTY(): ViewportExpression { return new ViewportExpression('', ''); }

  public constructor(
    public readonly raw: string,
    public readonly name: string | null,
  ) {}

  /** @internal */
  public static _parse(state: ParserState): ViewportExpression {
    state._record();
    let name: string | null = null;

    if (state._consumeOptional('@')) {
      state._record();
      while (!state._done && !state._startsWith(...terminal)) {
        state._advance();
      }

      name = decodeURIComponent(state._playback());
      if (name.length === 0) {
        state._expect('viewport name');
      }
    }

    const raw = state._playback();
    return new ViewportExpression(raw, name);
  }

  public toString(): string {
    return this.raw;
  }
}

export class ParameterListExpression {
  public get kind(): ExpressionKind.ParameterList { return ExpressionKind.ParameterList; }

  public static get EMPTY(): ParameterListExpression { return new ParameterListExpression('', []); }

  public constructor(
    public readonly raw: string,
    public readonly expressions: readonly ParameterExpression[],
  ) {}

  /** @internal */
  public static _parse(state: ParserState): ParameterListExpression {
    state._record();
    const expressions = [];
    if (state._consumeOptional('(')) {
      do {
        expressions.push(ParameterExpression._parse(state, expressions.length));
        if (!state._consumeOptional(',')) {
          break;
        }
      } while (!state._done && !state._startsWith(')'));
      state._consume(')');
    }

    const raw = state._playback();
    return new ParameterListExpression(raw, expressions);
  }

  /** @internal */
  public _toObject(): Params {
    const params: Params = {};
    for (const expr of this.expressions) {
      params[expr.key] = expr.value;
    }
    return params;
  }

  public toString(): string {
    return this.raw;
  }
}

export class ParameterExpression {
  public get kind(): ExpressionKind.Parameter { return ExpressionKind.Parameter; }

  public static get EMPTY(): ParameterExpression { return new ParameterExpression('', '', ''); }

  public constructor(
    public readonly raw: string,
    public readonly key: string,
    public readonly value: string,
  ) {}

  /** @internal */
  public static _parse(state: ParserState, index: number): ParameterExpression {
    state._record();
    state._record();
    while (!state._done && !state._startsWith(...terminal)) {
      state._advance();
    }

    let key = decodeURIComponent(state._playback());
    if (key.length === 0) {
      state._expect('parameter key');
    }
    let value;
    if (state._consumeOptional('=')) {
      state._record();
      while (!state._done && !state._startsWith(...terminal)) {
        state._advance();
      }

      value = decodeURIComponent(state._playback());
      if (value.length === 0) {
        state._expect('parameter value');
      }
    } else {
      value = key;
      key = index.toString();
    }

    const raw = state._playback();
    return new ParameterExpression(raw, key, value);
  }

  public toString(): string {
    return this.raw;
  }
}

export const AST = Object.freeze({
  RouteExpression,
  CompositeSegmentExpression,
  ScopedSegmentExpression,
  SegmentGroupExpression,
  SegmentExpression,
  ComponentExpression,
  ActionExpression,
  ViewportExpression,
  ParameterListExpression,
  ParameterExpression,
});
