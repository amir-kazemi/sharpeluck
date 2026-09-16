"""A small signal language, and the grid expansion that turns one expression
into a family of trials.

    cs_zscore(ts_ret(close, [12, 24, 72, 168]))

is one expression and four trials. Declaring parameters as ranges rather than
values is the whole point of the platform: the number of trials you ran is an
input to the deflated Sharpe ratio, so the grid has to be an explicit,
recorded object rather than something you did by hand and forgot.

Expressions parse to a tree and evaluate to a Polars expression. There is no
`eval` anywhere: the parser accepts identifiers, numbers, lists and parens, and
an unknown op is a parse error rather than arbitrary code.
"""
from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field
from typing import Callable

import polars as pl

# --------------------------------------------------------------------------
# Ops
# --------------------------------------------------------------------------
# Base fields. `prepare_panel` in signals.py guarantees these columns exist on
# a gap-free hourly grid, which is what makes the row-count windows below
# exactly equal to time windows.
FIELDS: dict[str, Callable[[], pl.Expr]] = {
    "ret": lambda: pl.col("ret"),
    "close": lambda: pl.col("close"),
    "dollar_vol": lambda: pl.col("quote_volume"),
    "taker_imb": lambda: pl.col("taker_imb"),
    "trades": lambda: pl.col("trades").cast(pl.Float64),
}


def _mask_to_universe(e: pl.Expr) -> pl.Expr:
    """Cross-sectional ops must see only tradable names at that bar; anything
    else silently ranks a symbol against coins it could not have traded."""
    return pl.when(pl.col("in_universe")).then(e).otherwise(None)


# Time-series ops: per symbol, trailing, causal (they include bar t, and the
# backtester lags the finished signal by one bar before it earns a return).
TS_OPS: dict[str, Callable[[pl.Expr, int], pl.Expr]] = {
    "ts_mean": lambda e, n: e.rolling_mean(n, min_samples=n).over("symbol"),
    "ts_std": lambda e, n: e.rolling_std(n, min_samples=n).over("symbol"),
    "ts_sum": lambda e, n: e.rolling_sum(n, min_samples=n).over("symbol"),
    "ts_ret": lambda e, n: (e / e.shift(n) - 1.0).over("symbol"),
    "ts_zscore": lambda e, n: (
        (e - e.rolling_mean(n, min_samples=n)) / e.rolling_std(n, min_samples=n)
    ).over("symbol"),
}

# Cross-sectional ops: per bar, across the universe.
CS_OPS: dict[str, Callable[[pl.Expr], pl.Expr]] = {
    "cs_demean": lambda e: (_mask_to_universe(e) - _mask_to_universe(e).mean()).over("ts"),
    "cs_zscore": lambda e: (
        (_mask_to_universe(e) - _mask_to_universe(e).mean()) / _mask_to_universe(e).std()
    ).over("ts"),
    "cs_rank": lambda e: (
        _mask_to_universe(e).rank() / _mask_to_universe(e).count() - 0.5
    ).over("ts"),
}

UNARY_OPS: dict[str, Callable[[pl.Expr], pl.Expr]] = {
    "neg": lambda e: -e,
    "sign": lambda e: e.sign(),
    "abs": lambda e: e.abs(),
}

PARAM_OPS: dict[str, Callable[[pl.Expr, float], pl.Expr]] = {
    "clip": lambda e, k: e.clip(-float(k), float(k)),
}

ARITY_1 = set(FIELDS) | set(CS_OPS) | set(UNARY_OPS)
ARITY_2 = set(TS_OPS) | set(PARAM_OPS)
ALL_OPS = ARITY_1 | ARITY_2


# --------------------------------------------------------------------------
# Parser
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Node:
    op: str
    child: "Node | None" = None
    params: tuple = field(default_factory=tuple)  # scalars, or lists = a range


_TOKEN = re.compile(r"\s*(?:(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<num>-?\d+\.?\d*)|(?P<sym>[(),\[\]]))")


class ParseError(ValueError):
    pass


def _tokenize(s: str) -> list[tuple[str, str]]:
    out, i = [], 0
    while i < len(s):
        m = _TOKEN.match(s, i)
        if not m:
            raise ParseError(f"unexpected character at position {i}: {s[i]!r}")
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
        i = m.end()
    return out


def parse(expr: str) -> Node:
    toks = _tokenize(expr)
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else (None, None)

    def eat(val=None):
        nonlocal pos
        if pos >= len(toks):
            raise ParseError("unexpected end of expression")
        k, v = toks[pos]
        if val is not None and v != val:
            raise ParseError(f"expected {val!r}, got {v!r}")
        pos += 1
        return k, v

    def parse_number_list():
        eat("[")
        vals = []
        while True:
            k, v = eat()
            if k != "num":
                raise ParseError(f"expected a number in list, got {v!r}")
            vals.append(float(v) if "." in v else int(v))
            k, v = peek()
            if v == ",":
                eat(",")
                continue
            eat("]")
            return tuple(vals)

    def parse_node() -> Node:
        k, name = eat()
        if k != "name":
            raise ParseError(f"expected an op name, got {name!r}")
        if name not in ALL_OPS:
            raise ParseError(f"unknown op {name!r}; known ops: {sorted(ALL_OPS)}")
        if peek()[1] != "(":
            if name in FIELDS:
                return Node(name)
            raise ParseError(f"op {name!r} needs arguments")
        eat("(")
        child, params = None, []
        if name in FIELDS:
            eat(")")
            return Node(name)
        child = parse_node()
        while peek()[1] == ",":
            eat(",")
            if peek()[1] == "[":
                params.append(parse_number_list())
            else:
                k, v = eat()
                if k != "num":
                    raise ParseError(f"expected a number parameter, got {v!r}")
                params.append(float(v) if "." in v else int(v))
        eat(")")
        want = 1 if name in ARITY_1 else 2
        if len(params) != want - 1:
            raise ParseError(f"op {name!r} takes {want - 1} parameter(s), got {len(params)}")
        return Node(name, child, tuple(params))

    node = parse_node()
    if pos != len(toks):
        raise ParseError(f"trailing input after expression: {toks[pos:]!r}")
    return node


def to_str(n: Node) -> str:
    if n.child is None:
        return n.op
    inner = [to_str(n.child)]
    for p in n.params:
        inner.append(f"[{', '.join(str(x) for x in p)}]" if isinstance(p, tuple) else str(p))
    return f"{n.op}({', '.join(inner)})"


# --------------------------------------------------------------------------
# Grid expansion
# --------------------------------------------------------------------------
def _ranges(n: Node) -> list[tuple]:
    out = [p for p in n.params if isinstance(p, tuple)]
    return (out + _ranges(n.child)) if n.child else out


def _substitute(n: Node, values: list) -> Node:
    params = tuple(values.pop(0) if isinstance(p, tuple) else p for p in n.params)
    child = _substitute(n.child, values) if n.child else None
    return Node(n.op, child, params)


def expand(expr: str | Node) -> list[Node]:
    """One expression with list-valued parameters -> the concrete trial grid."""
    root = parse(expr) if isinstance(expr, str) else expr
    ranges = _ranges(root)
    if not ranges:
        return [root]
    return [_substitute(root, list(combo)) for combo in itertools.product(*ranges)]


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------
def apply(df: pl.DataFrame, expr: Node | str, out: str = "sig") -> pl.DataFrame:
    """Evaluate an expression against a panel, one materialised column per op.

    Ops are NOT composed into a single nested Polars expression. `ts_*` ops
    window `.over("symbol")` and `cs_*` ops window `.over("ts")`; nesting the
    two makes the inner window run inside the outer group, where a per-symbol
    rolling mean sees exactly one row and returns null for everything. Each op
    therefore writes a real column that the next op reads back.
    """
    node = parse(expr) if isinstance(expr, str) else expr
    tmp: list[str] = []
    df, col = _materialise(node, df.sort(["symbol", "ts"]), tmp, [0])
    return df.with_columns(pl.col(col).alias(out)).drop(t for t in tmp if t != out)


def _materialise(node: Node, df: pl.DataFrame, tmp: list[str], ctr: list[int]):
    if node.op in FIELDS:
        e = FIELDS[node.op]()
    else:
        df, c = _materialise(node.child, df, tmp, ctr)
        x = pl.col(c)
        if node.op in UNARY_OPS:
            e = UNARY_OPS[node.op](x)
        elif node.op in CS_OPS:
            e = CS_OPS[node.op](x)
        elif node.op in TS_OPS:
            e = TS_OPS[node.op](x, int(node.params[0]))
        else:
            e = PARAM_OPS[node.op](x, node.params[0])
    name = f"__t{ctr[0]}"
    ctr[0] += 1
    tmp.append(name)
    return df.with_columns(e.alias(name)), name


def max_lookback(n: Node | str) -> int:
    """Longest trailing window in the expression, in bars. The walk-forward
    purge needs this to know how far a test observation reaches backwards."""
    node = parse(n) if isinstance(n, str) else n
    here = int(node.params[0]) if (node.op in TS_OPS and node.params) else 0
    return here + (max_lookback(node.child) if node.child else 0)
